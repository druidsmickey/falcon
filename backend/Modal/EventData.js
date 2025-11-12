const mongoose = require('mongoose');
const marketListSchema = require('./MarketList');

// Schema for Event Data (Race)
const eventDataSchema = new mongoose.Schema({
  eventId: Number,
  marketName: String,
  numMarketList: Number,
  marketLists: [marketListSchema]
});

module.exports = eventDataSchema;
