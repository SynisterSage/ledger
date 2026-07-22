const TERMINAL_TASK_STATUSES = new Set(['completed', 'cancelled']);

export const projectRepositoryRole = ({ existingCount = 0, requestedRole } = {}) =>
  existingCount === 0 || requestedRole === 'primary' ? 'primary' : 'supporting';

export const isActiveGithubTask = (task) =>
  Boolean(task?.id) && !TERMINAL_TASK_STATUSES.has(String(task.status ?? '').toLowerCase());

export const findActiveGithubTasks = (tasks = []) => tasks.filter(isActiveGithubTask);

export const githubTaskDescription = ({ type, number, repository, bodyPreview, url } = {}) =>
  [
    `GitHub ${type === 'pullRequest' ? 'pull request' : 'issue'} #${number ?? ''}`,
    repository,
    String(bodyPreview ?? '').trim().slice(0, 800),
    url,
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 1800);

