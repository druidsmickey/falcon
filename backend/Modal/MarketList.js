const mongoose = require('mongoose');

// Schema for Market List (Horse)
const marketListSchema = new mongoose.Schema({
  id: Number,
  name: String,
  odds100: Number,
  special: Date,  // Date and time
  rule4: Date,    // Date and time
  rule4Deduction: Number
});

module.exports = marketListSchema;
