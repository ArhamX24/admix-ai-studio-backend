import prisma from "../../DB/prisma.client.js";
import inngest from "../client/client.js";
import { GoogleGenerativeAI } from "@google/generative-ai";


const genAi = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

const detectLanguage = (text) => {
  const hindiRegex = /[\u0900-\u097F]/;
  return hindiRegex.test(text) ? "hin" : "eng";
};

const cleanContent = (text) => {
  return  text.replace(/\\n\\n/g, '\n\n')     
              .replace(/\\n/g, '\n')          
              .replace(/\\t/g, '  ')        
              .replace(/\\\\/g, '\\')        
              .replace(/\\"/g, '"')      
              .trim();
}


const newsOptimizerFunction = inngest.createFunction(
  { id: "news-optimizer" },
  { event: "news/optimize" },
  async ({ event, step }) => {
    const { userMessage, quickAction, userId = '0b6020a7-d7ed-4812-9ac1-1f47a88f14be'} = event.data;
    const runId = event.id

    // Step 1: Create database record with "processing" status
    const initialRecord = await step.run("create-db-record", async () => {
      return await prisma.generatedContent.create({
        data: {
          runId: runId,  // Store the run ID!
          userId: userId || "",
          inputText: userMessage,
          generatedText: "",
          contentType: quickAction || 'custom',
          language: "eng", // Will update later
          status: "PROCESSING"
        }
      });
    });

    // Step 2: Detect language
    const language = await step.run("detect-language", async () => {
      return detectLanguage(userMessage);
    });

    // Step 3: Generate content
    const result = await step.run("generate-content", async () => {
      const languageInstruction = language === 'hin' 
        ? "\n\nआपको हिंदी में जवाब देना है। केवल हिंदी में लिखें।" 
        : "\n\nRespond in English only.";

      let prompt;
      
      if (quickAction === 'title') {
        prompt = `You are an expert SEO copywriter. 

Generate an SEO-friendly title (60 characters or less) for the article below.

IMPORTANT: Start your response with "Here's an SEO-friendly title for your article:" followed by the title.
          - Do NOT use \\n or line break characters in your response.
          - Write naturally with actual spacing.

IMPORTANT FORMATTING RULES:
    - Do NOT use markdown formatting (no *, **, -, #, etc.)
    - Write in plain text paragraphs
    - Use simple numbered lists if needed (1., 2., 3.)
    - Be clear and concise

Article:
"""${userMessage}"""${languageInstruction}`;

      } else if (quickAction === 'description') {
        prompt = `You are an SEO copywriter. 

      Generate a compelling meta description (140-160 characters) for the article below.

      IMPORTANT: Start your response with "Here's a meta description for your article:" followed by the description.
                - Do NOT use \\n or line break characters in your response.
                - Write naturally with actual spacing.

      IMPORTANT FORMATTING RULES:
    - Do NOT use markdown formatting (no *, **, -, #, etc.)
    - Write in plain text paragraphs
    - Use simple numbered lists if needed (1., 2., 3.)
    - Be clear and concise

      Article:
      """${userMessage}"""${languageInstruction}`;

            } else if (quickAction === 'hashtags') {
              prompt = `You are a social media expert. 

      Generate 5-8 relevant hashtags for the article below.

      IMPORTANT: Start your response with "Here are relevant hashtags for your article:" followed by the hashtags separated by spaces.
          - Do NOT use \\n or line break characters in your response.
          - Write naturally with actual spacing.

      IMPORTANT FORMATTING RULES:
    - Do NOT use markdown formatting (no *, **, -, #, etc.)
    - Write in plain text paragraphs
    - Use simple numbered lists if needed (1., 2., 3.)
    - Be clear and concise

      Article:
      """${userMessage}"""`;

            } else if (quickAction === 'tags') {
              prompt = `You are a content analyst. 

      Generate 5-10 relevant keywords/tags for the article below.

      IMPORTANT: Start your response with "Here are the tags for your article:" followed by the tags separated by commas.
                - Do NOT use \\n or line break characters in your response.
                - Write naturally with actual spacing.

      IMPORTANT FORMATTING RULES:
    - Do NOT use markdown formatting (no *, **, -, #, etc.)
    - Write in plain text paragraphs
    - Use simple numbered lists if needed (1., 2., 3.)
    - Be clear and concise

      Article:
      """${userMessage}"""`;

            } else {
              prompt = `You are an AI assistant specialized in news content optimization and analysis.

      When responding:
      1. Start with a friendly introduction like "Sure!", "Here's what you asked for:", etc.
      2. Clearly label what you're providing
      3. Use plain text without markdown formatting
      4. Be helpful and conversational
          - Do NOT use \\n or line break characters in your response.
          - Write naturally with actual spacing.

      IMPORTANT FORMATTING RULES:
    - Do NOT use markdown formatting (no *, **, -, #, etc.)
    - Write in plain text paragraphs
    - Use simple numbered lists if needed (1., 2., 3.)
    - Be clear and concise

      User Request: ${userMessage}${languageInstruction}`;
      }

      const model = genAi.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
      const geminiResult = await model.generateContent(prompt);
      const response = await geminiResult.response;
      const rawText =  response.text().trim();
      return cleanContent(rawText)
    });

    // Step 4: Update database record with result
    const updatedRecord = await step.run("update-db-record", async () => {
      return await prisma.generatedContent.update({
        where: { id: initialRecord.id },
        data: {
          generatedText: result,
          language: language,
          status: "COMPLETED"
        }
      });
    });

    return { 
      success: true, 
      result, 
      recordId: updatedRecord.id,
      language 
    };
  }
);


export {newsOptimizerFunction}