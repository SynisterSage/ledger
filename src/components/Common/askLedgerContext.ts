import type { AskLedgerInitialContext } from '../../types/askLedgerContext';

const CONTEXT_STORAGE_KEY = 'ledger:ask-ledger:pending-context';
const CONTEXT_PREFIX = 'ask-ledger-context:';

export const encodeAskLedgerContext = (context: AskLedgerInitialContext) =>
  `${CONTEXT_PREFIX}${encodeURIComponent(JSON.stringify(context))}`;

export const decodeAskLedgerContext = (value: string | null | undefined): AskLedgerInitialContext | null => {
  if (!value?.startsWith(CONTEXT_PREFIX)) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value.slice(CONTEXT_PREFIX.length))) as Partial<AskLedgerInitialContext>;
    if (!parsed.resourceType || !parsed.resourceId || !parsed.title) return null;
    const handoff = parsed.handoff && typeof parsed.handoff === 'object' && parsed.handoff.kind === 'overview_focus'
      ? {
          kind: 'overview_focus' as const,
          workspaceId: typeof parsed.handoff.workspaceId === 'string' ? parsed.handoff.workspaceId.slice(0, 200) : '',
          overviewDate: typeof parsed.handoff.overviewDate === 'string' ? parsed.handoff.overviewDate.slice(0, 80) : '',
          insights: Array.isArray(parsed.handoff.insights) ? parsed.handoff.insights.slice(0, 3).flatMap((item) => item && typeof item === 'object' && typeof item.title === 'string' && typeof item.summary === 'string' ? [{ title: item.title.slice(0, 120), summary: item.summary.slice(0, 300) }] : []) : [],
          resourceRefs: Array.isArray(parsed.handoff.resourceRefs) ? parsed.handoff.resourceRefs.slice(0, 16).flatMap((item) => item && typeof item === 'object' && typeof item.resourceType === 'string' && typeof item.resourceId === 'string' && typeof item.title === 'string' ? [{ resourceType: item.resourceType as AskLedgerInitialContext['resourceType'], resourceId: item.resourceId.slice(0, 200), title: item.title.slice(0, 200) }] : []) : [],
        }
      : undefined;
    return {
      resourceType: parsed.resourceType,
      resourceId: parsed.resourceId,
      title: parsed.title,
      ...(parsed.contextType === 'project' ? { contextType: 'project' as const } : parsed.contextType === 'meeting' ? { contextType: 'meeting' as const } : {}),
      ...(typeof parsed.workspaceId === 'string' && parsed.workspaceId.trim() ? { workspaceId: parsed.workspaceId.slice(0, 200) } : {}),
      ...(typeof parsed.projectId === 'string' && parsed.projectId.trim() ? { projectId: parsed.projectId.slice(0, 200) } : {}),
      ...(typeof parsed.meetingNoteId === 'string' && parsed.meetingNoteId.trim() ? { meetingNoteId: parsed.meetingNoteId.slice(0, 200) } : {}),
      ...(typeof parsed.calendarSeriesId === 'string' && parsed.calendarSeriesId.trim() ? { calendarSeriesId: parsed.calendarSeriesId.slice(0, 200) } : {}),
      ...(typeof parsed.linkedProjectId === 'string' && parsed.linkedProjectId.trim() ? { linkedProjectId: parsed.linkedProjectId.slice(0, 200) } : {}),
      ...(parsed.origin === 'projects' ? { origin: 'projects' as const } : {}),
      ...(typeof parsed.initialQuestion === 'string' && parsed.initialQuestion.trim() ? { initialQuestion: parsed.initialQuestion.slice(0, 400) } : {}),
      ...(handoff?.workspaceId && handoff.overviewDate ? { handoff } : {}),
    };
  } catch {
    return null;
  }
};

export const readPendingAskLedgerContext = () => {
  try {
    const value = sessionStorage.getItem(CONTEXT_STORAGE_KEY);
    sessionStorage.removeItem(CONTEXT_STORAGE_KEY);
    return decodeAskLedgerContext(value);
  } catch {
    return null;
  }
};

// Read the handoff without consuming it. New Ask Ledger windows can render
// before the desktop route event arrives, so the initial render needs a
// synchronous way to preserve the selected resource anchor.
export const peekPendingAskLedgerContext = () => {
  try {
    return decodeAskLedgerContext(sessionStorage.getItem(CONTEXT_STORAGE_KEY));
  } catch {
    return null;
  }
};

export const openAskLedgerWithContext = (
  context: AskLedgerInitialContext,
  openHome?: () => void,
) => {
  const encoded = encodeAskLedgerContext(context);
  try {
    sessionStorage.setItem(CONTEXT_STORAGE_KEY, encoded);
  } catch {
    // The desktop focus payload remains available when session storage is unavailable.
  }

  if (window.desktopWindow?.openModule) {
    void window.desktopWindow.openModule('new-tab', { kind: 'new-tab', focusContext: encoded });
    return;
  }

  openHome?.();
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent('ledger:ask-ledger-context', { detail: context }));
  }, 0);
};
