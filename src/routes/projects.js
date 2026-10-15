const express = require('express');
const { User, toPublicUser } = require('../models/user');
const { Project, PROJECT_STATUSES, toPublicProject } = require('../models/project');
const { Membership } = require('../models/membership');
const { Task, TASK_STATUSES, PRIORITIES } = require('../models/task');
const { Activity } = require('../models/activity');
const { requireAuth } = require('../middleware/auth');
const {
  PUBLIC_USER_FIELDS,
  canManageMembers,
  canEditProject,
  findAccessibleProject,
  listMemberRecords,
  findActiveOrgMember,
  resolveAssignee,
  resolveTaskFilters,
} = require('../access');
const { presentTask, presentTasks } = require('../present');
const {
  assertObject,
  unknownField,
  readText,
  readEnum,
  parseDueDate,
} = require('../fields');

const router = express.Router();

router.use(requireAuth);

function sendFailure(res, result) {
  res.status(result.status).json({ error: result.message });
}

router.post('/', async (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'manager') {
    return res.status(403).json({ error: 'Only an admin or manager can create a project' });
  }

  try {
    const bodyCheck = assertObject(req.body);
    if (bodyCheck.error) {
      return res.status(400).json({ error: bodyCheck.error });
    }
    const extra = unknownField(bodyCheck.value, ['name', 'description']);
    if (extra) {
      return res.status(400).json({ error: `${extra} cannot be set` });
    }

    const name = readText(bodyCheck.value.name, { label: 'Name', max: 120, required: true });
    if (name.error) {
      return res.status(400).json({ error: name.error });
    }

    let description = '';
    if (Object.prototype.hasOwnProperty.call(bodyCheck.value, 'description')) {
      const parsed = readText(bodyCheck.value.description, {
        label: 'Description',
        max: 4000,
        required: false,
      });
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }
      description = parsed.value || '';
    }

    const project = await Project.create({
      name: name.value,
      description,
      status: 'active',
      organizationId: req.user.organizationId,
      createdBy: req.user._id,
    });

    try {
      await Membership.create({
        projectId: project._id,
        userId: req.user._id,
      });
    } catch (error) {
      await Project.deleteOne({ _id: project._id });
      return next(error);
    }

    return res.status(201).json({ project: toPublicProject(project) });
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    let projects;
    if (req.user.role === 'admin') {
      projects = await Project.find({ organizationId: req.user.organizationId }).sort({ name: 1 });
    } else {
      const memberships = await Membership.find({ userId: req.user._id }).select('projectId');
      projects = await Project.find({
        _id: { $in: memberships.map((membership) => membership.projectId) },
        organizationId: req.user.organizationId,
      }).sort({ name: 1 });
    }
    return res.json({ projects: projects.map(toPublicProject) });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const access = await findAccessibleProject(req.user, req.params.id);
    if (access.status) {
      return sendFailure(res, access);
    }

    const members = await listMemberRecords(access.project._id);
    const manageMembers = canManageMembers(req.user, access.membership);
    const payload = {
      project: toPublicProject(access.project),
      members,
      canManageMembers: manageMembers,
      canUpdateProject: canEditProject(req.user, access.membership),
    };

    if (manageMembers) {
      const users = await User.find({
        organizationId: req.user.organizationId,
        active: true,
      })
        .select(PUBLIC_USER_FIELDS)
        .sort({ name: 1, email: 1 });
      payload.users = users.map(toPublicUser);
    }

    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const bodyCheck = assertObject(req.body);
    if (bodyCheck.error) {
      return res.status(400).json({ error: bodyCheck.error });
    }
    const extra = unknownField(bodyCheck.value, ['name', 'description', 'status']);
    if (extra) {
      return res.status(400).json({ error: `${extra} cannot be changed` });
    }

    const access = await findAccessibleProject(req.user, req.params.id);
    if (access.status) {
      return sendFailure(res, access);
    }
    if (!canEditProject(req.user, access.membership)) {
      return res.status(403).json({ error: 'You cannot update this project' });
    }

    const body = bodyCheck.value;
    const hasName = Object.prototype.hasOwnProperty.call(body, 'name');
    const hasDescription = Object.prototype.hasOwnProperty.call(body, 'description');
    const hasStatus = Object.prototype.hasOwnProperty.call(body, 'status');
    if (!hasName && !hasDescription && !hasStatus) {
      return res.status(400).json({ error: 'No changes provided' });
    }

    if (hasName) {
      const parsed = readText(body.name, { label: 'Name', max: 120, required: true });
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }
      access.project.name = parsed.value;
    }
    if (hasDescription) {
      const parsed = readText(body.description, {
        label: 'Description',
        max: 4000,
        required: false,
      });
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }
      access.project.description = parsed.value || '';
    }
    if (hasStatus) {
      const parsed = readEnum(body.status, PROJECT_STATUSES, 'Status must be active or archived');
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }
      access.project.status = parsed.value;
    }

    await access.project.save();
    return res.json({ project: toPublicProject(access.project) });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/members', async (req, res, next) => {
  try {
    const bodyCheck = assertObject(req.body);
    if (bodyCheck.error) {
      return res.status(400).json({ error: bodyCheck.error });
    }
    const extra = unknownField(bodyCheck.value, ['userId']);
    if (extra) {
      return res.status(400).json({ error: `${extra} cannot be set` });
    }

    const access = await findAccessibleProject(req.user, req.params.id);
    if (access.status) {
      return sendFailure(res, access);
    }
    if (!canManageMembers(req.user, access.membership)) {
      return res.status(403).json({
        error: 'Only an admin or manager who is a project member can change members',
      });
    }

    const target = await findActiveOrgMember(bodyCheck.value.userId, req.user.organizationId);
    if (target.status) {
      return sendFailure(res, target);
    }

    const existing = await Membership.findOne({
      projectId: access.project._id,
      userId: target.user._id,
    });
    if (existing) {
      return res.status(409).json({ error: 'User is already a project member' });
    }

    let membership;
    try {
      membership = await Membership.create({
        projectId: access.project._id,
        userId: target.user._id,
      });
    } catch (error) {
      if (error && error.code === 11000) {
        return res.status(409).json({ error: 'User is already a project member' });
      }
      return next(error);
    }

    return res.status(201).json({
      member: {
        id: membership._id.toString(),
        userId: target.user._id.toString(),
        name: target.user.name,
        email: target.user.email,
        role: target.user.role,
        active: target.user.active,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id/members/:userId', async (req, res, next) => {
  try {
    const access = await findAccessibleProject(req.user, req.params.id);
    if (access.status) {
      return sendFailure(res, access);
    }
    if (!canManageMembers(req.user, access.membership)) {
      return res.status(403).json({
        error: 'Only an admin or manager who is a project member can change members',
      });
    }

    const target = await findActiveOrgMember(req.params.userId, req.user.organizationId);
    if (target.status && target.message === 'Invalid user id') {
      return sendFailure(res, target);
    }

    const membership = await Membership.findOne({
      projectId: access.project._id,
      userId: req.params.userId,
    });
    if (!membership) {
      return res.status(404).json({ error: 'Member not found' });
    }

    if (target.status) {
      const memberUser = await User.findById(req.params.userId).select('organizationId');
      if (memberUser && !memberUser.organizationId.equals(req.user.organizationId)) {
        return res.status(400).json({ error: 'User must be an active user in this organization' });
      }
    }

    await membership.deleteOne();
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/tasks', async (req, res, next) => {
  try {
    const access = await findAccessibleProject(req.user, req.params.id);
    if (access.status) {
      return sendFailure(res, access);
    }

    const filters = await resolveTaskFilters(req.query, req.user);
    if (filters.status) {
      return sendFailure(res, filters);
    }

    const query = { projectId: access.project._id };
    if (filters.taskStatus) {
      query.status = filters.taskStatus;
    }
    if (filters.priority) {
      query.priority = filters.priority;
    }
    if (filters.assigneeId) {
      query.assigneeId = filters.assigneeId;
    }

    const tasks = await Task.find(query).sort({ updatedAt: -1, _id: -1 });
    return res.json({ tasks: await presentTasks(tasks) });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/tasks', async (req, res, next) => {
  try {
    const bodyCheck = assertObject(req.body);
    if (bodyCheck.error) {
      return res.status(400).json({ error: bodyCheck.error });
    }
    const extra = unknownField(bodyCheck.value, [
      'title',
      'description',
      'status',
      'priority',
      'assigneeId',
      'dueDate',
    ]);
    if (extra) {
      return res.status(400).json({ error: `${extra} cannot be set` });
    }

    const access = await findAccessibleProject(req.user, req.params.id);
    if (access.status) {
      return sendFailure(res, access);
    }
    if (access.project.status === 'archived') {
      return res.status(400).json({ error: 'Archived projects cannot accept new tasks' });
    }

    const body = bodyCheck.value;
    const title = readText(body.title, { label: 'Title', max: 200, required: true });
    if (title.error) {
      return res.status(400).json({ error: title.error });
    }

    let description = '';
    if (Object.prototype.hasOwnProperty.call(body, 'description')) {
      const parsed = readText(body.description, { label: 'Description', max: 4000, required: false });
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }
      description = parsed.value || '';
    }

    let status = 'todo';
    if (Object.prototype.hasOwnProperty.call(body, 'status')) {
      const parsed = readEnum(body.status, TASK_STATUSES, 'Status must be todo, in_progress, or done');
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }
      status = parsed.value;
    }

    let priority = 'medium';
    if (Object.prototype.hasOwnProperty.call(body, 'priority')) {
      const parsed = readEnum(body.priority, PRIORITIES, 'Priority must be low, medium, or high');
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }
      priority = parsed.value;
    }

    let assigneeId = null;
    if (Object.prototype.hasOwnProperty.call(body, 'assigneeId')) {
      const resolved = await resolveAssignee(body.assigneeId, access.project);
      if (resolved.status) {
        return sendFailure(res, resolved);
      }
      assigneeId = resolved.assigneeId;
    }

    let dueDate = null;
    if (Object.prototype.hasOwnProperty.call(body, 'dueDate')) {
      const parsed = parseDueDate(body.dueDate);
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }
      dueDate = parsed.value;
    }

    const task = await Task.create({
      title: title.value,
      description,
      projectId: access.project._id,
      assigneeId,
      reporterId: req.user._id,
      status,
      priority,
      dueDate,
    });

    try {
      await Activity.create({
        taskId: task._id,
        actorId: req.user._id,
        type: 'created',
        from: null,
        to: null,
      });
    } catch (error) {
      await Task.deleteOne({ _id: task._id });
      return next(error);
    }

    return res.status(201).json({ task: await presentTask(task) });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
