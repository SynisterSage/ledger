import {
  Plus,
  Copy,
  Maximize2,
  Minimize2,
  Redo2,
  Undo2,
  Search,
  LocateFixed,
  ChevronsUpDown,
  ListTree,
  Focus,
} from 'lucide-react';
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';

type MindMapNode = {
  id: string;
  label: string;
  children: string[];
  x: number;
  y: number;
  collapsed?: boolean;
  color?: string;
  group?: string;
  detail?: string;
  completed?: boolean;
};

type MindMapStructure = {
  nodes: Record<string, MindMapNode>;
  rootId: string;
};

const mindMapTheme = {
  surface: 'var(--ledger-surface-card)',
  surfaceMuted: 'var(--ledger-surface-muted)',
  surfaceHover: 'var(--ledger-surface-hover)',
  borderSubtle: 'var(--ledger-border-subtle)',
  borderStrong: 'var(--ledger-border-strong)',
  textPrimary: 'var(--ledger-text-primary)',
  textSecondary: 'var(--ledger-text-secondary)',
  textMuted: 'var(--ledger-text-muted)',
  accent: 'var(--ledger-accent)',
  accentHover: 'var(--ledger-accent-hover)',
  danger: 'var(--ledger-danger)',
  inputBackground: 'var(--ledger-input-background)',
  shadow: 'var(--ledger-shadow)',
} as const;

interface MindMapEditorProps {
  structure: unknown;
  onChange: (structure: MindMapStructure) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onToast?: (message: string) => void;
}

const defaultStructure: MindMapStructure = {
  nodes: {
    'root-1': {
      id: 'root-1',
      label: 'Central Idea',
      children: [],
      x: 0,
      y: 0,
    },
  },
  rootId: 'root-1',
};

export const MindMapEditor: React.FC<MindMapEditorProps> = ({
  structure,
  onChange,
  isFullscreen,
  onToggleFullscreen,
  onToast,
}) => {
  const initialStructure = useMemo(() => {
    if (structure && typeof structure === 'object' && 'nodes' in structure) {
      return structure as MindMapStructure;
    }
    return defaultStructure;
  }, []);

  const [nodes, setNodes] = useState<Record<string, MindMapNode>>(initialStructure.nodes);
  const [rootId] = useState(initialStructure.rootId);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(initialStructure.rootId);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodeId: string | null;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapViewportRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panStateRef = useRef<{
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
    moved: boolean;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'map' | 'outline'>('map');
  const [layoutDirection, setLayoutDirection] = useState<'balanced' | 'left' | 'right'>('balanced');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [focusedBranchId, setFocusedBranchId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const historyRef = useRef<MindMapStructure[]>([]);
  const historyIndexRef = useRef(-1);
  const lastHistorySnapshotRef = useRef('');
  const toastTimerRef = useRef<number | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const sceneWidth = viewportSize.width > 0 ? viewportSize.width : 800;
  const sceneHeight = viewportSize.height > 0 ? viewportSize.height : 500;
  const isTiny = sceneWidth > 0 && sceneWidth < 560;
  const isCompact = sceneWidth > 0 && sceneWidth < 760;
  const centerX = sceneWidth / 2;
  const centerY = sceneHeight / 2;

  useEffect(() => {
    if (historyRef.current.length > 0) return;
    const snapshot = { nodes, rootId };
    historyRef.current = [snapshot];
    historyIndexRef.current = 0;
    lastHistorySnapshotRef.current = JSON.stringify(snapshot);
  }, [nodes, rootId]);

  useEffect(() => {
    const element = mapViewportRef.current;
    if (!element) return;

    const updateViewportSize = () =>
      setViewportSize({ width: element.clientWidth, height: element.clientHeight });
    updateViewportSize();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => updateViewportSize());
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const updateStructure = useCallback(
    (newNodes: typeof nodes, recordHistory = true) => {
      setNodes(newNodes);
      onChange({ nodes: newNodes, rootId });
      if (recordHistory) {
        const snapshot = JSON.stringify({ nodes: newNodes, rootId });
        if (snapshot !== lastHistorySnapshotRef.current) {
          const nextHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
          nextHistory.push({ nodes: newNodes, rootId });
          historyRef.current = nextHistory.slice(-100);
          historyIndexRef.current = historyRef.current.length - 1;
          lastHistorySnapshotRef.current = snapshot;
          setHistoryVersion((version) => version + 1);
        }
      }
    },
    [rootId, onChange]
  );

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const snapshot = historyRef.current[historyIndexRef.current];
    if (!snapshot) return;
    setNodes(snapshot.nodes);
    onChange(snapshot);
    lastHistorySnapshotRef.current = JSON.stringify(snapshot);
    setHistoryVersion((version) => version + 1);
    showToast('Undid change');
  }, [onChange]);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const snapshot = historyRef.current[historyIndexRef.current];
    if (!snapshot) return;
    setNodes(snapshot.nodes);
    onChange(snapshot);
    lastHistorySnapshotRef.current = JSON.stringify(snapshot);
    setHistoryVersion((version) => version + 1);
    showToast('Redid change');
  }, [onChange]);

  const layoutMindMap = (sourceNodes: Record<string, MindMapNode>) => {
    const nextNodes: Record<string, MindMapNode> = { ...sourceNodes };
    const subtreeSizes = new Map<string, number>();
    const visited = new Set<string>();

    const countSubtree = (nodeId: string): number => {
      if (subtreeSizes.has(nodeId)) return subtreeSizes.get(nodeId) as number;
      if (visited.has(nodeId)) return 1;

      visited.add(nodeId);
      const node = sourceNodes[nodeId];
      if (!node || node.collapsed || node.children.length === 0) {
        subtreeSizes.set(nodeId, 1);
        visited.delete(nodeId);
        return 1;
      }

      const size = node.children.reduce((total, childId) => total + countSubtree(childId), 0);
      const nextSize = Math.max(1, size);
      subtreeSizes.set(nodeId, nextSize);
      visited.delete(nodeId);
      return nextSize;
    };

    countSubtree(rootId);

    const setPosition = (nodeId: string, depth: number, angle: number, span: number) => {
      const node = sourceNodes[nodeId];
      if (!node) return;

      const baseRadius = isTiny ? 74 : isCompact ? 92 : 112;
      const ringGap = isTiny ? 58 : isCompact ? 76 : 92;
      const radius = depth === 0 ? 0 : baseRadius + (depth - 1) * ringGap;
      nextNodes[nodeId] = {
        ...nextNodes[nodeId],
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      };

      if (node.collapsed || node.children.length === 0) return;

      const children = node.children.filter((childId) => sourceNodes[childId]);
      if (children.length === 0) return;

      const totalWeight = children.reduce(
        (sum, childId) => sum + (subtreeSizes.get(childId) ?? 1),
        0
      );
      const childSpan = depth === 0 && layoutDirection !== 'balanced'
        ? Math.PI * 0.82
        : Math.max(Math.PI / 10, span * 0.82);
      const branchAngle = depth === 0 && layoutDirection === 'left' ? Math.PI : depth === 0 && layoutDirection === 'right' ? 0 : angle;
      const start = branchAngle - childSpan / 2;
      const branchSeed = nodeId.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
      const chainDirection = branchSeed % 2 === 0 ? 1 : -1;
      const chainBend = Math.min(Math.PI * 0.82, 0.5 + depth * 0.16);

      let cursor = start;
      children.forEach((childId) => {
        const childWeight = subtreeSizes.get(childId) ?? 1;
        const share = childSpan * (childWeight / totalWeight);
        const rawAngle = cursor + share / 2;
        const childAngle =
          children.length === 1
            ? branchAngle + chainDirection * chainBend
            : rawAngle + (childWeight === 1 ? chainDirection * 0.08 : chainDirection * 0.03);
        setPosition(childId, depth + 1, childAngle, share);
        cursor += share;
      });
    };

    setPosition(rootId, 0, -Math.PI / 2, Math.PI * 2);

    const fitPadding = isTiny ? 70 : isCompact ? 88 : 110;
    const maxRadius = Math.max(80, Math.min(sceneWidth, sceneHeight) / 2 - fitPadding);
    const currentMax = Math.max(
      ...Object.values(nextNodes).map((node) => Math.hypot(node.x, node.y)),
      1
    );
    const scale = Math.min(1, maxRadius / currentMax);

    if (scale < 1) {
      Object.keys(nextNodes).forEach((nodeId) => {
        nextNodes[nodeId] = {
          ...nextNodes[nodeId],
          x: nextNodes[nodeId].x * scale,
          y: nextNodes[nodeId].y * scale,
        };
      });
    }

    return nextNodes;
  };

  const reflowLayout = useCallback(() => {
    updateStructure(layoutMindMap(nodes));
  }, [layoutMindMap, nodes, updateStructure]);

  useEffect(() => {
    if (historyRef.current.length > 0) reflowLayout();
    // Direction changes are intentional layout operations, so they belong in undo history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutDirection]);

  const handleAddChild = useCallback(
    (nodeId?: string) => {
      const parentId = nodeId ?? selectedNodeId;
      if (!parentId) return;

      const newNodeId = `node-${Date.now()}`;
      const parent = nodes[parentId];
      if (!parent) return;

      const angleOptions = [
        0,
        -Math.PI / 4,
        Math.PI / 4,
        Math.PI / 2,
        -Math.PI / 2,
        (3 * Math.PI) / 4,
        (-3 * Math.PI) / 4,
        Math.PI,
      ];
      const angle = angleOptions[parent.children.length % angleOptions.length];
      const distance = Math.max(
        120,
        Math.min(sceneWidth, sceneHeight) * (parentId === rootId ? 0.26 : 0.2)
      );
      const newNode: MindMapNode = {
        id: newNodeId,
        label: 'New Idea',
        children: [],
        x: parent.x + Math.cos(angle) * distance,
        y: parent.y + Math.sin(angle) * distance,
        group: parent.group,
      };

      const updatedParent = { ...parent, children: [...parent.children, newNodeId] };
      // Structural edits use the automatic tree layout; manual dragging remains available afterward.
      const nextNodes = { ...nodes, [newNodeId]: newNode, [parentId]: updatedParent };
      updateStructure(layoutMindMap(nextNodes));
      setSelectedNodeId(newNodeId);
      setEditingNodeId(newNodeId);
      setEditingLabel(newNode.label);
    },
    [selectedNodeId, nodes, rootId, updateStructure, sceneWidth, sceneHeight]
  );

  const handleAddSibling = useCallback(
    (nodeId?: string) => {
      const targetId = nodeId ?? selectedNodeId;
      if (!targetId || targetId === rootId) return;

      const sibling = nodes[targetId];
      if (!sibling) return;
      const parentId = getParentId(targetId);
      if (!parentId) return;
      const parent = nodes[parentId];
      if (!parent) return;

      const newNodeId = `node-${Date.now()}`;
      const siblingIndex = parent.children.indexOf(targetId);
      const spacing = Math.max(72, Math.min(sceneWidth, sceneHeight) * 0.14);
      const newNode: MindMapNode = {
        id: newNodeId,
        label: 'New Sibling',
        children: [],
        x: sibling.x + spacing,
        y: sibling.y,
        group: sibling.group ?? parent.group,
      };

      const nextChildren = [...parent.children];
      nextChildren.splice(Math.max(0, siblingIndex + 1), 0, newNodeId);
      const nextNodes = {
        ...nodes,
        [newNodeId]: newNode,
        [parentId]: { ...parent, children: nextChildren },
      };
      updateStructure(layoutMindMap(nextNodes));
      setSelectedNodeId(newNodeId);
      setEditingNodeId(newNodeId);
      setEditingLabel(newNode.label);
      setContextMenu(null);
      showToast('Sibling added');
    },
    [
      selectedNodeId,
      rootId,
      nodes,
      getParentId,
      updateStructure,
      showToast,
      sceneWidth,
      sceneHeight,
    ]
  );

  const handleDuplicateBranch = useCallback(
    (nodeId?: string) => {
      const targetId = nodeId ?? selectedNodeId;
      if (!targetId) return;
      const sourceRoot = nodes[targetId];
      if (!sourceRoot) return;

      const parentId = getParentId(targetId);
      if (!parentId) return;
      const parent = nodes[parentId];
      if (!parent) return;

      const idMap = new Map<string, string>();
      const cloneSubtree = (sourceId: string): MindMapNode | null => {
        const source = nodes[sourceId];
        if (!source) return null;
        const clonedId = `${sourceId}-copy-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        idMap.set(sourceId, clonedId);
        const clonedChildren = source.children
          .map((childId) => cloneSubtree(childId))
          .filter((child): child is MindMapNode => child !== null)
          .map((child) => child.id);

        return {
          ...source,
          id: clonedId,
          label: `${source.label} copy`,
          children: clonedChildren,
          x: source.x + 96,
          y: source.y + 36,
        };
      };

      const collected: Record<string, MindMapNode> = {};
      const collectClones = (sourceId: string) => {
        const source = nodes[sourceId];
        const clonedId = idMap.get(sourceId);
        if (!source || !clonedId) return;
        collected[clonedId] = {
          ...source,
          id: clonedId,
          label: sourceId === targetId ? `${source.label} copy` : source.label,
          children: source.children
            .map((childId) => idMap.get(childId))
            .filter((id): id is string => Boolean(id)),
          x: source.x + 96,
          y: source.y + 36,
        };
        source.children.forEach((childId) => collectClones(childId));
      };

      const cloneRoot = cloneSubtree(targetId);
      if (!cloneRoot) return;
      collectClones(targetId);

      const nextChildren = [...parent.children];
      const targetIndex = nextChildren.indexOf(targetId);
      nextChildren.splice(Math.max(0, targetIndex + 1), 0, cloneRoot.id);

      const nextNodes = {
        ...nodes,
        ...collected,
        [parentId]: {
          ...parent,
          children: nextChildren,
        },
      };

      updateStructure(nextNodes);
      setSelectedNodeId(cloneRoot.id);
      setContextMenu(null);
      showToast('Branch duplicated');
    },
    [selectedNodeId, nodes, getParentId, updateStructure, showToast]
  );

  const handleAssignGroup = useCallback(
    (group: string, nodeId?: string) => {
      const targetId = nodeId ?? selectedNodeId;
      if (!targetId) return;
      const node = nodes[targetId];
      if (!node) return;
      updateStructure({ ...nodes, [targetId]: { ...node, group } });
      setContextMenu(null);
      showToast(`Moved to ${group}`);
    },
    [selectedNodeId, nodes, updateStructure, showToast]
  );

  const handleDeleteNode = useCallback(
    (nodeId?: string) => {
      const targetId = nodeId ?? selectedNodeId;
      if (!targetId || targetId === rootId) return;

      // Collect the subtree of node IDs to remove (selected node + all descendants)
      const idsToRemove = new Set<string>();
      const stack = [targetId];
      while (stack.length) {
        const id = stack.pop() as string;
        if (idsToRemove.has(id)) continue;
        idsToRemove.add(id);
        const node = nodes[id];
        if (!node) continue;
        node.children.forEach((c) => stack.push(c));
      }

      const updatedNodes: Record<string, MindMapNode> = {};
      Object.keys(nodes).forEach((nodeId) => {
        if (idsToRemove.has(nodeId)) return;
        const node = nodes[nodeId];
        // remove references to deleted ids from children
        const children = node.children.filter((childId) => !idsToRemove.has(childId));
        updatedNodes[nodeId] = { ...node, children };
      });

      updateStructure(layoutMindMap(updatedNodes));
      setSelectedNodeId(null);
      setContextMenu(null);
      showToast('Node deleted');
    },
    [selectedNodeId, rootId, nodes, updateStructure, showToast]
  );

  const handleRenameNode = useCallback(
    (nodeId: string, newLabel: string) => {
      if (!newLabel.trim()) return;
      const node = nodes[nodeId];
      if (!node) return;
      updateStructure({ ...nodes, [nodeId]: { ...node, label: newLabel.trim() } });
      setEditingNodeId(null);
    },
    [nodes, updateStructure]
  );

  const handleToggleCollapse = useCallback(
    (nodeId: string) => {
      const node = nodes[nodeId];
      if (!node) return;
      updateStructure(layoutMindMap({ ...nodes, [nodeId]: { ...node, collapsed: !node.collapsed } }));
    },
    [nodes, updateStructure]
  );

  const handleNodeDrag = useCallback(
    (nodeId: string, dx: number, dy: number) => {
      if (!nodes[nodeId]) return;
      const ids = new Set<string>();
      const collect = (id: string) => {
        if (ids.has(id)) return;
        ids.add(id);
        nodes[id]?.children.forEach(collect);
      };
      collect(nodeId);
      const nextNodes = { ...nodes };
      ids.forEach((id) => {
        const node = nodes[id];
        if (node) nextNodes[id] = { ...node, x: node.x + dx, y: node.y + dy };
      });
      // Pointer moves are intentionally not separate undo entries. The final
      // position is still persisted through the normal structure callback.
      updateStructure(nextNodes, false);
    },
    [nodes, updateStructure]
  );

  const handleChangeNodeColor = useCallback(
    (nodeId: string, color: string) => {
      const node = nodes[nodeId];
      if (!node) return;
      updateStructure({ ...nodes, [nodeId]: { ...node, color } });
    },
    [nodes, updateStructure]
  );

  const clampZoom = useCallback((value: number) => Math.min(2.5, Math.max(0.5, value)), []);

  const zoomAtPoint = useCallback(
    (clientX: number, clientY: number, nextZoom: number) => {
      const svgElement = svgRef.current;
      if (!svgElement) return;
      const rect = svgElement.getBoundingClientRect();
      const pointerX = clientX - rect.left;
      const pointerY = clientY - rect.top;
      const worldX = (pointerX - centerX - offsetX) / zoom;
      const worldY = (pointerY - centerY - offsetY) / zoom;
      setZoom(nextZoom);
      setOffsetX(pointerX - centerX - worldX * nextZoom);
      setOffsetY(pointerY - centerY - worldY * nextZoom);
    },
    [centerX, centerY, offsetX, offsetY, zoom]
  );

  const handleWheel = useCallback(
    (event: React.WheelEvent<SVGSVGElement>) => {
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) {
        const zoomDelta = Math.exp(-event.deltaY * 0.0012);
        zoomAtPoint(event.clientX, event.clientY, clampZoom(zoom * zoomDelta));
        return;
      }

      setOffsetX((current) => current - event.deltaX);
      setOffsetY((current) => current - event.deltaY);
    },
    [clampZoom, zoom, zoomAtPoint]
  );

  const handleViewportWheelCapture = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    // Keep wheel interactions scoped to the mind map viewport so parent panes don't scroll.
    event.preventDefault();
    event.stopPropagation();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
      if (!selectedNodeId) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        handleAddChild();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleDeleteNode();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeId, handleAddChild, handleDeleteNode]);

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      if (!draggingNodeId) return;
      const node = nodes[draggingNodeId];
      if (!node) return;

      const layoutScale = zoom;
      const dx = event.movementX / layoutScale;
      const dy = event.movementY / layoutScale;
      handleNodeDrag(draggingNodeId, dx, dy);
    };

    const handleUp = (event: PointerEvent) => {
      if (draggingNodeId) {
        const dragged = nodes[draggingNodeId];
        const parentId = getParentId(draggingNodeId);
        const subtree = new Set(collectBranchIds(draggingNodeId));
        const rect = svgRef.current?.getBoundingClientRect();
        if (dragged && dragged.id !== rootId && rect && parentId) {
          const worldX = (event.clientX - rect.left - centerX - offsetX) / zoom;
          const worldY = (event.clientY - rect.top - centerY - offsetY) / zoom;
          const target = Object.values(nodes)
            .filter((node) => !subtree.has(node.id) && node.id !== parentId)
            .sort((a, b) => Math.hypot(a.x - worldX, a.y - worldY) - Math.hypot(b.x - worldX, b.y - worldY))[0];
          if (target && Math.hypot(target.x - worldX, target.y - worldY) < 72 && !target.children.includes(draggingNodeId)) {
            const parent = nodes[parentId];
            const nextNodes = { ...nodes,
              [parentId]: { ...parent, children: parent.children.filter((id) => id !== draggingNodeId) },
              [target.id]: { ...target, children: [...target.children, draggingNodeId] },
            };
            updateStructure(layoutMindMap(nextNodes));
            setSelectedNodeId(draggingNodeId);
            setDraggingNodeId(null);
            return;
          }
        }
        updateStructure(nodes);
      }
      setDraggingNodeId(null);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [draggingNodeId, handleNodeDrag, nodes, zoom]);

  const nodeColors = ['#f3f4f6', '#fef3c7', '#dbeafe', '#ede9fe', '#fecaca', '#dcfce7'];
  const nodeColorLabels = ['Gray', 'Yellow', 'Blue', 'Purple', 'Red', 'Green'];
  const availableGroups = ['Ungrouped', 'Work', 'Personal', 'Ideas', 'Planning'];

  function showToast(message: string) {
    if (onToast) {
      onToast(message);
      return;
    }
    setToastMessage(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMessage(null), 2000);
  }

  function getParentId(targetNodeId: string): string | null {
    for (const nodeId of Object.keys(nodes)) {
      if (nodes[nodeId].children.includes(targetNodeId)) return nodeId;
    }
    return null;
  }

  const beginEditing = useCallback((nodeId: string, initialText?: string) => {
    const node = nodes[nodeId];
    if (!node) return;
    setSelectedNodeId(nodeId);
    setEditingNodeId(nodeId);
    setEditingLabel(initialText ?? node.label);
  }, [nodes]);

  const moveNodeUp = useCallback((nodeId: string) => {
    const parentId = getParentId(nodeId);
    if (!parentId) return;
    const grandparentId = getParentId(parentId);
    if (!grandparentId) return;
    const parent = nodes[parentId];
    const grandparent = nodes[grandparentId];
    if (!parent || !grandparent) return;
    const nextNodes = { ...nodes };
    nextNodes[parentId] = { ...parent, children: parent.children.filter((id) => id !== nodeId) };
    const parentIndex = grandparent.children.indexOf(parentId);
    const nextChildren = [...grandparent.children];
    nextChildren.splice(parentIndex + 1, 0, nodeId);
    nextNodes[grandparentId] = { ...grandparent, children: nextChildren };
    updateStructure(nextNodes);
    setSelectedNodeId(nodeId);
    showToast('Moved up one level');
  }, [nodes, updateStructure, showToast]);

  const navigateToNearbyNode = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    const selected = selectedNodeId ? nodes[selectedNodeId] : nodes[rootId];
    if (!selected) return;
    const candidates = Object.values(nodes).filter((node) => node.id !== selected.id);
    const directional = candidates.filter((node) => {
      const dx = node.x - selected.x;
      const dy = node.y - selected.y;
      if (direction === 'up') return dy < -12;
      if (direction === 'down') return dy > 12;
      if (direction === 'left') return dx < -12;
      return dx > 12;
    });
    const pool = directional.length ? directional : candidates;
    const next = pool.sort((a, b) => {
      const aDistance = Math.hypot(a.x - selected.x, a.y - selected.y);
      const bDistance = Math.hypot(b.x - selected.x, b.y - selected.y);
      return aDistance - bDistance;
    })[0];
    if (next) setSelectedNodeId(next.id);
  }, [nodes, rootId, selectedNodeId]);

  const fitNodes = useCallback((ids: string[]) => {
    const visible = ids.map((id) => nodes[id]).filter(Boolean);
    if (!visible.length) return;
    const minX = Math.min(...visible.map((node) => node.x));
    const maxX = Math.max(...visible.map((node) => node.x));
    const minY = Math.min(...visible.map((node) => node.y));
    const maxY = Math.max(...visible.map((node) => node.y));
    const width = Math.max(220, maxX - minX + 180);
    const height = Math.max(160, maxY - minY + 130);
    setZoom(clampZoom(Math.min(sceneWidth / width, sceneHeight / height)));
    setOffsetX(-((minX + maxX) / 2) * zoom);
    setOffsetY(-((minY + maxY) / 2) * zoom);
  }, [nodes, sceneWidth, sceneHeight, clampZoom, zoom]);

  const collectBranchIds = useCallback((nodeId: string): string[] => {
    const ids: string[] = [];
    const visit = (id: string) => {
      ids.push(id);
      nodes[id]?.children.forEach(visit);
    };
    visit(nodeId);
    return ids;
  }, [nodes]);

  useEffect(() => {
    if (!searchQuery.trim()) return;
    const match = Object.values(nodes).find((node) => `${node.label} ${node.detail ?? ''}`.toLowerCase().includes(searchQuery.trim().toLowerCase()));
    if (!match) return;
    setSelectedNodeId(match.id);
    setOffsetX(-match.x * zoom);
    setOffsetY(-match.y * zoom);
  }, [nodes, searchQuery, zoom]);

  const handleCanvasKeyDown = useCallback((event: React.KeyboardEvent<SVGSVGElement>) => {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    const selected = selectedNodeId ?? rootId;
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      undo();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      redo();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      handleAddSibling(selected);
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      if (event.shiftKey) moveNodeUp(selected);
      else handleAddChild(selected);
      return;
    }
    if (event.key === 'Escape') {
      setEditingNodeId(null);
      setFocusedBranchId(null);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      handleDeleteNode(selected);
      return;
    }
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      navigateToNearbyNode(event.key.slice(5).toLowerCase() as 'up' | 'down' | 'left' | 'right');
      return;
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      beginEditing(selected, event.key);
    }
  }, [selectedNodeId, rootId, undo, redo, handleAddSibling, handleAddChild, moveNodeUp, handleDeleteNode, navigateToNearbyNode, beginEditing]);

  const exportAsJSON = () => {
    const json = JSON.stringify({ nodes, rootId }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mindmap-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMenuOpen(false);
    setToastMessage('Exported JSON');
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMessage(null), 2000);
  };

  const exportAsMarkdown = () => {
    const renderNodeAsMarkdown = (nodeId: string, indent: number = 0): string => {
      const node = nodes[nodeId];
      if (!node) return '';
      const prefix = '  '.repeat(indent);
      const lines = [`${prefix}• ${node.label}`];
      node.children.forEach((childId) => {
        lines.push(renderNodeAsMarkdown(childId, indent + 1));
      });
      return lines.join('\n');
    };

    const markdown = renderNodeAsMarkdown(rootId);
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mindmap-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setMenuOpen(false);
    setToastMessage('Exported Markdown');
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMessage(null), 2000);
  };

  const copyAsMarkdown = async () => {
    const renderNodeAsMarkdown = (nodeId: string, indent: number = 0): string => {
      const node = nodes[nodeId];
      if (!node) return '';
      const prefix = '  '.repeat(indent);
      const lines = [`${prefix}• ${node.label}`];
      node.children.forEach((childId) => {
        lines.push(renderNodeAsMarkdown(childId, indent + 1));
      });
      return lines.join('\n');
    };

    const markdown = renderNodeAsMarkdown(rootId);
    try {
      await navigator.clipboard.writeText(markdown);
      setMenuOpen(false);
      setToastMessage('Copied Markdown to clipboard');
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setToastMessage(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
      setToastMessage('Failed to copy');
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setToastMessage(null), 2000);
    }
  };

  const resetMindMap = useCallback(() => {
    const newRoot: MindMapNode = {
      id: rootId,
      label: 'Central Idea',
      children: [],
      x: 0,
      y: 0,
    };
    const newNodes: Record<string, MindMapNode> = { [rootId]: newRoot };
    updateStructure(newNodes);
    setSelectedNodeId(rootId);
    setMenuOpen(false);
    showToast('Mind map reset');
  }, [rootId, updateStructure, showToast]);

  const canToggleFullscreen = typeof onToggleFullscreen === 'function';
  const canUndo = historyVersion >= 0 && historyIndexRef.current > 0;
  const canRedo = historyVersion >= 0 && historyIndexRef.current < historyRef.current.length - 1;

  const renderOutlineNode = (nodeId: string, depth = 0): React.ReactNode => {
    const node = nodes[nodeId];
    if (!node) return null;
    const isFocused = !focusedBranchId || collectBranchIds(focusedBranchId).includes(nodeId);
    const matchesSearch = !searchQuery.trim() || `${node.label} ${node.detail ?? ''}`.toLowerCase().includes(searchQuery.trim().toLowerCase());
    return (
      <div key={nodeId} className="select-none" style={{ opacity: isFocused ? (matchesSearch ? 1 : 0.45) : 0.22 }}>
        <div
          className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--ledger-surface-hover)]"
          style={{ marginLeft: depth * 22 }}
          onClick={() => setSelectedNodeId(nodeId)}
          onDoubleClick={() => beginEditing(nodeId)}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: node.color || 'var(--ledger-accent)' }} />
          {editingNodeId === nodeId ? (
            <input autoFocus value={editingLabel} onChange={(event) => setEditingLabel(event.target.value)} onBlur={() => handleRenameNode(nodeId, editingLabel)} onKeyDown={(event) => { if (event.key === 'Enter') handleRenameNode(nodeId, editingLabel); if (event.key === 'Escape') setEditingNodeId(null); }} className="min-w-0 flex-1 rounded border bg-transparent px-1 text-sm outline-none" />
          ) : (
            <span className="min-w-0 flex-1 truncate text-sm" style={{ color: mindMapTheme.textPrimary }}>{node.label}</span>
          )}
          {node.detail && <span className="text-[10px]" style={{ color: mindMapTheme.textMuted }}>details</span>}
          {node.children.length > 0 && <button className="text-xs" onClick={(event) => { event.stopPropagation(); handleToggleCollapse(nodeId); }} style={{ color: mindMapTheme.textMuted }}>{node.collapsed ? `+${collectBranchIds(nodeId).length - 1}` : '−'}</button>}
        </div>
        {!node.collapsed && node.children.map((childId) => renderOutlineNode(childId, depth + 1))}
      </div>
    );
  };

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const clickInToolbarMenu = menuRef.current?.contains(target);
      const clickInContextMenu = contextMenuRef.current?.contains(target);
      if (clickInToolbarMenu || clickInContextMenu) return;
      setMenuOpen(false);
      setContextMenu(null);
    };
    if (menuOpen || contextMenu) window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [menuOpen, contextMenu]);

  const renderNode = (nodeId: string, parentX?: number, parentY?: number): React.ReactNode => {
    const node = nodes[nodeId];
    if (!node) return null;

    const displayX = centerX + node.x * zoom + offsetX;
    const displayY = centerY + node.y * zoom + offsetY;
    const isSelected = selectedNodeId === nodeId;
    const isEditing = editingNodeId === nodeId;
    const isRoot = nodeId === rootId;
    const isFocused = !focusedBranchId || collectBranchIds(focusedBranchId).includes(nodeId);
    const matchesSearch = !searchQuery.trim() || `${node.label} ${node.detail ?? ''}`.toLowerCase().includes(searchQuery.trim().toLowerCase());
    const labelLines = node.label.length <= 23
      ? [node.label]
      : [node.label.slice(0, 23), `${node.label.slice(23, 46)}${node.label.length > 46 ? '…' : ''}`];
    const longestLabelLine = Math.max(...labelLines.map((line) => line.length));
    const nodeWidth = Math.max(
      isRoot ? 124 : isTiny ? 108 : 116,
      Math.min(isTiny ? 210 : 268, 62 + longestLabelLine * (isTiny ? 6 : 7))
    );
    const nodeHeight = labelLines.length > 1 ? 58 : isRoot ? 48 : isTiny ? 42 : 44;
    const branchAccent = node.color || (isRoot ? mindMapTheme.accent : 'var(--ledger-warning)');
    const fill = isRoot ? 'var(--ledger-surface-muted)' : mindMapTheme.surface;
    const stroke = isSelected ? mindMapTheme.accent : isRoot ? 'var(--ledger-border-strong)' : mindMapTheme.borderSubtle;

    return (
      <g key={nodeId}>
        {parentX !== undefined && parentY !== undefined && (
          <line
            x1={parentX}
            y1={parentY}
            x2={displayX}
            y2={displayY}
            stroke={isRoot ? mindMapTheme.borderStrong : mindMapTheme.borderSubtle}
            strokeWidth="2"
            strokeLinecap="round"
            pointerEvents="none"
          />
        )}

        {!node.collapsed && node.children.map((childId) => renderNode(childId, displayX, displayY))}

        <g
          transform={`translate(${displayX}, ${displayY})`}
          opacity={isFocused ? (matchesSearch ? 1 : 0.42) : 0.18}
          onMouseEnter={() => setHoveredNodeId(nodeId)}
          onMouseLeave={() => setHoveredNodeId(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const rect = containerRef.current?.getBoundingClientRect();
            setSelectedNodeId(nodeId);
            setMenuOpen(false);
            setContextMenu({
              x: rect ? e.clientX - rect.left : e.clientX,
              y: rect ? e.clientY - rect.top : e.clientY,
              nodeId,
            });
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            if (e.button !== 0) return;
            setSelectedNodeId(nodeId);
            svgRef.current?.focus();
            setDraggingNodeId(nodeId);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditingNodeId(nodeId);
            setEditingLabel(node.label);
          }}
          style={{ cursor: draggingNodeId === nodeId ? 'grabbing' : 'grab' }}
        >
          <rect
            x={-nodeWidth / 2}
            y={-nodeHeight / 2}
            width={nodeWidth}
            height={nodeHeight}
            rx="10"
            fill={fill}
            stroke={stroke}
            strokeWidth="2"
            style={{ filter: isSelected ? 'drop-shadow(0 0 0.5px var(--ledger-accent))' : 'drop-shadow(0 1px 2px rgba(0,0,0,.16))' }}
          />
          <circle
            cx={-nodeWidth / 2 + 12}
            cy={0}
            r="4"
            fill={branchAccent}
            opacity={isSelected ? 0.95 : 1}
          />
          <text
            x={isRoot ? 0 : -nodeWidth / 2 + 32}
            y={isRoot ? 4 : labelLines.length > 1 ? -6 : 4}
            fontSize={isRoot ? '13' : '12'}
            fontWeight="600"
            textAnchor={isRoot ? 'middle' : 'start'}
            fill={mindMapTheme.textPrimary}
            style={{ userSelect: 'none', pointerEvents: 'none' }}
          >
            {labelLines.map((line, index) => (
              <tspan key={`${nodeId}-label-${index}`} x={isRoot ? 0 : -nodeWidth / 2 + 32} dy={index === 0 ? 0 : 14}>{line}</tspan>
            ))}
          </text>
        </g>

        <g
          onMouseEnter={() => setHoveredNodeId(nodeId)}
          onMouseLeave={() => setHoveredNodeId(null)}
          onClick={(event) => { event.stopPropagation(); handleAddChild(nodeId); }}
          style={{ cursor: 'pointer' }}
        >
          {/* The transparent bridge keeps the quick-add target alive while the pointer travels from the node. */}
          <rect x={displayX + nodeWidth / 2 - 4} y={displayY - 14} width="30" height="28" fill="transparent" />
          {hoveredNodeId === nodeId && (
            <>
              <circle cx={displayX + nodeWidth / 2 + 10} cy={displayY} r="9" fill={mindMapTheme.accent} />
              <text x={displayX + nodeWidth / 2 + 10} y={displayY + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="white">+</text>
            </>
          )}
        </g>

        {node.children.length > 0 && (
          <g onClick={() => handleToggleCollapse(nodeId)} style={{ cursor: 'pointer' }}>
            <rect
              x={displayX - 8}
              y={displayY + nodeHeight / 2 + 4}
              width="16"
              height="16"
              fill={mindMapTheme.surface}
              stroke={mindMapTheme.borderSubtle}
              strokeWidth="1"
              rx="2"
            />
            <text
              x={displayX}
              y={displayY + nodeHeight / 2 + 17}
              fontSize="10"
              fontWeight="bold"
              textAnchor="middle"
              fill={mindMapTheme.textSecondary}
            >
              {node.collapsed ? `+${collectBranchIds(nodeId).length - 1}` : '−'}
            </text>
          </g>
        )}

        {isEditing && (
          <foreignObject x={displayX - nodeWidth / 2 + 8} y={displayY - 14} width={nodeWidth - 16} height={nodeHeight - 4}>
            <input
              autoFocus
              type="text"
              value={editingLabel}
              onChange={(e) => setEditingLabel(e.target.value)}
              onBlur={() => handleRenameNode(nodeId, editingLabel)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameNode(nodeId, editingLabel);
                if (e.key === 'Escape') setEditingNodeId(null);
              }}
              className="w-full text-xs text-center rounded px-1 py-0.5 outline-none"
              style={{
                backgroundColor: mindMapTheme.surface,
                border: `1px solid ${mindMapTheme.borderSubtle}`,
                color: mindMapTheme.textPrimary,
                boxShadow: `0 0 0 1px ${mindMapTheme.surface}`,
              }}
            />
          </foreignObject>
        )}
      </g>
    );
  };

  return (
    <div
      ref={containerRef}
      className="relative flex h-full min-h-[420px] w-full flex-col overflow-hidden rounded-lg border"
      style={{
        borderColor: mindMapTheme.borderSubtle,
        backgroundColor: mindMapTheme.surfaceMuted,
        color: mindMapTheme.textPrimary,
      }}
    >
      {isCompact ? (
        <div
          className="border-b px-3 py-2"
          style={{ borderColor: mindMapTheme.borderSubtle, backgroundColor: mindMapTheme.surface }}
        >
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <button
                onClick={() => handleAddChild()}
                disabled={!selectedNodeId}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                style={{ backgroundColor: mindMapTheme.accent }}
                title="Ctrl+N"
              >
                <Plus size={14} />
                <span>Add</span>
              </button>
              <button
                onClick={reflowLayout}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium transition"
                style={{
                  backgroundColor: mindMapTheme.surfaceMuted,
                  color: mindMapTheme.textSecondary,
                }}
                title="Arrange nodes"
              >
                Arrange
              </button>
              <button onClick={undo} disabled={!canUndo} className="rounded-lg p-1.5 text-xs disabled:opacity-35" title="Undo (Cmd/Ctrl+Z)"><Undo2 size={14} /></button>
              <button onClick={redo} disabled={!canRedo} className="rounded-lg p-1.5 text-xs disabled:opacity-35" title="Redo (Cmd/Ctrl+Shift+Z)"><Redo2 size={14} /></button>
            </div>

            <div className="ml-auto flex items-center gap-1 shrink-0">
              <button onClick={() => setIsSearchOpen((open) => !open)} className="h-8 w-8 rounded text-xs" title="Search nodes"><Search size={14} className="mx-auto" /></button>
              <button onClick={() => fitNodes(collectBranchIds(selectedNodeId ?? rootId))} className="h-8 w-8 rounded text-xs" title="Fit selection"><Focus size={14} className="mx-auto" /></button>
              <button onClick={() => fitNodes(Object.keys(nodes))} className="h-8 w-8 rounded text-xs" title="Fit map"><LocateFixed size={14} className="mx-auto opacity-60" /></button>
              <button onClick={() => setLayoutDirection((direction) => direction === 'balanced' ? 'right' : direction === 'right' ? 'left' : 'balanced')} className="h-8 rounded px-2 text-xs" title="Layout direction"><ChevronsUpDown size={14} /></button>
              <button onClick={() => setViewMode((mode) => mode === 'map' ? 'outline' : 'map')} className="h-8 rounded px-2 text-xs" title="Switch Map / Outline"><ListTree size={14} /></button>
              <button
                onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
                className="h-8 w-8 rounded text-xs font-medium transition"
                style={{ backgroundColor: mindMapTheme.surfaceMuted, color: mindMapTheme.textSecondary }}
              >
                −
              </button>
              <span className="w-11 text-center text-xs font-medium" style={{ color: mindMapTheme.textSecondary }}>
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom(Math.min(2, zoom + 0.1))}
                className="h-8 w-8 rounded text-xs font-medium transition"
                style={{ backgroundColor: mindMapTheme.surfaceMuted, color: mindMapTheme.textSecondary }}
              >
                +
              </button>
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => {
                    setContextMenu(null);
                    setMenuOpen((s) => !s);
                  }}
                  className="h-8 w-8 rounded text-xs font-medium transition"
                  style={{ backgroundColor: mindMapTheme.surfaceMuted, color: mindMapTheme.textSecondary }}
                  aria-expanded={menuOpen}
                  aria-haspopup="true"
                >
                  ⋯
                </button>
                {menuOpen && (
                  <div
                    className="absolute right-0 mt-1 w-40 rounded-lg border shadow-lg transition z-10"
                    style={{
                      backgroundColor: mindMapTheme.surface,
                      borderColor: mindMapTheme.borderSubtle,
                      boxShadow: mindMapTheme.shadow,
                    }}
                  >
                    {canToggleFullscreen && (
                      <>
                        <button
                          onClick={() => {
                            onToggleFullscreen?.();
                            setMenuOpen(false);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs first:rounded-t-lg"
                          style={{ color: mindMapTheme.textSecondary }}
                        >
                          {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                          {isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                        </button>
                        <div className="border-t" style={{ borderColor: mindMapTheme.borderSubtle }} />
                      </>
                    )}
                    <button
                      onClick={resetMindMap}
                      className="w-full text-left px-3 py-2 text-xs first:rounded-t-lg"
                      style={{ color: mindMapTheme.danger }}
                    >
                      Reset mind map
                    </button>
                    <div className="border-t" style={{ borderColor: mindMapTheme.borderSubtle }} />
                    <button
                      onClick={exportAsJSON}
                      className="w-full text-left px-3 py-2 text-xs"
                      style={{ color: mindMapTheme.textSecondary }}
                    >
                      Export as JSON
                    </button>
                    <button
                      onClick={exportAsMarkdown}
                      className="w-full text-left px-3 py-2 text-xs"
                      style={{ color: mindMapTheme.textSecondary }}
                    >
                      Export as Markdown
                    </button>
                    <button
                      onClick={copyAsMarkdown}
                      className="last:rounded-b-lg flex w-full items-center gap-1 px-3 py-2 text-left text-xs"
                      style={{ color: mindMapTheme.textSecondary }}
                    >
                      <Copy size={12} />
                      Copy as Markdown
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {selectedNodeId && detailsOpen && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex flex-wrap gap-1">
                {nodeColors.map((color, idx) => (
                  <button
                    key={color}
                    onClick={() => handleChangeNodeColor(selectedNodeId, color)}
                    className="h-5 w-5 rounded border-2 transition hover:shadow-md"
                    style={{
                      backgroundColor: color,
                      borderColor:
                        nodes[selectedNodeId]?.color === color ? mindMapTheme.accent : mindMapTheme.borderSubtle,
                    }}
                    title={nodeColorLabels[idx]}
                  />
                ))}
              </div>
              <select
                value={nodes[selectedNodeId]?.group ?? 'Ungrouped'}
                onChange={(e) => handleAssignGroup(e.target.value)}
                className="min-w-0 flex-1 rounded border px-2 py-1 text-xs"
                style={{
                  borderColor: mindMapTheme.borderSubtle,
                  backgroundColor: mindMapTheme.surface,
                  color: mindMapTheme.textSecondary,
                }}
              >
                {availableGroups.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      ) : (
        <div
          className="flex flex-wrap items-center gap-2 border-b px-4 py-3"
          style={{ borderColor: mindMapTheme.borderSubtle, backgroundColor: mindMapTheme.surface }}
        >
          <button
            onClick={() => handleAddChild()}
            disabled={!selectedNodeId}
            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: mindMapTheme.accent }}
            title="Ctrl+N"
          >
            <Plus size={14} />
            <span>Add</span>
          </button>

          <button
            onClick={reflowLayout}
            className="rounded-lg px-3 py-1.5 text-xs font-medium transition"
            style={{ backgroundColor: mindMapTheme.surfaceMuted, color: mindMapTheme.textSecondary }}
            title="Arrange nodes"
          >
            Arrange
          </button>
          <button onClick={undo} disabled={!canUndo} className="rounded-lg p-1.5 text-xs disabled:opacity-35" title="Undo (Cmd/Ctrl+Z)"><Undo2 size={14} /></button>
          <button onClick={redo} disabled={!canRedo} className="rounded-lg p-1.5 text-xs disabled:opacity-35" title="Redo (Cmd/Ctrl+Shift+Z)"><Redo2 size={14} /></button>

          {selectedNodeId && detailsOpen && (
            <div className="flex items-center gap-1">
              <div className="flex flex-wrap gap-1">
                {nodeColors.map((color, idx) => (
                  <button
                    key={color}
                    onClick={() => handleChangeNodeColor(selectedNodeId, color)}
                    className="h-5 w-5 rounded border-2 transition hover:shadow-md"
                    style={{
                      backgroundColor: color,
                      borderColor:
                        nodes[selectedNodeId]?.color === color ? mindMapTheme.accent : mindMapTheme.borderSubtle,
                    }}
                    title={nodeColorLabels[idx]}
                  />
                ))}
              </div>
              <select
                value={nodes[selectedNodeId]?.group ?? 'Ungrouped'}
                onChange={(e) => handleAssignGroup(e.target.value)}
                className="ml-2 rounded border px-2 py-1 text-xs"
                style={{
                  borderColor: mindMapTheme.borderSubtle,
                  backgroundColor: mindMapTheme.surface,
                  color: mindMapTheme.textSecondary,
                }}
              >
                {availableGroups.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => setIsSearchOpen((open) => !open)} className="rounded px-2 py-1 text-xs" title="Search nodes"><Search size={14} /></button>
            <button onClick={() => fitNodes(collectBranchIds(selectedNodeId ?? rootId))} className="rounded px-2 py-1 text-xs" title="Fit selection"><Focus size={14} /></button>
            <button onClick={() => fitNodes(Object.keys(nodes))} className="rounded px-2 py-1 text-xs" title="Fit map"><LocateFixed size={14} className="opacity-60" /></button>
            <button onClick={() => setLayoutDirection((direction) => direction === 'balanced' ? 'right' : direction === 'right' ? 'left' : 'balanced')} className="rounded px-2 py-1 text-xs" title="Layout direction"><ChevronsUpDown size={14} /></button>
            <button onClick={() => setViewMode((mode) => mode === 'map' ? 'outline' : 'map')} className="rounded px-2 py-1 text-xs" title="Switch Map / Outline"><ListTree size={14} /></button>
            <button
              onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
            className="rounded px-2 py-1 text-xs font-medium transition"
            style={{ backgroundColor: mindMapTheme.surfaceMuted, color: mindMapTheme.textSecondary }}
            >
              −
            </button>
            <span className="min-w-12 text-center text-xs font-medium" style={{ color: mindMapTheme.textSecondary }}>
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(Math.min(2, zoom + 0.1))}
            className="rounded px-2 py-1 text-xs font-medium transition"
            style={{ backgroundColor: mindMapTheme.surfaceMuted, color: mindMapTheme.textSecondary }}
            >
              +
            </button>

            <div className="relative" ref={menuRef}>
              <button
                onClick={() => {
                  setContextMenu(null);
                  setMenuOpen((s) => !s);
                }}
                className="rounded px-2 py-1 text-xs font-medium transition"
                style={{ backgroundColor: mindMapTheme.surfaceMuted, color: mindMapTheme.textSecondary }}
                aria-expanded={menuOpen}
                aria-haspopup="true"
              >
                ⋯
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 mt-1 w-40 rounded-lg border shadow-lg transition z-10"
                  style={{
                    backgroundColor: mindMapTheme.surface,
                    borderColor: mindMapTheme.borderSubtle,
                    boxShadow: mindMapTheme.shadow,
                  }}
                >
                  <button
                    onClick={resetMindMap}
                    className="w-full text-left px-3 py-2 text-xs first:rounded-t-lg"
                    style={{ color: mindMapTheme.danger }}
                  >
                    Reset mind map
                  </button>
                  <div className="border-t" style={{ borderColor: mindMapTheme.borderSubtle }} />
                  <button
                    onClick={exportAsJSON}
                    className="w-full text-left px-3 py-2 text-xs"
                    style={{ color: mindMapTheme.textSecondary }}
                  >
                    Export as JSON
                  </button>
                  <button
                    onClick={exportAsMarkdown}
                    className="w-full text-left px-3 py-2 text-xs"
                    style={{ color: mindMapTheme.textSecondary }}
                  >
                    Export as Markdown
                  </button>
                  <button
                    onClick={copyAsMarkdown}
                    className="w-full text-left px-3 py-2 text-xs last:rounded-b-lg flex items-center gap-1"
                    style={{ color: mindMapTheme.textSecondary }}
                  >
                    <Copy size={12} />
                    Copy as Markdown
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {toastMessage && (
        <div className="pointer-events-none absolute bottom-16 left-4 z-20">
          <div
            className="text-xs px-3 py-2 rounded shadow-lg"
            style={{
              backgroundColor: mindMapTheme.textPrimary,
              color: mindMapTheme.surface,
              boxShadow: mindMapTheme.shadow,
            }}
          >
            {toastMessage}
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="absolute z-30 w-44 rounded-lg border py-1 shadow-xl"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            backgroundColor: mindMapTheme.surface,
            borderColor: mindMapTheme.borderSubtle,
            boxShadow: mindMapTheme.shadow,
          }}
        >
          {contextMenu.nodeId ? (
            <>
              <button
                onClick={() => handleAddChild(contextMenu.nodeId as string)}
                className="w-full text-left px-3 py-2 text-xs"
                style={{ color: mindMapTheme.textSecondary }}
              >
                Add child
              </button>
              <button
                onClick={() => handleAddSibling(contextMenu.nodeId as string)}
                className="w-full text-left px-3 py-2 text-xs"
                style={{ color: mindMapTheme.textSecondary }}
              >
                Add sibling
              </button>
              <button
                onClick={() => handleDuplicateBranch(contextMenu.nodeId as string)}
                className="w-full text-left px-3 py-2 text-xs"
                style={{ color: mindMapTheme.textSecondary }}
              >
                Duplicate branch
              </button>
              <button
                onClick={() => {
                  const node = nodes[contextMenu.nodeId as string];
                  if (!node) return;
                  setEditingNodeId(node.id);
                  setEditingLabel(node.label);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 text-xs"
                style={{ color: mindMapTheme.textSecondary }}
              >
                Rename
              </button>
              <button
                onClick={() => handleToggleCollapse(contextMenu.nodeId as string)}
                className="w-full text-left px-3 py-2 text-xs"
                style={{ color: mindMapTheme.textSecondary }}
              >
                {nodes[contextMenu.nodeId as string]?.collapsed
                  ? 'Expand branch'
                  : 'Collapse branch'}
              </button>
              <button
                onClick={() => {
                  const nodeId = contextMenu.nodeId as string;
                  setFocusedBranchId((current) => current === nodeId ? null : nodeId);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 text-xs"
                style={{ color: mindMapTheme.textSecondary }}
              >
                <span className="inline-flex items-center gap-2"><Focus size={12} /> {focusedBranchId === contextMenu.nodeId ? 'Exit focus' : 'Focus branch'}</span>
              </button>
              <button
                onClick={() => { setSelectedNodeId(contextMenu.nodeId as string); setDetailsOpen(true); setContextMenu(null); }}
                className="w-full text-left px-3 py-2 text-xs"
                style={{ color: mindMapTheme.textSecondary }}
              >
                Open node details
              </button>
              <div className="my-1 border-t" style={{ borderColor: mindMapTheme.borderSubtle }} />
              <button
                onClick={() => moveNodeUp(contextMenu.nodeId as string)}
                className="w-full text-left px-3 py-2 text-xs"
                style={{ color: mindMapTheme.textSecondary }}
              >
                Move branch up one level
              </button>
              {(contextMenu.nodeId as string) !== rootId && (
                <>
                  <div className="my-1 border-t" style={{ borderColor: mindMapTheme.borderSubtle }} />
                  <button
                    onClick={() => handleDeleteNode(contextMenu.nodeId as string)}
                    className="w-full text-left px-3 py-2 text-xs"
                    style={{ color: mindMapTheme.danger }}
                  >
                    Delete branch
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  handleAddChild(rootId);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 text-xs"
                style={{ color: mindMapTheme.textSecondary }}
              >
                Add root branch
              </button>
              <button
                onClick={() => {
                  reflowLayout();
                  setContextMenu(null);
                  showToast('Layout arranged');
                }}
                className="w-full text-left px-3 py-2 text-xs"
                style={{ color: mindMapTheme.textSecondary }}
              >
                Arrange nodes
              </button>
              <button
                onClick={() => {
                  setZoom(1);
                  setOffsetX(0);
                  setOffsetY(0);
                  setContextMenu(null);
                  showToast('View reset');
                }}
                className="w-full text-left px-3 py-2 text-xs"
                style={{ color: mindMapTheme.textSecondary }}
              >
                Reset view
              </button>
            </>
          )}
        </div>
      )}

      <div
        ref={mapViewportRef}
        className="flex-1 overflow-hidden overscroll-contain"
        style={{ backgroundColor: mindMapTheme.surfaceMuted }}
        onWheelCapture={handleViewportWheelCapture}
      >
        {isSearchOpen && (
          <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-lg border px-2 py-1.5 shadow-sm" style={{ backgroundColor: mindMapTheme.surface, borderColor: mindMapTheme.borderSubtle }}>
            <Search size={13} style={{ color: mindMapTheme.textMuted }} />
            <input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search nodes" className="w-44 bg-transparent text-xs outline-none" style={{ color: mindMapTheme.textPrimary }} />
            <button onClick={() => { setSearchQuery(''); setIsSearchOpen(false); }} className="text-xs" style={{ color: mindMapTheme.textMuted }}>Esc</button>
          </div>
        )}
        {viewMode === 'outline' ? (
          <div className="h-full overflow-auto p-4" onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault();
              const selected = selectedNodeId ?? rootId;
              if (event.shiftKey) moveNodeUp(selected); else if (event.key === 'Tab') handleAddChild(selected); else handleAddSibling(selected);
            }
          }} tabIndex={0}>
            <div className="mb-3 flex items-center gap-2 text-xs" style={{ color: mindMapTheme.textMuted }}><ListTree size={14} /> Outline · same mind map structure</div>
            {renderOutlineNode(rootId)}
          </div>
        ) : <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`0 0 ${sceneWidth} ${sceneHeight}`}
          preserveAspectRatio="xMidYMid meet"
          tabIndex={0}
          onKeyDown={handleCanvasKeyDown}
          className={`w-full h-full outline-none ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{ backgroundColor: mindMapTheme.surfaceMuted, outline: 'none' }}
          onWheel={handleWheel}
          onMouseDown={(e) => {
            if (e.button !== 0) return;

            const target = e.target as Element | null;
            const isBackground =
              target === e.currentTarget ||
              target?.getAttribute('data-mindmap-background') === 'true';

            if (!isBackground) return;

            e.preventDefault();
            setIsPanning(true);
            panStateRef.current = {
              startX: e.clientX,
              startY: e.clientY,
              startOffsetX: offsetX,
              startOffsetY: offsetY,
              moved: false,
            };

            const handleMouseMove = (moveEvent: MouseEvent) => {
              const panState = panStateRef.current;
              if (!panState) return;
              const dx = moveEvent.clientX - panState.startX;
              const dy = moveEvent.clientY - panState.startY;
              if (Math.abs(dx) + Math.abs(dy) > 2) {
                panState.moved = true;
              }
              setOffsetX(panState.startOffsetX + dx);
              setOffsetY(panState.startOffsetY + dy);
            };

            const handleMouseUp = (upEvent: MouseEvent) => {
              const panState = panStateRef.current;
              panStateRef.current = null;
              setIsPanning(false);
              document.removeEventListener('mousemove', handleMouseMove);
              document.removeEventListener('mouseup', handleMouseUp);

              if (!panState?.moved && upEvent.button === 0) {
                setSelectedNodeId(rootId);
              }
            };

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            const rect = containerRef.current?.getBoundingClientRect();
            const target = e.target as Element | null;
            const isBackground =
              target === e.currentTarget ||
              target?.getAttribute('data-mindmap-background') === 'true';
            if (!isBackground) return;
            setMenuOpen(false);
            setContextMenu({
              x: rect ? e.clientX - rect.left : e.clientX,
              y: rect ? e.clientY - rect.top : e.clientY,
              nodeId: null,
            });
          }}
        >
          <defs>
            <pattern
              id="mindmap-grid"
              width={isTiny ? '24' : '28'}
              height={isTiny ? '24' : '28'}
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 28 0 L 0 0 0 28"
                fill="none"
                stroke={mindMapTheme.borderSubtle}
                strokeWidth="1"
              />
            </pattern>
          </defs>
          <rect
            data-mindmap-background="true"
            width="100%"
            height="100%"
            fill="url(#mindmap-grid)"
          />
          {renderNode(rootId)}
        </svg>}
      </div>

      {focusedBranchId && (
        <button onClick={() => setFocusedBranchId(null)} className="absolute bottom-12 left-1/2 z-20 -translate-x-1/2 rounded-full border px-3 py-1.5 text-xs shadow-sm" style={{ backgroundColor: mindMapTheme.surface, borderColor: mindMapTheme.borderSubtle, color: mindMapTheme.textSecondary }}>
          Exit focus
        </button>
      )}

      {detailsOpen && selectedNodeId && nodes[selectedNodeId] && (
        <aside className="absolute right-3 top-16 z-20 w-64 rounded-xl border p-3 shadow-lg" style={{ backgroundColor: mindMapTheme.surface, borderColor: mindMapTheme.borderSubtle, boxShadow: mindMapTheme.shadow }}>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold" style={{ color: mindMapTheme.textPrimary }}>Node details</span>
            <button onClick={() => setDetailsOpen(false)} className="text-xs" style={{ color: mindMapTheme.textMuted }}>Close</button>
          </div>
          <label className="mb-3 block text-[11px]" style={{ color: mindMapTheme.textMuted }}>
            Title
            <input value={nodes[selectedNodeId].label} onChange={(event) => updateStructure({ ...nodes, [selectedNodeId]: { ...nodes[selectedNodeId], label: event.target.value } })} className="mt-1 w-full rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none" style={{ borderColor: mindMapTheme.borderSubtle, color: mindMapTheme.textPrimary }} />
          </label>
          <label className="mb-3 block text-[11px]" style={{ color: mindMapTheme.textMuted }}>
            Supporting notes
            <textarea value={nodes[selectedNodeId].detail ?? ''} onChange={(event) => updateStructure({ ...nodes, [selectedNodeId]: { ...nodes[selectedNodeId], detail: event.target.value } })} rows={4} className="mt-1 w-full resize-none rounded-md border bg-transparent px-2 py-1.5 text-xs outline-none" style={{ borderColor: mindMapTheme.borderSubtle, color: mindMapTheme.textPrimary }} />
          </label>
          <label className="flex items-center gap-2 text-xs" style={{ color: mindMapTheme.textSecondary }}>
            <input type="checkbox" checked={Boolean(nodes[selectedNodeId].completed)} onChange={(event) => updateStructure({ ...nodes, [selectedNodeId]: { ...nodes[selectedNodeId], completed: event.target.checked } })} />
            Completed
          </label>
        </aside>
      )}

    </div>
  );
};
