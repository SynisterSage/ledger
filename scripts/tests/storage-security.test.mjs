import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const migration = fs.readFileSync(path.join(root, 'migrations/125_secure_note_storage.sql'), 'utf8');
const roleMigration = fs.readFileSync(path.join(root, 'migrations/127_restrict_viewer_mutations.sql'), 'utf8');
const imageNode = fs.readFileSync(path.join(root, 'src/components/Notes/nodes/ImageNode.tsx'), 'utf8');
const fileNode = fs.readFileSync(path.join(root, 'src/components/Notes/editor/nodes/FileAttachmentNode.ts'), 'utf8');

assert.match(migration, /UPDATE storage\.buckets[\s\S]*SET public = false[\s\S]*note-images[\s\S]*note-files/);
for (const bucket of ['note-images', 'note-files']) {
  const label = bucket === 'note-images' ? 'Note images' : 'Note files';
  for (const [name, operation] of [['readable', 'SELECT'], ['writable', 'INSERT'], ['updatable', 'UPDATE'], ['deletable', 'DELETE']]) {
    assert.match(migration, new RegExp(`CREATE POLICY "${label} ${name} by workspace members"[\\s\\S]*FOR ${operation}`));
  }
}
assert.match(migration, /\(storage\.foldername\(name\)\)\[1\] = 'workspaces'/);
assert.match(migration, /workspace_members/);
assert.match(migration, /w\.owner_id = auth\.uid\(\)/);
assert.match(migration, /wm\.user_id = auth\.uid\(\)/);
assert.match(roleMigration, /Members can create sections in their workspace/);
assert.match(roleMigration, /Members can update sections in their workspace/);
assert.match(roleMigration, /Members can delete sections in their workspace/);
assert.equal((roleMigration.match(/wm\.role IN \('admin', 'member'\)/g) ?? []).length >= 9, true);
assert.match(imageNode, /createSignedStorageUrl/);
assert.match(fileNode, /createSignedStorageUrl/);
assert.match(fileNode, /getStorageObjectUrl/);
assert.match(await fs.promises.readFile(path.join(root, 'src/services/privateStorage.ts'), 'utf8'), /PRIVATE_BUCKETS/);
console.log('Storage security regression checks passed');
