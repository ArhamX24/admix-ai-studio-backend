import express from "express";
import multer from "multer";
import {
  generateThumbnail,
  refineThumbnail,
} from "../controllers/thumbnail.generation.controllers.js";
import { authenticateToken } from "../middlewares/auth.middleware.js";

const upload = multer({ storage: multer.memoryStorage() });
const thumbnailRouter = express.Router();

// Add upload.single("referenceImage") to handle the image file
thumbnailRouter.post("/generate", authenticateToken, upload.single("referenceImage"), generateThumbnail);
thumbnailRouter.post("/refine", authenticateToken, upload.single("referenceImage"), refineThumbnail);

export default thumbnailRouter;