import { createCommand, type LexicalCommand } from 'lexical';
import type { CalloutType } from '../types/blocks';

export const INSERT_TOGGLE_COMMAND: LexicalCommand<void> = createCommand('INSERT_TOGGLE_COMMAND');
export const INSERT_CALLOUT_COMMAND: LexicalCommand<CalloutType> =
  createCommand('INSERT_CALLOUT_COMMAND');
export const SET_CALLOUT_TYPE_COMMAND: LexicalCommand<CalloutType> = createCommand(
  'SET_CALLOUT_TYPE_COMMAND'
);
export const INSERT_DIVIDER_COMMAND: LexicalCommand<void> = createCommand('INSERT_DIVIDER_COMMAND');
export const TOGGLE_TOGGLE_COMMAND: LexicalCommand<void> = createCommand('TOGGLE_TOGGLE_COMMAND');
export const INSERT_FILE_ATTACHMENT_COMMAND: LexicalCommand<void> = createCommand(
  'INSERT_FILE_ATTACHMENT_COMMAND'
);
export const INSERT_IMAGE_COMMAND: LexicalCommand<void> = createCommand('INSERT_IMAGE_COMMAND');
export const TABLE_ADD_ROW_COMMAND: LexicalCommand<void> = createCommand('TABLE_ADD_ROW_COMMAND');
export const TABLE_REMOVE_ROW_COMMAND: LexicalCommand<void> = createCommand(
  'TABLE_REMOVE_ROW_COMMAND'
);
export const TABLE_ADD_COLUMN_COMMAND: LexicalCommand<void> = createCommand(
  'TABLE_ADD_COLUMN_COMMAND'
);
export const TABLE_REMOVE_COLUMN_COMMAND: LexicalCommand<void> = createCommand(
  'TABLE_REMOVE_COLUMN_COMMAND'
);
