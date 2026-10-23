const mongoose = require('mongoose');

const betsSchema = new mongoose.Schema({
  meetingName: {
    type: String,
    required: true
  },
  raceNum: {
    type: Number,
    required: true
  },
  horseNum: {
    type: Number,
    required: true
  },
  horseName: {
    type: String,
    required: true
  },
  betTime: {
    type: Date,
    required: true
  },
  clientName: {
    type: String,
    required: true
  },
  odds100: {
    type: Number,
    required: false
  },
  stake: {
    type: Number,
    required: true
  },
  books: {
    type: Number,
    required: false
  },
  f500: {
    type: Number,
    required: false
  },
  payout: {
    type: Number,
    required: true
  },
  tax: {
    type: Number,
    required: true
  },
  clientRequestId: {
    type: String,
    required: false
  },
  cancelled: {
    type: Boolean,
    required: false,
    default: false
  }
}, {
  timestamps: true
});

// Indexes for query performance
betsSchema.index({ meetingName: 1, raceNum: 1, horseNum: 1 });
betsSchema.index({ meetingName: 1, betTime: -1 });
betsSchema.index({ betTime: -1 });
betsSchema.index({ clientName: 1, betTime: -1 });
betsSchema.index({ clientRequestId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Bets', betsSchema);
