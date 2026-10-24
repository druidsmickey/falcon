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
  // the name bets from this contact are entered under (the contact name is used when empty)
  nickname: {
    type: String,
    default: '',
    trim: true,
    maxlength: 100
  },
  // read the bets this contact sends
  listen: {
    type: Boolean,
    default: false
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
