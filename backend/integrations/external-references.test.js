import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOrGetExternalReference,
  linkExternalReference,
  resolveExternalReference,
} from './external-references.js';

const createFakeSupabase = () => {
  const tables = { external_references: [], external_reference_links: [] };
  let sequence = 0;
  const nextId = () => `id-${++sequence}`;
  const from = (table) => {
    const state = { filters: [], operation: 'select', payload: null, selected: false };
    const builder = {
      select() {
        state.selected = true;
        return builder;
      },
      eq(column, value) {
        state.filters.push([column, value]);
        return builder;
      },
      order() {
        return builder;
      },
      maybeSingle() {
        return Promise.resolve(find());
      },
      single() {
        return Promise.resolve(executeSingle());
      },
      insert(payload) {
        state.operation = 'insert';
        state.payload = payload;
        return builder;
      },
      update(payload) {
        state.operation = 'update';
        state.payload = payload;
        return builder;
      },
      delete() {
        state.operation = 'delete';
        return builder;
      },
    };
    const rows = () => tables[table] ?? [];
    const matches = (row) => state.filters.every(([column, value]) => row[column] === value);
    const find = () => {
      const found = rows().filter(matches);
      return { data: found[0] ?? null, error: null };
    };
    const executeSingle = () => {
      const list = rows();
      if (state.operation === 'insert') {
        if (
          list.some(
            (row) =>
              row.workspace_id === state.payload.workspace_id &&
              row.external_identity === state.payload.external_identity
          )
        )
          return { data: null, error: { code: '23505' } };
        const row = { id: nextId(), ...state.payload };
        list.push(row);
        return { data: row, error: null };
      }
      const index = list.findIndex(matches);
      if (state.operation === 'update') {
        if (index < 0) return { data: null, error: new Error('not found') };
        list[index] = { ...list[index], ...state.payload };
        return { data: list[index], error: null };
      }
      return { data: index >= 0 ? list[index] : null, error: null };
    };
    return builder;
  };
  return { from, tables };
};

test('create-or-get reuses equivalent Figma references', async () => {
  const supabase = createFakeSupabase();
  const first = await createOrGetExternalReference({
    supabase,
    workspaceId: 'workspace',
    provider: 'figma',
    url: 'https://www.figma.com/design/abc12345/a?node-id=12-34',
    createdByUserId: 'user',
  });
  const second = await createOrGetExternalReference({
    supabase,
    workspaceId: 'workspace',
    provider: 'figma',
    url: 'https://figma.com/file/abc12345/different?node-id=12%3A34&utm=x',
    createdByUserId: 'user',
  });
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(second.reference.id, first.reference.id);
});

test('resolution without an active connection preserves parsed metadata', async () => {
  const supabase = createFakeSupabase();
  const created = await createOrGetExternalReference({
    supabase,
    workspaceId: 'workspace',
    provider: 'figma',
    url: 'https://www.figma.com/design/abc12345/a',
    createdByUserId: 'user',
  });
  const resolved = await resolveExternalReference({
    supabase,
    workspaceId: 'workspace',
    referenceId: created.reference.id,
    requestedByUserId: 'user',
    getConnection: async () => null,
  });
  assert.equal(resolved.access_status, 'connection_required');
  assert.equal(resolved.metadata.fileKey, 'abc12345');
});

test('duplicate links are returned and invalid targets are rejected', async () => {
  const supabase = createFakeSupabase();
  const created = await createOrGetExternalReference({
    supabase,
    workspaceId: 'workspace',
    provider: 'figma',
    url: 'https://www.figma.com/design/abc12345/a',
    createdByUserId: 'user',
  });
  const ensureTarget = async ({ workspaceId }) => workspaceId === 'workspace';
  const first = await linkExternalReference({
    supabase,
    workspaceId: 'workspace',
    referenceId: created.reference.id,
    targetType: 'note',
    targetId: 'note-id',
    createdByUserId: 'user',
    ensureTarget,
  });
  const second = await linkExternalReference({
    supabase,
    workspaceId: 'workspace',
    referenceId: created.reference.id,
    targetType: 'note',
    targetId: 'note-id',
    createdByUserId: 'user',
    ensureTarget,
  });
  assert.equal(first.id, second.id);
  await assert.rejects(
    () =>
      linkExternalReference({
        supabase,
        workspaceId: 'other-workspace',
        referenceId: created.reference.id,
        targetType: 'note',
        targetId: 'note-id',
        createdByUserId: 'user',
        ensureTarget: async () => false,
      }),
    /Target object not found/
  );
});
