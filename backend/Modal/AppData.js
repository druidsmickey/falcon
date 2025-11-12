const mongoose = require('mongoose');
const eventDataSchema = require('./EventData');

// Schema for App Data (All Races)
const appDataSchema = new mongoose.Schema({
  marketType: {
    type: Number,
    default: 0
  },
  numEvents: Number,
  events: [{
    id: Number,
    name: String
  }],
  selectedEventId: Number,
  eventData: [eventDataSchema],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Create and export the model
const AppData = mongoose.model('AppData', appDataSchema);

module.exports = AppData;
