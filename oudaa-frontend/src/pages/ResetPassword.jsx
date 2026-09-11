import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Landmark, Lock, Eye, EyeOff, ArrowLeft } from 'lucide-react'
import api, { endpoints } from '../lib/api'

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(e) {
    e.preventDefault()
    setError('')

    if (password !== confirm) {
      setError("Passwords don't match.")
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setLoading(true)
    try {
      await api.post(endpoints.resetPassword(), { token, newPassword: password })
      setDone(true)
      setTimeout(() => navigate('/login', { replace: true }), 2500)
    } catch (err) {
      setError(err?.response?.data?.message || 'This reset link is invalid or has expired.')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-white">
        <div className="w-full max-w-sm text-center animate-fade-up">
          <h2 className="text-2xl font-bold text-ink-900">Invalid link</h2>
          <p className="mt-1.5 text-sm text-ink-500">
            This password reset link is missing its token. Please request a new one.
          </p>
          <Link to="/forgot-password" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700">
            <ArrowLeft className="h-3.5 w-3.5" /> Request a new link
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-white">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="flex items-center justify-center mb-8">
          <img src="/oudaa-logo-full.png" alt="Oudaa" className="h-9 w-auto object-contain" />
        </div>

        {done ? (
          <>
            <h2 className="text-2xl font-bold text-ink-900">Password reset</h2>
            <p className="mt-1.5 text-sm text-ink-500">
              Your password has been updated. Redirecting you to sign in…
            </p>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-bold text-ink-900">Set a new password</h2>
            <p className="mt-1.5 text-sm text-ink-500">Choose a new password for your account.</p>

            <form onSubmit={onSubmit} className="mt-7 space-y-4">
              <div>
                <label className="label">New password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
                  <input
                    required
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="input pl-10 pr-10"
                  />
                  <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600">
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="label">Confirm new password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
                  <input
                    required
                    type={showPw ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    className="input pl-10"
                  />
                </div>
              </div>

              {error && (
                <div className="rounded-xl bg-rose-50 border border-rose-100 px-3.5 py-2.5 text-sm text-rose-600">
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} className="btn-primary w-full py-3">
                {loading ? 'Resetting…' : 'Reset password'}
              </button>
            </form>

            <Link to="/login" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
