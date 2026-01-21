import { createTool} from "@inngest/agent-kit";
import { z } from "zod" 
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAi = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

const detectLanguage = (text) => {
  const hindiRegex = /[\u0900-\u097F]/;
  return hindiRegex.test(text) ? "hin" : "eng";
};

const generateSEOTitleTool = createTool({
    name: "generateSEOTitle",
    description: "Generate an SEO Friendly title (Max 60 Characters) for a news article",
    parameters:z.object({
        articleText: z.string()
    }) ,
    handler: async ({input, step}) => {
        
        const language = detectLanguage(input.articleText);
        const languageInstruction = language === 'hin' 
        ? "\n\nआपको हिंदी में जवाब देना है। केवल हिंदी में लिखें।" 
        : "\n\nRespond in English only.";
        
        const model = genAi.getGenerativeModel({model: "gemini-2.0-flash-exp"})
        const prompt = `You are an expert SEO copywriter. Write a compelling, SEO-friendly title (60 characters or less) for this article. Return ONLY the title text.\n\nArticle:\n"""${input.articleText}"""${languageInstruction}`;

        const result = await model.generateContent(prompt)
        const response = await result.response

        return response.text.trim();
    }
});

const generateDescriptionTool = createTool({
  name: "generate_description",
  description: "Generates a meta description (140-160 chars) for a news article.",
  parameters: z.object({
    articleText: z.string(),
  }),
  handler: async ({ input }) => {
    const language = detectLanguage(input.articleText);
    const languageInstruction = language === 'hin' 
      ? "\n\nआपको हिंदी में जवाब देना है।" 
      : "\n\nRespond in English only.";

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    const prompt = `You are an SEO copywriter. Write a compelling meta description (140-160 characters) for this article. Return ONLY the description.\n\nArticle:\n"""${input.articleText}"""${languageInstruction}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  },
});

const generateHashtagsTool = createTool({
  name: "generate_hashtags",
  description: "Generates 5-8 relevant hashtags for a news article.",
  parameters: z.object({
    articleText: z.string(),
  }),
  handler: async ({ input }) => {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    const prompt = `You are a social media expert. Generate 5-8 relevant hashtags for this article, separated by spaces. Return ONLY the hashtags.\n\nArticle:\n"""${input.articleText}"""`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  },
});

const generateTagsTool = createTool({
  name: "generate_tags",
  description: "Generates 5-10 comma-separated keywords/tags for a news article.",
  parameters: z.object({
    articleText: z.string(),
  }),
  handler: async ({ input }) => {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    const prompt = `You are a content analyst. Generate 5-10 relevant keywords/tags for this article, separated by commas. Return ONLY the tags.\n\nArticle:\n"""${input.articleText}"""`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  },
});

export {generateSEOTitleTool, generateDescriptionTool, generateHashtagsTool, generateTagsTool}