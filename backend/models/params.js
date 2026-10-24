const mongoose = require('mongoose');

const paramsSchema = new mongoose.Schema({
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
    required: false
  },
  winner: {
    type: Boolean,
    required: false,
    default: false
  },
  special: {
    type: Date,
    required: false
  },
  rule4: {
    type: Date,
    required: false
  },
  rule4deduct: {
    type: Number,
    required: false
  }
}, {
  timestamps: true,
  // the indexes are built at start-up, after leftover duplicates were removed (see lib/db.js)
  autoIndex: false
});

// Indexes for query performance
// one row per horse of a race
paramsSchema.index({ meetingName: 1, raceNum: 1, horseNum: 1 }, { unique: true });
paramsSchema.index({ meetingName: 1 });

module.exports = mongoose.model('Params', paramsSchema);
