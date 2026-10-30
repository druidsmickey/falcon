const mongoose = require('mongoose');

// A line the reader got wrong (or could not read) and a person put right before saving the bet. The lines that look
// like a new one are shown to the AI as examples (see lib/corrections.js). Only the line and the figures are kept:
// no name, no number of the contact.
const reading = {
  race: { type: Number, default: null },
  horse: { type: Number, default: null },
  kind: { type: String, default: null },
  amount: { type: Number, default: null },
  second: { type: Number, default: null },
};

const whatsappCorrectionSchema = new mongoose.Schema({
  sig: { type: String, required: true, unique: true },
  line: { type: String, required: true, maxlength: 200 },
  read: reading,
  saved: reading,
  byAi: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

// old corrections stop counting after a while
whatsappCorrectionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

module.exports = mongoose.model('WhatsappCorrection', whatsappCorrectionSchema);
