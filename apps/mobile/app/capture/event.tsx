import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { EventForm } from '@/features/capture/EventForm';
import { bootstrapWorkspaceState } from '@/store/workspaceStore';

export default function EventCaptureScreen() {
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
      ? parsedStartsAt.toISOString().slice(0, 10)
      : undefined;
  const formattedStartTime =
    parsedStartsAt && !Number.isNaN(parsedStartsAt.getTime())
      ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(parsedStartsAt)
      : undefined;
  const formattedEndTime =
    parsedEndsAt && !Number.isNaN(parsedEndsAt.getTime())
      ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(parsedEndsAt)
      : undefined;

  useEffect(() => {
    void bootstrapWorkspaceState();
  }, []);

  return (
    <Screen scroll>
      <AppText variant="screenTitle">Event</AppText>
      <EventForm
        initialTitle={title}
        initialDateInput={formattedDate}
        initialStartTimeInput={formattedStartTime}
        initialEndTimeInput={formattedEndTime}
        initialLocation={location}
        initialNotes={description}
        autoSubmit={source === 'siri'}
        onSave={() => router.replace('/(tabs)/capture')}
      />
    </Screen>
  );
}
