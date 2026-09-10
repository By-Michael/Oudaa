import { useEffect, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import {
  Camera, KeyRound, Mail, Phone, ShieldCheck, Loader2, Users2, Clock, XCircle, Search, Check,
  User, Bell, Palette, Landmark, AlertTriangle, ShieldAlert, Save, CheckCircle2, Sun, Moon,
  Plus, Pencil, Trash2, Smartphone, ToggleLeft, ToggleRight, Wallet,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useData } from '../../context/DataContext'
import { useTheme } from '../../context/ThemeContext'
import { PageHeader, Modal, notify } from '../../components/ui'
import api, { endpoints, fileUrl } from '../../lib/api'
import { NOTIFICATION_CATEGORIES, getNotificationPrefs, setNotificationPref } from '../../lib/notificationPrefs'

// Every sensitive profile change (password, phone, picture) goes through a
// real 6-digit code emailed via Brevo to the account's email — the one
// field nobody, not even the resident themself, can edit once the
// committee registers them (see userController.requestProfileOtp /
// verifyPhoneOtp and utils/email.js#sendProfileOtpEmail). The backend
// only ever stores a hash of the code; the browser never generates or
// sees it except when typed in by the person reading their inbox.

// ---------------------------------------------------------------------------
// Tab classification:
//  - profile / security / notifications / preferences — things that only
//    ever affect the signed-in person, resident or committee member alike.
//  - community / approvals / membership — committee-only, because they
//    change something shared by the whole estate or the committee's own
//    governance (who's on it, how it approves things).
// ---------------------------------------------------------------------------
const TABS = [
  { id: 'profile', label: 'Profile', icon: User, roles: ['admin', 'resident'] },
  { id: 'security', label: 'Security', icon: KeyRound, roles: ['admin', 'resident'] },
  { id: 'notifications', label: 'Notifications', icon: Bell, roles: ['admin', 'resident'] },
  { id: 'preferences', label: 'Preferences', icon: Palette, roles: ['admin', 'resident'] },
  { id: 'community', label: 'Community', icon: Landmark, roles: ['admin'] },
  { id: 'payments', label: 'Payments', icon: Wallet, roles: ['admin'] },
  { id: 'approvals', label: 'Approvals', icon: ShieldCheck, roles: ['admin'] },
  { id: 'membership', label: 'Membership', icon: Users2, roles: ['admin'] },
]

export default function Profile() {
  const { user } = useAuth()
  const location = useLocation()
  // An admin can switch into "resident view" (see AppLayout's "Switch to
  // resident view") without their account's actual role changing — so
  // which tabs show here needs to follow the *view* the person is
  // currently browsing under (the /admin vs /resident URL prefix), not
  // just user.role. Otherwise committee-only tabs (Community, Approvals,
  // Membership) kept showing up even while looking at things as a
  // resident would. A real resident account can never reach /<slug>/admin/*
  // in the first place (that route is already role-protected), so this
  // only ever narrows what an admin sees, never widens what a resident
  // can. Every portal URL is now "/<communitySlug>/admin/..." or
  // "/<communitySlug>/resident/..." (see lib/paths.js#portalBase), so
  // check for "/admin" as a path SEGMENT rather than a leading prefix.
  const isCommittee = user?.role === 'admin' && /\/admin(\/|$)/.test(location.pathname)
  const roleKey = isCommittee ? 'admin' : 'resident'
  const visibleTabs = TABS.filter((t) => t.roles.includes(roleKey))

  const [searchParams, setSearchParams] = useSearchParams()
  // /admin/settings is still the sidebar's "Settings" link — land on the
  // Community tab when arriving that way, otherwise honour ?tab=, otherwise
  // start on Profile.
  const initialTab = (() => {
    const fromQuery = searchParams.get('tab')
    if (fromQuery && visibleTabs.some((t) => t.id === fromQuery)) return fromQuery
    if (location.pathname.endsWith('/settings') && isCommittee) return 'community'
    return 'profile'
  })()
  const [activeTab, setActiveTab] = useState(initialTab)

  function selectTab(id) {
    setActiveTab(id)
    setSearchParams({ tab: id }, { replace: true })
  }

  return (
    <div>
      <PageHeader
        title="Profile & Settings"
        subtitle={isCommittee
          ? 'Your account, plus the community-wide settings your committee seat controls.'
          : 'Manage your account — password, phone, and how the app notifies you.'}
      />

      <div className="card p-1.5 mb-6 inline-flex flex-wrap gap-1">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => selectTab(t.id)}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition ${
              activeTab === t.id ? 'bg-brand-gradient text-white shadow-glow' : 'text-ink-500 hover:bg-ink-50 hover:text-ink-800'
            }`}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'profile' && <ProfileTab user={user} isCommittee={isCommittee} />}
      {activeTab === 'security' && <SecurityTab />}
      {activeTab === 'notifications' && <NotificationsTab user={user} roleKey={roleKey} />}
      {activeTab === 'preferences' && <PreferencesTab />}
      {isCommittee && activeTab === 'community' && <CommunityTab />}
      {isCommittee && activeTab === 'payments' && <PaymentsTab />}
      {isCommittee && activeTab === 'approvals' && <ApprovalsTab user={user} />}
      {isCommittee && activeTab === 'membership' && <MembershipTab user={user} />}
    </div>
  )
}

// ===========================================================================
// Profile — identity, avatar, phone. Only things about "him", never
// anything shared with the rest of the community.
// ===========================================================================
function ProfileTab({ user, isCommittee }) {
  const { residents, refresh } = useData()
  const { patchUser } = useAuth()
  const me = residents.find((r) => r.userId === user?.id || r.id === user?.residentId)

  const [pendingAction, setPendingAction] = useState(null) // { type, payload }
  const [otpInput, setOtpInput] = useState('')
  const [otpError, setOtpError] = useState('')
  const [otpSending, setOtpSending] = useState(false)
  const [otpVerifying, setOtpVerifying] = useState(false)
  const [sentNotice, setSentNotice] = useState('')
  const [banner, setBanner] = useState('')
  const [avatarUploading, setAvatarUploading] = useState(false)
  const fileRef = useRef(null)

  const [phone, setPhone] = useState(me?.phone || '')
  // Profile picture is a real database field now (User.avatarUrl, stored
  // in object storage — see storage.js) instead of a base64 data URL
  // cached in this browser's localStorage, so it follows the user to any
  // device they sign into.
  const avatar = user?.avatarUrl ? fileUrl(user.avatarUrl) : null

  // Kicks off real email verification via the backend (which sends
  // through Brevo — see utils/email.js#sendProfileOtpEmail). The code
  // itself never touches the browser; the backend only stores its hash
  // and validates whatever the person types back in confirmOtp().
  async function beginVerifiedChange(type, payload) {
    setOtpSending(true)
    setOtpError('')
    try {
      const { data } = await api.post(endpoints.myOtpRequest(), {
        type: type.toUpperCase(),
        ...(type === 'phone' ? { phone: payload.phone } : {}),
      })
      setPendingAction({ type, payload })
      setOtpInput('')
      // In local/dev environments with no Brevo API key configured, the
      // backend has no channel to deliver the code through and returns
      // it directly (see userController.requestProfileOtp) — surface
      // that here instead of the code silently going nowhere. In a real
      // deployment this field is never present and the message below is
      // all that shows.
      setSentNotice(
        data?.data?.stubOtp
          ? `Email isn't configured on the server yet, so here's the code instead of it being emailed: ${data.data.stubOtp}`
          : (data?.message || `A 6-digit code was sent to ${user?.email}.`)
      )
    } catch (err) {
      notify(err?.response?.data?.message || err.message || 'Could not send a verification code.')
    } finally {
      setOtpSending(false)
    }
  }

  async function confirmOtp() {
    if (!pendingAction) return
    setOtpVerifying(true)
    setOtpError('')
    try {
      if (pendingAction.type === 'phone') {
        await api.post(endpoints.myOtpVerifyPhone(), { otp: otpInput.trim() })
        await refresh()
        setBanner('Phone number updated.')
      } else if (pendingAction.type === 'avatar') {
        const ok = await uploadAvatar(pendingAction.payload.file, otpInput.trim())
        if (!ok.success) {
          setOtpError(ok.message || 'Could not upload your profile picture. Please try again.')
          return
        }
        setBanner('Profile picture updated.')
      }
      setPendingAction(null)
      setSentNotice('')
      setTimeout(() => setBanner(''), 4000)
    } catch (err) {
      setOtpError(err?.response?.data?.message || err.message || 'That code didn\u2019t work. Check it and try again.')
    } finally {
      setOtpVerifying(false)
    }
  }

  // `otp` is only sent for residents — the backend requires it for
  // everyone except committee members (see userController.uploadAvatar),
  // who upload straight through onPickFile below with no OTP at all.
  async function uploadAvatar(file, otp) {
    const form = new FormData()
    form.append('avatar', file)
    if (otp) form.append('otp', otp)
    setAvatarUploading(true)
    try {
      const { data } = await api.post(endpoints.myAvatar(), form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      patchUser({ avatarUrl: data.data.avatarUrl })
      return { success: true }
    } catch (err) {
      return { success: false, message: err?.response?.data?.message || err.message }
    } finally {
      setAvatarUploading(false)
    }
  }

  async function onPickFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    // Committee members can change their photo without email verification;
    // it's only required for password and phone number changes.
    if (isCommittee) {
      const result = await uploadAvatar(file)
      if (result.success) {
        setBanner('Profile picture updated.')
        setTimeout(() => setBanner(''), 4000)
      } else {
        notify(result.message || 'Could not upload your profile picture.')
      }
    } else {
      beginVerifiedChange('avatar', { file })
    }
    e.target.value = ''
  }

  function submitPhone(e) {
    e.preventDefault()
    if (!phone.trim()) return
    beginVerifiedChange('phone', { phone: phone.trim() })
  }

  return (
    <div className="max-w-2xl">
      {banner && <div className="mb-5 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3 text-sm text-emerald-700">{banner}</div>}

      {/* Identity */}
      <div className="card p-5 mb-5">
        <div className="flex items-center gap-4">
          <div className="relative">
            {avatar ? (
              <img src={avatar} alt="" className="h-16 w-16 rounded-full object-cover ring-1 ring-ink-100" />
            ) : (
              <div className="h-16 w-16 rounded-full flex items-center justify-center text-white text-lg font-bold font-display" style={{ background: user?.avatarColor || '#2570f5' }}>
                {user?.name?.split(' ').map((n) => n[0]).slice(0, 2).join('')}
              </div>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={avatarUploading || otpSending}
              className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-brand-gradient text-white flex items-center justify-center shadow-glow disabled:opacity-60"
              title="Change profile picture"
            >
              {(avatarUploading || otpSending) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onPickFile} disabled={avatarUploading || otpSending} />
          </div>
          <div>
            <p className="font-semibold text-ink-800">{user?.name}</p>
            <p className="text-sm text-ink-400 capitalize">{user?.role === 'admin' ? 'Committee member' : user?.role} · {user?.community}</p>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2.5 rounded-xl bg-ink-50/70 px-3.5 py-2.5">
          <Mail className="h-4 w-4 text-ink-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm text-ink-700 truncate">{user?.email}</p>
            <p className="text-xs text-ink-400">Registered by the committee &middot; can’t be changed here.</p>
          </div>
        </div>
      </div>

      {/* Phone */}
      <form onSubmit={submitPhone} className="card p-5 mb-5 space-y-3">
        <h3 className="font-semibold text-ink-800 flex items-center gap-2"><Phone className="h-4 w-4 text-brand-600" /> Phone number</h3>
        <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+251 9xx xxx xxx" />
        <button type="submit" disabled={otpSending} className="btn-secondary">{otpSending ? 'Sending code…' : 'Update phone (verify by email)'}</button>
      </form>

      {/* OTP modal */}
      {pendingAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" />
          <div className="relative w-full max-w-sm card p-6 animate-fade-up">
            <h3 className="text-lg font-bold text-ink-900 mb-1">Verify it’s you</h3>
            <p className="text-sm text-ink-500 mb-4">{sentNotice}</p>
            <label className="label">6-digit code</label>
            <input
              autoFocus
              inputMode="numeric"
              maxLength={6}
              className="input tracking-[0.5em] text-center text-lg font-semibold"
              value={otpInput}
              onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ''))}
            />
            {otpError && <p className="text-sm text-rose-600 mt-2">{otpError}</p>}
            <div className="flex gap-2 pt-4">
              <button onClick={() => setPendingAction(null)} disabled={otpVerifying} className="btn-secondary flex-1">Cancel</button>
              <button onClick={confirmOtp} disabled={otpVerifying || otpInput.trim().length !== 6} className="btn-primary flex-1">
                {otpVerifying ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ===========================================================================
// Security — password only. Kept separate from Profile so the one thing
// people search for most ("change my password") has its own clearly-labelled
// home instead of being buried under photo/phone controls.
// ===========================================================================
function SecurityTab() {
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  const [pwError, setPwError] = useState('')
  const [pwLoading, setPwLoading] = useState(false)
  const [successOpen, setSuccessOpen] = useState(false)

  async function submitPassword(e) {
    e.preventDefault()
    setPwError('')
    if (pwForm.next.length < 8) return setPwError('New password must be at least 8 characters.')
    if (pwForm.next !== pwForm.confirm) return setPwError('New password and confirmation don\u2019t match.')
    setPwLoading(true)
    try {
      await api.patch(endpoints.changePassword(), { currentPassword: pwForm.current, newPassword: pwForm.next })
      setPwForm({ current: '', next: '', confirm: '' })
      setSuccessOpen(true)
    } catch (err) {
      setPwError(err?.response?.data?.message || err.message || 'Could not change password.')
    } finally {
      setPwLoading(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <Modal open={successOpen} onClose={() => setSuccessOpen(false)} title="Password changed">
        <div className="flex flex-col items-center text-center gap-3 py-2">
          <div className="h-12 w-12 rounded-full bg-emerald-50 flex items-center justify-center">
            <CheckCircle2 className="h-6 w-6 text-emerald-600" />
          </div>
          <p className="text-sm text-ink-500">
            Your password was changed successfully. You\u2019ll need to use it the next time you sign in.
          </p>
          <button type="button" onClick={() => setSuccessOpen(false)} className="btn-primary w-full mt-2">Done</button>
        </div>
      </Modal>

      <form onSubmit={submitPassword} className="card p-5 mb-5 space-y-3">
        <h3 className="font-semibold text-ink-800 flex items-center gap-2"><KeyRound className="h-4 w-4 text-brand-600" /> Change password</h3>
        <div>
          <label className="label">Current password</label>
          <input type="password" required className="input" value={pwForm.current} onChange={(e) => setPwForm({ ...pwForm, current: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">New password</label>
            <input type="password" required minLength={8} className="input" value={pwForm.next} onChange={(e) => setPwForm({ ...pwForm, next: e.target.value })} />
          </div>
          <div>
            <label className="label">Confirm new password</label>
            <input type="password" required minLength={8} className="input" value={pwForm.confirm} onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })} />
          </div>
        </div>
        {pwError && <p className="text-sm text-rose-600">{pwError}</p>}
        <button type="submit" disabled={pwLoading} className="btn-primary">
          {pwLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          {pwLoading ? 'Updating…' : 'Change password'}
        </button>
      </form>

      <div className="card p-5 text-sm text-ink-500 flex gap-3 items-start">
        <ShieldAlert className="h-4 w-4 text-brand-600 shrink-0 mt-0.5" />
        <p>
          Password and phone-number changes always require a one-time code sent to your registered email first — even
          if someone gets hold of your session, they can’t change either without also having access to your inbox.
        </p>
      </div>
    </div>
  )
}

// ===========================================================================
// Notifications — mute individual categories in the bell. Backed by the
// user's database preferences (User.preferences.notifications — see
// lib/notificationPrefs.js), so mutes follow the account to any device.
// ===========================================================================
function NotificationsTab({ user, roleKey }) {
  const { patchUser } = useAuth()
  const [prefs, setPrefs] = useState(() => getNotificationPrefs(user?.preferences))
  const categories = NOTIFICATION_CATEGORIES.filter((c) => c.roles.includes(roleKey))

  function toggle(id) {
    const next = setNotificationPref(user, patchUser, id, !prefs[id])
    setPrefs(next)
  }

  return (
    <div className="max-w-2xl">
      <div className="card p-5">
        <h3 className="font-semibold text-ink-800 flex items-center gap-2 mb-1"><Bell className="h-4 w-4 text-brand-600" /> What shows up in your notification bell</h3>
        <p className="text-xs text-ink-400 mb-4">
          Turn off any category you don\u2019t want to see. Saved to your account, so it applies wherever you sign in.
        </p>
        <div className="divide-y divide-ink-100">
          {categories.map((c) => (
            <div key={c.id} className="py-3.5 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-ink-700">{c.label}</p>
                <p className="text-xs text-ink-400 mt-0.5">{c.description}</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
                <input type="checkbox" className="sr-only peer" checked={prefs[c.id] !== false} onChange={() => toggle(c.id)} />
                <div className="w-10 h-6 bg-ink-200 peer-checked:bg-brand-600 rounded-full transition-colors relative">
                  <div className={`absolute top-0.5 left-0.5 h-5 w-5 bg-white rounded-full shadow transition-transform ${prefs[c.id] !== false ? 'translate-x-4' : ''}`} />
                </div>
              </label>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ===========================================================================
// Preferences — cosmetic/behavioural defaults for this person, saved to
// their account so they apply on any device they sign into.
// ===========================================================================
const THEME_OPTIONS = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
]

function PreferencesTab() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="max-w-2xl space-y-5">
      <div className="card p-5">
        <h3 className="font-semibold text-ink-800 flex items-center gap-2 mb-1"><Palette className="h-4 w-4 text-brand-600" /> Appearance</h3>
        <p className="text-xs text-ink-400 mb-4">Switch between light and dark. Saved to your account, so it follows you to other devices too.</p>
        <div className="flex gap-2">
          {THEME_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setTheme(o.id)}
              className={`flex-1 flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition ${
                theme === o.id ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-500 hover:bg-ink-50'
              }`}
            >
              <o.icon className="h-4 w-4" /> {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ===========================================================================
// Community — community details only. Committee-only: this affects every
// resident, not just the person editing it. The community's payment
// methods (CBE/Telebirr) and the resident self-verification safeguard
// live in the separate "Payments" tab below (see PaymentsTab) instead of
// being buried in here.
// ===========================================================================
function CommunityTab() {
  const { community, updateCommunity } = useData()
  const emptyForm = { name: '', address: '', contactInfo: '' }
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  // Tracks whether the admin has touched anything since the form was last
  // synced from the server, so the background 60s silent refresh (see
  // DataContext) can't clobber in-progress edits by re-running the sync
  // effect underneath them, and so we know when to warn about unsaved work.
  const dirtyRef = useRef(false)

  useEffect(() => {
    if (community && !dirtyRef.current) {
      setForm({
        name: community.name || '',
        address: community.address || '',
        contactInfo: community.contactInfo || '',
      })
    }
  }, [community])

  function updateField(patch) {
    dirtyRef.current = true
    setForm((f) => ({ ...f, ...patch }))
  }

  // Warn before leaving the tab/closing/refreshing while there are unsaved
  // edits, instead of silently discarding them.
  useEffect(() => {
    function onBeforeUnload(e) {
      if (!dirtyRef.current) return
      e.preventDefault()
      e.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await updateCommunity(form)
      dirtyRef.current = false
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Could not save settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="card p-6 max-w-2xl space-y-6">
        <div>
          <h3 className="text-sm font-semibold text-ink-800 mb-3">Community</h3>
          <div className="space-y-4">
            <div>
              <label className="label">Community name</label>
              <input required className="input" value={form.name} onChange={(e) => updateField({ name: e.target.value })} />
            </div>
            <div>
              <label className="label">Address</label>
              <input className="input" value={form.address} onChange={(e) => updateField({ address: e.target.value })} />
            </div>
            <div>
              <label className="label">Contact info</label>
              <input className="input" value={form.contactInfo} onChange={(e) => updateField({ contactInfo: e.target.value })} />
            </div>
          </div>
        </div>

        {error && <div className="rounded-xl bg-rose-50 border border-rose-100 px-3.5 py-2.5 text-sm text-rose-600">{error}</div>}

        <div className="flex items-center gap-3 pt-2">
          <button type="submit" disabled={saving} className="btn-primary">
            <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save settings'}
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
              <CheckCircle2 className="h-4 w-4" /> Saved
            </span>
          )}
        </div>
      </form>
    </div>
  )
}

// ===========================================================================
// Payments — a community can register up to 2 payment methods: CBE and/or
// Telebirr, the only two providers Hivee supports (see PaymentProvider in
// schema.prisma), so there's nothing left to add once both are registered.
// Residents pick one of these when self-verifying a payment (see
// resident/Payments.jsx). Every add/edit/removal here is a sensitive,
// community-wide change — same stakes as the old single-account fields —
// so it goes through the same PendingChange committee-approval flow: a
// sole committee member gets it applied instantly, otherwise it needs
// every other committee member to sign off first (see the notification
// bell / dashboard once you save).
// ===========================================================================
const METHOD_PROVIDERS = [
  { value: 'CBE', label: 'Commercial Bank of Ethiopia (CBE)', short: 'CBE' },
  { value: 'TELEBIRR', label: 'Telebirr', short: 'Telebirr' },
]
const emptyMethodForm = {
  provider: 'CBE', label: 'CBE', bankName: '', accountName: '', accountNumber: '', fullName: '', phoneNumber: '', isActive: true,
}
const MAX_PAYMENT_METHODS = 2

function PaymentsTab() {
  const { community, paymentMethods, pendingChanges, addPaymentMethod, updatePaymentMethod, removePaymentMethod, updateCommunity, cancelPendingChange } = useData()
  const [modal, setModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyMethodForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState(null)
  const [notice, setNotice] = useState('')
  const [cancellingId, setCancellingId] = useState(null)

  // Self-verification safeguard (auto-verify review threshold) — its own
  // small instant-apply form, separate from the payment-methods
  // committee-approval flow below.
  const [thresholdValue, setThresholdValue] = useState('')
  const [thresholdSaving, setThresholdSaving] = useState(false)
  const [thresholdSaved, setThresholdSaved] = useState(false)
  const thresholdDirtyRef = useRef(false)

  useEffect(() => {
    if (community && !thresholdDirtyRef.current) {
      setThresholdValue(community.autoVerifyMaxAmount ?? '')
    }
  }, [community])

  async function saveThreshold(e) {
    e.preventDefault()
    setThresholdSaving(true)
    try {
      await updateCommunity({ autoVerifyMaxAmount: thresholdValue === '' ? null : Number(thresholdValue) })
      thresholdDirtyRef.current = false
      setThresholdSaved(true)
      setTimeout(() => setThresholdSaved(false), 3000)
    } catch (err) {
      notify(err?.response?.data?.message || err.message || 'Could not save the safeguard threshold.')
    } finally {
      setThresholdSaving(false)
    }
  }

  const sorted = [...paymentMethods].sort((a, b) => (a.sortOrder - b.sortOrder) || a.label.localeCompare(b.label))

  // My own outstanding proposals for payment-method changes — used both to
  // count toward the 2-method cap (a pending *new* method still "counts")
  // and to show a "Pending approval" badge on the row being edited/removed
  // so a second edit isn't submitted on top of an unresolved one.
  const myPendingMethodChanges = (pendingChanges?.asProposer || []).filter((pc) =>
    ['PAYMENT_METHOD_CREATE', 'PAYMENT_METHOD_UPDATE', 'PAYMENT_METHOD_DELETE'].includes(pc.changeType)
  )
  const pendingCreateCount = myPendingMethodChanges.filter((pc) => pc.changeType === 'PAYMENT_METHOD_CREATE').length
  const atLimit = sorted.length + pendingCreateCount >= MAX_PAYMENT_METHODS
  function pendingChangeForMethod(methodId) {
    return myPendingMethodChanges.find((pc) => pc.entityId === methodId && pc.changeType !== 'PAYMENT_METHOD_CREATE')
  }

  function openAdd() {
    setEditingId(null)
    setForm(emptyMethodForm)
    setError('')
    setModal(true)
  }

  function openEdit(m) {
    setEditingId(m.id)
    setForm({
      provider: m.provider, label: m.label, bankName: m.bankName, accountName: m.accountName,
      accountNumber: m.accountNumber, fullName: m.fullName, phoneNumber: m.phoneNumber, isActive: m.isActive,
    })
    setError('')
    setModal(true)
  }

  // The residents-facing label is no longer a separate field the committee
  // fills in — it's just the provider's own display name (CBE / Telebirr),
  // set automatically whenever the provider is chosen.
  function chooseProvider(value) {
    const providerLabel = METHOD_PROVIDERS.find((p) => p.value === value)?.short || value
    setForm((f) => ({ ...f, provider: value, label: providerLabel }))
  }

  function flashNotice(message) {
    setNotice(message)
    setTimeout(() => setNotice(''), 8000)
  }

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      // CBE is the only bank Hivee supports here — the provider picker
      // above already says so, so don't also ask the admin to type
      // "Commercial Bank of Ethiopia" into a free-text field right below it.
      const payload = { ...form, bankName: form.provider === 'CBE' ? 'Commercial Bank of Ethiopia' : '' }
      const result = editingId ? await updatePaymentMethod(editingId, payload) : await addPaymentMethod(payload)
      if (result?.message) flashNotice(result.message)
      setModal(false)
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Could not save this payment method.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(m) {
    try {
      const result = await updatePaymentMethod(m.id, { ...m, isActive: !m.isActive })
      if (result?.message) flashNotice(result.message)
    } catch (err) {
      notify(err?.response?.data?.message || err.message || 'Could not update this payment method.')
    }
  }

  async function handleDelete(m) {
    if (!window.confirm(`Remove "${m.label}"? Residents will no longer be able to pick it, but existing payments made through it are unaffected.`)) return
    setDeletingId(m.id)
    try {
      const result = await removePaymentMethod(m.id)
      if (result?.message) flashNotice(result.message)
    } catch (err) {
      notify(err?.response?.data?.message || err.message || 'Could not remove this payment method.')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleCancelPending(pc) {
    setCancellingId(pc.id)
    try {
      await cancelPendingChange(pc.id)
    } catch (err) {
      notify(err?.response?.data?.message || err.message || 'Could not withdraw this request.')
    } finally {
      setCancellingId(null)
    }
  }

  const isTelebirr = form.provider === 'TELEBIRR'

  return (
    <div>
      {community?.bankVerificationStubActive && (
        <div className="max-w-2xl mb-6 rounded-xl bg-rose-50 border border-rose-200 px-4 py-3.5 text-sm text-rose-700 flex gap-3 items-start">
          <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Bank verification is not live.</p>
            <p className="mt-1">
              No <code className="font-mono">VERITAS_API_KEY</code> is configured on the server, so resident
              self-verified payments are not actually being checked against a real bank. Any transaction ID
              a resident types in will currently be accepted. Set <code className="font-mono">VERITAS_API_KEY</code> in
              the backend environment before relying on self-verification in production.
            </p>
          </div>
        </div>
      )}

      {community?.receiptStorageStubActive && (
        <div className="max-w-2xl mb-6 rounded-xl bg-rose-50 border border-rose-200 px-4 py-3.5 text-sm text-rose-700 flex gap-3 items-start">
          <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Receipt uploads are not going to permanent storage.</p>
            <p className="mt-1">
              No <code className="font-mono">SUPABASE_URL</code> / <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> is
              configured on the server, so receipt files are being saved to local disk. On Render (and most hosts) that
              disk is wiped on every deploy or restart — every receipt uploaded this way will stop loading the next
              time the server restarts. Set those two variables to a Supabase Storage bucket before relying on receipt
              uploads in production.
            </p>
          </div>
        </div>
      )}

      <div id="payment-methods-panel" className="card p-6 max-w-2xl">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h3 className="text-sm font-semibold text-ink-800 flex items-center gap-2">
              <Wallet className="h-4 w-4 text-brand-600" /> Payment methods
            </h3>
            <p className="text-xs text-ink-400 mt-1 max-w-md">
              Register your CBE account and/or Telebirr number — up to {MAX_PAYMENT_METHODS} total, since these are
              the only two payment providers Hivee supports. Residents pick one under "Make a payment". Changes need
              every other committee member to approve before they take effect (a sole committee member gets it
              applied right away).
            </p>
          </div>
          {!atLimit && (
            <button onClick={openAdd} className="btn-secondary shrink-0 !py-1.5 !px-3 text-xs">
              <Plus className="h-3.5 w-3.5" /> Add payment option
            </button>
          )}
        </div>

        {notice && (
          <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-sm text-amber-700 flex gap-2 items-start">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> {notice}
          </div>
        )}

        {atLimit && (
          <p className="mt-3 text-xs text-ink-400">
            You've reached the maximum of {MAX_PAYMENT_METHODS} payment methods — remove one to add a different one.
          </p>
        )}

        {sorted.length === 0 && pendingCreateCount === 0 ? (
          <p className="text-sm text-ink-400 py-6 text-center">
            No payment methods added yet — add CBE and/or Telebirr so residents have somewhere to pay.
          </p>
        ) : (
          <div className="divide-y divide-ink-100 mt-3">
            {sorted.map((m) => {
              const pc = pendingChangeForMethod(m.id)
              return (
                <div key={m.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-800 truncate flex items-center gap-2">
                      {m.label}
                      {pc && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 px-2 py-0.5 text-[11px] font-medium shrink-0">
                          <Clock className="h-3 w-3" /> Pending approval
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-ink-400 truncate">
                      {METHOD_PROVIDERS.find((p) => p.value === m.provider)?.label || m.provider}
                      {m.provider === 'TELEBIRR' ? ` · ${m.phoneNumber || 'no phone set'}` : ` · ${m.accountNumber || 'no account set'}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {pc ? (
                      <button
                        onClick={() => handleCancelPending(pc)}
                        disabled={cancellingId === pc.id}
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-500 bg-ink-50 hover:bg-ink-100 disabled:opacity-50"
                        title="Withdraw this proposed change"
                      >
                        <XCircle className="h-3.5 w-3.5" /> {cancellingId === pc.id ? 'Withdrawing…' : 'Withdraw'}
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => toggleActive(m)}
                          title={m.isActive ? 'Active — click to disable' : 'Disabled — click to enable'}
                          className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition ${m.isActive ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100' : 'text-ink-400 bg-ink-50 hover:bg-ink-100'}`}
                        >
                          {m.isActive ? <ToggleRight className="h-3.5 w-3.5" /> : <ToggleLeft className="h-3.5 w-3.5" />}
                          {m.isActive ? 'Active' : 'Disabled'}
                        </button>
                        <button onClick={() => openEdit(m)} className="p-1.5 rounded-lg text-ink-400 hover:text-brand-700 hover:bg-brand-50" title="Edit">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(m)}
                          disabled={deletingId === m.id}
                          className="p-1.5 rounded-lg text-ink-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                          title="Remove"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
            {myPendingMethodChanges.filter((pc) => pc.changeType === 'PAYMENT_METHOD_CREATE').map((pc) => (
              <div key={pc.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-800 truncate flex items-center gap-2">
                    {pc.diff?.label?.to || 'New payment method'}
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 px-2 py-0.5 text-[11px] font-medium shrink-0">
                      <Clock className="h-3 w-3" /> Pending approval
                    </span>
                  </p>
                  <p className="text-xs text-ink-400 truncate">
                    {METHOD_PROVIDERS.find((p) => p.value === pc.diff?.provider?.to)?.label || pc.diff?.provider?.to}
                  </p>
                </div>
                <button
                  onClick={() => handleCancelPending(pc)}
                  disabled={cancellingId === pc.id}
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-500 bg-ink-50 hover:bg-ink-100 disabled:opacity-50 shrink-0"
                >
                  <XCircle className="h-3.5 w-3.5" /> {cancellingId === pc.id ? 'Withdrawing…' : 'Withdraw'}
                </button>
              </div>
            ))}
          </div>
        )}

        <Modal open={modal} onClose={() => setModal(false)} title={editingId ? 'Edit payment option' : 'Add payment option'}>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label">Provider</label>
              <div className="grid grid-cols-2 gap-2.5">
                {METHOD_PROVIDERS.map((p) => {
                  const selected = form.provider === p.value
                  const Icon = p.value === 'TELEBIRR' ? Smartphone : Landmark
                  return (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => chooseProvider(p.value)}
                      className={`flex flex-col items-center gap-1.5 rounded-xl px-3 py-3.5 text-center transition ring-1 ${
                        selected
                          ? 'bg-brand-50 ring-brand-300 text-brand-700'
                          : 'bg-white ring-ink-200 text-ink-500 hover:bg-ink-50'
                      }`}
                    >
                      <Icon className={`h-5 w-5 ${selected ? 'text-brand-600' : 'text-ink-400'}`} />
                      <span className="text-sm font-semibold leading-tight">{p.short}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {isTelebirr ? (
              <>
                <div>
                  <label className="label">Full name on the Telebirr account</label>
                  <input required className="input" value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Phone number</label>
                  <input required className="input font-mono" placeholder="2519XXXXXXXX" value={form.phoneNumber} onChange={(e) => setForm((f) => ({ ...f, phoneNumber: e.target.value }))} />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="label">Account name</label>
                  <input required className="input" value={form.accountName} onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Account number</label>
                  <input required className="input font-mono" value={form.accountNumber} onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))} />
                </div>
              </>
            )}

            {error && <div className="rounded-xl bg-rose-50 border border-rose-100 px-3.5 py-2.5 text-sm text-rose-600">{error}</div>}

            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      </div>

      <form onSubmit={saveThreshold} className="card p-6 max-w-2xl mt-6">
        <h3 className="text-sm font-semibold text-ink-800 mb-1 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" /> Self-verification safeguard
        </h3>
        <p className="text-xs text-ink-400 mb-3">
          Self-verified payments at or above this amount always go to "Pending review" for a committee
          member to check, even if the bank lookup matched. Leave blank to only rely on the automatic
          name/amount cross-checks.
        </p>
        <div className="max-w-xs">
          <label className="label">Auto-verify review threshold (birr)</label>
          <input
            type="number" min="0" step="1" className="input"
            placeholder="e.g. 5000"
            value={thresholdValue}
            onChange={(e) => { thresholdDirtyRef.current = true; setThresholdValue(e.target.value) }}
          />
        </div>
        <div className="flex items-center gap-3 pt-4">
          <button type="submit" disabled={thresholdSaving} className="btn-primary !py-1.5 !px-3 text-xs">
            <Save className="h-3.5 w-3.5" /> {thresholdSaving ? 'Saving…' : 'Save threshold'}
          </button>
          {thresholdSaved && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
              <CheckCircle2 className="h-4 w-4" /> Saved
            </span>
          )}
        </div>
      </form>
    </div>
  )
}


// ===========================================================================
// Approvals — per-person automation for the multi-committee sign-off flow.
// Kept out of Community because it's not a shared setting — each committee
// member turns this on/off for themselves only.
// ===========================================================================
function ApprovalsTab({ user }) {
  const [changeTypes, setChangeTypes] = useState([])
  const [autoApprovalSettings, setAutoApprovalSettings] = useState([])
  const [committeeMembers, setCommitteeMembers] = useState([])
  const [autoApprovalLoading, setAutoApprovalLoading] = useState(true)
  const [confirmEnable, setConfirmEnable] = useState(null)
  const [enableDays, setEnableDays] = useState(7)
  const [scopeMode, setScopeMode] = useState('all') // 'all' | 'specific'
  const [scopedIds, setScopedIds] = useState([])
  const [ackSaving, setAckSaving] = useState(false)

  async function loadAutoApprovals() {
    setAutoApprovalLoading(true)
    try {
      const { data } = await api.get(endpoints.committeeAutoApprovals())
      // "Community payment account details" is the legacy single-account
      // toggle from before payment methods became a list (CBE/Telebirr) —
      // no longer surfaced here since it's not something to auto-approve.
      setChangeTypes((data.data.changeTypes || []).filter((ct) => ct.changeType !== 'COMMUNITY_PAYMENT_DETAILS'))
      setAutoApprovalSettings(data.data.settings)
      setCommitteeMembers(data.data.committeeMembers || [])
    } catch (err) {
      notify(err?.response?.data?.message || err.message)
    } finally {
      setAutoApprovalLoading(false)
    }
  }
  useEffect(() => { loadAutoApprovals() }, [])

  function mySetting(changeType) {
    return autoApprovalSettings.find((s) => s.changeType === changeType && s.userId === user?.id)
  }
  function isMineEnabled(changeType) {
    const s = mySetting(changeType)
    return !!s?.enabled && new Date(s.expiresAt) > new Date()
  }

  async function turnOff(changeType) {
    try {
      const { data } = await api.put(endpoints.committeeAutoApprovals(), { changeType, enabled: false })
      setAutoApprovalSettings((list) => {
        const others = list.filter((s) => !(s.changeType === changeType && s.userId === user?.id))
        return [...others, data.data]
      })
      notify('Auto-approval turned off.', 'success')
    } catch (err) {
      notify(err?.response?.data?.message || err.message)
    }
  }

  function requestTurnOn(changeType) {
    setEnableDays(7)
    const existing = mySetting(changeType)
    const existingScope = existing?.scopedToUserIds || []
    setScopeMode(existingScope.length > 0 ? 'specific' : 'all')
    setScopedIds(existingScope)
    setConfirmEnable({ changeType })
  }

  function toggleScopedId(id) {
    setScopedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function confirmTurnOn(e) {
    e.preventDefault()
    if (!confirmEnable) return
    if (scopeMode === 'specific' && scopedIds.length === 0) {
      notify('Pick at least one committee member, or switch to "Anyone".')
      return
    }
    setAckSaving(true)
    try {
      const { data } = await api.put(endpoints.committeeAutoApprovals(), {
        changeType: confirmEnable.changeType,
        enabled: true,
        expiresInDays: Number(enableDays),
        acknowledged: true,
        scopedToUserIds: scopeMode === 'specific' ? scopedIds : [],
      })
      setAutoApprovalSettings((list) => {
        const others = list.filter((s) => !(s.changeType === confirmEnable.changeType && s.userId === user?.id))
        return [...others, data.data]
      })
      setConfirmEnable(null)
      notify(`Auto-approval turned on for ${enableDays} day(s).`, 'success')
    } catch (err) {
      notify(err?.response?.data?.message || err.message)
    } finally {
      setAckSaving(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="card p-6">
        <h3 className="text-sm font-semibold text-ink-800 mb-1 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-brand-600" /> Committee approval automation
        </h3>
        <p className="text-xs text-ink-400 mb-4">
          By default, every sensitive change needs your explicit approval. If that gets overwhelming, you can turn on
          auto-approval per type of request, for a set number of days — your vote is then filled in automatically the
          instant a matching request is created. This is per request type: turning it on for one doesn't turn it on
          for the others, and you can turn it off again any time. You can also limit it to specific committee
          members instead of covering anyone's proposals.
        </p>

        {autoApprovalLoading ? (
          <p className="text-sm text-ink-400">Loading…</p>
        ) : (
          <div className="divide-y divide-ink-100">
            {changeTypes.map((ct) => {
              const mine = mySetting(ct.changeType)
              const mineOn = isMineEnabled(ct.changeType)
              return (
                <div key={ct.changeType} className="py-3.5 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-ink-700">{ct.label}</p>
                    {mineOn && mine && (
                      <p className="text-xs text-emerald-600 mt-0.5">
                        On until {new Date(mine.expiresAt).toLocaleDateString()}
                        {mine.scopedToUserIds?.length > 0 && (
                          <> — only for {mine.scopedToUserIds
                            .map((id) => committeeMembers.find((m) => m.id === id)?.fullName || 'a former member')
                            .join(', ')}</>
                        )}
                      </p>
                    )}
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={mineOn}
                      onChange={(e) => (e.target.checked ? requestTurnOn(ct.changeType) : turnOff(ct.changeType))}
                    />
                    <div className="w-10 h-6 bg-ink-200 peer-checked:bg-brand-600 rounded-full transition-colors relative">
                      <div className={`absolute top-0.5 left-0.5 h-5 w-5 bg-white rounded-full shadow transition-transform ${mineOn ? 'translate-x-4' : ''}`} />
                    </div>
                  </label>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Modal open={!!confirmEnable} onClose={() => setConfirmEnable(null)} title="Turn on auto-approval?">
        <form onSubmit={confirmTurnOn} className="space-y-4">
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-sm text-amber-700 flex gap-2 items-start">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Auto-approving does not make you immune from accountability. If a request gets waved through this way
              and turns out to be abusive or wrong, you're still responsible for having had auto-approval on when it
              happened — the audit log records every auto-approved decision under your name.
            </span>
          </div>
          <div>
            <label className="label">Auto-approve for how many days?</label>
            <input
              type="number" min="1" max="365" required className="input"
              value={enableDays}
              onChange={(e) => setEnableDays(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Whose proposals should this cover?</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setScopeMode('all')}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${scopeMode === 'all' ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-500 hover:bg-ink-50'}`}
              >
                Anyone
              </button>
              <button
                type="button"
                onClick={() => setScopeMode('specific')}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${scopeMode === 'specific' ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-500 hover:bg-ink-50'}`}
              >
                Specific member(s)
              </button>
            </div>
            {scopeMode === 'specific' && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-ink-200 divide-y divide-ink-100">
                {committeeMembers.length === 0 ? (
                  <p className="text-xs text-ink-400 px-3 py-2">No other committee members yet.</p>
                ) : committeeMembers.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-ink-50">
                    <input
                      type="checkbox"
                      checked={scopedIds.includes(m.id)}
                      onChange={() => toggleScopedId(m.id)}
                    />
                    {m.fullName}
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-ink-400 mt-1.5">
              {scopeMode === 'all'
                ? 'Any committee member who proposes this type of change gets auto-approved by you.'
                : 'Only proposals from the member(s) you pick above get auto-approved — everyone else still needs your explicit vote.'}
            </p>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={() => setConfirmEnable(null)} disabled={ackSaving} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={ackSaving} className="btn-primary flex-1">{ackSaving ? 'Turning on…' : 'I understand, turn it on'}</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

// ===========================================================================
// Membership — handing off a committee seat. About "him" (his own seat),
// but consequential enough for the whole community's governance that it
// gets its own tab rather than hiding inside Profile.
// ===========================================================================
function MembershipTab({ user }) {
  const { residents, requestCommitteeTransfer, fetchMyTransferItems, cancelCommitteeTransfer } = useData()

  const [transferOpen, setTransferOpen] = useState(false)
  const [transferTarget, setTransferTarget] = useState('')
  const [transferQuery, setTransferQuery] = useState('')
  const [transferSubmitting, setTransferSubmitting] = useState(false)
  const [transferError, setTransferError] = useState('')
  const [transferConfirm, setTransferConfirm] = useState(false)
  const [myOutgoingRequest, setMyOutgoingRequest] = useState(null)
  const [cancelling, setCancelling] = useState(false)
  const [banner, setBanner] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchMyTransferItems().then((r) => {
      if (!cancelled) setMyOutgoingRequest(r.asRequester?.[0] || null)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [fetchMyTransferItems])

  const eligibleResidents = residents.filter((r) => r.userId !== user?.id && r.status === 'active')
  const filteredResidents = (() => {
    const q = transferQuery.trim().toLowerCase()
    if (!q) return eligibleResidents
    return eligibleResidents.filter((r) => [r.name, r.unit, r.email].join(' ').toLowerCase().includes(q))
  })()
  const selectedResident = eligibleResidents.find((r) => r.id === transferTarget)

  async function confirmTransfer() {
    setTransferSubmitting(true)
    setTransferError('')
    try {
      const created = await requestCommitteeTransfer(transferTarget)
      setMyOutgoingRequest(created)
      setTransferConfirm(false)
      setTransferOpen(false)
      setBanner('Transfer request sent. It needs every other committee member to approve, then the resident\u2019s acceptance.')
      setTimeout(() => setBanner(''), 5000)
    } catch (err) {
      setTransferError(err?.response?.data?.message || err.message || 'Could not start the transfer.')
      setTransferConfirm(false)
    } finally {
      setTransferSubmitting(false)
    }
  }

  async function cancelOutgoing() {
    if (!myOutgoingRequest) return
    setCancelling(true)
    try {
      await cancelCommitteeTransfer(myOutgoingRequest.id)
      setMyOutgoingRequest(null)
    } catch (err) {
      notify(err?.response?.data?.message || err.message || 'Could not cancel the request.')
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="max-w-2xl">
      {banner && <div className="mb-5 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3 text-sm text-emerald-700">{banner}</div>}

      <div className="card p-5 space-y-3">
        <h3 className="font-semibold text-ink-800 flex items-center gap-2"><Users2 className="h-4 w-4 text-brand-600" /> Transfer committee status</h3>
        <p className="text-sm text-ink-500">
          Hand your committee seat to another resident. The transfer only goes through once every other
          committee member approves, and the resident you choose accepts it too.
        </p>

        {myOutgoingRequest ? (
          <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-amber-700">
              <Clock className="h-4 w-4 shrink-0" />
              <span>
                Pending &mdash; {myOutgoingRequest.status === 'PENDING_COMMITTEE' ? 'awaiting committee approval' : 'awaiting the resident\u2019s acceptance'} for{' '}
                <strong>{myOutgoingRequest.toResident?.user?.fullName}</strong>.
              </span>
            </div>
            <button onClick={cancelOutgoing} disabled={cancelling} className="btn-secondary !py-1.5 !px-3 text-xs shrink-0">
              <XCircle className="h-3.5 w-3.5" /> {cancelling ? 'Cancelling…' : 'Cancel'}
            </button>
          </div>
        ) : (
          <button onClick={() => { setTransferOpen(true); setTransferTarget(''); setTransferQuery(''); setTransferError('') }} className="btn-secondary">
            <Users2 className="h-4 w-4" /> Start a transfer
          </button>
        )}
      </div>

      {/* Transfer: pick resident */}
      <Modal open={transferOpen} onClose={() => setTransferOpen(false)} title="Transfer committee status">
        <div className="space-y-4">
          <p className="text-sm text-ink-500">Search for the resident you want to become a committee member in your place.</p>
          <div>
            <label className="label">Resident</label>
            {selectedResident ? (
              <div className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50/60 px-3.5 py-2.5">
                <div className="flex items-center gap-2 text-sm">
                  <Check className="h-4 w-4 text-brand-600 shrink-0" />
                  <span className="font-medium text-ink-800">{selectedResident.name}</span>
                  <span className="text-ink-400">· Unit {selectedResident.unit}</span>
                </div>
                <button
                  type="button"
                  onClick={() => { setTransferTarget(''); setTransferQuery('') }}
                  className="text-xs font-medium text-brand-600 hover:text-brand-700"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
                <input
                  autoFocus
                  className="input pl-9"
                  placeholder="Type a name, unit, or email…"
                  value={transferQuery}
                  onChange={(e) => setTransferQuery(e.target.value)}
                />
                {transferQuery.trim() && (
                  <div className="mt-1.5 rounded-xl border border-ink-100 max-h-56 overflow-y-auto divide-y divide-ink-50">
                    {filteredResidents.length === 0 ? (
                      <p className="px-3.5 py-3 text-sm text-ink-400 text-center">No matching residents.</p>
                    ) : (
                      filteredResidents.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => { setTransferTarget(r.id); setTransferQuery('') }}
                          className="w-full text-left px-3.5 py-2.5 hover:bg-brand-50 transition flex items-center justify-between"
                        >
                          <span className="text-sm font-medium text-ink-800">{r.name}</span>
                          <span className="text-xs text-ink-400">Unit {r.unit}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          {transferError && <p className="text-sm text-rose-600">{transferError}</p>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={() => setTransferOpen(false)} className="btn-secondary flex-1">Cancel</button>
            <button type="button" disabled={!transferTarget} onClick={() => setTransferConfirm(true)} className="btn-primary flex-1 disabled:opacity-40">Continue</button>
          </div>
        </div>
      </Modal>

      {/* Transfer: final confirmation */}
      <Modal open={transferConfirm} onClose={() => setTransferConfirm(false)} title="Confirm transfer request">
        <div className="space-y-4">
          <p className="text-sm text-ink-500">
            You’re about to request handing your committee seat to{' '}
            <strong className="text-ink-800">{selectedResident?.name}</strong>.
            This can’t be undone once everyone accepts &mdash; are you sure?
          </p>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={() => setTransferConfirm(false)} className="btn-secondary flex-1">Go back</button>
            <button type="button" disabled={transferSubmitting} onClick={confirmTransfer} className="btn-primary flex-1">
              {transferSubmitting ? 'Sending…' : 'Yes, send request'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
