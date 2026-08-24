import type { AskLedgerInitialContext } from '../../types/askLedgerContext';

/**
 * Notes Home is a workspace scope, not a single note anchor. The synthetic
 * note identity satisfies the existing context contract while the explicit
 * notes_home type tells retrieval and prompting to search the full workspace.
 */
export const createNotesHomeAskContext = (
  workspaceId: string | null | undefined,
  question: string
): AskLedgerInitialContext | null => {
  const normalizedWorkspaceId = workspaceId?.trim();
  const normalizedQuestion = question.trim();
  if (!normalizedWorkspaceId || !normalizedQuestion) return null;
  return {
    resourceType: 'note',
    resourceId: `notes-home:${normalizedWorkspaceId}`,
    title: 'Notes workspace',
    contextType: 'notes_home',
    workspaceId: normalizedWorkspaceId,
    origin: 'notes_home',
    initialQuestion: normalizedQuestion,
  };
};
