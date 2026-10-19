const mongoose = require('mongoose');
const { PUBLIC_USER_FIELDS, sameOrg, usersById } = require('./access');
const { formatDueDate } = require('./fields');
const Employee = require('./models/employee');
const { User, toPublicUser } = require('./models/user');

function canManagePeople(user) {
  return user.role === 'admin' || user.role === 'hr';
}

function canSeeEmployee(user, employee) {
  if (!employee || !sameOrg(employee.organizationId, user.organizationId)) {
    return false;
  }
  if (canManagePeople(user)) {
    return true;
  }
  if (employee.userId.equals(user._id)) {
    return true;
  }
  return (
    user.role === 'manager' &&
    Boolean(employee.managerUserId) &&
    employee.managerUserId.equals(user._id)
  );
}

function canReadPayslips(user, employee) {
  if (!employee || !sameOrg(employee.organizationId, user.organizationId)) {
    return false;
  }
  if (canManagePeople(user)) {
    return true;
  }
  return employee.userId.equals(user._id);
}

function canDecideLeave(user, employee) {
  if (!employee || !sameOrg(employee.organizationId, user.organizationId)) {
    return false;
  }
  if (user.role === 'admin') {
    return true;
  }
  if (employee.userId.equals(user._id)) {
    return false;
  }
  if (employee.managerUserId) {
    return employee.managerUserId.equals(user._id);
  }
  return user.role === 'hr';
}

async function findEmployeeInOrg(user, employeeId) {
  if (!mongoose.isValidObjectId(employeeId)) {
    return { status: 400, message: 'Invalid employee id' };
  }
  const employee = await Employee.findById(employeeId);
  if (!employee || !sameOrg(employee.organizationId, user.organizationId)) {
    return { status: 404, message: 'Employee not found' };
  }
  return { employee };
}

async function findVisibleEmployee(user, employeeId) {
  const found = await findEmployeeInOrg(user, employeeId);
  if (found.status) {
    return found;
  }
  if (!canSeeEmployee(user, found.employee)) {
    return { status: 403, message: 'You do not have access to this profile' };
  }
  return found;
}

function personBrief(user) {
  if (!user) {
    return null;
  }
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

function toPublicEmployee(employee, users) {
  const linked = users.get(employee.userId.toString());
  const manager = employee.managerUserId ? users.get(employee.managerUserId.toString()) : null;
  return {
    id: employee._id.toString(),
    name: employee.name,
    jobTitle: employee.jobTitle,
    department: employee.department,
    startDate: formatDueDate(employee.startDate),
    userId: employee.userId.toString(),
    user: personBrief(linked),
    managerUserId: employee.managerUserId ? employee.managerUserId.toString() : null,
    manager: manager ? { id: manager._id.toString(), name: manager.name } : null,
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt,
  };
}

async function presentEmployees(employees) {
  const ids = [];
  for (const employee of employees) {
    ids.push(employee.userId);
    if (employee.managerUserId) {
      ids.push(employee.managerUserId);
    }
  }
  const users = await usersById(ids);
  return employees.map((employee) => toPublicEmployee(employee, users));
}

async function presentEmployee(employee) {
  const [presented] = await presentEmployees([employee]);
  return presented;
}

async function presentLeave(user, records) {
  if (records.length === 0) {
    return [];
  }
  const employees = await Employee.find({
    _id: { $in: records.map((record) => record.employeeId) },
    organizationId: user.organizationId,
  });
  const byId = new Map(employees.map((employee) => [employee._id.toString(), employee]));
  const users = await usersById(records.map((record) => record.approverId));
  return records.map((record) => {
    const employee = byId.get(record.employeeId.toString());
    const approver = record.approverId ? users.get(record.approverId.toString()) : null;
    return {
      id: record._id.toString(),
      employeeId: record.employeeId.toString(),
      employeeName: employee ? employee.name : 'Former employee',
      type: record.type,
      startDate: formatDueDate(record.startDate),
      endDate: formatDueDate(record.endDate),
      reason: record.reason,
      status: record.status,
      comment: record.comment || '',
      approverId: record.approverId ? record.approverId.toString() : null,
      approver: approver ? { id: approver._id.toString(), name: approver.name } : null,
      decidedAt: record.decidedAt,
      canDecide: Boolean(employee && record.status === 'pending' && canDecideLeave(user, employee)),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  });
}

async function presentPayslips(records) {
  const users = await usersById(records.map((record) => record.uploadedBy));
  return records.map((record) => {
    const uploader = users.get(record.uploadedBy.toString());
    return {
      id: record._id.toString(),
      employeeId: record.employeeId.toString(),
      fileName: record.fileName,
      size: record.size,
      uploadedAt: record.createdAt,
      uploadedBy: uploader ? { id: uploader._id.toString(), name: uploader.name } : null,
    };
  });
}

async function listActiveAccounts(organizationId) {
  const users = await User.find({ organizationId, active: true })
    .select(PUBLIC_USER_FIELDS)
    .sort({ name: 1, email: 1 });
  return users.map(toPublicUser);
}

async function resolveActiveUser(userId, organizationId, label) {
  if (typeof userId !== 'string' || !mongoose.isValidObjectId(userId)) {
    return { status: 400, message: `${label} is invalid` };
  }
  const account = await User.findById(userId).select(PUBLIC_USER_FIELDS);
  if (!account || !account.active || !sameOrg(account.organizationId, organizationId)) {
    return { status: 400, message: `${label} must be an active user in this organization` };
  }
  return { account };
}

async function visibleLeaveFilter(user) {
  if (canManagePeople(user)) {
    return { organizationId: user.organizationId };
  }
  const profiles = await Employee.find({
    organizationId: user.organizationId,
    $or: [{ userId: user._id }, { managerUserId: user._id }],
  }).select('_id');
  return {
    organizationId: user.organizationId,
    employeeId: { $in: profiles.map((profile) => profile._id) },
  };
}

module.exports = {
  canDecideLeave,
  canManagePeople,
  canReadPayslips,
  canSeeEmployee,
  findEmployeeInOrg,
  findVisibleEmployee,
  listActiveAccounts,
  presentEmployee,
  presentEmployees,
  presentLeave,
  presentPayslips,
  resolveActiveUser,
  visibleLeaveFilter,
};
