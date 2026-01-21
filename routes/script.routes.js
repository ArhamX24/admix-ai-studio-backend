import express from "express";
import {
  createScript,
  getScripts,
  getScriptById,
  updateScript,
  deleteScript,
  getScriptsForVoiceOver,
} from "../controllers/script.controllers.js";
import { authenticateToken, authorizeRoles } from "../middlewares/auth.middleware.js";

const scriptRouter = express.Router();

scriptRouter
  // Create script - only SCRIPT_WRITER can create
  .post("/create", authenticateToken, authorizeRoles(['SCRIPT_WRITER', 'ADMIN']), createScript)
  
  // Get all scripts - SCRIPT_WRITER sees their own, AUDIO_GENERATOR sees all
  .get("/get-scripts", authenticateToken, getScripts)

  .get('/get-scripts-for-voice-over', authenticateToken, getScriptsForVoiceOver)
  
  // Get single script by ID
  .get("/get-single-script/:id", authenticateToken, getScriptById)
  
  // Update script - only SCRIPT_WRITER can update their own scripts
  .put("/update-script/:id", authenticateToken, authorizeRoles(['SCRIPT_WRITER', 'ADMIN']), updateScript)
  
  // Delete script - only SCRIPT_WRITER can delete their own scripts
  .delete("/delete-script/:id", authenticateToken, authorizeRoles(['SCRIPT_WRITER', 'ADMIN']), deleteScript);

export default scriptRouter;