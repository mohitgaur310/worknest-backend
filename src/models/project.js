const mongoose = require('mongoose');

const PROJECT_STATUSES = ['active', 'archived'];

const projectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: 4000,
    },
    status: {
      type: String,
      required: true,
      enum: PROJECT_STATUSES,
      default: 'active',
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true },
);

function toPublicProject(project) {
  return {
    id: project._id.toString(),
    name: project.name,
    description: project.description || '',
    status: project.status,
    organizationId: project.organizationId.toString(),
    createdBy: project.createdBy.toString(),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

module.exports = {
  Project: mongoose.model('Project', projectSchema),
  PROJECT_STATUSES,
  toPublicProject,
};
