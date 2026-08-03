import { useLocalSearchParams } from 'expo-router';

import { MobileTextNoteEditor } from '@/features/notes/MobileTextNoteEditor';

export default function NoteEditorRoute() {
  const params = useLocalSearchParams<{
    id?: string | string[];
    workspaceId?: string | string[];
    returnTo?: string | string[];
    mode?: 'write' | 'transcript' | 'map' | 'outline' | string | string[];
    focusSegmentId?: string | string[];
    focusNodeId?: string | string[];
    focus?: 'title' | 'editor' | string | string[];
  }>();
  const noteId = Array.isArray(params.id) ? params.id[0] : params.id;
  const workspaceId = Array.isArray(params.workspaceId) ? params.workspaceId[0] : params.workspaceId;
  const requestedMode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const initialView = requestedMode === 'transcript' || requestedMode === 'map' || requestedMode === 'outline' ? requestedMode : 'write';
  const focus = Array.isArray(params.focus) ? params.focus[0] : params.focus;

  return <MobileTextNoteEditor noteId={noteId} workspaceId={workspaceId} initialView={initialView} focus={focus === 'editor' ? 'editor' : 'title'} returnTo={Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo} focusSegmentId={Array.isArray(params.focusSegmentId) ? params.focusSegmentId[0] : params.focusSegmentId} focusNodeId={Array.isArray(params.focusNodeId) ? params.focusNodeId[0] : params.focusNodeId} />;
}
