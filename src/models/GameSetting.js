const mongoose = require('mongoose');

const gameSettingSchema = new mongoose.Schema({
  mode: {
    type: String,
    enum: ['auto', 'manual'],
    default: 'auto'
  },
  manualGame: {
    type: String,
    enum: ['wheel', 'cards', 'boxes'],
    default: 'wheel'
  },
  spinsPerWeek: {
    type: Number,
    default: 1,
    min: 1
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('GameSetting', gameSettingSchema);
