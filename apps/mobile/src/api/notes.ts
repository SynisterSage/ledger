import { mobileRequest } from './client';

export type MobileNoteDetail = {
  id: string;
  title: string;
  content: string | null;
  content_html: string | null;
  updated_at: string | null;
  created_at: string | null;
};

export async function getMobileNote(noteId: string) {
  return mobileRequest<MobileNoteDetail>(`/api/notes/${encodeURIComponent(noteId)}`);
}
