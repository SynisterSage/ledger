import { MAX_DOCUMENT_HTML_LENGTH } from './constants';
import type { EditorNativeEvent, NativeEditorCommand } from './messages';

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object';
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isTheme = (value: unknown): value is 'light' | 'dark' => value === 'light' || value === 'dark';
const isGeneration = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

export function parseNativeEditorCommand(value: unknown): NativeEditorCommand | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  if (value.type === 'LOAD_DOCUMENT' && isNonEmptyString(value.noteId) && isNonEmptyString(value.requestId) && isGeneration(value.generation) && typeof value.html === 'string' && value.html.length <= MAX_DOCUMENT_HTML_LENGTH && (value.readOnly === undefined || typeof value.readOnly === 'boolean')) return value as NativeEditorCommand;
  if (value.type === 'REQUEST_EXPORT' && isNonEmptyString(value.noteId) && isNonEmptyString(value.requestId) && isGeneration(value.generation)) return value as NativeEditorCommand;
  if (value.type === 'REQUEST_SELECTION' && isNonEmptyString(value.noteId) && isNonEmptyString(value.requestId) && isGeneration(value.generation)) return value as NativeEditorCommand;
  if (value.type === 'SET_READ_ONLY' && typeof value.value === 'boolean') return value as NativeEditorCommand;
  if (value.type === 'RESET_DIRTY') return value as NativeEditorCommand;
  if (value.type === 'SET_THEME' && isTheme(value.theme)) return value as NativeEditorCommand;
  if (value.type === 'FOCUS_EDITOR' || value.type === 'UNDO' || value.type === 'REDO' || value.type === 'REMOVE_LINK' || value.type === 'INSERT_DIVIDER') return value as NativeEditorCommand;
  if (value.type === 'TOGGLE_FORMAT' && (value.format === 'bold' || value.format === 'italic' || value.format === 'underline')) return value as NativeEditorCommand;
  if (value.type === 'SET_BLOCK_TYPE' && (value.block === 'paragraph' || value.block === 'h1' || value.block === 'h2' || value.block === 'h3')) return value as NativeEditorCommand;
  if (value.type === 'TOGGLE_LIST' && (value.list === 'bullet' || value.list === 'number' || value.list === 'check')) return value as NativeEditorCommand;
  if (value.type === 'INSERT_LINK' && isNonEmptyString(value.url) && value.url.length <= 2000) return value as NativeEditorCommand;
  if (value.type === 'INSERT_CALLOUT' && (value.variant === 'info' || value.variant === 'note' || value.variant === 'warning' || value.variant === 'success')) return value as NativeEditorCommand;
  if (value.type === 'INSERT_IMAGE' && isNonEmptyString(value.src) && value.src.length <= 4000 && (value.altText === undefined || typeof value.altText === 'string') && (value.width === undefined || typeof value.width === 'number') && (value.height === undefined || typeof value.height === 'number')) return value as NativeEditorCommand;
  if (value.type === 'INSERT_ATTACHMENT' && isNonEmptyString(value.name) && value.name.length <= 240 && (value.attachmentId === undefined || isNonEmptyString(value.attachmentId)) && (value.mimeType === undefined || typeof value.mimeType === 'string') && (value.sizeBytes === undefined || typeof value.sizeBytes === 'number') && (value.url === undefined || typeof value.url === 'string')) return value as NativeEditorCommand;
  return null;
}

export function parseEditorNativeEvent(value: unknown): EditorNativeEvent | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  if (value.type === 'READY' && isGeneration(value.generation)) return value as EditorNativeEvent;
  if (value.type === 'EDITOR_STAGE' && isNonEmptyString(value.stage) && (value.generation === undefined || isGeneration(value.generation)) && (value.detail === undefined || typeof value.detail === 'string')) return value as EditorNativeEvent;
  if (value.type === 'DOCUMENT_LOADED' && isNonEmptyString(value.noteId) && isNonEmptyString(value.requestId) && isGeneration(value.generation)) return value as EditorNativeEvent;
  if (value.type === 'DIRTY_STATE_CHANGED' && isNonEmptyString(value.noteId) && isGeneration(value.generation) && typeof value.dirty === 'boolean') return value as EditorNativeEvent;
  if (value.type === 'SELECTION_STATE_CHANGED' && isNonEmptyString(value.noteId) && isGeneration(value.generation) && isRecord(value.selection) && typeof value.selection.bold === 'boolean' && typeof value.selection.italic === 'boolean' && typeof value.selection.underline === 'boolean' && typeof value.selection.canUndo === 'boolean' && typeof value.selection.canRedo === 'boolean' && ['paragraph', 'h1', 'h2', 'h3'].includes(String(value.selection.blockType)) && (value.selection.listType === undefined || ['bullet', 'number', 'check'].includes(String(value.selection.listType))) && (value.selection.linkUrl === undefined || typeof value.selection.linkUrl === 'string')) return value as EditorNativeEvent;
  if (value.type === 'DOCUMENT_EXPORTED' && isNonEmptyString(value.noteId) && isNonEmptyString(value.requestId) && isGeneration(value.generation) && typeof value.html === 'string' && typeof value.plainText === 'string') return value as EditorNativeEvent;
  if (value.type === 'SELECTION_RESULT' && isNonEmptyString(value.noteId) && isNonEmptyString(value.requestId) && isGeneration(value.generation) && typeof value.plainText === 'string' && (value.html === undefined || typeof value.html === 'string')) return value as EditorNativeEvent;
  if ((value.type === 'FOCUSED' || value.type === 'BLURRED') && isGeneration(value.generation)) return value as EditorNativeEvent;
  if (value.type === 'EDITOR_ERROR' && isGeneration(value.generation) && typeof value.message === 'string' && isNonEmptyString(value.code) && (value.noteId === undefined || isNonEmptyString(value.noteId)) && (value.requestId === undefined || isNonEmptyString(value.requestId))) return value as EditorNativeEvent;
  return null;
}
