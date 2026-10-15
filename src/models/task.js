const mongoose = require('mongoose');

const TASK_STATUSES = ['todo', 'in_progress', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];

const taskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: 4000,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    assigneeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      required: true,
      enum: TASK_STATUSES,
      default: 'todo',
    },
    priority: {
      type: String,
      required: true,
      enum: PRIORITIES,
      default: 'medium',
    },
    dueDate: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

taskSchema.index({ projectId: 1, status: 1 });
taskSchema.index({ assigneeId: 1 });

module.exports = {
  Task: mongoose.model('Task', taskSchema),
  TASK_STATUSES,
  PRIORITIES,
};
