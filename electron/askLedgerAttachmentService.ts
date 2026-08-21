import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { unzipSync, strFromU8, inflateSync } from 'fflate';
import * as XLSX from 'xlsx';
import type { AskLedgerAttachment, AskLedgerAttachmentSource } from '../src/types/askLedgerAttachments.ts';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';

export const ASK_LEDGER_ATTACHMENT_LIMITS = {
  maxFiles: 5,
  maxFileBytes: 10 * 1024 * 1024,
  maxMessageBytes: 25 * 1024 * 1024,
} as const;

const SUPPORTED = new Map([
  ['pdf', 'application/pdf'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['txt', 'text/plain'],
  ['md', 'text/markdown'],
  ['csv', 'text/csv'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
]);

export type ExtractedAttachmentBlock = {
  text: string;
  source: Omit<AskLedgerAttachmentSource, 'attachmentId' | 'fileName'>;
};

export type NormalizedAttachmentDocument = {
  attachment: AskLedgerAttachment;
  blocks: ExtractedAttachmentBlock[];
  temporaryPath: string;
};

type StoredAttachmentManifest = NormalizedAttachmentDocument & { messageId?: string; conversationId?: string; persistedAt: string };

export class AskLedgerAttachmentError extends Error {
  constructor(message: string) { super(message); this.name = 'AskLedgerAttachmentError'; }
}

const extensionFor = (name: string) => path.extname(name).slice(1).toLowerCase();
const clean = (value: string) => value.replace(/\u0000/g, '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const xmlDecode = (value: string) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const validateBytes = (bytes: Uint8Array, extension: string) => {
  if (bytes.includes(0) && !['pdf', 'docx', 'xlsx'].includes(extension)) throw new AskLedgerAttachmentError('This file does not contain readable text.');
  if (extension === 'pdf' && strFromU8(bytes.subarray(0, 5), true) !== '%PDF-') throw new AskLedgerAttachmentError('This file is not a readable PDF.');
  if (extension === 'docx') {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new AskLedgerAttachmentError('This file is not a readable DOCX document.');
  }
  if (extension === 'xlsx' && (bytes[0] !== 0x50 || bytes[1] !== 0x4b)) throw new AskLedgerAttachmentError('This file is not a readable XLSX workbook.');
};

const extractPdf = (bytes: Uint8Array): ExtractedAttachmentBlock[] => {
  const raw = strFromU8(bytes, true);
  const streams: string[] = [];
  for (const match of raw.matchAll(/stream\s*\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const value = match[1] ?? '';
    const start = Math.max(0, (match.index ?? 0) - 300);
    const dictionary = raw.slice(start, match.index ?? 0);
    try {
      const decoded = dictionary.includes('/FlateDecode') ? strFromU8(inflateSync(new Uint8Array([...value].map((char) => char.charCodeAt(0) & 255))), true) : value;
      streams.push(decoded);
    } catch { streams.push(value); }
  }
  const text = streams.map((stream) => {
    const pieces: string[] = [];
    for (const literal of stream.matchAll(/\(([^()]*)\)\s*Tj/g)) pieces.push(literal[1] ?? '');
    for (const array of stream.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
      for (const literal of (array[1] ?? '').matchAll(/\(([^()]*)\)/g)) pieces.push(literal[1] ?? '');
    }
    return clean(pieces.join(' '));
  }).filter(Boolean);
  if (!text.length) throw new AskLedgerAttachmentError('This PDF contains no usable text. It may be scanned or image-only.');
  return text.map((value, index) => ({ text: value, source: { pageNumber: index + 1 } }));
};

const extractDocx = (bytes: Uint8Array): ExtractedAttachmentBlock[] => {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch { throw new AskLedgerAttachmentError('This DOCX document could not be opened safely.'); }
  const xml = files['word/document.xml'] ? strFromU8(files['word/document.xml']) : '';
  if (!xml) throw new AskLedgerAttachmentError('This DOCX document has no readable document body.');
  const blocks = [...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map((match, index) => {
    const paragraph = [...(match[1] ?? '').matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((part) => xmlDecode(part[1] ?? '')).join('');
    const heading = (match[1] ?? '').match(/w:val="(Heading\s*\d+)"/i)?.[1];
    return { text: clean(paragraph), source: { paragraph: index + 1, section: heading } };
  }).filter((block) => block.text);
  if (!blocks.length) throw new AskLedgerAttachmentError('This DOCX document contains no usable text.');
  return blocks;
};

const extractText = (bytes: Uint8Array): ExtractedAttachmentBlock[] => {
  const text = clean(new TextDecoder('utf-8', { fatal: false }).decode(bytes));
  if (!text) throw new AskLedgerAttachmentError('This file contains no usable text.');
  return text.split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z])/).map((part, index) => ({ text: clean(part), source: { paragraph: index + 1 } })).filter((block) => block.text);
};

const extractCsv = (bytes: Uint8Array): ExtractedAttachmentBlock[] => {
  const lines = new TextDecoder().decode(bytes).split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new AskLedgerAttachmentError('This CSV contains no usable rows.');
  const headers = lines[0].split(',').map((header) => header.trim());
  const blocks: ExtractedAttachmentBlock[] = [];
  const groupSize = 20;
  for (let start = 1; start < lines.length; start += groupSize) {
    const end = Math.min(lines.length, start + groupSize);
    const rows = lines.slice(start, end).map((line) => line.split(',').map((value) => value.trim()).map((value, index) => `${headers[index] ?? `Column ${index + 1}`}: ${value}`).join(' | '));
    blocks.push({ text: rows.join('\n'), source: { rowStart: start + 1, rowEnd: end } });
  }
  return blocks;
};

const displayCell = (value: unknown) => {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\r?\n/g, ' ').trim();
};

const extractXlsx = (bytes: Uint8Array, fileName: string): ExtractedAttachmentBlock[] => {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: 'buffer',
      cellDates: true,
      cellNF: true,
      cellText: true,
      bookVBA: false,
      bookFiles: false,
      bookProps: false,
      WTF: false,
    });
  } catch {
    throw new AskLedgerAttachmentError('This XLSX workbook is corrupt, password-protected, or could not be opened safely.');
  }
  if (!workbook.SheetNames.length) throw new AskLedgerAttachmentError('This XLSX workbook contains no sheets.');

  const blocks: ExtractedAttachmentBlock[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = sheet ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false }) : [];
    const rows = matrix.map((row) => row.map(displayCell));
    const headers = (rows[0] ?? []).map((value, index) => value || `Column ${index + 1}`);
    const dataRows = rows.slice(1).filter((row) => row.some(Boolean));
    if (!dataRows.length) {
      blocks.push({ text: `Workbook: ${fileName}\nSheet: ${sheetName}\nThis sheet is empty.`, source: { sheetName, rowStart: 1, rowEnd: 1, headers } });
      continue;
    }
    const groupSize = 20;
    for (let start = 0; start < dataRows.length; start += groupSize) {
      const group = dataRows.slice(start, start + groupSize);
      const rowStart = start + 2;
      const rowEnd = rowStart + group.length - 1;
      const text = [
        `Workbook: ${fileName}`,
        `Sheet: ${sheetName}`,
        `Headers: ${headers.join(' | ')}`,
        `Rows ${rowStart}-${rowEnd}:`,
        ...group.map((row, offset) => `Row ${rowStart + offset}: ${headers.map((header, index) => `${header}: ${row[index] ?? ''}`).join(' | ')}`),
      ].join('\n');
      blocks.push({ text, source: { sheetName, rowStart, rowEnd, headers } });
    }
  }
  return blocks;
};

export const chunkAttachmentBlocks = (blocks: ExtractedAttachmentBlock[], maxCharacters = 1400): ExtractedAttachmentBlock[] => {
  const output: ExtractedAttachmentBlock[] = [];
  for (const block of blocks) {
    let remaining = block.text;
    while (remaining.length > maxCharacters) {
      const boundary = Math.max(remaining.lastIndexOf('\n', maxCharacters), remaining.lastIndexOf('. ', maxCharacters));
      const cut = boundary > maxCharacters * 0.55 ? boundary : maxCharacters;
      output.push({ text: remaining.slice(0, cut).trim(), source: block.source });
      remaining = remaining.slice(cut).trim();
    }
    if (remaining) output.push({ text: remaining, source: block.source });
  }
  return output;
};

export class AskLedgerAttachmentService {
  private readonly root: string;
  private readonly copies = new Map<string, string>();
  private readonly documents = new Map<string, NormalizedAttachmentDocument>();
  private readonly conversationAttachments = new Map<string, Set<string>>();

  constructor(root: string) { this.root = root; }

  async ingest(paths: string[], conversationId: string, workspaceId: string, existing?: { count?: number; sizeBytes?: number }): Promise<NormalizedAttachmentDocument[]> {
    if (!conversationId.trim()) throw new AskLedgerAttachmentError('Ask Ledger conversation is required.');
    if (paths.length + (existing?.count ?? 0) > ASK_LEDGER_ATTACHMENT_LIMITS.maxFiles) throw new AskLedgerAttachmentError(`You can attach up to ${ASK_LEDGER_ATTACHMENT_LIMITS.maxFiles} files.`);
    const stats = await Promise.all(paths.map((filePath) => fs.stat(filePath)));
    const total = stats.reduce((sum, stat) => sum + stat.size, 0);
    if (stats.some((stat) => !stat.isFile())) throw new AskLedgerAttachmentError('Only regular files can be attached.');
    if (stats.some((stat) => stat.size > ASK_LEDGER_ATTACHMENT_LIMITS.maxFileBytes)) throw new AskLedgerAttachmentError('Each attachment must be 10 MB or smaller.');
    if (total + (existing?.sizeBytes ?? 0) > ASK_LEDGER_ATTACHMENT_LIMITS.maxMessageBytes) throw new AskLedgerAttachmentError('These files exceed the 25 MB total limit.');
    const inputs = await Promise.all(paths.map(async (filePath) => {
      const originalPath = path.resolve(filePath);
      const name = path.basename(originalPath);
      const extension = extensionFor(name);
      const mimeType = SUPPORTED.get(extension);
      if (!mimeType) throw new AskLedgerAttachmentError(`Unsupported attachment type: .${extension || 'unknown'}.`);
      const bytes = await fs.readFile(originalPath);
      validateBytes(bytes, extension);
      return { originalPath, name, extension, mimeType, bytes };
    }));
    await fs.mkdir(this.root, { recursive: true });
    const results: NormalizedAttachmentDocument[] = [];
    for (const { name, extension, mimeType, bytes } of inputs) {
      const id = randomUUID();
      const temporaryPath = path.join(this.root, `${id}.${extension}`);
      await fs.writeFile(temporaryPath, bytes, { flag: 'wx', mode: 0o600 });
      this.copies.set(id, temporaryPath);
      const attachment: AskLedgerAttachment = { id, conversationId, name, extension, mimeType, sizeBytes: bytes.byteLength, status: 'processing', createdAt: new Date().toISOString() };
      const blocks = extension === 'pdf' ? extractPdf(bytes) : extension === 'docx' ? extractDocx(bytes) : extension === 'csv' ? extractCsv(bytes) : extension === 'xlsx' ? extractXlsx(bytes, name) : extractText(bytes);
      const chunks = chunkAttachmentBlocks(blocks);
      results.push({ attachment: { ...attachment, status: 'ready' }, blocks: chunks, temporaryPath });
      this.documents.set(id, results[results.length - 1]);
      const conversationAttachments = this.conversationAttachments.get(conversationId) ?? new Set<string>();
      conversationAttachments.add(id);
      this.conversationAttachments.set(conversationId, conversationAttachments);
      console.info('[local-ai] Ask Ledger attachment indexed locally', { attachmentId: id, conversationId, workspaceId, fileType: extension, size: bytes.byteLength, extractedCharacters: chunks.reduce((sum, block) => sum + block.text.length, 0), chunkCount: chunks.length });
    }
    return results;
  }

  async cleanup(ids: string[]) {
    await Promise.all(ids.map(async (id) => { const filePath = this.copies.get(id); this.copies.delete(id); this.documents.delete(id); this.conversationAttachments.forEach((attachmentIds) => attachmentIds.delete(id)); await fs.rm(path.join(this.root, `${id}.json`), { force: true }); if (filePath) await fs.rm(filePath, { force: true }); }));
  }

  async cleanupConversation(conversationId: string) {
    const ids = [...(this.conversationAttachments.get(conversationId) ?? [])];
    this.conversationAttachments.delete(conversationId);
    await this.cleanup(ids);
  }

  pathFor(id: string) { return this.copies.get(id); }

  async persist(conversationId: string, messageId: string, ids: string[]) {
    const docs = ids.map((id) => this.documents.get(id)).filter((document): document is NormalizedAttachmentDocument => Boolean(document));
    await Promise.all(docs.map(async (document) => {
      const manifest = { ...document, conversationId, messageId, persistedAt: new Date().toISOString() } satisfies StoredAttachmentManifest;
      await fs.writeFile(path.join(this.root, `${document.attachment.id}.json`), JSON.stringify(manifest), { mode: 0o600 });
    }));
  }

  async restoreConversation(conversationId: string) {
    await fs.mkdir(this.root, { recursive: true });
    const names = await fs.readdir(this.root);
    const restored: NormalizedAttachmentDocument[] = [];
    for (const name of names.filter((value) => value.endsWith('.json'))) {
      try {
        const manifest = JSON.parse(await fs.readFile(path.join(this.root, name), 'utf8')) as StoredAttachmentManifest;
        if (manifest.attachment?.conversationId !== conversationId || !manifest.temporaryPath || path.dirname(path.resolve(manifest.temporaryPath)) !== path.resolve(this.root) || !(await fs.stat(manifest.temporaryPath)).isFile()) continue;
        this.copies.set(manifest.attachment.id, manifest.temporaryPath);
        this.documents.set(manifest.attachment.id, manifest);
        const ids = this.conversationAttachments.get(conversationId) ?? new Set<string>(); ids.add(manifest.attachment.id); this.conversationAttachments.set(conversationId, ids);
        restored.push({ attachment: manifest.attachment, blocks: manifest.blocks, temporaryPath: manifest.temporaryPath });
      } catch { /* incomplete or corrupt manifests are cleaned below */ }
    }
    return restored;
  }

  async cleanupAll() { await this.cleanup([...this.copies.keys()]); }
}

export const attachmentBlocksToContext = (document: NormalizedAttachmentDocument): AskLedgerContextItem[] => document.blocks.map((block, index) => ({
  resourceType: 'attachment',
  resourceId: `${document.attachment.id}:${index}`,
  title: document.attachment.name,
  content: block.text,
  sourceLabel: block.source.pageNumber
    ? `${document.attachment.extension.toUpperCase()} · Page ${block.source.pageNumber}`
      : block.source.rowStart
      ? `${document.attachment.extension.toUpperCase()} · ${block.source.sheetName ? `${block.source.sheetName} · ` : ''}Rows ${block.source.rowStart}–${block.source.rowEnd ?? block.source.rowStart}`
      : document.attachment.extension === 'docx' ? 'Document' : document.attachment.extension.toUpperCase(),
  route: { kind: 'ask-ledger-attachment', attachmentId: document.attachment.id, conversationId: document.attachment.conversationId },
  attachmentSource: { attachmentId: document.attachment.id, fileName: document.attachment.name, ...block.source },
}));
