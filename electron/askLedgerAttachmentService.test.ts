import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import {
  ASK_LEDGER_ATTACHMENT_LIMITS,
  AskLedgerAttachmentError,
  AskLedgerAttachmentService,
  attachmentBlocksToContext,
} from './askLedgerAttachmentService.ts';
import { EmbeddingIndexService, LedgerRetrievalService, type EmbeddingProvider } from './ledgerRetrievalService.ts';

const fixtureDir = async () => fs.mkdtemp(path.join(os.tmpdir(), 'ledger-attachment-test-'));
const write = async (dir: string, name: string, content: string | Uint8Array) => { const file = path.join(dir, name); await fs.writeFile(file, content); return file; };

test('accepts TXT, Markdown, CSV, DOCX, and readable PDF and preserves source metadata', async () => {
  const dir = await fixtureDir();
  const root = path.join(dir, 'managed');
  const docx = zipSync({ 'word/document.xml': strToU8('<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading 1"/></w:pPr><w:r><w:t>Plan</w:t></w:r></w:p><w:p><w:r><w:t>Unique DOCX fact.</w:t></w:r></w:p></w:body></w:document>') });
  const files = [
    await write(dir, 'plain.txt', 'Unique text fact.\n\nSecond paragraph.'),
    await write(dir, 'notes.md', '# Heading\n\nUnique markdown fact.'),
    await write(dir, 'budget.csv', 'Name,Amount\nQ3,42\nQ4,84\n'),
    await write(dir, 'plan.docx', docx),
    await write(dir, 'proposal.pdf', '%PDF-1.4\nstream\nBT\n(Unique PDF fact) Tj\nET\nendstream\n%%EOF'),
  ];
  const service = new AskLedgerAttachmentService(root);
  const documents = await service.ingest(files, 'conversation-a', 'workspace-a');
  assert.equal(documents.length, 5);
  assert.equal(documents[3].blocks[0]?.source.section, 'Heading 1');
  assert.equal(documents[4].blocks[0]?.source.pageNumber, 1);
  assert.deepEqual(attachmentBlocksToContext(documents[2])[0]?.attachmentSource?.rowStart, 2);
  await service.cleanupAll();
});

test('enforces file, count, and combined limits before indexing', async () => {
  const dir = await fixtureDir();
  const service = new AskLedgerAttachmentService(path.join(dir, 'managed'));
  const oversized = await write(dir, 'large.txt', new Uint8Array(ASK_LEDGER_ATTACHMENT_LIMITS.maxFileBytes + 1));
  await assert.rejects(() => service.ingest([oversized], 'conversation-a', 'workspace-a'), AskLedgerAttachmentError);
  const files = await Promise.all(Array.from({ length: ASK_LEDGER_ATTACHMENT_LIMITS.maxFiles + 1 }, (_, index) => write(dir, `${index}.txt`, 'x')));
  await assert.rejects(() => service.ingest(files, 'conversation-a', 'workspace-a'), /up to 5/);
  await assert.rejects(() => service.ingest([path.join(dir, 'missing.txt')], 'conversation-a', 'workspace-a'));
});

test('rejects unsupported and scanned PDF input clearly', async () => {
  const dir = await fixtureDir();
  const service = new AskLedgerAttachmentService(path.join(dir, 'managed'));
  const binary = await write(dir, 'bad.exe', 'MZ');
  await assert.rejects(() => service.ingest([binary], 'conversation-a', 'workspace-a'), /Unsupported attachment type/);
  const scanned = await write(dir, 'scanned.pdf', '%PDF-1.4\n%%EOF');
  await assert.rejects(() => service.ingest([scanned], 'conversation-a', 'workspace-a'), /scanned or image-only/);
});

class DeterministicProvider implements EmbeddingProvider {
  readonly model = 'nomic-test';
  readonly version = 'test';
  async embed(texts: string[]) { return texts.map((text) => text.toLowerCase().includes('violet fact') ? [1, 0] : [0, 1]); }
}

test('retrieves attachment chunks in their conversation and keeps conversations isolated', async () => {
  const provider = new DeterministicProvider();
  const index = new EmbeddingIndexService(provider);
  const retrieval = new LedgerRetrievalService(index, provider);
  const attachment = (id: string, text: string) => ({ resourceType: 'attachment' as const, resourceId: `${id}:0`, title: 'brief.txt', content: text, attachmentSource: { attachmentId: id, fileName: 'brief.txt', section: 'Body' } });
  await retrieval.indexAttachments('conversation-a', 'workspace-a', [attachment('attachment-a', 'The violet fact is 42.')]);
  await retrieval.indexAttachments('conversation-b', 'workspace-a', [attachment('attachment-b', 'The orange fact is 84.')]);
  const relevant = await retrieval.retrieve('workspace-a', 'What is the violet fact?', [], 8, { conversationId: 'conversation-a' });
  assert.equal(relevant.items[0]?.attachmentSource?.attachmentId, 'attachment-a');
  const isolated = await retrieval.retrieve('workspace-a', 'What is the violet fact?', [], 8, { conversationId: 'conversation-b' });
  assert.equal(isolated.items.some((item) => item.attachmentSource?.attachmentId === 'attachment-a'), false);
  assert.equal(isolated.items[0]?.attachmentSource?.attachmentId, 'attachment-b');
});
