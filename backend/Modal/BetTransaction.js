const mongoose = require('mongoose');

const betTransactionSchema = new mongoose.Schema({
  marketType: {
    type: Number,
    required: true,
    enum: [0, 1], // 0 for Local, 1 for International
    index: true
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
  clientName: {
    type: String,
    required: true
  },
  transactionType: {
    type: String,
    required: true,
    enum: ['Sales', 'Purchases']
  },
  // For F500 mode
  isF500: {
    type: Boolean,
    required: true
  },
  books: {
    type: Number,
    default: null
  },
  f500: {
    type: Number,
    default: null
  },
  // For Odds100 mode
  stake: {
    type: Number,
    default: null
  },
  odds100: {
    type: Number,
    default: null
  },
  // Common fields
  payout: {
    type: Number,
    required: true
  },
  tax: {
    type: Number,
    default: 0
  },
  cancel: {
    type: Number,
    default: 0
  },
  rule4: {
    type: Number,
    default: 0
  },
  special: {
    type: Number,
    default: 0
  },
  remarks: {
    type: String,
    default: ''
  },
  timestamp: {
    type: Date,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Index for faster queries
betTransactionSchema.index({ marketType: 1, raceNum: 1, createdAt: -1 });

const BetTransaction = mongoose.model('BetTransaction', betTransactionSchema);

module.exports = BetTransaction;
