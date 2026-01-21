import express from "express";
import { getMe, login, logout, refreshToken } from "../controllers/auth.controllers.js";
import { authenticateToken } from "../middlewares/auth.middleware.js";

let AuthRouter = express.Router();


AuthRouter.post("/login",login)
.get("/me",authenticateToken ,getMe)
.post("/refresh", refreshToken)
.post("/logout", logout)

export default AuthRouter