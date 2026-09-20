import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ShieldCheck, Lock, AlertTriangle } from 'lucide-react'
import { usePlatformAuth } from '../context/PlatformAuthContext'

// Dark-first by design, always — this console has no light mode toggle,
// unlike the community app's ThemeContext. Built with the same `ink`/
// `brand`/`teal` palette and card/border language as the rest of the
// product (see tailwind.config.js) rather than an unrelated admin
// template, per Phase 1's design requirement.
export default function PlatformLogin() {
  const { login, submitMfaCode, mfaChallenge } = usePlatformAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const redirectTo = location.state?.from?.pathname || '/platform-admin/dashboard'

  async function handleCredentialsSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const result = await login({ email, password })
      if (!result.mfaRequired) navigate(redirectTo, { replace: true })
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to sign in')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleMfaSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await submitMfaCode(useRecovery ? undefined : mfaCode)
      navigate(redirectTo, { replace: true })
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid code')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-ink-900 text-ink-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-8">
          <div className="w-9 h-9 rounded-xl bg-brand-gradient flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <span className="font-display font-semibold text-lg tracking-tight">Hivee Platform</span>
        </div>

        <div className="rounded-xl2 border border-ink-700 bg-ink-800/60 backdrop-blur shadow-card p-6">
          {!mfaChallenge ? (
            <>
              <h1 className="text-base font-semibold mb-1">Operator sign in</h1>
              <p className="text-sm text-ink-400 mb-6">Internal access only. All activity is logged.</p>
              <form onSubmit={handleCredentialsSubmit} className="space-y-4">
                <Field label="Email">
                  <input
                    type="email"
                    required
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg bg-ink-900 border border-ink-600 px-3 py-2 text-sm text-ink-50 placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="you@hivee.internal"
                  />
                </Field>
                <Field label="Password">
                  <input
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg bg-ink-900 border border-ink-600 px-3 py-2 text-sm text-ink-50 placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="••••••••••••"
                  />
                </Field>
                {error && <ErrorBanner message={error} />}
                <SubmitButton submitting={submitting} label="Continue" />
              </form>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-1">
                <Lock className="w-4 h-4 text-teal-400" />
                <h1 className="text-base font-semibold">Verify it's you</h1>
              </div>
              <p className="text-sm text-ink-400 mb-6">
                {useRecovery ? 'Enter one of your recovery codes.' : 'Enter the 6-digit code from your authenticator app.'}
              </p>
              <form onSubmit={handleMfaSubmit} className="space-y-4">
                {useRecovery ? (
                  <Field label="Recovery code">
                    <input
                      required
                      value={recoveryCode}
                      onChange={(e) => setRecoveryCode(e.target.value)}
                      className="w-full rounded-lg bg-ink-900 border border-ink-600 px-3 py-2 text-sm tracking-widest text-ink-50 focus:outline-none focus:ring-2 focus:ring-teal-500"
                      placeholder="XXXXX-XXXXX"
                    />
                  </Field>
                ) : (
                  <Field label="Authentication code">
                    <input
                      required
                      inputMode="numeric"
                      maxLength={6}
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                      className="w-full rounded-lg bg-ink-900 border border-ink-600 px-3 py-2 text-sm tracking-[0.4em] text-center text-ink-50 focus:outline-none focus:ring-2 focus:ring-teal-500"
                      placeholder="······"
                    />
                  </Field>
                )}
                {error && <ErrorBanner message={error} />}
                <SubmitButton submitting={submitting} label="Verify" />
                <button
                  type="button"
                  onClick={() => setUseRecovery((v) => !v)}
                  className="w-full text-center text-xs text-ink-400 hover:text-ink-200 transition"
                >
                  {useRecovery ? 'Use authenticator code instead' : 'Use a recovery code instead'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink-400 mb-1.5">{label}</span>
      {children}
    </label>
  )
}

function ErrorBanner({ message }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

function SubmitButton({ submitting, label }) {
  return (
    <button
      type="submit"
      disabled={submitting}
      className="w-full rounded-lg bg-brand-gradient py-2.5 text-sm font-medium text-white shadow-glow hover:opacity-95 disabled:opacity-60 transition"
    >
      {submitting ? 'Please wait…' : label}
    </button>
  )
}
