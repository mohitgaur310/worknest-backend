const mongoose = require('mongoose');

const ACTIVITY_TYPES = ['created', 'status_changed', 'assignee_changed', 'priority_changed'];

const activitySchema = new mongoose.Schema(
  {
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
      required: true,
      index: true,
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: ACTIVITY_TYPES,
    },
    from: {
      type: String,
      default: null,
    },
    to: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: {
      createdAt: true,
      updatedAt: false,
    },
  },
);

activitySchema.index({ taskId: 1, createdAt: 1 });

module.exports = {
  Activity: mongoose.model('Activity', activitySchema),
  ACTIVITY_TYPES,
};
