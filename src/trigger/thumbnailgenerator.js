import dotenv from "dotenv";
dotenv.config();
import { task } from "@trigger.dev/sdk/v3";
import OpenAI from "openai";

// ── OpenAI direct client for DALL-E (NOT OpenRouter) ────────────
const getOpenAIClient = () =>
  new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

// ── Helper: build prompt from script ────────────────────────────
const buildThumbnailPrompt = (anchor, voiceOver, scriptType, userInstruction = null) => {
  const scriptContent =
    scriptType === "short"
      ? `Script: ${anchor}`
      : `Anchor: ${anchor}\n\nVoice Over: ${voiceOver}`;

  const baseInstruction = userInstruction
    ? `User wants this change: "${userInstruction}"\n\nBased on this script content:\n${scriptContent}`
    : scriptContent;

  return `Create a YouTube news thumbnail image in 1:1 square format (1024x1024 pixels).

SCRIPT CONTEXT:
${baseInstruction}

THUMBNAIL DESIGN REQUIREMENTS:
- Style: Indian Hindi YouTube news thumbnail (like Aaj Tak, ABP News, NDTV India style)
- Layout: Bold, high-contrast, visually striking composition
- Color scheme: High contrast — use deep reds, saffron orange, electric blue, or dramatic yellows with dark overlays
- Background: Relevant photorealistic scene or subject matter from the news topic
- Visual elements: News breaking graphics, bold borders, attention-grabbing composition
- Mood: Urgent, dramatic, eye-catching — like a viral news reel thumbnail
- Quality: Photorealistic, cinematic lighting, professional news broadcast aesthetic
- NO text overlays, NO watermarks, NO logos, NO TV channel branding

The thumbnail should look like it belongs on a top Indian Hindi news YouTube channel. Make it dramatic, bold, and click-worthy with a powerful background scene.`;
};

// ── Task 1: Generate thumbnail ───────────────────────────────────
export const generateThumbnailTask = task({
  id: "generate-thumbnail",
  retry: { maxAttempts: 2 },
  run: async (payload) => {
    const { anchor, voiceOver, scriptType } = payload;

    const openai = getOpenAIClient();
    const prompt = buildThumbnailPrompt(anchor, voiceOver, scriptType);

    console.log(`Generating thumbnail — scriptType: ${scriptType}`);

    // ✅ No response_format for image generation API
    const response = await openai.images.generate({
      model: "gpt-image-2",
      prompt,
      n: 1,
      size: "1024x1024",
      quality: "med",
    });

    const imageUrl = response.data[0]?.url;
    if (!imageUrl) {
      throw new Error("No image URL returned from DALL-E");
    }

    console.log(`Thumbnail generated successfully`);

    return {
      imageUrl,
      prompt,
      scriptType,
    };
  },
});

// ── Task 2: Refine thumbnail via chat ────────────────────────────
export const refineThumbnailTask = task({
  id: "refine-thumbnail",
  retry: { maxAttempts: 2 },
  run: async (payload) => {
    const { anchor, voiceOver, scriptType, userInstruction, previousPrompt } = payload;

    const openai = getOpenAIClient();

    const refinedPrompt = `${buildThumbnailPrompt(anchor, voiceOver, scriptType, userInstruction)}

IMPORTANT: This is a refined version. Previous design context: ${previousPrompt ? previousPrompt.slice(0, 300) : "N/A"}
Apply the user's specific change request while keeping all other thumbnail design rules intact.`;

    console.log(`Refining thumbnail — instruction: ${userInstruction}`);

    // ✅ No response_format for image generation API
    const response = await openai.images.generate({
      model: "gpt-image-2",
      prompt: refinedPrompt,
      n: 1,
      size: "1024x1024",
      quality: "medium",
    });

    const imageUrl = response.data[0]?.url;
    if (!imageUrl) {
      throw new Error("No image URL returned from DALL-E during refinement");
    }

    console.log(`Thumbnail refined successfully`);

    return {
      imageUrl,
      prompt: refinedPrompt,
      scriptType,
      changes: `Thumbnail updated: ${userInstruction}`,
    };
  },
});