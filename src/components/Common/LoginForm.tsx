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
    <div className='flex items-center justify-center min-h-screen bg-white p-4'>
      <div className='w-full max-w-md'>
        {/* Header */}
        <div className='mb-12'>
          <div className='inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-white border border-gray-200 shadow-sm mb-6'>
            <img src="/logo-color.svg" alt="Ledger" className="h-7 w-7" />
          </div>
          <h1 className='text-3xl font-semibold text-gray-900 mb-2'>Ledger</h1>
          <p className='text-base text-gray-600'>{isSignUp ? 'Create your account' : 'Sign in to continue'}</p>
        </div>

        <form onSubmit={handleSubmit} className='space-y-5'>
          {notice && (
            <div className='p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800'>
              {notice}
            </div>
          )}

          {isSignUp && (
            <div>
              <label className='block text-sm font-medium text-gray-700 mb-2'>Full Name</label>
              <input
                type='text'
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder='John Doe'
                className='w-full px-4 py-3 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900 transition-all'
                disabled={isLoading}
              />
            </div>
          )}

          <div>
            <label className='block text-sm font-medium text-gray-700 mb-2'>Email address</label>
            <div className='relative'>
              <Mail size={18} className='absolute left-3.5 top-3.5 text-gray-400 pointer-events-none' />
              <input
                type='email'
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder='you@example.com'
                className='w-full pl-11 pr-4 py-3 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900 transition-all'
                disabled={isLoading}
                required
              />
            </div>
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 mb-2'>Password</label>
            <div className='relative'>
              <Lock size={18} className='absolute left-3.5 top-3.5 text-gray-400 pointer-events-none' />
              <input
                type='password'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder='Enter your password'
                className='w-full pl-11 pr-4 py-3 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900 transition-all'
                disabled={isLoading}
                required
              />
            </div>
          </div>

          {error && (
            <div className='p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-start'>
              <div>
                <p className='font-medium'>Error</p>
                <p className='text-xs mt-0.5'>{error}</p>
              </div>
            </div>
          )}

          <button
            type='submit'
            disabled={isLoading}
            className='w-full py-3 bg-[#FF5F40] hover:bg-[#ea5336] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 mt-8'
          >
            {isLoading && <Loader2 size={18} className='animate-spin' />}
            {isSignUp ? 'Create Account' : 'Sign In'}
          </button>

          <div className='text-center pt-2'>
            <button
              type='button'
              onClick={() => {
                setIsSignUp(!isSignUp)
                setError(null)
              }}
              className='text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors'
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
