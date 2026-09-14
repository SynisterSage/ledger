import test from 'node:test';
import assert from 'node:assert/strict';
import { executeReadAskLedgerTool } from './askLedgerReadToolExecutor.ts';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';

const item = (
  value: Partial<AskLedgerContextItem> &
    Pick<AskLedgerContextItem, 'resourceType' | 'resourceId' | 'title'>
): AskLedgerContextItem => ({ content: '', workspaceId: 'workspace-1', ...value });

test('searches only the active workspace and returns bounded source refs', () => {
  const result = executeReadAskLedgerTool(
    { name: 'search_workspace', arguments: { query: 'launch', limit: 1 } },
    {
      workspaceId: 'workspace-1',
      items: [
        item({ resourceType: 'project', resourceId: 'project-1', title: 'Launch plan' }),
        item({
          resourceType: 'note',
          resourceId: 'note-2',
          title: 'Launch secret',
          workspaceId: 'workspace-2',
        }),
      ],
    }
  );
  assert.deepEqual(result.data.count, 1);
  assert.deepEqual(
    result.sourceRefs.map((source) => source.resourceId),
    ['project-1']
  );
});

test('filters today, project, note, and calendar reads without mutation access', () => {
  const items = [
    item({
      resourceType: 'task',
      resourceId: 'task-1',
      title: 'Today task',
      dueAt: '2026-09-13',
      projectId: 'project-1',
    }),
    item({
      resourceType: 'note',
      resourceId: 'note-1',
      title: 'Project note',
      noteId: 'note-1',
      projectId: 'project-1',
      content: 'Private context',
    }),
    item({
      resourceType: 'event',
      resourceId: 'event-1',
      title: 'Tomorrow event',
      timestamp: '2026-09-14T10:00:00Z',
    }),
  ];
  assert.equal(
    (
      executeReadAskLedgerTool(
        { name: 'get_today', arguments: { date: '2026-09-13' } },
        { workspaceId: 'workspace-1', items }
      ).data.items as unknown[]
    ).length,
    1
  );
  assert.equal(
    (
      executeReadAskLedgerTool(
        { name: 'get_project_context', arguments: { projectId: 'project-1' } },
        { workspaceId: 'workspace-1', items }
      ).data.items as unknown[]
    ).length,
    2
  );
  const noteResult = executeReadAskLedgerTool(
    { name: 'get_note_context', arguments: { noteId: 'note-1', includeContent: false } },
    { workspaceId: 'workspace-1', items }
  );
  assert.equal((noteResult.data.items as Array<{ content?: string }>)[0].content, undefined);
  assert.equal(
    (
      executeReadAskLedgerTool(
        { name: 'list_upcoming_events', arguments: { from: '2026-09-13', to: '2026-09-14' } },
        { workspaceId: 'workspace-1', items }
      ).data.events as unknown[]
    ).length,
    1
  );
});

test('rejects writes and invalid read arguments', () => {
  assert.throws(
    () =>
      executeReadAskLedgerTool(
        { name: 'create_task', arguments: {} },
        { workspaceId: 'workspace-1', items: [] }
      ),
    /not an approved read tool/
  );
  assert.throws(
    () =>
      executeReadAskLedgerTool(
        { name: 'get_project_context', arguments: {} },
        { workspaceId: 'workspace-1', items: [] }
      ),
    /projectId is required/
  );
});
