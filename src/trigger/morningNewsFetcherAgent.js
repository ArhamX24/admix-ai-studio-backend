import { task } from "@trigger.dev/sdk/v3";
import OpenAI from "openai";
import prisma from "../../DB/prisma.client";

// ✅ Safe JSON extractor — handles bad control chars and truncated responses
const extractJSON = (rawText) => {
  // Step 1: Try direct parse first
  try {
    return JSON.parse(rawText);
  } catch (e) {}

  // Step 2: Extract JSON object
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON found. Raw: ${rawText.slice(0, 200)}`);

  let jsonString = match[0];

  // Step 3: Fix control characters
  jsonString = jsonString.replace(
    /"((?:[^"\\]|\\.)*)"/g,
    (m) => m.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")
  );

  try {
    return JSON.parse(jsonString);
  } catch (e) {}

  // Step 4: Strip all control chars
  const cleaned = jsonString.replace(/[\x00-\x1F\x7F]/g, (char) => {
    if (char === "\n") return "\\n";
    if (char === "\r") return "\\r";
    if (char === "\t") return "\\t";
    return "";
  });

  try {
    return JSON.parse(cleaned);
  } catch (e) {}

  // Step 5: Salvage truncated articles array
  try {
    const completeObjects = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escape = false;

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
      console.warn(`JSON truncated — salvaged ${completeObjects.length} complete objects`);
      // ✅ Handle both { articles: [...] } and { voiceOver: "..." } shapes
      if (completeObjects[0]?.title || completeObjects[0]?.link) {
        return { articles: completeObjects };
      }
      return completeObjects[0]; // single object like voiceOver, hindiSummary etc
    }
  } catch (salvageError) {}

  throw new Error(`Failed to parse JSON after all attempts. Raw: ${rawText.slice(0, 200)}`);
};
// ✅ Scrape full article text from URL
const scrapeArticle = async (url) => {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "hi-IN,hi;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;

    const html = await res.text();

    const extractText = (html) => {
      let cleaned = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<nav[\s\S]*?<\/nav>/gi, "")
        .replace(/<header[\s\S]*?<\/header>/gi, "")
        .replace(/<footer[\s\S]*?<\/footer>/gi, "")
        .replace(/<aside[\s\S]*?<\/aside>/gi, "")
        .replace(/<!--[\s\S]*?-->/g, "");

      const articleMatch = cleaned.match(/<article[\s\S]*?<\/article>/i);
      const mainMatch = cleaned.match(/<main[\s\S]*?<\/main>/i);
      const contentSource = articleMatch?.[0] || mainMatch?.[0] || cleaned;

      const text = contentSource
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, " ")
        .trim();

      return text;
    };

    const text = extractText(html);
    return text.length > 200 ? text.slice(0, 3000) : null;

  } catch (e) {
    console.log(`Scrape failed for URL: ${url} — ${e.message}`);
    return null;
  }
};

export const fetchNewsTask = task({
  id: "morning-news-fetcher",
  retry: { maxAttempts: 1 },

  run: async (payload) => {
    const { category } = payload;

    // ── Step 1: Fetch news from Newsdata.io ──────────────────────
    const url = `https://newsdata.io/api/1/latest?apikey=${process.env.NEWSDATA_IO_API_KEY}&q=${category}&language=hi&country=in`;
    const res = await fetch(url);
    const page1 = await res.json();

    console.log("Newsdata.io status:", page1.status);
    console.log("Results count:", page1.results?.length ?? "no results field");

    if (page1.status !== "success") {
      throw new Error(`Newsdata.io API error: ${JSON.stringify(page1.results || page1)}`);
    }

    if (!page1.results || page1.results.length === 0) {
      throw new Error(`No news found for category: ${category}`);
    }

    let allResults = [...page1.results];

    if (page1.nextPage) {
      try {
        const url2 = `https://newsdata.io/api/1/latest?apikey=${process.env.NEWSDATA_IO_API_KEY}&q=${category}&language=hi&country=in&page=${page1.nextPage}`;
        const res2 = await fetch(url2);
        const page2 = await res2.json();
        if (page2.status === "success" && page2.results?.length > 0) {
          allResults = [...allResults, ...page2.results];
        }
      } catch (e) {
        console.log("Page 2 fetch failed, continuing:", e.message);
      }
    }

    // ✅ Trim fields to prevent prompt overflow
    const articlesToProcess = allResults.slice(0, 10).map(a => ({
      title: a.title || "",
      description: (a.description || "").slice(0, 300), // cap at 300 chars
      link: a.link || "",
      image_url: a.image_url || null,
      source_name: a.source_name || "",
      source_url: a.source_url || "",
      pubDate: a.pubDate || "",
      keywords: a.keywords || [],
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

// ── Step 2: AI selects best article TITLES only ──────────────────
// ✅ Send only titles to AI — tiny prompt, no truncation possible
const titlesOnly = articlesToProcess.map((a, i) => ({
  index: i,
  title: (a.title || "").slice(0, 200),
}));

const selectionPrompt = `
You are a senior Hindi news editor. From the list below, pick the best 10-12 news articles.

Category focus: ${categoryTone}

Selection criteria:
1. High impact on common Indians
2. Unique — no duplicates or similar stories
3. High viral potential
4. Latest and breaking news preferred

Return ONLY valid JSON:
{
  "selectedIndexes": [0, 2, 4, 7, 9, 11, 13, 15, 17, 19]
}

Articles (index + title only):
${JSON.stringify(titlesOnly)}
`;

const selectionCompletion = await openRouter.chat.completions.create({
  messages: [
    {
      role: "system",
      content: "You are a senior Hindi news editor. Output ONLY valid JSON with selectedIndexes array.",
    },
    { role: "user", content: selectionPrompt },
  ],
  model: "openai/gpt-4o-mini",
  temperature: 0.2,
  max_completion_tokens: 1000,
  response_format: { type: "json_object" },
});

const selectionParsed = extractJSON(selectionCompletion.choices[0].message.content);
const selectedIndexes = selectionParsed.selectedIndexes || [];

if (!selectedIndexes || selectedIndexes.length === 0) {
  throw new Error("AI returned empty selectedIndexes");
}

// ✅ Use indexes to pick original articles — no AI truncation risk
const selectedArticles = selectedIndexes
  .filter(i => i >= 0 && i < articlesToProcess.length)
  .map(i => articlesToProcess[i]);

console.log(`Selected ${selectedArticles.length} articles by index`);

    // ── Step 3: Scrape + generate rich Hindi summary per article ─
    const enrichedArticles = [];

    for (const article of selectedArticles) {
      console.log(`Scraping: ${article.link}`);

      const fullText = await scrapeArticle(article.link);

      const sourceMaterial = fullText
        ? `Title: ${article.title}\n\nFull Article Content:\n${fullText}`
        : `Title: ${article.title}\n\nDescription: ${article.description || "No description available"}`;

      console.log(`Source: ${sourceMaterial.length} chars — ${fullText ? "scraped" : "fallback to description"}`);

      try {
        const summaryCompletion = await openRouter.chat.completions.create({
          messages: [
            {
              role: "system",
              content: `You are a senior Hindi journalist. Write a detailed factual Hindi news summary.

OUTPUT: Raw JSON only. No markdown. No backticks.
JSON schema: { "hindiSummary": "string" }

HINDI SUMMARY RULES:
- Length: MINIMUM 500 words, MAXIMUM 700 words. Count every word.
- Language: Clear, professional broadcast Hindi. Simple for common people.
- Structure:
  1. What happened — core news in 3-4 sentences
  2. Who is involved — key people, organizations, places
  3. Why it happened — background and reason
  4. How it happened — sequence of events with details
  5. What is the impact — on common people, society, economy
  6. What happens next — expected outcomes, reactions
  7. Key facts and numbers — statistics, dates, figures mentioned
- Include ALL important facts, names, numbers from the source.
- Do NOT add fictional information — only use what is in the source.
- If source is short — expand with relevant context about the topic.
- NO repetition. Every paragraph must add new information.`,
            },
            {
              role: "user",
              content: `Write a detailed Hindi summary (500-700 words) for this news article.

${sourceMaterial}

Return raw JSON only: { "hindiSummary": "..." }`,
            },
          ],
          model: "openai/gpt-4o-mini",
          temperature: 0.3,
          frequency_penalty: 0.7,
          presence_penalty: 0.5,
          max_tokens: 4000,
          response_format: { type: "json_object" },
        });

        // ✅ Use extractJSON instead of JSON.parse
        const summaryParsed = extractJSON(summaryCompletion.choices[0].message.content);
        const hindiSummary = summaryParsed.hindiSummary || article.description || "";
        const summaryWordCount = hindiSummary.trim().split(/\s+/).length;

        console.log(`Summary: ${summaryWordCount} words for "${article.title.slice(0, 50)}..."`);

        enrichedArticles.push({
          ...article,
          hindiSummary,
        });

      } catch (summaryError) {
        // Fallback — don't skip article if summary fails
        console.warn(`Summary failed for "${article.title}" — using description as fallback. Error: ${summaryError.message}`);
        enrichedArticles.push({
          ...article,
          hindiSummary: article.description || article.title,
        });
      }
    }

    // ── Step 4: Save all enriched articles to DB ─────────────────
    await prisma.morningAiNewsFetch.createMany({
      data: enrichedArticles.map((item) => ({
        title: item?.title || "",
        hindiSummary: item?.hindiSummary || "",
        description: item?.description || "",
        link: item?.link || "",
        image_url: item?.image_url || "",
        source_name: item?.source_name || "",
        source_url: item?.source_url || "",
        category: item?.category || category,
        pubDate: item?.pubDate || "",
        keywords: item?.keywords || [],
      })),
    });

    console.log(`SUCCESS! ${enrichedArticles.length} articles saved with rich Hindi summaries.`);
    return enrichedArticles;
  },
});