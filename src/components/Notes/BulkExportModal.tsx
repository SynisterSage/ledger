import { useState, useCallback, useEffect, useMemo } from 'react'
import { Download, Loader2, X, Check } from 'lucide-react'

interface BulkExportModalProps {
  isOpen: boolean
  onClose: () => void
  onExport: (format: 'pdf' | 'png' | 'html' | 'txt', selectedIds: Set<string>) => Promise<void>
  notes: Array<{ id: string; title: string; mode?: 'text' | 'mind_map' }>
  isMindMapOnly?: boolean
}

export const BulkExportModal = ({
  isOpen,
  onClose,
  onExport,
  notes,
  isMindMapOnly = false,
}: BulkExportModalProps) => {
  const relevantNotes = useMemo(
    () => (isMindMapOnly ? notes.filter((n) => n.mode === 'mind_map') : notes),
    [isMindMapOnly, notes]
  )
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(relevantNotes.map((n) => n.id)))
  const [format, setFormat] = useState<'pdf' | 'png' | 'html' | 'txt'>(isMindMapOnly ? 'pdf' : 'pdf')
  const [isExporting, setIsExporting] = useState(false)
  const [exportStatus, setExportStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const selectedRelevantCount = relevantNotes.reduce((count, note) => (selectedIds.has(note.id) ? count + 1 : count), 0)

  useEffect(() => {
    if (!isOpen) return
    setSelectedIds(new Set(relevantNotes.map((note) => note.id)))
    setFormat(isMindMapOnly ? 'pdf' : 'pdf')
    setExportStatus('idle')
  }, [isOpen, isMindMapOnly, relevantNotes])

  const handleSelectAll = useCallback(() => {
    if (selectedRelevantCount === relevantNotes.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(relevantNotes.map((n) => n.id)))
    }
  }, [relevantNotes, selectedRelevantCount])

  const handleToggleNote = useCallback((noteId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(noteId)) {
        next.delete(noteId)
      } else {
        next.add(noteId)
      }
      return next
    })
  }, [])

  const handleExport = async () => {
    const filteredSelectedIds = new Set(relevantNotes.filter((note) => selectedIds.has(note.id)).map((note) => note.id))
    if (filteredSelectedIds.size === 0) return
    setIsExporting(true)
    setExportStatus('idle')
    try {
      await onExport(format, filteredSelectedIds)
      setExportStatus('success')
      setTimeout(() => {
        onClose()
        setExportStatus('idle')
      }, 1500)
    } catch (error) {
      console.error('Export failed:', error)
      setExportStatus('error')
    } finally {
      setIsExporting(false)
    }
  }

  if (!isOpen) return null

  const formatOptions = isMindMapOnly 
    ? (['pdf', 'png', 'txt'] as const)
    : (['pdf', 'txt', 'html'] as const)

  const formatLabels: Record<string, string> = {
    pdf: 'PDF',
    png: 'PNG',
    txt: 'Text',
    html: 'HTML',
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-lg"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <Download size={18} className="text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">
              Export {isMindMapOnly ? 'Mind Maps' : 'Notes'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          {/* Format selection */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Export format</label>
            <div className="grid grid-cols-4 gap-2">
              {formatOptions.map((opt) => (
                <button
                  key={opt}
                  onClick={() => setFormat(opt)}
                  className={`rounded-lg px-2 py-2 text-xs font-medium transition ${
                    format === opt
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {formatLabels[opt]}
                </button>
              ))}
            </div>
          </div>

          {/* Notes selection */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">
                Select {isMindMapOnly ? 'mind maps' : 'notes'} ({selectedRelevantCount} of {relevantNotes.length})
              </label>
              <button
                onClick={handleSelectAll}
                className="text-xs font-medium text-gray-600 hover:text-gray-900"
              >
                {selectedRelevantCount === relevantNotes.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="max-h-60 overflow-y-auto rounded-lg border border-gray-200 divide-y">
              {relevantNotes.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-gray-500">
                  No {isMindMapOnly ? 'mind maps' : 'notes'} available
                </div>
              ) : (
                relevantNotes.map((note) => (
                  <label
                    key={note.id}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer transition"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(note.id)}
                      onChange={() => handleToggleNote(note.id)}
                      className="rounded border-gray-300"
                    />
                    <span className="flex-1 truncate text-sm text-gray-900">{note.title || 'Untitled'}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Status message */}
          {exportStatus === 'success' && (
            <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
              <Check size={16} />
              Export complete! Downloading files...
            </div>
          )}
          {exportStatus === 'error' && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              Export failed. Please try again.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t border-gray-100 px-6 py-3">
          <button
            onClick={onClose}
            disabled={isExporting}
            className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting || selectedRelevantCount === 0}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {isExporting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download size={16} />
                Export ({selectedRelevantCount})
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
