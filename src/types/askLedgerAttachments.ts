export type AskLedgerAttachmentStatus = 'processing' | 'ready' | 'unsupported' | 'failed';

export type AskLedgerAttachment = {
  id: string;
  conversationId?: string;
  name: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  status: AskLedgerAttachmentStatus;
  createdAt: string;
  error?: string;
};

export type AskLedgerAttachmentSource = {
  attachmentId: string;
  fileName: string;
  pageNumber?: number;
  section?: string;
  paragraph?: number;
  rowStart?: number;
  rowEnd?: number;
};
