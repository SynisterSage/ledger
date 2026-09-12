import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { unzipSync, strFromU8, unzlibSync } from 'fflate';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
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

const decodePdfTextToken = (token: string) => {
  if (token.startsWith('<')) {
    const hex = token.slice(1, -1).replace(/\s+/g, '');
    if (!hex || !/^[0-9a-f]+$/i.test(hex)) return '';
    const normalized = hex.length % 2 ? `${hex}0` : hex;
    const bytes = new Uint8Array(normalized.match(/../g)!.map((value) => parseInt(value, 16)));
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(bytes.slice(2));
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
  return token
    .slice(1, -1)
    .replace(/\\([\\()])/g, '$1')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r');
};

const pdfHexBytes = (token: string) => {
  const hex = token.startsWith('<') ? token.slice(1, -1).replace(/\s+/g, '') : '';
  const normalized = hex.length % 2 ? `${hex}0` : hex;
  return hex && /^[0-9a-f]+$/i.test(hex) ? new Uint8Array(normalized.match(/../g)!.map((value) => parseInt(value, 16))) : new Uint8Array();
};

const pdfUnicodeFromHex = (token: string) => {
  const bytes = pdfHexBytes(token);
  if (!bytes.length) return '';
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.slice(2));
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
};

const pdfCmap = (stream: string) => {
  const map = new Map<number, string>();
  for (const block of stream.matchAll(/beginbfchar([\s\S]*?)endbfchar/gi)) for (const match of (block[1] ?? '').matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) {
    const source = parseInt(match[1]!, 16);
    const destination = pdfUnicodeFromHex(`<${match[2]}>`);
    if (Number.isFinite(source) && destination) map.set(source, destination);
  }
  for (const block of stream.matchAll(/beginbfrange([\s\S]*?)endbfrange/gi)) for (const match of (block[1] ?? '').matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) {
    const start = parseInt(match[1]!, 16);
    const end = parseInt(match[2]!, 16);
    const first = parseInt(match[3]!, 16);
    for (let source = start; source <= end; source += 1) {
      const destination = String.fromCodePoint(first + source - start);
      map.set(source, destination);
    }
  }
  return map;
};

const decodePdfTextTokenWithCmap = (token: string, cmap?: Map<number, string>) => {
  if (!cmap?.size) return decodePdfTextToken(token);
  const bytes = token.startsWith('<') ? pdfHexBytes(token) : new Uint8Array([...token.slice(1, -1)].map((char) => char.charCodeAt(0) & 0xff));
  return [...bytes].map((value) => cmap.get(value) ?? String.fromCharCode(value)).join('');
};

const pdfAscii = (bytes: Uint8Array) => {
  let value = '';
  for (let start = 0; start < bytes.length; start += 0x8000) value += String.fromCharCode(...bytes.subarray(start, Math.min(bytes.length, start + 0x8000)));
  return value;
};
const pdfIndexOf = (bytes: Uint8Array, needle: string, from = 0) => {
  const target = new TextEncoder().encode(needle);
  outer: for (let index = from; index <= bytes.length - target.length; index += 1) {
    for (let offset = 0; offset < target.length; offset += 1) if (bytes[index + offset] !== target[offset]) continue outer;
    return index;
  }
  return -1;
};

const extractPdfLegacy = (bytes: Uint8Array): ExtractedAttachmentBlock[] => {
  const raw = pdfAscii(bytes);
  const objectBodies = new Map<number, string>();
  for (const match of raw.matchAll(/(\d+)\s+0\s+obj([\s\S]*?)endobj/g)) objectBodies.set(Number(match[1]), match[2] ?? '');
  const streams: string[] = [];
  const streamObjects: number[] = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    const streamStart = pdfIndexOf(bytes, 'stream', cursor);
    if (streamStart < 0) break;
    const streamEndMarker = pdfIndexOf(bytes, 'endstream', streamStart + 6);
    if (streamEndMarker < 0) break;
    let dataStart = streamStart + 6;
    if (bytes[dataStart] === 0x0d && bytes[dataStart + 1] === 0x0a) dataStart += 2;
    else if (bytes[dataStart] === 0x0a || bytes[dataStart] === 0x0d) dataStart += 1;
    const dictionary = pdfAscii(bytes.slice(Math.max(0, streamStart - 1200), streamStart));
    const declaredLength = Number(dictionary.match(/\/Length\s+(\d+)/)?.[1] ?? NaN);
    let dataEnd = Number.isFinite(declaredLength) ? dataStart + declaredLength : streamEndMarker;
    if (dataEnd > bytes.length || (dataEnd > streamEndMarker && !Number.isFinite(declaredLength))) dataEnd = streamEndMarker;
    if (!Number.isFinite(declaredLength)) {
      if (dataEnd > dataStart && bytes[dataEnd - 1] === 0x0a) dataEnd -= 1;
      if (dataEnd > dataStart && bytes[dataEnd - 1] === 0x0d) dataEnd -= 1;
    }
    const value = bytes.slice(dataStart, dataEnd);
    try {
      const decodedBytes = dictionary.includes('/FlateDecode') ? unzlibSync(value) : value;
      streams.push(pdfAscii(decodedBytes));
      const objectMatches = [...raw.slice(0, streamStart).matchAll(/(\d+)\s+0\s+obj/g)];
      streamObjects.push(Number(objectMatches.at(-1)?.[1] ?? 0));
    } catch {
      // A malformed or non-content stream should not prevent other page streams from being read.
    }
    cursor = streamEndMarker + 9;
  }
  const toUnicodeByFontObject = new Map<number, number>();
  for (const [objectNumber, body] of objectBodies) {
    const toUnicode = body.match(/\/ToUnicode\s+(\d+)\s+0\s+R/);
    if (toUnicode) toUnicodeByFontObject.set(objectNumber, Number(toUnicode[1]));
  }
  const cmapByFontName = new Map<string, Map<number, string>>();
  for (const match of raw.matchAll(/\/([A-Za-z][A-Za-z0-9]+)\s+(\d+)\s+0\s+R/g)) {
    const fontName = match[1] ?? '';
    const cmapObject = toUnicodeByFontObject.get(Number(match[2]));
    if (!cmapObject) continue;
    const cmapStreamIndex = streamObjects.indexOf(cmapObject);
    if (cmapStreamIndex >= 0) cmapByFontName.set(fontName, pdfCmap(streams[cmapStreamIndex] ?? ''));
  }
  const text = streams.map((stream) => {
    const pieces: string[] = [];
    let cmap: Map<number, string> | undefined;
    const operators = /\/([A-Za-z][A-Za-z0-9]+)\s+[-+\d.]+\s+Tf|(\((?:\\.|[^\\()])*\)|<[0-9a-f\s]+>)\s*Tj|\[([\s\S]*?)\]\s*TJ/gi;
    for (const operator of stream.matchAll(operators)) {
      if (operator[1]) {
        cmap = cmapByFontName.get(operator[1]) ?? cmap;
        continue;
      }
      if (operator[2]) {
        pieces.push(decodePdfTextTokenWithCmap(operator[2], cmap));
        continue;
      }
      for (const token of (operator[3] ?? '').matchAll(/\((?:\\.|[^\\()])*\)|<[0-9a-f\s]+>/gi)) pieces.push(decodePdfTextTokenWithCmap(token[0] ?? '', cmap));
    }
    return clean(pieces.join(' '));
  }).filter(Boolean);
  if (!text.length) throw new AskLedgerAttachmentError('This PDF contains no usable text. It may be scanned or image-only.');
  return text.map((value, index) => ({ text: value, source: { pageNumber: index + 1 } }));
};

const extractPdf = async (bytes: Uint8Array): Promise<ExtractedAttachmentBlock[]> => {
  try {
    const document = await getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useWorkerFetch: false,
    }).promise;
    try {
      const blocks: ExtractedAttachmentBlock[] = [];
      for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 100); pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = clean(
          content.items
            .flatMap((item) =>
              item && typeof item === 'object' && 'str' in item && typeof item.str === 'string'
                ? [item.str]
                : []
            )
            .join(' ')
        );
        if (text) blocks.push({ text, source: { pageNumber } });
      }
      if (blocks.length) return blocks;
    } finally {
      await document.destroy();
    }
  } catch {
    // Retain the lightweight reader for malformed PDFs that Chromium can still display.
  }
  return extractPdfLegacy(bytes);
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

export const extractAttachmentBlocks = async (bytes: Uint8Array, fileName: string): Promise<ExtractedAttachmentBlock[]> => {
  const extension = extensionFor(fileName);
  validateBytes(bytes, extension);
  return extension === 'pdf' ? extractPdf(bytes) : extension === 'docx' ? extractDocx(bytes) : extension === 'csv' ? extractCsv(bytes) : extension === 'xlsx' ? extractXlsx(bytes, fileName) : extractText(bytes);
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
      const blocks = await extractAttachmentBlocks(bytes, name);
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
