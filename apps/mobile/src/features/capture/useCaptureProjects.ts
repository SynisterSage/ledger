import { useEffect, useState } from 'react';

import { listMobileProjects } from '@/api/captures';
import type { MobileProjectOption } from '@/types/ledger';

type CaptureProjectsState = {
  projects: MobileProjectOption[];
  isLoading: boolean;
  error: string | null;
};

export function useCaptureProjects(workspaceId: string) {
  const [state, setState] = useState<CaptureProjectsState>({
    projects: [],
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!workspaceId || workspaceId === 'all') {
        if (!cancelled) {
          setState({ projects: [], isLoading: true, error: null });
        }
        return;
      }

      setState((current) => ({ ...current, isLoading: true, error: null }));

      try {
        const projects = await listMobileProjects(workspaceId);
        if (cancelled) return;
        setState({
          projects: Array.isArray(projects) ? projects : [],
          isLoading: false,
          error: null,
        });
      } catch (error) {
        if (cancelled) return;
        setState({
          projects: [],
          isLoading: false,
          error: error instanceof Error ? error.message : 'Could not load projects.',
        });
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  return state;
}
