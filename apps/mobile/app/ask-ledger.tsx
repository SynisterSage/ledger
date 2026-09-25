import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';

import { getMobileToday } from '@/api/today';
import { getMobileNoteSummaries, type MobileNoteSummary } from '@/api/notes';
import { getMobileProjects, type MobileProjectsResponse } from '@/api/projects';
import { getMobileCalendarRange, type MobileCalendarRangeResponse } from '@/api/calendar';
import {
  createMobileAskLedgerSession,
  deleteMobileAskLedgerSession,
  getMobileAskLedgerSession,
  listMobileAskLedgerSessions,
  updateMobileAskLedgerSession,
  executeMobileAskLedgerAction,
  type MobileAskLedgerMessage,
  type MobileAskLedgerAction,
  type MobileAskLedgerSession,
} from '@/api/askLedger';
import { generateMobileAIResponse } from '@/features/askLedger/mobileAIProvider';
import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { MobilePageHeader } from '@/components/MobilePageHeader';
import { useLedgerTheme } from '@/theme';
import { useWorkspaceState } from '@/store/workspaceStore';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function localDateOffset(offset: number) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function buildLedgerContext(
  today: Awaited<ReturnType<typeof getMobileToday>>,
  notes: MobileNoteSummary[],
  projects: MobileProjectsResponse,
  calendar: MobileCalendarRangeResponse,
) {
  const lines = [
    `Date: ${today.date}`,
    `Scope: ${today.scope.label}`,
    'Today:',
    ...today.today.slice(0, 20).map((item) => `- ${item.title} (${item.meta}; ${item.status})`),
    'Upcoming:',
    ...today.upcoming.slice(0, 12).map((item) => `- ${item.title} (${item.dateLabel ?? item.timeLabel ?? 'scheduled'})`),
    'Projects needing attention:',
    ...today.projects.slice(0, 12).map((project) => `- ${project.title} (${project.attentionReason ?? project.projectStatus ?? 'active'}; next action: ${project.nextAction ?? 'none'})`),
    'Recent captures:',
    ...today.captures.items.slice(0, 8).map((item) => `- ${item.title}`),
    'Notes:',
    ...notes.slice(0, 20).map((note) => `- ${note.title}${note.preview ? `: ${note.preview.slice(0, 240)}` : ''}`),
    'Projects:',
    ...projects.projects.filter((project) => project.status !== 'completed').slice(0, 20).map((project) => `- ${project.name} (${project.status ?? 'active'}; ${project.attention_reason ?? project.next_action ?? 'no next action'})`),
    'Milestones:',
    ...projects.milestones.filter((milestone) => !milestone.completed).slice(0, 16).map((milestone) => `- ${milestone.title}${milestone.milestone_date ? ` (${milestone.milestone_date})` : ''}`),
    'Calendar events:',
    ...calendar.events.slice(0, 20).map((event) => `- ${String(event.title ?? event.name ?? 'Untitled event')} (${String(event.start_at ?? event.startAt ?? event.date ?? 'scheduled')})`),
    'Reminders:',
    ...calendar.reminders.slice(0, 16).map((reminder) => `- ${String(reminder.title ?? 'Untitled reminder')} (${String(reminder.remind_at ?? reminder.due_at ?? reminder.date ?? 'scheduled')})`),
  ];
  return lines.join('\n');
}

function formatSessionDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function detectMobileAction(question: string, sourceMessageId: string): MobileAskLedgerAction | null {
  const normalized = question.trim();
  const taskMatch = normalized.match(/^(?:please\s+)?(?:create|add|make)\s+(?:a\s+)?task(?:\s+(?:called|titled|to))?\s+(.+)$/i);
  if (taskMatch?.[1]) {
    return {
      id: `${sourceMessageId}-action-0`,
      type: 'create_task',
      payload: { title: taskMatch[1].trim().replace(/[.!?]+$/, '') },
      sourceMessageId,
      status: 'pending',
      idempotencyKey: `ask-ledger:${sourceMessageId}-action-0`,
    };
  }
  const noteMatch = normalized.match(/^(?:please\s+)?(?:create|make|save)\s+(?:a\s+)?note(?:\s+(?:called|titled|about))?\s+(.+)$/i);
  if (noteMatch?.[1]) {
    return {
      id: `${sourceMessageId}-action-0`,
      type: 'create_note',
      payload: { title: noteMatch[1].trim().replace(/[.!?]+$/, ''), content: noteMatch[1].trim() },
      sourceMessageId,
      status: 'pending',
      idempotencyKey: `ask-ledger:${sourceMessageId}-action-0`,
    };
  }
  const reminderMatch = normalized.match(/^(?:please\s+)?remind me to\s+(.+?)\s+(?:at|on)\s+(.+)$/i);
  if (reminderMatch?.[1] && reminderMatch[2]) {
    const parsedDate = new Date(reminderMatch[2]);
    if (!Number.isNaN(parsedDate.getTime())) {
      return {
        id: `${sourceMessageId}-action-0`,
        type: 'create_reminder',
        payload: { title: reminderMatch[1].trim().replace(/[.!?]+$/, ''), remind_at: parsedDate.toISOString() },
        sourceMessageId,
        status: 'pending',
        idempotencyKey: `ask-ledger:${sourceMessageId}-action-0`,
      };
    }
  }
  return null;
}

function actionTitle(action: MobileAskLedgerAction) {
  if (action.type === 'create_note') return 'Save this note?';
  if (action.type === 'create_reminder') return 'Create this reminder?';
  return 'Create this task?';
}

export default function AskLedgerScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const workspaceState = useWorkspaceState();
  const scrollY = useRef(new Animated.Value(0)).current;
  const abortRef = useRef<AbortController | null>(null);
  const [messages, setMessages] = useState<MobileAskLedgerMessage[]>([]);
  const [sessions, setSessions] = useState<MobileAskLedgerSession[]>([]);
  const [input, setInput] = useState('');
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [context, setContext] = useState<string | null>(null);
  const [contextSummary, setContextSummary] = useState('Today, upcoming work, projects, and captures');
  const [streamingAnswer, setStreamingAnswer] = useState('');
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<MobileAskLedgerAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const workspace = useMemo(() => {
    const candidate = [workspaceState.selectedWorkspaceId, workspaceState.todayScopeWorkspaceId, ...workspaceState.options.map((item) => item.id)].find((id) => uuidPattern.test(id));
    return candidate ?? null;
  }, [workspaceState.options, workspaceState.selectedWorkspaceId, workspaceState.todayScopeWorkspaceId]);

  const loadWorkspace = useCallback(async (nextWorkspaceId: string) => {
    setLoading(true);
    setError(null);
    try {
      const [sessionResult, today, noteResult, projectResult, calendar] = await Promise.all([
        listMobileAskLedgerSessions(nextWorkspaceId, 20),
        getMobileToday({ workspaceId: nextWorkspaceId }),
        getMobileNoteSummaries(nextWorkspaceId).catch(() => [] as MobileNoteSummary[]),
        getMobileProjects(nextWorkspaceId, true).catch(() => ({ workspace_id: nextWorkspaceId, projects: [], milestones: [] } as MobileProjectsResponse)),
        getMobileCalendarRange(nextWorkspaceId, localDateOffset(-1), localDateOffset(30)).catch(() => ({ workspace_id: nextWorkspaceId, start_date: localDateOffset(-1), end_date: localDateOffset(30), events: [], reminders: [], tasks: [], projects: [], milestones: [], calendars: [] } as MobileCalendarRangeResponse)),
      ]);
      const notes = Array.isArray(noteResult) ? noteResult : noteResult.notes ?? [];
      setWorkspaceId(nextWorkspaceId);
      setSessions(sessionResult.sessions);
      setContext(buildLedgerContext(today, notes, projectResult, calendar));
      setContextSummary(`${today.today.length} today · ${notes.length} notes · ${projectResult.projects.length} projects · ${calendar.events.length + calendar.reminders.length} scheduled`);
      const latest = sessionResult.sessions[0];
      setMessages(latest?.messages ?? []);
      setSessionId(latest?.id ?? null);
      setPendingAction(latest?.messages.flatMap((message) => message.actions ?? []).find((action) => action.status === 'pending') ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load Ask Ledger.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (workspace) void loadWorkspace(workspace);
  }, [loadWorkspace, workspace]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const startNewConversation = () => {
    if (busy) return;
    setMessages([]);
    setSessionId(null);
    setLastQuestion(null);
    setStreamingAnswer('');
    setPendingAction(null);
    setError(null);
    setHistoryOpen(false);
  };

  const openSession = async (session: MobileAskLedgerSession) => {
    if (!workspaceId || busy) return;
    setHistoryOpen(false);
    setLoading(true);
    try {
      const result = await getMobileAskLedgerSession(workspaceId, session.id);
      setMessages(result.session.messages);
      setSessionId(result.session.id);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not open that conversation.');
    } finally {
      setLoading(false);
    }
  };

  const deleteSession = (session: MobileAskLedgerSession) => {
    if (!workspaceId || busy) return;
    Alert.alert('Delete conversation?', 'This removes the saved Ask Ledger conversation from your workspace.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await deleteMobileAskLedgerSession(workspaceId, session.id);
          const remaining = sessions.filter((item) => item.id !== session.id);
          setSessions(remaining);
          if (session.id === sessionId) {
            setMessages([]);
            setSessionId(null);
          }
        } catch (deleteError) {
          setError(deleteError instanceof Error ? deleteError.message : 'Could not delete that conversation.');
        }
      } },
    ]);
  };

  const ask = async (requestedQuestion = input.trim()) => {
    const question = requestedQuestion.trim();
    if (!question || busy || !context) return;
    const userMessage: MobileAskLedgerMessage = { id: `user-${Date.now()}`, role: 'user', content: question, createdAt: new Date().toISOString() };
    const previousMessages = messages;
    const nextMessages = [...previousMessages, userMessage];
    const controller = new AbortController();
    abortRef.current = controller;
    setMessages(nextMessages);
    setInput('');
    setLastQuestion(question);
    setStreamingAnswer('');
    setBusy(true);
    setError(null);
    try {
      const detectedAction = detectMobileAction(question, userMessage.id);
      const answer = detectedAction
        ? 'I prepared this Ledger action for your review. Nothing will be saved until you confirm it.'
        : await generateMobileAIResponse(question, context, {
        signal: controller.signal,
        onDelta: (text) => setStreamingAnswer((current) => current + text),
      });
      const assistantMessageId = `assistant-${Date.now()}`;
      const completedMessages = [...nextMessages, { id: assistantMessageId, role: 'assistant' as const, content: answer, createdAt: new Date().toISOString(), ...(detectedAction ? { actions: [{ ...detectedAction, sourceMessageId: assistantMessageId, id: `${assistantMessageId}-action-0`, idempotencyKey: `ask-ledger:${assistantMessageId}-action-0` }] } : {}) }];
      setMessages(completedMessages);
      setStreamingAnswer('');
      if (detectedAction) setPendingAction({ ...detectedAction, sourceMessageId: assistantMessageId, id: `${assistantMessageId}-action-0`, idempotencyKey: `ask-ledger:${assistantMessageId}-action-0` });
      if (workspaceId) {
        if (sessionId) {
          const updated = await updateMobileAskLedgerSession(workspaceId, sessionId, completedMessages);
          setSessions((current) => [updated.session, ...current.filter((item) => item.id !== sessionId)]);
        } else {
          const created = await createMobileAskLedgerSession(workspaceId, { title: question.slice(0, 120), messages: completedMessages });
          setSessionId(created.session.id);
          setSessions((current) => [created.session, ...current]);
        }
      }
    } catch (askError) {
      setMessages(previousMessages);
      setStreamingAnswer('');
      if (!(askError instanceof DOMException && askError.name === 'AbortError')) {
        setError(askError instanceof Error ? askError.message : 'Ask Ledger could not answer.');
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const resolveAction = async (approved: boolean) => {
    if (!pendingAction || !workspaceId || actionBusy) return;
    setActionBusy(true);
    const nextStatus: MobileAskLedgerAction['status'] = approved ? 'created' : 'rejected';
    try {
      let result: { resourceType: string; resource: { id?: string; title?: string } } | null = null;
      if (approved) result = await executeMobileAskLedgerAction(workspaceId, pendingAction);
      const updatedAction: MobileAskLedgerAction = {
        ...pendingAction,
        status: nextStatus,
        ...(result?.resource?.id ? { resultResourceId: result.resource.id } : {}),
        ...(result?.resource?.title ? { resultTitle: result.resource.title } : {}),
      };
      const updatedMessages = messages.map((message) => ({
        ...message,
        actions: message.actions?.map((action) => action.id === pendingAction.id ? updatedAction : action),
      }));
      setMessages(updatedMessages);
      setPendingAction(null);
      if (sessionId) {
        const updated = await updateMobileAskLedgerSession(workspaceId, sessionId, updatedMessages);
        setSessions((current) => [updated.session, ...current.filter((item) => item.id !== sessionId)]);
      }
      await loadWorkspace(workspaceId);
      setError(approved ? `${result?.resourceType === 'note' ? 'Note' : result?.resourceType === 'reminder' ? 'Reminder' : 'Task'} created.` : 'Action dismissed.');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not complete that action.');
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <MobilePageHeader title="Ask Ledger" showBack onBackPress={() => router.back()} scrollY={scrollY} showSettings={false} rightAccessory={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}><Pressable onPress={() => setHistoryOpen(true)} disabled={busy}><AppText variant="meta" style={{ color: theme.colors.accent }}>History</AppText></Pressable><Pressable onPress={startNewConversation} disabled={busy}><AppText variant="meta" style={{ color: theme.colors.accent }}>New</AppText></Pressable></View>} />
      <Animated.ScrollView contentContainerStyle={{ paddingTop: 112, paddingHorizontal: 20, paddingBottom: 150, gap: 16 }} onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })} scrollEventThrottle={16}>
        {loading ? <ActivityIndicator color={theme.colors.accent} /> : null}
        {!loading && !workspace ? <AppText variant="body" style={{ color: theme.colors.textSecondary }}>Choose a workspace before using Ask Ledger.</AppText> : null}
        {!loading && workspace ? <View style={{ padding: 12, borderRadius: 14, backgroundColor: theme.colors.surfaceMuted, gap: 3 }}><AppText variant="meta" style={{ color: theme.colors.textSecondary }}>Using Ledger context</AppText><AppText variant="body">{contextSummary}</AppText></View> : null}
        {messages.length === 0 && !loading ? <View style={{ gap: 8, paddingVertical: 20 }}><AppText variant="screenTitle">What needs your attention?</AppText><AppText variant="body" style={{ color: theme.colors.textSecondary }}>Ask about today, upcoming work, projects, or recent captures.</AppText><View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>{['Plan my day', 'What is overdue?', 'What should I do next?'].map((prompt) => <Pressable key={prompt} onPress={() => setInput(prompt)} style={{ paddingHorizontal: 12, paddingVertical: 9, borderRadius: 16, backgroundColor: theme.colors.surfaceMuted }}><AppText variant="meta">{prompt}</AppText></Pressable>)}</View></View> : null}
        {messages.map((message) => <View key={message.id} style={{ alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%', padding: 12, borderRadius: 14, backgroundColor: message.role === 'user' ? theme.colors.accent : theme.colors.surfaceMuted }}><AppText variant="body" style={{ color: message.role === 'user' ? '#FFFFFF' : theme.colors.textPrimary }}>{message.content}</AppText></View>)}
        {streamingAnswer ? <View style={{ alignSelf: 'flex-start', maxWidth: '88%', padding: 12, borderRadius: 14, backgroundColor: theme.colors.surfaceMuted }}><AppText variant="body">{streamingAnswer}</AppText></View> : null}
        {pendingAction ? <View style={{ padding: 14, borderRadius: 16, backgroundColor: theme.colors.surfaceMuted, gap: 10 }}><AppText variant="bodyStrong">{actionTitle(pendingAction)}</AppText><AppText variant="body">{String(pendingAction.payload.title ?? '')}</AppText><AppText variant="meta" style={{ color: theme.colors.textSecondary }}>Review this before Ledger saves it.</AppText><View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}><AppButton title={actionBusy ? 'Saving…' : 'Confirm'} onPress={() => void resolveAction(true)} disabled={actionBusy} /></View><View style={{ flex: 1 }}><AppButton title="Dismiss" variant="secondary" onPress={() => void resolveAction(false)} disabled={actionBusy} /></View></View></View> : null}
        {error ? <View style={{ gap: 8 }}><AppText variant="meta" style={{ color: theme.colors.danger }}>{error}</AppText>{lastQuestion ? <Pressable onPress={() => void ask(lastQuestion)} disabled={busy}><AppText variant="meta" style={{ color: theme.colors.accent }}>Retry</AppText></Pressable> : null}</View> : null}
      </Animated.ScrollView>
      <View style={{ padding: 12, gap: 8, backgroundColor: theme.colors.background }}><AppTextInput label="Ask Ledger" placeholder="What should I focus on?" value={input} onChangeText={setInput} multiline autoCapitalize="sentences" /><AppButton title={busy ? 'Stop' : 'Ask'} onPress={() => busy ? abortRef.current?.abort() : void ask()} disabled={loading || (!busy && !input.trim())} /></View>

      <AppBottomSheet visible={historyOpen} onClose={() => setHistoryOpen(false)} title="Ask Ledger history" snapPoints={['54%', '84%']} initialSnapPointIndex={1}>
        <View style={{ gap: 8 }}>
          <Pressable onPress={startNewConversation} style={{ padding: 14, borderRadius: 14, backgroundColor: theme.colors.surfaceMuted }}><AppText variant="bodyStrong" style={{ color: theme.colors.accent }}>New conversation</AppText></Pressable>
          {sessions.length === 0 ? <AppText variant="body" style={{ color: theme.colors.textSecondary, paddingVertical: 14 }}>No saved conversations yet.</AppText> : sessions.map((session) => <View key={session.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}><Pressable onPress={() => void openSession(session)} style={{ flex: 1, gap: 3 }}><AppText variant="bodyStrong" numberOfLines={1}>{session.title}</AppText><AppText variant="meta" style={{ color: theme.colors.textSecondary }}>{formatSessionDate(session.updatedAt)} · {session.messages.length} messages</AppText></Pressable><Pressable onPress={() => deleteSession(session)} hitSlop={8}><AppText variant="meta" style={{ color: theme.colors.danger }}>Delete</AppText></Pressable></View>)}
        </View>
      </AppBottomSheet>
    </KeyboardAvoidingView>
  );
}
