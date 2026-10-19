const express = require('express');
const multer = require('multer');
const Employee = require('../models/employee');
const Payslip = require('../models/payslip');
const { requireAuth } = require('../middleware/auth');
const { assertObject, unknownField, readText, parseDate } = require('../fields');
const { displayFileName, isPdfBuffer, removePdf, savePdf } = require('../files');
const {
  canManagePeople,
  canReadPayslips,
  findEmployeeInOrg,
  findVisibleEmployee,
  listActiveAccounts,
  presentEmployee,
  presentEmployees,
  presentPayslips,
  resolveActiveUser,
} = require('../people');

const router = express.Router();
const MAX_PDF_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES, files: 1 },
});

router.use(requireAuth);

function sendFailure(res, result) {
  res.status(result.status).json({ error: result.message });
}

async function readEmployeeBody(body, { partial }) {
  const allowed = ['name', 'jobTitle', 'department', 'startDate', 'userId', 'managerUserId'];
  const extra = unknownField(body, allowed);
  if (extra) {
    return { error: `${extra} cannot be set` };
  }
  if (partial && allowed.every((key) => !Object.prototype.hasOwnProperty.call(body, key))) {
    return { error: 'No changes provided' };
  }

  const updates = {};

  if (!partial || Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = readText(body.name, { label: 'Name', max: 100, required: true });
    if (name.error) {
      return { error: name.error };
    }
    updates.name = name.value;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, 'jobTitle')) {
    const jobTitle = readText(body.jobTitle, { label: 'Job title', max: 80, required: true });
    if (jobTitle.error) {
      return { error: jobTitle.error };
    }
    updates.jobTitle = jobTitle.value;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, 'department')) {
    const department = readText(body.department, { label: 'Department', max: 80, required: true });
    if (department.error) {
      return { error: department.error };
    }
    updates.department = department.value;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, 'startDate')) {
    const startDate = parseDate(body.startDate, 'Start date');
    if (startDate.error || !startDate.value) {
      return { error: startDate.error || 'Start date is required' };
    }
    updates.startDate = startDate.value;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, 'userId')) {
    if (typeof body.userId !== 'string') {
      return { error: 'Linked user is required' };
    }
    updates.userId = body.userId;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'managerUserId')) {
    if (body.managerUserId === null) {
      updates.managerUserId = null;
    } else if (typeof body.managerUserId !== 'string') {
      return { error: 'Manager is invalid' };
    } else {
      updates.managerUserId = body.managerUserId;
    }
  } else if (!partial) {
    updates.managerUserId = null;
  }

  return { updates };
}

async function applyLinks(updates, organizationId, current) {
  const nextUserId = updates.userId !== undefined ? updates.userId : current && current.userId.toString();
  let nextManagerId;
  if (updates.managerUserId !== undefined) {
    nextManagerId = updates.managerUserId;
  } else if (current && current.managerUserId) {
    nextManagerId = current.managerUserId.toString();
  } else {
    nextManagerId = null;
  }

  if (updates.userId !== undefined) {
    const linked = await resolveActiveUser(updates.userId, organizationId, 'Linked user');
    if (linked.status) {
      return linked;
    }
    updates.userId = linked.account._id;
  }

  if (updates.managerUserId) {
    const manager = await resolveActiveUser(updates.managerUserId, organizationId, 'Manager');
    if (manager.status) {
      return manager;
    }
    updates.managerUserId = manager.account._id;
    nextManagerId = manager.account._id.toString();
  }

  if (nextManagerId && nextUserId && nextManagerId === nextUserId.toString()) {
    return { status: 400, message: 'A person cannot be their own manager' };
  }

  return { updates };
}

router.post('/', async (req, res, next) => {
  if (!canManagePeople(req.user)) {
    return res.status(403).json({ error: 'Only HR or an admin can add an employee profile' });
  }

  try {
    const bodyCheck = assertObject(req.body);
    if (bodyCheck.error) {
      return res.status(400).json({ error: bodyCheck.error });
    }
    const parsed = await readEmployeeBody(bodyCheck.value, { partial: false });
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }
    const linked = await applyLinks(parsed.updates, req.user.organizationId);
    if (linked.status) {
      return sendFailure(res, linked);
    }

    try {
      const employee = await Employee.create({
        ...linked.updates,
        organizationId: req.user.organizationId,
      });
      return res.status(201).json({ employee: await presentEmployee(employee) });
    } catch (error) {
      if (error && error.code === 11000) {
        return res.status(409).json({ error: 'This user already has an employee profile' });
      }
      return next(error);
    }
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    let employees;
    if (canManagePeople(req.user)) {
      employees = await Employee.find({ organizationId: req.user.organizationId }).sort({ name: 1, _id: 1 });
    } else if (req.user.role === 'manager') {
      employees = await Employee.find({
        organizationId: req.user.organizationId,
        $or: [{ userId: req.user._id }, { managerUserId: req.user._id }],
      }).sort({ name: 1, _id: 1 });
    } else {
      employees = await Employee.find({
        organizationId: req.user.organizationId,
        userId: req.user._id,
      }).sort({ name: 1, _id: 1 });
    }

    const payload = { employees: await presentEmployees(employees) };
    if (canManagePeople(req.user)) {
      payload.accounts = await listActiveAccounts(req.user.organizationId);
    }
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/payslips', async (req, res, next) => {
  try {
    const access = await findVisibleEmployee(req.user, req.params.id);
    if (access.status) {
      return sendFailure(res, access);
    }
    if (!canReadPayslips(req.user, access.employee)) {
      return res.status(403).json({ error: 'You cannot view these payslips' });
    }
    const payslips = await Payslip.find({
      organizationId: req.user.organizationId,
      employeeId: access.employee._id,
    }).sort({ createdAt: -1, _id: -1 });
    return res.json({ payslips: await presentPayslips(payslips) });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/payslips', async (req, res, next) => {
  if (!canManagePeople(req.user)) {
    return res.status(403).json({ error: 'Only HR or an admin can upload a payslip' });
  }

  try {
    const access = await findEmployeeInOrg(req.user, req.params.id);
    if (access.status) {
      return sendFailure(res, access);
    }

    upload.single('file')(req, res, async (uploadError) => {
      if (uploadError) {
        if (uploadError.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'PDF must be 5 MB or smaller' });
        }
        return res.status(400).json({ error: 'Only PDF files are allowed' });
      }

      try {
        const file = req.file;
        if (!file) {
          return res.status(400).json({ error: 'A PDF file is required' });
        }
        if (file.mimetype !== 'application/pdf' || !isPdfBuffer(file.buffer)) {
          return res.status(400).json({ error: 'Only PDF files are allowed' });
        }
        if (file.buffer.length > MAX_PDF_BYTES) {
          return res.status(400).json({ error: 'PDF must be 5 MB or smaller' });
        }

        const storageKey = await savePdf(req.user.organizationId, file.buffer);
        try {
          const payslip = await Payslip.create({
            organizationId: req.user.organizationId,
            employeeId: access.employee._id,
            fileName: displayFileName(file.originalname),
            size: file.buffer.length,
            storageKey,
            uploadedBy: req.user._id,
          });
          const [presented] = await presentPayslips([payslip]);
          return res.status(201).json({ payslip: presented });
        } catch (error) {
          await removePdf(req.user.organizationId, storageKey);
          return next(error);
        }
      } catch (error) {
        return next(error);
      }
    });
    return undefined;
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const access = await findVisibleEmployee(req.user, req.params.id);
    if (access.status) {
      return sendFailure(res, access);
    }
    const payload = { employee: await presentEmployee(access.employee) };
    if (canManagePeople(req.user)) {
      payload.accounts = await listActiveAccounts(req.user.organizationId);
    }
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id', async (req, res, next) => {
  if (!canManagePeople(req.user)) {
    return res.status(403).json({ error: 'Only HR or an admin can edit an employee profile' });
  }

  try {
    const bodyCheck = assertObject(req.body);
    if (bodyCheck.error) {
      return res.status(400).json({ error: bodyCheck.error });
    }
    const access = await findEmployeeInOrg(req.user, req.params.id);
    if (access.status) {
      return sendFailure(res, access);
    }
    const parsed = await readEmployeeBody(bodyCheck.value, { partial: true });
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }
    const linked = await applyLinks(parsed.updates, req.user.organizationId, access.employee);
    if (linked.status) {
      return sendFailure(res, linked);
    }

    Object.assign(access.employee, linked.updates);
    try {
      await access.employee.save();
    } catch (error) {
      if (error && error.code === 11000) {
        return res.status(409).json({ error: 'This user already has an employee profile' });
      }
      return next(error);
    }
    return res.json({ employee: await presentEmployee(access.employee) });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
