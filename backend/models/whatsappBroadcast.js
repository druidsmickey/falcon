const mongoose = require('mongoose');

const whatsappBroadcastSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  contactIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WhatsappContact'
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('WhatsappBroadcast', whatsappBroadcastSchema);
