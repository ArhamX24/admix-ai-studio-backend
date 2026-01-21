import express from "express";
import { addNewUserThroughEmail, getUserAgentQueries } from "../controllers/user.controllers.js";

let userRouter = express.Router()


userRouter.post("/register-email", addNewUserThroughEmail)
.get("/get-agent-queries", getUserAgentQueries)

export default userRouter