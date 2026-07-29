/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string;
    /** /dist/ or /public/ */
    VITE_PUBLIC: string;
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  ipcRenderer: import('electron').IpcRenderer;
  appleCalendar?: {
    status: () => Promise<{ ok: boolean; status: string }>;
    requestAccess: () => Promise<{ ok: boolean; granted?: boolean; error?: string }>;
    listCalendars: () => Promise<{ ok: boolean; calendars?: unknown[]; error?: string }>;
    events: (payload: { start: string; end: string; calendarIds: string[] }) => Promise<{ ok: boolean; events?: unknown[]; error?: string }>;
    refreshRange: (payload: { start: string; end: string; calendarIds: string[] }) => Promise<{ ok: boolean; events?: unknown[]; error?: string; code?: string }>;
    getEvent: (payload: { eventId: string }) => Promise<{ ok: boolean; event?: unknown; error?: string; code?: string; notFound?: boolean }>;
    connectionStatus: () => Promise<{ ok: boolean; status: string; code?: string }>;
    writableCalendars: () => Promise<{ ok: boolean; calendars?: unknown[]; error?: string }>;
    createEvent: (payload: Record<string, unknown>) => Promise<{ ok: boolean; event?: unknown; error?: string; notFound?: boolean }>;
    updateEvent: (payload: Record<string, unknown>) => Promise<{ ok: boolean; event?: unknown; error?: string; notFound?: boolean }>;
    deleteEvent: (payload: { eventId: string; span?: 'thisEvent' | 'futureEvents' }) => Promise<{ ok: boolean; error?: string; notFound?: boolean }>;
    moveEvent: (payload: { eventId: string; calendarId: string; span?: 'thisEvent' | 'futureEvents' }) => Promise<{ ok: boolean; event?: unknown; error?: string; notFound?: boolean }>;
    openSystemSettings: () => Promise<boolean>;
    onChanged: (listener: () => void) => () => void;
  };
  appleReminders?: {
    getPermissionStatus: () => Promise<{ ok: boolean; status: string; code?: string }>;
    getConnectionStatus: () => Promise<{ ok: boolean; status: string; code?: string }>;
    requestAccess: () => Promise<{ ok: boolean; granted?: boolean; error?: string }>;
    getLists: () => Promise<{ ok: boolean; lists?: unknown[]; error?: string }>;
    getWritableLists: () => Promise<{ ok: boolean; lists?: unknown[]; error?: string }>;
    getReminder: (payload: { reminderId: string }) => Promise<{ ok: boolean; reminder?: unknown; error?: string; notFound?: boolean }>;
    createReminder: (payload: Record<string, unknown>) => Promise<{ ok: boolean; reminder?: unknown; error?: string }>;
    updateReminder: (payload: Record<string, unknown>) => Promise<{ ok: boolean; reminder?: unknown; error?: string; notFound?: boolean }>;
    setCompleted: (payload: { reminderId: string; completed: boolean; listId?: string }) => Promise<{ ok: boolean; reminder?: unknown; error?: string; notFound?: boolean }>;
    moveReminder: (payload: { reminderId: string; listId: string }) => Promise<{ ok: boolean; reminder?: unknown; error?: string; notFound?: boolean }>;
    deleteReminder: (payload: { reminderId: string }) => Promise<{ ok: boolean; error?: string; notFound?: boolean }>;
    fetchReminders: (payload: { start: string; end: string; listIds: string[] }) => Promise<{ ok: boolean; reminders?: unknown[]; error?: string; code?: string }>;
    refresh: (payload: { start: string; end: string; listIds: string[] }) => Promise<{ ok: boolean; reminders?: unknown[]; error?: string; code?: string }>;
    disconnect: () => Promise<boolean>;
    openSystemSettings: () => Promise<boolean>;
  };
}
