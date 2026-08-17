export type RelatedContextResourceType =
  | 'note'
  | 'project'
  | 'task'
  | 'event'
  | 'reminder'
  | 'intake'
  | 'milestone'
  | 'external_reference';

export type RelatedContextRelationship =
  | 'belongs_to'
  | 'contains'
  | 'related_to'
  | 'created_from'
  | 'converted_from'
  | 'captured_from'
  | 'references'
  | 'supports';

export type RelatedContextSource =
  | 'foreign_key'
  | 'join'
  | 'context_link'
  | 'external_reference'
  | 'integration'
  | 'provenance';

export type RelatedContextRoute = {
  kind: 'workspace-resource' | 'external-resource';
  workspaceId?: string;
  resourceType?: RelatedContextResourceType;
  resourceId?: string;
  provider?: string;
  url?: string | null;
  [key: string]: unknown;
};

export type RelatedContextTarget = {
  type: RelatedContextResourceType;
  id: string;
  title: string;
  workspace_id: string;
  preview?: string | null;
  provider?: string | null;
  url?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
};

export type RelatedContextProvenance = {
  source_type?: string | null;
  source_id?: string | null;
  source_url?: string | null;
  source_label?: string | null;
  captured_at?: string | null;
  [key: string]: unknown;
};

export type RelatedContextItem = {
  relationship: RelatedContextRelationship;
  direction: 'incoming' | 'outgoing';
  source: RelatedContextSource;
  target: RelatedContextTarget;
  provenance?: RelatedContextProvenance | null;
  route?: RelatedContextRoute | null;
  created_at?: string | null;
};

export type RelatedContextResponse = {
  resource: {
    type: RelatedContextResourceType;
    id: string;
    workspace_id: string;
  };
  items: RelatedContextItem[];
};
