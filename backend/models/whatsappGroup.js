const mongoose = require('mongoose');

const whatsappGroupSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
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
}, {
  timestamps: true
});

// name already indexed via unique: true, no need for additional index

module.exports = mongoose.model('WhatsappGroup', whatsappGroupSchema);
