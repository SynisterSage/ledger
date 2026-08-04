import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Alert, PanResponder, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { G, Line, Rect, Text as SvgText, TSpan } from 'react-native-svg';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import type { MobileMindMapStructure } from '@/api/notes';
import { useLedgerTheme } from '@/theme';

type MindMapNode = MobileMindMapStructure['nodes'][string];
type Node = MindMapNode & { id: string; label: string; children: string[]; x: number; y: number };
export type PositionedMindMapNode = Node & { width: number; height: number; depth: number };
type ParsedStructure = { raw: Record<string, unknown>; rootId: string; nodes: Record<string, Node>; error?: string };

const NODE_WIDTH = 156;
const NODE_MIN_HEIGHT = 54;
const NODE_PADDING = 12;
const HORIZONTAL_GAP = 28;
const VERTICAL_GAP = 46;
const MIN_SCALE = 0.5;
const MAX_SCALE = 2;

function wrapLabel(label: string) {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > 22 && current) { lines.push(current); current = word; } else current = next;
  });
  if (current || !lines.length) lines.push(current || 'Untitled');
  if (lines.length > 3) lines.splice(2, 1, `${lines[2]}…`);
  return lines.slice(0, 3);
}

function readStructure(value: unknown): ParsedStructure {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) { console.warn('[MobileMindMapView] Invalid mind-map structure'); return { raw, rootId: '', nodes: {}, error: 'This mind map has an invalid structure.' }; }
  const sourceNodes = raw.nodes && typeof raw.nodes === 'object' && !Array.isArray(raw.nodes) ? raw.nodes as Record<string, Record<string, unknown>> : null;
  const rootId = typeof raw.rootId === 'string' ? raw.rootId : '';
  if (!sourceNodes || !rootId || !sourceNodes[rootId]) { console.warn('[MobileMindMapView] Missing mind-map root node'); return { raw, rootId, nodes: {}, error: 'This mind map is missing a valid root node.' }; }
  const nodes: Record<string, Node> = {};
  Object.entries(sourceNodes).forEach(([id, source]) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return;
    nodes[id] = { ...source, id, label: String(source.label ?? source.title ?? (id === rootId ? 'Central Idea' : 'Untitled')), children: Array.isArray(source.children) ? source.children.map(String).filter((child) => child !== id) : [], x: Number.isFinite(Number(source.x)) ? Number(source.x) : 0, y: Number.isFinite(Number(source.y)) ? Number(source.y) : 0 } as Node;
  });
  if (!nodes[rootId]) { console.warn('[MobileMindMapView] Invalid mind-map root node'); return { raw, rootId, nodes, error: 'This mind map is missing a valid root node.' }; }
  const parentById = new Map<string, string>();
  Object.values(nodes).forEach((node) => node.children.forEach((child) => { if (nodes[child] && !parentById.has(child)) parentById.set(child, node.id); }));
  Object.values(nodes).forEach((node) => { if (!node.parentId && parentById.has(node.id)) node.parentId = parentById.get(node.id); node.children = node.children.filter((child) => Boolean(nodes[child])); });
  return { raw, rootId, nodes };
}

function writeStructure(raw: Record<string, unknown>, rootId: string, nodes: Record<string, Node>) {
  const originalNodes = raw.nodes && typeof raw.nodes === 'object' ? raw.nodes as Record<string, Record<string, unknown>> : {};
  const nextNodes = Object.fromEntries(Object.entries(nodes).map(([id, node]) => {
    const original = originalNodes[id] ?? {};
    const next = { ...original, ...node, id, children: [...node.children] } as Record<string, unknown>;
    if ('label' in original || !('title' in original)) next.label = node.label; else next.title = node.label;
    return [id, next];
  }));
  return { ...raw, rootId, nodes: nextNodes };
}

function createRootStructure(title: string) {
  const rootId = `mobile-root-${Date.now()}`;
  return { rootId, nodes: { [rootId]: { id: rootId, label: title.trim() || 'Central Idea', children: [] } } };
}

function layoutTree(rootId: string, nodes: Record<string, Node>): { nodes: PositionedMindMapNode[]; width: number; height: number } {
  const positioned: PositionedMindMapNode[] = [];
  const subtreeWidth = (id: string): number => {
    const node = nodes[id];
    if (!node) return NODE_WIDTH;
    const children = node.collapsed ? [] : node.children.filter((child) => nodes[child]);
    if (!children.length) return NODE_WIDTH;
    return Math.max(NODE_WIDTH, children.reduce((sum, child) => sum + subtreeWidth(child), 0) + HORIZONTAL_GAP * (children.length - 1));
  };
  const walk = (id: string, left: number, depth: number) => {
    const node = nodes[id]; if (!node) return;
    const lines = wrapLabel(node.label);
    const height = Math.max(NODE_MIN_HEIGHT, 24 + lines.length * 16 + (node.completed ? 4 : 0));
    const width = NODE_WIDTH;
    const branchWidth = subtreeWidth(id);
    const x = left + (branchWidth - width) / 2;
    const y = 28 + depth * (NODE_MIN_HEIGHT + VERTICAL_GAP);
    positioned.push({ ...node, x, y, width, height, depth });
    const children = node.collapsed ? [] : node.children.filter((child) => nodes[child]);
    let childLeft = left;
    children.forEach((child) => { const childWidth = subtreeWidth(child); walk(child, childLeft, depth + 1); childLeft += childWidth + HORIZONTAL_GAP; });
  };
  const width = Math.max(260, subtreeWidth(rootId) + 56);
  walk(rootId, 28, 0);
  const height = Math.max(220, ...positioned.map((node) => node.y + node.height + 28));
  return { nodes: positioned, width, height };
}

function distance(a: { pageX: number; pageY: number }, b: { pageX: number; pageY: number }) { return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY); }

type Controller = {
  parsed: ParsedStructure;
  selected?: Node;
  selectedId: string;
  setSelectedId: (id: string) => void;
  descendants: (id: string) => Set<string>;
  addNode: (sibling: boolean) => void;
  renameNode: (label: string) => void;
  toggleComplete: () => void;
  toggleCollapse: () => void;
  moveTo: (parentId: string) => void;
  removeNode: () => void;
  undo: () => void;
  createRoot: () => void;
  historyAvailable: boolean;
};

function useMindMapController(structure: unknown, onChange: (next: unknown) => void, title: string): Controller {
  const parsed = useMemo(() => readStructure(structure), [structure]);
  const [selectedId, setSelectedId] = useState(parsed.rootId);
  const historyRef = useRef<Record<string, unknown>[]>([]);
  const selected = parsed.nodes[selectedId];
  useEffect(() => { if (!parsed.nodes[selectedId]) setSelectedId(parsed.rootId); }, [parsed.nodes, parsed.rootId, selectedId]);
  const descendants = useCallback((id: string) => { const result = new Set<string>(); const stack = [...(parsed.nodes[id]?.children ?? [])]; while (stack.length) { const child = stack.pop()!; if (result.has(child)) continue; result.add(child); stack.push(...(parsed.nodes[child]?.children ?? [])); } return result; }, [parsed.nodes]);
  const commit = useCallback((nodes: Record<string, Node>) => { historyRef.current = [...historyRef.current.slice(-19), parsed.raw]; onChange(writeStructure(parsed.raw, parsed.rootId, nodes)); }, [onChange, parsed.raw, parsed.rootId]);
  const addNode = useCallback((sibling: boolean) => { const parentId = sibling ? selected?.parentId ?? parsed.rootId : selectedId; const parent = parsed.nodes[parentId]; if (!parent) return; const id = `mobile-node-${Date.now()}`; const node: Node = { id, label: sibling ? 'New Sibling' : 'New Idea', children: [], parentId, x: parent.x + NODE_WIDTH + HORIZONTAL_GAP, y: parent.y + NODE_MIN_HEIGHT + VERTICAL_GAP }; commit({ ...parsed.nodes, [id]: node, [parentId]: { ...parent, children: [...parent.children, id] } }); setSelectedId(id); }, [commit, parsed.nodes, parsed.rootId, selected?.parentId, selectedId]);
  const renameNode = useCallback((label: string) => { if (!selected || !label.trim()) return; commit({ ...parsed.nodes, [selected.id]: { ...selected, label: label.trim() } }); }, [commit, parsed.nodes, selected]);
  const toggleComplete = useCallback(() => { if (selected) commit({ ...parsed.nodes, [selected.id]: { ...selected, completed: !selected.completed } }); }, [commit, parsed.nodes, selected]);
  const toggleCollapse = useCallback(() => { if (selected) commit({ ...parsed.nodes, [selected.id]: { ...selected, collapsed: !selected.collapsed } }); }, [commit, parsed.nodes, selected]);
  const moveTo = useCallback((parentId: string) => { if (!selected || selected.id === parsed.rootId || parentId === selected.id || descendants(selected.id).has(parentId)) return; const oldParent = selected.parentId ? parsed.nodes[selected.parentId] : undefined; const nextParent = parsed.nodes[parentId]; if (!nextParent) return; const next = { ...parsed.nodes, [selected.id]: { ...selected, parentId }, [parentId]: { ...nextParent, children: [...nextParent.children.filter((id) => id !== selected.id), selected.id] } }; if (oldParent) next[oldParent.id] = { ...oldParent, children: oldParent.children.filter((id) => id !== selected.id) }; commit(next); }, [commit, descendants, parsed.nodes, parsed.rootId, selected]);
  const removeNode = useCallback(() => { if (!selected || selected.id === parsed.rootId) return; const removed = descendants(selected.id); removed.add(selected.id); const next = Object.fromEntries(Object.entries(parsed.nodes).filter(([id]) => !removed.has(id)).map(([id, node]) => [id, { ...node, children: node.children.filter((child) => !removed.has(child)) }])); commit(next); setSelectedId(selected.parentId ?? parsed.rootId); }, [commit, descendants, parsed.nodes, parsed.rootId, selected]);
  const undo = useCallback(() => { const previous = historyRef.current.pop(); if (!previous) return; onChange(previous); }, [onChange]);
  const createRoot = useCallback(() => onChange(createRootStructure(title)), [onChange, title]);
  return { parsed, selected, selectedId, setSelectedId, descendants, addNode, renameNode, toggleComplete, toggleCollapse, moveTo, removeNode, undo, createRoot, historyAvailable: historyRef.current.length > 0 };
}

function NodeActions({ controller, onRename, onMove }: { controller: Controller; onRename: () => void; onMove: () => void }) {
  const theme = useLedgerTheme();
  const { selected } = controller;
  return <View style={[styles.actionBar, { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderSubtle }]}><Pressable onPress={() => controller.addNode(false)} style={styles.actionButton}><AppText variant="caption">+ Child</AppText></Pressable><Pressable onPress={() => controller.addNode(true)} disabled={!selected || selected.id === controller.parsed.rootId} style={styles.actionButton}><AppText variant="caption">+ Sibling</AppText></Pressable><Pressable onPress={onRename} style={styles.actionButton}><AppText variant="caption">Rename</AppText></Pressable><Pressable onPress={() => onMove()} style={styles.actionButton}><AppText variant="caption">•••</AppText></Pressable></View>;
}

function CanvasControls({ theme, canUndo, onUndo, onArrange, onFit, onZoomOut, onZoomIn }: { theme: ReturnType<typeof useLedgerTheme>; canUndo: boolean; onUndo: () => void; onArrange: () => void; onFit: () => void; onZoomOut: () => void; onZoomIn: () => void }) {
  const button = (label: string, icon: ComponentProps<typeof SymbolView>['name'], onPress: () => void, disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.controlButton, { opacity: pressed ? 0.58 : disabled ? 0.38 : 1 }]}><SymbolView name={icon} size={17} weight="medium" tintColor={theme.colors.textSecondary} /></Pressable>;
  return <View style={[styles.controls, { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderSubtle }]}><View style={styles.controlRow}>{button('Undo last map change', { ios: 'arrow.uturn.backward', android: 'undo', web: 'undo' }, onUndo, !canUndo)}{button('Arrange map', { ios: 'arrow.triangle.2.circlepath', android: 'auto_awesome', web: 'auto_awesome' }, onArrange)}{button('Fit map to canvas', { ios: 'viewfinder', android: 'center_focus_strong', web: 'center_focus_strong' }, onFit)}</View><View style={[styles.zoomRow, { borderTopColor: theme.colors.borderSubtle }]}>{button('Zoom out', { ios: 'minus', android: 'remove', web: 'remove' }, onZoomOut)}<AppText variant="meta" style={styles.zoomLabel}>Zoom</AppText>{button('Zoom in', { ios: 'plus', android: 'add', web: 'add' }, onZoomIn)}</View></View>;
}

export function MobileMindMapView({ structure, view, onChange, title = 'Central Idea', hideControls = false }: { structure: unknown; view: 'map' | 'outline'; onChange: (next: unknown) => void; title?: string; hideControls?: boolean }) {
  const theme = useLedgerTheme();
  const controller = useMindMapController(structure, onChange, title);
  const [actionOpen, setActionOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [rename, setRename] = useState('');
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const zoom = useSharedValue(1);
  const panRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [hasFitted, setHasFitted] = useState(false);
  const lastTapRef = useRef(0);
  const lastNodeTapRef = useRef({ id: '', at: 0 });
  const gestureStart = useRef({ pan: { x: 0, y: 0 }, scale: 1, distance: 0 });
  const layout = useMemo(() => controller.parsed.error ? { nodes: [], width: 260, height: 220 } : layoutTree(controller.parsed.rootId, controller.parsed.nodes), [controller.parsed]);
  const setPanValue = useCallback((value: { x: number; y: number } | ((current: { x: number; y: number }) => { x: number; y: number }), render = true) => { const next = typeof value === 'function' ? value(panRef.current) : value; panRef.current = next; panX.value = next.x; panY.value = next.y; if (render) setViewport((current) => current); }, [panX, panY]);
  const setScaleValue = useCallback((value: number, render = true) => { scaleRef.current = value; zoom.value = value; if (render) setViewport((current) => current); }, [zoom]);
  const clampPan = useCallback((next: { x: number; y: number }, nextScale = scaleRef.current) => { const maxX = Math.max(viewport.width * 1.25, (layout.width * nextScale - viewport.width) / 2 + viewport.width * 0.5); const maxY = Math.max(viewport.height * 1.25, (layout.height * nextScale - viewport.height) / 2 + viewport.height * 0.5); return { x: Math.max(-maxX, Math.min(maxX, next.x)), y: Math.max(-maxY, Math.min(maxY, next.y)) }; }, [layout.height, layout.width, viewport.height, viewport.width]);
  const fit = useCallback(() => { if (!viewport.width || !viewport.height) return; const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min((viewport.width - 24) / layout.width, (viewport.height - 24) / layout.height))); scaleRef.current = nextScale; zoom.value = withTiming(nextScale, { duration: 180 }); panRef.current = { x: 0, y: 0 }; panX.value = withTiming(0, { duration: 180 }); panY.value = withTiming(0, { duration: 180 }); setHasFitted(true); }, [layout.height, layout.width, panX, panY, viewport.height, viewport.width, zoom]);
  useEffect(() => { if (!hasFitted && viewport.width && viewport.height) fit(); }, [fit, hasFitted, viewport.height, viewport.width]);
  useEffect(() => { setPanValue(clampPan(panRef.current)); }, [clampPan, setPanValue]);
  const canvasLayerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: panX.value }, { translateY: panY.value }, { scale: zoom.value }] }), [panX, panY, zoom]);
  const beginRename = useCallback(() => { setRename(controller.selected?.label ?? ''); setRenameOpen(true); setActionOpen(false); }, [controller.selected]);
  const handleNodePress = useCallback((id: string) => { const now = Date.now(); controller.setSelectedId(id); if (lastNodeTapRef.current.id === id && now - lastNodeTapRef.current.at < 280) beginRename(); lastNodeTapRef.current = { id, at: now }; }, [beginRename, controller]);
  const panResponder = useMemo(() => PanResponder.create({ onStartShouldSetPanResponder: (_, gesture) => gesture.numberActiveTouches > 1, onMoveShouldSetPanResponder: (_, gesture) => gesture.numberActiveTouches > 1 || Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3, onPanResponderGrant: (event) => { const touches = event.nativeEvent.touches; gestureStart.current = { pan: panRef.current, scale: scaleRef.current, distance: touches.length > 1 ? distance(touches[0], touches[1]) : 0 }; }, onPanResponderMove: (event, gesture) => { const touches = event.nativeEvent.touches; if (touches.length > 1) { const currentDistance = distance(touches[0], touches[1]); if (!gestureStart.current.distance) gestureStart.current.distance = currentDistance; const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, gestureStart.current.scale * currentDistance / gestureStart.current.distance)); setScaleValue(nextScale, false); setPanValue(clampPan(gestureStart.current.pan, nextScale), false); } else setPanValue(clampPan({ x: gestureStart.current.pan.x + gesture.dx, y: gestureStart.current.pan.y + gesture.dy }), false); }, onPanResponderRelease: () => setPanValue(clampPan(panRef.current)), onPanResponderTerminationRequest: () => false, onShouldBlockNativeResponder: () => true }), [clampPan, setPanValue, setScaleValue]);
  const handleCanvasTap = () => { const now = Date.now(); if (now - lastTapRef.current < 280) fit(); lastTapRef.current = now; };
  if (view === 'outline') return <View style={styles.mapRoot}><ScrollView contentContainerStyle={styles.outline}>{controller.parsed.error ? <InvalidState title={title} onCreateRoot={controller.createRoot} /> : outlineRows(controller.parsed.rootId, controller, theme, 0, setActionOpen)}</ScrollView><NodeSheets controller={controller} actionOpen={actionOpen} setActionOpen={setActionOpen} renameOpen={renameOpen} setRenameOpen={setRenameOpen} moveOpen={moveOpen} setMoveOpen={setMoveOpen} rename={rename} setRename={setRename} /></View>;
  if (controller.parsed.error) return <View style={styles.invalidMap}><InvalidState title={title} onCreateRoot={controller.createRoot} /></View>;
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  return <View style={styles.mapRoot} onLayout={(event) => setViewport({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })} {...panResponder.panHandlers}><Animated.View style={[styles.canvasLayer, { width: layout.width, height: layout.height, left: (viewport.width - layout.width) / 2, top: (viewport.height - layout.height) / 2 }, canvasLayerStyle]}><Svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} onPress={handleCanvasTap}><G>{layout.nodes.flatMap((node) => node.children.map((childId) => { const child = byId.get(childId); if (!child || node.collapsed) return null; return <Line key={`${node.id}-${child.id}`} x1={node.x + node.width / 2} y1={node.y + node.height} x2={child.x + child.width / 2} y2={child.y} stroke={theme.colors.borderSubtle} strokeWidth={1.5} />; }))}</G>{layout.nodes.map((node) => { const x = node.x; const y = node.y; const selected = controller.selectedId === node.id; const lines = wrapLabel(node.label); return <G key={node.id} onPress={() => { handleNodePress(node.id); setActionOpen(false); }} onLongPress={() => { controller.setSelectedId(node.id); setActionOpen(true); }}><Rect x={x} y={y} width={node.width} height={node.height} rx={10} fill={node.id === controller.parsed.rootId ? theme.colors.surfaceMuted : theme.colors.surface} stroke={selected ? theme.colors.accent : theme.colors.borderSubtle} strokeWidth={selected ? 2 : 1} /><SvgText x={x + NODE_PADDING} y={y + 22} fill={node.completed ? theme.colors.textMuted : theme.colors.textPrimary} fontSize={13} fontWeight="600" textDecoration={node.completed ? 'line-through' : undefined}>{lines.map((line, index) => <TSpan key={line + index} x={x + NODE_PADDING} dy={index === 0 ? 0 : 16}>{line}</TSpan>)}</SvgText>{node.completed ? <SvgText x={x + node.width - 17} y={y + 18} fill={theme.colors.accent} fontSize={12}>✓</SvgText> : null}{node.collapsed && node.children.length ? <SvgText x={x + node.width - 18} y={y + node.height - 10} fill={theme.colors.textMuted} fontSize={10}>+{controller.descendants(node.id).size}</SvgText> : null}</G>; })}</Svg></Animated.View>{controller.selected ? <NodeActions controller={controller} onRename={beginRename} onMove={() => setMoveOpen(true)} /> : null}{!hideControls ? <CanvasControls theme={theme} canUndo={controller.historyAvailable} onUndo={controller.undo} onArrange={() => { setHasFitted(false); fit(); }} onFit={fit} onZoomOut={() => setScaleValue(Math.max(MIN_SCALE, scaleRef.current - 0.1))} onZoomIn={() => setScaleValue(Math.min(MAX_SCALE, scaleRef.current + 0.1))} /> : null}<NodeSheets controller={controller} actionOpen={actionOpen} setActionOpen={setActionOpen} renameOpen={renameOpen} setRenameOpen={setRenameOpen} moveOpen={moveOpen} setMoveOpen={setMoveOpen} rename={rename} setRename={setRename} /></View>;
}

function outlineRows(id: string, controller: Controller, theme: ReturnType<typeof useLedgerTheme>, depth = 0, setActionOpen?: (value: boolean) => void): ReactNode[] { const node = controller.parsed.nodes[id]; if (!node) return []; const rows: ReactNode[] = [<Pressable key={id} onPress={() => { controller.setSelectedId(id); setActionOpen?.(true); }} style={[styles.outlineRow, { paddingLeft: Math.min(depth, 4) * 18 }]}><AppText variant="caption" style={styles.disclosure}>{node.children.length ? (node.collapsed ? '›' : '⌄') : ''}</AppText><AppText variant="body" style={{ color: node.completed ? theme.colors.textMuted : theme.colors.textPrimary, textDecorationLine: node.completed ? 'line-through' : 'none' }}>{node.label}</AppText></Pressable>]; if (!node.collapsed) node.children.forEach((child) => rows.push(...outlineRows(child, controller, theme, depth + 1, setActionOpen))); return rows; }

function InvalidState({ title, onCreateRoot }: { title: string; onCreateRoot: () => void }) { return <View style={styles.invalidState}><AppText variant="bodyStrong">Mind map needs a root</AppText><AppText variant="caption">The saved structure for “{title || 'Untitled'}” could not be read. Your existing data is preserved.</AppText><Pressable onPress={onCreateRoot} style={styles.saveButton}><AppText variant="button" style={{ color: '#fff' }}>Create root</AppText></Pressable></View>; }

function NodeSheets({ controller, actionOpen, setActionOpen, renameOpen, setRenameOpen, moveOpen, setMoveOpen, rename, setRename }: { controller: Controller; actionOpen: boolean; setActionOpen: (value: boolean) => void; renameOpen: boolean; setRenameOpen: (value: boolean) => void; moveOpen: boolean; setMoveOpen: (value: boolean) => void; rename: string; setRename: (value: string) => void }) { const theme = useLedgerTheme(); const selected = controller.selected; const done = (onPress: () => void, label = 'Done') => <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8}><SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={22} tintColor={theme.colors.accent} /></Pressable>; return <><AppBottomSheet visible={actionOpen} onClose={() => setActionOpen(false)} title={<AppText variant="sectionTitle">{selected?.label ?? 'Map node'}</AppText>} headerAccessory={done(() => setActionOpen(false))} snapPoints={['58%', '82%']} initialSnapPointIndex={0}><View style={[styles.sheetCard, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.window }]}><Pressable style={styles.actionRow} onPress={() => { setActionOpen(false); controller.addNode(false); }}><AppText variant="body">Add child</AppText></Pressable>{selected?.id !== controller.parsed.rootId ? <Pressable style={styles.actionRow} onPress={() => { setActionOpen(false); controller.addNode(true); }}><AppText variant="body">Add sibling</AppText></Pressable> : null}<Pressable style={styles.actionRow} onPress={() => { setRename(selected?.label ?? ''); setRenameOpen(true); setActionOpen(false); }}><AppText variant="body">Rename</AppText></Pressable><Pressable style={styles.actionRow} onPress={() => { controller.toggleComplete(); setActionOpen(false); }}><AppText variant="body">{selected?.completed ? 'Mark incomplete' : 'Complete'}</AppText></Pressable><Pressable style={styles.actionRow} onPress={() => { controller.toggleCollapse(); setActionOpen(false); }}><AppText variant="body">{selected?.collapsed ? 'Expand branch' : 'Collapse branch'}</AppText></Pressable>{selected?.id !== controller.parsed.rootId ? <Pressable style={styles.actionRow} onPress={() => { setActionOpen(false); setMoveOpen(true); }}><AppText variant="body">Move</AppText></Pressable> : null}{selected?.id !== controller.parsed.rootId ? <Pressable style={styles.actionRow} onPress={() => Alert.alert('Delete branch?', 'This removes the selected node and its descendants from the map.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: controller.removeNode }])}><AppText variant="body" style={{ color: theme.colors.danger }}>Delete</AppText></Pressable> : null}</View></AppBottomSheet><AppBottomSheet visible={moveOpen} onClose={() => setMoveOpen(false)} title={<AppText variant="sectionTitle">Move node</AppText>} headerAccessory={done(() => setMoveOpen(false))} snapPoints={['58%', '82%']} initialSnapPointIndex={0}><View style={[styles.sheetCard, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.window }]}>{selected ? Object.values(controller.parsed.nodes).filter((node) => node.id !== selected.id && !controller.descendants(selected.id).has(node.id)).map((node) => <Pressable key={node.id} style={styles.actionRow} onPress={() => { controller.moveTo(node.id); setMoveOpen(false); }}><AppText variant="body">{node.label}</AppText></Pressable>) : null}</View></AppBottomSheet><AppBottomSheet visible={renameOpen} onClose={() => setRenameOpen(false)} title={<AppText variant="sectionTitle">Rename node</AppText>} headerAccessory={done(() => { controller.renameNode(rename); setRenameOpen(false); }, 'Save node name')} snapPoints={['34%', '48%']} initialSnapPointIndex={0}><View style={[styles.inputCard, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.window }]}><TextInput autoFocus value={rename} onChangeText={setRename} onSubmitEditing={() => { controller.renameNode(rename); setRenameOpen(false); }} style={[styles.renameInput, { color: theme.colors.textPrimary }]} /></View></AppBottomSheet></>; }

const styles = StyleSheet.create({ mapRoot: { flex: 1, minHeight: 420, overflow: 'hidden' }, canvasLayer: { position: 'absolute' }, invalidMap: { flex: 1, minHeight: 420, justifyContent: 'center' }, invalidState: { padding: 24, gap: 10, alignItems: 'center' }, nodeHit: { position: 'absolute' }, controls: { position: 'absolute', top: 12, right: 12, padding: 4, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth }, controlRow: { flexDirection: 'row', alignItems: 'center', gap: 2 }, zoomRow: { marginTop: 3, paddingTop: 3, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 }, controlButton: { width: 42, height: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, zoomLabel: { minWidth: 42, textAlign: 'center' }, actionBar: { position: 'absolute', left: 10, right: 10, bottom: 28, minHeight: 48, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 5, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' }, actionButton: { minWidth: 70, minHeight: 44, paddingHorizontal: 10, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' }, outline: { paddingBottom: 120 }, outlineRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6 }, disclosure: { width: 16, color: '#6B7280' }, sheetCard: { overflow: 'hidden', paddingHorizontal: 16, paddingVertical: 6 }, actionRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, inputCard: { padding: 16 }, renameInput: { minHeight: 48, paddingHorizontal: 0, paddingVertical: 8, fontSize: 16, textAlignVertical: 'center' }, saveButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, borderRadius: 12 } });
