import express from "express"
import { 
  createVideo, 
  fetchAvatars, 
  fetchVoices, 
  checkVideoStatus,
  getUserVideos,
  deleteVideo
} from "../controllers/video-agent.controllers.js"
import { authenticateToken, authorizeRoles } from "../middlewares/auth.middleware.js"

const videoAgentRouter = express.Router()

videoAgentRouter
  .get("/fetch-avatars", authenticateToken, authorizeRoles(['ADMIN', 'VIDEO_GENERATOR']), fetchAvatars)
  .get("/fetch-voices", authenticateToken, authorizeRoles(['ADMIN', 'VIDEO_GENERATOR']),  fetchVoices)
  .get("/history/:userId", authenticateToken, authorizeRoles(['ADMIN', 'VIDEO_GENERATOR']), getUserVideos)
  .post("/create", authenticateToken, authorizeRoles(['ADMIN', 'VIDEO_GENERATOR']), createVideo)
  .post("/status",  authenticateToken, authorizeRoles(['ADMIN', 'VIDEO_GENERATOR']), checkVideoStatus)
  .post("/delete", authenticateToken, authorizeRoles(['ADMIN', 'VIDEO_GENERATOR']), deleteVideo)

export default videoAgentRouter