import { createAgent, createNetwork } from "@inngest/agent-kit";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { generateSEOTitleTool, generateDescriptionTool, generateHashtagsTool, generateTagsTool } from "../tools/news-agent.tools.js";

const newsAgent = createAgent({
    name: "News-Optimizer-Agent",
    description: "An AI agent that optimizes news articles for SEO and social media.",
    system: `You are an AI assistant specialized in news content optimization. You help create SEO-friendly titles, descriptions  hashtags, and tags.
    When asked to generate content, use the appropriate tool. Be concise and professional.`,
   model: {
    provider: "custom",
    model: "gemini-2.0-flash-exp",
    infer: async ({ messages }) => {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
      
      const lastMessage = messages[messages.length - 1];
      const result = await model.generateContent(lastMessage.content);
      const response = await result.response;
      
      return {
        choices: [{
          message: {
            role: "assistant",
            content: response.text()
          }
        }]
      };
    }
    },
    tools: [
        generateSEOTitleTool,
        generateDescriptionTool,
        generateHashtagsTool,
        generateTagsTool
    ]
})

const adAgent = createAgent({
  name: "Ad-Maker-Agent"
})

export {newsAgent}

