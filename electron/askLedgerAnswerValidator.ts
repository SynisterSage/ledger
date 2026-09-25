import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';
import type { AskLedgerEvidencePackage } from '../src/types/askLedgerResourceContract.ts';
import { buildAskLedgerQueryPlan } from '../src/types/askLedgerQueryPlan.ts';

export type AskLedgerValidationIssueKind = 'coverage' | 'groundedness' | 'contradiction' | 'missing_evidence';
export type AskLedgerValidationIssue = { kind: AskLedgerValidationIssueKind; code: string; message: string; category?: string; claim?: string; sourceKeys?: string[] };
export type AskLedgerAnswerValidationResult = {
  passed: boolean;
  coverageIssues: AskLedgerValidationIssue[];
  groundednessIssues: AskLedgerValidationIssue[];
  contradictionIssues: AskLedgerValidationIssue[];
  missingEvidenceIssues: AskLedgerValidationIssue[];
  sourceReferences: Array<{ resourceType: AskLedgerContextItem['resourceType']; resourceId: string; title: string; provider?: string }>;
  repairRecommended: boolean;
  durationMs: number;
};

const keyFor = (item: Pick<AskLedgerContextItem, 'resourceType' | 'resourceId'>) => `${item.resourceType}:${item.resourceId}`;
const normalize = (value: unknown) => String(value ?? '').toLowerCase().replace(/<[^>]*>/g, ' ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const categoryAliases: Record<string, string[]> = {
  meetings: ['meeting', 'meetings', 'event', 'events', 'call', 'calls'], projects: ['project', 'projects', 'workstream', 'workstreams'],
  milestones: ['milestone', 'milestones'], tasks: ['task', 'tasks', 'next action', 'next actions', 'action item', 'action items'],
  notes: ['note', 'notes'], transcripts: ['transcript', 'transcripts', 'discussion'], reminders: ['reminder', 'reminders', 'follow up', 'follow ups'],
  activity: ['activity', 'changed', 'changes', 'update', 'updates'], notifications: ['notification', 'notifications', 'alert', 'alerts'],
  external: ['slack', 'github', 'figma', 'drive', 'calendar', 'integration', 'external'],
};
const categoryMentioned = (answer: string, category: string) => (categoryAliases[category] ?? [category.replace(/s$/, '')]).some((alias) => normalize(answer).includes(normalize(alias)));
const dateVariants = (value: string) => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return [];
  const date = new Date(timestamp);
  const month = date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const shortMonth = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = date.getUTCDate(); const year = date.getUTCFullYear();
  return [`${month} ${day}, ${year}`, `${shortMonth} ${day}, ${year}`, `${month} ${day}`, `${shortMonth} ${day}`, `${year}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`].map(normalize);
};
const isCompleted = (item: AskLedgerContextItem) => ['completed', 'complete', 'done', 'cancelled', 'canceled'].includes(normalize(item.status));
const statusAliases: Record<string, string[]> = {
  completed: ['completed', 'complete', 'done'],
  complete: ['completed', 'complete', 'done'],
  done: ['completed', 'complete', 'done'],
  todo: ['todo', 'to do', 'not started', 'not completed', 'open'],
  open: ['open', 'todo', 'to do', 'not started', 'not completed'],
  not_completed: ['not completed', 'todo', 'to do', 'not started', 'open'],
  notstarted: ['not started', 'notstarted', 'todo', 'to do', 'open'],
  not_started: ['not started', 'todo', 'to do', 'not completed', 'open'],
  in_progress: ['in progress', 'in-progress', 'in_progress'],
  inprogress: ['in progress', 'in-progress', 'inprogress'],
};
const answerContainsStatus = (answer: string, status: string) => (statusAliases[status.replace(/\s+/g, '_')] ?? [status]).some((value) => new RegExp(`\\b${value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&').replace(/_/g, '[ _-]')}\\b`, 'i').test(answer));
const resourceTypeAliases: Record<AskLedgerContextItem['resourceType'], string[]> = {
  project: ['project', 'projects'], event: ['event', 'events', 'meeting', 'meetings', 'calendar'],
  task: ['task', 'tasks', 'action', 'actions'], milestone: ['milestone', 'milestones'], reminder: ['reminder', 'reminders'],
  note: ['note', 'notes'], transcript: ['transcript', 'transcripts'], attachment: ['attachment', 'document', 'file'],
  activity: ['activity', 'update', 'updates'], linked_resource: ['resource', 'link', 'links'], person: ['person', 'people'],
  team: ['team', 'teams'], intake: ['intake'], notification: ['notification', 'notifications'], external: ['external'],
};
const hasResourceTypeContext = (line: string, resourceType: AskLedgerContextItem['resourceType']) =>
  (resourceTypeAliases[resourceType] ?? [resourceType]).some((alias) => new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i').test(line));
const providerPattern = (provider: string) => provider.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
const explicitNegativeProviderClaim = (answer: string, provider: string) => new RegExp(`(?:no|none|nothing|did not find|there (?:was|were) no)\\s+(?:any\\s+)?${providerPattern(provider)}\\s+(?:updates?|activity|messages?|results?|work)`, 'i').test(answer);
const availabilityAcknowledged = (answer: string, provider: string) => {
  const p = normalize(provider); const a = normalize(answer);
  return a.includes(`${p} unavailable`) || a.includes(`could not verify ${p}`) || a.includes(`couldnt verify ${p}`) || a.includes(`${p} context was unavailable`) || a.includes(`${p} is not connected`);
};
const attachmentMatchesRequest = (question: string, resource: AskLedgerContextItem) => {
  const plan = buildAskLedgerQueryPlan(question);
  if (!plan.attachment) return true;
  const haystack = normalize([resource.title, resource.metadata?.fileName].filter(Boolean).join(' '));
  if (plan.attachment.kind === 'syllabus' && !haystack.includes('syllabus')) return false;
  const entity = plan.entity?.name ? normalize(plan.entity.name).replace(/\s/g, '') : '';
  return !entity || haystack.replace(/\s/g, '').includes(entity.slice(0, 6));
};

export class AskLedgerAnswerValidator {
  validate(input: { question: string; answer: string; evidencePackage: AskLedgerEvidencePackage; depth?: 'quick' | 'standard' | 'deep'; enforceCoverage?: boolean }): AskLedgerAnswerValidationResult {
    const startedAt = Date.now(); const answer = normalize(input.answer);
    const coverageIssues: AskLedgerValidationIssue[] = []; const groundednessIssues: AskLedgerValidationIssue[] = [];
    const contradictionIssues: AskLedgerValidationIssue[] = []; const missingEvidenceIssues: AskLedgerValidationIssue[] = [];
    const items = input.evidencePackage.sections.flatMap((section) => section.items);
    const sourceReferences = items.filter(({ resource }) => answer.includes(normalize(resource.title)) || answer.includes(normalize(resource.resourceId))).map(({ resource }) => ({ resourceType: resource.resourceType, resourceId: resource.resourceId, title: resource.title, provider: resource.integrationProvider }));
    if (input.enforceCoverage !== false && input.depth !== 'quick') for (const category of input.evidencePackage.coverage.requested) {
      const availableToAnswer = input.evidencePackage.coverage.found.includes(category) || input.evidencePackage.coverage.truncated.includes(category);
      const namedResourceMentioned = items.some(({ source }) => source.resourceType === (category === 'meetings' ? 'event' : category === 'transcripts' ? 'transcript' : category.replace(/s$/, '')) && answer.includes(normalize(source.title)));
      if (availableToAnswer && !categoryMentioned(input.answer, category) && !namedResourceMentioned) coverageIssues.push({ kind: 'coverage', code: 'missing_answer_coverage', message: `${category} was requested and available but is not represented in the answer.`, category });
    }
    for (const { resource } of items.filter(({ resource }) => resource.resourceType === 'attachment')) {
      if (!attachmentMatchesRequest(input.question, resource)) groundednessIssues.push({
        kind: 'groundedness',
        code: 'wrong_attachment_identity',
        message: `${resource.title} does not match the explicitly requested document or course context.`,
        claim: resource.title,
        sourceKeys: [keyFor(resource)],
      });
    }
    for (const provider of [...(input.evidencePackage.coverage.unavailable ?? []), ...(input.evidencePackage.coverage.notConnected ?? [])]) if (explicitNegativeProviderClaim(input.answer, provider) && !availabilityAcknowledged(input.answer, provider)) missingEvidenceIssues.push({ kind: 'missing_evidence', code: 'unavailable_claimed_empty', message: `${provider} was unavailable or not connected, so the answer must not claim that it had no results.`, category: provider });
    const titleCounts = new Map<string, number>();
    for (const { resource } of items) {
      const title = normalize(resource.title);
      if (title) titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
    }
    for (const { resource } of items) {
      if (resource.dueAt && !isCompleted(resource) && answer.includes(normalize(resource.title)) && (answer.includes('due') || answer.includes('deadline'))) {
        const expectedDates = dateVariants(resource.dueAt);
        if (expectedDates.length && !expectedDates.some((date) => answer.includes(date))) groundednessIssues.push({ kind: 'groundedness', code: 'structured_due_date_mismatch', message: `${resource.title} has due date ${resource.dueAt}, but the answer states a different date.`, claim: resource.title, sourceKeys: [keyFor(resource)] });
      }
      if (resource.status && answer.includes(normalize(resource.title))) {
        const knownStatuses = ['completed', 'complete', 'done', 'blocked', 'in progress', 'planned', 'not started', 'not completed', 'todo', 'to do', 'paused', 'open'];
        const resourceLine = input.answer.split(/\r?\n/).find((line) => normalize(line).includes(normalize(resource.title))) ?? '';
        if ((titleCounts.get(normalize(resource.title)) ?? 0) > 1 && !hasResourceTypeContext(resourceLine, resource.resourceType)) continue;
        const mentionedStatus = knownStatuses.find((status) => answerContainsStatus(resourceLine, status)); const expected = normalize(resource.status).replace(/\s+/g, '_');
        const matches = mentionedStatus && answerContainsStatus(mentionedStatus, expected);
        if (mentionedStatus && !matches && !answer.includes('appears') && !answer.includes('evidence suggests')) contradictionIssues.push({ kind: 'contradiction', code: 'structured_status_mismatch', message: `${resource.title} has current status ${resource.status}, which conflicts with the answer.`, claim: resource.title, sourceKeys: [keyFor(resource)] });
      }
    }
    const issueCount = coverageIssues.length + groundednessIssues.length + contradictionIssues.length + missingEvidenceIssues.length;
    return { passed: issueCount === 0, coverageIssues, groundednessIssues, contradictionIssues, missingEvidenceIssues, sourceReferences, repairRecommended: issueCount > 0, durationMs: Date.now() - startedAt };
  }
}

export const formatAskLedgerValidationFailures = (result: AskLedgerAnswerValidationResult) => [...result.coverageIssues, ...result.groundednessIssues, ...result.contradictionIssues, ...result.missingEvidenceIssues].map((issue) => `- ${issue.code}: ${issue.message}`).join('\n');

export const formatAskLedgerEvidenceLimitations = (evidencePackage: AskLedgerEvidencePackage) => {
  const limitations = [
    ...(evidencePackage.coverage.missing ?? []).map((category) => `${category} was not found`),
    ...(evidencePackage.coverage.truncated ?? []).map((category) => `${category} was truncated`),
    ...(evidencePackage.coverage.unavailable ?? []).map((provider) => `${provider} was unavailable`),
    ...(evidencePackage.coverage.notConnected ?? []).map((provider) => `${provider} is not connected`),
  ];
  return limitations.length ? `\n\nEvidence limitations: ${limitations.join('; ')}.` : '';
};
