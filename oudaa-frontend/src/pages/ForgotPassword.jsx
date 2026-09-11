import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Landmark, Mail, ArrowLeft } from 'lucide-react'
import api, { endpoints } from '../lib/api'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      // Backend always returns a generic success message regardless of
      // whether the email matched an account, so this never leaks which
      // emails are registered.
      await api.post(endpoints.forgotPassword(), { email })
      setSent(true)
    } catch (err) {
      setError(err?.response?.data?.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-white">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="flex items-center justify-center mb-8">
          <img src="/oudaa-logo-full.png" alt="Oudaa" className="h-9 w-auto object-contain" />
        </div>

        {sent ? (
          <>
            <h2 className="text-2xl font-bold text-ink-900">Check your email</h2>
            <p className="mt-1.5 text-sm text-ink-500">
              If an account exists for <strong>{email}</strong>, we've sent a link to reset your
              password. It's valid for 30 minutes.
            </p>
            <Link to="/login" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
            </Link>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-bold text-ink-900">Forgot your password?</h2>
            <p className="mt-1.5 text-sm text-ink-500">
              Enter your account email and we'll send you a link to reset it.
            </p>

            <form onSubmit={onSubmit} className="mt-7 space-y-4">
              <div>
                <label className="label">Email address</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@community.org"
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
                {loading ? 'Sending…' : 'Send reset link'}
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
