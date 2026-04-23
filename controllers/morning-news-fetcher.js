import { runs, tasks } from "@trigger.dev/sdk/v3";
import prisma from "../DB/prisma.client.js";

const getMorningNewsTester = async (req,res) => {
    try {
        let apiRes = await fetch(`https://newsdata.io/api/1/latest?apikey=pub_6663e58741e84b56802645bcdfcd8589&q="education"&language=hi&country=in`);

        let finalData = ''
     
        if(apiRes.ok){
            finalData = await apiRes.json()
        }

        let allCategories = finalData.results.flatMap(article => article.category);
        let sortedCategories = new Set(allCategories)

        let onlyCategories = [...sortedCategories];

        let allKeywords = finalData.results.flatMap(article => article.keywords);
        let sortedKeywords = new Set(allKeywords)

        let onlyKeywords = [...sortedKeywords]


        return res.json({status:true, data: finalData})

    } catch (error) {
        console.error(error)
    }
}

const getMorningNews = async (req,res) => {
   try {
    const { category, forceRefresh = false } = req?.body;
 
    if (!category) {
      return res.status(400).json({ error: "Category is required." });
    }
 
    // ✅ Rolling 24-hour window instead of "since midnight today"
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
 
    if (!forceRefresh) {
      const existingNews = await prisma.morningAiNewsFetch.findMany({
        where: {
          category: category,
          createdAt: {
            gte: twentyFourHoursAgo,  // only news from last 24 hours
          },
        },
        orderBy: { createdAt: "desc" },
        take: 25,
      });
 
      if (existingNews.length > 0) {
        return res.status(200).json({
          success: true,
          message: `Fetched existing ${category} news from database!`,
          data: existingNews,
        });
      }
    }
 
    // No recent news found (or forceRefresh) — trigger AI fetch
    const result = await tasks.trigger("morning-news-fetcher", { category });
    let run = await runs.retrieve(result.id);
 
    while (!run.isCompleted) {
      await new Promise((res) => setTimeout(res, 1000));
      run = await runs.retrieve(result.id);
    }
 
    if (run.status === "FAILED" || run.status === "CANCELED") {
      throw new Error("AI Agent failed to generate news. Please try again.");
    }
 
    return res.status(200).json({
      success: true,
      message: `Successfully generated fresh ${category} news!`,
      data: run.output,
    });
  } catch (error) {
    console.error("Error in getMorningNews:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

export{getMorningNews, getMorningNewsTester}