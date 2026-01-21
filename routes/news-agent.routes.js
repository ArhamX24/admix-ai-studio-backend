import express from "express";
import { getNewsStatus, newsWorkGenerator } from "../controllers/news-agent.controllers.js";

const newsRouter = express.Router();


newsRouter.post("/generated-content", newsWorkGenerator)
.get("/generated-result/:runId", getNewsStatus)

export default newsRouter