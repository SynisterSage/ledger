import { useMemo, useState } from 'react';
import { Alert, PanResponder, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import type { MobileMindMapStructure } from '@/api/notes';
import { useLedgerTheme } from '@/theme';

type Node = MobileMindMapStructure['nodes'][string] & { label: string; children: string[]; x: number; y: number };

function readStructure(value: unknown): { raw: Record<string, unknown>; rootId: string; nodes: Record<string, Node> } {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const sourceNodes = raw.nodes && typeof raw.nodes === 'object' ? raw.nodes as Record<string, Record<string, unknown>> : {};
  const rootId = typeof raw.rootId === 'string' && raw.rootId ? raw.rootId : Object.keys(sourceNodes)[0] ?? `root-${Date.now()}`;
  const nodes: Record<string, Node> = {};
  Object.entries(sourceNodes).forEach(([id, source], index) => {
    nodes[id] = { ...source, id, label: String(source.label ?? source.title ?? (id === rootId ? 'Central Idea' : 'Untitled')), children: Array.isArray(source.children) ? source.children.map(String) : [], x: Number(source.x ?? ((index % 3) * 180)), y: Number(source.y ?? (Math.floor(index / 3) * 100)) } as Node;
  });
  if (!nodes[rootId]) nodes[rootId] = { id: rootId, label: 'Central Idea', children: [], x: 80, y: 80 };
  const parentById = new Map<string, string>();
  Object.values(nodes).forEach((node) => node.children.forEach((child) => parentById.set(child, node.id)));
  Object.values(nodes).forEach((node) => { if (!node.children.length) node.children = []; if (!node.parentId && parentById.has(node.id)) node.parentId = parentById.get(node.id); });
  return { raw, rootId, nodes };
}

function writeStructure(raw: Record<string, unknown>, rootId: string, nodes: Record<string, Node>) {
  const originalNodes = raw.nodes && typeof raw.nodes === 'object' ? raw.nodes as Record<string, Record<string, unknown>> : {};
  const nextNodes = Object.fromEntries(Object.entries(nodes).map(([id, node]) => {
    const original = originalNodes[id] ?? {};
    const next = { ...original, ...node, id, children: [...node.children], x: node.x, y: node.y } as Record<string, unknown>;
    if ('label' in original || !('title' in original)) next.label = node.label;
    else next.title = node.label;
    return [id, next];
  }));
  return { ...raw, rootId, nodes: nextNodes };
}

export function MobileMindMapView({ structure, view, onChange }: { structure: unknown; view: 'map' | 'outline'; onChange: (next: unknown) => void }) {
  const theme = useLedgerTheme();
  const parsed = useMemo(() => readStructure(structure), [structure]);
  const [selectedId, setSelectedId] = useState(parsed.rootId);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [actionOpen, setActionOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [rename, setRename] = useState('');
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panResponder = useMemo(() => PanResponder.create({ onStartShouldSetPanResponder: () => false, onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3, onPanResponderMove: (_, gesture) => setPan({ x: gesture.dx, y: gesture.dy }), onPanResponderRelease: () => undefined }), []);
  const selected = parsed.nodes[selectedId];
  const commit = (nodes: Record<string, Node>) => onChange(writeStructure(parsed.raw, parsed.rootId, nodes));
  const descendants = (id: string) => { const result = new Set<string>(); const stack = [...(parsed.nodes[id]?.children ?? [])]; while (stack.length) { const child = stack.pop()!; if (result.has(child)) continue; result.add(child); stack.push(...(parsed.nodes[child]?.children ?? [])); } return result; };
  const addNode = (sibling: boolean) => {
    const parentId = sibling ? selected?.parentId ?? parsed.rootId : selectedId;
    const parent = parsed.nodes[parentId];
    if (!parent) return;
    const id = `mobile-node-${Date.now()}`;
    const node: Node = { id, label: sibling ? 'New Sibling' : 'New Idea', children: [], parentId, x: parent.x + 180, y: parent.y + parent.children.length * 80 };
    commit({ ...parsed.nodes, [id]: node, [parentId]: { ...parent, children: [...parent.children, id] } });
    setSelectedId(id); setActionOpen(false); setRename(node.label); setRenameOpen(true);
  };
  const removeNode = () => {
    if (!selected || selected.id === parsed.rootId) return;
    const removed = descendants(selected.id); removed.add(selected.id);
    const next = Object.fromEntries(Object.entries(parsed.nodes).filter(([id]) => !removed.has(id)).map(([id, node]) => [id, { ...node, children: node.children.filter((child) => !removed.has(child)) }]));
    commit(next); setSelectedId(selected.parentId ?? parsed.rootId); setActionOpen(false);
  };
  const toggleCollapse = () => { if (!selected) return; commit({ ...parsed.nodes, [selected.id]: { ...selected, collapsed: !selected.collapsed } }); setActionOpen(false); };
  const moveTo = (parentId: string) => { if (!selected || selected.id === parsed.rootId || parentId === selected.id || descendants(selected.id).has(parentId)) return; const oldParent = selected.parentId ? parsed.nodes[selected.parentId] : null; const nextParent = parsed.nodes[parentId]; if (!nextParent) return; const next = { ...parsed.nodes, [selected.id]: { ...selected, parentId }, [parentId]: { ...nextParent, children: [...nextParent.children.filter((id) => id !== selected.id), selected.id] } }; if (oldParent) next[oldParent.id] = { ...oldParent, children: oldParent.children.filter((id) => id !== selected.id) }; commit(next); setActionOpen(false); };
  const outline = (id: string, depth = 0): React.ReactNode[] => { const node = parsed.nodes[id]; if (!node) return []; const isExpanded = expanded[id] !== false; return [<Pressable key={id} onPress={() => { setSelectedId(id); setActionOpen(true); }} style={[styles.outlineRow, { paddingLeft: Math.min(depth, 4) * 18 }]}><AppText variant="caption" style={styles.disclosure}>{node.children.length ? (isExpanded ? '⌄' : '›') : ''}</AppText><AppText variant="body" style={{ color: node.completed ? theme.colors.textMuted : theme.colors.textPrimary, textDecorationLine: node.completed ? 'line-through' : 'none' }}>{node.label}</AppText></Pressable>, ...(isExpanded ? node.children.flatMap((child) => outline(child, depth + 1)) : [])]; };
  if (view === 'outline') return <View style={styles.mapRoot}><ScrollView contentContainerStyle={styles.outline}>{outline(parsed.rootId)}</ScrollView><AppBottomSheet visible={actionOpen} onClose={() => setActionOpen(false)} title={<AppText variant="sectionTitle">{selected?.label ?? 'Map node'}</AppText>} snapPoints={['58%', '82%']} initialSnapPointIndex={0}>{selected?.id !== parsed.rootId ? <Pressable style={styles.actionRow} onPress={() => addNode(true)}><AppText variant="body">Add sibling</AppText></Pressable> : null}<Pressable style={styles.actionRow} onPress={() => addNode(false)}><AppText variant="body">Add child</AppText></Pressable><Pressable style={styles.actionRow} onPress={() => { setRename(selected?.label ?? ''); setRenameOpen(true); setActionOpen(false); }}><AppText variant="body">Rename</AppText></Pressable><Pressable style={styles.actionRow} onPress={() => { if (selected) commit({ ...parsed.nodes, [selected.id]: { ...selected, completed: !selected.completed } }); setActionOpen(false); }}><AppText variant="body">{selected?.completed ? 'Mark incomplete' : 'Complete'}</AppText></Pressable><Pressable style={styles.actionRow} onPress={() => { if (selected) setExpanded((current) => ({ ...current, [selected.id]: current[selected.id] === false })); setActionOpen(false); }}><AppText variant="body">{selected?.collapsed ? 'Expand branch' : 'Collapse branch'}</AppText></Pressable>{selected?.id !== parsed.rootId ? <Pressable style={styles.actionRow} onPress={() => { setActionOpen(false); setMoveOpen(true); }}><AppText variant="body">Move</AppText></Pressable> : null}{selected?.id !== parsed.rootId ? <Pressable style={styles.actionRow} onPress={() => Alert.alert('Delete branch?', 'This removes the selected node and its descendants from the map.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: removeNode }])}><AppText variant="body" style={{ color: theme.colors.danger }}>Delete</AppText></Pressable> : null}</AppBottomSheet><AppBottomSheet visible={moveOpen} onClose={() => setMoveOpen(false)} title={<AppText variant="sectionTitle">Move node</AppText>} snapPoints={['58%', '82%']} initialSnapPointIndex={0}>{Object.values(parsed.nodes).filter((node) => node.id !== selectedId && !descendants(selectedId).has(node.id)).map((node) => <Pressable key={node.id} style={styles.actionRow} onPress={() => moveTo(node.id)}><AppText variant="body">{node.label}</AppText></Pressable>)}</AppBottomSheet><AppBottomSheet visible={renameOpen} onClose={() => setRenameOpen(false)} title={<AppText variant="sectionTitle">Rename node</AppText>} snapPoints={['34%', '48%']} initialSnapPointIndex={0}><TextInput autoFocus value={rename} onChangeText={setRename} style={styles.renameInput} /><Pressable onPress={() => { if (selected && rename.trim()) commit({ ...parsed.nodes, [selected.id]: { ...selected, label: rename.trim() } }); setRenameOpen(false); }} style={styles.saveButton}><AppText variant="button" style={{ color: '#fff' }}>Save</AppText></Pressable></AppBottomSheet></View>;
  const nodeList = Object.values(parsed.nodes);
  const width = Math.max(520, ...nodeList.map((node) => node.x + 170));
  const height = Math.max(420, ...nodeList.map((node) => node.y + 90));
}

const styles = StyleSheet.create({ mapRoot: { flex: 1, minHeight: 420, overflow: 'hidden' }, nodeHit: { position: 'absolute' }, zoomControls: { position: 'absolute', right: 12, bottom: 16, gap: 8, alignItems: 'center', padding: 8, borderRadius: 10, backgroundColor: '#FFFFFFEE' }, outline: { paddingBottom: 120 }, outlineRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6 }, disclosure: { width: 16, color: '#6B7280' }, actionRow: { minHeight: 50, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' }, renameInput: { minHeight: 44, borderBottomWidth: 1, borderBottomColor: '#D1D5DB', fontSize: 16 }, saveButton: { marginTop: 14, alignItems: 'center', paddingVertical: 12, borderRadius: 10, backgroundColor: '#FF5F40' } });
