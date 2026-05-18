import { task } from "@trigger.dev/sdk/v3";
import OpenAI from "openai";
import prisma from "../../DB/prisma.client";

// ── Trusted source names — lowercase for case-insensitive match ─
const TRUSTED_SOURCES = new Set([
  "bhaskar",
  "news36live",
  "news 18 hindi",
  "hindustan",
  "aaj tak",
  "ndtv",
  "zee news",
  "abp news",
  "navbharat live",
  "jagran",
  "news nation",
  "india tv",
  "times now navbharat",
]);

// ── Safe JSON extractor ──────────────────────────────────────────
const extractJSON = (rawText) => {
  try {
    return JSON.parse(rawText);
  } catch (e) {}

  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON found. Raw: ${rawText.slice(0, 200)}`);

  let jsonString = match[0];
  jsonString = jsonString.replace(
    /"((?:[^"\\]|\\.)*)"/g,
    (m) => m.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")
  );

  try {
    return JSON.parse(jsonString);
  } catch (e) {}

  const cleaned = jsonString.replace(/[\x00-\x1F\x7F]/g, (char) => {
    if (char === "\n") return "\\n";
    if (char === "\r") return "\\r";
    if (char === "\t") return "\\t";
    return "";
  });

  try {
    return JSON.parse(cleaned);
  } catch (e) {}

  // Salvage truncated arrays
  try {
    const completeObjects = [];
    let depth = 0, start = -1, inString = false, escape = false;

    for (let i = 0; i < cleaned.length; i++) {
      const char = cleaned[i];
      if (escape) { escape = false; continue; }
      if (char === '\\' && inString) { escape = true; continue; }
      if (char === '"') { inString = !inString; continue; }
      if (inString) continue;

      if (char === '{') {
        if (depth === 1) start = i;
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 1 && start !== -1) {
          try {
            const obj = JSON.parse(cleaned.slice(start, i + 1));
            completeObjects.push(obj);
          } catch (e) {}
          start = -1;
        }
      }
    }

    if (completeObjects.length > 0) {
      console.warn(`JSON truncated — salvaged ${completeObjects.length} objects`);
      return { selectedIndexes: completeObjects.flatMap(o => o.selectedIndexes || []) };
    }
  } catch (e) {}

  throw new Error(`Failed to parse JSON. Raw: ${rawText.slice(0, 200)}`);
};

// ── Fetch one page from newsdata.io ─────────────────────────────
const fetchPage = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`newsdata.io HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== "success") throw new Error(`newsdata.io error: ${JSON.stringify(data)}`);
  return data;
};

// ── Main task ────────────────────────────────────────────────────
export const fetchNewsTask = task({
  id: "morning-news-fetcher",
  retry: { maxAttempts: 1 },

  run: async (payload) => {
    const { category } = payload;

    const API_KEY = process.env.NEWSDATA_IO_API_KEY;

    // NOTE: We do NOT use domainurl param — it may not be available on all plans
    // and encoding issues can silently return 0 results.
    // Instead we fetch broadly (language=hi, country=in) and filter by source_name client-side.
    const BASE_URL =
      `https://newsdata.io/api/1/latest` +
      `?apikey=${API_KEY}` +
      `&q=${encodeURIComponent(category)}` +
      `&language=hi` +
      `&country=in`;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // ── Paginate up to 20 pages (20 × 10 = 200 max) ─────────────
    let allResults = [];
    let nextPage = null;
    let pageCount = 0;
    const MAX_PAGES = 20;

    do {
      const pageUrl = nextPage ? `${BASE_URL}&page=${nextPage}` : BASE_URL;;

      try {
        const data = await fetchPage(pageUrl);
        if (!data.results?.length) break;

        allResults.push(...data.results);
        nextPage = data.nextPage || null;
        pageCount++;

        console.log(`Page ${pageCount} — running total: ${allResults.length}`);
      } catch (e) {
        console.warn(`Page ${pageCount + 1} failed: ${e.message} — stopping pagination`);
        break;
      }

      if (nextPage && pageCount < MAX_PAGES) await sleep(300);
    } while (nextPage && pageCount < MAX_PAGES);


    // ── Deduplicate by article_id ────────────────────────────────
    const seen = new Set();
    const unique = allResults.filter((a) => {
      if (!a.article_id || seen.has(a.article_id)) return false;
      seen.add(a.article_id);
      return true;
    });

    // ── Filter: trusted sources only (case-insensitive) ─────────
    const allSourceNames = [...new Set(unique.map(a => a.source_name).filter(Boolean))];
    console.log(`All source_names in response: ${JSON.stringify(allSourceNames)}`);

    const trusted = unique.filter(
      (a) => a.source_name && TRUSTED_SOURCES.has(a.source_name.toLowerCase().trim()) && !a.duplicate
    );

    // If no trusted sources found, fall back to ALL unique articles so task doesn't fail.
    // The AI will still pick the best 50 — we just won't have source filtering.
    const articlesToRank = trusted.length > 0 ? trusted : unique;

    if (articlesToRank.length === 0) {
      throw new Error(`No articles found at all for category "${category}". API returned 0 results.`);
    }

    if (trusted.length === 0) {
      console.warn(
        `WARNING: 0 trusted-source matches. Known sources: ${JSON.stringify(allSourceNames.slice(0, 20))}. ` +
        `Falling back to all ${unique.length} articles without source filter.`
      );
    }

    // ── Sort by source_priority (lower = more authoritative) ──────
    const sorted = [...articlesToRank].sort(
      (a, b) => (a.source_priority ?? 999999) - (b.source_priority ?? 999999)
    );

    // ── Take top 100 for AI selection (cap prompt size) ───────────
    const candidates = sorted.slice(0, 100);

    // ── Strip fields to minimal for AI prompt ─────────────────────
    const titlesForAI = candidates.map((a, i) => ({
      index: i,
      title: (a.title || "").slice(0, 200),
      source: a.source_name || "",
      priority: a.source_priority ?? 999999,
    }));

    const openRouter = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });

    const categoryToneMap = {
      top: "सबसे बड़ी और जरूरी राष्ट्रीय/अंतरराष्ट्रीय खबरें जो हर भारतीय को जाननी चाहिए",
      crime: "सबसे चौंकाने वाली, हाई-प्रोफाइल और जनहित से जुड़ी crime खबरें",
      education: "छात्रों, अभिभावकों और शिक्षकों के लिए सबसे जरूरी और impactful education खबरें",
      business: "बाजार, economy, jobs और आम आदमी की जेब पर असर डालने वाली business खबरें",
      lifestyle: "health, wellness, trending और आम जीवन से सीधे जुड़ी lifestyle खबरें",
    };
    const categoryTone = categoryToneMap[category] || `${category} से जुड़ी सबसे impactful खबरें`;

    // ── AI selects best 50 ────────────────────────────────────────
    const selectionPrompt = `
You are a senior Hindi news editor for a major Indian TV channel.

From the list below, select the BEST 50 articles for today's ${category} news bulletin.

Category focus: ${categoryTone}

Selection criteria (in order of priority):
1. High impact on common Indians — pick stories that affect daily life
2. Breaking or latest news preferred over older stories
3. Unique stories — NO duplicates or near-identical stories
4. High viral and emotional resonance
5. Avoid repetitive crime/accident filler; prefer substantive journalism
6. Prefer stories from authoritative sources (lower priority number = better)

Return ONLY valid JSON — no explanation, no markdown:
{
  "selectedIndexes": [0, 3, 7, 12, ...]
}

Select exactly 50 indexes (or fewer if total articles < 50).

Articles:
${JSON.stringify(titlesForAI)}
`.trim();

    const selectionCompletion = await openRouter.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "You are a senior Hindi news editor. Output ONLY valid JSON with a selectedIndexes array of integers.",
        },
        { role: "user", content: selectionPrompt },
      ],
      model: "openai/gpt-4o-mini",
      temperature: 0.2,
      max_completion_tokens: 1000,
      response_format: { type: "json_object" },
    });

    const selectionParsed = extractJSON(
      selectionCompletion.choices[0].message.content
    );
    const selectedIndexes = (selectionParsed.selectedIndexes || []).slice(0, 50);

    if (!selectedIndexes.length) {
      throw new Error("AI returned empty selectedIndexes");
    }

    const selectedArticles = selectedIndexes
      .filter((i) => i >= 0 && i < candidates.length)
      .map((i) => candidates[i]);


    // ── Save to DB — one row per category the article belongs to ──
    // newsdata.io returns category as an array e.g. ["crime", "top"].
    // We save a separate row per category so the article shows up in
    // every relevant feed. The requested category is always included.
    const toSave = [];

    for (const item of selectedArticles) {
      // Always include the requested category + any others from the article
      const articleCategories = Array.isArray(item.category) && item.category.length > 0
        ? item.category
        : [category];

      // Deduplicate: ensure requested category is always present
      const categorySet = new Set([
        category,
        ...articleCategories.map(c => c.toLowerCase().trim()),
      ]);

      for (const cat of categorySet) {
        toSave.push({
          title: item.title || "",
          hindiSummary: "",           // empty — generated on-demand
          description: (item.description || "").slice(0, 1000),
          link: item.link || "",
          image_url: item.image_url || "",
          source_name: item.source_name || "",
          source_url: item.source_url || "",
          category: cat,
          pubDate: item.pubDate || "",
          keywords: item.keywords || [],
        });
      }
    }

    // Deduplicate by link+category to avoid constraint errors on re-runs
    const seenKey = new Set();
    const uniqueToSave = toSave.filter(row => {
      const key = `${row.link}__${row.category}`;
      if (seenKey.has(key)) return false;
      seenKey.add(key);
      return true;
    });

    await prisma.morningAiNewsFetch.createMany({
      data: uniqueToSave,
      skipDuplicates: true,
    });

    // Return only rows matching the requested category for the API response
    return uniqueToSave.filter(r => r.category === category);
  },
});