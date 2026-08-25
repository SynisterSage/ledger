import {
  getLedgerActionDefinition,
  type LedgerActionContext,
  type LedgerActionId,
} from './ledgerActionTypes.ts';

export type LedgerQuickCaptureKind = 'quick-task' | 'quick-note' | 'quick-event';

export interface LedgerActionHandlers {
  openModuleWindow: (kind: LedgerQuickCaptureKind) => void;
  openSearch: () => void;
  dispatchRendererAction?: (actionId: LedgerActionId, context: LedgerActionContext) => void;
  openMeeting?: (context: LedgerActionContext) => void;
}

export type LedgerActionDispatchResult =
  | { executed: true; actionId: LedgerActionId }
  | { executed: false; reason: 'unknown-action' | 'unavailable' };

export function canExecuteLedgerAction(
  actionId: unknown,
  context: LedgerActionContext = { source: 'unknown' }
): boolean {
  const definition = getLedgerActionDefinition(actionId);
  if (!definition || context.appReady === false) return false;
  if (definition.availability === 'authenticated' && context.authenticated !== true) return false;
  const touchBarContext = context.touchBarContext;
  if (touchBarContext) {
    if (actionIdString(actionId)?.startsWith('note.mode.')) {
      return touchBarContext.page === 'notes' && touchBarContext.surface === 'editor' && touchBarContext.resource?.type === 'note';
    }
    if (actionIdString(actionId)?.startsWith('project.lens.')) {
      return touchBarContext.page === 'projects' && touchBarContext.surface === 'detail' && touchBarContext.resource?.type === 'project';
    }
    if (actionIdString(actionId)?.startsWith('calendar.')) {
      return touchBarContext.page === 'calendar';
    }
    const meeting = touchBarContext.meeting;
    if (actionId === 'meeting.open') return Boolean(meeting?.active && meeting.noteId);
    if (actionId === 'meeting.transcript.open') {
      return Boolean(meeting?.noteId && touchBarContext.page === 'notes' && touchBarContext.surface === 'editor' && touchBarContext.resource?.type === 'note' && touchBarContext.resource.id === meeting.noteId && (meeting.transcriptAvailable || meeting.state !== 'completed'));
    }
    if (actionId === 'meeting.pause') return Boolean(meeting?.state === 'recording' && touchBarContext.resource?.id === meeting.noteId);
    if (actionId === 'meeting.resume') return Boolean(meeting?.state === 'paused' && touchBarContext.resource?.id === meeting.noteId);
    if (actionId === 'meeting.stop') return Boolean((meeting?.state === 'recording' || meeting?.state === 'paused') && touchBarContext.resource?.id === meeting.noteId);
  }
  return true;
}

function actionIdString(actionId: unknown): string | null {
  return typeof actionId === 'string' ? actionId : null;
}

export function createLedgerActionDispatcher(handlers: LedgerActionHandlers) {
  const dispatchLedgerAction = (
    actionId: unknown,
    context: LedgerActionContext = { source: 'unknown' }
  ): LedgerActionDispatchResult => {
    const definition = getLedgerActionDefinition(actionId);
    if (!definition) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[ledger-action] Rejected unknown action:', actionId);
      }
      return { executed: false, reason: 'unknown-action' };
    }

    if (!canExecuteLedgerAction(actionId, context)) {
      return { executed: false, reason: 'unavailable' };
    }

    switch (definition.id) {
      case 'task.create':
        handlers.openModuleWindow('quick-task');
        break;
      case 'note.create':
        handlers.openModuleWindow('quick-note');
        break;
      case 'event.create':
        handlers.openModuleWindow('quick-event');
        break;
      case 'search.open':
        handlers.openSearch();
        break;
      case 'meeting.open':
        handlers.openMeeting?.(context);
        break;
      default:
        handlers.dispatchRendererAction?.(definition.id, context);
        break;
    }

    return { executed: true, actionId: definition.id };
  };

  return { dispatchLedgerAction };
}

export type { LedgerActionContext, LedgerActionId };
