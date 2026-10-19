const mongoose = require('mongoose');

const payslipSchema = new mongoose.Schema(
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
    fileName: {
      type: String,
      required: true,
      trim: true,
    },
    size: {
      type: Number,
      required: true,
      min: 1,
    },
    storageKey: {
      type: String,
      required: true,
      unique: true,
      select: false,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.storageKey;
        return ret;
      },
    },
    toObject: {
      transform(_doc, ret) {
        delete ret.storageKey;
        return ret;
      },
    },
  },
);

payslipSchema.index({ organizationId: 1, employeeId: 1, createdAt: -1 });

module.exports = mongoose.model('Payslip', payslipSchema);
