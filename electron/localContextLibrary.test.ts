import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
  await fs.writeFile(manifestPath, JSON.stringify({ ...manifest, lastUsedAt: '2020-01-01T00:00:00.000Z' }));

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
  await assert.rejects(() => library.pathFor(record!.id, 'user-b', 'workspace-a'), LocalContextLibraryError);
});

test('links stay local and removing a record removes only the managed copy', async () => {
  const dir = await tempDir();
  const source = path.join(dir, 'plan.csv');
  await fs.writeFile(source, 'Task,Status\nShip,Open\n');
  const library = new LocalContextLibrary(path.join(dir, 'library'));
  const [record] = await library.importFiles([source], 'user-a', 'workspace-a');
  const linked = await library.link(record!.id, 'user-a', 'workspace-a', 'project', 'project-a');
  assert.deepEqual(linked.links.map((link) => link.targetId), ['project-a']);
  const managedPath = await library.pathFor(record!.id, 'user-a', 'workspace-a');
  await library.remove(record!.id, 'user-a', 'workspace-a');
  assert.equal(await fs.stat(source).then(() => true), true);
  assert.equal(await fs.stat(managedPath!).then(() => true).catch(() => false), false);
});
