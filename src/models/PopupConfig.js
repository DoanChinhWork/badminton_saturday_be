const mongoose = require('mongoose');

// Single-document config for the "Season result" congratulation popup
const popupConfigSchema = new mongoose.Schema({
  isActive: {
    type: Boolean,
    default: true
  },
  // Optional window; null means open-ended on that side
  startAt: {
    type: Date,
    default: null
  },
  endAt: {
    type: Date,
    default: null
  },
  // Post the popup's "Xem chi tiết" link jumps to (/news?post=<id>); empty = just /news
  postId: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('PopupConfig', popupConfigSchema);
