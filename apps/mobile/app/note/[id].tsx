import { useLocalSearchParams } from 'expo-router';

import { MobileTextNoteEditor } from '@/features/notes/MobileTextNoteEditor';

export default function NoteEditorRoute() {
  const params = useLocalSearchParams<{ id?: string | string[]; workspaceId?: string | string[] }>();
  const noteId = Array.isArray(params.id) ? params.id[0] : params.id;
  const workspaceId = Array.isArray(params.workspaceId) ? params.workspaceId[0] : params.workspaceId;

  return <MobileTextNoteEditor noteId={noteId} workspaceId={workspaceId} />;
}
