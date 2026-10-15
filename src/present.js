const { formatDueDate } = require('./fields');
const { usersById } = require('./access');

function person(user) {
  if (!user) {
    return null;
  }
  return {
    id: user._id.toString(),
    name: user.name,
  };
}

function toPublicTask(task, users) {
  const assignee = task.assigneeId ? users.get(task.assigneeId.toString()) : null;
  const reporter = users.get(task.reporterId.toString());
  return {
    id: task._id.toString(),
    title: task.title,
    description: task.description || '',
    projectId: task.projectId.toString(),
    assigneeId: task.assigneeId ? task.assigneeId.toString() : null,
    assignee: person(assignee),
    reporterId: task.reporterId.toString(),
    reporter: person(reporter),
    status: task.status,
    priority: task.priority,
    dueDate: formatDueDate(task.dueDate),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

async function presentTasks(tasks) {
  const ids = [];
  for (const task of tasks) {
    ids.push(task.reporterId);
    if (task.assigneeId) {
      ids.push(task.assigneeId);
    }
  }
  const users = await usersById(ids);
  return tasks.map((task) => toPublicTask(task, users));
}

async function presentTask(task) {
  const [presented] = await presentTasks([task]);
  return presented;
}

function toPublicComment(comment, users) {
  const author = users.get(comment.authorId.toString());
  return {
    id: comment._id.toString(),
    taskId: comment.taskId.toString(),
    authorId: comment.authorId.toString(),
    author: person(author),
    body: comment.body,
    createdAt: comment.createdAt,
  };
}

async function presentComments(comments) {
  const users = await usersById(comments.map((comment) => comment.authorId));
  return comments.map((comment) => toPublicComment(comment, users));
}

async function presentComment(comment) {
  const [presented] = await presentComments([comment]);
  return presented;
}

function assigneeLabel(id, users) {
  if (!id) {
    return null;
  }
  const user = users.get(id.toString());
  return user ? user.name : null;
}

async function presentActivity(entries) {
  const ids = [];
  for (const entry of entries) {
    ids.push(entry.actorId);
    if (entry.type === 'assignee_changed') {
      if (entry.from) {
        ids.push(entry.from);
      }
      if (entry.to) {
        ids.push(entry.to);
      }
    }
  }
  const users = await usersById(ids);
  return entries.map((entry) => {
    const actor = users.get(entry.actorId.toString());
    return {
      id: entry._id.toString(),
      taskId: entry.taskId.toString(),
      actorId: entry.actorId.toString(),
      actor: person(actor),
      type: entry.type,
      from: entry.from ?? null,
      to: entry.to ?? null,
      fromLabel: entry.type === 'assignee_changed' ? assigneeLabel(entry.from, users) : null,
      toLabel: entry.type === 'assignee_changed' ? assigneeLabel(entry.to, users) : null,
      createdAt: entry.createdAt,
    };
  });
}

function projectSummary(project) {
  return {
    id: project._id.toString(),
    name: project.name,
    status: project.status,
  };
}

module.exports = {
  presentTask,
  presentTasks,
  presentComment,
  presentComments,
  presentActivity,
  projectSummary,
};
