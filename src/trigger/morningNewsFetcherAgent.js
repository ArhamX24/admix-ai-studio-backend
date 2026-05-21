import dotenv from "dotenv";
dotenv.config();
import { task , queue} from "@trigger.dev/sdk/v3";
import prisma from "../../DB/prisma.client";

const TRUSTED_SOURCES = new Set([
  "bhaskar", "news36live", "news 18 hindi", "hindustan", "aaj tak",
  "ndtv", "zee news", "abp news", "navbharat live", "jagran",
  "news nation", "india tv", "times now navbharat",
]);

const newsFetchQueue = queue({
  name: "news-fetch-queue",
  concurrencyLimit: 1,
});

const fetchPage = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`newsdata.io HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== "success") throw new Error(`newsdata.io error: ${JSON.stringify(data)}`);
  return data;
};

export const fetchNewsTask = task({
  id: "morning-news-fetcher",
  retry: { maxAttempts: 1 },
  queue: newsFetchQueue,

  run: async (payload) => {
    const { category } = payload;

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentCount = await prisma.morningAiNewsFetch.count({
      where: { category, createdAt: { gte: twentyFourHoursAgo } },
    });
    if (recentCount > 0) {
      console.log(`[TASK] Fresh news already exists for "${category}". Skipping.`);
      return [];
    }

    const API_KEY = process.env.NEWSDATA_IO_API_KEY;

    // ── 1. LOAD DB MEMORY ──────────────────────────────────────────
    // Get all links we have previously saved for this category
    const existingRecords = await prisma.morningAiNewsFetch.findMany({
      where: { category },
      select: { link: true },
    });
    const existingLinks = new Set(existingRecords.map((r) => r.link));

    const BASE_URL =
      `https://newsdata.io/api/1/latest` +
      `?apikey=${API_KEY}` +
      `&q=${encodeURIComponent(category)}` +
      `&language=hi` +
      `&country=in` +
      `&removeduplicate=1`;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    let allResults = [];
    let nextPage = null;
    let pageCount = 0;
    let newTrustedCount = 0; // Track how many BRAND NEW trusted articles we find
    
    const MAX_PAGES = 20;
    const TARGET_NEW_ARTICLES = 40; // Stop paginating if we hit this number (saves API credits)

    // ── 2. PAGINATE & FILTER ───────────────────────────────────────
    do {
      const pageUrl = nextPage ? `${BASE_URL}&page=${nextPage}` : BASE_URL;

      try {
        const data = await fetchPage(pageUrl);
        if (!data.results?.length) break;

        // Instantly throw away articles that are already in our database
        const freshResults = data.results.filter((a) => !existingLinks.has(a.link));
        
        allResults.push(...freshResults);

        // Check how many trusted sources are in this fresh batch
        const freshTrusted = freshResults.filter(
          (a) => a.source_name && TRUSTED_SOURCES.has(a.source_name.toLowerCase().trim()) && !a.duplicate
        );
        newTrustedCount += freshTrusted.length;

        nextPage = data.nextPage || null;
        pageCount++;

        // SMART STOP: If we found enough brand new articles, stop making API calls
        if (newTrustedCount >= TARGET_NEW_ARTICLES) {
          console.log(`Found ${newTrustedCount} fresh trusted articles. Stopping early.`);
          break;
        }
      } catch (e) {
        break;
      }

      if (nextPage && pageCount < MAX_PAGES) await sleep(300);
    } while (nextPage && pageCount < MAX_PAGES);

    // ── 3. LOCAL DEDUPLICATION ─────────────────────────────────────
    const seenLocally = new Set();
    const unique = allResults.filter((a) => {
      const key = a.article_id || a.link;
      if (!key || seenLocally.has(key)) return false;
      seenLocally.add(key);
      return true;
    });

    const trusted = unique.filter(
      (a) => a.source_name && TRUSTED_SOURCES.has(a.source_name.toLowerCase().trim()) && !a.duplicate
    );

    const finalArticles = trusted.length > 0 ? trusted : unique;

    // If there is literally NO new news on the internet, return empty array safely
    if (finalArticles.length === 0) {
      return [];
    }

    // ── 4. SAVE TO DB ──────────────────────────────────────────────
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
        category: category, 
        pubDate: item.pubDate || "",
        keywords: item.keywords || [],
      });
    }

    await prisma.morningAiNewsFetch.createMany({
      data: toSave,
      skipDuplicates: true,
    });

    // Return the newly inserted rows to the controller
    return toSave;
  },
});