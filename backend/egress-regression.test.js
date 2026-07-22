import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./server.js', import.meta.url), 'utf8');
const notesSource = await readFile(new URL('../src/components/Notes/NotesWindow.tsx', import.meta.url), 'utf8');
const workspaceSource = await readFile(new URL('../src/context/WorkspaceContext.tsx', import.meta.url), 'utf8');
const realtimeSource = await readFile(new URL('../src/hooks/useWorkspaceRealtimeRefresh.ts', import.meta.url), 'utf8');

test('workspace note summaries do not select note bodies', () => {
  assert.match(source, /const noteSummarySelectColumns =/);
  assert.match(source, /select\(noteSummarySelectColumns\)/);
  assert.match(source, /select\('id, workspace_id, title, preview, updated_at, created_at'\)/);
  assert.doesNotMatch(source, /select\('id, workspace_id, title, content, content_html, updated_at, created_at'\)/);
});

test('note body is fetched when a metadata-only note is opened', () => {
  assert.match(notesSource, /typeof note\.content !== 'string'/);
  assert.match(notesSource, /api\.getNoteById\(note\.id\)/);
});

test('bounded notes and search queries remain bounded', () => {
  assert.match(source, /\.from\('notes'\)[\s\S]{0,300}?\.limit\(500\)/);
  assert.match(source, /\.from\('notes'\)[\s\S]{0,500}?\.limit\(25\)/);
});

test('development tracing is attached to the backend Supabase client', () => {
  assert.match(source, /global: \{ fetch: createSupabaseTraceFetch\(\) \}/);
});

test('workspace bootstrap is guarded against Strict Mode duplicate execution', () => {
  assert.match(workspaceSource, /workspaceBootstrapKeyRef/);
  assert.match(workspaceSource, /if \(workspaceBootstrapKeyRef\.current === bootstrapKey\) return/);
});

test('realtime cleanup removes the exact created channel and pending timer', () => {
  assert.match(realtimeSource, /clearTimeout\(timerRef\.current\)/);
  assert.match(realtimeSource, /removeChannel\(channel\)/);
});

test('property updates do not request a full updated row', () => {
  assert.doesNotMatch(source, /\.from\(table\)\.update\(update\)[\s\S]{0,80}\.select\('\*'\)/);
});
