// thumbnail.generation.controllers.js
import dotenv from "dotenv";
dotenv.config();
import OpenAI from "openai";
import { toFile } from "openai";
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs"; // Added to verify file existence on VPS

// ── Resolve __dirname in ESM ─────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

console.log("[DEBUG] Thumbnail controller loaded.");
console.log("[DEBUG] OPENAI_API_KEY present:", !!process.env.OPENAI_API_KEY);
console.log("[DEBUG] __dirname resolved to:", __dirname);

// ── Logo paths (resolved relative to this file) ──────────────────
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

// ── In-memory image store (TTL: 1 hour) ─────────────────────────
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

// ── Overlay channel logo on top-right corner ─────────────────────
const overlayLogo = async (imageBuffer, channelName, thumbnailType) => {
  console.log(`[DEBUG] overlayLogo -> Starting for channel: ${channelName}, type: ${thumbnailType}`);
  const logoPath = LOGO_MAP[channelName];
  
  if (!logoPath) {
    console.log(`[DEBUG] overlayLogo -> No logo path mapped for ${channelName}`);
    return imageBuffer;
  }

  console.log(`[DEBUG] overlayLogo -> Attempting to load logo from: ${logoPath}`);
  
  // Verify file exists (Crucial for VPS Linux case-sensitivity)
  if (!fs.existsSync(logoPath)) {
    console.error(`[ERROR] overlayLogo -> FILE NOT FOUND ON VPS: ${logoPath}`);
    return imageBuffer;
  }

  try {
    const circleSize = thumbnailType === "youtube" ? 110 : 90;
    const padding    = 10;
    const logoSize = Math.round(circleSize * 0.78);

    console.log("[DEBUG] overlayLogo -> Processing logo with sharp (trim & resize)...");
    const logoBuffer = await sharp(logoPath)
      .trim()
      .resize(logoSize, logoSize, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    console.log("[DEBUG] overlayLogo -> Creating background circle badge...");
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

    console.log("[DEBUG] overlayLogo -> Compositing badge onto main image buffer...");
    const imgMeta   = await sharp(imageBuffer).metadata();
    const badgeTop  = padding;
    const badgeLeft = imgMeta.width - circleSize - padding;

    const finalBuffer = await sharp(imageBuffer)
      .composite([{ input: badgeBuffer, top: badgeTop, left: badgeLeft, blend: "over" }])
      .png()
      .toBuffer();

    console.log("[DEBUG] overlayLogo -> Overlay complete!");
    return finalBuffer;

  } catch (err) {
    console.error("[ERROR] overlayLogo -> SHARP FAILED:", err.stack || err.message);
    return imageBuffer;
  }
};


// ── Build rich prompt via gpt-4o ─────────────────────────────────
const buildRichPrompt = async (anchor, thumbnailType, userInstruction = null) => {
  console.log("[DEBUG] buildRichPrompt -> Initializing OpenAI...");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  
  const layoutNote = thumbnailType === "youtube"
    ? "16:9 wide landscape (1536x1024) — infographic graphic design style."
    : "1:1 square (1024x1024) — infographic graphic design style.";

  const refineNote = userInstruction
    ? `\nUser wants this specific change: "${userInstruction}". Keep everything else identical.`
    : "";

  console.log("[DEBUG] buildRichPrompt -> Calling GPT-4o for prompt generation...");
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are a senior Indian news graphic designer. You create highly detailed prompts for GPT Image 2 to generate rich, mixed-media news thumbnails (similar to high-end Canva templates).

STRICT RULES:
- Mix photorealistic backgrounds with 2D graphic design elements (e.g., maps, glowing question marks, checklists, bold icons like locks or money symbols).
- Describe the exact layout and placement of text and stickers.
- Text Rendering: Put all Hindi text exactly in "quotes" and describe the typography (e.g., "Bold Devanagari text on a red background banner").
- Tone: Make it look like a high-engagement, sensational news graphic.
- IMPORTANT: Do NOT place any logo, watermark, branding element, OR text in the top-right corner (approximately 120x120px area) — that area is strictly reserved for a channel logo badge that will be composited on top separately. All text banners and headlines must start from the left edge and must NOT extend into that top-right zone.
- Output ONLY the raw image generation prompt (around 150-200 words). No preamble.`,
      },
      {
        role: "user",
        content: `NEWS ANCHOR SCRIPT:
${anchor}
${refineNote}

FORMAT: ${layoutNote}

Write a detailed prompt following these sections:
1. Overall Style: "A highly stylized graphic design news thumbnail combining photography with bold 2D UI elements and text banners."
2. Background: The photorealistic scene (e.g., traffic, bar, government building).
3. 2D Graphics: Specific stickers to overlay (e.g., an open draft document, a map silhouette of the state, glowing 3D question marks).
4. Text Overlays: Exact Hindi headlines from the script in "quotes", placed on high-contrast banners (e.g., yellow text on red).
5. Main Subject: A relevant object or person on one side of the frame.
6. Quality: "8K, sharp Devanagari text, photorealistic skin, broadcast color grade."`,
      },
    ],
    max_tokens: 1500,
    temperature: 0.7,
  });

  console.log("[DEBUG] buildRichPrompt -> Prompt generated successfully.");
  return response.choices[0].message.content.trim();
};

// ── Build refined prompt via gpt-4o ─────────────────────────────
const buildRefinePrompt = async (userInstruction, previousPrompt) => {
  console.log("[DEBUG] buildRefinePrompt -> Initializing OpenAI...");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  console.log("[DEBUG] buildRefinePrompt -> Calling GPT-4o for refined prompt...");
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are editing an existing thumbnail image.
STRICT RULES:
- Keep the ENTIRE composition, background, characters, layout, colors, and all text EXACTLY the same.
- ONLY apply the single change the user requested.
- Do NOT redesign, do NOT change layout, do NOT add/remove elements unless explicitly asked.
- Do NOT place any logo, watermark, branding, OR text in the top-right corner (≈120x120px) — reserved for the channel logo badge.
- Output ONLY the updated image prompt. No preamble.`,
      },
      {
        role: "user",
        content: `ORIGINAL PROMPT:
${previousPrompt}

USER WANTS ONLY THIS CHANGE: "${userInstruction}"

Rewrite the prompt keeping everything identical except the requested change.`,
      },
    ],
    max_tokens: 1500,
    temperature: 0.3,
  });

  console.log("[DEBUG] buildRefinePrompt -> Refined prompt generated successfully.");
  return response.choices[0].message.content.trim();
};

// ── Generate: images.generate → overlay logo → store buffer ──────
const generateImage = async (prompt, thumbnailType, channelName = null) => {
  console.log(`[DEBUG] generateImage -> Starting. Model: gpt-image-2, Size: ${SIZE_MAP[thumbnailType]}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    console.error("[ERROR] generateImage -> ABORT TIMEOUT HIT (180s). Cancelling request.");
    controller.abort();
  }, 180_000);

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    console.log("[DEBUG] generateImage -> Calling OpenAI images.generate API...");
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

    console.log("[DEBUG] generateImage -> OpenAI API returned successfully.");
    const item = response.data[0];
    if (!item?.b64_json) throw new Error("No image returned from API");

    let buffer = Buffer.from(item.b64_json, "base64");

    if (channelName && LOGO_MAP[channelName]) {
      buffer = await overlayLogo(buffer, channelName, thumbnailType);
    }

    const imageKey = storeImage(buffer);
    const imageUrl = `data:image/png;base64,${buffer.toString("base64")}`;

    console.log(`[DEBUG] generateImage -> Complete. imageKey: ${imageKey}`);
    return { imageUrl, imageKey, usedPrompt: prompt };
  } finally {
    clearTimeout(timeout);
  }
};

// ── Refine: images.edit → overlay logo → store buffer ───────────
const refineImage = async (prompt, imageKey, thumbnailType, channelName = null) => {
  console.log(`[DEBUG] refineImage -> Starting. Key: ${imageKey}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    console.error("[ERROR] refineImage -> ABORT TIMEOUT HIT (180s). Cancelling request.");
    controller.abort();
  }, 180_000);

  try {
    const buffer = getStoredImage(imageKey);
    if (!buffer) {
      console.error("[ERROR] refineImage -> Buffer not found or EXPIRED.");
      throw new Error("EXPIRED");
    }

    const imageFile = await toFile(buffer, "image.png", { type: "image/png" });
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    console.log("[DEBUG] refineImage -> Calling OpenAI images.edit API...");
    const response = await openai.images.edit(
      {
        model: "gpt-image-2",
        image: imageFile,
        prompt,
        n: 1,
        size: SIZE_MAP[thumbnailType] ?? "1024x1024",
        quality: "medium",
      },
      { signal: controller.signal }
    );

    console.log("[DEBUG] refineImage -> OpenAI API returned successfully.");
    const item = response.data[0];
    if (!item?.b64_json) throw new Error("No image returned from edit API");

    let newBuffer = Buffer.from(item.b64_json, "base64");

    if (channelName && LOGO_MAP[channelName]) {
      newBuffer = await overlayLogo(newBuffer, channelName, thumbnailType);
    }

    const newImageKey = storeImage(newBuffer);
    const imageUrl = `data:image/png;base64,${newBuffer.toString("base64")}`;

    console.log(`[DEBUG] refineImage -> Complete. newImageKey: ${newImageKey}`);
    return { imageUrl, imageKey: newImageKey, usedPrompt: prompt };
  } finally {
    clearTimeout(timeout);
  }
};

// ── POST /generate ───────────────────────────────────────────────
export const generateThumbnail = async (req, res) => {
  console.log("\n=======================================================");
  console.log("[DEBUG] generateThumbnail route hit.");
  
  const { anchor, scriptType, thumbnailType = "reels", channelName = null } = req.body;
  const userId = req?.user?.id;

  console.log(`[DEBUG] Payload -> userId: ${userId}, type: ${thumbnailType}, channel: ${channelName}`);

  if (!userId) {
    console.log("[WARN] generateThumbnail -> Unauthorized. Missing userId.");
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  if (!anchor) {
    console.log("[WARN] generateThumbnail -> Missing anchor.");
    return res.status(400).json({ success: false, error: "anchor is required" });
  }
  if (!["short", "long"].includes(scriptType)) {
    console.log("[WARN] generateThumbnail -> Invalid scriptType:", scriptType);
    return res.status(400).json({ success: false, error: "scriptType must be 'short' or 'long'" });
  }
  if (!["youtube", "reels"].includes(thumbnailType)) {
    console.log("[WARN] generateThumbnail -> Invalid thumbnailType:", thumbnailType);
    return res.status(400).json({ success: false, error: "thumbnailType must be 'youtube' or 'reels'" });
  }
  if (channelName && !LOGO_MAP[channelName]) {
    console.log("[WARN] generateThumbnail -> Invalid channelName:", channelName);
    return res.status(400).json({ success: false, error: `Unknown channelName: ${channelName}. Valid options: ${Object.keys(LOGO_MAP).join(", ")}` });
  }

  try {
    const richPrompt = await buildRichPrompt(anchor, thumbnailType);
    const { imageUrl, imageKey, usedPrompt } = await generateImage(richPrompt, thumbnailType, channelName);

    console.log("[DEBUG] generateThumbnail -> SUCCESS! Sending response.");
    return res.status(200).json({
      success: true,
      message: "Thumbnail generated successfully!",
      data: {
        imageUrl,
        imageKey,
        prompt: usedPrompt,
        scriptType,
        thumbnailType,
        channelName,
      },
    });
  } catch (error) {
    console.error("\n[FATAL ERROR] generateThumbnail caught an exception:");
    console.error(error.stack || error.message);
    
    if (error.name === "AbortError")
      return res.status(504).json({ success: false, message: "Generation timed out. Please try again." });
    if (error?.status === 429)
      return res.status(429).json({ success: false, message: "API quota exceeded. Check your OpenAI billing." });

    return res.status(500).json({ success: false, message: "Generation failed. Please try again." });
  }
};

// ── POST /refine ─────────────────────────────────────────────────
export const refineThumbnail = async (req, res) => {
  console.log("\n=======================================================");
  console.log("[DEBUG] refineThumbnail route hit.");

  const {
    anchor,
    scriptType,
    thumbnailType = "reels",
    userInstruction,
    previousPrompt,
    previousImageKey,
    channelName = null,
  } = req.body;

  const userId = req?.user?.id;

  console.log(`[DEBUG] Payload -> userId: ${userId}, key: ${previousImageKey}, type: ${thumbnailType}`);

  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
  if (!anchor || !userInstruction) return res.status(400).json({ success: false, error: "anchor and userInstruction are required" });
  if (!["short", "long"].includes(scriptType)) return res.status(400).json({ success: false, error: "scriptType must be 'short' or 'long'" });
  if (channelName && !LOGO_MAP[channelName]) return res.status(400).json({ success: false, error: "Unknown channelName" });

  const effectiveType = ["youtube", "reels"].includes(thumbnailType) ? thumbnailType : "reels";

  try {
    const refinedPrompt = await buildRefinePrompt(userInstruction, previousPrompt);
    let result;

    if (previousImageKey) {
      try {
        result = await refineImage(refinedPrompt, previousImageKey, effectiveType, channelName);
      } catch (editErr) {
        if (editErr.message === "EXPIRED") {
          console.log("[WARN] refineThumbnail -> Image EXPIRED");
          return res.status(410).json({
            success: false,
            expired: true,
            message: "Previous image expired (>1 hour). Please generate a new thumbnail first.",
          });
        }
        throw editErr;
      }
    } else {
      console.log("[DEBUG] refineThumbnail -> No previousImageKey, calling generateImage instead...");
      result = await generateImage(refinedPrompt, effectiveType, channelName);
    }

    console.log("[DEBUG] refineThumbnail -> SUCCESS! Sending response.");
    return res.status(200).json({
      success: true,
      message: "Thumbnail refined successfully!",
      data: {
        imageUrl: result.imageUrl,
        imageKey: result.imageKey,
        prompt: result.usedPrompt,
        scriptType,
        thumbnailType: effectiveType,
        channelName,
        changes: `Updated: ${userInstruction}`,
      },
    });
  } catch (error) {
    console.error("\n[FATAL ERROR] refineThumbnail caught an exception:");
    console.error(error.stack || error.message);

    if (error.name === "AbortError")
      return res.status(504).json({ success: false, message: "Generation timed out. Please try again." });
    if (error?.status === 429)
      return res.status(429).json({ success: false, message: "API quota exceeded. Check your OpenAI billing." });
    return res.status(500).json({ success: false, message: "Refinement failed. Please try again." });
  }
};