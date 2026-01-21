import express from "express";
import { upload } from "../middlewares/upload.js";

import {
  getSpeechAudio,
  getSpeechHistory,
  getVoices,
  getVoiceAudioSample,
  generateSpeech,
  createCustomVoice,
  addExistingVoice,
  checkSpeechStatus,
  deleteSpeech,
  deleteVoice,
  getExistingVoices,
  debugSpeechRecord
} from "../controllers/speech.controllers.js";
import { authenticateToken, authorizeRoles } from "../middlewares/auth.middleware.js";

const speechRouter = express.Router();

// GET ROUTES - Specific routes FIRST
speechRouter
  .get("/voices/existing", getExistingVoices)
  .get("/voices/samples/:id/audio", getVoiceAudioSample)
  .get("/history", authenticateToken, getSpeechHistory) // Protected with auth
  .get("/voices", getVoices)
  .get("/:id/audio", getSpeechAudio)

  // POST ROUTES
  .post("/generate", authenticateToken, generateSpeech) // Removed duplicate authenticateToken
  .post("/voices/create", upload.array("audioFiles", 25), createCustomVoice)
  .post("/voices/add", addExistingVoice)
  .post("/status", authenticateToken, checkSpeechStatus)
  .post("/delete", authenticateToken, deleteSpeech) // Protected with auth
  .post("/voices/delete", deleteVoice)
  .post("/debug/speech", debugSpeechRecord);

export default speechRouter;