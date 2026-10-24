const mongoose = require('mongoose');

const initSchema = new mongoose.Schema({
  raceNum: {
    type: Number,
    required: true
  },
  numHorse: {
    type: Number,
    required: true
  },
  raceName: {
    type: String,
    required: true
  },
  meetingName: {
    type: String,
    required: true
  },
  selected:{
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  // the indexes are built at start-up, after leftover duplicates were removed (see lib/db.js)
  autoIndex: false
});

// Indexes for query performance
// one row per race of a meeting
initSchema.index({ meetingName: 1, raceNum: 1 }, { unique: true });
initSchema.index({ selected: 1, raceNum: 1 });

module.exports = mongoose.model('Init', initSchema);
