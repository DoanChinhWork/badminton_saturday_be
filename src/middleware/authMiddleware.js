const jwt = require('jsonwebtoken');
const config = require('../config');

const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: 'Authorization header is required' });
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return res.status(401).json({ message: 'Invalid authorization format. Use: Bearer <token>' });
    }

    const token = parts[1];
    const decoded = jwt.verify(token, config.JWT_SECRET);

    if (decoded.role === 'user') {
      req.user = {
        id: decoded.id,
        username: decoded.username,
        role: 'user'
      };
    } else {
      const resolvedRole = decoded.username === 'admin' ? 'scorer' : (decoded.role || 'admin');
      req.admin = {
        id: decoded.id,
        username: decoded.username,
        role: resolvedRole
      };
      req.user = req.admin;
    }

    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

module.exports = authMiddleware;
