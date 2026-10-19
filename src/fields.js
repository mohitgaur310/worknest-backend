function assertObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be a JSON object' };
  }
  return { value: body };
}

function unknownField(body, allowed) {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      return key;
    }
  }
  return null;
}

function readText(value, { label, max, required }) {
  if (value === undefined) {
    return required ? { error: `${label} is required` } : { value: undefined };
  }
  if (typeof value !== 'string') {
    return { error: `${label} must be text` };
  }
  const trimmed = value.trim();
  if (required && trimmed.length === 0) {
    return { error: `${label} is required` };
  }
  if (trimmed.length > max) {
    return { error: `${label} must be ${max} characters or fewer` };
  }
  return { value: trimmed };
}

function readEnum(value, allowed, message) {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    return { error: message };
  }
  return { value };
}

function readQuery(value, label) {
  if (value === undefined) {
    return { value: undefined };
  }
  if (typeof value !== 'string') {
    return { error: `${label} is invalid` };
  }
  const trimmed = value.trim();
  return { value: trimmed || undefined };
}

function parseDate(value, label) {
  if (value === undefined) {
    return { value: undefined };
  }
  if (value === null || value === '') {
    return { value: null };
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return { error: `${label} must be YYYY-MM-DD` };
  }
  const trimmed = value.trim();
  const year = Number(trimmed.slice(0, 4));
  const month = Number(trimmed.slice(5, 7));
  const day = Number(trimmed.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { error: `${label} must be YYYY-MM-DD` };
  }
  return { value: date };
}

function parseDueDate(value) {
  return parseDate(value, 'dueDate');
}

function formatDueDate(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

module.exports = {
  assertObject,
  unknownField,
  readText,
  readEnum,
  readQuery,
  parseDate,
  parseDueDate,
  formatDueDate,
};
