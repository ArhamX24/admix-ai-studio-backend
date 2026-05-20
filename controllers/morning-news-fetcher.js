import dotenv from "dotenv";
dotenv.config();
import { runs, tasks } from "@trigger.dev/sdk/v3";
import OpenAI from "openai";
import prisma from "../DB/prisma.client.js";

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

// ────────────────────────────────────────────────────────────────
// GET /get-morning-news  — fetch (or trigger) news list
// ────────────────────────────────────────────────────────────────
const getMorningNews = async (req, res) => {
  try {
    const { category, forceRefresh = false } = req?.body;

    if (!category) {
      return res.status(400).json({ error: "Category is required." });
    }

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    if (forceRefresh) {
      await prisma.morningAiNewsFetch.deleteMany({ where: { category } });
    } else {
      const existingNews = await prisma.morningAiNewsFetch.findMany({
        where: {
          category,
          createdAt: { gte: twentyFourHoursAgo },
        },
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

   // Trigger fresh fetch
    const result = await tasks.trigger("morning-news-fetcher", { category });
    let run = await runs.retrieve(result.id);

    while (!run.isCompleted) {
      await new Promise((r) => setTimeout(r, 1000));
      run = await runs.retrieve(result.id);
    }

    if (run.status === "FAILED" || run.status === "CANCELED") {
      throw new Error("AI Agent failed to generate news. Please try again.");
    }

    // THE FIX: Instead of returning run.output, fetch the newly saved items from the DB
    // so they have the proper Prisma UUIDs attached!
    const newlySavedNews = await prisma.morningAiNewsFetch.findMany({
      where: {
        category,
        createdAt: { gte: twentyFourHoursAgo },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return res.status(200).json({
      success: true,
      message: `Successfully generated fresh ${category} news!`,
      data: newlySavedNews, // <--- Returns properly formatted DB rows
    });
    
  } catch (error) {

    return res.status(500).json({ success: false, message: error.message });
  }
};

// ────────────────────────────────────────────────────────────────
// POST /generate-article-script
// Body: { articleId: string }
// Called when user clicks "Select for Script" on the frontend.
// Scrapes the article, generates a 500-600 word Hindi news script,
// saves it back to the DB row, and returns it.
// ────────────────────────────────────────────────────────────────
const generateArticleSummary = async (req, res) => {
  try {
    const { articleId } = req.body;

    if (!articleId) {
      return res.status(400).json({ success: false, message: "articleId is required." });
    }

    // ── Fetch the article from DB ──────────────────────────────
    const article = await prisma.morningAiNewsFetch.findUnique({
      where: { id: articleId },
    });

    if (!article) {
      return res.status(404).json({ success: false, message: "Article not found." });
    }

    // ── If script already generated, return it immediately ─────
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


    // ── Generate Hindi news script ─────────────────────────────
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



    // ── Persist generated script back to DB ───────────────────
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