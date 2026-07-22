import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findActiveGithubTasks,
  githubTaskDescription,
  projectRepositoryRole,
} from './github-project-workflows.js';

test('the first project repository is primary and later repositories are supporting', () => {
  assert.equal(projectRepositoryRole({ existingCount: 0, requestedRole: 'supporting' }), 'primary');
  assert.equal(projectRepositoryRole({ existingCount: 1, requestedRole: 'supporting' }), 'supporting');
  assert.equal(projectRepositoryRole({ existingCount: 2, requestedRole: 'primary' }), 'primary');
});

test('active GitHub task lookup ignores completed and cancelled tasks', () => {
  assert.deepEqual(
    findActiveGithubTasks([
      { id: 'one', status: 'todo' },
      { id: 'two', status: 'completed' },
      { id: 'three', status: 'cancelled' },
      { id: 'four', status: 'in_progress' },
    ]).map((task) => task.id),
    ['one', 'four']
  );
});

test('GitHub task descriptions are bounded and preserve canonical context', () => {
  const description = githubTaskDescription({
    type: 'pullRequest',
    number: 220,
    repository: 'SynisterSage/ledger',
    bodyPreview: 'A safe summary',
    url: 'https://github.com/SynisterSage/ledger/pull/220',
  });
  assert.match(description, /GitHub pull request #220/);
  assert.match(description, /SynisterSage\/ledger/);
  assert.match(description, /https:\/\/github.com\/SynisterSage\/ledger\/pull\/220/);
  assert.ok(description.length <= 1800);
});

