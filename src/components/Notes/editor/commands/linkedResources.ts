import { createCommand } from 'lexical';

/**
 * Opens the linked-resource picker while the editor still owns its selection.
 * The insertion plugin restores that selection after the picker closes.
 */
export const OPEN_LINKED_RESOURCES_COMMAND = createCommand<void>();
export type LinkedResourceBadgeRequest = {
  resourceType: 'project' | 'note' | 'task' | 'event' | 'reminder' | 'external';
  resourceId: string;
  title: string;
  url: string;
  provider?: string;
  externalType?: string;
  metadata?: Record<string, unknown>;
};
export const INSERT_LINKED_RESOURCE_BADGE_COMMAND = createCommand<LinkedResourceBadgeRequest>();
