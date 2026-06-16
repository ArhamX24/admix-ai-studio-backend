import dotenv from "dotenv";
dotenv.config();
import OpenAI from "openai";
import prisma from "../DB/prisma.client.js";

// ── Trusted sources ──────────────────────────────────────────────
const TRUSTED_SOURCES = new Set([
  "bhaskar", "news36live", "news 18 hindi", "hindustan", "aaj tak",
  "ndtv", "zee news", "abp news", "navbharat live", "jagran",
  "news nation", "india tv", "times now navbharat",
]);

// ── Safe JSON extractor ──────────────────────────────────────────
const extractJSON = (rawText) => {
  try { return JSON.parse(rawText); } catch (e) {}
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON found. Raw: ${rawText.slice(0, 200)}`);
  let jsonString = match[0];
  jsonString = jsonString.replace(
    /"((?:[^"\\]|\\.)*)"/g,
    (m) => m.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")
  );
  try { return JSON.parse(jsonString); } catch (e) {}
  const cleaned = jsonString.replace(/[\x00-\x1F\x7F]/g, (c) => {
    if (c === "\n") return "\\n";
    if (c === "\r") return "\\r";
    if (c === "\t") return "\\t";
    return "";
  });
  try { return JSON.parse(cleaned); } catch (e) {}
  throw new Error(`Failed to parse JSON. Raw: ${rawText.slice(0, 200)}`);
};

// ── Scrape article text ──────────────────────────────────────────
const scrapeArticle = async (url) => {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "hi-IN,hi;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();

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
    const source = articleMatch?.[0] || mainMatch?.[0] || cleaned;

    const text = source
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();

    return text.length > 200 ? text.slice(0, 4000) : null;
  } catch (e) {
    return null;
  }
};

// ── Core fetch logic ─────────────────────────────────────────────
const fetchAndSaveNews = async (category, forceRefresh = false) => {
  const API_KEY = process.env.NEWSDATA_IO_API_KEY;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  if (!forceRefresh) {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentCount = await prisma.morningAiNewsFetch.count({
      where: { category, createdAt: { gte: twentyFourHoursAgo } },
    });
    if (recentCount > 0) {
      console.log(`[FETCH] Fresh news already exists for "${category}". Skipping.`);
      return [];
    }
  } else {
    console.log(`[FETCH] Force refresh triggered for "${category}". Bypassing time lock.`);
  }

  // Load existing links AND titles from DB to ensure 100% unique news
  const existingRecords = await prisma.morningAiNewsFetch.findMany({
    where: { category },
    select: { link: true, title: true },
  });
  const existingLinks = new Set(existingRecords.map((r) => r.link));
  const existingTitles = new Set(existingRecords.map((r) => (r.title || "").trim().toLowerCase()));

  const BASE_URL =
    `https://newsdata.io/api/1/latest` +
    `?apikey=${API_KEY}` +
    `&q=${encodeURIComponent(category)}` +
    `&language=hi` +
    `&country=in` +
    `&removeduplicate=1`;

  const MAX_PAGES = 20;
  const TARGET_NEW_ARTICLES = 40;

  let allResults = [];
  let nextPage = null;
  let pageCount = 0;

  do {
    const pageUrl = nextPage ? `${BASE_URL}&page=${nextPage}` : BASE_URL;

    try {
      const res = await fetch(pageUrl);
      if (!res.ok) throw new Error(`newsdata.io HTTP ${res.status}`);
      const data = await res.json();
      if (data.status !== "success") throw new Error(`newsdata.io error: ${JSON.stringify(data)}`);
      if (!data.results?.length) break;

      // ✅ STRICT FILTERING: Only accept articles that are BOTH Trusted AND Unique
      const freshTrusted = data.results.filter((a) => {
        // 1. Check if source is trusted
        const isTrusted = a.source_name && TRUSTED_SOURCES.has(a.source_name.toLowerCase().trim()) && !a.duplicate;
        if (!isTrusted) return false;

        // 2. Check if it's unique against the database
        const titleMatch = (a.title || "").trim().toLowerCase();
        const isUnique = !existingLinks.has(a.link) && !existingTitles.has(titleMatch);
        
        return isUnique;
      });
      
      allResults.push(...freshTrusted);

      nextPage = data.nextPage || null;
      pageCount++;

      if (allResults.length >= TARGET_NEW_ARTICLES) {
        console.log(`[FETCH] Found ${allResults.length} fresh trusted articles. Stopping early.`);
        break;
      }
    } catch (e) {
      console.error(`[FETCH] Page error:`, e.message);
      break;
    }

    if (nextPage && pageCount < MAX_PAGES) await sleep(300);
  } while (nextPage && pageCount < MAX_PAGES);

  // Local deduplication inside the current batch (in case API returns duplicates across pages)
  const seenLocally = new Set();
  const finalArticles = allResults.filter((a) => {
    const key = a.article_id || a.link;
    if (!key || seenLocally.has(key)) return false;
    seenLocally.add(key);
    return true;
  });

  // ✅ STRICT REQUIREMENT: If no trusted sources found, return empty array.
  // The controller will then just return the original existing DB records.
  if (finalArticles.length === 0) {
    console.log(`[FETCH] No new unique articles from TRUSTED SOURCES found for "${category}". Retaining existing.`);
    return [];
  }

  // Build save list
  const toSave = [];
  const seenLink = new Set();

  for (const item of finalArticles) {
    if (seenLink.has(item.link)) continue;
    seenLink.add(item.link);

    toSave.push({
      title: item.title || "",
      hindiSummary: "",
      description: (item.description || "").slice(0, 1000),
      link: item.link || "",
      image_url: item.image_url || "",
      source_name: item.source_name || "",
      source_url: item.source_url || "",
      category,
      pubDate: item.pubDate || "",
      keywords: item.keywords || [],
    });
  }

  console.log(`[FETCH] Saving ${toSave.length} brand new unique trusted articles to DB.`);
  await prisma.morningAiNewsFetch.createMany({
    data: toSave,
    skipDuplicates: true,
  });

  return toSave;
};

// ── In-memory lock map (prevents concurrent fetches per category) ─
const inFlightFetches = new Map();

// ── getMorningNews controller ────────────────────────────────────
const getMorningNews = async (req, res) => {
  try {
    const { category, forceRefresh = false } = req?.body || {};
    if (!category) return res.status(400).json({ error: "Category is required." });

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // 1. Return cached DB data unless forceRefresh
    if (!forceRefresh) {
      const existingNews = await prisma.morningAiNewsFetch.findMany({
        where: { category, createdAt: { gte: twentyFourHoursAgo } },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      if (existingNews.length > 0) {
        return res.status(200).json({
          success: true,
          message: `Fetched existing ${category} news from database!`,
          data: existingNews,
        });
      }
    }

    // 2. Lock mechanism for fetching
    if (!inFlightFetches.has(category)) {
      // ✅ FIX 5: Pass forceRefresh to fetchAndSaveNews
      const fetchPromise = fetchAndSaveNews(category, forceRefresh).finally(() => {
        inFlightFetches.delete(category);
      });
      inFlightFetches.set(category, fetchPromise);
    } else {
      console.log(`[LOCK] Attaching to in-flight fetch for "${category}"`);
    }

    await inFlightFetches.get(category);

    // 3. Read back from DB so all callers get consistent, full records
    // This will now include the freshly fetched records, sorted by newest
    const freshNews = await prisma.morningAiNewsFetch.findMany({
      where: { category, createdAt: { gte: twentyFourHoursAgo } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return res.status(200).json({
      success: true,
      message: forceRefresh 
        ? `Successfully checked for new unique ${category} news!` 
        : `Fetched ${category} news successfully!`,
      data: freshNews,
    });
  } catch (error) {
    console.error("Error in getMorningNews:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ── generateArticleSummary controller ───────────────────────────
const generateArticleSummary = async (req, res) => {
  // ... (Keep your exact code for this function, no changes needed here) ...
  try {
    const { articleId } = req.body;

    if (!articleId) {
      return res.status(400).json({ success: false, message: "articleId is required." });
    }

    const article = await prisma.morningAiNewsFetch.findUnique({
      where: { id: articleId },
    });

    console.log(article);

    if (!article) {
      return res.status(404).json({ success: false, message: "Article not found." });
    }

    if (article.hindiSummary && article.hindiSummary.trim().length > 100) {
      return res.status(200).json({
        success: true,
        cached: true,
        message: "Script already generated.",
        data: {
          id: article.id,
          hindiSummary: article.hindiSummary,
          title: article.title,
        },
      });
    }

    const fullText = await scrapeArticle(article.link);

    const sourceMaterial = fullText
      ? `Title: ${article.title}\n\nFull Article:\n${fullText}`
      : `Title: ${article.title}\n\nDescription: ${article.description || "No description available."}`;

    const openRouter = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });

    const completion = await openRouter.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a senior Hindi TV news anchor-writer. Write a 500-600 word Hindi news script that will be read on-air by a news anchor.

OUTPUT: Raw JSON only. No markdown. No backticks.
Schema: { "hindiSummary": "string" }

SCRIPT RULES:
- Length: EXACTLY 500-600 words. Count carefully.
- Tone: Professional broadcast Hindi — clear, authoritative, engaging. Simple words for mass audience.
- Structure (follow exactly):
  1. Opening hook — grab attention in 1-2 powerful sentences (Breaking or "आज की बड़ी खबर" style)
  2. What happened — core news clearly in 3-4 sentences
  3. Who is involved — key people, organizations, places
  4. Why it matters — background and reason
  5. How it happened — sequence of events with details
  6. Impact on common people — practical effect on society/economy/daily life
  7. What happens next — expected outcomes, reactions, next steps
  8. Closing line — wrap up with a forward-looking or impactful statement
- Include ALL important facts, names, numbers from the source.
- Do NOT invent information — only use what is in the source.
- No repetition — every paragraph adds new information.
- Write as if the anchor is speaking directly to the viewer.`,
        },
        {
          role: "user",
          content: `Write a 500-600 word Hindi TV news anchor script for this article.

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

    const parsed = extractJSON(completion.choices[0].message.content);
    const hindiSummary = parsed.hindiSummary || article.description || "";
    const wordCount = hindiSummary.trim().split(/\s+/).length;

    const updated = await prisma.morningAiNewsFetch.update({
      where: { id: articleId },
      data: { hindiSummary },
    });

    return res.status(200).json({
      success: true,
      cached: false,
      message: `Script generated (${wordCount} words).`,
      data: {
        id: updated.id,
        hindiSummary: updated.hindiSummary,
        title: updated.title,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};


// ── Dev/test endpoint (unchanged) ────────────────────────────────
const getMorningNewsTester = async (req, res) => {
  try {
    const API_KEY = process.env.NEWSDATA_IO_API_KEY || "pub_6663e58741e84b56802645bcdfcd8589";
    const TRUSTED_DOMAINS = [
      "bhaskar.com","news36live.com","news18.com","livehindustan.com",
      "aajtak.in","ndtv.com","zeenews.india.com","abplive.com",
      "navbharatlive.com","jagran.com","newsnation.in","indiatv.in","timesnowhindi.com",
    ].join(",");

    const BASE_URL =
      `https://newsdata.io/api/1/latest?apikey=${API_KEY}` +
      `&language=hi&country=in&domainurl=${encodeURIComponent(TRUSTED_DOMAINS)}`;

    const MAX_PAGES = 20;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const firstRes = await fetch(BASE_URL);
    if (!firstRes.ok) throw new Error(`API error: ${firstRes.status}`);
    const firstData = await firstRes.json();

    if (firstData.status !== "success" || !firstData.results?.length) {
      return res.json({ status: true, total: 0, data: [] });
    }

    let allResults = [...firstData.results];
    let nextPage = firstData.nextPage;
    let pageCount = 1;

    while (nextPage && pageCount < MAX_PAGES) {
      await sleep(300);
      const pageRes = await fetch(`${BASE_URL}&page=${nextPage}`);
      if (!pageRes.ok) { console.warn(`Page failed ${pageRes.status}`); break; }
      const pageData = await pageRes.json();
      if (pageData.status === "error" || !pageData.results?.length) break;
      allResults.push(...pageData.results);
      nextPage = pageData.nextPage || null;
      pageCount++;
    }

    const seen = new Set();
    const unique = allResults.filter((a) => {
      if (!a.article_id || seen.has(a.article_id)) return false;
      seen.add(a.article_id); return true;
    });

    return res.json({
      status: true,
      pages_fetched: pageCount,
      raw_count: allResults.length,
      unique_count: unique.length,
      data: unique,
    });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};

export { getMorningNews, getMorningNewsTester, generateArticleSummary };