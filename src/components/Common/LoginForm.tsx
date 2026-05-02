import { useState } from 'react'
import { ArrowRight, Lock, Loader2, Mail } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'

interface LoginProps {
  onSuccess?: () => void
}

export const LoginForm: React.FC<LoginProps> = ({ onSuccess }) => {
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
    <div className='relative min-h-screen overflow-hidden bg-gray-50 px-4 py-6 text-gray-900'>
      <div className='absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.9),rgba(248,250,252,1)_55%)]' />

      <div className='mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-[460px] items-center'>
        <div className='w-full rounded-[24px] border border-gray-200 bg-white p-6 shadow-sm sm:p-7'>
          <div className='mb-5'>
            <div className='mb-4 inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-gray-200 bg-white shadow-sm'>
              <span className='text-base font-semibold text-gray-900'>L</span>
            </div>
            <h2 className='text-2xl font-semibold tracking-tight text-gray-900'>
              {isSignUp ? 'Create your Ledger account' : 'Sign in to Ledger'}
            </h2>
            <p className='mt-2 text-sm leading-6 text-gray-600'>
              {isSignUp ? 'Set up your workspace and start tracking work.' : 'Continue where you left off.'}
            </p>
          </div>

          <div className='mb-5 grid grid-cols-2 rounded-2xl border border-gray-200 bg-gray-50 p-1 text-sm font-medium'>
            <button
              type='button'
              onClick={() => {
                setIsSignUp(false)
                setError(null)
              }}
              className={`rounded-xl px-3 py-2 transition-colors ${
                !isSignUp ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Sign in
            </button>
            <button
              type='button'
              onClick={() => {
                setIsSignUp(true)
                setError(null)
              }}
              className={`rounded-xl px-3 py-2 transition-colors ${
                isSignUp ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Sign up
            </button>
          </div>

          <form onSubmit={handleSubmit} className='space-y-4'>
            <div className={`overflow-hidden transition-all duration-200 ${isSignUp ? 'mb-1 max-h-24 opacity-100' : 'max-h-0 opacity-0'}`}>
              <label className='mb-2 block text-sm font-medium text-gray-700'>Full name</label>
              <input
                type='text'
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder='John Doe'
                className='w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-gray-900 placeholder:text-gray-400 shadow-sm outline-none transition focus:border-gray-300 focus:ring-4 focus:ring-gray-100'
                disabled={isLoading}
              />
            </div>

            <div>
              <label className='mb-2 block text-sm font-medium text-gray-700'>Email</label>
              <div className='relative'>
                <Mail size={18} className='pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400' />
                <input
                  type='email'
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder='you@example.com'
                  className='w-full rounded-2xl border border-gray-200 bg-white py-3 pl-11 pr-4 text-gray-900 placeholder:text-gray-400 shadow-sm outline-none transition focus:border-gray-300 focus:ring-4 focus:ring-gray-100'
                  disabled={isLoading}
                  required
                />
              </div>
            </div>

            <div>
              <label className='mb-2 block text-sm font-medium text-gray-700'>Password</label>
              <div className='relative'>
                <Lock size={18} className='pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400' />
                <input
                  type='password'
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder='Enter your password'
                  className='w-full rounded-2xl border border-gray-200 bg-white py-3 pl-11 pr-4 text-gray-900 placeholder:text-gray-400 shadow-sm outline-none transition focus:border-gray-300 focus:ring-4 focus:ring-gray-100'
                  disabled={isLoading}
                  required
                />
              </div>
            </div>

            {error && (
              <div className='rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700'>
                <p className='font-medium'>Could not sign in</p>
                <p className='mt-0.5 text-xs leading-5'>{error}</p>
              </div>
            )}

            <button
              type='submit'
              disabled={isLoading}
              className='mt-1 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gray-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50'
            >
              {isLoading && <Loader2 size={18} className='animate-spin' />}
              {isSignUp ? 'Create account' : 'Sign in'}
              {!isLoading && <ArrowRight size={16} />}
            </button>

            <p className='pt-1 text-center text-xs leading-5 text-gray-500'>
              Your workspace stays tied to your account, so you can return from desktop anytime.
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}

export default LoginForm
