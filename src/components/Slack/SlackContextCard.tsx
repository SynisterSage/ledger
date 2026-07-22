import { ChevronDown, ExternalLink, MessageSquare, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { IntegrationProviderMark } from '../Common/IntegrationProviderMark';

export type SlackContextRecord = {
  id: string;
  slack_channel_name?: string | null;
  message_text?: string | null;
  message_author_name?: string | null;
  message_author_avatar_url?: string | null;
  permalink?: string | null;
  message_created_at?: string | null;
  captured_at?: string | null;
  sync_status?: string | null;
  reply_count?: number | null;
  latest_reply_at?: string | null;
};

type SlackThreadReply = { id: string; slack_message_ts?: string | null; author_name?: string | null; message_text?: string | null; source_created_at?: string | null; is_deleted?: boolean; is_edited?: boolean };

const formatTimestamp = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const openExternal = (url?: string | null) => {
  if (!url) return;
  if (window.desktopWindow?.openExternal) void window.desktopWindow.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
};

export function SlackContextCard({ context, compact = false }: { context: SlackContextRecord; compact?: boolean }) {
  const api = useApi();
  const { activeWorkspaceId } = useWorkspaceContext();
  const [expanded, setExpanded] = useState(false);
  const [thread, setThread] = useState<{ replies: SlackThreadReply[]; unread_reply_count?: number; is_following?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const hasReplies = Number(context.reply_count ?? 0) > 0;
  const loadThread = async () => {
    if (!activeWorkspaceId || busy) return;
    setBusy(true);
    try { setThread(await api.getSlackContextThread(activeWorkspaceId, context.id) as { replies: SlackThreadReply[]; unread_reply_count?: number; is_following?: boolean }); setExpanded(true); } finally { setBusy(false); }
  };
  const refreshThread = async () => {
    if (!activeWorkspaceId || busy) return;
    setBusy(true);
    try { setThread(await api.refreshSlackContextThread(activeWorkspaceId, context.id) as { replies: SlackThreadReply[]; unread_reply_count?: number; is_following?: boolean }); } finally { setBusy(false); }
  };
  const toggleFollow = async () => {
    if (!activeWorkspaceId || !thread || busy) return;
    setBusy(true);
    try { const result = await api.followSlackContext(activeWorkspaceId, context.id, !thread.is_following) as { following: boolean }; setThread((current) => current ? { ...current, is_following: result.following } : current); } finally { setBusy(false); }
  };
  const markRead = async () => {
    if (!activeWorkspaceId || !thread || busy) return;
    const lastReply = thread.replies[thread.replies.length - 1]?.slack_message_ts;
    setBusy(true);
    try { await api.markSlackContextRead(activeWorkspaceId, context.id, lastReply); setThread((current) => current ? { ...current, unread_reply_count: 0 } : current); } finally { setBusy(false); }
  };
  return (
    <article className={`rounded-xl border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface)] ${compact ? 'px-3 py-2.5' : 'px-3.5 py-3'}`}>
      <div className="flex items-start gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#E01E5A]/10">
          <IntegrationProviderMark provider="slack" size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-[var(--ledger-text-muted)]">
            <span className="font-medium text-[var(--ledger-text-secondary)]">{context.message_author_name || 'Slack member'}</span>
            {context.slack_channel_name ? <><span>·</span><span>#{context.slack_channel_name}</span></> : null}
            {context.message_created_at ? <><span>·</span><span>{formatTimestamp(context.message_created_at)}</span></> : null}
          </div>
          <p className={`mt-1.5 text-xs leading-5 text-[var(--ledger-text-primary)] ${compact ? 'line-clamp-2' : ''}`}>{context.message_text || 'Slack message'}</p>
          {!compact && context.captured_at ? <p className="mt-1 text-[11px] text-[var(--ledger-text-muted)]">Captured {formatTimestamp(context.captured_at)}</p> : null}
          {hasReplies ? <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--ledger-text-muted)]"><button type="button" onClick={() => expanded ? setExpanded(false) : void loadThread()} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-[var(--ledger-surface-muted)]"><ChevronDown size={12} className={expanded ? 'rotate-180' : ''} /> {context.reply_count} {context.reply_count === 1 ? 'reply' : 'replies'}{thread?.unread_reply_count ? ` · ${thread.unread_reply_count} new` : ''}</button>{context.latest_reply_at ? <span>Updated {formatTimestamp(context.latest_reply_at)}</span> : null}{expanded ? <button type="button" onClick={() => void refreshThread()} disabled={busy} title="Refresh thread" className="rounded-md p-1 hover:bg-[var(--ledger-surface-muted)] disabled:opacity-50"><RefreshCw size={12} className={busy ? 'animate-spin' : ''} /></button> : null}</div> : null}
          {expanded && thread ? <div className="mt-2 space-y-1.5 border-l border-[var(--ledger-border-subtle)] pl-2.5">{thread.replies.length === 0 ? <p className="text-[11px] text-[var(--ledger-text-muted)]">No replies stored yet.</p> : thread.replies.map((reply) => <div key={reply.id} className="text-[11px] leading-4"><span className="font-medium text-[var(--ledger-text-secondary)]">{reply.author_name || 'Slack member'}</span><span className="ml-1 text-[var(--ledger-text-muted)]">{formatTimestamp(reply.source_created_at)}</span><p className="mt-0.5 text-[var(--ledger-text-secondary)]">{reply.is_deleted ? 'This reply was deleted in Slack.' : reply.message_text || 'Slack reply'}</p></div>)}<div className="flex items-center gap-1 pt-1"><button type="button" onClick={() => void toggleFollow()} disabled={busy} className="rounded-md px-1.5 py-1 text-[11px] text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-muted)] disabled:opacity-50">{thread.is_following ? 'Stop following' : 'Follow thread'}</button>{thread.unread_reply_count ? <button type="button" onClick={() => void markRead()} disabled={busy} className="rounded-md px-1.5 py-1 text-[11px] text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-muted)] disabled:opacity-50">Mark replies as read</button> : null}</div></div> : null}
        </div>
        {context.permalink ? <button type="button" onClick={() => openExternal(context.permalink)} title="Open in Slack" aria-label="Open in Slack" className="shrink-0 rounded-lg p-1.5 text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"><ExternalLink size={13} /></button> : null}
      </div>
    </article>
  );
}

export function SlackContextEmpty() {
  return <div className="flex items-center gap-2 rounded-xl border border-dashed border-[var(--ledger-border-subtle)] px-3 py-3 text-xs text-[var(--ledger-text-muted)]"><MessageSquare size={14} /> No Slack context linked.</div>;
}
