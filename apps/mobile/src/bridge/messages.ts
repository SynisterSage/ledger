export type EditorDocumentIdentity = { noteId: string; loadRequestId: string; generation: number };
export type NativeEditorCommand =
  | { type: 'LOAD_DOCUMENT'; noteId: string; requestId: string; html: string; readOnly?: boolean }
  | { type: 'REQUEST_EXPORT'; noteId: string; requestId: string }
  | { type: 'REQUEST_SELECTION'; noteId: string; requestId: string }
  | { type: 'SET_READ_ONLY'; value: boolean }
  | { type: 'SET_THEME'; theme: 'light' | 'dark' }
  | { type: 'FOCUS_EDITOR' }
  | { type: 'TOGGLE_FORMAT'; format: 'bold' | 'italic' | 'underline' }
  | { type: 'SET_BLOCK_TYPE'; block: 'paragraph' | 'h1' | 'h2' | 'h3' }
  | { type: 'TOGGLE_LIST'; list: 'bullet' | 'number' | 'check' }
  | { type: 'INSERT_LINK'; url: string }
  | { type: 'REMOVE_LINK' }
  | { type: 'INSERT_CALLOUT'; variant: 'info' | 'note' | 'warning' | 'success' }
  | { type: 'INSERT_DIVIDER' }
  | { type: 'INSERT_IMAGE'; src: string; altText?: string; width?: number; height?: number }
  | { type: 'INSERT_ATTACHMENT'; attachmentId?: string; name: string; mimeType?: string; sizeBytes?: number; url?: string }
  | { type: 'UNDO' } | { type: 'REDO' };
export type EditorSelectionState = { bold: boolean; italic: boolean; underline: boolean; blockType: 'paragraph' | 'h1' | 'h2' | 'h3'; listType?: 'bullet' | 'number' | 'check'; linkUrl?: string; canUndo: boolean; canRedo: boolean };
export type EditorNativeEvent =
  | { type: 'READY' } | { type: 'DOCUMENT_LOADED'; noteId: string; requestId: string }
  | { type: 'DIRTY_STATE_CHANGED'; noteId: string; dirty: boolean }
  | { type: 'SELECTION_STATE_CHANGED'; noteId: string; selection: EditorSelectionState }
  | { type: 'DOCUMENT_EXPORTED'; noteId: string; requestId: string; html: string; plainText: string }
  | { type: 'SELECTION_RESULT'; noteId: string; requestId: string; plainText: string; html?: string }
  | { type: 'FOCUSED' } | { type: 'BLURRED' } | { type: 'ERROR'; noteId?: string; requestId?: string; message: string };
