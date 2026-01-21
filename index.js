import express from "express"
import dotenv from 'dotenv'
import userRouter from "./routes/user.routes.js"
import cookieParser from "cookie-parser"
import prisma from "./DB/prisma.client.js"
import { serve } from "inngest/express"
import { newsOptimizerFunction } from "./inngest/functions/news-agent.functions.js"
import inngest from "./inngest/client/client.js"
import cors from "cors"
import AuthRouter from "./routes/auth.routes.js"
import { addCustomVoiceFunction, textToSpeechFunction } from "./inngest/functions/speech-agent.functions.js"
import { generateVideoWorkflow } from "./inngest/functions/video-agent.functions.js"
import speechRouter from "./routes/speech-agent.routes.js"
import multer from "multer"
import videoAgentRouter from "./routes/video-agent.routes.js"
import scriptRouter from "./routes/script.routes.js"
import { cleanupOldRecordsFunction } from "./inngest/functions/cleanup.functions.js"
import { authenticateToken, authorizeRoles } from "./middlewares/auth.middleware.js"
import adminRouter from "./routes/admin.routes.js"
import newsRouter from "./routes/news-agent.routes.js"

dotenv.config()
let server = express()
let PORT = process.env.PORT || 8080

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5173/select-avatar",
  "http://localhost:3000",
];

server.use(cors({
  origin: function (origin, callback) {
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

server.use(cookieParser())
server.use(express.json({ limit: '50mb' }));
server.use(express.urlencoded({ limit: '50mb', extended: true }));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, './uploads/audio');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + '.' + file.originalname.split('.').pop());
  }
});

const upload = multer({ 
  storage: storage,
  limits: { 
    fileSize: 50 * 1024 * 1024, // 50MB per file
    files: 25 // Max 25 files
  }
});

server.locals.upload = upload;

// Register Inngest functions
server.use("/api/inngest", serve({
  client: inngest,
  functions: [
    newsOptimizerFunction, 
    textToSpeechFunction, 
    addCustomVoiceFunction,
    generateVideoWorkflow,
    cleanupOldRecordsFunction 
  ]
}))

server.use("/api/v1/auth", AuthRouter);
server.use("/api/v1/user/register-email", userRouter); 

server.use("/api/v1/admin", adminRouter)

server.use("/api/v1/user", userRouter);
server.use("/api/v1/agent", authenticateToken, newsRouter);
server.use("/api/v1/scripts", scriptRouter); 
server.use("/api/v1/speech", speechRouter);   
server.use("/api/v1/video", videoAgentRouter); 

server.listen(PORT, () => {
  console.log(`🚀 Server is Running on port ${PORT}`);
});
