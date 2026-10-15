const express = require('express');
const { Task, TASK_STATUSES, PRIORITIES } = require('../models/task');
const { Comment } = require('../models/comment');
const { Activity } = require('../models/activity');
const { requireAuth } = require('../middleware/auth');
const { findAccessibleTask, listMemberRecords, resolveAssignee } = require('../access');
const {
  presentTask,
  presentComment,
  presentComments,
  presentActivity,
  projectSummary,
} = require('../present');
const { formatDueDate, assertObject, unknownField, readText, readEnum, parseDueDate } = require('../fields');

const router = express.Router();

router.use(requireAuth);

const TASK_FIELDS = ['title', 'description', 'status', 'priority', 'assigneeId', 'dueDate'];

function sendFailure(res, result) {
  res.status(result.status).json({ error: result.message });
}

async function taskPayload(task, project) {
  return {
    task: await presentTask(task),
    project: projectSummary(project),
    members: await listMemberRecords(project._id),
  };
}

router.get('/:id', async (req, res, next) => {
  try {
    const access = await findAccessibleTask(req.user, req.params.id);
    if (access.status) {
      return sendFailure(res, access);
    }
    return res.json(await taskPayload(access.task, access.project));
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
    const extra = unknownField(bodyCheck.value, TASK_FIELDS);
    if (extra) {
      return res.status(400).json({ error: `${extra} cannot be changed` });
    }

    const access = await findAccessibleTask(req.user, req.params.id);
    if (access.status) {
      return sendFailure(res, access);
    }

    const body = bodyCheck.value;
    const hasField = TASK_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(body, field));
    if (!hasField) {
      return res.status(400).json({ error: 'No changes provided' });
    }

    const task = access.task;
    const changes = [];

    if (Object.prototype.hasOwnProperty.call(body, 'title')) {
      const parsed = readText(body.title, { label: 'Title', max: 200, required: true });
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }
      task.title = parsed.value;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'description')) {
      const parsed = readText(body.description, { label: 'Description', max: 4000, required: false });
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }
      task.description = parsed.value || '';
    }

    if (Object.prototype.hasOwnProperty.call(body, 'status')) {
      const parsed = readEnum(body.status, TASK_STATUSES, 'Status must be todo, in_progress, or done');
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }
      if (parsed.value !== task.status) {
        changes.push({ type: 'status_changed', from: task.status, to: parsed.value });
        task.status = parsed.value;
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'priority')) {
      const parsed = readEnum(body.priority, PRIORITIES, 'Priority must be low, medium, or high');
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }
      if (parsed.value !== task.priority) {
        changes.push({ type: 'priority_changed', from: task.priority, to: parsed.value });
        task.priority = parsed.value;
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'assigneeId')) {
      const resolved = await resolveAssignee(body.assigneeId, access.project);
      if (resolved.status) {
        return sendFailure(res, resolved);
      }
      const before = task.assigneeId ? task.assigneeId.toString() : null;
      const after = resolved.assigneeId ? resolved.assigneeId.toString() : null;
      if (before !== after) {
        changes.push({ type: 'assignee_changed', from: before, to: after });
        task.assigneeId = resolved.assigneeId;
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'dueDate')) {
      const parsed = parseDueDate(body.dueDate);
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }
      if (formatDueDate(task.dueDate) !== formatDueDate(parsed.value)) {
        task.dueDate = parsed.value;
      }
    }

    await task.save();
    if (changes.length > 0) {
      await Activity.insertMany(
        changes.map((change) => ({
          taskId: task._id,
          actorId: req.user._id,
          type: change.type,
          from: change.from,
          to: change.to,
        })),
      );
    }

    return res.json(await taskPayload(task, access.project));
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/comments', async (req, res, next) => {
  try {
    const access = await findAccessibleTask(req.user, req.params.id);
    if (access.status) {
      return sendFailure(res, access);
    }
    const comments = await Comment.find({ taskId: access.task._id }).sort({ createdAt: 1, _id: 1 });
    return res.json({ comments: await presentComments(comments) });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/comments', async (req, res, next) => {
  try {
    const bodyCheck = assertObject(req.body);
    if (bodyCheck.error) {
      return res.status(400).json({ error: bodyCheck.error });
    }
    const extra = unknownField(bodyCheck.value, ['body']);
    if (extra) {
      return res.status(400).json({ error: `${extra} cannot be set` });
    }

    const access = await findAccessibleTask(req.user, req.params.id);
    if (access.status) {
      return sendFailure(res, access);
    }

    const body = readText(bodyCheck.value.body, { label: 'Comment', max: 4000, required: true });
    if (body.error) {
      return res.status(400).json({ error: body.error });
    }

    const comment = await Comment.create({
      taskId: access.task._id,
      authorId: req.user._id,
      body: body.value,
    });
    return res.status(201).json({ comment: await presentComment(comment) });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/activity', async (req, res, next) => {
  try {
    const access = await findAccessibleTask(req.user, req.params.id);
    if (access.status) {
      return sendFailure(res, access);
    }
    const entries = await Activity.find({ taskId: access.task._id }).sort({ createdAt: 1, _id: 1 });
    return res.json({ activity: await presentActivity(entries) });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
