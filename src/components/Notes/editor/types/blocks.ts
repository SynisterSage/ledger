export type CalloutType = 'info' | 'note' | 'warning' | 'success';

export type AttachmentUploadResult = {
  storagePath: string;
  url: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export type AttachmentUploadRequest = {
  noteId: string;
  file: File;
};
