import { useState } from 'react'
import { Mail, Lock, Loader2 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'

interface LoginProps {
  onSuccess?: () => void
  notice?: string | null
}

export const LoginForm: React.FC<LoginProps> = ({ onSuccess, notice }) => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { signIn, signUp, isLoading } = useAuth()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    try {
      if (isSignUp) {
        await signUp(email, password, fullName)
      } else {
        await signIn(email, password)
      }
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    }
  }

  return (
    <div className='w-full px-8'>
      <div className='relative mx-auto w-full max-w-[390px]'>
        {/* Header */}
        <div className='mb-7 text-center'>
          <div className='mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[18px] border border-black/5 bg-white/80 shadow-[0_8px_24px_rgba(15,23,42,0.08)]'>
            <img src="/logo-color.svg" alt="Ledger" className="h-8 w-8" />
          </div>
          <h1 className='text-[28px] font-semibold leading-tight text-gray-950'>Ledger</h1>
          <p className='mt-1 text-sm text-gray-500'>{isSignUp ? 'Create your account' : 'Sign in to continue'}</p>
        </div>

        <form onSubmit={handleSubmit} className='space-y-3.5'>
          {notice && (
            <div className='rounded-2xl border border-amber-200/80 bg-amber-50/80 px-3.5 py-3 text-sm text-amber-800'>
              {notice}
            </div>
          )}

          {isSignUp && (
            <div>
              <label className='mb-1.5 block text-sm font-medium text-gray-700'>Full name</label>
              <input
                type='text'
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder='John Doe'
                className='w-full rounded-2xl border border-black/10 bg-white/70 px-4 py-2.5 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] transition-all placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-white/80'
                disabled={isLoading}
              />
            </div>
          )}

          <div>
            <label className='mb-1.5 block text-sm font-medium text-gray-700'>Email address</label>
            <div className='relative'>
              <Mail size={17} className='pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400' />
              <input
                type='email'
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder='you@example.com'
                className='w-full rounded-2xl border border-black/10 bg-white/70 py-2.5 pl-11 pr-4 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] transition-all placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-white/80'
                disabled={isLoading}
                required
              />
            </div>
          </div>

          <div>
            <label className='mb-1.5 block text-sm font-medium text-gray-700'>Password</label>
            <div className='relative'>
              <Lock size={17} className='pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400' />
              <input
                type='password'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder='Enter your password'
                className='w-full rounded-2xl border border-black/10 bg-white/70 py-2.5 pl-11 pr-4 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] transition-all placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-white/80'
                disabled={isLoading}
                required
              />
            </div>
          </div>

          {error && (
            <div className='flex items-start rounded-2xl border border-red-200/80 bg-red-50/80 px-3.5 py-3 text-sm text-red-700'>
              <div>
                <p className='font-medium'>Error</p>
                <p className='text-xs mt-0.5'>{error}</p>
              </div>
            </div>
          )}

          <button
            type='submit'
            disabled={isLoading}
            className='mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#FF5F40] py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(255,95,64,0.24)] transition-colors hover:bg-[#ea5336] disabled:cursor-not-allowed disabled:opacity-50'
          >
            {isLoading && <Loader2 size={18} className='animate-spin' />}
            {isSignUp ? 'Create Account' : 'Sign In'}
          </button>

          <div className='pt-2 text-center'>
            <button
              type='button'
              onClick={() => {
                setIsSignUp(!isSignUp)
                setError(null)
              }}
              className='text-sm font-medium text-gray-500 transition-colors hover:text-gray-900'
            >
              {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default LoginForm
