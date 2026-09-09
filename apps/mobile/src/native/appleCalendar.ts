import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

export type AppleCalendarAuthorizationStatus =
  | 'not_requested'
  | 'granted'
  | 'write_only'
  | 'denied'
  | 'restricted'
  | 'unknown';

export type AppleCalendarSummary = {
  id: string;
  title: string;
  sourceTitle: string;
  sourceId: string | null;
  color: string;
  allowsContentModifications: boolean;
  type: number;
};

export type AppleCalendarEvent = {
  id: string;
  calendarId: string;
  calendarTitle: string;
  calendarColor: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  status: number;
  lastModified?: string | null;
  timeZone?: string | null;
  notes?: string | null;
  location?: string | null;
  url?: string | null;
};

type AppleCalendarNativeModule = {
  getAuthorizationStatus(): Promise<AppleCalendarAuthorizationStatus>;
  requestAccess(): Promise<AppleCalendarAuthorizationStatus>;
  listCalendars(): Promise<AppleCalendarSummary[]>;
  fetchEvents(start: string, end: string, calendarIds: string[]): Promise<AppleCalendarEvent[]>;
  createEvent(title: string, start: string, end: string, allDay: boolean, notes: string | null, location: string | null, calendarId: string): Promise<AppleCalendarEvent>;
  updateEvent(eventId: string, title: string, start: string, end: string, allDay: boolean, notes: string | null, location: string | null): Promise<AppleCalendarEvent>;
  getEvent(eventId: string): Promise<AppleCalendarEvent>;
  deleteEvent(eventId: string): Promise<boolean>;
};

let nativeModule: AppleCalendarNativeModule | null = null;
if (Platform.OS === 'ios') {
  try {
    nativeModule = requireNativeModule<AppleCalendarNativeModule>('LedgerCalendar');
  } catch {
    nativeModule = null;
  }
}

export const appleCalendarNative = {
  supported: Platform.OS === 'ios' && nativeModule !== null,
  getAuthorizationStatus: async (): Promise<AppleCalendarAuthorizationStatus> =>
    nativeModule?.getAuthorizationStatus() ?? 'unknown',
  requestAccess: async (): Promise<AppleCalendarAuthorizationStatus> =>
    nativeModule?.requestAccess() ?? 'unknown',
  listCalendars: async (): Promise<AppleCalendarSummary[]> =>
    nativeModule?.listCalendars() ?? [],
  fetchEvents: async (start: string, end: string, calendarIds: string[]): Promise<AppleCalendarEvent[]> =>
    nativeModule?.fetchEvents(start, end, calendarIds) ?? [],
  createEvent: async (title: string, start: string, end: string, allDay: boolean, notes: string | null, location: string | null, calendarId: string) => {
    if (!nativeModule) throw new Error('Apple Calendar is unavailable on this device.');
    return nativeModule.createEvent(title, start, end, allDay, notes, location, calendarId);
  },
  updateEvent: async (eventId: string, title: string, start: string, end: string, allDay: boolean, notes: string | null, location: string | null) => {
    if (!nativeModule) throw new Error('Apple Calendar is unavailable on this device.');
    return nativeModule.updateEvent(eventId, title, start, end, allDay, notes, location);
  },
  getEvent: async (eventId: string) => {
    if (!nativeModule) throw new Error('Apple Calendar is unavailable on this device.');
    return nativeModule.getEvent(eventId);
  },
  deleteEvent: async (eventId: string) => {
    if (!nativeModule) throw new Error('Apple Calendar is unavailable on this device.');
    return nativeModule.deleteEvent(eventId);
  },
};
