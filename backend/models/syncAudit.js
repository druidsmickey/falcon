const mongoose = require('mongoose');

const syncAuditSchema = new mongoose.Schema({
  operation: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['synced', 'duplicate', 'conflict', 'failed'],
    required: true
  },
  clientRequestId: {
    type: String,
    required: false
  },
  meetingName: {
    type: String,
    required: false
  },
  userId: {
    type: String,
    required: false
  },
  username: {
    type: String,
    required: false
  },
  appScope: {
    type: String,
    required: false
  },
  message: {
    type: String,
    required: false
  },
  payloadSummary: {
    type: mongoose.Schema.Types.Mixed,
    required: false
  }
}, {
  timestamps: true
});

syncAuditSchema.index({ createdAt: -1 });
syncAuditSchema.index({ clientRequestId: 1 });
syncAuditSchema.index({ operation: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('SyncAudit', syncAuditSchema);
