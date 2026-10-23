const mongoose = require('mongoose');

const whatsappContactSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  number: {
    type: String,
    required: true,
    unique: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for faster queries on name (number already indexed via unique: true)
whatsappContactSchema.index({ name: 1 });

module.exports = mongoose.model('WhatsappContact', whatsappContactSchema);
