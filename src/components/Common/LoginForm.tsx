import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Mail, Lock, Loader2, X, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from './ToastProvider';

interface LoginProps {
  onSuccess?: () => void;
  notice?: string | null;
}

const PRELOGIN_SPLASH_STORAGE_KEY = 'ledger:prelogin-splash-seen:v1';
const dragRegionStyle = { WebkitAppRegion: 'drag' } as CSSProperties & {
  WebkitAppRegion: 'drag';
};
const noDragRegionStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties & {
  WebkitAppRegion: 'no-drag';
};
const inputClassName =
  'h-11 w-full rounded-2xl border border-(--ledger-border-subtle) bg-(--ledger-input-background) px-3.5 text-sm text-(--ledger-text-primary) transition placeholder:text-(--ledger-placeholder) focus:border-(--ledger-border-strong) focus:outline-none focus:ring-4 focus:ring-(--ledger-accent)/10';
const iconInputClassName =
  'h-11 w-full rounded-2xl border border-(--ledger-border-subtle) bg-(--ledger-input-background) pl-9 pr-3.5 text-sm text-(--ledger-text-primary) transition placeholder:text-(--ledger-placeholder) focus:border-(--ledger-border-strong) focus:outline-none focus:ring-4 focus:ring-(--ledger-accent)/10';
const authFrameClassName =
  'absolute inset-3 rounded-3xl border border-(--ledger-border-subtle) bg-(--ledger-background) shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]';
const authSurfaceClassName = 'relative z-10 h-full w-full overflow-hidden rounded-3xl bg-(--ledger-background)';
const authTextPrimaryClassName = 'text-(--ledger-text-primary)';
const authLabelClassName = 'mb-1.5 block text-xs font-medium text-(--ledger-text-secondary)';
const authChipClassName =
  'inline-flex h-8 w-8 items-center justify-center rounded-full border border-(--ledger-border-subtle) bg-(--ledger-surface-muted) text-(--ledger-text-muted) transition hover:bg-(--ledger-surface-hover) hover:text-(--ledger-text-primary)';

export const LoginForm: React.FC<LoginProps> = ({ onSuccess, notice }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isIntroReady, setIsIntroReady] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  });
  const [showPreLoginSplash, setShowPreLoginSplash] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
    return window.sessionStorage.getItem(PRELOGIN_SPLASH_STORAGE_KEY) !== 'true';
  });
  const [isSplashDismissing, setIsSplashDismissing] = useState(false);
  const preloginSplashDoneRef = useRef(false);
  const splashDismissTimerRef = useRef<number | null>(null);
  const { signIn, signUp, isLoading } = useAuth();
  const { show: showToast } = useToast();

  const handleCloseWindow = () => {
    void window.desktopWindow?.quitApp();
  };

  const triggerOnPrimaryMouseDown = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    handleCloseWindow();
  };

  const finishPreLoginSplash = () => {
    if (preloginSplashDoneRef.current) return;
    preloginSplashDoneRef.current = true;
    setIsSplashDismissing(true);
    setIsIntroReady(true);

    if (splashDismissTimerRef.current !== null) {
      window.clearTimeout(splashDismissTimerRef.current);
    }

    splashDismissTimerRef.current = window.setTimeout(() => {
      window.sessionStorage.setItem(PRELOGIN_SPLASH_STORAGE_KEY, 'true');
      setShowPreLoginSplash(false);
      setIsSplashDismissing(false);

      splashDismissTimerRef.current = null;
    }, 210);
  };

  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mediaQuery) return;

    const syncPreference = () => setPrefersReducedMotion(mediaQuery.matches);
    syncPreference();
    mediaQuery.addEventListener?.('change', syncPreference);
    return () => mediaQuery.removeEventListener?.('change', syncPreference);
  }, []);

  useEffect(() => {
    if (!showPreLoginSplash) return;

    const handleKeyDown = () => finishPreLoginSplash();
    const handlePointerDown = () => finishPreLoginSplash();
    const fallbackDelay = 1600;

    window.addEventListener('keydown', handleKeyDown, { once: true });
    window.addEventListener('pointerdown', handlePointerDown, { once: true });

    const fallbackTimer = window.setTimeout(() => {
      finishPreLoginSplash();
    }, fallbackDelay);

    return () => {
      window.clearTimeout(fallbackTimer);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [showPreLoginSplash]);

  useEffect(() => {
    if (showPreLoginSplash || isSplashDismissing) return;
    if (isIntroReady) return;

    if (prefersReducedMotion) {
      setIsIntroReady(true);
      return;
    }

    setIsIntroReady(true);
  }, [isIntroReady, prefersReducedMotion, showPreLoginSplash, isSplashDismissing]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      if (isSignUp) {
        await signUp(email, password, fullName);
      } else {
        await signIn(email, password);
      }
      onSuccess?.();
    } catch (err) {
      showToast(isSignUp ? 'Could not create account' : 'Could not sign in', {
        detail: err instanceof Error ? err.message : 'Authentication failed',
        variant: 'error',
        icon: 'alert',
      });
    }
  };

  useEffect(() => {
    return () => {
      if (splashDismissTimerRef.current !== null) {
        window.clearTimeout(splashDismissTimerRef.current);
      }
    };
  }, []);

  const splashOverlayVisible = (showPreLoginSplash || isSplashDismissing) && !prefersReducedMotion;
  const shouldPlayAuthIntro = isIntroReady && !prefersReducedMotion;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-transparent p-3">
      <div className={authFrameClassName} />
      <div className={authSurfaceClassName}>
        {!splashOverlayVisible && (
          <button
            type="button"
            onMouseDown={triggerOnPrimaryMouseDown}
            onClick={handleCloseWindow}
            aria-label="Close"
            className={authChipClassName + ' absolute right-6 top-7 z-30'}
            style={noDragRegionStyle}
          >
            <X size={16} />
          </button>
        )}

        {!splashOverlayVisible && (
          <div
            className="absolute inset-x-0 top-0 z-20 h-11"
            style={dragRegionStyle}
            aria-hidden="true"
          />
        )}

        {(showPreLoginSplash || isSplashDismissing) && (
          <div
            className={`absolute inset-0 z-20 bg-(--ledger-background) transition-opacity duration-200 ease-out ${
              showPreLoginSplash && !isSplashDismissing ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            aria-hidden={!splashOverlayVisible}
          >
            <div className="absolute inset-0 flex items-center justify-center p-6 sm:p-10">
              <div className="flex flex-col items-center text-center">
                <div className="relative flex h-28 w-28 items-center justify-center">
                  <span className="ledger-prelogin-ring ledger-prelogin-ring-1" />
                  <span className="ledger-prelogin-ring ledger-prelogin-ring-2" />
                  <span className="ledger-prelogin-ring ledger-prelogin-ring-3" />
                  <div className="ledger-prelogin-mark">
                    <img src="./logo-color.svg" alt="Ledger" className="h-12 w-12" />
                  </div>
                </div>
                <p className="mt-5 text-base font-medium tracking-[0.01em] text-(--ledger-text-primary)">
                  Ledger
                </p>
                <p className="mt-1 text-sm text-(--ledger-text-muted)">
                  Preparing your workspace
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="relative z-10 grid h-full min-h-full w-full overflow-hidden bg-(--ledger-background) min-[820px]:grid-cols-[0.42fr_0.58fr]">
        <div
          className={`relative hidden overflow-hidden bg-[linear-gradient(180deg,rgba(17,24,39,0.96),rgba(17,24,39,0.88))] min-[820px]:block ${
            prefersReducedMotion ? '' : shouldPlayAuthIntro ? 'ledger-auth-left-enter' : 'opacity-0'
          }`}
        >
          {prefersReducedMotion ? (
            <div className="flex h-full min-h-full items-center justify-center bg-(--ledger-background)">
              <img src="./logo-color.svg" alt="Ledger" className="h-16 w-16" />
            </div>
          ) : (
            <video
              className="absolute inset-0 h-full w-full object-cover object-[25%_center]"
              src="./welcome-vid.mp4"
              autoPlay
              muted
              playsInline
              preload="auto"
              loop
            />
          )}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(17,24,39,0.12),rgba(17,24,39,0.55)),linear-gradient(135deg,rgba(255,255,255,0.08),rgba(17,24,39,0.04))]" />
          <div className="absolute bottom-0 left-0 right-0 p-8 text-white">
            <p className="max-w-65 text-[24px] font-medium leading-0.5 [text-shadow:0_1px_12px_rgba(17,24,39,0.42)]">
              Live a little simpler.
            </p>
            <p className="mt-3 max-w-68.75 text-sm leading-3.3 text-white/90 [text-shadow:0_1px_10px_rgba(17,24,39,0.35)]">
              Capture tasks, notes, and follow-ups without losing context.
            </p>
          </div>
        </div>

        <div
          className={`flex h-full min-h-full items-center justify-center bg-(--ledger-background) px-7 py-10 sm:px-10 min-[820px]:px-16 ${
            prefersReducedMotion ? '' : shouldPlayAuthIntro ? 'ledger-auth-pane-enter' : 'opacity-0'
          }`}
        >
          <div className="w-full max-w-90">
            <div
              className={`mb-8 ${
                prefersReducedMotion
                  ? ''
                  : shouldPlayAuthIntro
                  ? 'ledger-auth-header-enter'
                  : 'opacity-0'
              }`}
            >
              <div className="mb-5 flex items-center gap-3">
                <img src="./logo-color.svg" alt="Ledger" className="h-10 w-10" />
                <h1 className={`text-[28px] font-medium leading-none ${authTextPrimaryClassName}`}>Ledger</h1>
              </div>
              <p className={`text-[22px] font-medium leading-tight ${authTextPrimaryClassName} transition-all duration-150 ease-out`}>
                {isSignUp ? 'Create your account' : 'Sign in to continue'}
              </p>
            </div>

            <form
              onSubmit={handleSubmit}
              className={`space-y-3 ${
                prefersReducedMotion
                  ? ''
                  : shouldPlayAuthIntro
                  ? 'ledger-auth-form-enter'
                  : 'opacity-0'
              }`}
            >
              {notice && (
                <div className="rounded-2xl border border-[rgba(245,158,11,0.2)] bg-[rgba(245,158,11,0.08)] px-3 py-2 text-xs leading-5 text-[#FCD34D]">
                  {notice}
                </div>
              )}

              <div className="transition-all duration-150 ease-out">
                {isSignUp && (
                  <div className="pb-3">
                    <label className={authLabelClassName}>Full name</label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Lex Ferguson"
                      className={inputClassName}
                      disabled={isLoading}
                    />
                  </div>
                )}
              </div>

              <div>
                <label className={authLabelClassName}>Email address</label>
                <div className="relative">
                  <Mail
                    size={15}
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-(--ledger-text-muted)"
                  />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className={iconInputClassName}
                    disabled={isLoading}
                    required
                  />
                </div>
              </div>

              <div>
                <label className={authLabelClassName}>Password</label>
                <div className="relative">
                  <Lock
                    size={15}
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-(--ledger-text-muted)"
                  />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className={iconInputClassName}
                    disabled={isLoading}
                    required
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-3.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-(--ledger-text-muted) transition hover:bg-(--ledger-surface-hover) hover:text-(--ledger-text-primary)"
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

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
                  }}
                  className="text-sm font-medium text-(--ledger-text-secondary) transition hover:text-(--ledger-text-primary)"
                >
                  {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
};

export default LoginForm;
