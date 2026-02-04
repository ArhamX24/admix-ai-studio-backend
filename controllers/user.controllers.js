'use strict'
import prisma from "../DB/prisma.client.js"
import bcrypt from "bcrypt"
import jwt from "jsonwebtoken"
import zod from "zod"
import { statusCodes } from "../utils/statuscodes.js"

// Zod validation with role
let userDataValidation = zod.object({
  email: zod.string().email("Invalid email address"),
  password: zod.string().min(8, {message: "Password must be min 8 characters"}),
  role: zod.string().optional() // Optional role from body
})

const generateTokens = (id, role) => {
  const accessToken = jwt.sign({userId:id, role}, process.env.ACCESS_TOKEN_SECRET, {expiresIn: "15m"})
  const refreshToken = jwt.sign({userId:id, role}, process.env.REFRESH_TOKEN_SECRET, {expiresIn: "30d"})
  return {accessToken, refreshToken}
}

const cookieOption = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000 // 30d
}

// ✅ Role mapping from request body
const mapRoleFromBody = (bodyRole) => {
  const roleMap = {
    'video': 'VIDEO_GENERATOR',
    'news': 'NEWS_GENERATOR', 
    'audio': 'VOICE_GENERATOR',
    'voice': 'VOICE_GENERATOR',
    'script': 'SCRIPT_WRITER',
    'admin': 'ADMIN'
  }
  
  return roleMap[bodyRole?.toLowerCase()] || 'USER' 
}

export const addNewUserThroughEmail = async (req, res) => {


  let { email, password, role: bodyRole } = req.body;
  
  try {
    // Validate input
    let validateData = userDataValidation.safeParse({email, password, role: bodyRole});
    if (!validateData.success) {
      let jsonData = JSON.parse(validateData.error.message);
      return res.status(400).json({ success: false, message: jsonData[0].message });
    }

    // Check existing user
    let existingUser = await prisma.user.findFirst({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ success: false, message: "Email Already Exists" });
    }

    // ✅ Map body role to database role
    const dbRole = mapRoleFromBody(bodyRole);

    let salt = await bcrypt.genSalt(10);
    let hashedPass = await bcrypt.hash(password, salt);

    let newUser = await prisma.user.create({
      data: { 
        email, 
        password: hashedPass, 
        role: dbRole 
      }
    });


    return res.status(201)
      .json({ 
        success: true, 
        message: `User Created with role: ${dbRole}`, 
        user: {
          id: newUser.id,
          email: newUser.email,
          role: newUser.role
        }
      });
  } catch (error) {
    console.error('User creation error:', error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getProfile = async (req, res) => {
  try {
    const userId = req.user.id; // From auth middleware
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        assignedRole: {
          select: { roleType: true, isActive: true }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        assignedRole: user.assignedRole?.roleType || null,
        isActive: user.assignedRole?.isActive || true
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getUserAgentQueries = async (req, res) => {
  try {
    const userId = req.user.id;
    let userQueries = await prisma.generatedContent.findMany({
      where: { userId },
      select: { inputText: true, generatedText: true, contentType: true, createdAt: true }
    });
    return res.json({ success: true, data: userQueries });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
