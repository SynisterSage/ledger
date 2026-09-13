import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAIContextEnvelope, buildAIContextFingerprint } from './aiContextEnvelope.ts';

test('context fingerprints are stable across resource order and include workspace/surface identity', () => {
  const base = {
    workspaceId: 'workspace-a',
    surface: 'project_lens' as const,
    selectedResource: { resourceType: 'project' as const, resourceId: 'project-a', revision: '3' },
    resources: [
      { resourceType: 'task' as const, resourceId: 'task-b', revision: '2' },
      { resourceType: 'project' as const, resourceId: 'project-a', revision: '3' },
    ],
    corpusVersion: 'v1',
    embeddingModel: 'nomic',
    embeddingVersion: '1',
  };
  assert.equal(buildAIContextFingerprint(base), buildAIContextFingerprint({ ...base, resources: [...base.resources].reverse() }));
  assert.notEqual(buildAIContextFingerprint(base), buildAIContextFingerprint({ ...base, workspaceId: 'workspace-b' }));
  assert.notEqual(buildAIContextFingerprint(base), buildAIContextFingerprint({ ...base, surface: 'overview_lens' }));
  assert.equal(buildAIContextEnvelope(base).fingerprint.startsWith('ctx-'), true);
});
