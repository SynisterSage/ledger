import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import { createMobileTranscriptSegment, deleteMobileTranscriptSegment, getMobileTranscriptSegments, linkMobileTranscriptToLedgerItem, updateMobileTranscriptSegment, type MobileTranscriptSegment } from '@/api/notes';
import { createMobileEvent, createMobileIntake, createMobileReminder, createMobileTask } from '@/api/captures';
import { useLedgerTheme } from '@/theme';

function timeLabel(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function MobileTranscriptView({ noteId, workspaceId, attendees = [], transcriptionStatus, onLoaded, onAddToSection, editable = true }: { noteId: string; workspaceId: string; attendees?: Array<{ name?: string; email?: string } | string>; transcriptionStatus?: string | null; onLoaded?: (segments: MobileTranscriptSegment[]) => void; onAddToSection?: (section: 'notes' | 'decisions' | 'action_items', segment: MobileTranscriptSegment) => void; editable?: boolean }) {
  const theme = useLedgerTheme();
  const [segments, setSegments] = useState<MobileTranscriptSegment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<MobileTranscriptSegment | null>(null);
  const [actionSegment, setActionSegment] = useState<MobileTranscriptSegment | null>(null);
  const [draftText, setDraftText] = useState('');
  const [draftSpeaker, setDraftSpeaker] = useState('');

  const load = async () => {
    setLoading(true); setError(null);
    try { const next = await getMobileTranscriptSegments(noteId); setSegments(next); onLoaded?.(next); setLoaded(true); } catch (err) { setError(err instanceof Error ? err.message : 'Could not load transcript.'); } finally { setLoading(false); }
  };
  useEffect(() => { if (!loaded && !loading) void load(); }, [loaded, loading]);

  const speakers = useMemo(() => Array.from(new Set([...segments.map((segment) => segment.speaker).filter(Boolean) as string[], ...attendees.map((attendee) => typeof attendee === 'string' ? attendee : attendee.name).filter(Boolean) as string[]])), [attendees, segments]);
  const saveEdit = async () => {
    if (!active) return;
    const previous = segments;
    setSegments((current) => current.map((segment) => segment.id === active.id ? { ...segment, text: draftText, speaker: draftSpeaker || undefined, edited: true } : segment));
    setActive(null);
    try { await updateMobileTranscriptSegment(workspaceId, noteId, active.id, { text: draftText, speaker: draftSpeaker }); } catch (err) { setSegments(previous); Alert.alert('Could not save transcript edit', err instanceof Error ? err.message : 'Please try again.'); }
  };
  const applySpeakerToMatching = async () => {
    if (!active || !draftSpeaker.trim() || !active.speaker) return;
    const matching = segments.filter((segment) => segment.speaker === active.speaker);
    const previous = segments;
    setSegments((current) => current.map((segment) => segment.speaker === active.speaker ? { ...segment, speaker: draftSpeaker.trim(), edited: true } : segment));
    try { await Promise.all(matching.map((segment) => updateMobileTranscriptSegment(workspaceId, noteId, segment.id, { speaker: draftSpeaker.trim() }))); setActive(null); } catch (err) { setSegments(previous); Alert.alert('Could not rename speaker', err instanceof Error ? err.message : 'Please try again.'); }
  };
  const remove = async (segment: MobileTranscriptSegment) => {
    const previous = segments;
    setSegments((current) => current.filter((item) => item.id !== segment.id));
    try { await deleteMobileTranscriptSegment(workspaceId, noteId, segment.id); } catch (err) { setSegments(previous); Alert.alert('Could not delete transcript segment', err instanceof Error ? err.message : 'Please try again.'); }
  };
  const split = async (segment: MobileTranscriptSegment) => {
    const midpoint = Math.floor((segment.startTimeMs + (segment.endTimeMs ?? segment.startTimeMs + 1000)) / 2);
    const words = segment.text.trim().split(/\s+/);
    if (words.length < 2) { Alert.alert('Not enough text to split'); return; }
    const half = Math.max(1, Math.floor(words.length / 2));
    try { await updateMobileTranscriptSegment(workspaceId, noteId, segment.id, { text: words.slice(0, half).join(' '), endTimeMs: midpoint }); const created = await createMobileTranscriptSegment(workspaceId, noteId, { text: words.slice(half).join(' '), speaker: segment.speaker, startTimeMs: midpoint, endTimeMs: segment.endTimeMs ?? midpoint + 1000, audioSource: segment.audioSource, segmentOrder: (segment.segmentOrder ?? 0) + 1 }); setSegments((current) => current.flatMap((item) => item.id === segment.id ? [{ ...item, text: words.slice(0, half).join(' '), endTimeMs: midpoint }, { ...item, id: String(created.id), text: words.slice(half).join(' '), startTimeMs: midpoint, endTimeMs: segment.endTimeMs, segmentOrder: (segment.segmentOrder ?? 0) + 1 }] : item)); } catch (err) { Alert.alert('Could not split segment', err instanceof Error ? err.message : 'Please try again.'); }
  };
  const mergeWithPrevious = async (index: number) => {
    if (index <= 0) return;
    const previous = segments[index - 1]; const current = segments[index];
    const text = `${previous.text.trim()} ${current.text.trim()}`.trim();
    try { await updateMobileTranscriptSegment(workspaceId, noteId, previous.id, { text, endTimeMs: current.endTimeMs ?? previous.endTimeMs }); await deleteMobileTranscriptSegment(workspaceId, noteId, current.id); setSegments((items) => items.filter((item) => item.id !== current.id).map((item) => item.id === previous.id ? { ...item, text, endTimeMs: current.endTimeMs ?? item.endTimeMs, edited: true } : item)); } catch (err) { Alert.alert('Could not merge segments', err instanceof Error ? err.message : 'Please try again.'); }
  };
  const createLedgerItem = async (kind: 'task' | 'reminder' | 'event' | 'intake') => {
    if (!actionSegment) return;
    const title = actionSegment.text.trim().slice(0, 120) || 'Transcript follow-up';
    try {
      let itemId: string | null = null;
      if (kind === 'reminder') { const created = await createMobileReminder(workspaceId, { title, remind_at: new Date(Date.now() + 86400000).toISOString(), body: actionSegment.text, note_id: noteId }); itemId = typeof created === 'object' && created && 'id' in created ? String(created.id) : null; }
      else if (kind === 'event') { const created = await createMobileEvent(workspaceId, { title, start_at: new Date(Date.now() + 86400000).toISOString(), notes: actionSegment.text, note_id: noteId }); itemId = typeof created === 'object' && created && 'id' in created ? String(created.id) : null; }
      else if (kind === 'intake') { const created = await createMobileIntake(workspaceId, { title, body: actionSegment.text, sourceObjectId: actionSegment.id, sourceObjectType: 'meeting_transcript_segment', source: 'meeting', sourceProvider: 'notes', suggestedType: 'note' }); itemId = created.id; }
      else { const created = await createMobileTask(workspaceId, { title, notes: actionSegment.text, description: `meeting_transcript:${noteId}:${actionSegment.id}`, source: 'meeting_transcript', due_date: null, due_time: null }); itemId = typeof created === 'object' && created && 'id' in created ? String(created.id) : null; }
      if (itemId) await linkMobileTranscriptToLedgerItem(workspaceId, noteId, actionSegment.id, { ledgerItemType: kind, ledgerItemId: itemId, quotedText: actionSegment.text, timestampMs: actionSegment.startTimeMs });
      setActionSegment(null);
    } catch (err) { Alert.alert('Could not create Ledger item', err instanceof Error ? err.message : 'Please try again.'); }
  };
  if (loading) return <View style={styles.state}><AppText variant="caption">Loading transcript…</AppText></View>;
  if (error) return <View style={styles.state}><AppText variant="caption">Couldn’t load transcript.</AppText><Pressable onPress={() => void load()}><AppText variant="caption" style={{ color: theme.colors.accent }}>Retry</AppText></Pressable></View>;
  if (!segments.length) return <View style={styles.state}><AppText variant="bodyStrong">{transcriptionStatus === 'processing' ? 'Transcribing…' : transcriptionStatus === 'failed' ? 'Transcript couldn’t be created' : 'No transcript yet'}</AppText><AppText variant="caption">{transcriptionStatus === 'processing' ? 'You can continue writing while the transcript is prepared.' : transcriptionStatus === 'failed' ? 'Retry transcription from the meeting actions when available.' : 'Record this meeting or open a transcript created on desktop.'}</AppText></View>;
  return <><ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>{segments.map((segment) => <Pressable key={segment.id} onPress={() => { setActive(segment); setDraftText(segment.text); setDraftSpeaker(segment.speaker ?? ''); }} onLongPress={() => setActionSegment(segment)} style={({ pressed }) => [styles.segment, { borderBottomColor: theme.colors.borderSubtle, opacity: pressed ? 0.68 : 1 }]}><View style={styles.timestamp}><AppText variant="caption" style={{ color: theme.colors.textMuted }}>{timeLabel(segment.startTimeMs)}</AppText></View><View style={styles.segmentCopy}><AppText variant="caption" style={{ color: theme.colors.textSecondary }}>{segment.speaker ?? 'Speaker'}</AppText><AppText variant="body">{segment.text}</AppText>{segment.edited ? <AppText variant="caption" style={{ color: theme.colors.textMuted }}>Edited</AppText> : null}</View></Pressable>)}</ScrollView><AppBottomSheet visible={Boolean(actionSegment)} onClose={() => setActionSegment(null)} title={<AppText variant="sectionTitle">Transcript actions</AppText>} snapPoints={['64%', '82%']} initialSnapPointIndex={0}>{(['task', 'reminder', 'event', 'intake'] as const).map((kind) => <Pressable key={kind} onPress={() => void createLedgerItem(kind)} style={styles.actionRow}><AppText variant="body">{kind === 'intake' ? 'Send to Intake' : `Create ${kind}`}</AppText><AppText variant="caption">›</AppText></Pressable>)}{(['notes', 'decisions', 'action_items'] as const).map((section) => <Pressable key={section} onPress={() => { if (actionSegment) onAddToSection?.(section, actionSegment); setActionSegment(null); }} style={styles.actionRow}><AppText variant="body">{section === 'action_items' ? 'Add to Action Items' : `Add to ${section[0].toUpperCase()}${section.slice(1)}`}</AppText><AppText variant="caption">›</AppText></Pressable>)}<Pressable onPress={() => { if (actionSegment) Alert.alert('Copy', actionSegment.text); setActionSegment(null); }} style={styles.actionRow}><AppText variant="body">Copy</AppText><AppText variant="caption">›</AppText></Pressable></AppBottomSheet><AppBottomSheet visible={Boolean(active)} onClose={() => setActive(null)} title={<AppText variant="sectionTitle">Transcript segment</AppText>} snapPoints={['62%', '82%']} initialSnapPointIndex={0}><TextInput value={draftSpeaker} onChangeText={setDraftSpeaker} placeholder="Speaker" placeholderTextColor={theme.colors.placeholder} style={[styles.input, { color: theme.colors.textPrimary, borderBottomColor: theme.colors.borderSubtle }]} />{speakers.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.speakerChips}>{speakers.map((speaker) => <Pressable key={speaker} onPress={() => setDraftSpeaker(speaker)} style={styles.chip}><AppText variant="caption">{speaker}</AppText></Pressable>)}</ScrollView> : null}<TextInput multiline value={draftText} onChangeText={setDraftText} placeholder="Transcript text" placeholderTextColor={theme.colors.placeholder} style={[styles.editInput, { color: theme.colors.textPrimary, borderColor: theme.colors.borderSubtle }]} /><View style={styles.actions}><Pressable onPress={() => active && void saveEdit()}><AppText variant="caption" style={{ color: theme.colors.accent }}>Save</AppText></Pressable><Pressable onPress={() => active && void applySpeakerToMatching()}><AppText variant="caption">Rename matching</AppText></Pressable><Pressable onPress={() => active && void split(active)}><AppText variant="caption">Split</AppText></Pressable><Pressable onPress={() => active && void mergeWithPrevious(segments.findIndex((item) => item.id === active.id))}><AppText variant="caption">Merge previous</AppText></Pressable><Pressable onPress={() => { if (active) void remove(active); setActive(null); }}><AppText variant="caption" style={{ color: theme.colors.danger }}>Delete</AppText></Pressable></View></AppBottomSheet></>;
}

const styles = StyleSheet.create({ list: { paddingBottom: 100 }, segment: { minHeight: 72, paddingVertical: 12, flexDirection: 'row', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth }, timestamp: { width: 44 }, segmentCopy: { flex: 1, gap: 4 }, state: { minHeight: 160, justifyContent: 'center', alignItems: 'center', gap: 8, paddingHorizontal: 18 }, input: { minHeight: 44, borderBottomWidth: 1, fontSize: 16 }, editInput: { minHeight: 140, borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 14, textAlignVertical: 'top', fontSize: 16 }, speakerChips: { gap: 8, paddingVertical: 10 }, chip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, backgroundColor: '#F3F4F6' }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, paddingVertical: 16 }, actionRow: { minHeight: 50, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth } });
