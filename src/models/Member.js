const mongoose = require('mongoose');

const MemberSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  memberCode: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  amountDue: {
    type: Number,
    default: 0,
    min: 0
  },
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'paid'],
    default: 'paid'
  },
  weekLabel: {
    type: String,
    default: ''
  },
  note: {
    type: String,
    default: ''
  },
  username: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String
  },
  isFirstLogin: {
    type: Boolean,
    default: true
  },
  avatarUrl: {
    type: String,
    default: ''
  },
  avatarPublicId: {
    type: String,
    default: ''
  },
  spinCount: {
    type: Number,
    default: 0
  },
  customSpinsPerWeek: {
    type: Number,
    default: null
  },
  lastSpinDate: {
    type: Date
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Member', MemberSchema);
