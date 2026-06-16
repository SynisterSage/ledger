import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { CaptureHeader } from '@/components/CaptureHeader';
import { Screen } from '@/components/Screen';
import { EventForm } from '@/features/capture/EventForm';
import { bootstrapWorkspaceState } from '@/store/workspaceStore';
import { useLedgerTheme } from '@/theme';
import { formatDateToLocalIsoDate } from '@/utils/captureDates';

export default function EventCaptureScreen() {
  const theme = useLedgerTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    title?: string | string[];
    startsAt?: string | string[];
    endsAt?: string | string[];
    location?: string | string[];
    description?: string | string[];
    source?: string | string[];
  }>();

  const title = Array.isArray(params.title) ? params.title[0] : params.title;
  const startsAt = Array.isArray(params.startsAt) ? params.startsAt[0] : params.startsAt;
  const endsAt = Array.isArray(params.endsAt) ? params.endsAt[0] : params.endsAt;
  const location = Array.isArray(params.location) ? params.location[0] : params.location;
  const description = Array.isArray(params.description) ? params.description[0] : params.description;
  const source = Array.isArray(params.source) ? params.source[0] : params.source;
  const parsedStartsAt = startsAt ? new Date(startsAt) : null;
  const parsedEndsAt = endsAt ? new Date(endsAt) : null;
  const formattedDate =
    parsedStartsAt && !Number.isNaN(parsedStartsAt.getTime())
      ? formatDateToLocalIsoDate(parsedStartsAt)
      : undefined;
  const formattedStartTime =
    parsedStartsAt && !Number.isNaN(parsedStartsAt.getTime())
      ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(parsedStartsAt)
      : undefined;
  const formattedEndTime =
    parsedEndsAt && !Number.isNaN(parsedEndsAt.getTime())
      ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(parsedEndsAt)
      : undefined;
  const isSiri = source === 'siri';
  const saveDestination = isSiri ? '/(tabs)/today' : '/(tabs)/capture';
  const formKey = isSiri
    ? ['siri-event', title ?? '', startsAt ?? '', endsAt ?? '', location ?? '', description ?? ''].join(':')
    : 'manual-event';

  useEffect(() => {
    void bootstrapWorkspaceState();
  }, []);

  return (
    <Screen contentStyle={{ paddingTop: theme.spacing.lg }}>
      <CaptureHeader title="Event" />
      <EventForm
        key={formKey}
        initialTitle={title}
        initialDateInput={formattedDate}
        initialStartTimeInput={formattedStartTime}
        initialEndTimeInput={formattedEndTime}
        initialLocation={location}
        initialNotes={description}
        onSave={() => router.replace(saveDestination)}
      />
    </Screen>
  );
}
