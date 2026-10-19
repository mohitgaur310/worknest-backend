const mongoose = require('mongoose');

const LEAVE_TYPES = ['annual', 'sick', 'unpaid'];
const LEAVE_STATUSES = ['pending', 'approved', 'rejected'];

const leaveSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: LEAVE_TYPES,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      required: true,
      enum: LEAVE_STATUSES,
      default: 'pending',
    },
    approverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    decidedAt: {
      type: Date,
      default: null,
    },
    comment: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { timestamps: true },
);

leaveSchema.index({ organizationId: 1, employeeId: 1, createdAt: -1 });

module.exports = {
  Leave: mongoose.model('Leave', leaveSchema),
  LEAVE_TYPES,
  LEAVE_STATUSES,
};
