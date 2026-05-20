import { useEffect, useRef, useState } from 'react';
import { Mail, Lock, Loader2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

interface LoginProps {
  onSuccess?: () => void;
  notice?: string | null;
}

export const LoginForm: React.FC<LoginProps> = ({ onSuccess, notice }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [activeLoopLayer, setActiveLoopLayer] = useState<0 | 1>(0);
  const videoRefs = useRef<[HTMLVideoElement | null, HTMLVideoElement | null]>([null, null]);
  const loopSwapTimerRef = useRef<number | null>(null);
  const { signIn, signUp, isLoading } = useAuth();

  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mediaQuery) return;

    const syncPreference = () => setPrefersReducedMotion(mediaQuery.matches);
    syncPreference();
    mediaQuery.addEventListener?.('change', syncPreference);
    return () => mediaQuery.removeEventListener?.('change', syncPreference);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      if (isSignUp) {
        await signUp(email, password, fullName);
      } else {
        await signIn(email, password);
      }
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    }
  };

  const queueLoopSwap = () => {
    if (loopSwapTimerRef.current !== null || prefersReducedMotion) return;

    const currentLayer = activeLoopLayer;
    const nextLayer = currentLayer === 0 ? 1 : 0;
    const currentVideo = videoRefs.current[currentLayer];
    const nextVideo = videoRefs.current[nextLayer];
    if (!currentVideo || !nextVideo) return;

    try {
      nextVideo.currentTime = 0;
    } catch {
      // Ignore brief seek race conditions while the clip is loading.
    }

    void nextVideo.play().catch(() => {
      // Ignore autoplay restrictions or brief decoder stalls.
    });

    loopSwapTimerRef.current = window.setTimeout(() => {
      setActiveLoopLayer(nextLayer);
      try {
        currentVideo.pause();
        currentVideo.currentTime = 0;
      } catch {
        // No-op.
      }
      loopSwapTimerRef.current = null;
    }, 280);
  };

  useEffect(() => {
    return () => {
      if (loopSwapTimerRef.current !== null) {
        window.clearTimeout(loopSwapTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="grid h-full min-h-screen w-full overflow-hidden bg-[#F9FBFA] min-[820px]:grid-cols-[0.42fr_0.58fr]">
      <div className="relative hidden overflow-hidden bg-[#F9FBFA] min-[820px]:block">
        {prefersReducedMotion ? (
          <div className="flex h-full min-h-screen items-center justify-center bg-[#F9FBFA]">
            <img src="./logo-color.svg" alt="Ledger" className="h-16 w-16" />
          </div>
        ) : (
          <>
            {[0, 1].map((layer) => (
              <video
                key={layer}
                ref={(element) => {
                  videoRefs.current[layer as 0 | 1] = element;
                }}
                className={`absolute inset-0 h-full w-full object-cover object-[25%_center] transition-opacity duration-300 ease-out ${
                  activeLoopLayer === layer ? 'opacity-100' : 'opacity-0'
                }`}
                src="./welcome-vid.mp4"
                autoPlay={layer === 0}
                muted
                playsInline
                preload="auto"
                onEnded={queueLoopSwap}
                onTimeUpdate={(event) => {
                  if (layer !== activeLoopLayer) return;
                  const video = event.currentTarget;
                  if (video.duration && Number.isFinite(video.duration)) {
                    const remaining = video.duration - video.currentTime;
                    if (remaining > 0 && remaining < 0.7) {
                      queueLoopSwap();
                    }
                  }
                }}
              />
            ))}
          </>
        )}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(17,24,39,0.04),rgba(17,24,39,0.34)),linear-gradient(135deg,rgba(255,255,255,0.12),rgba(249,251,250,0.12))]" />
        <div className="absolute bottom-0 left-0 right-0 p-8 text-white">
          <p className="max-w-[260px] text-[24px] font-semibold leading-0.5 [text-shadow:0_1px_12px_rgba(17,24,39,0.42)]">
            Live a little simpler.
          </p>
          <p className="mt-3 max-w-[275px] text-sm leading-6 text-white/90 [text-shadow:0_1px_10px_rgba(17,24,39,0.35)]">
            Capture tasks, notes, and follow-ups without losing context.
          </p>
        </div>
      </div>

      <div className="flex min-h-screen items-center justify-center bg-[#F9FBFA] px-7 py-10 sm:px-10 min-[820px]:px-16">
        <div className="w-full max-w-[360px]">
          <div className="mb-8">
            <div className="mb-5 flex items-center gap-3">
              <img src="./logo-color.svg" alt="Ledger" className="h-10 w-10" />
              <h1 className="text-[28px] font-semibold leading-none text-gray-950">Ledger</h1>
            </div>
            <p className="text-[22px] font-semibold leading-tight text-gray-950 transition-all duration-150 ease-out">
              {isSignUp ? 'Create your account' : 'Sign in to continue'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {notice && (
              <div className="rounded-2xl border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs leading-5 text-amber-800">
                {notice}
              </div>
            )}

            <div className="transition-all duration-150 ease-out">
              {isSignUp && (
                <div className="pb-3">
                  <label className="mb-1.5 block text-xs font-medium text-gray-700">
                    Full name
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Lex Ferguson"
                    className="h-11 w-full rounded-2xl border border-black/10 bg-white/82 px-3.5 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] transition placeholder:text-gray-400 focus:border-gray-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-gray-100"
                    disabled={isLoading}
                  />
                </div>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-700">
                Email address
              </label>
              <div className="relative">
                <Mail
                  size={15}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="h-11 w-full rounded-2xl border border-black/10 bg-white/82 pl-9 pr-3.5 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] transition placeholder:text-gray-400 focus:border-gray-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-gray-100"
                  disabled={isLoading}
                  required
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-700">Password</label>
              <div className="relative">
                <Lock
                  size={15}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="h-11 w-full rounded-2xl border border-black/10 bg-white/82 pl-9 pr-3.5 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] transition placeholder:text-gray-400 focus:border-gray-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-gray-100"
                  disabled={isLoading}
                  required
                />
              </div>
            </div>

            {error && (
              <div className="rounded-2xl border border-red-200/80 bg-red-50/80 px-3 py-2 text-xs leading-5 text-red-700">
                <p className="font-medium">Error</p>
                <p className="mt-0.5 text-[11px]">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#FF5F40] text-sm font-semibold text-white shadow-[0_10px_22px_rgba(255,95,64,0.15)] transition hover:bg-[#ea5336] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading && <Loader2 size={16} className="animate-spin" />}
              {isSignUp ? 'Create Account' : 'Sign In'}
            </button>

            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setError(null);
                }}
                className="text-sm font-medium text-gray-500 transition hover:text-gray-950"
              >
                {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
              </button>
            </div>
          </form>
          </div>
        </div>
    </div>
  );
};

export default LoginForm;
