import { useEffect, useMemo, useRef } from 'react';

import { supabase, supabaseConfigError } from '../services/supabase';

type UseWorkspaceRealtimeRefreshOptions = {
  workspaceId: string | null | undefined;
  tables: string[];
  enabled?: boolean;
  onChange: () => void;
  debounceMs?: number;
};

export function useWorkspaceRealtimeRefresh({
  workspaceId,
  tables,
  enabled = true,
  onChange,
  debounceMs = 180,
}: UseWorkspaceRealtimeRefreshOptions) {
  const timerRef = useRef<number | null>(null);
  const tablesKey = useMemo(() => [...new Set(tables.filter(Boolean))].sort().join('|'), [tables]);

  useEffect(() => {
    if (!enabled || !workspaceId || supabaseConfigError) {
      return;
    }

    const channelName = `ledger-realtime-${workspaceId}-${tablesKey || 'all'}`;
    const channel = supabase.channel(channelName);

    const scheduleRefresh = () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }

      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        onChange();
      }, debounceMs);
    };

    for (const table of new Set(tables.filter(Boolean))) {
      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          ...(workspaceId === 'all' ? {} : { filter: `workspace_id=eq.${workspaceId}` }),
        },
        () => {
          scheduleRefresh();
        },
      );
    }

    void channel.subscribe();

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      void supabase.removeChannel(channel);
    };
  }, [debounceMs, enabled, onChange, tablesKey, workspaceId]);
}
