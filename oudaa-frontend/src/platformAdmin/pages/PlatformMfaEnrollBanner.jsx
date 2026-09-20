import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import platformApi, { platformEndpoints } from '../lib/platformApi'
import { usePlatformAuth } from '../context/PlatformAuthContext'

const MFA_MANDATORY_ROLES = ['SUPER_ADMIN', 'SECURITY_AUDITOR']

/**
 * Shown whenever the signed-in operator's role requires MFA and they
 * haven't enrolled yet — this is the client-side counterpart to the
 * backend's requireMfa middleware returning MFA_ENROLLMENT_REQUIRED.
 * Nothing here is a security control by itself (the server enforces the
 * actual restriction); this just gives the operator a way to complete
 * enrollment instead of hitting a wall of 403s across every other page.
 */
export default function PlatformMfaEnrollBanner() {
  const { admin, refreshMe } = usePlatformAuth()
  const [step, setStep] = useState('idle') // idle | enrolling | verifying | done
  const [secret, setSecret] = useState('')
  const [otpAuthUrl, setOtpAuthUrl] = useState('')
  const [code, setCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState(null)
  const [error, setError] = useState('')

  if (!admin || admin.mfaEnabled || !MFA_MANDATORY_ROLES.includes(admin.role)) return null

  async function startEnrollment() {
    setError('')
    try {
      const { data } = await platformApi.post(platformEndpoints.mfaEnrollStart())
      setSecret(data.data.secret)
      setOtpAuthUrl(data.data.otpAuthUrl)
      setStep('verifying')
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to start MFA enrollment')
    }
  }

  async function verifyEnrollment(e) {
    e.preventDefault()
    setError('')
    try {
      const { data } = await platformApi.post(platformEndpoints.mfaEnrollVerify(), { token: code })
      setRecoveryCodes(data.data.recoveryCodes)
      setStep('done')
      await refreshMe()
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid code')
    }
  }

  return (
    <div className="rounded-xl2 border border-amber-800/40 bg-amber-950/20 p-5">
      <div className="flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-amber-200">Multi-factor authentication required</h2>
          <p className="text-sm text-amber-300/80 mt-1">
            Your role ({admin.role}) requires MFA before you can access anything beyond this page.
          </p>

          {step === 'idle' && (
            <button
              onClick={startEnrollment}
              className="mt-3 rounded-lg bg-amber-600 hover:bg-amber-500 transition px-3 py-1.5 text-sm font-medium text-white"
            >
              Set up MFA now
            </button>
          )}

          {step === 'verifying' && (
            <form onSubmit={verifyEnrollment} className="mt-4 space-y-3">
              <p className="text-xs text-ink-300">
                Scan this into your authenticator app, or enter the secret manually:
              </p>
              <code className="block text-xs bg-ink-900 border border-ink-700 rounded-lg px-3 py-2 text-teal-300 break-all">
                {secret}
              </code>
              <a href={otpAuthUrl} className="text-xs text-teal-400 underline break-all">
                {otpAuthUrl}
              </a>
              <input
                required
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="6-digit code"
                className="w-40 rounded-lg bg-ink-900 border border-ink-600 px-3 py-2 text-sm tracking-widest text-center text-ink-50 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              <button
                type="submit"
                className="ml-2 rounded-lg bg-teal-600 hover:bg-teal-500 transition px-3 py-2 text-sm font-medium text-white"
              >
                Verify & enable
              </button>
            </form>
          )}

          {step === 'done' && recoveryCodes && (
            <div className="mt-4">
              <p className="text-sm text-emerald-300 font-medium">MFA enabled. Save these recovery codes now — they won't be shown again:</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {recoveryCodes.map((c) => (
                  <code key={c} className="text-xs bg-ink-900 border border-ink-700 rounded px-2 py-1 text-ink-200">
                    {c}
                  </code>
                ))}
              </div>
            </div>
          )}

          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  )
}
