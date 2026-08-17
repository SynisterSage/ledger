import type { AskLedgerContextItem } from '../src/types/askLedgerContext';

export type NormalizedAskLedgerContext = {
  items: AskLedgerContextItem[];
  text: string;
  estimatedTokens: number;
  truncated: boolean;
};

export type AskLedgerContextBudget = {
  maxContextTokens?: number;
  maxItemTokens?: number;
  sortByFreshness?: boolean;
};

const DEFAULT_MAX_CONTEXT_TOKENS = 2400;
const DEFAULT_MAX_ITEM_TOKENS = 700;
const FALLBACK_TITLE = 'Untitled resource';

const cleanText = (value: unknown) => String(value ?? '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const estimatedTokens = (value: string) => Math.ceil(value.length / 4);

const dateValue = (item: AskLedgerContextItem) => {
  const value = item.updatedAt ?? item.timestamp;
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const truncateText = (value: string, maxTokens: number) => {
  const maxCharacters = Math.max(1, maxTokens * 4);
  if (value.length <= maxCharacters) return { value, truncated: false };
  const candidate = value.slice(0, maxCharacters);
  const boundary = Math.max(candidate.lastIndexOf('. '), candidate.lastIndexOf(' '));
  return {
    value: `${candidate.slice(0, boundary > maxCharacters * 0.55 ? boundary : maxCharacters).trim()}…`,
    truncated: true,
  };
};

const renderItem = (item: AskLedgerContextItem, maxItemTokens: number) => {
  const content = truncateText(cleanText(item.content), maxItemTokens);
  const lines = [
    `[${item.resourceType.toUpperCase()}]`,
    `Title: ${cleanText(item.title) || FALLBACK_TITLE}`,
  ];
  if (item.status) lines.push(`Status: ${cleanText(item.status)}`);
  if (item.projectName) lines.push(`Project: ${cleanText(item.projectName)}`);
  if (item.timestamp) lines.push(`Time: ${cleanText(item.timestamp)}`);
  if (item.dueAt) lines.push(`Due: ${cleanText(item.dueAt)}`);
  if (item.endAt) lines.push(`Ends: ${cleanText(item.endAt)}`);
  if (item.priority) lines.push(`Priority: ${cleanText(item.priority)}`);
  if (item.taskHorizon) lines.push(`Horizon: ${cleanText(item.taskHorizon)}`);
  if (item.provenance) lines.push(`Origin: ${cleanText(item.provenance)}`);
  if (item.attachmentSource?.pageNumber) lines.push(`Page: ${item.attachmentSource.pageNumber}`);
  if (item.attachmentSource?.section) lines.push(`Section: ${cleanText(item.attachmentSource.section)}`);
  if (item.attachmentSource?.rowStart) lines.push(`Rows: ${item.attachmentSource.rowStart}–${item.attachmentSource.rowEnd ?? item.attachmentSource.rowStart}`);
  if (item.updatedAt) lines.push(`Updated: ${cleanText(item.updatedAt)}`);
  if (content.value) lines.push(content.value);
  return { text: lines.join('\n'), truncated: content.truncated };
};

export class LedgerContextBuilder {
  normalize(items: AskLedgerContextItem[], budget: AskLedgerContextBudget = {}): NormalizedAskLedgerContext {
    const maxContextTokens = Math.max(1, budget.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS);
    const maxItemTokens = Math.max(1, budget.maxItemTokens ?? DEFAULT_MAX_ITEM_TOKENS);
    const ordered = [...items]
      .filter((item) => item && typeof item.resourceId === 'string' && typeof item.title === 'string')
      .sort((left, right) => budget.sortByFreshness === false ? 0 : dateValue(right) - dateValue(left));

    const selected: AskLedgerContextItem[] = [];
    const rendered: string[] = [];
    let usedTokens = 0;
    let truncated = false;

    for (const item of ordered) {
      const normalizedItem: AskLedgerContextItem = {
        ...item,
        title: cleanText(item.title) || FALLBACK_TITLE,
        content: cleanText(item.content),
      };
      const renderedItem = renderItem(normalizedItem, maxItemTokens);
      const separatorTokens = rendered.length ? 2 : 0;
      const itemTokens = estimatedTokens(renderedItem.text);
      if (usedTokens + separatorTokens + itemTokens > maxContextTokens) {
        const remainingTokens = maxContextTokens - usedTokens - separatorTokens;
        if (remainingTokens < 20) {
          truncated = true;
          continue;
        }
        const shortened = renderItem(normalizedItem, Math.min(maxItemTokens, remainingTokens));
        const shortenedTokens = estimatedTokens(shortened.text);
        if (shortenedTokens > remainingTokens) {
          truncated = true;
          continue;
        }
        rendered.push(shortened.text);
        selected.push(normalizedItem);
        usedTokens += separatorTokens + shortenedTokens;
        truncated = true;
        break;
      }
      rendered.push(renderedItem.text);
      selected.push(normalizedItem);
      usedTokens += separatorTokens + itemTokens;
      truncated ||= renderedItem.truncated;
    }

    return {
      items: selected,
      text: rendered.join('\n\n'),
      estimatedTokens: usedTokens,
      truncated,
    };
  }
}

export const developmentAskLedgerContext = (): AskLedgerContextItem[] => [
  {
    resourceType: 'project',
    resourceId: 'project-local-ai',
    title: 'Local AI',
    content: 'Ledger is testing a local model runtime for grounded workspace answers.',
    status: 'Planning',
    projectId: 'project-local-ai',
    projectName: 'Local AI',
    updatedAt: '2026-08-16T12:00:00.000Z',
    sourceLabel: 'Project',
    route: 'project:project-local-ai',
  },
  {
    resourceType: 'task',
    resourceId: 'task-compare-models',
    title: 'Compare local AI models',
    content: 'Evaluate Qwen3 1.7B Q4_K_M against other local models before selecting the development default.',
    status: 'Not Started',
    projectId: 'project-local-ai',
    projectName: 'Local AI',
    updatedAt: '2026-08-15T12:00:00.000Z',
    sourceLabel: 'Task',
    route: 'task:task-compare-models',
  },
  {
    resourceType: 'note',
    resourceId: 'note-local-ai-architecture',
    title: 'Local AI Architecture',
    content: 'The semantic retrieval index has not started and the final generation model is still being evaluated.',
    updatedAt: '2026-08-16T13:00:00.000Z',
    sourceLabel: 'Note',
    route: 'note:note-local-ai-architecture',
  },
];
