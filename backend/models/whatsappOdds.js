const mongoose = require('mongoose');

// The odds lists sent to the contacts. The latest one says which race is running and how many horses it has,
// which is how a message like "11 500x90" is read (race 1 horse 1, or horse 11).
const whatsappOddsSchema = new mongoose.Schema({
  messageId: { type: String, required: true, unique: true },
  raceNum: { type: Number, required: true },
  runners: { type: Number, required: true },
  odds: [{ horseNum: Number, odds: Number, _id: false }],
  style: { type: String },
  sentAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
});

whatsappOddsSchema.index({ sentAt: -1 });
whatsappOddsSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model('WhatsappOdds', whatsappOddsSchema);
