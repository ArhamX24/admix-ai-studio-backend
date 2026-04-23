import { tasks, runs } from "@trigger.dev/sdk/v3";
import prisma from "../DB/prisma.client.js";
// Helper: trigger a task, poll until complete, return output or throw
const triggerAndWait = async (taskId, payload) => {
  const result = await tasks.trigger(taskId, payload);

  let run = await runs.retrieve(result.id);
  while (!run.isCompleted) {
    await new Promise((res) => setTimeout(res, 1000));
    run = await runs.retrieve(result.id);
  }

  if (run.status === "FAILED" || run.status === "CANCELED") {
    throw new Error(`Task "${taskId}" failed. Please try again.`);
  }

  return run.output;
};

// ── GET /news/:id ────────────────────────────────────────────────
export const getNewsById = async (req, res) => {
  try {
    const { id } = req.params;
    const news = await prisma.morningAiNewsFetch.findUnique({ where: { id } });
    if (!news) {
      return res.status(404).json({ success: false, message: "News not found" });
    }
    return res.status(200).json({ success: true, data: news });
  } catch (error) {
    console.error("getNewsById error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ── POST /generate ───────────────────────────────────────────────
export const generateScript = async (req, res) => {
  try {
    const { newsIds, scriptType } = req.body;

    if (!newsIds || !Array.isArray(newsIds) || newsIds.length === 0) {
      return res.status(400).json({ success: false, message: "newsIds array is required" });
    }
    if (!scriptType || !["short", "long"].includes(scriptType)) {
      return res.status(400).json({ success: false, message: "scriptType must be 'short' or 'long'" });
    }

    const output = await triggerAndWait("generate-script", { newsIds, scriptType });

    return res.status(200).json({
      success: true,
      message: "Script generated successfully!",
      data: output,
    });
  } catch (error) {
    console.error("generateScript error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ── POST /refine ─────────────────────────────────────────────────
export const refineScript = async (req, res) => {
  try {
    const { anchor, voiceOver, userMessage, scriptType } = req.body;

    if (!anchor || !userMessage) {
      return res.status(400).json({
        success: false,
        message: "anchor and userMessage are required",
      });
    }
    if (!scriptType || !["short", "long"].includes(scriptType)) {
      return res.status(400).json({ success: false, message: "scriptType must be 'short' or 'long'" });
    }

    const output = await triggerAndWait("refine-script", {
      anchor,
      voiceOver: voiceOver || "",
      userMessage,
      scriptType,
    });

    return res.status(200).json({
      success: true,
      message: "Script refined successfully!",
      data: output,
    });
  } catch (error) {
    console.error("refineScript error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ── POST /save ───────────────────────────────────────────────────
export const saveGeneratedScript = async (req, res) => {
  try {
    const { heading, anchor, voiceOver, thumbnail, scriptType } = req.body;
    const userId = req?.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    if (!heading || !anchor) {
      return res.status(400).json({ success: false, error: "heading and anchor are required" });
    }

    const script = await prisma.savedScript.create({
      data: {
        heading,
        anchor,
        voiceOver: scriptType === "short" ? "" : (voiceOver || ""),
        thumbnail: thumbnail || "",
        scriptType: scriptType || null,

        user: {
          connect: { id: userId },
        },
      },
    });

    return res.status(201).json({
      success: true,
      message: "Script saved successfully",
      data: script,
    });

  } catch (error) {
    console.error("saveGeneratedScript error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ── GET /saved ────────────────────────────────────────────────────
export const getSavedScripts = async (req, res) => {
  try {
    const userId = req?.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    // ✅ Use prisma.script (same model as save)
    const scripts = await prisma.savedScript.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    // ✅ Map to frontend-expected shape
    const mapped = scripts.map((s) => ({
      id: s.id,
      heading: s.heading,
      anchor: s.anchor || "",
      voiceOver: s.voiceOver || "",
      thumbnail: s.thumbnail || "",
      scriptType: s.scriptType || null,
      isVoiceGenerated: s.isVoiceGenerated || false,
      newsIds: s.newsIds || [],
      createdAt: s.createdAt,
    }));

    return res.status(200).json({ success: true, data: mapped });
  } catch (error) {
    console.error("getSavedScripts error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteSavedScript = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req?.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    // ✅ FIX: use savedScript instead of script
    const script = await prisma.savedScript.findUnique({
      where: { id },
    });

    if (!script || script.userId !== userId) {
      return res.status(404).json({ success: false, error: "Script not found" });
    }

    await prisma.savedScript.delete({
      where: { id },
    });

    return res.status(200).json({
      success: true,
      message: "Script deleted",
    });

  } catch (error) {
    console.error("deleteSavedScript error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};