import { Plus, Trash2, Copy, Maximize2, Minimize2 } from 'lucide-react'
import { useState, useCallback, useMemo, useEffect, useRef } from 'react'

type MindMapNode = {
  id: string
  label: string
  children: string[]
  x: number
  y: number
  collapsed?: boolean
  color?: string
  group?: string
}

type MindMapStructure = {
  nodes: Record<string, MindMapNode>
  rootId: string
}

interface MindMapEditorProps {
  structure: unknown
  onChange: (structure: MindMapStructure) => void
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
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
}

export const MindMapEditor: React.FC<MindMapEditorProps> = ({ structure, onChange, isFullscreen, onToggleFullscreen }) => {
  const initialStructure = useMemo(() => {
    if (structure && typeof structure === 'object' && 'nodes' in structure) {
      return structure as MindMapStructure
    }
    return defaultStructure
  }, [])

  const [nodes, setNodes] = useState<Record<string, MindMapNode>>(initialStructure.nodes)
  const [rootId] = useState(initialStructure.rootId)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')
  const [zoom, setZoom] = useState(1)
  const [offsetX, setOffsetX] = useState(0)
  const [offsetY, setOffsetY] = useState(0)
  const [isPanning, setIsPanning] = useState(false)
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string | null } | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapViewportRef = useRef<HTMLDivElement | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const panStateRef = useRef<{
    startX: number
    startY: number
    startOffsetX: number
    startOffsetY: number
    moved: boolean
  } | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const sceneWidth = viewportSize.width > 0 ? viewportSize.width : 800
  const sceneHeight = viewportSize.height > 0 ? viewportSize.height : 500
  const isTiny = sceneWidth > 0 && sceneWidth < 560
  const isCompact = sceneWidth > 0 && sceneWidth < 760
  const centerX = sceneWidth / 2
  const centerY = sceneHeight / 2

  useEffect(() => {
    const element = mapViewportRef.current
    if (!element) return

    const updateViewportSize = () => setViewportSize({ width: element.clientWidth, height: element.clientHeight })
    updateViewportSize()

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(() => updateViewportSize())
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  const updateStructure = useCallback(
    (newNodes: typeof nodes) => {
      setNodes(newNodes)
      onChange({ nodes: newNodes, rootId })
    },
    [rootId, onChange]
  )

  const layoutMindMap = (sourceNodes: Record<string, MindMapNode>) => {
    const nextNodes: Record<string, MindMapNode> = { ...sourceNodes }
    const subtreeSizes = new Map<string, number>()
    const visited = new Set<string>()

    const countSubtree = (nodeId: string): number => {
      if (subtreeSizes.has(nodeId)) return subtreeSizes.get(nodeId) as number
      if (visited.has(nodeId)) return 1

      visited.add(nodeId)
      const node = sourceNodes[nodeId]
      if (!node || node.collapsed || node.children.length === 0) {
        subtreeSizes.set(nodeId, 1)
        visited.delete(nodeId)
        return 1
      }

      const size = node.children.reduce((total, childId) => total + countSubtree(childId), 0)
      const nextSize = Math.max(1, size)
      subtreeSizes.set(nodeId, nextSize)
      visited.delete(nodeId)
      return nextSize
    }

    countSubtree(rootId)

    const setPosition = (nodeId: string, depth: number, angle: number, span: number) => {
      const node = sourceNodes[nodeId]
      if (!node) return

      const baseRadius = isTiny ? 74 : isCompact ? 92 : 112
      const ringGap = isTiny ? 58 : isCompact ? 76 : 92
      const radius = depth === 0 ? 0 : baseRadius + (depth - 1) * ringGap
      nextNodes[nodeId] = {
        ...nextNodes[nodeId],
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      }

      if (node.collapsed || node.children.length === 0) return

      const children = node.children.filter((childId) => sourceNodes[childId])
      if (children.length === 0) return

      const totalWeight = children.reduce((sum, childId) => sum + (subtreeSizes.get(childId) ?? 1), 0)
      const childSpan = Math.max(Math.PI / 10, span * 0.82)
      const start = angle - childSpan / 2
      const branchSeed = nodeId.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
      const chainDirection = branchSeed % 2 === 0 ? 1 : -1
      const chainBend = Math.min(Math.PI * 0.82, 0.5 + depth * 0.16)

      let cursor = start
      children.forEach((childId) => {
        const childWeight = subtreeSizes.get(childId) ?? 1
        const share = childSpan * (childWeight / totalWeight)
        const rawAngle = cursor + share / 2
        const childAngle =
          children.length === 1
            ? angle + chainDirection * chainBend
            : rawAngle + (childWeight === 1 ? chainDirection * 0.08 : chainDirection * 0.03)
        setPosition(childId, depth + 1, childAngle, share)
        cursor += share
      })
    }

    setPosition(rootId, 0, -Math.PI / 2, Math.PI * 2)

    const fitPadding = isTiny ? 70 : isCompact ? 88 : 110
    const maxRadius = Math.max(80, Math.min(sceneWidth, sceneHeight) / 2 - fitPadding)
    const currentMax = Math.max(...Object.values(nextNodes).map((node) => Math.hypot(node.x, node.y)), 1)
    const scale = Math.min(1, maxRadius / currentMax)

    if (scale < 1) {
      Object.keys(nextNodes).forEach((nodeId) => {
        nextNodes[nodeId] = {
          ...nextNodes[nodeId],
          x: nextNodes[nodeId].x * scale,
          y: nextNodes[nodeId].y * scale,
        }
      })
    }

    return nextNodes
  }

  const reflowLayout = useCallback(() => {
    updateStructure(layoutMindMap(nodes))
  }, [layoutMindMap, nodes, updateStructure])

  const handleAddChild = useCallback((nodeId?: string) => {
    const parentId = nodeId ?? selectedNodeId
    if (!parentId) return

      const newNodeId = `node-${Date.now()}`
      const parent = nodes[parentId]
      if (!parent) return

    const angleOptions = [0, -Math.PI / 4, Math.PI / 4, Math.PI / 2, -Math.PI / 2, (3 * Math.PI) / 4, (-3 * Math.PI) / 4, Math.PI]
    const angle = angleOptions[parent.children.length % angleOptions.length]
    const distance = Math.max(120, Math.min(sceneWidth, sceneHeight) * (parentId === rootId ? 0.26 : 0.2))
    const newNode: MindMapNode = {
      id: newNodeId,
      label: 'New Idea',
      children: [],
      x: parent.x + Math.cos(angle) * distance,
      y: parent.y + Math.sin(angle) * distance,
      group: parent.group,
    }

    const updatedParent = { ...parent, children: [...parent.children, newNodeId] }
    // Preserve any manual positions the user has set; do not reflow automatically.
    const nextNodes = { ...nodes, [newNodeId]: newNode, [parentId]: updatedParent }
    updateStructure(nextNodes)
    setSelectedNodeId(newNodeId)
  }, [selectedNodeId, nodes, rootId, updateStructure, sceneWidth, sceneHeight])

  const handleAddSibling = useCallback(
    (nodeId?: string) => {
      const targetId = nodeId ?? selectedNodeId
      if (!targetId || targetId === rootId) return

      const sibling = nodes[targetId]
      if (!sibling) return
      const parentId = getParentId(targetId)
      if (!parentId) return
      const parent = nodes[parentId]
      if (!parent) return

      const newNodeId = `node-${Date.now()}`
      const siblingIndex = parent.children.indexOf(targetId)
      const spacing = Math.max(72, Math.min(sceneWidth, sceneHeight) * 0.14)
      const newNode: MindMapNode = {
        id: newNodeId,
        label: 'New Sibling',
        children: [],
        x: sibling.x + spacing,
        y: sibling.y,
        group: sibling.group ?? parent.group,
      }

      const nextChildren = [...parent.children]
      nextChildren.splice(Math.max(0, siblingIndex + 1), 0, newNodeId)
      const nextNodes = {
        ...nodes,
        [newNodeId]: newNode,
        [parentId]: { ...parent, children: nextChildren },
      }
      updateStructure(nextNodes)
      setSelectedNodeId(newNodeId)
      setContextMenu(null)
      showToast('Sibling added')
    },
    [selectedNodeId, rootId, nodes, getParentId, updateStructure, showToast, sceneWidth, sceneHeight]
  )

  const handleDuplicateBranch = useCallback(
    (nodeId?: string) => {
      const targetId = nodeId ?? selectedNodeId
      if (!targetId) return
      const sourceRoot = nodes[targetId]
      if (!sourceRoot) return

      const parentId = getParentId(targetId)
      if (!parentId) return
      const parent = nodes[parentId]
      if (!parent) return

      const idMap = new Map<string, string>()
      const cloneSubtree = (sourceId: string): MindMapNode | null => {
        const source = nodes[sourceId]
        if (!source) return null
        const clonedId = `${sourceId}-copy-${Date.now()}-${Math.floor(Math.random() * 1000)}`
        idMap.set(sourceId, clonedId)
        const clonedChildren = source.children
          .map((childId) => cloneSubtree(childId))
          .filter((child): child is MindMapNode => child !== null)
          .map((child) => child.id)

        return {
          ...source,
          id: clonedId,
          label: `${source.label} copy`,
          children: clonedChildren,
          x: source.x + 96,
          y: source.y + 36,
        }
      }

      const collected: Record<string, MindMapNode> = {}
      const collectClones = (sourceId: string) => {
        const source = nodes[sourceId]
        const clonedId = idMap.get(sourceId)
        if (!source || !clonedId) return
        collected[clonedId] = {
          ...source,
          id: clonedId,
          label: sourceId === targetId ? `${source.label} copy` : source.label,
          children: source.children
            .map((childId) => idMap.get(childId))
            .filter((id): id is string => Boolean(id)),
          x: source.x + 96,
          y: source.y + 36,
        }
        source.children.forEach((childId) => collectClones(childId))
      }

      const cloneRoot = cloneSubtree(targetId)
      if (!cloneRoot) return
      collectClones(targetId)

      const nextChildren = [...parent.children]
      const targetIndex = nextChildren.indexOf(targetId)
      nextChildren.splice(Math.max(0, targetIndex + 1), 0, cloneRoot.id)

      const nextNodes = {
        ...nodes,
        ...collected,
        [parentId]: {
          ...parent,
          children: nextChildren,
        },
      }

      updateStructure(nextNodes)
      setSelectedNodeId(cloneRoot.id)
      setContextMenu(null)
      showToast('Branch duplicated')
    },
    [selectedNodeId, nodes, getParentId, updateStructure, showToast]
  )

  const handleAssignGroup = useCallback(
    (group: string, nodeId?: string) => {
      const targetId = nodeId ?? selectedNodeId
      if (!targetId) return
      const node = nodes[targetId]
      if (!node) return
      updateStructure({ ...nodes, [targetId]: { ...node, group } })
      setContextMenu(null)
      showToast(`Moved to ${group}`)
    },
    [selectedNodeId, nodes, updateStructure, showToast]
  )

  const handleDeleteNode = useCallback((nodeId?: string) => {
    const targetId = nodeId ?? selectedNodeId
    if (!targetId || targetId === rootId) return

    // Collect the subtree of node IDs to remove (selected node + all descendants)
    const idsToRemove = new Set<string>()
    const stack = [targetId]
    while (stack.length) {
      const id = stack.pop() as string
      if (idsToRemove.has(id)) continue
      idsToRemove.add(id)
      const node = nodes[id]
      if (!node) continue
      node.children.forEach((c) => stack.push(c))
    }

    const updatedNodes: Record<string, MindMapNode> = {}
    Object.keys(nodes).forEach((nodeId) => {
      if (idsToRemove.has(nodeId)) return
      const node = nodes[nodeId]
      // remove references to deleted ids from children
      const children = node.children.filter((childId) => !idsToRemove.has(childId))
      updatedNodes[nodeId] = { ...node, children }
    })

    updateStructure(updatedNodes)
    setSelectedNodeId(null)
    setContextMenu(null)
    showToast('Node deleted')
  }, [selectedNodeId, rootId, nodes, updateStructure, showToast])

  const handleRenameNode = useCallback(
    (nodeId: string, newLabel: string) => {
      if (!newLabel.trim()) return
      const node = nodes[nodeId]
      if (!node) return
      updateStructure({ ...nodes, [nodeId]: { ...node, label: newLabel.trim() } })
      setEditingNodeId(null)
    },
    [nodes, updateStructure]
  )

  const handleToggleCollapse = useCallback(
    (nodeId: string) => {
      const node = nodes[nodeId]
      if (!node) return
      updateStructure({ ...nodes, [nodeId]: { ...node, collapsed: !node.collapsed } })
    },
    [nodes, updateStructure]
  )

  const handleNodeDrag = useCallback(
    (nodeId: string, dx: number, dy: number) => {
      const node = nodes[nodeId]
      if (!node) return
      updateStructure({ ...nodes, [nodeId]: { ...node, x: node.x + dx, y: node.y + dy } })
    },
    [nodes, updateStructure]
  )

  const handleChangeNodeColor = useCallback(
    (nodeId: string, color: string) => {
      const node = nodes[nodeId]
      if (!node) return
      updateStructure({ ...nodes, [nodeId]: { ...node, color } })
    },
    [nodes, updateStructure]
  )

  const clampZoom = useCallback((value: number) => Math.min(2.5, Math.max(0.5, value)), [])

  const zoomAtPoint = useCallback(
    (clientX: number, clientY: number, nextZoom: number) => {
      const svgElement = svgRef.current
      if (!svgElement) return
      const rect = svgElement.getBoundingClientRect()
      const pointerX = clientX - rect.left
      const pointerY = clientY - rect.top
      const worldX = (pointerX - centerX - offsetX) / zoom
      const worldY = (pointerY - centerY - offsetY) / zoom
      setZoom(nextZoom)
      setOffsetX(pointerX - centerX - worldX * nextZoom)
      setOffsetY(pointerY - centerY - worldY * nextZoom)
    },
    [centerX, centerY, offsetX, offsetY, zoom]
  )

  const handleWheel = useCallback(
    (event: React.WheelEvent<SVGSVGElement>) => {
      event.preventDefault()
      if (event.metaKey || event.ctrlKey) {
        const zoomDelta = Math.exp(-event.deltaY * 0.0012)
        zoomAtPoint(event.clientX, event.clientY, clampZoom(zoom * zoomDelta))
        return
      }

      setOffsetX((current) => current - event.deltaX)
      setOffsetY((current) => current - event.deltaY)
    },
    [clampZoom, zoom, zoomAtPoint]
  )

  const handleViewportWheelCapture = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    // Keep wheel interactions scoped to the mind map viewport so parent panes don't scroll.
    event.preventDefault()
    event.stopPropagation()
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedNodeId) return

      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault()
        handleAddChild()
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        handleDeleteNode()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedNodeId, handleAddChild, handleDeleteNode])

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      if (!draggingNodeId) return
      const node = nodes[draggingNodeId]
      if (!node) return

      const layoutScale = zoom
      const dx = event.movementX / layoutScale
      const dy = event.movementY / layoutScale
      handleNodeDrag(draggingNodeId, dx, dy)
    }

    const handleUp = () => {
      setDraggingNodeId(null)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)

    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
    }
  }, [draggingNodeId, handleNodeDrag, nodes, zoom])

  const nodeColors = ['#f3f4f6', '#fef3c7', '#dbeafe', '#ede9fe', '#fecaca', '#dcfce7']
  const nodeColorLabels = ['Gray', 'Yellow', 'Blue', 'Purple', 'Red', 'Green']
  const availableGroups = ['Ungrouped', 'Work', 'Personal', 'Ideas', 'Planning']

  function showToast(message: string) {
    setToastMessage(message)
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToastMessage(null), 2000)
  }

  function getParentId(targetNodeId: string): string | null {
    for (const nodeId of Object.keys(nodes)) {
      if (nodes[nodeId].children.includes(targetNodeId)) return nodeId
    }
    return null
  }

  const exportAsJSON = () => {
    const json = JSON.stringify({ nodes, rootId }, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `mindmap-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    setMenuOpen(false)
    setToastMessage('Exported JSON')
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToastMessage(null), 2000)
  }

  const exportAsMarkdown = () => {
    const renderNodeAsMarkdown = (nodeId: string, indent: number = 0): string => {
      const node = nodes[nodeId]
      if (!node) return ''
      const prefix = '  '.repeat(indent)
      const lines = [`${prefix}• ${node.label}`]
      node.children.forEach((childId) => {
        lines.push(renderNodeAsMarkdown(childId, indent + 1))
      })
      return lines.join('\n')
    }

    const markdown = renderNodeAsMarkdown(rootId)
    const blob = new Blob([markdown], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `mindmap-${Date.now()}.md`
    a.click()
    URL.revokeObjectURL(url)
    setMenuOpen(false)
    setToastMessage('Exported Markdown')
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToastMessage(null), 2000)
  }

  const copyAsMarkdown = async () => {
    const renderNodeAsMarkdown = (nodeId: string, indent: number = 0): string => {
      const node = nodes[nodeId]
      if (!node) return ''
      const prefix = '  '.repeat(indent)
      const lines = [`${prefix}• ${node.label}`]
      node.children.forEach((childId) => {
        lines.push(renderNodeAsMarkdown(childId, indent + 1))
      })
      return lines.join('\n')
    }

    const markdown = renderNodeAsMarkdown(rootId)
    try {
      await navigator.clipboard.writeText(markdown)
      setMenuOpen(false)
      setToastMessage('Copied Markdown to clipboard')
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
      toastTimerRef.current = window.setTimeout(() => setToastMessage(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
      setToastMessage('Failed to copy')
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
      toastTimerRef.current = window.setTimeout(() => setToastMessage(null), 2000)
    }
  }

  const resetMindMap = useCallback(() => {
    const newRoot: MindMapNode = {
      id: rootId,
      label: 'Central Idea',
      children: [],
      x: 0,
      y: 0,
    }
    const newNodes: Record<string, MindMapNode> = { [rootId]: newRoot }
    updateStructure(newNodes)
    setSelectedNodeId(rootId)
    setMenuOpen(false)
    showToast('Mind map reset')
  }, [rootId, updateStructure, showToast])

  const canToggleFullscreen = typeof onToggleFullscreen === 'function'

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node
      const clickInToolbarMenu = menuRef.current?.contains(target)
      const clickInContextMenu = contextMenuRef.current?.contains(target)
      if (clickInToolbarMenu || clickInContextMenu) return
      setMenuOpen(false)
      setContextMenu(null)
    }
    if (menuOpen || contextMenu) window.addEventListener('mousedown', handleOutsideClick)
    return () => window.removeEventListener('mousedown', handleOutsideClick)
  }, [menuOpen, contextMenu])

  const renderNode = (nodeId: string, parentX?: number, parentY?: number): React.ReactNode => {
    const node = nodes[nodeId]
    if (!node) return null

    const displayX = centerX + node.x * zoom + offsetX
    const displayY = centerY + node.y * zoom + offsetY
    const isSelected = selectedNodeId === nodeId
    const isEditing = editingNodeId === nodeId
    const isRoot = nodeId === rootId
    const nodeWidth = Math.max(
      isRoot ? 120 : isTiny ? 96 : 104,
      Math.min(isTiny ? 144 : 162, 42 + node.label.length * (isTiny ? 5 : 6))
    )
    const nodeHeight = isRoot ? 54 : isTiny ? 42 : 46
    const fill = isSelected ? '#FF5F40' : node.color || (isRoot ? '#fff4ef' : '#ffffff')
    const stroke = isSelected ? '#ea5336' : isRoot ? '#ffc8bc' : '#d1d5db'

    return (
      <g key={nodeId}>
        {parentX !== undefined && parentY !== undefined && (
          <line
            x1={parentX}
            y1={parentY}
            x2={displayX}
            y2={displayY}
            stroke={isRoot ? '#ffc8bc' : '#d1d5db'}
            strokeWidth="2"
            strokeLinecap="round"
            pointerEvents="none"
          />
        )}

        {!node.collapsed && node.children.map((childId) => renderNode(childId, displayX, displayY))}

        <g
          transform={`translate(${displayX}, ${displayY})`}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const rect = containerRef.current?.getBoundingClientRect()
            setSelectedNodeId(nodeId)
            setMenuOpen(false)
            setContextMenu({
              x: rect ? e.clientX - rect.left : e.clientX,
              y: rect ? e.clientY - rect.top : e.clientY,
              nodeId,
            })
          }}
          onPointerDown={(e) => {
            e.stopPropagation()
            if (e.button !== 0) return
            setSelectedNodeId(nodeId)
            setDraggingNodeId(nodeId)
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            setEditingNodeId(nodeId)
            setEditingLabel(node.label)
          }}
          style={{ cursor: draggingNodeId === nodeId ? 'grabbing' : 'grab' }}
        >
          <rect
            x={-nodeWidth / 2}
            y={-nodeHeight / 2}
            width={nodeWidth}
            height={nodeHeight}
            rx="18"
            fill={fill}
            stroke={stroke}
            strokeWidth="2"
          />
          <circle
            cx={-nodeWidth / 2 + 12}
            cy={0}
            r="4"
            fill={isSelected ? 'white' : isRoot ? '#FF5F40' : '#FFBB3F'}
            opacity={isSelected ? 0.95 : 1}
          />
          <text
            x={isRoot ? 0 : -nodeWidth / 2 + 32}
            y={4}
            fontSize={isRoot ? '13' : '12'}
            fontWeight="600"
            textAnchor={isRoot ? 'middle' : 'start'}
            fill={isSelected ? 'white' : '#1f2937'}
            style={{ userSelect: 'none', pointerEvents: 'none' }}
          >
            {isRoot
              ? node.label.length > 18
                ? `${node.label.slice(0, 18)}…`
                : node.label
              : node.label.length > 28
              ? `${node.label.slice(0, 28)}…`
              : node.label}
          </text>
        </g>

        {node.children.length > 0 && (
          <g
            onClick={() => handleToggleCollapse(nodeId)}
            style={{ cursor: 'pointer' }}
          >
            <rect
              x={displayX - 8}
              y={displayY + nodeHeight / 2 + 4}
              width="16"
              height="16"
              fill="white"
              stroke="#d1d5db"
              strokeWidth="1"
              rx="2"
            />
            <text
              x={displayX}
              y={displayY + nodeHeight / 2 + 17}
              fontSize="10"
              fontWeight="bold"
              textAnchor="middle"
              fill="#6b7280"
            >
              {node.collapsed ? '+' : '−'}
            </text>
          </g>
        )}

        {isEditing && (
          <foreignObject x={displayX - 40} y={displayY - 12} width="80" height="24">
            <input
              autoFocus
              type="text"
              value={editingLabel}
              onChange={(e) => setEditingLabel(e.target.value)}
              onBlur={() => handleRenameNode(nodeId, editingLabel)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameNode(nodeId, editingLabel)
                if (e.key === 'Escape') setEditingNodeId(null)
              }}
              className="w-full text-xs text-center bg-white border border-gray-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
          </foreignObject>
        )}
      </g>
    )
  }

  return (
    <div ref={containerRef} className="relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
      {isCompact ? (
        <div className="border-b border-gray-200 bg-white px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <button
                onClick={() => handleAddChild()}
                disabled={!selectedNodeId}
                className="flex items-center gap-1 rounded-lg bg-[#FF5F40] px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-[#ea5336] disabled:cursor-not-allowed disabled:opacity-50"
                title="Ctrl+N"
              >
                <Plus size={14} />
                <span>Add</span>
              </button>
              <button
                onClick={() => handleDeleteNode()}
                disabled={!selectedNodeId || selectedNodeId === rootId}
                className="flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
              <button
                onClick={reflowLayout}
                className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-200"
                title="Arrange nodes"
              >
                Arrange
              </button>
            </div>

            <div className="ml-auto flex items-center gap-1 shrink-0">
              <button
                onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
                className="h-8 w-8 rounded bg-gray-100 text-xs font-medium text-gray-700 hover:bg-gray-200"
              >
                −
              </button>
              <span className="w-11 text-center text-xs font-medium text-gray-600">{Math.round(zoom * 100)}%</span>
              <button
                onClick={() => setZoom(Math.min(2, zoom + 0.1))}
                className="h-8 w-8 rounded bg-gray-100 text-xs font-medium text-gray-700 hover:bg-gray-200"
              >
                +
              </button>
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => {
                    setContextMenu(null)
                    setMenuOpen((s) => !s)
                  }}
                  className="h-8 w-8 rounded bg-gray-100 text-xs font-medium text-gray-700 hover:bg-gray-200"
                  aria-expanded={menuOpen}
                  aria-haspopup="true"
                >
                  ⋯
                </button>
                {menuOpen && (
                  <div className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg transition z-10">
                    {canToggleFullscreen && (
                      <>
                        <button
                          onClick={() => {
                            onToggleFullscreen?.()
                            setMenuOpen(false)
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-gray-50 first:rounded-t-lg"
                        >
                          {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                          {isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                        </button>
                        <div className="border-t border-gray-100" />
                      </>
                    )}
                    <button
                      onClick={resetMindMap}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 first:rounded-t-lg text-red-600"
                    >
                      Reset mind map
                    </button>
                    <div className="border-t border-gray-100" />
                    <button
                      onClick={exportAsJSON}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50"
                    >
                      Export as JSON
                    </button>
                    <button
                      onClick={exportAsMarkdown}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50"
                    >
                      Export as Markdown
                    </button>
                    <button
                      onClick={copyAsMarkdown}
                      className="last:rounded-b-lg flex w-full items-center gap-1 px-3 py-2 text-left text-xs hover:bg-gray-50"
                    >
                      <Copy size={12} />
                      Copy as Markdown
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {selectedNodeId && (
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
                        nodes[selectedNodeId]?.color === color ? '#FF5F40' : '#d1d5db',
                    }}
                    title={nodeColorLabels[idx]}
                  />
                ))}
              </div>
              <select
                value={nodes[selectedNodeId]?.group ?? 'Ungrouped'}
                onChange={(e) => handleAssignGroup(e.target.value)}
                className="min-w-0 flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
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
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-4 py-3">
          <button
            onClick={() => handleAddChild()}
            disabled={!selectedNodeId}
            className="flex items-center gap-1 rounded-lg bg-[#FF5F40] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#ea5336] disabled:cursor-not-allowed disabled:opacity-50"
            title="Ctrl+N"
          >
            <Plus size={14} />
            <span>Add</span>
          </button>
          <button
            onClick={() => handleDeleteNode()}
            disabled={!selectedNodeId || selectedNodeId === rootId}
            className="flex items-center gap-1 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>

          <button
            onClick={reflowLayout}
            className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-200"
            title="Arrange nodes"
          >
            Arrange
          </button>

          {selectedNodeId && (
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
                        nodes[selectedNodeId]?.color === color ? '#FF5F40' : '#d1d5db',
                    }}
                    title={nodeColorLabels[idx]}
                  />
                ))}
              </div>
              <select
                value={nodes[selectedNodeId]?.group ?? 'Ungrouped'}
                onChange={(e) => handleAssignGroup(e.target.value)}
                className="ml-2 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
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
            <button
              onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
              className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200"
            >
              −
            </button>
            <span className="min-w-12 text-center text-xs font-medium text-gray-600">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoom(Math.min(2, zoom + 0.1))}
              className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200"
            >
              +
            </button>

            <div className="relative" ref={menuRef}>
              <button
                onClick={() => {
                  setContextMenu(null)
                  setMenuOpen((s) => !s)
                }}
                className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200"
                aria-expanded={menuOpen}
                aria-haspopup="true"
              >
                ⋯
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg transition z-10">
                  <button
                    onClick={resetMindMap}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 first:rounded-t-lg text-red-600"
                  >
                    Reset mind map
                  </button>
                  <div className="border-t border-gray-100" />
                  <button
                    onClick={exportAsJSON}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50"
                  >
                    Export as JSON
                  </button>
                  <button
                    onClick={exportAsMarkdown}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50"
                  >
                    Export as Markdown
                  </button>
                  <button
                    onClick={copyAsMarkdown}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 last:rounded-b-lg flex items-center gap-1"
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
          <div className="bg-black text-white text-xs px-3 py-2 rounded shadow-lg">{toastMessage}</div>
        </div>
      )}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="absolute z-30 w-44 bg-white border border-gray-200 rounded-lg shadow-xl py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.nodeId ? (
            <>
              <button
                onClick={() => handleAddChild(contextMenu.nodeId as string)}
                className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50"
              >
                Add child
              </button>
              <button
                onClick={() => handleAddSibling(contextMenu.nodeId as string)}
                className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50"
              >
                Add sibling
              </button>
              <button
                onClick={() => handleDuplicateBranch(contextMenu.nodeId as string)}
                className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50"
              >
                Duplicate branch
              </button>
              <button
                onClick={() => {
                  const node = nodes[contextMenu.nodeId as string]
                  if (!node) return
                  setEditingNodeId(node.id)
                  setEditingLabel(node.label)
                  setContextMenu(null)
                }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50"
              >
                Rename
              </button>
              <button
                onClick={() => handleToggleCollapse(contextMenu.nodeId as string)}
                className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50"
              >
                {nodes[contextMenu.nodeId as string]?.collapsed ? 'Expand branch' : 'Collapse branch'}
              </button>
              <div className="my-1 border-t border-gray-100" />
              {availableGroups.map((group) => (
                <button
                  key={group}
                  onClick={() => handleAssignGroup(group, contextMenu.nodeId as string)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50"
                >
                  Move to {group}
                </button>
              ))}
              {(contextMenu.nodeId as string) !== rootId && (
                <>
                  <div className="my-1 border-t border-gray-100" />
                  <button
                    onClick={() => handleDeleteNode(contextMenu.nodeId as string)}
                    className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50"
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
                  handleAddChild(rootId)
                  setContextMenu(null)
                }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50"
              >
                Add root branch
              </button>
              <button
                onClick={() => {
                  reflowLayout()
                  setContextMenu(null)
                  showToast('Layout arranged')
                }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50"
              >
                Arrange nodes
              </button>
              <button
                onClick={() => {
                  setZoom(1)
                  setOffsetX(0)
                  setOffsetY(0)
                  setContextMenu(null)
                  showToast('View reset')
                }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50"
              >
                Reset view
              </button>
            </>
          )}
        </div>
      )}

      <div
        ref={mapViewportRef}
        className="flex-1 overflow-hidden bg-white overscroll-contain"
        onWheelCapture={handleViewportWheelCapture}
      >
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`0 0 ${sceneWidth} ${sceneHeight}`}
          preserveAspectRatio="xMidYMid meet"
          className={`w-full h-full bg-white ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
          onWheel={handleWheel}
          onMouseDown={(e) => {
            if (e.button !== 0) return

            const target = e.target as Element | null
            const isBackground =
              target === e.currentTarget || target?.getAttribute('data-mindmap-background') === 'true'

            if (!isBackground) return

            e.preventDefault()
            setIsPanning(true)
            panStateRef.current = {
              startX: e.clientX,
              startY: e.clientY,
              startOffsetX: offsetX,
              startOffsetY: offsetY,
              moved: false,
            }

            const handleMouseMove = (moveEvent: MouseEvent) => {
              const panState = panStateRef.current
              if (!panState) return
              const dx = moveEvent.clientX - panState.startX
              const dy = moveEvent.clientY - panState.startY
              if (Math.abs(dx) + Math.abs(dy) > 2) {
                panState.moved = true
              }
              setOffsetX(panState.startOffsetX + dx)
              setOffsetY(panState.startOffsetY + dy)
            }

            const handleMouseUp = (upEvent: MouseEvent) => {
              const panState = panStateRef.current
              panStateRef.current = null
              setIsPanning(false)
              document.removeEventListener('mousemove', handleMouseMove)
              document.removeEventListener('mouseup', handleMouseUp)

              if (!panState?.moved && upEvent.button === 0) {
                setSelectedNodeId(rootId)
              }
            }

            document.addEventListener('mousemove', handleMouseMove)
            document.addEventListener('mouseup', handleMouseUp)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            const rect = containerRef.current?.getBoundingClientRect()
            const target = e.target as Element | null
            const isBackground =
              target === e.currentTarget || target?.getAttribute('data-mindmap-background') === 'true'
            if (!isBackground) return
            setMenuOpen(false)
            setContextMenu({
              x: rect ? e.clientX - rect.left : e.clientX,
              y: rect ? e.clientY - rect.top : e.clientY,
              nodeId: null,
            })
          }}
        >
          <defs>
            <pattern id="mindmap-grid" width={isTiny ? '24' : '28'} height={isTiny ? '24' : '28'} patternUnits="userSpaceOnUse">
              <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#eef2f7" strokeWidth="1" />
            </pattern>
          </defs>
          <rect data-mindmap-background="true" width="100%" height="100%" fill="url(#mindmap-grid)" />
          {renderNode(rootId)}
        </svg>
      </div>

      <div className={`border-t border-gray-200 bg-white text-xs text-gray-600 ${isCompact ? 'px-3 py-2' : 'px-4 py-2'}`}>
        <div className={`flex gap-1 ${isCompact ? 'flex-col' : 'items-center justify-between'}`}>
          <p className="min-w-0 truncate">
            {selectedNodeId ? `Selected: "${nodes[selectedNodeId]?.label}"` : 'Click a node to select'} • {Object.keys(nodes).length} nodes
          </p>
          <p className="shrink-0">
            <kbd className="rounded bg-gray-100 px-1">Ctrl+N</kbd> add · <kbd className="rounded bg-gray-100 px-1">Delete</kbd> remove
          </p>
        </div>
      </div>
    </div>
  )
}
