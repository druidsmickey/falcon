const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  meetingName: {
    type: String,
    required: true
  },
  clientName: {
    type: String,
    required: true
  },
  horseName: {
    type: String,
    required: false,
    default: 'AddOn'
  },
  stake: {
    type: Number,
    required: true
  },
  betTime: {
    type: Date,
    required: true
  }
}, {
  timestamps: true
});

// One add-on record per client per meeting
reportSchema.index({ meetingName: 1, clientName: 1 }, { unique: true });

module.exports = mongoose.model('Report', reportSchema);
