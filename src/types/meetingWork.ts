import type { TranscriptEvidenceRef } from './meetingRecap';

export type MeetingWorkProposal =
  | {
      type: 'task';
      title: string;
      description?: string;
      assigneeId?: string;
      dueDate?: string;
      projectId?: string;
      sourceRefs: TranscriptEvidenceRef[];
    }
  | {
      type: 'reminder';
      title: string;
      dueAt?: string;
      sourceRefs: TranscriptEvidenceRef[];
    }
  | {
      type: 'project_link';
      projectId: string;
      sourceRefs: TranscriptEvidenceRef[];
    };

export const validateMeetingWorkProposal = (
  proposal: MeetingWorkProposal,
  allowedSourceIds: Set<string>,
  allowedProjectIds: Set<string> = new Set()
) => {
  if (!proposal || !Array.isArray(proposal.sourceRefs) || !proposal.sourceRefs.length) return false;
  if (proposal.sourceRefs.some((ref) => !allowedSourceIds.has(ref.transcriptSegmentId))) return false;
  if ('title' in proposal && !proposal.title.trim()) return false;
  if ('projectId' in proposal && proposal.projectId && !allowedProjectIds.has(proposal.projectId)) return false;
  if (proposal.type === 'task' && proposal.assigneeId && !/^[0-9a-f-]{8,}$/i.test(proposal.assigneeId)) return false;
  if (proposal.type === 'task' && proposal.dueDate && Number.isNaN(new Date(proposal.dueDate).getTime())) return false;
  if (proposal.type === 'reminder' && proposal.dueAt && Number.isNaN(new Date(proposal.dueAt).getTime())) return false;
  return true;
};
