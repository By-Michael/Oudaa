import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { DataProvider } from './context/DataContext.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import './index.css'

const PLATFORM_ONLY_BUILD = import.meta.env.VITE_APP_MODE === 'platform-admin'

// Let the app (see App.jsx's ScrollToTop) control scroll position on
// navigation instead of the browser trying to restore the previous page's
// scroll offset, which is what was causing a new panel to open already
// scrolled partway down.
if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual'
}

function RootProviders() {
  if (PLATFORM_ONLY_BUILD) {
    // The admin domain is a separate frontend build. Do not initialize the
    // community Auth/Data providers there, so community session state and
    // tenant data plumbing never execute on the operator console origin.
    return (
      <ThemeProvider>
        <App />
      </ThemeProvider>
    )
  }
  return (
    <AuthProvider>
      <ThemeProvider>
        <DataProvider>
          <App />
        </DataProvider>
      </ThemeProvider>
    </AuthProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <RootProviders />
    </BrowserRouter>
  </React.StrictMode>,
)
