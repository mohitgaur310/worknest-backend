const express = require('express');
const Payslip = require('../models/payslip');
const { requireAuth } = require('../middleware/auth');
const { sameOrg } = require('../access');
const { contentDisposition, readPdf } = require('../files');
const { canReadPayslips, findEmployeeInOrg } = require('../people');
const mongoose = require('mongoose');

const router = express.Router();

router.use(requireAuth);

router.get('/:id/file', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid payslip id' });
    }

    const payslip = await Payslip.findById(req.params.id).select('+storageKey');
    if (!payslip || !sameOrg(payslip.organizationId, req.user.organizationId)) {
      return res.status(404).json({ error: 'Payslip not found' });
    }

    const owner = await findEmployeeInOrg(req.user, payslip.employeeId);
    if (owner.status || !owner.employee) {
      return res.status(404).json({ error: 'Payslip not found' });
    }
    if (!canReadPayslips(req.user, owner.employee)) {
      return res.status(403).json({ error: 'You cannot download this payslip' });
    }

    const buffer = await readPdf(payslip.organizationId, payslip.storageKey);
    if (!buffer) {
      return res.status(404).json({ error: 'Payslip not found' });
    }

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Length', String(buffer.length));
    res.set('Content-Disposition', contentDisposition(payslip.fileName));
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'private, no-store');
    return res.send(buffer);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
