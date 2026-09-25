import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
import { AskLedgerAnswer } from '@/features/askLedger/AskLedgerAnswer';
import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import { useWorkspaceState } from '@/store/workspaceStore';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const generationPhrases = [
  'Thinking through your Ledger context…',
  'Reading the relevant workspace context…',
  'Checking projects, dates, and next actions…',
  'Pulling together a grounded answer…',
  'Writing the useful parts…',
] as const;

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
    'Today (mixed statuses; each item carries its own status):',
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

function truncateConversationTitle(value: string, maxLength = 32) {
  const normalized = value.trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trimEnd()}…` : normalized;
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
  const insets = useSafeAreaInsets();
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
  const [generationPhraseIndex, setGenerationPhraseIndex] = useState(0);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<MobileAskLedgerAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const workspace = useMemo(() => {
    const candidate = [workspaceState.selectedWorkspaceId, workspaceState.todayScopeWorkspaceId, ...workspaceState.options.map((item) => item.id)].find((id) => uuidPattern.test(id));
    return candidate ?? null;
  }, [workspaceState.options, workspaceState.selectedWorkspaceId, workspaceState.todayScopeWorkspaceId]);

  const headerTitle = useMemo(() => {
    if (!sessionId) return 'Ask Ledger';
    const sessionTitle = sessions.find((session) => session.id === sessionId)?.title;
    const firstQuestion = messages.find((message) => message.role === 'user')?.content;
    return truncateConversationTitle(sessionTitle || firstQuestion || 'Ask Ledger');
  }, [messages, sessionId, sessions]);

  const loadWorkspace = useCallback(async (nextWorkspaceId: string, options?: { preserveConversation?: boolean }) => {
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
      // Opening Ask Ledger always starts a fresh conversation. Saved sessions
      // are intentionally opt-in through the History sheet.
      if (!options?.preserveConversation) {
        setMessages([]);
        setSessionId(null);
        setPendingAction(null);
      }
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

  useEffect(() => {
    if (!busy) {
      setGenerationPhraseIndex(0);
      return;
    }
    const interval = setInterval(() => {
      setGenerationPhraseIndex((current) => (current + 1) % generationPhrases.length);
    }, 1100);
    return () => clearInterval(interval);
  }, [busy]);

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

  const copyMessage = async (message: MobileAskLedgerMessage) => {
    try {
      await Clipboard.setStringAsync(message.content);
      setCopiedMessageId(message.id);
      setTimeout(() => setCopiedMessageId((current) => current === message.id ? null : current), 1400);
    } catch {
      setError('Could not copy that message.');
    }
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
      await loadWorkspace(workspaceId, { preserveConversation: true });
      setError(approved ? `${result?.resourceType === 'note' ? 'Note' : result?.resourceType === 'reminder' ? 'Reminder' : 'Task'} created.` : 'Action dismissed.');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not complete that action.');
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 20, paddingBottom: 12, backgroundColor: theme.colors.background }}>
        <View style={{ minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} hitSlop={10} style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
            <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={21} tintColor={theme.colors.textSecondary} />
          </Pressable>
          <AppText variant="screenTitle" style={{ flex: 1 }} numberOfLines={1} ellipsizeMode="tail">{headerTitle}</AppText>
          <Pressable accessibilityRole="button" accessibilityLabel="Open Ask Ledger history" onPress={() => setHistoryOpen(true)} disabled={busy} hitSlop={10} style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
            <SymbolView name={{ ios: 'clock.arrow.circlepath', android: 'history', web: 'history' }} size={20} tintColor={theme.colors.accent} />
          </Pressable>
        </View>
      </View>
      <Animated.ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 16 }} onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })} scrollEventThrottle={16}>
        {loading ? <ActivityIndicator color={theme.colors.accent} /> : null}
        {!loading && !workspace ? <AppText variant="body" style={{ color: theme.colors.textSecondary }}>Choose a workspace before using Ask Ledger.</AppText> : null}
        {!loading && workspace ? <View style={{ padding: 12, borderRadius: 14, backgroundColor: theme.colors.surfaceMuted, gap: 3 }}><AppText variant="meta" style={{ color: theme.colors.textSecondary }}>Using Ledger context</AppText><AppText variant="body">{contextSummary}</AppText></View> : null}
        {messages.length === 0 && !loading ? <View style={{ gap: 8, paddingVertical: 20 }}><AppText variant="screenTitle">What needs your attention?</AppText><AppText variant="body" style={{ color: theme.colors.textSecondary }}>Ask about today, upcoming work, projects, or recent captures.</AppText><View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>{['Plan my day', 'What is overdue?', 'What should I do next?'].map((prompt) => <Pressable key={prompt} onPress={() => setInput(prompt)} style={{ paddingHorizontal: 12, paddingVertical: 9, borderRadius: 16, backgroundColor: theme.colors.surfaceMuted }}><AppText variant="meta">{prompt}</AppText></Pressable>)}</View></View> : null}
        {messages.map((message) => {
          const isUser = message.role === 'user';
          const isCopied = copiedMessageId === message.id;
          return (
            <View key={message.id} style={{ alignSelf: isUser ? 'flex-end' : 'stretch', maxWidth: isUser ? '88%' : '100%', padding: 12, borderRadius: 14, backgroundColor: isUser ? theme.colors.accent : theme.colors.surfaceMuted }}>
              {isUser
                ? <AppText variant="body" style={{ color: '#FFFFFF' }}>{message.content}</AppText>
                : <AskLedgerAnswer text={message.content} />}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isUser ? 'Copy your message' : 'Copy Ledger response'}
                onPress={() => void copyMessage(message)}
                hitSlop={8}
                style={{ alignSelf: 'flex-end', marginTop: 8, padding: 2 }}
              >
                <SymbolView name={{ ios: isCopied ? 'checkmark' : 'doc.on.doc', android: isCopied ? 'check' : 'content_copy', web: isCopied ? 'check' : 'content_copy' }} size={15} tintColor={isUser ? '#FFFFFF' : theme.colors.textSecondary} />
              </Pressable>
            </View>
          );
        })}
        {busy && !streamingAnswer ? <View style={{ alignSelf: 'flex-start', maxWidth: '92%', flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}><ActivityIndicator size="small" color={theme.colors.accent} /><AppText variant="caption" style={{ color: theme.colors.textSecondary }}>{generationPhrases[generationPhraseIndex]}</AppText></View> : null}
        {streamingAnswer ? <View style={{ alignSelf: 'stretch', padding: 12, borderRadius: 14, backgroundColor: theme.colors.surfaceMuted }}><AskLedgerAnswer text={streamingAnswer} /></View> : null}
        {pendingAction ? <View style={{ padding: 14, borderRadius: 16, backgroundColor: theme.colors.surfaceMuted, gap: 10 }}><AppText variant="bodyStrong">{actionTitle(pendingAction)}</AppText><AppText variant="body">{String(pendingAction.payload.title ?? '')}</AppText><AppText variant="meta" style={{ color: theme.colors.textSecondary }}>Review this before Ledger saves it.</AppText><View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}><AppButton title={actionBusy ? 'Saving…' : 'Confirm'} onPress={() => void resolveAction(true)} disabled={actionBusy} /></View><View style={{ flex: 1 }}><AppButton title="Dismiss" variant="secondary" onPress={() => void resolveAction(false)} disabled={actionBusy} /></View></View></View> : null}
        {error ? <View style={{ gap: 8 }}><AppText variant="meta" style={{ color: theme.colors.danger }}>{error}</AppText>{lastQuestion ? <Pressable onPress={() => void ask(lastQuestion)} disabled={busy}><AppText variant="meta" style={{ color: theme.colors.accent }}>Retry</AppText></Pressable> : null}</View> : null}
      </Animated.ScrollView>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 8) + 4, backgroundColor: theme.colors.background }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, backgroundColor: theme.colors.surfaceMuted, borderRadius: 18 }}>
          <TextInput
            accessibilityLabel="Ask Ledger message"
            placeholder="Ask about your day"
            placeholderTextColor={theme.colors.placeholder}
            value={input}
            onChangeText={setInput}
            multiline
            autoCapitalize="sentences"
            style={{ flex: 1, maxHeight: 112, minHeight: 40, paddingHorizontal: 4, paddingVertical: 8, color: theme.colors.textPrimary, fontSize: 16, lineHeight: 22 }}
          />
          <Pressable accessibilityRole="button" accessibilityLabel={busy ? 'Stop generation' : 'Send message'} onPress={() => busy ? abortRef.current?.abort() : void ask()} disabled={loading || (!busy && !input.trim())} style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: busy ? theme.colors.surface : theme.colors.accent, opacity: loading || (!busy && !input.trim()) ? 0.45 : 1 }}>
            <SymbolView name={{ ios: busy ? 'stop.fill' : 'arrow.up', android: busy ? 'stop' : 'arrow_upward', web: busy ? 'stop' : 'arrow_upward' }} size={18} tintColor={busy ? theme.colors.textSecondary : '#FFFFFF'} />
          </Pressable>
        </View>
      </View>

      <AppBottomSheet visible={historyOpen} onClose={() => setHistoryOpen(false)} title="Ask Ledger history" snapPoints={['62%', '100%']} initialSnapPointIndex={1} contentStyle={{ paddingBottom: 48 }}>
        <View style={{ gap: 8 }}>
          <Pressable onPress={startNewConversation} style={{ padding: 14, borderRadius: 14, backgroundColor: theme.colors.surfaceMuted }}><AppText variant="bodyStrong" style={{ color: theme.colors.accent }}>New conversation</AppText></Pressable>
          {sessions.length === 0 ? <AppText variant="body" style={{ color: theme.colors.textSecondary, paddingVertical: 14 }}>No saved conversations yet.</AppText> : sessions.map((session) => <View key={session.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}><Pressable onPress={() => void openSession(session)} style={{ flex: 1, gap: 3 }}><AppText variant="bodyStrong" numberOfLines={1}>{session.title}</AppText><AppText variant="meta" style={{ color: theme.colors.textSecondary }}>{formatSessionDate(session.updatedAt)} · {session.messages.length} messages</AppText></Pressable><Pressable onPress={() => deleteSession(session)} hitSlop={8}><AppText variant="meta" style={{ color: theme.colors.danger }}>Delete</AppText></Pressable></View>)}
        </View>
      </AppBottomSheet>
    </KeyboardAvoidingView>
  );
}
