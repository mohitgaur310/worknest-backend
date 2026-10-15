const mongoose = require('mongoose');

const membershipSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
  },
  { timestamps: true },
);

membershipSchema.index({ projectId: 1, userId: 1 }, { unique: true });

module.exports = {
  Membership: mongoose.model('Membership', membershipSchema),
};
