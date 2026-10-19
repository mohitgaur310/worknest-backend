const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const PDF_KEY = /^[a-f0-9]{32}\.pdf$/;

function fileRoot() {
  const configured = process.env.FILE_ROOT;
  if (typeof configured === 'string' && configured.trim()) {
    return path.resolve(configured.trim());
  }
  return path.join(os.homedir(), 'worknest-files');
}

function storedFilePath(organizationId, storageKey) {
  if (!PDF_KEY.test(storageKey)) {
    return null;
  }
  const root = fileRoot();
  const directory = path.resolve(root, String(organizationId));
  const full = path.resolve(directory, storageKey);
  if (full !== path.join(directory, storageKey)) {
    return null;
  }
  return full;
}

async function savePdf(organizationId, buffer) {
  const storageKey = `${crypto.randomBytes(16).toString('hex')}.pdf`;
  const full = storedFilePath(organizationId, storageKey);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer, { flag: 'wx' });
  return storageKey;
}

async function readPdf(organizationId, storageKey) {
  const full = storedFilePath(organizationId, storageKey);
  if (!full) {
    return null;
  }
  try {
    return await fs.readFile(full);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function removePdf(organizationId, storageKey) {
  const full = storedFilePath(organizationId, storageKey);
  if (!full) {
    return;
  }
  try {
    await fs.unlink(full);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

function displayFileName(original) {
  const base = path.basename(typeof original === 'string' && original.trim() ? original : 'payslip.pdf');
  const cleaned = base.replace(/[\u0000-\u001f"\\/]/g, '').trim().slice(0, 180);
  if (!cleaned) {
    return 'payslip.pdf';
  }
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
}

function contentDisposition(fileName) {
  const ascii = fileName.replace(/[^\w.\- ()]/g, '') || 'payslip.pdf';
  const encoded = encodeURIComponent(fileName);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function isPdfBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 5 && buffer.subarray(0, 5).toString('utf8') === '%PDF-';
}

module.exports = {
  contentDisposition,
  displayFileName,
  isPdfBuffer,
  readPdf,
  removePdf,
  savePdf,
};
