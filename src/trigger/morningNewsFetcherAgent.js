import { task } from "@trigger.dev/sdk/v3";
import OpenAI from "openai"; 
import prisma from "../../DB/prisma.client";

export const fetchNewsTask = task({
    id: "morning-news-fetcher",

    retry: {
        maxAttempts: 3
    },

    run: async (payload) => {
        const { category } = payload;

        const url = `https://newsdata.io/api/1/latest?apikey=${process.env.NEWSDATA_IO_API_KEY}&q=${category}&language=hi&country=in`;
        const res = await fetch(url);
        const newsData = await res.json();

        if(!newsData.results || newsData.results.length === 0){
            throw new Error(`No news found for category: ${category}`);
        }

        const groq = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            baseURL: "https://api.groq.com/openai/v1"
        });

        const prompt = `
        You are an expert news editor for an Indian news channel. 
        Review the following raw Hindi news articles about ${category}. 
        Select the 10 most impactful, unique, and highly relevant stories. Discard duplicates.
        Rewrite their summaries into crisp, professional Hindi suitable for a broadcast channel.
        
        Return ONLY a valid JSON object. Do not include markdown formatting or extra text.
        Extract the exact links, image URLs, and source details from the raw data. Do not invent them.
        Format the object exactly like this:
        {
            "articles": [
                {
                    "title": "Original title",
                    "hindiSummary": "Your professional Hindi summary",
                    "description": "Original description from raw data",
                    "link": "Original article link",
                    "image_url": "Original image_url (or null if not provided)",
                    "source_name": "Original source_name",
                    "source_url": "Original source_url",
                    "category": "${category}",
                    "pubDate": "Original pubDate",
                    "keywords": ["array", "of", "keywords", "from", "raw", "data"]
                }
            ]
        }

        Raw News Data:
        ${JSON.stringify(newsData.results)}
        `;

        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: "You are a helpful assistant that strictly outputs valid JSON."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.2, 
            response_format: { type: "json_object" } 
        });

        let aiText = completion.choices[0].message.content;

        const parsedResponse = JSON.parse(aiText);

        const finalNewsArray = parsedResponse.articles;

        await prisma.morningAiNewsFetch.createMany({
            data: finalNewsArray.map((item) => ({
                title: item?.title || "",
                hindiSummary: item?.hindiSummary || "",
                description: item?.description || "",
                link : item?.link || "",
                image_url: item?.image_url || "",
                source_name: item?.source_name || "",
                source_url: item?.source_url || "",
                category: item?.category || "",
                pubDate: item?.pubDate || "", 
                keywords: item?.keywords || []
            }))
        });

        console.log("SUCCESS! Top articles fetched and saved to DB.");
        
        return finalNewsArray;
    }
});