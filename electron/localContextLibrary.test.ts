import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { LocalContextLibrary, LocalContextLibraryError } from './localContextLibrary.ts';

const tempDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'ledger-local-context-'));

test('imports a managed copy, deduplicates by content, and never modifies the source', async () => {
  const dir = await tempDir();
  const source = path.join(dir, 'brief.txt');
  const secondSource = path.join(dir, 'renamed.txt');
  await fs.writeFile(source, 'Private local context');
  await fs.writeFile(secondSource, 'Private local context');
  const library = new LocalContextLibrary(path.join(dir, 'library'));

  const [first] = await library.importFiles([source], 'user-a', 'workspace-a');
  const [duplicate] = await library.importFiles([secondSource], 'user-a', 'workspace-a');
  assert.ok(first);
  assert.equal(duplicate?.id, first?.id);
  assert.equal(await fs.readFile(source, 'utf8'), 'Private local context');
  assert.notEqual(await library.pathFor(first!.id, 'user-a', 'workspace-a'), source);
  assert.equal((await library.list('user-a', 'workspace-a')).length, 1);
});

test('returns indexed local content as private Ask Ledger context', async () => {
  const dir = await tempDir();
  const source = path.join(dir, 'syllabus.md');
  await fs.writeFile(source, '# Course plan\nBuy the required text by Friday.');
  const library = new LocalContextLibrary(path.join(dir, 'library'));

  const [record] = await library.importFiles([source], 'user-a', 'workspace-a');
  const documents = await library.contextDocuments('user-a', 'workspace-a');

  assert.equal(documents.length, 1);
  assert.equal(documents[0]?.resourceType, 'attachment');
  assert.equal(documents[0]?.metadata?.localFileId, record?.id);
  assert.equal(documents[0]?.provenance, 'Local file library');
  assert.match(documents[0]?.content ?? '', /required text/);
});

test('cleans expired local files without touching another workspace', async () => {
  const dir = await tempDir();
  const source = path.join(dir, 'old.txt');
  await fs.writeFile(source, 'Old local context');
  const library = new LocalContextLibrary(path.join(dir, 'library'));
  const [record] = await library.importFiles([source], 'user-a', 'workspace-a');
  const manifestPath = path.join(dir, 'library', `${record!.id}.json`);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  await fs.writeFile(
    manifestPath,
    JSON.stringify({ ...manifest, lastUsedAt: '2020-01-01T00:00:00.000Z' })
  );

  const restartedLibrary = new LocalContextLibrary(path.join(dir, 'library'));
  assert.equal(await restartedLibrary.cleanupExpired('user-a', 'workspace-a', 30), 1);
  assert.equal((await restartedLibrary.list('user-a', 'workspace-a')).length, 0);
  assert.equal(await fs.stat(source).then(() => true), true);
});

test('keeps accounts and workspaces isolated', async () => {
  const dir = await tempDir();
  const source = path.join(dir, 'brief.md');
  await fs.writeFile(source, '# Private');
  const library = new LocalContextLibrary(path.join(dir, 'library'));
  const [record] = await library.importFiles([source], 'user-a', 'workspace-a');
  assert.equal((await library.list('user-b', 'workspace-a')).length, 0);
  assert.equal((await library.list('user-a', 'workspace-b')).length, 0);
  await assert.rejects(
    () => library.pathFor(record!.id, 'user-b', 'workspace-a'),
    LocalContextLibraryError
  );
});

test('links stay local and removing a record removes only the managed copy', async () => {
  const dir = await tempDir();
  const source = path.join(dir, 'plan.csv');
  await fs.writeFile(source, 'Task,Status\nShip,Open\n');
  const library = new LocalContextLibrary(path.join(dir, 'library'));
  const [record] = await library.importFiles([source], 'user-a', 'workspace-a');
  const linked = await library.link(record!.id, 'user-a', 'workspace-a', 'project', 'project-a');
  assert.deepEqual(
    linked.links.map((link) => link.targetId),
    ['project-a']
  );
  const managedPath = await library.pathFor(record!.id, 'user-a', 'workspace-a');
  await library.remove(record!.id, 'user-a', 'workspace-a');
  assert.equal(await fs.stat(source).then(() => true), true);
  assert.equal(
    await fs
      .stat(managedPath!)
      .then(() => true)
      .catch(() => false),
    false
  );
});

test('previews text and image files only within their owning workspace', async () => {
  const dir = await tempDir();
  const textSource = path.join(dir, 'readme.txt');
  const imageSource = path.join(dir, 'pixel.png');
  await fs.writeFile(textSource, 'Preview this locally');
  await fs.writeFile(imageSource, Buffer.from('89504e470d0a1a0a', 'hex'));
  const library = new LocalContextLibrary(path.join(dir, 'library'));
  const [textRecord] = await library.importFiles([textSource], 'user-a', 'workspace-a');
  const [imageRecord] = await library.importFiles([imageSource], 'user-a', 'workspace-a');

  assert.deepEqual(await library.preview(textRecord!.id, 'user-a', 'workspace-a'), {
    kind: 'text',
    text: 'Preview this locally',
    readOnly: false,
  });
  const imagePreview = await library.preview(imageRecord!.id, 'user-a', 'workspace-a');
  assert.equal(imagePreview?.kind, 'binary');
  assert.match((imagePreview as { dataUrl: string }).dataUrl, /^data:image\/png;base64,/);
  await assert.rejects(
    () => library.preview(imageRecord!.id, 'user-a', 'workspace-b'),
    LocalContextLibraryError
  );
});

test('saves editable local text and refreshes its Ask index', async () => {
  const dir = await tempDir();
  const source = path.join(dir, 'notes.md');
  await fs.writeFile(source, 'Before');
  const library = new LocalContextLibrary(path.join(dir, 'library'));
  const [record] = await library.importFiles([source], 'user-a', 'workspace-a');
  const updated = await library.saveText(
    record!.id,
    'user-a',
    'workspace-a',
    '# After\nNew content'
  );
  assert.equal(updated.sizeBytes, Buffer.byteLength('# After\nNew content'));
  assert.equal((await library.preview(record!.id, 'user-a', 'workspace-a'))?.kind, 'text');
  assert.match(
    (await library.contextDocuments('user-a', 'workspace-a'))[0]?.content ?? '',
    /New content/
  );
  await assert.rejects(
    () => library.saveText(record!.id, 'user-b', 'workspace-a', 'Nope'),
    LocalContextLibraryError
  );
});

test('edits XLSX cell data and keeps spreadsheet sheets workspace-scoped', async () => {
  const dir = await tempDir();
  const source = path.join(dir, 'budget.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['Item', 'Status'],
      ['Ship', 'Open'],
    ]),
    'Plan'
  );
  await fs.writeFile(
    source,
    Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
  );
  const library = new LocalContextLibrary(path.join(dir, 'library'));
  const [record] = await library.importFiles([source], 'user-a', 'workspace-a');
  const preview = await library.preview(record!.id, 'user-a', 'workspace-a');
  assert.equal(preview?.kind, 'table');
  const table = preview as {
    kind: 'table';
    sheets: Array<{ name: string; headers: string[]; rows: string[][] }>;
  };
  table.sheets[0]!.rows[0]![1] = 'Done';
  await library.saveTable(record!.id, 'user-a', 'workspace-a', table.sheets);
  const updated = await library.preview(record!.id, 'user-a', 'workspace-a');
  assert.equal((updated as typeof table).sheets[0]!.rows[0]![1], 'Done');
  await assert.rejects(
    () => library.saveTable(record!.id, 'user-b', 'workspace-a', table.sheets),
    LocalContextLibraryError
  );
});

test('imports image-only PDFs for preview even when text extraction is unavailable', async () => {
  const dir = await tempDir();
  const source = path.join(dir, 'scan.pdf');
  await fs.writeFile(source, Buffer.from('%PDF-1.4\n% scanned image only'));
  const library = new LocalContextLibrary(path.join(dir, 'library'));
  const [record] = await library.importFiles([source], 'user-a', 'workspace-a');
  assert.ok(record);
  assert.equal((await library.preview(record!.id, 'user-a', 'workspace-a'))?.kind, 'binary');
  assert.equal((await library.contextDocuments('user-a', 'workspace-a')).length, 0);
});
