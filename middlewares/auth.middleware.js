import jwt from "jsonwebtoken";
import prisma from "../DB/prisma.client.js";

export const authenticateToken = async (req, res, next) => {
  try {
    // 1. Directly get the token from cookies
    const token = req.cookies?.refreshToken;

    if (!token) {
      return res.status(401).json({ success: false, message: "No session found. Please login." });
    }

    // 2. Verify the Refresh Token directly

    const decoded = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);

    // 3. Find the user based on the decoded ID
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { assignedRole: true }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: "User account not found." });
    }

    // 4. Attach user to the request object
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      assignedRole: user.assignedRole?.roleType || null
    };

    next();

  } catch (error) {
    return res.status(403).json({ success: false, message: "Session expired or invalid." });
  }
};

export const authorizeRoles = (allowedRoles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const userRoles = [req.user.role];
    if (req.user.assignedRole) userRoles.push(req.user.assignedRole);

    if (!allowedRoles.some(role => userRoles.includes(role))) {
      return res.status(403).json({ success: false, message: "Insufficient permissions" });
    }

    next();
  };
};
