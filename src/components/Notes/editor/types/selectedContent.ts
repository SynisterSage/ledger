import type { WriteActionPayload } from './writeAction';

/**
 * The boundary between Lexical selection state and Ledger actions.
 *
 * Keep Lexical nodes, selections, and EditorState inside the editor. Ledger
 * callers receive stable, serializable content instead.
 */
export type SelectedContentPayload = WriteActionPayload;

export type SelectedContentAction = (payload: SelectedContentPayload) => void | Promise<void>;

export type SelectedContentPersonAction = (
  payload: SelectedContentPayload,
  personId: string
) => void | Promise<void>;
