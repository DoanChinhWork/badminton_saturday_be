const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const config = require('../config');

const authController = {
  /**
   * POST /api/auth/login
   * Body: { username, password }
   */
  login: async (req, res) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ message: 'Vui lòng nhập username và password' });
      }

      const admin = await Admin.findOne({ username: username.toLowerCase() });
      if (!admin) {
        return res.status(401).json({ message: 'Tài khoản không tồn tại' });
      }

      const isMatch = await bcrypt.compare(password, admin.password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Mật khẩu không chính xác' });
      }

      const accountRole = admin.username?.toLowerCase() === 'admin' ? 'scorer' : (admin.role || 'admin');

      const token = jwt.sign(
        { id: admin._id, username: admin.username, role: accountRole },
        config.JWT_SECRET,
        { expiresIn: config.JWT_EXPIRES }
      );

      res.status(200).json({
        success: true,
        token,
        admin: {
          id: admin._id,
          username: admin.username,
          name: admin.name,
          role: accountRole
        }
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ message: 'Lỗi server' });
    }
  },

  /**
   * GET /api/auth/me
   * Verify token and return admin info
   */
  getMe: async (req, res) => {
    try {
      const admin = await Admin.findById(req.admin.id).select('-password');
      if (!admin) {
        return res.status(404).json({ message: 'Admin not found' });
      }
      const adminObj = admin.toObject();
      adminObj.role = admin.username?.toLowerCase() === 'admin' ? 'scorer' : (admin.role || 'admin');
      res.status(200).json({ success: true, admin: adminObj });
    } catch (error) {
      console.error('GetMe error:', error);
      res.status(500).json({ message: 'Lỗi server' });
    }
  }
};

module.exports = authController;
