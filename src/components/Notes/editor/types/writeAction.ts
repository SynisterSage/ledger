/** Serializable boundary from Lexical Write mode into NotesWindow actions. */
export type WriteActionPayload = {
  noteId: string;
  plainText: string;
  html?: string;
  blockKey?: string;
  source: 'selection' | 'block';
  smartDates?: Array<{ text: string; date: string; state?: string }>;
};
