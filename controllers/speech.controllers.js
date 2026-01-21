import inngest from "../inngest/client/client.js";
import prisma from "../DB/prisma.client.js";
import axios from "axios";
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_PROJECT_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const generateSpeech = async (req, res) => {
  try {
    const {
      text, voiceId, language = "multilingual",
      voiceSettings = {}, isElevenLabsVoice = false, scriptId = null
    } = req.body;

    let userId = req?.user.id

    if (!text || !voiceId) {
      return res.status(400).json({
        error: "Missing required fields: text and voiceId are required",
      });
    }

    if (text.length > 5000) {
      return res.status(400).json({
        error: "Text exceeds maximum length of 5000 characters",
      });
    }

    let voiceRecordId = null;
    
    if (!isElevenLabsVoice) {
      const voice = await prisma.voice.findUnique({
        where: { voiceId },
      });

      if (!voice) {
        return res.status(404).json({
          error: "Custom voice not found",
        });
      }
      voiceRecordId = voice.id;
    } else {
      const voice = await prisma.voice.findUnique({
        where: { voiceId },
      });
      if (voice) {
        voiceRecordId = voice.id;
      }
    }

    const { ids } = await inngest.send({
      name: "tts/convert",
      data: {
        text, voiceId, voiceRecordId, userId, language, isElevenLabsVoice, scriptId,
        voiceSettings: {
          stability: voiceSettings.stability ?? 0.5,
          similarity_boost: voiceSettings.similarity_boost ?? 0.75,
          style: voiceSettings.style ?? 0.0,
          use_speaker_boost: voiceSettings.use_speaker_boost ?? true,
        },
      },
    });

    res.status(202).json({
      message: "Speech generation started",
      eventId: ids[0],
      status: "processing",
    });
  } catch (error) {
    console.error("Generate speech error:", error);
    res.status(500).json({
      error: "Failed to generate speech",
      details: error.message,
    });
  }
};

const createCustomVoice = async (req, res) => {
  try {
    const { name, description, language, accent, labels, userId } = req.body;
    const files = req.files;

    if (!name) {
      return res.status(400).json({
        error: "Voice name is required",
      });
    }

    if (!files || files.length === 0) {
      return res.status(400).json({
        error: "At least one audio file is required",
      });
    }

    if (files.length > 25) {
      return res.status(400).json({
        error: "Maximum 25 audio files allowed",
      });
    }

    let parsedLabels = labels;
    if (typeof labels === "string") {
      try {
        parsedLabels = JSON.parse(labels);
      } catch (e) {
        parsedLabels = {};
      }
    }

    const { ids } = await inngest.send({
      name: "tts/add-voice",
      data: {
        name,
        description,
        language: language || "multilingual",
        accent,
        labels: parsedLabels || {},
        userId,
        audioFilePaths: files.map((file) => file.path),
      },
    });

    res.status(202).json({
      message: "Voice creation started",
      eventId: ids[0],
      filesUploaded: files.length,
      status: "processing",
    });
  } catch (error) {
    console.error("Create voice error:", error);
    res.status(500).json({
      error: "Failed to create voice",
      details: error.message,
    });
  }
};

const addExistingVoice = async (req, res) => {
  try {
    const { voiceId, name, description, language, accent, labels, userId } = req.body;

    if (!voiceId || !name) {
      return res.status(400).json({
        error: "voiceId and name are required",
      });
    }

    const existingVoice = await prisma.voice.findUnique({
      where: { voiceId },
    });

    if (existingVoice) {
      return res.status(409).json({
        error: "Voice already exists in database",
        voice: existingVoice,
      });
    }

    const voice = await prisma.voice.create({
      data: {
        voiceId,
        name,
        description,
        language: language || "multilingual",
        accent,
        labels: labels || {},
        isCustom: false,
        userId,
      },
    });

    res.status(201).json({
      message: "Voice added successfully",
      voice,
    });
  } catch (error) {
    console.error("Add voice error:", error);
    res.status(500).json({
      error: "Failed to add voice",
      details: error.message,
    });
  }
};

const checkSpeechStatus = async (req, res) => {
  try {
    const { speechId } = req.body;

    if (!speechId) {
      return res.status(400).json({
        error: "speechId is required",
      });
    }

    const speech = await prisma.speechHistory.findUnique({
      where: { id: speechId },
      select: {
        id: true,
        text: true,
        language: true,
        status: true,
        errorMessage: true,
        fileSize: true,
        duration: true,
        createdAt: true,
        audioFilePath: true, // This is now the Supabase public URL
        voice: {
          select: {
            name: true,
            voiceId: true,
          },
        },
      },
    });

    if (!speech) {
      return res.status(404).json({
        error: "Speech record not found",
      });
    }

    res.json({
      status: speech.status,
      speech,
      audioUrl: speech.status === "COMPLETED" ? speech.audioFilePath : null,
    });
  } catch (error) {
    console.error("Check status error:", error);
    res.status(500).json({
      error: "Failed to check status",
      details: error.message,
    });
  }
};

const deleteSpeech = async (req, res) => {
  try {
    const { speechId } = req.body;
    const userId = req.user?.id; // Get from authenticated user

    if (!speechId) {
      return res.status(400).json({
        error: "speechId is required",
      });
    }

    if (!userId) {
      return res.status(401).json({
        error: "Unauthorized",
      });
    }

    // Find speech and verify ownership
    const speech = await prisma.speechHistory.findFirst({
      where: { 
        id: speechId,
        userId: userId // Ensure user owns this speech
      },
    });

    if (!speech) {
      return res.status(404).json({
        error: "Speech not found or you don't have permission to delete it",
      });
    }

    // Delete from Supabase Storage
    if (speech.audioFilePath) {
      try {
        const url = new URL(speech.audioFilePath);
        const pathParts = url.pathname.split('/storage/v1/object/public/speech-audio/');
        const filePath = pathParts[1];
        
        if (filePath) {
          const { error: deleteError } = await supabase.storage
            .from('speech-audio')
            .remove([filePath]);

          if (deleteError) {
            console.warn(`Could not delete file from Supabase: ${deleteError.message}`);
          } else {
            console.log(`Deleted audio file from Supabase: ${filePath}`);
          }
        }
      } catch (err) {
        console.warn(`Error deleting from Supabase:`, err.message);
      }
    }

    // Delete from database
    const deleted = await prisma.speechHistory.delete({
      where: { id: speechId },
    });

    res.status(200).json({
      message: "Speech deleted successfully",
      deletedId: deleted.id,
    });
  } catch (error) {
    console.error("Delete speech error:", error);
    res.status(500).json({
      error: "Failed to delete speech",
      details: error.message,
    });
  }
};

// ✅ UPDATED: Delete voice samples from Supabase Storage
const deleteVoice = async (req, res) => {
  try {
    const { voiceId, userId } = req.body;

    if (!voiceId) {
      return res.status(400).json({
        error: "voiceId is required",
      });
    }

    const voice = await prisma.voice.findUnique({
      where: { id: voiceId },
      include: {
        audioSamples: true,
        _count: {
          select: {
            speechHistory: true,
          },
        },
      },
    });

    if (!voice) {
      return res.status(404).json({
        error: "Voice not found",
      });
    }

    if (userId && voice.userId !== userId) {
      return res.status(403).json({
        error: "Not authorized to delete this voice",
      });
    }

    // ✅ Delete audio sample files from Supabase Storage
    for (const sample of voice.audioSamples) {
      if (sample.audioFilePath) {
        try {
          const url = new URL(sample.audioFilePath);
          const pathParts = url.pathname.split('/storage/v1/object/public/speech-audio/');
          const filePath = pathParts[1];
          
          if (filePath) {
            const { error: deleteError } = await supabase.storage
              .from('speech-audio')
              .remove([filePath]);

            if (deleteError) {
              console.warn(`Could not delete sample from Supabase: ${deleteError.message}`);
            } else {
              console.log(`Deleted voice sample from Supabase: ${filePath}`);
            }
          }
        } catch (err) {
          console.warn(`Error deleting sample from Supabase:`, err.message);
        }
      }
    }

    await prisma.voice.delete({
      where: { id: voiceId },
    });

    res.json({
      message: "Voice deleted successfully",
      deletedVoiceId: voiceId,
      affectedSpeeches: voice._count.speechHistory,
    });
  } catch (error) {
    console.error("Delete voice error:", error);
    res.status(500).json({
      error: "Failed to delete voice",
      details: error.message,
    });
  }
};

// ✅ UPDATED: Simply redirect to Supabase public URL
const getSpeechAudio = async (req, res) => {
  try {
    const { id } = req.params;


    const speech = await prisma.speechHistory.findUnique({
      where: { id },
      select: {
        id: true,
        audioFilePath: true, // This is now the Supabase public URL
        status: true,
      },
    });


    if (!speech) {
      console.log(`❌ Speech not found`);
      return res.status(404).json({ error: "Speech not found" });
    }

    if (speech.status !== "COMPLETED") {
      console.log(`❌ Speech not ready, status: ${speech.status}`);
      return res.status(400).json({ error: "Speech not ready" });
    }

    if (!speech.audioFilePath) {
      console.log(`❌ No audio URL stored`);
      return res.status(404).json({ error: "Audio file not found" });
    }


    
    // Simply redirect to the Supabase public URL
    res.redirect(speech.audioFilePath);
  } catch (error) {
    console.error("❌ Get audio error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
};

const debugSpeechRecord = async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return res.status(400).json({ error: "id required" });
    }


    const speech = await prisma.speechHistory.findUnique({
      where: { id },
    });



    res.json({
      found: !!speech,
      data: speech
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getSpeechHistory = async (req, res) => {
  try {
    // Get userId from authenticated user (from middleware)
    const userId = req.user.id;
    
    if (!userId) {
      return res.status(401).json({
        error: "Unauthorized - User ID not found"
      });
    }

    const { page = 1, limit = 50 } = req.query; // Increased default limit to 50

    const skip = (Number(page) - 1) * Number(limit);


    const [speeches, total] = await Promise.all([
      prisma.speechHistory.findMany({
        where: { 
          userId,
          status: "COMPLETED" // Only fetch completed speeches
        },
        select: {
          id: true,
          text: true,
          language: true,
          status: true,
          fileSize: true,
          duration: true,
          createdAt: true,
          audioFilePath: true,
          voice: {
            select: {
              name: true,
              voiceId: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: Number(limit),
      }),
      prisma.speechHistory.count({ 
        where: { 
          userId,
          status: "COMPLETED"
        } 
      }),
    ]);

    res.status(200).json({
      speeches,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("Get speech history error:", error);
    res.status(500).json({ 
      error: "Failed to fetch speech history",
      details: error.message 
    });
  }
};

const getVoices = async (req, res) => {
  try {
    const { userId } = req.query;

    const voices = await prisma.voice.findMany({
      where: userId ? { userId: String(userId) } : {},
      select: {
        id: true,
        voiceId: true,
        name: true,
        description: true,
        language: true,
        accent: true,
        isCustom: true,
        createdAt: true,
        _count: {
          select: {
            audioSamples: true,
            speechHistory: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ voices });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ✅ UPDATED: Redirect to Supabase public URL for voice samples
const getVoiceAudioSample = async (req, res) => {
  try {
    const { id } = req.params;

    const sample = await prisma.audioSample.findUnique({
      where: { id },
      select: {
        audioFilePath: true, // This is now Supabase public URL
        fileName: true,
      },
    });

    if (!sample) {
      return res.status(404).json({ error: "Audio sample not found" });
    }

    if (!sample.audioFilePath) {
      return res.status(404).json({ error: "Audio file not found" });
    }

    // Simply redirect to the Supabase public URL
    res.redirect(sample.audioFilePath);
  } catch (error) {
    console.error("Get sample error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
};

const getExistingVoices = async (req, res) => {
  try {
    const response = await axios.get("https://api.elevenlabs.io/v1/voices", {
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY
      }
    });

    let countVoices = await response?.data?.voices.length

    const clonedVoices = await response.data.voices.filter((voices)=> {
      return voices.category == "cloned"
    });

    let clonesCount = clonedVoices.length

    return res.json({ result: true, count: clonesCount,cloned: clonedVoices ,data: response.data.voices});
  } catch (error) {
    console.error('Error fetching ElevenLabs voices:', error);
    
    if (error.response) {
      return res.status(error.response.status).json({
        error: error.response.data?.message || 'Failed to fetch voices from ElevenLabs'
      });
    } else if (error.request) {
      return res.status(500).json({
        error: 'Network error while fetching voices'
      });
    } else {
      return res.status(500).json({
        error: 'Failed to fetch voices'
      });
    }
  }
};

export {
  generateSpeech,
  createCustomVoice,
  addExistingVoice,
  checkSpeechStatus,
  deleteSpeech,
  deleteVoice,
  getSpeechAudio,
  getSpeechHistory,
  getVoices,
  getVoiceAudioSample,
  getExistingVoices,
  debugSpeechRecord
}
