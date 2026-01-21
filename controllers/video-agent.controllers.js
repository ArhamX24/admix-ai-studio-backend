import inngest from "../inngest/client/client.js";
import prisma from "../DB/prisma.client.js";
import axios from "axios";
import { enrichVideoData, enrichVideosData } from "../utils/videoUtils.js";

const fetchAvatars = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 25;
        const searchQuery = req.query.search || '';
        
        let response = await axios.get("https://api.heygen.com/v2/avatars", {
            headers: {
                'accept': 'application/json',
                'x-api-key': process.env.HEYGEN_API_KEY
            }
        });

        let avatars = response.data.data.avatars;

        // Filter for premium avatars
        let onlyPremAvatars = avatars.filter((avatar) => {
            return avatar.premium === false;
        });

        // Apply search filter if search query exists
        if (searchQuery) {
            onlyPremAvatars = onlyPremAvatars.filter((avatar) => {
                const nameMatch = avatar.avatar_name.toLowerCase().includes(searchQuery.toLowerCase());
                const genderMatch = avatar.gender.toLowerCase().includes(searchQuery.toLowerCase());
                
                // If avatar has tags, search in tags too
                const tagsMatch = avatar.tags ? 
                    avatar.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase())) : 
                    false;
                
                return nameMatch || genderMatch || tagsMatch;
            });
        }

        // Pagination logic
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const paginatedAvatars = onlyPremAvatars.slice(startIndex, endIndex);
        
        const totalPages = Math.ceil(onlyPremAvatars.length / limit);

        return res.json({
            result: true,
            data: paginatedAvatars,
            pagination: {
                currentPage: page,
                totalPages: totalPages,
                totalCount: onlyPremAvatars.length,
                hasNext: endIndex < onlyPremAvatars.length,
                hasPrev: page > 1
            }
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            result: false,
            error: error.message
        });
    }
}


const fetchVoices = async (req,res) => {
  try {
    let heygenResponse = await axios.get("https://api.heygen.com/v2/voices", {headers: {
        'accept': 'application/json',
        'x-api-key': process.env.HEYGEN_API_KEY
    }});

    let elvenlabsResponse = await axios.get("https://api.elevenlabs.io/v1/voices", {
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY
      }
    });

    let heygenVoices = await heygenResponse.data.data.voices;
    let elevenlabsVoices = await elvenlabsResponse.data.voices

    
    let hindiVoices = heygenVoices.filter((voice)=>{
        return voice.language === 'Hindi' && 'unknown'
    })
    
    let count = hindiVoices.length + elevenlabsVoices.length

    return res.json({result: true, count: count, data: {heygenVoices: hindiVoices, elevenlabsVoices: elevenlabsVoices}})
  } catch (error) {
    console.log(error);
  }
}

const createVideo = async (req, res) => {
  try {
    const { 
      avatarId, 
      voiceId, 
      script, 
      duration,
      userId 
    } = req.body;

    // Validate required fields
    if (!avatarId || !voiceId || !script || !userId) {
      return res.status(400).json({ 
        result: false, 
        error: "Missing required fields: avatarId, voiceId, script, and userId are required" 
      });
    }

    // Send event to Inngest for processing
    const { ids } = await inngest.send({
      name: "video/generation.requested",
      data: {
        avatarId,
        voiceId,
        script,
        duration: duration || "Auto",
        userId,
        requestedAt: new Date().toISOString()
      }
    });

    return res.status(202).json({ 
      result: true, 
      message: "Video generation started successfully",
      eventId: ids[0],
      status: "processing"
    });
  } catch (error) {
    console.error('Create video error:', error);
    return res.status(500).json({ 
      result: false, 
      error: error.message 
    });
  }
};

const checkVideoStatus = async (req, res) => {
  const MAX_DB_RETRIES = 3;
  const DB_RETRY_DELAY = 2000; // 2 seconds

  // Database operation wrapper with retry logic
  const withDatabaseRetry = async (operation, retries = MAX_DB_RETRIES) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        // Check if it's a database connection error
        if (error.code === 'P1001' && attempt < retries) {
          console.log(
            `Database connection failed (attempt ${attempt}/${retries}), retrying in ${DB_RETRY_DELAY}ms...`
          );
          await new Promise(resolve => setTimeout(resolve, DB_RETRY_DELAY * attempt));
          continue;
        }
        // If it's the last attempt or a different error, throw it
        throw error;
      }
    }
  };

  try {
    const { videoId } = req.body;

    if (!videoId) {
      return res.status(400).json({
        result: false,
        error: "videoId is required"
      });
    }

    // Execute database query with retry logic
    const video = await withDatabaseRetry(async () => {
      return await prisma.video.findUnique({
        where: { id: videoId },
        select: {
          id: true,
          status: true,
          videoUrl: true,
          thumbnailUrl: true,
          videoDuration: true,
          errorMessage: true,
          script: true,
          avatarId: true,
          voiceId: true,
          duration: true,
          createdAt: true,
        }
      });
    });

    if (!video) {
      return res.status(404).json({
        result: false,
        error: "Video not found"
      });
    }

    // Enrich with avatar and voice details
    const enrichedVideo = await withDatabaseRetry(async () => {
      return await enrichVideoData(video);
    });

    return res.json({
      result: true,
      status: video.status,
      video: enrichedVideo
    });

  } catch (error) {
    console.error('Check video status error:', error);

    // Provide more specific error messages
    if (error.code === 'P1001') {
      return res.status(503).json({
        result: false,
        error: "Database connection unavailable. Please try again in a moment.",
        code: "DB_CONNECTION_ERROR"
      });
    }

    if (error.code === 'P2025') {
      return res.status(404).json({
        result: false,
        error: "Video not found",
        code: "VIDEO_NOT_FOUND"
      });
    }

    return res.status(500).json({
      result: false,
      error: error.message || "Internal server error",
      code: "INTERNAL_ERROR"
    });
  }
};

const getUserVideos = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    const [videos, total] = await Promise.all([
      prisma.video.findMany({
        where: { userId },
        select: {
          id: true,
          status: true,
          avatarId: true,
          voiceId: true,
          script: true,
          duration: true,
          videoUrl: true,
          thumbnailUrl: true,
          videoDuration: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: Number(limit),
      }),
      prisma.video.count({ where: { userId } }),
    ]);

    // Enrich videos with avatar and voice details
    const enrichedVideos = await enrichVideosData(videos);

    return res.json({
      result: true,
      videos: enrichedVideos,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      }
    });
  } catch (error) {
    console.error('Get user videos error:', error);
    return res.status(500).json({
      result: false,
      error: error.message
    });
  }
};

const deleteVideo = async (req, res) => {
  try {
    const { videoId, userId } = req.body;

    if (!videoId) {
      return res.status(400).json({
        result: false,
        error: "videoId is required"
      });
    }

    const where = { id: videoId };
    if (userId) {
      where.userId = userId;
    }

    const video = await prisma.video.findUnique({
      where: { id: videoId }
    });

    if (!video) {
      return res.status(404).json({
        result: false,
        error: "Video not found"
      });
    }

    if (userId && video.userId !== userId) {
      return res.status(403).json({
        result: false,
        error: "Not authorized to delete this video"
      });
    }

    await prisma.video.delete({ where });

    return res.json({
      result: true,
      message: "Video deleted successfully",
      deletedId: videoId
    });
  } catch (error) {
    console.error('Delete video error:', error);
    return res.status(500).json({
      result: false,
      error: error.message
    });
  }
};

export { 
  fetchAvatars, 
  fetchVoices, 
  createVideo, 
  checkVideoStatus,
  getUserVideos,
  deleteVideo
};