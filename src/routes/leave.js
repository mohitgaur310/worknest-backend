const express = require('express');
const mongoose = require('mongoose');
const Employee = require('../models/employee');
const { Leave, LEAVE_TYPES } = require('../models/leave');
const { requireAuth } = require('../middleware/auth');
const { assertObject, unknownField, readText, readEnum, parseDate } = require('../fields');
const { canDecideLeave, presentLeave, visibleLeaveFilter } = require('../people');
const { sameOrg } = require('../access');

const router = express.Router();

router.use(requireAuth);

function sendFailure(res, result) {
  res.status(result.status).json({ error: result.message });
}

router.post('/', async (req, res, next) => {
  try {
    const bodyCheck = assertObject(req.body);
    if (bodyCheck.error) {
      return res.status(400).json({ error: bodyCheck.error });
    }
    const extra = unknownField(bodyCheck.value, ['type', 'startDate', 'endDate', 'reason']);
    if (extra) {
      return res.status(400).json({ error: `${extra} cannot be set` });
    }

    const type = readEnum(bodyCheck.value.type, LEAVE_TYPES, 'Type must be annual, sick, or unpaid');
    if (type.error) {
      return res.status(400).json({ error: type.error });
    }
    const startDate = parseDate(bodyCheck.value.startDate, 'Start date');
    if (startDate.error || !startDate.value) {
      return res.status(400).json({ error: startDate.error || 'Start date is required' });
    }
    const endDate = parseDate(bodyCheck.value.endDate, 'End date');
    if (endDate.error || !endDate.value) {
      return res.status(400).json({ error: endDate.error || 'End date is required' });
    }
    if (endDate.value < startDate.value) {
      return res.status(400).json({ error: 'End date must be on or after the start date' });
    }
    const reason = readText(bodyCheck.value.reason, { label: 'Reason', max: 1000, required: true });
    if (reason.error) {
      return res.status(400).json({ error: reason.error });
    }

    const employee = await Employee.findOne({
      organizationId: req.user.organizationId,
      userId: req.user._id,
    });
    if (!employee) {
      return res.status(400).json({ error: 'You do not have an employee profile' });
    }

    const leave = await Leave.create({
      organizationId: req.user.organizationId,
      employeeId: employee._id,
      type: type.value,
      startDate: startDate.value,
      endDate: endDate.value,
      reason: reason.value,
      status: 'pending',
      approverId: null,
      decidedAt: null,
      comment: '',
    });
    const [presented] = await presentLeave(req.user, [leave]);
    return res.status(201).json({ leave: presented });
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const filter = await visibleLeaveFilter(req.user);
    const records = await Leave.find(filter).sort({ createdAt: -1, _id: -1 });
    return res.json({ leave: await presentLeave(req.user, records) });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/decision', async (req, res, next) => {
  try {
    const bodyCheck = assertObject(req.body);
    if (bodyCheck.error) {
      return res.status(400).json({ error: bodyCheck.error });
    }
    const extra = unknownField(bodyCheck.value, ['status', 'comment']);
    if (extra) {
      return res.status(400).json({ error: `${extra} cannot be set` });
    }
    const status = readEnum(
      bodyCheck.value.status,
      ['approved', 'rejected'],
      'Status must be approved or rejected',
    );
    if (status.error) {
      return res.status(400).json({ error: status.error });
    }

    let comment = '';
    if (Object.prototype.hasOwnProperty.call(bodyCheck.value, 'comment')) {
      const parsed = readText(bodyCheck.value.comment, { label: 'Comment', max: 500, required: false });
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }
      comment = parsed.value || '';
    }

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid leave id' });
    }
    const leave = await Leave.findById(req.params.id);
    if (!leave || !sameOrg(leave.organizationId, req.user.organizationId)) {
      return res.status(404).json({ error: 'Leave request not found' });
    }
    const employee = await Employee.findOne({
      _id: leave.employeeId,
      organizationId: req.user.organizationId,
    });
    if (!employee) {
      return res.status(404).json({ error: 'Leave request not found' });
    }
    if (!canDecideLeave(req.user, employee)) {
      return res.status(403).json({ error: 'You cannot decide this request' });
    }
    if (leave.status !== 'pending') {
      return res.status(409).json({ error: 'This request has already been decided' });
    }

    leave.status = status.value;
    leave.comment = comment;
    leave.approverId = req.user._id;
    leave.decidedAt = new Date();
    await leave.save();
    const [presented] = await presentLeave(req.user, [leave]);
    return res.json({ leave: presented });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
