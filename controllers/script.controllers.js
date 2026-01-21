import prisma from "../DB/prisma.client.js";

export const createScript = async (req, res) => {
  try {
    const {heading, description, content } = req.body;

    let userId = req?.user.id

    if (!userId || !heading || !content) {
      return res.status(400).json({
        error: "userId, heading, and content are required",
      });
    }

    const script = await prisma.script.create({
      data: {
        userId,
        heading,
        description: description || "",
        content,
        isVoiceGenerated: false,
      },
    });

    res.status(201).json({
      message: "Script created successfully",
      script,
    });
  } catch (error) {
    console.error("Create script error:", error);
    res.status(500).json({
      error: "Failed to create script",
      details: error.message,
    });
  }
};

// Get user's own scripts (for My Scripts page)
export const getScripts = async (req, res) => {
  try {
    const { page = 1, limit = 20, isVoiceGenerated } = req.query;

    // Check if user exists and is authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "User not authenticated",
      });
    }

    const userId = req.user.id;

    const skip = (Number(page) - 1) * Number(limit);

    // Build where clause
    const where = {
      userId: String(userId), // Always filter by userId for user's own scripts
    };

    // Optional filter by voice generation status
    if (isVoiceGenerated !== undefined) {
      where.isVoiceGenerated = isVoiceGenerated === "true";
    }


    const [scripts, total] = await Promise.all([
      prisma.script.findMany({
        where,
        select: {
          id: true,
          heading: true,
          description: true,
          content: true,
          isVoiceGenerated: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: Number(limit),
      }),
      prisma.script.count({ where }),
    ]);


    res.status(200).json({
      scripts,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("Get scripts error:", error);
    res.status(500).json({
      error: "Failed to fetch scripts",
      details: error.message,
    });
  }
};

// Get ALL scripts for voice-over generation (no user filtering)
export const getScriptsForVoiceOver = async (req, res) => {
  try {
    const { page = 1, limit = 20, isVoiceGenerated } = req.query;

    // Check if user is authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "User not authenticated",
      });
    }


    const skip = (Number(page) - 1) * Number(limit);

    // Build where clause WITHOUT userId filtering
    const where = {};

    // Optional filter by voice generation status
    if (isVoiceGenerated !== undefined) {
      where.isVoiceGenerated = isVoiceGenerated === "true";
    }


    const [scripts, total] = await Promise.all([
      prisma.script.findMany({
        where,
        select: {
          id: true,
          heading: true,
          description: true,
          content: true,
          isVoiceGenerated: true,
          createdAt: true,
          updatedAt: true,
          userId: true, // Include userId to show who created it
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: Number(limit),
      }),
      prisma.script.count({ where }),
    ]);


    res.status(200).json({
      scripts,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("Get scripts for voice-over error:", error);
    res.status(500).json({
      error: "Failed to fetch scripts",
      details: error.message,
    });
  }
};

export const getScriptById = async (req, res) => {
  try {
    const { id } = req.params;

    const script = await prisma.script.findUnique({
      where: { id },
      include: {
        speechHistory: {
          where: { status: "COMPLETED" },
          select: {
            id: true,
            audioFilePath: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!script) {
      return res.status(404).json({ error: "Script not found" });
    }

    res.json({ script });
  } catch (error) {
    console.error("Get script error:", error);
    res.status(500).json({
      error: "Failed to fetch script",
      details: error.message,
    });
  }
};

export const updateScript = async (req, res) => {
  try {
    const { id } = req.params;
    const { heading, description, content, isVoiceGenerated } = req.body;

    const updatedScript = await prisma.script.update({
      where: { id },
      data: {
        ...(heading && { heading }),
        ...(description !== undefined && { description }),
        ...(content && { content }),
        ...(isVoiceGenerated !== undefined && { isVoiceGenerated }),
      },
    });

    res.json({
      message: "Script updated successfully",
      script: updatedScript,
    });
  } catch (error) {
    console.error("Update script error:", error);
    res.status(500).json({
      error: "Failed to update script",
      details: error.message,
    });
  }
};

export const deleteScript = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.script.delete({ where: { id } });

    res.json({
      message: "Script deleted successfully",
      deletedId: id,
    });
  } catch (error) {
    console.error("Delete script error:", error);
    res.status(500).json({
      error: "Failed to delete script",
      details: error.message,
    });
  }
};
