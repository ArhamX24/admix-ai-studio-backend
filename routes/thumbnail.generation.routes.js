import express from "express";
import {
  generateThumbnail,
  refineThumbnail,
} from "../controllers/thumbnail.generation.controllers.js";
import { authenticateToken } from "../middlewares/auth.middleware.js";

const thumbnailRouter = express.Router();

thumbnailRouter.post("/generate", generateThumbnail);
thumbnailRouter.post("/refine", refineThumbnail);

export default thumbnailRouter;