import { useState } from 'react'
import { Mail, Lock, Loader2 } from 'lucide-react'
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
    <div className='w-full max-w-md mx-auto p-8'>
      <div className='text-center mb-8'>
        <h1 className='text-3xl font-bold bg-linear-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent'>
          Ledger
        </h1>
        <p className='text-gray-500 text-sm mt-2'>{isSignUp ? 'Create an account' : 'Sign in to continue'}</p>
      </div>

      <form onSubmit={handleSubmit} className='space-y-4'>
        {isSignUp && (
          <div className='glass p-4 rounded-xl'>
            <label className='block text-sm font-medium text-gray-700 mb-2'>Full Name</label>
            <input
              type='text'
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder='John Doe'
              className='w-full px-3 py-2 bg-white/50 border border-white/30 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500'
              disabled={isLoading}
            />
          </div>
        )}

        <div className='glass p-4 rounded-xl'>
          <label className='block text-sm font-medium text-gray-700 mb-2'>Email</label>
          <div className='flex items-center gap-2 px-3 py-2 bg-white/50 border border-white/30 rounded-lg focus-within:ring-2 focus-within:ring-blue-500'>
            <Mail size={18} className='text-gray-400' />
            <input
              type='email'
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder='you@example.com'
              className='flex-1 bg-transparent outline-none'
              disabled={isLoading}
              required
            />
          </div>
        </div>

        <div className='glass p-4 rounded-xl'>
          <label className='block text-sm font-medium text-gray-700 mb-2'>Password</label>
          <div className='flex items-center gap-2 px-3 py-2 bg-white/50 border border-white/30 rounded-lg focus-within:ring-2 focus-within:ring-blue-500'>
            <Lock size={18} className='text-gray-400' />
            <input
              type='password'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder='••••••••'
              className='flex-1 bg-transparent outline-none'
              disabled={isLoading}
              required
            />
          </div>
        </div>

        {error && (
          <div className='p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-600'>
            {error}
          </div>
        )}

        <button
          type='submit'
          disabled={isLoading}
          className='w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2'
        >
          {isLoading && <Loader2 size={18} className='animate-spin' />}
          {isSignUp ? 'Create Account' : 'Sign In'}
        </button>

        <div className='text-center'>
          <button
            type='button'
            onClick={() => {
              setIsSignUp(!isSignUp)
              setError(null)
            }}
            className='text-sm text-gray-600 hover:text-gray-900'
          >
            {isSignUp ? 'Already have an account? Sign in' : 'Don\'t have an account? Sign up'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default LoginForm
