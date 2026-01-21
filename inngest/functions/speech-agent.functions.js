import inngest from "../client/client.js";
import prisma from "../../DB/prisma.client.js";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY
});

const supabase = createClient(
  process.env.SUPABASE_PROJECT_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Helper function to convert stream to buffer
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// Text-to-Speech Function
const textToSpeechFunction = inngest.createFunction(
  { id: "text-to-speech-generation" },
  { event: "tts/convert" },
  async ({ event, step }) => {
    const {
      text,
      voiceId,
      voiceRecordId,
      userId,
      language,
      voiceSettings,
      scriptId 
    } = event.data;

    // Create speech history record
    const speechRecord = await step.run("create-speech-record", async () => {
      return await prisma.speechHistory.create({
        data: {
          text,
          language,
          status: "PROCESSING",
          userId,
          voiceId: voiceRecordId,
          scriptId,
          stability: voiceSettings.stability,
          similarityBoost: voiceSettings.similarity_boost,
          style: voiceSettings.style,
          useSpeakerBoost: voiceSettings.use_speaker_boost,
        },
      });
    });

    try {
      // Generate speech and upload in a SINGLE step to avoid serialization issues
      const uploadResult = await step.run("generate-and-upload", async () => {
        // Generate audio
        const response = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "xi-api-key": process.env.ELEVENLABS_API_KEY,
            },
            body: JSON.stringify({
              text,
              model_id: "eleven_multilingual_v2",
              voice_settings: voiceSettings,
            }),
          }
        );

        if (!response.ok) {
          throw new Error(`ElevenLabs API error: ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = Buffer.from(arrayBuffer);
        
        // Upload to Supabase immediately
        const fileName = `speech-${speechRecord.id}-${Date.now()}.mp3`;
        const filePath = `speeches/${userId}/${fileName}`;

        const { data, error } = await supabase.storage
          .from('speech-audio')
          .upload(filePath, audioBuffer, {
            contentType: 'audio/mpeg',
            cacheControl: '3600',
          });

        if (error) throw error;

        const { data: publicUrlData } = supabase.storage
          .from('speech-audio')
          .getPublicUrl(filePath);

        return {
          publicUrl: publicUrlData.publicUrl,
          fileSize: audioBuffer.length,
        };
      });

      // Update speech record with success
      await step.run("update-speech-record", async () => {
        return await prisma.speechHistory.update({
          where: { id: speechRecord.id },
          data: {
            status: "COMPLETED",
            audioFilePath: uploadResult.publicUrl,
            fileSize: uploadResult.fileSize,
          },
        });
      });

      if (scriptId) {
        await step.run("update-script-voice-status", async () => {
          return await prisma.script.update({
            where: { id: scriptId },
            data: { isVoiceGenerated: true },
          });
        });
      }

      return {
        success: true,
        speechId: speechRecord.id,
        audioUrl: uploadResult.publicUrl,
      };

    } catch (error) {
      await step.run("update-speech-error", async () => {
        return await prisma.speechHistory.update({
          where: { id: speechRecord.id },
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

// Add Custom Voice Function
const addCustomVoiceFunction = inngest.createFunction(
  { id: "add-custom-voice" },
  { event: "tts/add-voice" },
  async ({ event, step }) => {
    const { name, audioFilePaths, description, labels, userId, language, accent } = event.data;

    const uploadedSamples = await step.run("upload-audio-samples", async () => {
      const uploads = [];
      
      for (let i = 0; i < audioFilePaths.length; i++) {
        const localPath = audioFilePaths[i];
        
        try {
          const fileBuffer = fs.readFileSync(localPath);
          
          const fileName = `${Date.now()}_${i}.mp3`;
          const filePath = `voice-samples/${userId}/${fileName}`;
          
          const { data, error } = await supabase.storage
            .from('speech-audio')
            .upload(filePath, fileBuffer, {
              contentType: 'audio/mpeg',
              upsert: true
            });

          if (error) {
            throw new Error(`Failed to upload sample ${i}: ${error.message}`);
          }

          const { data: { publicUrl } } = supabase.storage
            .from('speech-audio')
            .getPublicUrl(filePath);

          uploads.push({
            fileName: fileName,
            filePath: publicUrl,
            fileSize: fileBuffer.length,
            localPath: localPath,
          });
        } catch (err) {
          console.error(`Error processing file ${localPath}:`, err);
          throw err;
        }
      }
      
      return uploads;
    });

    const elevenLabsVoiceId = await step.run("clone-voice-elevenlabs", async () => {
      const FormData = (await import('form-data')).default;
      const formData = new FormData();

      formData.append('name', name);
      formData.append('remove_background_noise', 'true');

      if (description) formData.append('description', description);
      if (labels) formData.append('labels', JSON.stringify(labels));

      for (let i = 0; i < uploadedSamples.length; i++) {
        const sample = uploadedSamples[i];
        
        if (fs.existsSync(sample.localPath)) {
          const fileStream = fs.createReadStream(sample.localPath);
          
          formData.append('files', fileStream, {
            filename: sample.fileName,
            contentType: 'audio/mpeg'
          });
        } else {
          // Warning: In serverless, local files might vanish between steps.
          // Ideally, download from Supabase URL here instead of using localPath.
          throw new Error(`File not found: ${sample.localPath}`);
        }
      }

      const axios = (await import('axios')).default;
      
      try {
        const response = await axios.post(
          'https://api.elevenlabs.io/v1/voices/add',
          formData,
          {
            headers: {
              'xi-api-key': process.env.ELEVENLABS_API_KEY,
              ...formData.getHeaders()
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity
          }
        );


        for (const sample of uploadedSamples) {
          try {
            if (fs.existsSync(sample.localPath)) {
              fs.unlinkSync(sample.localPath);
            }
          } catch (err) {
            console.warn(`Could not delete local file: ${sample.localPath}`);
          }
        }

        return response.data.voice_id;
      } catch (error) {
        // Clean up even on error
        for (const sample of uploadedSamples) {
           try { if (fs.existsSync(sample.localPath)) fs.unlinkSync(sample.localPath); } catch (e) {}
        }
        console.error('ElevenLabs API Error:', error.response?.data || error.message);
        throw new Error(`Failed to clone voice: ${JSON.stringify(error.response?.data || error.message)}`);
      }
    });

    const voiceRecord = await step.run("save-voice-to-db", async () => {
      return await prisma.voice.create({
        data: {
          voiceId: elevenLabsVoiceId,
          name,
          description,
          language: language || "multilingual",
          accent,
          labels: labels || {},
          isCustom: true,
          userId,
          audioSamples: {
            create: uploadedSamples.map((sample) => ({
              audioData: Buffer.from(''),
              fileName: sample.fileName,
              fileSize: sample.fileSize,
              audioFilePath: sample.filePath,
              mimeType: "audio/mpeg",
            })),
          },
        },
        include: {
          audioSamples: true,
        },
      });
    });

    return {
      success: true,
      voiceId: voiceRecord.voiceId,
      voiceName: voiceRecord.name,
      samplesCount: voiceRecord.audioSamples.length,
    };
  }
);

export { addCustomVoiceFunction, textToSpeechFunction };