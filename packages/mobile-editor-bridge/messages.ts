export type EditorDocumentIdentity = { noteId: string; loadRequestId: string; generation: number };

export type NativeEditorCommand =
  | { type: 'LOAD_DOCUMENT'; noteId: string; requestId: string; generation: number; html: string; readOnly?: boolean }
  | { type: 'REQUEST_EXPORT'; noteId: string; requestId: string; generation: number }
  | { type: 'REQUEST_SELECTION'; noteId: string; requestId: string; generation: number }
  | { type: 'SET_READ_ONLY'; value: boolean }
  | { type: 'RESET_DIRTY' }
  | { type: 'SET_THEME'; theme: 'light' | 'dark' }
  | { type: 'CAPTURE_SELECTION' }
  | { type: 'FOCUS_EDITOR' }
  | { type: 'TOGGLE_FORMAT'; format: 'bold' | 'italic' | 'underline' }
  | { type: 'SET_BLOCK_TYPE'; block: 'paragraph' | 'h1' | 'h2' | 'h3' }
  | { type: 'TOGGLE_LIST'; list: 'bullet' | 'number' | 'check' }
  | { type: 'INSERT_LINK'; url: string }
  | { type: 'INSERT_RESOURCE_LINK'; url: string; text: string }
  | { type: 'REMOVE_LINK' }
  | { type: 'INSERT_CALLOUT'; variant: 'info' | 'note' | 'warning' | 'success' }
  | { type: 'INSERT_DIVIDER' }
  | { type: 'INSERT_IMAGE'; src: string; altText?: string; width?: number; height?: number }
  | { type: 'INSERT_ATTACHMENT'; attachmentId?: string; name: string; mimeType?: string; sizeBytes?: number; url?: string }
  | { type: 'UNDO' }
  | { type: 'REDO' };

export type EditorNativeEvent =
  | { type: 'READY'; generation: number }
  | { type: 'EDITOR_STAGE'; stage: string; detail?: string; generation?: number }
  | { type: 'DOCUMENT_LOADED'; noteId: string; requestId: string; generation: number }
  | { type: 'DIRTY_STATE_CHANGED'; noteId: string; generation: number; dirty: boolean }
  | { type: 'SELECTION_STATE_CHANGED'; noteId: string; generation: number; selection: EditorSelectionState }
  | { type: 'DOCUMENT_EXPORTED'; noteId: string; requestId: string; generation: number; html: string; plainText: string }
  | { type: 'SELECTION_RESULT'; noteId: string; requestId: string; generation: number; plainText: string; html?: string }
  | { type: 'COPY_IMAGE_REQUEST'; noteId: string; generation: number; src: string }
  | { type: 'FOCUSED'; generation: number }
  | { type: 'BLURRED'; generation: number }
  | { type: 'EDITOR_ERROR'; noteId?: string; requestId?: string; generation: number; code: string; message: string };

export type EditorSelectionState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  blockType: 'paragraph' | 'h1' | 'h2' | 'h3';
  listType?: 'bullet' | 'number' | 'check';
  linkUrl?: string;
  canUndo: boolean;
  canRedo: boolean;
};
