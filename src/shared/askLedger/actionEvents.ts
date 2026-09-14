export type AskLedgerActionCompletedDetail = {
  workspaceId: string;
  actionType: string;
  resourceId?: string | null;
};

const ACTION_EVENT = 'ledger:agent-action-completed';
const ACTION_CHANNEL = 'ledger-agent-actions';

export const emitAskLedgerActionCompleted = (detail: AskLedgerActionCompletedDetail) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ACTION_EVENT, { detail }));
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(ACTION_CHANNEL);
    channel.postMessage(detail);
    channel.close();
  }
};

export const subscribeToAskLedgerActionCompleted = (
  listener: (detail: AskLedgerActionCompletedDetail) => void
) => {
  if (typeof window === 'undefined') return () => undefined;
  const handleWindowEvent = (event: Event) => {
    const detail = (event as CustomEvent<AskLedgerActionCompletedDetail>).detail;
    if (detail?.workspaceId && detail.actionType) listener(detail);
  };
  window.addEventListener(ACTION_EVENT, handleWindowEvent);
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(ACTION_CHANNEL) : null;
  channel?.addEventListener('message', (event: MessageEvent<AskLedgerActionCompletedDetail>) => {
    if (event.data?.workspaceId && event.data.actionType) listener(event.data);
  });
  return () => {
    window.removeEventListener(ACTION_EVENT, handleWindowEvent);
    channel?.close();
  };
};
