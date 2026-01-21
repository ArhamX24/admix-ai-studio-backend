import inngest from "../client/client.js";
import prisma from "../../DB/prisma.client.js";
import axios from "axios";
import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

export const generateVideoWorkflow = inngest.createFunction(
  { id: "generate-heygen-video" },
  { event: "video/generation.requested" },
  async ({ event, step }) => {
    
    // Step 1: Create initial DB record
    const videoRecord = await step.run("create-video-record", async () => {
      return await prisma.video.create({
        data: {
          userId: event.data.userId,
          status: "PENDING",
          avatarId: event.data.avatarId,
          voiceId: event.data.voiceId,
          script: event.data.script,
          duration: event.data.duration || "Auto",
          language: "hi"
        }
      });
    });


    try {
      // Step 2: Generate audio using ElevenLabs and upload to Cloudinary
      const audioResult = await step.run("generate-and-upload-audio", async () => {
        
        try {
          // Generate audio from ElevenLabs
          const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${event.data.voiceId}`,
            {
              text: event.data.script,
              model_id: "eleven_multilingual_v2",
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.8,
                style: 0.0,
                use_speaker_boost: true
              }
            },
            {
              headers: {
                'xi-api-key': process.env.ELEVENLABS_API_KEY,
                'Content-Type': 'application/json',
                'Accept': 'audio/mpeg'
              },
              responseType: 'arraybuffer'
            }
          );

          const audioBuffer = Buffer.from(response.data);

          
          // Upload audio buffer to Cloudinary
          const uploadResult = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
              {
                resource_type: "video", // Audio files use 'video' resource type
                folder: "heygen_audio",
                public_id: `audio_${videoRecord.id}`,
                format: "mp3"
              },
              (error, result) => {
                if (error) {
                  console.error('Cloudinary upload error:', error);
                  reject(error);
                } else {
                  console.log('Audio uploaded to Cloudinary:', result.secure_url);
                  resolve(result);
                }
              }
            );
            
            // Write buffer to stream
            uploadStream.end(audioBuffer);
          });
          
          return {
            audioUrl: uploadResult.secure_url,
            publicId: uploadResult.public_id
          };
        } catch (error) {
          console.error('Audio generation/upload error:', error.response?.data || error.message);
          throw new Error(`Failed to generate/upload audio: ${error.response?.data?.detail?.message || error.message}`);
        }
      });

      // Step 3: Call HeyGen API to generate video with audio URL
      const heygenResponse = await step.run("request-heygen-generation", async () => {

        
        try {
          const response = await axios.post(
            "https://api.heygen.com/v2/video/generate",
            {
              video_inputs: [{
                character: {
                  type: "avatar",
                  avatar_id: event.data.avatarId,
                  avatar_style: "normal"
                },
                voice: {
                  type: "audio",
                  audio_url: audioResult.audioUrl  // ✅ Real Cloudinary URL
                },
                background: {
                  type: "color",
                  value: "#FFFFFF"
                }
              }],
              dimension: {
                width: 1280,
                height: 720
              },
              aspect_ratio: "16:9",
              test: false,
              caption: false
            },
            {
              headers: {
                'X-Api-Key': process.env.HEYGEN_API_KEY,
                'Content-Type': 'application/json'
              }
            }
          );
          
          return response.data.data;
        } catch (error) {
          console.error('HeyGen API Error:', error.response?.data || error.message);
          throw new Error(`Failed to start HeyGen generation: ${error.response?.data?.message || error.message}`);
        }
      });

      // Step 4: Update DB with HeyGen video ID
      await step.run("save-heygen-id", async () => {
        return await prisma.video.update({
          where: { id: videoRecord.id },
          data: { 
            heygenVideoId: heygenResponse.video_id,
            status: "PROCESSING" 
          }
        });
      });


      // Step 5: Poll for completion (wait and check status)
      const completedVideo = await step.run("poll-video-status", async () => {
        let attempts = 0;
        const maxAttempts = 60; // 60 * 30s = 30 minutes max
        
        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 30000));
          
          try {
            const statusResponse = await axios.get(
              `https://api.heygen.com/v1/video_status.get?video_id=${heygenResponse.video_id}`,
              {
                headers: {
                  'X-Api-Key': process.env.HEYGEN_API_KEY,
                  'Accept': 'application/json'
                }
              }
            );
            
            const status = statusResponse.data.data.status;
            
            if (status === "completed") {
              return statusResponse.data.data;
            } else if (status === "failed") {
              throw new Error(statusResponse.data.data.error || "Video generation failed");
            }
            
            attempts++;
          } catch (error) {
            if (error.message.includes("failed")) {
              throw error;
            }
            console.warn(`Status check failed (attempt ${attempts + 1}): ${error.message}`);
            attempts++;
          }
        }
        
        throw new Error("Video generation timeout - exceeded 30 minutes");
      });

      // Step 6: Save final video URL
      const finalVideo = await step.run("save-video-url", async () => {
        const deleteAt = new Date();
        deleteAt.setDate(deleteAt.getDate() + 7);
        
        return await prisma.video.update({
          where: { id: videoRecord.id },
          data: {
            status: "COMPLETED",
            videoUrl: completedVideo.video_url,
            thumbnailUrl: completedVideo.thumbnail_url,
            videoDuration: completedVideo.duration,
            deleteAt: deleteAt
          }
        });
      });

      // Step 7: Clean up Cloudinary audio file (optional)
      await step.run("cleanup-audio", async () => {
        try {
          await cloudinary.uploader.destroy(audioResult.publicId, { 
            resource_type: "video" 
          });
          console.log(`Cleaned up audio file: ${audioResult.publicId}`);
        } catch (error) {
          console.warn(`Failed to cleanup audio: ${error.message}`);
        }
      });


      return { 
        success: true, 
        videoId: finalVideo.id,
        videoUrl: finalVideo.videoUrl 
      };
      
    } catch (error) {
      console.error("Video generation error:", error.message);
      
      await step.run("update-error-status", async () => {
        return await prisma.video.update({
          where: { id: videoRecord.id },
          data: {
            status: "FAILED",
            errorMessage: error.message,
          },
        });
      });

      throw error;
    }
  }
);
