import express from "express";
import {getAllUsers, deleteUser, assignRole, updateUser } from "../controllers/admin.controllers.js";
import { authenticateToken, authorizeRoles } from '../middlewares/auth.middleware.js'

const adminRouter = express.Router();

// All admin routes should be protected
adminRouter.use(authenticateToken);
adminRouter.use(authorizeRoles(['ADMIN']));

// Admin routes
adminRouter.get("/get-all-users", getAllUsers);
adminRouter.put("/update-user/:id", updateUser); // Changed from :userId to :id
adminRouter.delete("/delete-user/:id", deleteUser); // Changed from :userId to :id
adminRouter.post("/assign-role", assignRole);

export default adminRouter;