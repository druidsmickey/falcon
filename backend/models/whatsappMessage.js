const mongoose = require('mongoose');

const whatsappMessageSchema = new mongoose.Schema({
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WhatsappGroup',
    required: true
  },
  groupName: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  messageIds: [{
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WhatsappContact'
    },
    contactName: String,
    whatsappMessageId: String,
    chatId: String,
    timestamp: Number
  }],
  sentAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for faster queries
whatsappMessageSchema.index({ groupId: 1, sentAt: -1 });

module.exports = mongoose.model('WhatsappMessage', whatsappMessageSchema);
