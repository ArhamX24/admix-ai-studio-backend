import { task } from "@trigger.dev/sdk/v3";
import OpenAI from "openai";
import prisma from "../../DB/prisma.client";

export const fetchNewsTask = task({
  id: "morning-news-fetcher",
  retry: { maxAttempts: 1 },

  run: async (payload) => {
    const { category } = payload;

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

    const articlesToProcess = allResults.slice(0, 10);

    const groq = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
    });

    const categoryToneMap = {
      top: "सबसे बड़ी और जरूरी राष्ट्रीय/अंतरराष्ट्रीय खबरें जो हर भारतीय को जाननी चाहिए",
      crime: "सबसे चौंकाने वाली, हाई-प्रोफाइल और जनहित से जुड़ी crime खबरें",
      education: "छात्रों, अभिभावकों और शिक्षकों के लिए सबसे जरूरी और impactful education खबरें",
      business: "बाजार, economy, jobs और आम आदमी की जेब पर असर डालने वाली business खबरें",
      lifestyle: "health, wellness, trending और आम जीवन से सीधे जुड़ी lifestyle खबरें",
    };

    const categoryTone = categoryToneMap[category] || `${category} से जुड़ी सबसे impactful खबरें`;

    const prompt = `
आप एक भारतीय हिंदी न्यूज़ चैनल के सीनियर न्यूज़ एडिटर हैं।

नीचे दी गई raw news articles में से सबसे बेहतरीन 10-15 खबरें चुनें।

Category focus: ${categoryTone}

चुनाव के मापदंड:
1. IMPACT: आम भारतीय की ज़िंदगी पर असर
2. UNIQUENESS: अलग और चौंकाने वाली — duplicates बिल्कुल न लें
3. VIRAL POTENTIAL: शेयर होने लायक
4. FRESHNESS: latest और breaking को प्राथमिकता

hindiSummary: 2-3 crisp वाक्य, professional broadcast Hindi, key facts शामिल करें

Return ONLY valid JSON, no markdown, no backticks:
{
  "articles": [
    {
      "title": "Original title",
      "hindiSummary": "2-3 वाक्य का summary",
      "description": "Original description",
      "link": "Original link",
      "image_url": "Original image_url or null",
      "source_name": "Original source_name",
      "source_url": "Original source_url",
      "category": "${category}",
      "pubDate": "Original pubDate",
      "keywords": ["keywords"]
    }
  ]
}

Raw News (${articlesToProcess.length} articles):
${JSON.stringify(articlesToProcess)}
`;

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a senior Hindi news editor. Output ONLY valid JSON. No markdown, no backticks.",
        },
        { role: "user", content: prompt },
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.2,
      response_format: { type: "json_object" },
    });

    const aiText = completion.choices[0].message.content;
    const parsedResponse = JSON.parse(aiText);
    const finalNewsArray = parsedResponse.articles;

    if (!finalNewsArray || finalNewsArray.length === 0) {
      throw new Error("AI returned empty articles array");
    }

    await prisma.morningAiNewsFetch.createMany({
      data: finalNewsArray.map((item) => ({
        title: item?.title || "",
        hindiSummary: item?.hindiSummary || "",
        description: item?.description || "",
        link: item?.link || "",
        image_url: item?.image_url || "",
        source_name: item?.source_name || "",
        source_url: item?.source_url || "",
        category: item?.category || "",
        pubDate: item?.pubDate || "",
        keywords: item?.keywords || [],
      })),
    });

    console.log(`SUCCESS! ${finalNewsArray.length} articles saved to DB.`);
    return finalNewsArray;
  },
});