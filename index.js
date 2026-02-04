import express from "express";
import dotenv from 'dotenv';
import cookieParser from "cookie-parser";
import cors from "cors";
import fs from "fs"; // <--- IMPORT THIS
import path from "path"; // <--- IMPORT THIS
import multer from "multer";
import { serve } from "inngest/express";

// Routes & Clients
import inngest from "./inngest/client/client.js";
import prisma from "./DB/prisma.client.js";
import userRouter from "./routes/user.routes.js";
import AuthRouter from "./routes/auth.routes.js";
import speechRouter from "./routes/speech-agent.routes.js";
import videoAgentRouter from "./routes/video-agent.routes.js";
import scriptRouter from "./routes/script.routes.js";
import adminRouter from "./routes/admin.routes.js";
import newsRouter from "./routes/news-agent.routes.js";
import { authenticateToken } from "./middlewares/auth.middleware.js";

// Inngest Functions
import { newsOptimizerFunction } from "./inngest/functions/news-agent.functions.js";
import { addCustomVoiceFunction, textToSpeechFunction } from "./inngest/functions/speech-agent.functions.js";
import { generateVideoWorkflow } from "./inngest/functions/video-agent.functions.js";
import { cleanupOldRecordsFunction } from "./inngest/functions/cleanup.functions.js";

dotenv.config();

let server = express();
let PORT = process.env.PORT || 9080;

// 1. SETUP UPLOAD DIRECTORY (CRITICAL FOR VPS)
// If this folder doesn't exist on the VPS, your app will crash on upload.
const uploadDir = './uploads/audio';
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log(`Created upload directory: ${uploadDir}`);
}

// 2. SETUP CORS
const allowedOrigins = [
  "https://app.inngest.com",
  "admixaistudio.admixmedia.in",
  "https://admixaistudio.admixmedia.in/login",
  "https://admixaistudio.admixmedia.in",
  "https://admixaistudio.admixmedia.in", 
  "https://admixaistudio.admixmedia.in", 
  "http://localhost:5173",
  "http://localhost:3000",
];

server.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200
}));


server.set('trust proxy', 1);

server.use(cookieParser());

server.get("/api/inngest", (req, res) => {
    res.json({ message: "Inngest endpoint is reachable" });
});

server.use("/api/inngest", serve({
  client: inngest,
  functions: [
    newsOptimizerFunction, 
    textToSpeechFunction, 
    addCustomVoiceFunction,
    generateVideoWorkflow,
    cleanupOldRecordsFunction 
  ]
}));

// Body Parsers (After Inngest)
server.use(express.json({ limit: '50mb' }));
server.use(express.urlencoded({ limit: '50mb', extended: true }));

// Multer Setup
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir); // Use the variable we defined above
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + '.' + file.originalname.split('.').pop());
  }
});

const upload = multer({ 
  storage: storage,
  limits: { 
    fileSize: 50 * 1024 * 1024, 
    files: 25 
  }
});
server.locals.upload = upload;

// --- ROUTES ---
server.use("/api/v1/auth", AuthRouter);
server.use("/api/v1/user/register-email", userRouter); 
server.use("/api/v1/user", userRouter);

// Protected Routes
server.use("/api/v1/admin", adminRouter);
server.use("/api/v1/agent", authenticateToken, newsRouter);
server.use("/api/v1/scripts", scriptRouter); // Make sure you want this public? If not, add authenticateToken
server.use("/api/v1/speech", speechRouter);   
server.use("/api/v1/video", videoAgentRouter); 

// Root check
server.get("/", (req, res) => {
    res.send("API is running...");
});

server.listen(PORT, () => {
  console.log(`🚀 Server is Running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
});