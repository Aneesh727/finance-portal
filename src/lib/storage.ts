/**
 * Private file storage. Files live OUTSIDE the web root, under random names, and are only ever streamed
 * through an authenticated + authorized route (never served statically).
 *
 * Upload safety: extension allow-list, magic-byte sniffing (extension must match content), size cap,
 * filename sanitising, random storage key, sha256, forced download with nosniff on the way out.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from './env';
import { badRequest } from './errors';

export const ALLOWED_TYPES: Record<string, { mime: string; sniff: (b: Buffer) => boolean }> = {
  pdf: { mime: 'application/pdf', sniff: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  png: { mime: 'image/png', sniff: (b) => b.length > 8 && b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG' },
  jpg: { mime: 'image/jpeg', sniff: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpeg: { mime: 'image/jpeg', sniff: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  webp: { mime: 'image/webp', sniff: (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sniff: isZip },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sniff: isZip },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', sniff: isZip },
  doc: { mime: 'application/msword', sniff: isOle },
  xls: { mime: 'application/vnd.ms-excel', sniff: isOle },
  csv: { mime: 'text/csv', sniff: isText },
  txt: { mime: 'text/plain', sniff: isText },
};

function isZip(b: Buffer) {
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05);
}
function isOle(b: Buffer) {
  return b.length > 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
}
function isText(b: Buffer) {
  const n = Math.min(b.length, 8000);
  for (let i = 0; i < n; i++) if (b[i] === 0) return false;
  const head = b.subarray(0, Math.min(b.length, 2000)).toString('utf8').trimStart().toLowerCase();
  // reject markup masquerading as text/csv
  return !(head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<script') || head.startsWith('<?xml') || head.startsWith('<svg'));
}

export function sanitizeFileName(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/')).normalize('NFKC');
  const cleaned = base.replace(/[^\w.\- ()\[\]]+/g, '_').replace(/\.{2,}/g, '.').replace(/^\.+/, '').slice(0, 120);
  return cleaned || 'file';
}

export function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

export interface StoredFile {
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export function validateUpload(name: string, data: Buffer): { ext: string; mime: string } {
  const max = env().MAX_UPLOAD_MB * 1024 * 1024;
  if (data.length === 0) throw badRequest('The file is empty.', undefined, 'EMPTY_FILE');
  if (data.length > max) throw badRequest(`File is too large. The limit is ${env().MAX_UPLOAD_MB} MB.`, undefined, 'FILE_TOO_LARGE');
  const ext = extOf(sanitizeFileName(name));
  const t = ALLOWED_TYPES[ext];
  if (!t) throw badRequest(`This file type is not allowed. Allowed: ${Object.keys(ALLOWED_TYPES).join(', ')}.`, undefined, 'FILE_TYPE_NOT_ALLOWED');
  if (!t.sniff(data)) throw badRequest('The file content does not match its extension.', undefined, 'FILE_CONTENT_MISMATCH');
  return { ext, mime: t.mime };
}

function rootDir() {
  return path.resolve(process.cwd(), env().STORAGE_DIR);
}

export async function saveFile(name: string, data: Buffer): Promise<StoredFile> {
  const { ext, mime } = validateUpload(name, data);
  const now = new Date();
  const rel = path.posix.join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'), `${crypto.randomUUID()}.${ext}`);
  const full = path.join(rootDir(), rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data, { flag: 'wx', mode: 0o600 });
  return { storageKey: rel, fileName: sanitizeFileName(name), mimeType: mime, sizeBytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
}

/** Resolve a storage key to an absolute path, refusing anything that escapes the storage root. */
export function resolveKey(key: string): string {
  if (!/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.[a-z0-9]{1,5}$/.test(key)) throw badRequest('Invalid file reference.');
  const full = path.resolve(rootDir(), key);
  if (!full.startsWith(rootDir() + path.sep)) throw badRequest('Invalid file reference.');
  return full;
}

export async function readFile(key: string): Promise<Buffer> {
  return fs.readFile(resolveKey(key));
}
