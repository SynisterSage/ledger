import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  ExternalLink,
  FileText,
  FolderKanban,
  Inbox,
  ListChecks,
  LoaderCircle,
  Mic,
  Search,
  Send,
  Square,
  Users,
} from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import {
  routeForCalendarEvent,
  routeForCalendarReminder,
  routeForInboxItem,
  routeForNote,
  routeForProject,
  routeForTask,
  usePlatform,
} from '../../platform';
import { ModalCloseButton } from './ModalCloseButton';
import { ModalOverlay } from './ModalOverlay';

export type AskLedgerSourceType =
  | 'project'
  | 'task'
  | 'note'
  | 'event'
  | 'reminder'
  | 'intake'
  | 'transcript'
  | 'team'
  | 'external';

export interface AskLedgerRequest {
  question: string;
  workspaceId?: string | null;
}

export interface AskLedgerSource {
  id: string;
  title: string;
  type: AskLedgerSourceType;
  resourceId?: string;
  projectId?: string;
  parentResourceId?: string;
  route?: string | Record<string, unknown>;
  sourceLabel?: string;
  updatedAt?: string;
}

export interface AskLedgerResponse {
  answer: string;
  sources: AskLedgerSource[];
}

export type AskLedgerState =
  | { status: 'idle' | 'focused' }
  | { status: 'submitting' }
  | { status: 'streaming'; request: AskLedgerRequest; response: AskLedgerResponse }
  | { status: 'answer'; request: AskLedgerRequest; response: AskLedgerResponse }
  | { status: 'no-answer'; request: AskLedgerRequest }
  | { status: 'error'; request: AskLedgerRequest; message: string };

type LocalAISetupError = 'storage' | 'interrupted' | 'generic';

const sourceType = (value: unknown): AskLedgerSourceType | null =>
  [
    'project',
    'task',
    'note',
    'event',
    'reminder',
    'intake',
    'transcript',
    'team',
    'external',
  ].includes(String(value))
    ? (value as AskLedgerSourceType)
    : null;

const sourceIconMap: Record<AskLedgerSourceType, typeof FileText> = {
  project: FolderKanban,
  task: ListChecks,
  note: FileText,
  event: CalendarDays,
  reminder: CalendarDays,
  intake: Inbox,
  transcript: Mic,
  team: Users,
  external: ExternalLink,
};

const sourceTypeLabels: Record<AskLedgerSourceType, string> = {
  project: 'Project',
  task: 'Task',
  note: 'Note',
  event: 'Event',
  reminder: 'Reminder',
  intake: 'Intake',
  transcript: 'Transcript',
  team: 'Team',
  external: 'Resource',
};

type AskLedgerStreamEvent = {
  type: 'start' | 'sources' | 'delta' | 'done' | 'error';
  requestId: string;
  text?: string;
  sources?: Array<Record<string, unknown>>;
  error?: { code?: string; message?: string };
};

const isAskLedgerStreamEvent = (value: unknown): value is AskLedgerStreamEvent => {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<AskLedgerStreamEvent>;
  return typeof event.type === 'string' && typeof event.requestId === 'string';
};

const localAIErrorMessage = (code?: string) => {
  if (code === 'model_missing' || code === 'llama_unavailable')
    return 'Local AI could not start. Try again.';
  if (code === 'cancelled') return 'Generation cancelled.';
  return 'Local AI could not answer right now. Check the development runtime and try again.';
};

const localAISetupErrorMessage = (
  error: unknown
): { title: string; detail?: string; kind: LocalAISetupError } => {
  const message = error instanceof Error ? error.message : '';
  if (/storage|disk space/i.test(message))
    return {
      title: "Local AI couldn't be installed.",
      detail: 'There is not enough space on this device.',
      kind: 'storage',
    };
  if (/abort|cancel/i.test(message))
    return {
      title: "Local AI couldn't be installed.",
      detail: 'The download was interrupted.',
      kind: 'interrupted',
    };
  return { title: "Local AI couldn't be installed.", kind: 'generic' };
};

const formatLocalAIBytes = (bytes?: number, fallback = '~1.4 GB') => {
  if (!bytes || bytes <= 0) return fallback;
  const gigabytes = bytes / 1024 ** 3;
  if (gigabytes >= 1) return `~${gigabytes.toFixed(1)} GB`;
  return `~${Math.round(bytes / 1024 ** 2)} MB`;
};

const formatDownloadedBytes = (bytes?: number) => {
  if (!bytes || bytes < 1024 ** 2) return '0 MB';
  return `${Math.round(bytes / 1024 ** 2)} MB`;
};

export const AskLedgerPanel = ({ workspaceId }: { workspaceId?: string | null }) => {
  const api = useApi();
  const platform = usePlatform();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [question, setQuestion] = useState('');
  const [state, setState] = useState<AskLedgerState>({ status: 'idle' });
  const [localAIStatus, setLocalAIStatus] = useState<{
    generation?: {
      installed?: boolean;
      downloading?: boolean;
      bytesDownloaded?: number;
      expectedSize?: number;
      error?: string | null;
    };
    runtimeAvailable?: boolean;
  } | null>(null);
  const [setupStarted, setSetupStarted] = useState(false);
  const [setupError, setSetupError] = useState<{
    title: string;
    detail?: string;
    kind: LocalAISetupError;
  } | null>(null);
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const setupCancelRequestedRef = useRef(false);
  const requestIdRef = useRef(0);
  const activeRequestIdRef = useRef<string | null>(null);
  const sourceItemsRef = useRef<AskLedgerSource[]>([]);
  const conversationRef = useRef<{
    previousQuestion: string;
    previousAnswer: string;
    previousSources: AskLedgerSource[];
  } | null>(null);
  const questionRef = useRef(question);
  const workspaceIdRef = useRef(workspaceId);
  questionRef.current = question;
  workspaceIdRef.current = workspaceId;

  useEffect(() => {
    inputRef.current?.focus();
    const unsubscribe =
      window.askLedger?.onStream((value) => {
        if (!isAskLedgerStreamEvent(value) || value.requestId !== activeRequestIdRef.current)
          return;
        if (value.type === 'sources') {
          sourceItemsRef.current = (value.sources ?? [])
            .map((source) => {
              const type = sourceType(source.resourceType);
              return type
                ? {
                    id: String(source.resourceId ?? ''),
                    resourceId: String(source.resourceId ?? ''),
                    parentResourceId: source.parentResourceId
                      ? String(source.parentResourceId)
                      : undefined,
                    projectId: source.projectId ? String(source.projectId) : undefined,
                    title: String(source.title ?? 'Untitled'),
                    type,
                    route: source.route as string | Record<string, unknown> | undefined,
                    sourceLabel: source.sourceLabel ? String(source.sourceLabel) : undefined,
                    updatedAt: source.updatedAt ? String(source.updatedAt) : undefined,
                  }
                : null;
            })
            .filter(Boolean) as AskLedgerSource[];
          return;
        }
        if (value.type === 'delta' && typeof value.text === 'string') {
          setState((current) => {
            if (current.status !== 'submitting' && current.status !== 'streaming') return current;
            const request =
              current.status === 'streaming'
                ? current.request
                : { question: questionRef.current.trim(), workspaceId: workspaceIdRef.current };
            const answer = current.status === 'streaming' ? current.response.answer : '';
            return {
              status: 'streaming',
              request,
              response: { answer: `${answer}${value.text}`, sources: sourceItemsRef.current },
            };
          });
          return;
        }
        if (value.type === 'done') {
          setState((current) => {
            if (current.status !== 'streaming') return current;
            const isAbstention =
              /(?:couldn['’]t find enough information|don't have enough Ledger context)/i.test(
                current.response.answer
              );
            if (isAbstention || !current.response.answer.trim())
              return { status: 'no-answer', request: current.request };
            conversationRef.current = {
              previousQuestion: current.request.question,
              previousAnswer: current.response.answer,
              previousSources: current.response.sources,
            };
            return { ...current, status: 'answer' };
          });
          activeRequestIdRef.current = null;
          return;
        }
        if (value.type === 'error') {
          setState((current) => {
            const request =
              current.status === 'streaming' || current.status === 'submitting'
                ? current.status === 'streaming'
                  ? current.request
                  : { question: questionRef.current.trim(), workspaceId: workspaceIdRef.current }
                : { question: questionRef.current.trim(), workspaceId: workspaceIdRef.current };
            return { status: 'error', request, message: localAIErrorMessage(value.error?.code) };
          });
          activeRequestIdRef.current = null;
        }
      }) ?? (() => undefined);
    return () => {
      requestIdRef.current += 1;
      if (activeRequestIdRef.current) void window.askLedger?.cancel(activeRequestIdRef.current);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!window.askLedger?.localAIStatus) return;
    void window.askLedger
      .localAIStatus()
      .then((value) => setLocalAIStatus(value as typeof localAIStatus));
    return window.askLedger.onLocalAIStatus((value) =>
      setLocalAIStatus(value as typeof localAIStatus)
    );
  }, []);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = '0px';
    input.style.height = `${Math.min(input.scrollHeight, 128)}px`;
  }, [question]);

  const submit = () => {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || !localAIReady) return;

    if (activeRequestIdRef.current) void window.askLedger?.cancel(activeRequestIdRef.current);

    const request: AskLedgerRequest = { question: trimmedQuestion, workspaceId };
    const requestId = ++requestIdRef.current;
    setState({ status: 'submitting' });

    if (!window.askLedger) {
      setState({
        status: 'error',
        request,
        message: 'Local AI is available in the Ledger desktop development runtime.',
      });
      return;
    }
    if (!workspaceId) {
      setState({ status: 'error', request, message: 'Select a workspace before asking Ledger.' });
      return;
    }
    void Promise.all([
      api.getAskLedgerDocuments(workspaceId) as Promise<{
        workspaceId?: string;
        documents?: Array<Record<string, unknown>>;
      }>,
      api.searchWorkspace(workspaceId, trimmedQuestion) as Promise<Array<Record<string, unknown>>>,
    ])
      .then(([documentPayload, lexicalResults]) => {
        const documents: Array<Record<string, unknown>> = (documentPayload.documents ?? []).map(
          (item) => ({ ...item, workspaceId })
        );
        sourceItemsRef.current = documents
          .map((item) => {
            const type = sourceType(item.resourceType);
            return type
              ? { id: String(item.resourceId), title: String(item.title ?? 'Untitled'), type }
              : null;
          })
          .filter((item): item is AskLedgerSource => Boolean(item))
          .slice(0, 8);
        return window.askLedger!.start({
          question: trimmedQuestion,
          workspaceId,
          documents,
          lexicalResults,
          conversation: conversationRef.current,
        });
      })
      .then(({ requestId: localRequestId }) => {
        if (requestId !== requestIdRef.current) return;
        activeRequestIdRef.current = localRequestId;
      })
      .catch(() => {
        if (requestId === requestIdRef.current)
          setState({ status: 'error', request, message: localAIErrorMessage() });
      });
  };

  const cancel = () => {
    if (!activeRequestIdRef.current) return;
    void window.askLedger?.cancel(activeRequestIdRef.current);
    activeRequestIdRef.current = null;
    setState({ status: 'focused' });
  };

  const startLocalAISetup = () => {
    setupCancelRequestedRef.current = false;
    setSetupStarted(true);
    setSetupError(null);
    void window.askLedger?.downloadLocalAI('generation').catch((error) => {
      if (setupCancelRequestedRef.current) return;
      setSetupStarted(false);
      setSetupError(localAISetupErrorMessage(error));
    });
  };

  const cancelLocalAISetup = () => {
    setupCancelRequestedRef.current = true;
    setSetupStarted(false);
    void window.askLedger?.cancelLocalAIDownload('generation');
  };

  const closeSetupModal = () => {
    if (generation?.downloading) return;
    setSetupModalOpen(false);
    setSetupStarted(false);
    setSetupError(null);
  };

  const openSource = (source: AskLedgerSource) => {
    if (!workspaceId) return;
    const id = source.resourceId ?? source.id;
    switch (source.type) {
      case 'project':
        platform.navigation.openRoute(routeForProject(workspaceId, id));
        return;
      case 'task':
        platform.navigation.openRoute(
          source.projectId
            ? routeForProject(workspaceId, source.projectId, id)
            : routeForTask(workspaceId, id)
        );
        return;
      case 'note':
        platform.navigation.openRoute(routeForNote(workspaceId, source.parentResourceId ?? id));
        return;
      case 'transcript':
        platform.navigation.openRoute(routeForNote(workspaceId, source.parentResourceId ?? id));
        return;
      case 'event':
        platform.navigation.openRoute(routeForCalendarEvent(workspaceId, id));
        return;
      case 'reminder':
        platform.navigation.openRoute(routeForCalendarReminder(workspaceId, id));
        return;
      case 'intake':
        platform.navigation.openRoute(routeForInboxItem(workspaceId, id));
        return;
      case 'team':
        platform.navigation.openRoute({ kind: 'workspace', workspaceId, page: 'team', teamId: id });
        return;
      default:
        return;
    }
  };

  const isSubmitting = state.status === 'submitting' || state.status === 'streaming';
  const generation = localAIStatus?.generation;
  const localAIReady = Boolean(generation?.installed);
  const localAIUnavailable = Boolean(window.askLedger && localAIStatus && !localAIReady);
  const localAIProgress = generation?.expectedSize
    ? Math.min(100, Math.round(((generation.bytesDownloaded ?? 0) / generation.expectedSize) * 100))
    : 0;
  const localAISettingUp = Boolean(generation?.downloading || (setupStarted && !localAIReady));
  const localAIVerifying = Boolean(
    setupStarted && !generation?.downloading && !localAIReady && !setupError
  );
  const displayedRequest =
    state.status === 'answer' ||
    state.status === 'streaming' ||
    state.status === 'no-answer' ||
    state.status === 'error'
      ? state.request.question
      : '';

  useEffect(() => {
    if (!localAIReady) return;
    setSetupStarted(false);
    setSetupModalOpen(false);
    setSetupError(null);
  }, [localAIReady]);

  return (
    <div className="mt-5">
      <div
        className={`flex w-full items-end gap-3 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-4 py-3 shadow-[0_4px_18px_rgba(17,24,39,0.04)] transition focus-within:border-[color:var(--ledger-border-strong)] ${localAIUnavailable ? 'cursor-pointer' : ''}`}
        onClick={() => {
          if (localAIUnavailable) setSetupModalOpen(true);
        }}
      >
        <Search size={17} className="mb-1 shrink-0 text-[var(--ledger-text-muted)]" />
        <textarea
          ref={inputRef}
          value={question}
          readOnly={!localAIReady}
          onChange={(event) => {
            if (!localAIReady) return;
            setQuestion(event.target.value);
            if (state.status === 'idle') setState({ status: 'focused' });
          }}
          onFocus={() => {
            if (localAIUnavailable) setSetupModalOpen(true);
            if (state.status === 'idle') setState({ status: 'focused' });
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (localAIReady) submit();
            }
          }}
          rows={1}
          placeholder="Ask anything about your workspace…"
          aria-label="Ask Ledger"
          aria-disabled={localAIUnavailable}
          className={`max-h-32 min-h-6 min-w-0 flex-1 resize-none bg-transparent text-sm leading-6 placeholder:text-[var(--ledger-placeholder)] focus:outline-none ${localAIUnavailable ? 'cursor-pointer text-[var(--ledger-text-secondary)]' : 'text-[var(--ledger-text-primary)]'}`}
        />
        {localAIUnavailable && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setSetupModalOpen(true);
            }}
            aria-label="Set up Local AI"
            className="mb-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
          >
            <AlertCircle size={15} />
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!question.trim() || !localAIReady || isSubmitting}
          aria-label="Submit question"
          className="mb-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:cursor-default disabled:opacity-35"
        >
          {isSubmitting ? <LoaderCircle size={15} className="animate-spin" /> : <Send size={15} />}
        </button>
        {isSubmitting && (
          <button
            type="button"
            onClick={cancel}
            aria-label="Cancel generation"
            className="mb-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
          >
            <Square size={12} />
          </button>
        )}
      </div>
      {localAIUnavailable && (
        <p className="mt-2 px-1 text-xs text-[var(--ledger-text-muted)]">
          Set up Local AI to ask your workspace.
        </p>
      )}

      <ModalOverlay
        isOpen={setupModalOpen}
        onClose={closeSetupModal}
        backdropBorderRadius="var(--window-radius)"
        backdropInset="0px"
        manageWindowChrome={false}
        classNameContainer="w-full max-w-[420px] overflow-hidden rounded-[var(--ledger-surface-radius)] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
      >
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-[var(--ledger-text-primary)]">Set up Local AI</h2>
              <p className="mt-1 text-xs text-[var(--ledger-text-muted)]">Ask Ledger uses local AI that runs on this device.</p>
            </div>
            <ModalCloseButton onClick={closeSetupModal} ariaLabel="Close Local AI setup" disabled={localAISettingUp} />
          </div>

          {setupError ? (
            <div className="mt-5 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-3">
              <p className="text-sm font-medium text-[var(--ledger-text-primary)]">{setupError.title}</p>
              {setupError.detail && <p className="mt-1 text-xs text-[var(--ledger-text-muted)]">{setupError.detail}</p>}
            </div>
          ) : localAISettingUp ? (
            <div className="mt-5">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-medium text-[var(--ledger-text-primary)]">Setting up Local AI</p>
                {localAIVerifying ? <span className="inline-flex items-center gap-1.5 text-xs text-[var(--ledger-text-muted)]"><LoaderCircle size={12} className="animate-spin" /> Verifying files…</span> : <span className="text-xs tabular-nums text-[var(--ledger-text-muted)]">{localAIProgress}%</span>}
              </div>
              {!localAIVerifying && <>
                <p className="mt-4 text-xs text-[var(--ledger-text-muted)]">Downloading models…</p>
                <p className="mt-1 text-xs tabular-nums text-[var(--ledger-text-secondary)]">{formatDownloadedBytes(generation?.bytesDownloaded)} of {formatLocalAIBytes(generation?.expectedSize)}</p>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--ledger-surface-hover)]" role="progressbar" aria-label="Local AI setup progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={localAIProgress}><div className="h-full rounded-full bg-[var(--ledger-accent)] transition-[width] duration-300" style={{ width: `${Math.max(localAIProgress, 1)}%` }} /></div>
              </>}
              <button type="button" onClick={() => { cancelLocalAISetup(); setSetupModalOpen(false); }} className="mt-4 text-xs text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-text-primary)]">Cancel</button>
            </div>
          ) : (
            <>
              <p className="mt-5 text-sm leading-6 text-[var(--ledger-text-secondary)]">Download the required models to enable workspace questions.</p>
              <div className="mt-4 flex items-center justify-between border-t border-[color:var(--ledger-border-subtle)] pt-3 text-xs text-[var(--ledger-text-muted)]"><span>Approx. {formatLocalAIBytes(generation?.expectedSize).replace(/^~/, '')}</span><span>Runs on this device</span></div>
              <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={closeSetupModal} className="rounded-md px-3 py-2 text-xs text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]">Cancel</button><button type="button" onClick={startLocalAISetup} className="rounded-md bg-[var(--ledger-text-primary)] px-3 py-2 text-xs font-medium text-[var(--ledger-surface)] transition hover:opacity-85">Set up</button></div>
            </>
          )}
          {setupError && <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={closeSetupModal} className="rounded-md px-3 py-2 text-xs text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]">Cancel</button><button type="button" onClick={startLocalAISetup} className="rounded-md bg-[var(--ledger-text-primary)] px-3 py-2 text-xs font-medium text-[var(--ledger-surface)] transition hover:opacity-85">Try again</button></div>}
        </div>
      </ModalOverlay>

      {state.status === 'submitting' && (
        <p className="mt-8 px-1 text-sm text-[var(--ledger-text-muted)]">Starting local AI…</p>
      )}

      {(state.status === 'streaming' || state.status === 'answer') && (
        <section className="mt-10" aria-live="polite">
          <p className="text-sm font-medium text-[var(--ledger-text-primary)]">
            {displayedRequest}
          </p>
          <p className="mt-5 max-w-[620px] whitespace-pre-wrap text-[15px] leading-7 text-[var(--ledger-text-secondary)]">
            {state.response.answer || 'Generating…'}
          </p>
          {state.status === 'answer' && (
            <div className="mt-8">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--ledger-text-muted)]">
                Sources
              </p>
              <div className="divide-y divide-[color:var(--ledger-border-subtle)]">
                {state.response.sources.map((source) => {
                  const Icon = sourceIconMap[source.type];
                  return (
                    <button
                      key={source.id}
                      type="button"
                      onClick={() => openSource(source)}
                      className="flex min-h-10 w-full items-center gap-2.5 py-2 text-left transition hover:text-[var(--ledger-text-primary)]"
                    >
                      <Icon size={14} className="shrink-0 text-[var(--ledger-text-muted)]" />
                      <span className="min-w-0 flex-1 truncate text-sm text-[var(--ledger-text-secondary)]">
                        {source.title}
                      </span>
                      <span className="shrink-0 text-[11px] text-[var(--ledger-text-muted)]">
                        {sourceTypeLabels[source.type]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {state.status === 'no-answer' && (
        <p
          className="mt-10 px-1 text-sm leading-6 text-[var(--ledger-text-muted)]"
          aria-live="polite"
        >
          I couldn’t find enough information in the provided Ledger context.
        </p>
      )}

      {state.status === 'error' && (
        <p className="mt-10 px-1 text-sm leading-6 text-[var(--ledger-text-muted)]" role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
};
