import test from 'node:test';
import assert from 'node:assert/strict';
import { retrieveProjectSemanticContext } from './projectIntelligenceContext.ts';

test('semantic project context preserves source metadata and workspace scope', async () => {
  const result = await retrieveProjectSemanticContext({
    workspaceId: 'workspace-a',
    projectId: 'project-a',
    projectName: 'Project A',
    documents: [
      { workspaceId: 'workspace-a', resourceType: 'project', resourceId: 'project-a', title: 'Project A', content: 'Objective' },
      { workspaceId: 'workspace-a', resourceType: 'note', resourceId: 'note-a', title: 'Linked note', content: 'Important context', projectId: 'project-a' },
      { workspaceId: 'workspace-b', resourceType: 'note', resourceId: 'private-note', title: 'Private note', content: 'Do not retrieve' },
    ],
    retrieval: {
      retrieve: async () => ({
        items: [
          { workspaceId: 'workspace-a', resourceType: 'note', resourceId: 'note-a', title: 'Linked note', content: 'Important context', projectId: 'project-a' },
          { workspaceId: 'workspace-a', resourceType: 'note', resourceId: 'related-note', title: 'Related note', content: 'Maybe relevant' },
          { workspaceId: 'workspace-b', resourceType: 'note', resourceId: 'private-note', title: 'Private note', content: 'Do not retrieve' },
        ],
        debug: [],
      }),
    } as never,
  });

  assert.deepEqual(result.map((item) => item.resourceId), ['note-a', 'related-note']);
  assert.equal(result[0]?.metadata.workspace_id, 'workspace-a');
  assert.equal(result[0]?.metadata.project_id, 'project-a');
  assert.equal(result[0]?.metadata.resource_type, 'note');
  assert.equal(result[0]?.metadata.resource_id, 'note-a');
  assert.equal(result[0]?.metadata.context_scope, 'linked_project_context');
  assert.equal(result[1]?.metadata.context_scope, 'workspace_related_context');
});
