const mongoose = require('mongoose');

const SPRINT_STATUSES = ['planned', 'active', 'completed'];

const sprintSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    goal: {
      type: String,
      trim: true,
      default: '',
      maxlength: 4000,
    },
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      required: true,
      enum: SPRINT_STATUSES,
      default: 'planned',
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
  },
  { timestamps: true },
);

sprintSchema.index({ projectId: 1, status: 1 });
sprintSchema.index(
  { projectId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
    name: 'one_active_sprint_per_project',
  },
);

module.exports = {
  Sprint: mongoose.model('Sprint', sprintSchema),
  SPRINT_STATUSES,
};
