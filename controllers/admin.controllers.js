import prisma from "../DB/prisma.client.js"
import bcrypt from "bcrypt"

export const assignRole = async (req, res) => {
  try {
    const { userId, roleType } = req.body;

    if (!userId || !roleType) {
      return res.status(400).json({
        success: false,
        message: "userId and roleType are required"
      });
    }

    // Validate roleType
    const validRoles = ['VIDEO_GENERATOR', 'NEWS_GENERATOR', 'VOICE_GENERATOR', 'SCRIPT_WRITER', 'AUDIO_GENERATOR'];
    if (!validRoles.includes(roleType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role type"
      });
    }

    const existingRole = await prisma.assignedRole.findUnique({
      where: { userId },
    });

    if (existingRole) {
      const updatedRole = await prisma.assignedRole.update({
        where: { userId },
        data: { roleType, isActive: true },
      });
      return res.json({
        success: true,
        message: "Role updated successfully",
        role: updatedRole,
      });
    }

    const newRole = await prisma.assignedRole.create({
      data: {
        userId,
        roleType,
      },
    });

    res.json({
      success: true,
      message: "Role assigned successfully",
      role: newRole,
    });
  } catch (error) {
    console.error('Assign role error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getAllUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: {
        role: {
          not: 'ADMIN'
        }
      },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        assignedRole: true,
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    res.json({
      success: true,
      users,
    });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { email, password, roleType } = req.body;

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id },
      include: {
        assignedRole: true
      }
    });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Prepare update data for user table
    const updateData = {};

    if (email && email !== existingUser.email) {
      // Check if email is already taken by another user
      const emailExists = await prisma.user.findFirst({
        where: {
          email,
          id: { not: id }
        }
      });

      if (emailExists) {
        return res.status(400).json({
          success: false,
          message: "Email already in use"
        });
      }

      updateData.email = email;
    }

    if (password) {
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(password, salt);
    }

    // ✅ IMPORTANT: Update the main role field in user table if roleType is provided
    if (roleType) {
      const validRoles = ['VIDEO_GENERATOR', 'NEWS_GENERATOR', 'VOICE_GENERATOR', 'SCRIPT_WRITER', 'AUDIO_GENERATOR'];
      
      if (!validRoles.includes(roleType)) {
        return res.status(400).json({
          success: false,
          message: "Invalid role type"
        });
      }

      // Update the main role field
      updateData.role = roleType;
    }

    // Update user basic info (email, password, and main role field)
    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({
        where: { id },
        data: updateData,
      });
    }

    // Update or create assignedRole
    if (roleType) {
      // Check if user has an assigned role
      if (existingUser.assignedRole) {
        // Update existing assigned role
        await prisma.assignedRole.update({
          where: { userId: id },
          data: { 
            roleType,
            isActive: true 
          },
        });
      } else {
        // Create new assigned role
        await prisma.assignedRole.create({
          data: {
            userId: id,
            roleType,
            isActive: true
          },
        });
      }
    }

    // Fetch updated user with assigned role
    const updatedUser = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        role: true,
        assignedRole: true,
        createdAt: true
      }
    });

    res.json({
      success: true,
      message: "User updated successfully",
      user: updatedUser
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id }
    });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Prevent deleting admin users
    if (existingUser.role === 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: "Cannot delete admin users"
      });
    }

    // Delete user (this will cascade delete assignedRole due to onDelete: Cascade)
    await prisma.user.delete({ 
      where: { id } 
    });

    res.json({
      success: true,
      message: "User deleted successfully"
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};