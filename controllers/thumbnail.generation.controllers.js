import dotenv from "dotenv";
dotenv.config();
import OpenAI from "openai";
import { toFile } from "openai";
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs"; 

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const LOGO_MAP = {
  bbmix:   path.resolve(__dirname, "../Logos/BB MIX LOGO.png"),
  bbstory: path.resolve(__dirname, "../Logos/BB STORY LOGO.png"),
  pdnnews: path.resolve(__dirname, "../Logos/PDN NEWS LOGO.png"),
  storyfm: path.resolve(__dirname, "../Logos/STORY FM LOGO.png"),
  ycity:   path.resolve(__dirname, "../Logos/YCITY LOGO.png"),
};

const SIZE_MAP = {
  youtube: "1536x1024",
  reels:   "1024x1024",
};

const imageStore = new Map();

const storeImage = (buffer) => {
  const key = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  imageStore.set(key, { buffer, expiresAt: Date.now() + 60 * 60 * 1000 });
  for (const [k, v] of imageStore.entries()) {
    if (v.expiresAt < Date.now()) imageStore.delete(k);
  }
  return key;
};

const getStoredImage = (key) => {
  const entry = imageStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    imageStore.delete(key);
    return null;
  }
  return entry.buffer;
};

const overlayLogo = async (imageBuffer, channelName, thumbnailType) => {
  const logoPath = LOGO_MAP[channelName];
  if (!logoPath || !fs.existsSync(logoPath)) return imageBuffer;

  try {
    const circleSize = thumbnailType === "youtube" ? 110 : 90;
    const padding    = 10;
    const logoSize = Math.round(circleSize * 0.78);

    const logoBuffer = await sharp(logoPath)
      .trim()
      .resize(logoSize, logoSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const circleSvg = Buffer.from(
      `<svg width="${circleSize}" height="${circleSize}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${circleSize / 2}" cy="${circleSize / 2}" r="${circleSize / 2}" fill="white"/>
      </svg>`
    );

    const offset = Math.round((circleSize - logoSize) / 2);

    const badgeBuffer = await sharp(circleSvg)
      .png()
      .composite([{ input: logoBuffer, top: offset, left: offset, blend: "over" }])
      .toBuffer();

    const imgMeta   = await sharp(imageBuffer).metadata();
    const badgeTop  = padding;
    const badgeLeft = imgMeta.width - circleSize - padding;

    const finalBuffer = await sharp(imageBuffer)
      .composite([{ input: badgeBuffer, top: badgeTop, left: badgeLeft, blend: "over" }])
      .png()
      .toBuffer();

    return finalBuffer;
  } catch (err) {
    return imageBuffer;
  }
};


// ── Updated: Torn Paper + Red Highlight Prompting ──────────────────
const buildRichPrompt = async (title, anchor, thumbnailType, userInstruction = null, base64Image = null, mimeType = null) => {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  
  const layoutNote = thumbnailType === "youtube"
    ? "16:9 wide landscape (1536x1024) layout."
    : "1:1 square (1024x1024) layout.";

  const refineNote = userInstruction
    ? `\nCRITICAL USER INSTRUCTION: "${userInstruction}". Make sure to strongly emphasize this in the prompt.`
    : "";

  const systemMessage = `You are an elite Indian news graphic designer writing highly specific image generation prompts.

CRITICAL DESIGN MANDATE (Torn Paper & Red Highlights):
1. Layout: A large, expressive photorealistic subject/person dominating the frame.
2. TEXT BANNER: You MUST instruct the AI to use a "ripped white paper texture overlay" or "torn paper edge graphic" at the top or bottom for the text. 
3. TYPOGRAPHY & COLORS: The text must be placed inside the torn paper. Use bold Devanagari Hindi. You MUST explicitly instruct the generator to highlight the most shocking or important words in bright RED, while the rest of the text is thick BLACK. 
4. HEADLINE TEXT: You MUST use the exact provided NEWS TITLE for the text overlay. Put this text exactly in quotes (e.g., Text: "विवाह के बाद तलाक का सबसे बड़ा कारण").
5. The Vibe: Professional, high-end YouTube news thumbnail, highly clickable, striking contrast.
6. NO top-right corner graphics or text (leave it empty for a logo).

Output ONLY the raw image generation prompt. NO conversational text.`;

  const userContent = [
    {
      type: "text",
      text: `NEWS TITLE FOR OVERLAY: "${title}"\n\nNEWS CONTEXT:\n${anchor}\n${refineNote}\nFORMAT: ${layoutNote}\n\nTask: Write the exact prompt. Force the 'torn white paper' layout. Explicitly instruct the AI to render the headline text with the most important words in RED and the rest in BLACK.`
    }
  ];

  if (base64Image && mimeType) {
    userContent.push({
      type: "image_url",
      image_url: { url: `data:${mimeType};base64,${base64Image}` }
    });
    userContent[0].text += `\n\nI have attached a REFERENCE IMAGE. Analyze its structural layout (where the torn paper is, how the red/black text is formatted). Instruct the image generator to closely mimic this aesthetic.`;
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemMessage },
      { role: "user", content: userContent }
    ],
    max_tokens: 1500,
    temperature: 0.7,
  });

  return response.choices[0].message.content.trim();
};

const buildRefinePrompt = async (userInstruction, previousPrompt, base64Image = null, mimeType = null) => {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const userContent = [
    {
      type: "text",
      text: `ORIGINAL PROMPT:\n${previousPrompt}\n\nUSER WANTS THIS SPECIFIC CHANGE: "${userInstruction}"\n\nTask: Rewrite the prompt to aggressively apply the user's change. Keep the torn paper and red/black text layout, but change what the user asked.`
    }
  ];

  if (base64Image && mimeType) {
    userContent.push({
      type: "image_url",
      image_url: { url: `data:${mimeType};base64,${base64Image}` }
    });
    userContent[0].text += `\n\nREFERENCE IMAGE ATTACHED. Use it to understand exactly what the user wants to change or add based on their instruction.`;
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: "You are editing a prompt for a news thumbnail. You MUST heavily emphasize the user's requested changes in the new prompt so the image generator actually obeys. Output ONLY the raw prompt. NO conversational text.",
      },
      { role: "user", content: userContent },
    ],
    max_tokens: 1500,
    temperature: 0.3,
  });

  // Adding a timestamp variant completely breaks any API caching, forcing a fresh image generation.
  return response.choices[0].message.content.trim() + ` [Variant ID: ${Date.now()}]`;
};

const generateImage = async (prompt, thumbnailType, channelName = null) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const response = await openai.images.generate(
      {
        model: "gpt-image-2", 
        prompt,
        n: 1,
        size: SIZE_MAP[thumbnailType] ?? "1024x1024",
        quality: "medium",
      },
      { signal: controller.signal }
    );

    const item = response.data[0];
    if (!item?.b64_json) throw new Error("No image returned from API");

    let buffer = Buffer.from(item.b64_json, "base64");
    if (channelName && LOGO_MAP[channelName]) {
      buffer = await overlayLogo(buffer, channelName, thumbnailType);
    }

    const imageKey = storeImage(buffer);
    const imageUrl = `data:image/png;base64,${buffer.toString("base64")}`;
    return { imageUrl, imageKey, usedPrompt: prompt };
  } finally {
    clearTimeout(timeout);
  }
};


// ── POST /generate ───────────────────────────────────────────────
export const generateThumbnail = async (req, res) => {
  const { anchor, scriptType, thumbnailType = "reels", channelName = "null", title = "" } = req.body;
  const resolvedChannel = channelName === "null" ? null : channelName;
  const userId = req?.user?.id;
  
  let base64Image = null;
  let mimeType = null;
  if (req.file) {
    base64Image = req.file.buffer.toString("base64");
    mimeType = req.file.mimetype;
  }

  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
  if (!anchor) return res.status(400).json({ success: false, error: "anchor is required" });

  try {
    const richPrompt = await buildRichPrompt(title, anchor, thumbnailType, null, base64Image, mimeType);
    const { imageUrl, imageKey, usedPrompt } = await generateImage(richPrompt, thumbnailType, resolvedChannel);

    return res.status(200).json({
      success: true,
      message: "Thumbnail generated successfully!",
      data: { imageUrl, imageKey, prompt: usedPrompt, scriptType, thumbnailType, channelName: resolvedChannel },
    });
  } catch (error) {
    if (error.name === "AbortError") return res.status(504).json({ success: false, message: "Timeout." });
    return res.status(500).json({ success: false, message: "Generation failed. Please try again." });
  }
};

// ── POST /refine ─────────────────────────────────────────────────
export const refineThumbnail = async (req, res) => {
  const { anchor, scriptType, thumbnailType = "reels", userInstruction, previousPrompt, channelName = "null" } = req.body;
  const resolvedChannel = channelName === "null" ? null : channelName;
  const userId = req?.user?.id;

  let base64Image = null;
  let mimeType = null;
  if (req.file) {
    base64Image = req.file.buffer.toString("base64");
    mimeType = req.file.mimetype;
  }

  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
  if (!anchor || !userInstruction) return res.status(400).json({ success: false, error: "Missing required fields" });

  const effectiveType = ["youtube", "reels"].includes(thumbnailType) ? thumbnailType : "reels";

  try {
    // Generate the strictly rewritten prompt
    const refinedPrompt = await buildRefinePrompt(userInstruction, previousPrompt, base64Image, mimeType);
    
    // Generate an entirely fresh image based on the newly refined prompt
    const result = await generateImage(refinedPrompt, effectiveType, resolvedChannel);

    return res.status(200).json({
      success: true,
      data: { 
        imageUrl: result.imageUrl, 
        imageKey: result.imageKey, 
        prompt: result.usedPrompt, 
        scriptType, 
        thumbnailType: effectiveType, 
        channelName: resolvedChannel, 
        changes: `Updated: ${userInstruction}` 
      },
    });
  } catch (error) {
    if (error.name === "AbortError") return res.status(504).json({ success: false, message: "Timeout." });
    return res.status(500).json({ success: false, message: "Refinement failed. Please try again." });
  }
};