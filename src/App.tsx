import { CheckCircle2, Clock, Folder, Plus, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import { useAuthContext } from './context/AuthContext'
import { useWorkspaceInit } from './hooks/useWorkspaceInit'
import { useSidebar } from './context/SidebarContext'
import { MainLayout } from './components/Common/MainLayout'
import LoginForm from './components/Common/LoginForm'
import CalendarWindow from './components/Calendar/CalendarWindow'
import { supabase } from './services/supabase'

type PostAuthStage = 'idle' | 'loading' | 'onboarding' | 'welcome' | 'ready'
type ModuleKind = 'calendar' | null

const windowParams = new URLSearchParams(window.location.search)
const isModuleWindow = windowParams.get('window') === 'module'
const moduleKind = (windowParams.get('module') as ModuleKind) ?? null

// Dashboard content component
function DashboardContent() {
  const { user } = useAuthContext()
  const { state, setState } = useSidebar()

  return (
    <>
      <div
        className='h-8 bg-white border-b border-gray-100'
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      />
      {/* Header */}
      <div
        className='h-16 border-b border-gray-200 flex items-center justify-between px-8 bg-white'
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      >
        <div>
          {state === 'fullscreen' && (
            <div className='flex items-center gap-3'>
              <button
                onClick={() => setState('minimized')}
                className='px-3 py-1 text-sm font-medium text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-lg transition flex items-center gap-1.5'
                style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
              >
                <ChevronLeft size={14} />
                Collapse
              </button>
              <h1 className='text-lg font-semibold text-gray-900'>Ledger</h1>
            </div>
          )}
          {state !== 'fullscreen' && (
            <>
              <p className='text-xs text-gray-500'>Workspace</p>
              <h1 className='text-lg font-semibold text-gray-900 mt-0.5'>My Work</h1>
            </>
          )}
        </div>
        <button
          className='px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-lg flex items-center gap-2 transition-colors text-sm font-medium'
          style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
        >
          <Plus size={16} />
          New Task
        </button>
      </div>

      {/* Content */}
      <div className='flex-1 p-8 overflow-auto'>
        <div className='max-w-6xl'>
          {/* Welcome Section */}
          <div className='mb-10'>
            <h2 className='text-2xl font-semibold text-gray-900 mb-1'>Welcome, {user?.email?.split('@')[0]}</h2>
            <p className='text-sm text-gray-600'>Here's what you need to focus on today</p>
          </div>

          {/* Quick Stats */}
          <div className='grid grid-cols-3 gap-6 mb-12'>
            {/* Tasks Today */}
            <div className='p-6 bg-gray-50 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors'>
              <div className='flex items-center justify-between mb-4'>
                <div className='text-sm font-medium text-gray-600'>Tasks Today</div>
                <CheckCircle2 size={18} className='text-blue-600' />
              </div>
              <div className='text-3xl font-semibold text-gray-900 mb-1'>0</div>
              <p className='text-xs text-gray-500'>All caught up!</p>
            </div>

            {/* Hours Logged */}
            <div className='p-6 bg-gray-50 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors'>
              <div className='flex items-center justify-between mb-4'>
                <div className='text-sm font-medium text-gray-600'>Hours Logged</div>
                <Clock size={18} className='text-green-600' />
              </div>
              <div className='text-3xl font-semibold text-gray-900 mb-1'>0h</div>
              <p className='text-xs text-gray-500'>Start tracking your time</p>
            </div>

            {/* Projects */}
            <div className='p-6 bg-gray-50 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors'>
              <div className='flex items-center justify-between mb-4'>
                <div className='text-sm font-medium text-gray-600'>Active Projects</div>
                <Folder size={18} className='text-purple-600' />
              </div>
              <div className='text-3xl font-semibold text-gray-900 mb-1'>0</div>
              <p className='text-xs text-gray-500'>Create your first project</p>
            </div>
          </div>

          {/* Getting Started */}
          <div className='p-6 bg-blue-50 rounded-lg border border-blue-200'>
            <h3 className='text-sm font-semibold text-gray-900 mb-2'>Getting started</h3>
            <p className='text-sm text-gray-700 mb-4'>Start by creating a task or setting up your first project to begin tracking your work.</p>
            <div className='flex gap-3'>
              <button className='px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2'>
                Create Task
                <ChevronRight size={14} />
              </button>
              <button className='px-4 py-2 bg-white hover:bg-gray-50 text-gray-900 border border-gray-200 rounded-lg text-sm font-medium transition-colors'>
                Learn More
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// Main app component
function App() {
  const { user, isLoading } = useAuthContext()
  const { state, setState } = useSidebar()
  const [uiMode, setUiMode] = useState<'auth' | 'app'>(user ? 'app' : 'auth')
  const [isAuthExiting, setIsAuthExiting] = useState(false)
  const [postAuthStage, setPostAuthStage] = useState<PostAuthStage>('idle')
  const [isSavingOnboarding, setIsSavingOnboarding] = useState(false)
  
  // Initialize workspace for authenticated users
  useWorkspaceInit()

  if (isModuleWindow) {
    if (isLoading) {
      return (
        <div className='flex h-screen items-center justify-center bg-white'>
          <div className='text-center'>
            <div className='w-10 h-10 border-2 border-gray-200 border-t-gray-900 rounded-full animate-spin mx-auto mb-3'></div>
            <p className='text-sm text-gray-600'>Loading module...</p>
          </div>
        </div>
      )
    }

    if (!user) {
      return (
        <div className='flex h-screen items-center justify-center bg-white p-6'>
          <div className='max-w-sm text-center'>
            <h2 className='text-lg font-semibold text-gray-900 mb-2'>Sign in required</h2>
            <p className='text-sm text-gray-600'>Please sign in from the Ledger sidebar window first.</p>
          </div>
        </div>
      )
    }

    if (moduleKind === 'calendar') {
      return <CalendarWindow />
    }

    return (
      <div className='flex h-screen items-center justify-center bg-white'>
        <p className='text-sm text-gray-600'>Unknown module</p>
      </div>
    )
  }

  useEffect(() => {
    if (isLoading) return

    if (user && uiMode === 'auth') {
      setIsAuthExiting(true)
      const timer = window.setTimeout(() => {
        setUiMode('app')
        setIsAuthExiting(false)
      }, 260)

      return () => window.clearTimeout(timer)
    }

    if (!user && uiMode !== 'auth') {
      setUiMode('auth')
      setIsAuthExiting(false)
      setPostAuthStage('idle')
    }
  }, [user, isLoading, uiMode])

  useEffect(() => {
    if (isLoading || !user || uiMode !== 'app' || postAuthStage !== 'idle') return

    let isCancelled = false

    const loadPostAuthStage = async () => {
      try {
        setPostAuthStage('loading')

        const { data, error } = await supabase
          .from('users' as never)
          .select('onboarding_completed')
          .eq('id', user.id)
          .maybeSingle()

        if (isCancelled) return

        if (error) {
          console.warn('Failed to load onboarding state:', error.message)
          setPostAuthStage('welcome')
          return
        }

        const onboardingCompleted = Boolean((data as { onboarding_completed?: boolean } | null)?.onboarding_completed)
        setPostAuthStage(onboardingCompleted ? 'welcome' : 'onboarding')
      } catch (error) {
        if (isCancelled) return
        console.warn('Unexpected onboarding state error:', error)
        setPostAuthStage('welcome')
      }
    }

    loadPostAuthStage()

    return () => {
      isCancelled = true
    }
  }, [isLoading, user, uiMode, postAuthStage])

  useEffect(() => {
    if (postAuthStage !== 'loading') return

    const timeout = window.setTimeout(() => {
      setPostAuthStage('welcome')
    }, 4000)

    return () => window.clearTimeout(timeout)
  }, [postAuthStage])

  useEffect(() => {
    if (postAuthStage !== 'welcome') return

    const openTimer = window.setTimeout(() => {
      setState('expanded')
    }, 80)

    const closeTimer = window.setTimeout(() => {
      setState('minimized')
      setPostAuthStage('ready')
    }, 680)

    return () => {
      window.clearTimeout(openTimer)
      window.clearTimeout(closeTimer)
    }
  }, [postAuthStage, setState])

  useEffect(() => {
    if (isLoading) return

    const isCenteredFlow =
      uiMode === 'auth' ||
      postAuthStage === 'loading' ||
      postAuthStage === 'onboarding' ||
      postAuthStage === 'welcome'

    const mode = isCenteredFlow ? 'auth' : state
    window.desktopWindow?.setMode(mode).catch(() => {
      // No-op outside Electron (browser dev mode)
    })
  }, [isLoading, state, uiMode, postAuthStage])

  if (isLoading) {
    return (
      <div className='flex h-screen items-center justify-center bg-white'>
        <div className='text-center'>
          <div className='w-12 h-12 border-2 border-gray-200 border-t-gray-900 rounded-full animate-spin mx-auto mb-4'></div>
          <p className='text-gray-600 text-sm'>Loading...</p>
        </div>
      </div>
    )
  }

  // Show login if not authenticated
  if (uiMode === 'auth' && user) {
    return (
      <div className='flex h-screen items-center justify-center bg-white'>
        <div className='text-center'>
          <div className='w-10 h-10 border-2 border-gray-200 border-t-gray-900 rounded-full animate-spin mx-auto mb-3'></div>
          <p className='text-sm text-gray-600'>Restoring your session...</p>
        </div>
      </div>
    )
  }

  if (uiMode === 'auth') {
    return (
      <div className='flex h-screen items-center justify-center bg-white'>
        <div
          className={`transform transition-all duration-250 ease-out ${
            isAuthExiting ? 'opacity-0 scale-95 translate-y-2' : 'opacity-100 scale-100 translate-y-0'
          }`}
        >
          <LoginForm />
        </div>
      </div>
    )
  }

  if (postAuthStage === 'loading') {
    return (
      <div className='flex h-screen items-center justify-center bg-white'>
        <div className='text-center'>
          <div className='w-10 h-10 border-2 border-gray-200 border-t-gray-900 rounded-full animate-spin mx-auto mb-3'></div>
          <p className='text-sm text-gray-600'>Preparing your workspace...</p>
        </div>
      </div>
    )
  }

  if (postAuthStage === 'onboarding') {
    return (
      <div className='flex h-screen items-center justify-center bg-white p-6'>
        <div className='w-full max-w-lg border border-gray-200 rounded-2xl p-8 shadow-sm'>
          <h2 className='text-2xl font-semibold text-gray-900 mb-2'>Welcome to Ledger</h2>
          <p className='text-sm text-gray-600 mb-6'>Quick setup for your first workspace and team flow.</p>
          <div className='space-y-3 mb-8'>
            <div className='flex items-start gap-3'>
              <CheckCircle2 size={18} className='text-green-600 mt-0.5' />
              <p className='text-sm text-gray-700'>Your personal workspace is ready.</p>
            </div>
            <div className='flex items-start gap-3'>
              <CheckCircle2 size={18} className='text-green-600 mt-0.5' />
              <p className='text-sm text-gray-700'>Invite teammates later from the dashboard.</p>
            </div>
            <div className='flex items-start gap-3'>
              <CheckCircle2 size={18} className='text-green-600 mt-0.5' />
              <p className='text-sm text-gray-700'>Use the sidebar widget to quickly track tasks and time.</p>
            </div>
          </div>
          <button
            disabled={isSavingOnboarding}
            onClick={async () => {
              if (!user || isSavingOnboarding) return
              setIsSavingOnboarding(true)

              await supabase
                .from('users' as never)
                .update({
                  onboarding_completed: true,
                  onboarding_completed_at: new Date().toISOString(),
                } as never)
                .eq('id', user.id)

              setIsSavingOnboarding(false)
              setPostAuthStage('welcome')
            }}
            className='w-full py-3 bg-gray-900 hover:bg-gray-800 disabled:opacity-60 text-white font-medium rounded-lg transition-colors'
          >
            {isSavingOnboarding ? 'Saving...' : 'Continue to Ledger'}
          </button>
        </div>
      </div>
    )
  }

  if (postAuthStage === 'welcome') {
    return (
      <div className='flex h-screen items-center justify-center bg-white'>
        <div className='text-center animate-pulse'>
          <h2 className='text-2xl font-semibold text-gray-900 mb-2'>Welcome back</h2>
          <p className='text-sm text-gray-600'>Opening your sidebar...</p>
        </div>
      </div>
    )
  }

  // Authenticated view - Dashboard with sidebar
  return (
    <MainLayout>
      <DashboardContent />
    </MainLayout>
  )
}

export default App
