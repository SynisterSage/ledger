import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { WorkspaceProvider } from './context/WorkspaceContext'
import { SidebarProvider } from './context/SidebarContext'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <WorkspaceProvider>
        <SidebarProvider>
          <App />
        </SidebarProvider>
      </WorkspaceProvider>
    </AuthProvider>
  </React.StrictMode>,
)
