import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { DataProvider } from './context/DataContext.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { LanguageProvider } from './context/LanguageContext.jsx'
import { CalendarProvider } from './context/CalendarContext.jsx'
import './index.css'

const PLATFORM_ONLY_BUILD = import.meta.env.VITE_APP_MODE === 'platform-admin'

if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'

function RootProviders() {
  if (PLATFORM_ONLY_BUILD) {
    return (
      <ThemeProvider>
        <App />
      </ThemeProvider>
    )
  }
  return (
    <AuthProvider>
      <ThemeProvider>
        <LanguageProvider>
          <CalendarProvider>
            <DataProvider>
              <App />
            </DataProvider>
          </CalendarProvider>
        </LanguageProvider>
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
