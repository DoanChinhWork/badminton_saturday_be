const mongoose = require('mongoose');

const AdminSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true
  },
  name: {
    type: String,
    default: 'Admin'
  },
  role: {
    type: String,
    enum: ['admin', 'scorer'],
    default: 'admin'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Admin', AdminSchema);
