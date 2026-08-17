import type { AskLedgerInitialContext } from '../../types/askLedgerContext';
import type { AskLedgerActionType } from '../../types/askLedgerSkills';

export type { AskLedgerActionType } from '../../types/askLedgerSkills';
export type AskLedgerActionStatus = 'pending' | 'created' | 'failed' | 'rejected';

export type AskLedgerActionProposal = {
  id: string;
  type: AskLedgerActionType;
  payload: Record<string, unknown>;
  sourceMessageId: string;
  status?: AskLedgerActionStatus;
  resultResourceId?: string;
  resultTitle?: string;
  error?: string;
};

const cleanTitle = (value: string) => value.replace(/^[-*•\d.)\s]+/, '').replace(/[.!?]+$/, '').trim().slice(0, 240);

const answerItems = (answer: string) => {
  const bullets = answer.split('\n')
    .filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line))
    .map(cleanTitle)
    .filter((line) => line.length >= 4);
  if (bullets.length) return bullets;
  const firstSentence = answer.split(/[.!?]\s+/)[0] ?? '';
  return cleanTitle(firstSentence) ? [cleanTitle(firstSentence)] : [];
};

const nextWeekday = (weekday: number) => {
  const date = new Date();
  date.setHours(9, 0, 0, 0);
  const delta = (weekday - date.getDay() + 7) % 7 || 7;
  date.setDate(date.getDate() + delta);
  return date.toISOString();
};

export const proposeAskLedgerActions = ({
  question,
  answer,
  previousAnswer,
  initialContext,
  sourceMessageId,
}: {
  question: string;
  answer: string;
  previousAnswer?: string;
  initialContext?: AskLedgerInitialContext | null;
  sourceMessageId: string;
}): AskLedgerActionProposal[] => {
  const normalized = question.trim().toLowerCase();
  const contextProjectId = initialContext?.resourceType === 'project' ? initialContext.resourceId : undefined;
  const contextTaskId = initialContext?.resourceType === 'task' ? initialContext.resourceId : undefined;
  const make = (type: AskLedgerActionType, payload: Record<string, unknown>, index = 0): AskLedgerActionProposal => ({
    id: `${sourceMessageId}-action-${index}`,
    type,
    payload,
    sourceMessageId,
    status: 'pending',
  });

  if (/\b(mark|set|move)\b/.test(normalized) && /\b(done|complete|completed|in progress|todo|to-do)\b/.test(normalized) && contextTaskId) {
    const status = /in progress/.test(normalized) ? 'in_progress' : /todo|to-do/.test(normalized) ? 'todo' : 'completed';
    return [make('update_task_status', { task_id: contextTaskId, status })];
  }

  if (/\b(create|make|add|turn|convert)\b/.test(normalized) && /\b(note|notes)\b/.test(normalized)) {
    const title = cleanTitle(question.replace(/.*?\b(?:create|make|add|turn|convert)\b.*?\bnotes?\b/i, '').replace(/^\s*(about|for|from)\s+/i, '')) || 'Ask Ledger notes';
    return [make('create_note', { title, content: answer })];
  }

  if (/\b(create|set|add)\b/.test(normalized) && /\b(reminder|remind)\b/.test(normalized)) {
    const title = cleanTitle(question.replace(/.*?\b(?:reminder|remind)\b/i, '').replace(/^\s*(to|for)\s+/i, '')) || 'Follow up from Ask Ledger';
    const weekday = normalized.includes('friday') ? 5 : normalized.includes('thursday') ? 4 : normalized.includes('wednesday') ? 3 : normalized.includes('tuesday') ? 2 : normalized.includes('monday') ? 1 : normalized.includes('saturday') ? 6 : normalized.includes('sunday') ? 0 : null;
    return [make('create_reminder', { title, remind_at: weekday === null ? null : nextWeekday(weekday) })];
  }

  if (/\b(create|make|turn|convert|add)\b/.test(normalized) && /\btask|tasks\b/.test(normalized)) {
    const source = /\b(these|those|them)\b/.test(normalized) ? previousAnswer || answer : question.replace(/.*?\b(?:task|tasks)\b/i, '').replace(/^\s*(to|for|about)\s+/i, '');
    const titles = answerItems(source).slice(0, 8);
    const usableTitles = titles.length ? titles : [cleanTitle(source) || 'New task'];
    return usableTitles.map((title, index) => make('create_task', { title, ...(contextProjectId ? { project_id: contextProjectId } : {}) }, index));
  }

  return [];
};
