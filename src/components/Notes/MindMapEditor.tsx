import { Plus, Trash2, ChevronDown, ChevronRight, Copy } from 'lucide-react'
import { useState, useCallback, useMemo, useEffect } from 'react'

type MindMapNode = {
  id: string
  label: string
  children: string[]
  x: number
  y: number
  collapsed?: boolean
  color?: string
}

type MindMapStructure = {
  nodes: Record<string, MindMapNode>
  rootId: string
}

interface MindMapEditorProps {
  structure: unknown
  onChange: (structure: MindMapStructure) => void
  onExport?: (format: 'json' | 'markdown') => void
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
, onExport
export const MindMapEditor: React.FC<MindMapEditorProps> = ({ structure, onChange }) => {
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

  const updateStructure = useCallback(
    (newNodes: typeof nodes) => {
      setNodes(newNodes)
      onChange({ nodes: newNodes, rootId })
    },
    [rootId, onChange]
  )

  const handleAddChild = useCallback(() => {
    if (!selectedNodeId) return

    const newNodeId = `node-${Date.now()}`
    const parent = nodes[selectedNodeId]
    if (!parent) return

    const angle = (Math.PI * 2 * parent.children.length) / Math.max(1, parent.children.length + 1)
    const distance = 150
    const newNode: MindMapNode = {
      id: newNodeId,
      label: 'New Idea',
      children: [],
      x: parent.x + Math.cos(angle) * distance,
      y: parent.y + Math.sin(angle) * distance,
    }

    const updatedParent = { ...parent, children: [...parent.children, newNodeId] }
    updateStructure({ ...nodes, [newNodeId]: newNode, [selectedNodeId]: updatedParent })
    setSelectedNodeId(newNodeId)
  }, [selectedNodeId, nodes, updateStructure])

  const handleDeleteNode = useCallback(() => {
    if (!selectedNodeId || selectedNodeId === rootId) return

    const updatedNodes = { ...nodes }
    delete updatedNodes[selectedNodeId]

    Object.keys(updatedNodes).forEach((nodeId) => {
      const node = updatedNodes[nodeId]
      node.children = node.children.filter((childId) => childId !== selectedNodeId)
    })

    updateStructure(updatedNodes)
    setSelectedNodeId(null)
  }, [selectedNodeId, rootId, nodes, updateStructure])

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

  const canvasWidth = 800
  const canvasHeight = 500
  const centerX = canvasWidth / 2
  const centerY = canvasHeight / 2

  const nodeColors = ['#f3f4f6', '#fef3c7', '#dbeafe', '#dbeafe', '#fecaca', '#dcfce7']
  const nodeColorLabels = ['Gray', 'Yellow', 'Blue', 'Purple', 'Red', 'Green']

  const exportAsJSON = () => {
    const json = JSON.stringify({ nodes, rootId }, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `mindmap-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
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
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const renderNode = (nodeId: string, parentX?: number, parentY?: number): React.ReactNode => {
    const node = nodes[nodeId]
    if (!node) return null

    const displayX = centerX + node.x * zoom + offsetX
    const displayY = centerY + node.y * zoom + offsetY
    const isSelected = selectedNodeId === nodeId
    const isEditing = editingNodeId === nodeId

    return (
      <g key={nodeId}>
        {parentX !== undefined && parentY !== undefined && (
          <line
            x1={parentX}
            y1={parentY}
            x2={displayX}
            y2={displayY}
            stroke="#d1d5db"
            strokeWidth="2"
            pointerEvents="none"
          />
        )}

        {!node.collapsed && node.children.map((childId) => renderNode(childId, displayX, displayY))}

        <circle
          cx={displayX}
          cy={displayY}
          r="28"
          fill={isSelected ? '#FF5F40' : (node.color || '#f3f4f6')}
          stroke={isSelected ? '#ea5336' : '#d1d5db'}
          strokeWidth="2"
          onClick={() => setSelectedNodeId(nodeId)}
          style={{ cursor: 'pointer' }}
        />

        {node.children.length > 0 && (
          <g
            onClick={() => handleToggleCollapse(nodeId)}
            style={{ cursor: 'pointer' }}
          >
            <rect
              x={displayX - 8}
              y={displayY + 30}
              width="16"
              height="16"
              fill="white"
              stroke="#d1d5db"
              strokeWidth="1"
              rx="2"
            />
            <text
              x={displayX}
              y={displayY + 43}
              fontSize="10"
              fontWeight="bold"
              textAnchor="middle"
              fill="#6b7280"
            >
              {node.collapsed ? '+' : '−'}
            </text>
          </g>
        )}

        {isEditing ? (
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
        ) : (
          <text
            x={displayX}
            y={displayY + 4}
            fontSize="12"
            fontWeight="500"
            textAnchor="middle"
            fill={isSelected ? 'white' : '#1f2937'}
            onClick={() => {
              setEditingNodeId(nodeId)
              setEditingLabel(node.label)
            }}
            style={{ cursor: 'pointer', userSelect: 'none' }}
          >
            {node.label.length > 12 ? `${node.label.slice(0, 12)}...` : node.label}
          </text>
        )}
      </g>
    )
  }

  return (
    <div className="w-full h-full flex flex-col bg-gray-50 rounded-lg border border-gray-200">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-white">
        <button
          onClick={handleAddChild}
          disabled={!selectedNodeId}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-[#FF5F40] text-white rounded-lg hover:bg-[#ea5336] disabled:opacity-50 disabled:cursor-not-allowed transition"
          title="Ctrl+N"
        >
          <Plus size={14} />
          Add
        </button>
        <button
          onClick={handleDeleteNode}
          disabled={!selectedNodeId || selectedNodeId === rootId}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-red-50 text-red-700 rounded-lg hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
          title="Delete"
        >
          <Trash2 size={14} />
        </button>

        {selectedNodeId && (
          <div className="flex items-center gap-1">
            <div className="flex gap-1">
              {nodeColors.map((color) => (
                <button
                  key={color}
                  onClick={() => handleChangeNodeColor(selectedNodeId, color)}
                  className="w-5 h-5 rounded border-2 hover:shadow-md transition"
                  style={{
                    backgroundColor: color,
                    borderColor:
                      nodes[selectedNodeId]?.color === color ? '#FF5F40' : '#d1d5db',
                  }}
                  title={nodeColorLabels[nodeColors.indexOf(color)]}
                />
              ))}
            </div>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
            className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
          >
            −
          </button>
          <span className="text-xs font-medium text-gray-600 w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom(Math.min(2, zoom + 0.1))}
            className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
          >
            +
          </button>

          <div className="relative group">
            <button className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded hover:bg-gray-200">
              ⋯
            </button>
            <div className="absolute right-0 mt-1 w-32 bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition z-10">
              <button
                onClick={exportAsJSON}
                className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 first:rounded-t-lg"
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
          </div>
        </div>
      </div>

      <svg
        width={canvasWidth}
        height={canvasHeight}
        className="flex-1 cursor-move bg-white"
        onMouseDown={(e) => {
          if (e.button !== 2) return
          e.preventDefault()
          const startX = e.clientX
          const startY = e.clientY
          const startOffsetX = offsetX
          const startOffsetY = offsetY

          const handleMouseMove = (moveEvent: MouseEvent) => {
            setOffsetX(startOffsetX + moveEvent.clientX - startX)
            setOffsetY(startOffsetY + moveEvent.clientY - startY)
          }

          const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
          }

          document.addEventListener('mousemove', handleMouseMove)
          document.addEventListener('mouseup', handleMouseUp)
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {renderNode(rootId)}
      </svg>

      <div className="px-4 py-2 border-t border-gray-200 bg-white text-xs text-gray-600">
        <p>
          {selectedNodeId ? `Selected: "${nodes[selectedNodeId]?.label}"` : 'Click a node to select'} •{' '}
          {Object.keys(nodes).length} nodes • Press <kbd className="bg-gray-100 px-1 rounded">Ctrl+N</kbd> to add,{' '}
          <kbd className="bg-gray-100 px-1 rounded">Delete</kbd> to remove
        </p>
      </div>
    </div>
  )
}
