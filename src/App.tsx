import { useState } from 'react'
import { CheckCircle2, Clock, Folder, Plus, LogOut } from 'lucide-react'
import { useAuthContext } from './context/AuthContext'
import { useWorkspaceInit } from './hooks/useWorkspaceInit'
import LoginForm from './components/Common/LoginForm'

function App() {
  const [count, setCount] = useState(0)
  const { user, isLoading, signOut } = useAuthContext()
  
  // Initialize workspace for authenticated users
  useWorkspaceInit()

  if (isLoading) {
    return (
      <div className='flex h-screen items-center justify-center bg-linear-to-br from-gray-50 via-white to-gray-50'>
        <div className='text-center'>
          <div className='w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4'></div>
          <p className='text-gray-600'>Loading...</p>
        </div>
      </div>
    )
  }

  // Show login if not authenticated
  if (!user) {
    return (
      <div className='flex h-screen items-center justify-center bg-linear-to-br from-gray-50 via-white to-gray-50'>
        <LoginForm />
      </div>
    )
  }

  // Authenticated view - Dashboard
  return (
    <div className='flex h-screen bg-linear-to-br from-gray-50 via-white to-gray-50'>
      {/* Sidebar Widget - Minimalist */}
      <div className='w-20 bg-white/40 backdrop-blur-lg border-r border-white/30 flex flex-col items-center justify-between pt-6 pb-6'>
        <div className='flex flex-col items-center gap-6'>
          <div className='w-10 h-10 bg-linear-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-lg cursor-pointer hover:shadow-lg hover:shadow-blue-500/30 transition-all'>
            L
          </div>
          <nav className='flex flex-col gap-3'>
            <div className='w-8 h-8 hover:bg-white/30 rounded-lg flex items-center justify-center cursor-pointer transition-colors'>
              <CheckCircle2 size={18} className='text-gray-600' />
            </div>
            <div className='w-8 h-8 hover:bg-white/30 rounded-lg flex items-center justify-center cursor-pointer transition-colors'>
              <Clock size={18} className='text-gray-600' />
            </div>
            <div className='w-8 h-8 hover:bg-white/30 rounded-lg flex items-center justify-center cursor-pointer transition-colors'>
              <Folder size={18} className='text-gray-600' />
            </div>
          </nav>
        </div>

        {/* Sign out button */}
        <button
          onClick={() => signOut()}
          className='w-8 h-8 hover:bg-white/30 rounded-lg flex items-center justify-center cursor-pointer transition-colors text-gray-600 hover:text-gray-900'
          title='Sign out'
        >
          <LogOut size={18} />
        </button>
      </div>

      {/* Main Content */}
      <div className='flex-1 flex flex-col'>
        {/* Header - Glass Morphism */}
        <div className='h-20 border-b border-white/30 flex items-center justify-between px-8 bg-white/30 backdrop-blur-md'>
          <div>
            <h1 className='text-3xl font-bold bg-linear-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent'>Ledger</h1>
            <p className='text-xs text-gray-500 mt-1'>Welcome, {user.email}</p>
          </div>
          <button className='px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 rounded-lg flex items-center gap-2 transition-colors border border-blue-500/20'>
            <Plus size={18} />
            New
          </button>
        </div>

        {/* Content Area */}
        <div className='flex-1 p-8 overflow-auto'>
          <div className='max-w-6xl'>
            {/* Welcome Section */}
            <div className='mb-8'>
              <h2 className='text-2xl font-semibold text-gray-900 mb-2'>Today's Overview</h2>
              <p className='text-gray-500 text-sm'>Stay focused on what matters</p>
            </div>

            {/* Quick Stats - Glass Cards */}
            <div className='grid grid-cols-3 gap-6 mb-8'>
              <div className='group p-6 bg-white/40 backdrop-blur-md rounded-2xl border border-white/50 hover:bg-white/60 hover:border-white/80 transition-all cursor-pointer shadow-sm hover:shadow-md'>
                <div className='flex items-center gap-3 mb-3'>
                  <div className='p-2 bg-blue-500/10 rounded-lg'>
                    <CheckCircle2 size={20} className='text-blue-600' />
                  </div>
                  <span className='text-sm font-medium text-gray-600'>Tasks Today</span>
                </div>
                <div className='text-4xl font-bold text-gray-900'>0</div>
                <p className='text-xs text-gray-500 mt-2'>All caught up!</p>
              </div>

              <div className='group p-6 bg-white/40 backdrop-blur-md rounded-2xl border border-white/50 hover:bg-white/60 hover:border-white/80 transition-all cursor-pointer shadow-sm hover:shadow-md'>
                <div className='flex items-center gap-3 mb-3'>
                  <div className='p-2 bg-green-500/10 rounded-lg'>
                    <Clock size={20} className='text-green-600' />
                  </div>
                  <span className='text-sm font-medium text-gray-600'>Hours Logged</span>
                </div>
                <div className='text-4xl font-bold text-gray-900'>0h</div>
                <p className='text-xs text-gray-500 mt-2'>Start tracking now</p>
              </div>

              <div className='group p-6 bg-white/40 backdrop-blur-md rounded-2xl border border-white/50 hover:bg-white/60 hover:border-white/80 transition-all cursor-pointer shadow-sm hover:shadow-md'>
                <div className='flex items-center gap-3 mb-3'>
                  <div className='p-2 bg-purple-500/10 rounded-lg'>
                    <Folder size={20} className='text-purple-600' />
                  </div>
                  <span className='text-sm font-medium text-gray-600'>Projects</span>
                </div>
                <div className='text-4xl font-bold text-gray-900'>0</div>
                <p className='text-xs text-gray-500 mt-2'>Create your first one</p>
              </div>
            </div>

            {/* CTA Section */}
            <div className='p-8 bg-linear-to-r from-blue-500/5 to-purple-500/5 backdrop-blur-md rounded-2xl border border-blue-500/10'>
              <h3 className='text-lg font-semibold text-gray-900 mb-2'>Ready to get started?</h3>
              <p className='text-gray-600 text-sm mb-4'>Set up your first workspace and start tracking your work.</p>
              <div className='flex gap-3'>
                <button className='px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors shadow-lg shadow-blue-500/20'>
                  Create Workspace
                </button>
                <button className='px-6 py-2 bg-white/30 hover:bg-white/50 text-gray-900 rounded-lg font-medium transition-colors border border-white/50'>
                  Learn More
                </button>
              </div>
            </div>

            {/* Dev Counter */}
            <div className='mt-8 p-4 bg-gray-100/30 rounded-lg text-center'>
              <button
                onClick={() => setCount((c) => c + 1)}
                className='px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors'
              >
                Dev Counter: {count}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
