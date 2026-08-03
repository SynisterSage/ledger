import type { EditorNativeEvent, NativeEditorCommand } from './messages';
const record = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object';
const stringValue = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
export function parseEditorNativeEvent(v: unknown): EditorNativeEvent | null {
  if (!record(v) || typeof v.type !== 'string') return null;
  if (['READY', 'FOCUSED', 'BLURRED'].includes(v.type)) return v as EditorNativeEvent;
  if (v.type === 'DOCUMENT_LOADED' && stringValue(v.noteId) && stringValue(v.requestId)) return v as EditorNativeEvent;
  if (v.type === 'DIRTY_STATE_CHANGED' && stringValue(v.noteId) && typeof v.dirty === 'boolean') return v as EditorNativeEvent;
  if (v.type === 'DOCUMENT_EXPORTED' && stringValue(v.noteId) && stringValue(v.requestId) && typeof v.html === 'string' && typeof v.plainText === 'string') return v as EditorNativeEvent;
  if (v.type === 'SELECTION_RESULT' && stringValue(v.noteId) && stringValue(v.requestId) && typeof v.plainText === 'string') return v as EditorNativeEvent;
  if (v.type === 'SELECTION_STATE_CHANGED' && stringValue(v.noteId) && record(v.selection) && typeof v.selection.bold === 'boolean' && typeof v.selection.italic === 'boolean' && typeof v.selection.underline === 'boolean' && typeof v.selection.canUndo === 'boolean' && typeof v.selection.canRedo === 'boolean' && ['paragraph', 'h1', 'h2', 'h3'].includes(String(v.selection.blockType)) && (v.selection.listType === undefined || ['bullet', 'number', 'check'].includes(String(v.selection.listType))) && (v.selection.linkUrl === undefined || typeof v.selection.linkUrl === 'string')) return v as EditorNativeEvent;
  if (v.type === 'ERROR' && typeof v.message === 'string') return v as EditorNativeEvent;
  return null;
}
export function parseNativeEditorCommand(v: unknown): NativeEditorCommand | null { return record(v) && typeof v.type === 'string' ? v as NativeEditorCommand : null; }
