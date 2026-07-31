export type EditorExternalEmbedRequest = {
  noteId: string;
  targetType: 'note' | 'meetingNote';
  provider: 'figma' | 'github' | 'google_drive';
  url: string;
};

export type EditorExternalEmbedResult = {
  externalReferenceId: string;
  externalUrl: string;
};
