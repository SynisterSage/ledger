import { Check, CircleAlert, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useAuthContext } from '../../context/AuthContext';

type Workspace = {
  id: string;
  name: string;
  slug?: string | null;
  role?: string | null;
};

type AuthorizationRequest = {
  scopes?: string[];
  expires_at?: string;
  workspaces?: Workspace[];
};

export const FigmaPluginAuthorizationPage = ({ sessionId, code }: { sessionId: string; code: string }) => {
  const { user } = useAuthContext();
  const api = useApi();
  const [state, setState] = useState<'loading' | 'ready' | 'busy' | 'approved' | 'error'>('loading');
  const [request, setRequest] = useState<AuthorizationRequest | null>(null);
  const [workspaceId, setWorkspaceId] = useState('');

  useEffect(() => {
    let active = true;
    void api.getFigmaPluginAuthorizationRequest(sessionId, code)
      .then((payload: AuthorizationRequest) => {
        if (!active) return;
        const firstWorkspace = payload.workspaces?.[0];
        setRequest(payload);
        setWorkspaceId(firstWorkspace?.id ?? '');
        setState(firstWorkspace ? 'ready' : 'error');
      })
      .catch(() => {
        if (active) setState('error');
      });
    return () => {
      active = false;
    };
  }, [api, code, sessionId]);

  const approve = async () => {
    if (!workspaceId) return;
    setState('busy');
    try {
      await api.approveFigmaPluginAuthorization(sessionId, code, workspaceId);
      setState('approved');
    } catch {
      setState('error');
    }
  };

  if (!user) return null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#080808] p-6 text-white">
      <section className="w-full max-w-[710px] rounded-2xl border border-white/[0.08] bg-[#151515] px-6 py-10 shadow-2xl sm:px-12" aria-labelledby="figma-plugin-auth-title">
        <div className="flex items-center justify-center gap-4" aria-hidden="true">
          <img src="/Figma-logo.svg" alt="" className="h-20 w-20 rounded-2xl" />
          <span className="text-2xl text-white/50">↔</span>
          <img src="/logo.svg" alt="" className="h-20 w-20 rounded-2xl bg-[#202020] p-3" />
        </div>

        {state === 'approved' ? (
          <div className="mt-7 text-center">
            <h1 id="figma-plugin-auth-title" className="text-2xl font-semibold tracking-tight">Figma successfully authenticated</h1>
            <p className="mt-2 text-base text-white/55">You can return to the Figma plugin.</p>
          </div>
        ) : (
          <>
            <h1 id="figma-plugin-auth-title" className="mt-7 text-center text-2xl font-semibold tracking-tight">Figma is requesting access</h1>
            <p className="mt-2 text-center text-base text-white/55">Select a workspace to authenticate</p>

            {state === 'error' ? (
              <p className="mx-auto mt-8 flex max-w-xl items-center justify-center gap-2 text-sm text-red-300" role="alert">
                <CircleAlert size={16} /> This authorization request is invalid, expired, or has no available workspace.
              </p>
            ) : (
              <>
                <label htmlFor="figma-workspace" className="mt-8 block text-sm font-medium text-white/60">Workspace to connect</label>
                <select
                  id="figma-workspace"
                  value={workspaceId}
                  onChange={(event) => setWorkspaceId(event.target.value)}
                  disabled={state === 'loading' || state === 'busy'}
                  className="mt-2 h-14 w-full rounded-xl border border-white/[0.08] bg-[#202020] px-4 text-base text-white outline-none transition focus:border-white/30 disabled:opacity-60"
                >
                  {request?.workspaces?.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void approve()}
                  disabled={!workspaceId || state === 'loading' || state === 'busy'}
                  className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {state === 'busy' && <Loader2 size={16} className="animate-spin" />}
                  Approve connection
                </button>
              </>
            )}
          </>
        )}

        {state === 'approved' && <p className="mt-3 flex items-center justify-center gap-2 text-sm text-emerald-300" role="status"><Check size={16} /> Connection approved</p>}
      </section>
    </main>
  );
};
