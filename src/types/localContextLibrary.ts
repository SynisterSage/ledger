/**
 * Device-local context records. These types are intentionally separate from
 * workspace API records: a local file is never a Supabase object.
 */
export type LocalContextFileStatus = 'ready' | 'missing' | 'unsupported' | 'failed';

export type LocalContextTargetType =
  | 'ask_session'
  | 'note'
  | 'project'
  | 'event'
  | 'reminder';

export type LocalContextLink = {
  targetType: LocalContextTargetType;
  targetId: string;
  createdAt: string;
};

export type LocalContextFile = {
  id: string;
  ownerUserId: string;
  workspaceId: string;
  name: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  status: LocalContextFileStatus;
  relativePath: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  folderId?: string | null;
  links: LocalContextLink[];
};

export type LocalContextFolder = {
  id: string;
  ownerUserId: string;
  workspaceId: string;
  name: string;
  parentId?: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type LocalContextLibrarySummary = {
  files: LocalContextFile[];
  folders: LocalContextFolder[];
  totalBytes: number;
};
