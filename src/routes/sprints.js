const express = require('express');
const mongoose = require('mongoose');
const { Sprint } = require('../models/sprint');
const { Task } = require('../models/task');
const { requireAuth } = require('../middleware/auth');
const { canManageSprints, findAccessibleProject, findAccessibleSprint } = require('../access');
const { presentSprint, presentSprints, presentTask } = require('../present');
const { assertObject, unknownField, readText, parseDate } = require('../fields');

const MANAGE_ERROR = 'Only an admin or manager who is a project member can manage sprints';
const ARCHIVED_ERROR = 'Archived projects cannot change sprints';
const STATUS_ORDER = { active: 0, planned: 1, completed: 2 };

function sendFailure(res, result) {
  res.status(result.status).json({ error: result.message });
}

function manageBlock(user, access) {
  if (!canManageSprints(user, access.membership)) {
    return { status: 403, message: MANAGE_ERROR };
  }
  if (access.project.status === 'archived') {
    return { status: 400, message: ARCHIVED_ERROR };
  }
  return null;
}

function readDateField(body, key, label) {
  if (!Object.prototype.hasOwnProperty.call(body, key)) {
    return { omitted: true };
  }
  const parsed = parseDate(body[key], label);
  if (parsed.error) {
    return { error: parsed.error };
  }
  return { value: parsed.value };
}

function rangeError(start, end) {
  if (start && end && start.getTime() > end.getTime()) {
    return 'End date must be on or after the start date';
  }
  return '';
}

function compareSprints(left, right) {
  const byStatus = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
  if (byStatus !== 0) {
    return byStatus;
  }
  const leftDate = left.startDate || '';
  const rightDate = right.startDate || '';
  if (leftDate !== rightDate) {
    return leftDate < rightDate ? -1 : 1;
  }
  return left.name.localeCompare(right.name);
}

async function loadProjectSprint(user, projectId, sprintId) {
  const access = await findAccessibleProject(user, projectId);
  if (access.status) {
    return access;
  }
  if (!mongoose.isValidObjectId(sprintId)) {
    return { status: 400, message: 'Invalid sprint id' };
  }
  const sprint = await Sprint.findOne({
    _id: sprintId,
    projectId: access.project._id,
  });
  if (!sprint) {
    return { status: 404, message: 'Sprint not found' };
  }
  return { sprint, project: access.project, membership: access.membership };
}

const projectSprintRoutes = express.Router();
projectSprintRoutes.use(requireAuth);

projectSprintRoutes.get('/:id/sprints', async (req, res, next) => {
  try {
    const access = await findAccessibleProject(req.user, req.params.id);
    if (access.status) {
      return sendFailure(res, access);
    }
    const sprints = await Sprint.find({ projectId: access.project._id });
    const presented = await presentSprints(sprints);
    presented.sort(compareSprints);
    return res.json({ sprints: presented });
  } catch (error) {
    return next(error);
  }
});

projectSprintRoutes.post('/:id/sprints', async (req, res, next) => {
  try {
    const bodyCheck = assertObject(req.body);
    if (bodyCheck.error) {
      return res.status(400).json({ error: bodyCheck.error });
    }
    const extra = unknownField(bodyCheck.value, ['name', 'goal', 'startDate', 'endDate']);
    if (extra) {
      return res.status(400).json({ error: `${extra} cannot be set` });
    }

    const access = await findAccessibleProject(req.user, req.params.id);
    if (access.status) {
      return sendFailure(res, access);
    }
    const blocked = manageBlock(req.user, access);
    if (blocked) {
      return sendFailure(res, blocked);
    }

    const body = bodyCheck.value;
    const name = readText(body.name, { label: 'Name', max: 120, required: true });
    if (name.error) {
      return res.status(400).json({ error: name.error });
    }

    let goal = '';
    if (Object.prototype.hasOwnProperty.call(body, 'goal')) {
      const parsed = readText(body.goal, { label: 'Goal', max: 4000, required: false });
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }
      goal = parsed.value || '';
    }

    const start = readDateField(body, 'startDate', 'Start date');
    if (start.error) {
      return res.status(400).json({ error: start.error });
    }
    const end = readDateField(body, 'endDate', 'End date');
    if (end.error) {
      return res.status(400).json({ error: end.error });
    }
    const startDate = start.omitted ? null : start.value;
    const endDate = end.omitted ? null : end.value;
    const range = rangeError(startDate, endDate);
    if (range) {
      return res.status(400).json({ error: range });
    }

    const sprint = await Sprint.create({
      name: name.value,
      goal,
      startDate,
      endDate,
      status: 'planned',
      projectId: access.project._id,
    });
    return res.status(201).json({ sprint: await presentSprint(sprint) });
  } catch (error) {
    return next(error);
  }
});

projectSprintRoutes.get('/:id/sprints/:sprintId', async (req, res, next) => {
  try {
    const access = await loadProjectSprint(req.user, req.params.id, req.params.sprintId);
    if (access.status) {
      return sendFailure(res, access);
    }
    return res.json({ sprint: await presentSprint(access.sprint) });
  } catch (error) {
    return next(error);
  }
});

const sprintRoutes = express.Router();
sprintRoutes.use(requireAuth);

sprintRoutes.get('/:id', async (req, res, next) => {
  try {
    const access = await findAccessibleSprint(req.user, req.params.id);
    if (access.status) {
      return sendFailure(res, access);
    }
    return res.json({ sprint: await presentSprint(access.sprint) });
  } catch (error) {
    return next(error);
  }
});

sprintRoutes.patch('/:id', async (req, res, next) => {
  try {
    const bodyCheck = assertObject(req.body);
    if (bodyCheck.error) {
      return res.status(400).json({ error: bodyCheck.error });
    }
    const extra = unknownField(bodyCheck.value, ['name', 'goal', 'startDate', 'endDate']);
    if (extra) {
      return res.status(400).json({ error: `${extra} cannot be changed` });
    }

    const access = await findAccessibleSprint(req.user, req.params.id);
    if (access.status) {
      return sendFailure(res, access);
    }
    const blocked = manageBlock(req.user, access);
    if (blocked) {
      return sendFailure(res, blocked);
    }

    const body = bodyCheck.value;
    const hasName = Object.prototype.hasOwnProperty.call(body, 'name');
    const hasGoal = Object.prototype.hasOwnProperty.call(body, 'goal');
    const hasStart = Object.prototype.hasOwnProperty.call(body, 'startDate');
    const hasEnd = Object.prototype.hasOwnProperty.call(body, 'endDate');
    if (!hasName && !hasGoal && !hasStart && !hasEnd) {
      return res.status(400).json({ error: 'No changes provided' });
    }

    const sprint = access.sprint;
    if (hasName) {
      const parsed = readText(body.name, { label: 'Name', max: 120, required: true });
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }
      sprint.name = parsed.value;
    }
    if (hasGoal) {
      const parsed = readText(body.goal, { label: 'Goal', max: 4000, required: false });
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }
      sprint.goal = parsed.value || '';
    }

    const start = readDateField(body, 'startDate', 'Start date');
    if (start.error) {
      return res.status(400).json({ error: start.error });
    }
    const end = readDateField(body, 'endDate', 'End date');
    if (end.error) {
      return res.status(400).json({ error: end.error });
    }
    if (!start.omitted) {
      sprint.startDate = start.value;
    }
    if (!end.omitted) {
      sprint.endDate = end.value;
    }
    if (sprint.status === 'active' && (!sprint.startDate || !sprint.endDate)) {
      return res.status(400).json({ error: 'An active sprint needs a start and end date' });
    }
    const range = rangeError(sprint.startDate, sprint.endDate);
    if (range) {
      return res.status(400).json({ error: range });
    }

    await sprint.save();
    return res.json({ sprint: await presentSprint(sprint) });
  } catch (error) {
    return next(error);
  }
});

sprintRoutes.post('/:id/start', async (req, res, next) => {
  try {
    const access = await findAccessibleSprint(req.user, req.params.id);
    if (access.status) {
      return sendFailure(res, access);
    }
    const blocked = manageBlock(req.user, access);
    if (blocked) {
      return sendFailure(res, blocked);
    }

    const sprint = access.sprint;
    if (sprint.status !== 'planned') {
      return res.status(400).json({ error: 'Only a planned sprint can be started' });
    }
    if (!sprint.startDate || !sprint.endDate) {
      return res.status(400).json({ error: 'Set a start and end date before starting this sprint' });
    }
    const range = rangeError(sprint.startDate, sprint.endDate);
    if (range) {
      return res.status(400).json({ error: range });
    }

    const other = await Sprint.findOne({
      projectId: sprint.projectId,
      status: 'active',
      _id: { $ne: sprint._id },
    });
    if (other) {
      return res.status(409).json({ error: 'This project already has an active sprint' });
    }

    sprint.status = 'active';
    try {
      await sprint.save();
    } catch (error) {
      if (error && error.code === 11000) {
        return res.status(409).json({ error: 'This project already has an active sprint' });
      }
      return next(error);
    }
    return res.json({ sprint: await presentSprint(sprint) });
  } catch (error) {
    return next(error);
  }
});

sprintRoutes.post('/:id/complete', async (req, res, next) => {
  try {
    const access = await findAccessibleSprint(req.user, req.params.id);
    if (access.status) {
      return sendFailure(res, access);
    }
    const blocked = manageBlock(req.user, access);
    if (blocked) {
      return sendFailure(res, blocked);
    }

    const sprint = access.sprint;
    if (sprint.status !== 'active') {
      return res.status(400).json({ error: 'Only an active sprint can be completed' });
    }

    const returned = await Task.updateMany(
      { sprintId: sprint._id, status: { $ne: 'done' } },
      { $set: { sprintId: null } },
    );
    sprint.status = 'completed';
    await sprint.save();
    const done = await Task.countDocuments({ sprintId: sprint._id, status: 'done' });

    return res.json({
      sprint: await presentSprint(sprint),
      summary: {
        done,
        returnedToBacklog: returned.modifiedCount || 0,
      },
    });
  } catch (error) {
    return next(error);
  }
});

sprintRoutes.post('/:id/tasks', async (req, res, next) => {
  try {
    const bodyCheck = assertObject(req.body);
    if (bodyCheck.error) {
      return res.status(400).json({ error: bodyCheck.error });
    }
    const extra = unknownField(bodyCheck.value, ['taskId']);
    if (extra) {
      return res.status(400).json({ error: `${extra} cannot be set` });
    }

    const access = await findAccessibleSprint(req.user, req.params.id);
    if (access.status) {
      return sendFailure(res, access);
    }
    const blocked = manageBlock(req.user, access);
    if (blocked) {
      return sendFailure(res, blocked);
    }

    const sprint = access.sprint;
    if (sprint.status !== 'planned' && sprint.status !== 'active') {
      return res.status(400).json({ error: 'Tasks can only be added to a planned or active sprint' });
    }

    const taskId = bodyCheck.value.taskId;
    if (typeof taskId !== 'string' || !mongoose.isValidObjectId(taskId)) {
      return res.status(400).json({ error: 'Invalid task id' });
    }

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (task.projectId.toString() !== sprint.projectId.toString()) {
      return res.status(400).json({ error: 'Task is not in this project' });
    }
    if (task.sprintId && task.sprintId.toString() === sprint._id.toString()) {
      return res.status(409).json({ error: 'Task is already in this sprint' });
    }
    if (task.sprintId) {
      const current = await Sprint.findById(task.sprintId);
      if (current && (current.status === 'planned' || current.status === 'active')) {
        return res.status(409).json({ error: 'Task is already in a sprint' });
      }
    }

    task.sprintId = sprint._id;
    await task.save();
    return res.status(201).json({ task: await presentTask(task) });
  } catch (error) {
    return next(error);
  }
});

sprintRoutes.delete('/:id/tasks/:taskId', async (req, res, next) => {
  try {
    const access = await findAccessibleSprint(req.user, req.params.id);
    if (access.status) {
      return sendFailure(res, access);
    }
    const blocked = manageBlock(req.user, access);
    if (blocked) {
      return sendFailure(res, blocked);
    }

    const sprint = access.sprint;
    if (sprint.status === 'completed') {
      return res.status(400).json({ error: 'Tasks cannot be removed from a completed sprint' });
    }
    if (!mongoose.isValidObjectId(req.params.taskId)) {
      return res.status(400).json({ error: 'Invalid task id' });
    }

    const task = await Task.findById(req.params.taskId);
    if (!task || task.projectId.toString() !== sprint.projectId.toString()) {
      return res.status(404).json({ error: 'Task is not in this sprint' });
    }
    if (!task.sprintId || task.sprintId.toString() !== sprint._id.toString()) {
      return res.status(404).json({ error: 'Task is not in this sprint' });
    }

    task.sprintId = null;
    await task.save();
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

module.exports = {
  projectSprintRoutes,
  sprintRoutes,
};
