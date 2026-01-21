import { newsAgent } from "../inngest/agent/agent.js";
import inngest from "../inngest/client/client.js";
import prisma from "../DB/prisma.client.js";

const newsWorkGenerator = async (req, res) => {
  try {
    const { userMessage, quickAction } = req.body;
    // const userId = req.user?.id; // From your auth middleware

    if (!userMessage) {
      return res.status(400).json({ 
        success: false, 
        message: "Message is required" 
      });
    }

    // Send event to Inngest with run ID
    const { ids } = await inngest.send({
      name: "news/optimize",
      data: { 
        userMessage, 
        quickAction,
        // userId,
      }
    });

    const runId = ids[0];

    // Return run ID immediately
    return res.json({ 
      success: true,
      runId: runId,
      message: "Processing your request...",
      statusUrl: `/api/news-status/${runId}`
    });

  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Internal server error" 
    });
  }
};

// Get status by runId (much cleaner now!)
const getNewsStatus = async (req, res) => {
  try {
    const { runId } = req.params;

    // Query by runId instead of timestamp
    const result = await prisma.generatedContent.findUnique({
      where: {
        runId: runId  // Direct lookup!
      }
    });

    if (!result) {
      return res.json({
        success: false,
        status: "not_found",
        message: "Request not found"
      });
    }

    if (result.status === "PROCESSING") {
      return res.json({
        success: false,
        status: "processing",
        message: "Still processing..."
      });
    }

    // Completed!
    return res.json({
      success: true,
      status: "completed",
      result: result.generatedText,
      recordId: result.id,
      language: result.language,
      contentType: result.contentType
    });

  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Internal server error" 
    });
  }
};

const adWorkGenerator = async (req,res) => {
  
}

export { newsWorkGenerator, getNewsStatus };

