const mongoose = require('mongoose');
const { User } = require('./models/user');
const { Project } = require('./models/project');
const { Membership } = require('./models/membership');
const { Task, TASK_STATUSES, PRIORITIES } = require('./models/task');
const { Sprint } = require('./models/sprint');
const { readEnum, readQuery } = require('./fields');

const PUBLIC_USER_FIELDS = 'name email role active organizationId';

function sameOrg(left, right) {
  if (!left || !right) {
    return false;
  }
  return left.toString() === right.toString();
}

function canManageMembers(user, membership) {
  if (!membership) {
    return false;
  }
  return user.role === 'admin' || user.role === 'manager';
}

function canEditProject(user, membership) {
  if (user.role === 'admin') {
    return true;
  }
  return user.role === 'manager' && Boolean(membership);
}

function canManageSprints(user, membership) {
  return canEditProject(user, membership);
}

async function findAccessibleProject(user, projectId) {
  if (!mongoose.isValidObjectId(projectId)) {
    return { status: 400, message: 'Invalid project id' };
  }

  const project = await Project.findById(projectId);
  if (!project || !sameOrg(project.organizationId, user.organizationId)) {
    return { status: 404, message: 'Project not found' };
  }

  const membership = await Membership.findOne({
    projectId: project._id,
    userId: user._id,
  });
  if (user.role !== 'admin' && !membership) {
    return { status: 403, message: 'You do not have access to this project' };
  }

  return { project, membership };
}

async function findAccessibleSprint(user, sprintId) {
  if (!mongoose.isValidObjectId(sprintId)) {
    return { status: 400, message: 'Invalid sprint id' };
  }

  const sprint = await Sprint.findById(sprintId);
  if (!sprint) {
    return { status: 404, message: 'Sprint not found' };
  }

  const access = await findAccessibleProject(user, sprint.projectId);
  if (access.status === 404) {
    return { status: 404, message: 'Sprint not found' };
  }
  if (access.status) {
    return {
      status: access.status,
      message: access.status === 403 ? 'You do not have access to this sprint' : access.message,
    };
  }

  return { sprint, project: access.project, membership: access.membership };
}

async function currentWorkFilter(projectId) {
  const excludedIds = await Sprint.find({
    projectId,
    status: { $in: ['planned', 'completed'] },
  }).distinct('_id');
  if (excludedIds.length === 0) {
    return {};
  }
  return { sprintId: { $nin: excludedIds } };
}

async function findAccessibleTask(user, taskId) {
  if (!mongoose.isValidObjectId(taskId)) {
    return { status: 400, message: 'Invalid task id' };
  }

  const task = await Task.findById(taskId);
  if (!task) {
    return { status: 404, message: 'Task not found' };
  }

  const access = await findAccessibleProject(user, task.projectId);
  if (access.status === 404) {
    return { status: 404, message: 'Task not found' };
  }
  if (access.status) {
    return {
      status: access.status,
      message: access.status === 403 ? 'You do not have access to this task' : access.message,
    };
  }

  return { task, project: access.project, membership: access.membership };
}

async function usersById(ids) {
  const unique = [...new Set(ids.filter(Boolean).map((id) => id.toString()))];
  if (unique.length === 0) {
    return new Map();
  }
  const users = await User.find({ _id: { $in: unique } }).select(PUBLIC_USER_FIELDS);
  return new Map(users.map((user) => [user._id.toString(), user]));
}

async function listMemberRecords(projectId) {
  const memberships = await Membership.find({ projectId }).sort({ createdAt: 1, _id: 1 });
  const users = await usersById(memberships.map((membership) => membership.userId));
  return memberships.map((membership) => {
    const user = users.get(membership.userId.toString());
    return {
      id: membership._id.toString(),
      userId: membership.userId.toString(),
      name: user ? user.name : 'Former user',
      email: user ? user.email : '',
      role: user ? user.role : '',
      active: Boolean(user && user.active),
    };
  });
}

async function findActiveOrgMember(userId, organizationId) {
  if (!mongoose.isValidObjectId(userId)) {
    return { status: 400, message: 'Invalid user id' };
  }
  const user = await User.findById(userId).select(PUBLIC_USER_FIELDS);
  if (!user || !user.active || !sameOrg(user.organizationId, organizationId)) {
    return { status: 400, message: 'User must be an active user in this organization' };
  }
  return { user };
}

async function resolveAssignee(assigneeId, project) {
  if (assigneeId === null || assigneeId === '') {
    return { assigneeId: null };
  }
  if (!mongoose.isValidObjectId(assigneeId)) {
    return { status: 400, message: 'Invalid assignee' };
  }

  const user = await User.findById(assigneeId).select(PUBLIC_USER_FIELDS);
  if (!user || !user.active || !sameOrg(user.organizationId, project.organizationId)) {
    return { status: 400, message: 'Assignee must be an active user in this organization' };
  }

  const membership = await Membership.findOne({
    projectId: project._id,
    userId: user._id,
  });
  if (!membership && user.role !== 'admin') {
    return { status: 400, message: 'Assignee must be a project member' };
  }

  return { assigneeId: user._id };
}

async function resolveTaskFilters(query, user) {
  const statusQuery = readQuery(query.status, 'status');
  if (statusQuery.error) {
    return { status: 400, message: statusQuery.error };
  }
  const priorityQuery = readQuery(query.priority, 'priority');
  if (priorityQuery.error) {
    return { status: 400, message: priorityQuery.error };
  }
  const assigneeQuery = readQuery(query.assigneeId, 'assigneeId');
  if (assigneeQuery.error) {
    return { status: 400, message: assigneeQuery.error };
  }
  const mineQuery = readQuery(query.mine, 'mine');
  if (mineQuery.error) {
    return { status: 400, message: mineQuery.error };
  }

  let taskStatus;
  if (statusQuery.value !== undefined) {
    const parsed = readEnum(statusQuery.value, TASK_STATUSES, 'Status must be todo, in_progress, or done');
    if (parsed.error) {
      return { status: 400, message: parsed.error };
    }
    taskStatus = parsed.value;
  }

  let priority;
  if (priorityQuery.value !== undefined) {
    const parsed = readEnum(priorityQuery.value, PRIORITIES, 'Priority must be low, medium, or high');
    if (parsed.error) {
      return { status: 400, message: parsed.error };
    }
    priority = parsed.value;
  }

  let mine = false;
  if (mineQuery.value !== undefined) {
    if (mineQuery.value !== 'true' && mineQuery.value !== 'false') {
      return { status: 400, message: 'mine must be true or false' };
    }
    mine = mineQuery.value === 'true';
  }

  let assigneeId;
  if (mine) {
    if (assigneeQuery.value && assigneeQuery.value !== user._id.toString()) {
      return { status: 400, message: 'assigneeId does not match mine' };
    }
    assigneeId = user._id;
  } else if (assigneeQuery.value) {
    if (!mongoose.isValidObjectId(assigneeQuery.value)) {
      return { status: 400, message: 'Invalid assignee' };
    }
    const assignee = await User.findById(assigneeQuery.value).select(PUBLIC_USER_FIELDS);
    if (!assignee || !sameOrg(assignee.organizationId, user.organizationId)) {
      return { status: 400, message: 'Assignee is not in this organization' };
    }
    assigneeId = assignee._id;
  }

  return { taskStatus, priority, assigneeId };
}

module.exports = {
  PUBLIC_USER_FIELDS,
  sameOrg,
  canManageMembers,
  canEditProject,
  canManageSprints,
  findAccessibleProject,
  findAccessibleSprint,
  currentWorkFilter,
  findAccessibleTask,
  usersById,
  listMemberRecords,
  findActiveOrgMember,
  resolveAssignee,
  resolveTaskFilters,
};
