import prisma from "../DB/prisma.client.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { statusCodes } from "../utils/statuscodes.js";

const generateTokens = (id, role) => {
  const accessToken = jwt.sign({ userId: id, role }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "15m" });
  const refreshToken = jwt.sign({ userId: id, role }, process.env.REFRESH_TOKEN_SECRET, { expiresIn: "30d" });
  return { accessToken, refreshToken };
};

const cookieOption = {
  httpOnly: true,
  secure: false,
  sameSite: "lax",
  maxAge: 30 * 24 * 60 * 60 * 1000 // 30d
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const existingUser = await prisma.user.findFirst({
      where: { email },
      include: { assignedRole: true }
    });

    if (!existingUser) {
      return res.status(404).json({ success: false, message: "Email Not Found" });
    }

    const checkPassword = await bcrypt.compare(password, existingUser.password);
    if (!checkPassword) {
      return res.status(400).json({ success: false, message: "Incorrect Password" });
    }

    const { accessToken, refreshToken } = generateTokens(existingUser.id, existingUser.role);
    
    await prisma.user.update({
      where: { id: existingUser.id },
      data: { refreshToken }
    });

    return res.status(200)
      .cookie("refreshToken", refreshToken, cookieOption)
      .json({
        success: true,
        message: "Login Success",
        token: accessToken,
        user: {
          id: existingUser.id,
          email: existingUser.email,
          role: existingUser.role,
          assignedRole: existingUser.assignedRole?.roleType || null
        }
      });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};


export const getMe = async (req, res) => {
  try {
    const userId = req.user.id; 
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
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
    console.error('getMe error:', error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Add this to your existing auth.controllers.js
export const refreshToken = async (req, res) => {
  try {
    const refreshTokenCookie = req.cookies.refreshToken;
    
    if (!refreshTokenCookie) {
      return res.status(401).json({ success: false, message: "No refresh token" });
    }

    const decoded = jwt.verify(refreshTokenCookie, process.env.REFRESH_TOKEN_SECRET);
    const userId = decoded.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, assignedRole: true }
    });

    if (!user || user.refreshToken !== refreshTokenCookie) {
      return res.status(403).json({ success: false, message: "Invalid refresh token" });
    }

    const { accessToken } = generateTokens(user.id, user.role);

    return res
      .cookie("accessToken", accessToken, { 
        httpOnly: false, secure: false, sameSite: 'lax', maxAge: 15 * 60 * 1000 
      })
      .json({
        success: true,
        token: accessToken,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          assignedRole: user.assignedRole?.roleType || null
        }
      });
  } catch (error) {
    console.error('Refresh token error:', error);
    return res.status(401).json({ success: false, message: "Refresh token invalid" });
  }
};

export const logout = async (req, res) => {
  try {
    const cookieOption = {
        httpOnly: true,
        secure: false,
        sameSite: "lax"
    };

    return res
      .status(200)
      .clearCookie("accessToken", cookieOption)
      .clearCookie("refreshToken", cookieOption)
      .json({ success: true, message: "Logged out successfully" });

  } catch (error) {
    console.error("Logout Error:", error);
    return res.status(500).json({ success: false, message: "Logout failed" });
  }
};