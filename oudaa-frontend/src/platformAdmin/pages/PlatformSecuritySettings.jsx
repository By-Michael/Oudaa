import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Loader2, AlertTriangle, KeyRound, CheckCircle2 } from 'lucide-react'
import platformApi, { platformEndpoints } from '../lib/platformApi'
import ConfirmActionModal from '../components/ConfirmActionModal'

function NumberField({ label, hint, value, onChange, min, max }) {
  return (
    <div>
      <label className="block text-sm text-ink-200 mb-1">{label}</label>
      {hint && <p className="text-xs text-ink-500 mb-1.5">{hint}</p>}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-40 rounded-lg border border-ink-700 bg-ink-800/60 px-3 py-2 text-sm text-ink-100 focus:outline-none focus:ring-1 focus:ring-teal-500"
      />
    </div>
  )
}

function ToggleField({ label, hint, checked, onChange }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 accent-teal-500" />
      <span>
        <span className="block text-sm text-ink-200">{label}</span>
        {hint && <span className="block text-xs text-ink-500">{hint}</span>}
      </span>
    </label>
  )
}

export default function PlatformSecuritySettings() {
  const [settings, setSettings] = useState(null)
  const [draft, setDraft] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)

  function load() {
    setLoading(true)
    platformApi
      .get(platformEndpoints.securitySettings())
      .then(({ data }) => { setSettings(data.data); setDraft(data.data) })
      .catch((err) => setError(err?.response?.data?.message || 'Failed to load settings'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const dirty = settings && draft && JSON.stringify(settings) !== JSON.stringify(draft)

  async function handleSave(reason) {
    const patch = {
      sessionDurationMinutes: draft.sessionDurationMinutes,
      passwordMinLength: draft.passwordMinLength,
      passwordRequireUppercase: draft.passwordRequireUppercase,
      passwordRequireNumber: draft.passwordRequireNumber,
      passwordRequireSymbol: draft.passwordRequireSymbol,
      loginRateLimitMax: draft.loginRateLimitMax,
      loginRateLimitWindowMinutes: draft.loginRateLimitWindowMinutes,
      mfaRequiredForAllAdmins: draft.mfaRequiredForAllAdmins,
      reason,
      confirm: true,
    }
    const { data } = await platformApi.patch(platformEndpoints.securitySettings(), patch)
    setSettings(data.data)
    setDraft(data.data)
    setShowConfirm(false)
    setSuccess('Security settings updated.')
    setTimeout(() => setSuccess(''), 4000)
  }

  if (loading) {
    return <div className="flex items-center justify-center py-24 text-ink-500"><Loader2 className="w-6 h-6 animate-spin" /></div>
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <Link to="/platform-admin/security" className="inline-flex items-center gap-1.5 text-sm text-ink-400 hover:text-ink-200 mb-2">
          <ArrowLeft className="w-4 h-4" /> Security Center
        </Link>
        <h1 className="text-xl font-display font-semibold text-white flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-teal-400" /> Security settings
        </h1>
        <p className="text-sm text-ink-400 mt-1">Changes take effect for new sessions/logins going forward and are recorded in the audit trail.</p>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {success && (
        <div className="flex items-start gap-3 rounded-lg border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-300">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> {success}
        </div>
      )}

      {draft && (
        <>
          <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-ink-300">Sessions</h2>
            <NumberField
              label="Session duration (minutes)"
              hint="Applies to newly-issued sessions only, not sessions already active."
              min={5} max={129600}
              value={draft.sessionDurationMinutes}
              onChange={(v) => setDraft((d) => ({ ...d, sessionDurationMinutes: v }))}
            />
          </div>

          <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-ink-300">Password policy</h2>
            <NumberField
              label="Minimum length"
              min={8} max={128}
              value={draft.passwordMinLength}
              onChange={(v) => setDraft((d) => ({ ...d, passwordMinLength: v }))}
            />
            <ToggleField label="Require an uppercase letter" checked={draft.passwordRequireUppercase} onChange={(v) => setDraft((d) => ({ ...d, passwordRequireUppercase: v }))} />
            <ToggleField label="Require a number" checked={draft.passwordRequireNumber} onChange={(v) => setDraft((d) => ({ ...d, passwordRequireNumber: v }))} />
            <ToggleField label="Require a symbol" checked={draft.passwordRequireSymbol} onChange={(v) => setDraft((d) => ({ ...d, passwordRequireSymbol: v }))} />
          </div>

          <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-ink-300">Login rate limiting</h2>
            <div className="flex flex-wrap gap-6">
              <NumberField label="Max attempts" min={1} max={1000} value={draft.loginRateLimitMax} onChange={(v) => setDraft((d) => ({ ...d, loginRateLimitMax: v }))} />
              <NumberField label="Per window (minutes)" min={1} max={1440} value={draft.loginRateLimitWindowMinutes} onChange={(v) => setDraft((d) => ({ ...d, loginRateLimitWindowMinutes: v }))} />
            </div>
          </div>

          <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-ink-300">Multi-factor authentication</h2>
            <ToggleField
              label="Require MFA for every platform admin"
              hint="Additive on top of the roles that already require MFA by default (Super Admin, Security Auditor) — this can only add coverage, never remove it."
              checked={draft.mfaRequiredForAllAdmins}
              onChange={(v) => setDraft((d) => ({ ...d, mfaRequiredForAllAdmins: v }))}
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setDraft(settings)}
              disabled={!dirty}
              className="px-3 py-2 rounded-lg text-sm text-ink-300 hover:bg-ink-800 transition disabled:opacity-40"
            >
              Reset
            </button>
            <button
              onClick={() => setShowConfirm(true)}
              disabled={!dirty}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white transition disabled:opacity-40"
            >
              Save changes
            </button>
          </div>
        </>
      )}

      {showConfirm && (
        <ConfirmActionModal
          title="Update security settings?"
          description="This change is recorded in the platform audit trail."
          confirmLabel="Save changes"
          onConfirm={handleSave}
          onClose={() => setShowConfirm(false)}
        />
      )}
    </div>
  )
}
