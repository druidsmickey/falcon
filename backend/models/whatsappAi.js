const mongoose = require('mongoose');

// The settings of the AI that gives a second opinion on messages the rules could not read (see lib/aiReader.js).
// One document. The key of the AI service is only ever read by the server, never sent back to the browser.
const whatsappAiSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'main' },
  enabled: { type: Boolean, default: false },
  // every line with a figure goes to the AI, not only the lines the rules were unsure about
  readAll: { type: Boolean, default: false },
  preset: { type: String, enum: ['gemini', 'groq', 'claude', 'custom'], default: 'gemini' },
  baseUrl: { type: String, default: '', trim: true, maxlength: 300 },
  model: { type: String, default: '', trim: true, maxlength: 100 },
  // tried when the first model is busy or gone
  fallbackModel: { type: String, default: '', trim: true, maxlength: 100 },
  apiKey: { type: String, default: '', maxlength: 500 },
}, { timestamps: true });

module.exports = mongoose.model('WhatsappAi', whatsappAiSchema);
