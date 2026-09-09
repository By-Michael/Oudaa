import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Globe,
  Plus,
  Sparkles,
  Trash2,
  User,
  Wallet,
} from 'lucide-react'
import api, { endpoints } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { APP_BASE_DOMAIN, communityUrl } from '../lib/subdomain'

/* ------------------------------------------------------------------ */
/* Constants                                                            */
/* ------------------------------------------------------------------ */

const STEPS = [
  { id: 1, label: 'Account', icon: User },
  { id: 2, label: 'Community', icon: Building2 },
  { id: 3, label: 'Fees', icon: Wallet },
  { id: 4, label: 'Review & launch', icon: Sparkles },
]

const FREQUENCIES = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'YEARLY', label: 'Yearly' },
  { value: 'ONE_TIME', label: 'One-time' },
]

const FEE_PRESETS = [
  { name: 'Monthly maintenance', amount: '500', frequency: 'MONTHLY' },
  { name: 'Security fee', amount: '300', frequency: 'MONTHLY' },
  { name: 'Special assessment', amount: '2000', frequency: 'ONE_TIME' },
]

function slugify(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
}

function makeFee(preset) {
  return {
    id: Math.random().toString(36).slice(2),
    name: preset?.name ?? '',
    amount: preset?.amount ?? '',
    frequency: preset?.frequency ?? 'MONTHLY',
    dueDay: preset?.dueDay ?? '1',
  }
}

const INITIAL_DATA = {
  fullName: '',
  email: '',
  phone: '',
  password: '',
  confirmPassword: '',
  confirmRole: false,
  communityName: '',
  slug: '',
  slugTouched: false,
  address: '',
  contactInfo: '',
  fees: [makeFee({ name: 'Monthly maintenance', amount: '500', frequency: 'MONTHLY' })],
}

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

function FieldError({ children }) {
  if (!children) return null
  return <p className="mt-1.5 text-xs font-medium text-red-600">{children}</p>
}

function SectionHeading({ eyebrow, title, body }) {
  return (
    <div className="mb-8">
      <span className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-300">{eyebrow}</span>
      <h2 className="mt-1.5 font-display text-2xl font-bold text-ink-900 sm:text-3xl dark:text-white">{title}</h2>
      <p className="mt-2 text-sm text-ink-500 dark:text-ink-400">{body}</p>
    </div>
  )
}

function Stepper({ step }) {
  return (
    <div className="mb-10">
      <div className="flex items-center">
        {STEPS.map((s, i) => {
          const done = step > s.id
          const active = step === s.id
          return (
            <div key={s.id} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-2">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors ${
                    done
                      ? 'border-brand-500 bg-brand-500 text-white'
                      : active
                        ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                        : 'border-ink-200 bg-white text-ink-400 dark:border-[#263255] dark:bg-[#131b30]'
                  }`}
                >
                  {done ? <Check size={17} /> : <s.icon size={16} />}
                </div>
                <span className={`hidden text-xs font-medium sm:block ${active || done ? 'text-ink-800 dark:text-ink-100' : 'text-ink-400'}`}>
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`mx-2 h-0.5 flex-1 rounded-full transition-colors ${done ? 'bg-brand-500' : 'bg-ink-100 dark:bg-[#263255]'}`} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Step 1 — Account                                                     */
/* ------------------------------------------------------------------ */

function StepAccount({ data, update, errors }) {
  const [showPw, setShowPw] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  return (
    <div>
      <SectionHeading
        eyebrow="Step 1 of 4"
        title="Create your admin account"
        body="This is you, the committee member setting things up. You'll manage the community from here."
      />
      <div className="space-y-5">
        <div>
          <label className="label">Full name</label>
          <input
            className="input"
            placeholder="Abebe Kebede"
            value={data.fullName}
            onChange={(e) => update({ fullName: e.target.value })}
          />
          <FieldError>{errors.fullName}</FieldError>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="label">Email address</label>
            <input
              type="email"
              className="input"
              placeholder="you@community.org"
              value={data.email}
              onChange={(e) => update({ email: e.target.value })}
            />
            <FieldError>{errors.email}</FieldError>
          </div>
          <div>
            <label className="label">Phone number</label>
            <input
              type="tel"
              className="input"
              placeholder="+251 9xx xxx xxx"
              value={data.phone}
              onChange={(e) => update({ phone: e.target.value })}
            />
            <FieldError>{errors.phone}</FieldError>
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="label">Password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                className="input pr-10"
                placeholder="••••••••"
                value={data.password}
                onChange={(e) => update({ password: e.target.value })}
              />
              <button type="button" tabIndex={-1} onClick={() => setShowPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600">
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <FieldError>{errors.password}</FieldError>
          </div>
          <div>
            <label className="label">Confirm password</label>
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                className="input pr-10"
                placeholder="••••••••"
                value={data.confirmPassword}
                onChange={(e) => update({ confirmPassword: e.target.value })}
              />
              <button type="button" tabIndex={-1} onClick={() => setShowConfirm((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600">
                {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <FieldError>{errors.confirmPassword}</FieldError>
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-ink-200 bg-ink-50/60 p-4 dark:border-[#263255] dark:bg-white/[0.03]">
          <input
            type="checkbox"
            checked={data.confirmRole}
            onChange={(e) => update({ confirmRole: e.target.checked })}
            className="mt-0.5 size-4 accent-brand-500"
          />
          <span className="text-sm text-ink-500 dark:text-ink-400">
            I confirm I'm setting this up as the <strong className="text-ink-800 dark:text-ink-100">committee / admin</strong>,
            not as an individual resident. Residents get their own accounts later, from the dashboard.
          </span>
        </label>
        <FieldError>{errors.confirmRole}</FieldError>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Step 2 — Community profile (incl. subdomain)                        */
/* ------------------------------------------------------------------ */

function StepCommunity({ data, update, errors }) {
  function onNameChange(v) {
    const patch = { communityName: v }
    if (!data.slugTouched) patch.slug = slugify(v)
    update(patch)
  }
  function onSlugChange(v) {
    update({ slug: slugify(v), slugTouched: true })
  }

  return (
    <div>
      <SectionHeading
        eyebrow="Step 2 of 4"
        title="Tell us about your community"
        body="This sets up the shared profile every resident and committee member will see."
      />
      <div className="space-y-5">
        <div>
          <label className="label">Community name</label>
          <input
            className="input"
            placeholder="e.g. Bole Ridge Villas"
            value={data.communityName}
            onChange={(e) => onNameChange(e.target.value)}
          />
          <FieldError>{errors.communityName}</FieldError>
        </div>

        <div>
          <label className="label">Your web address</label>
          <div className="flex items-center overflow-hidden rounded-lg border border-ink-200 focus-within:ring-2 focus-within:ring-brand-300 dark:border-[#263255]">
            <span className="flex items-center gap-1.5 bg-ink-50 px-3 py-2.5 text-sm text-ink-400 dark:bg-white/[0.03]">
              <Globe size={14} />
            </span>
            <input
              className="min-w-0 flex-1 bg-transparent px-1 py-2.5 text-sm text-ink-900 outline-none dark:text-white"
              placeholder="acme"
              value={data.slug}
              onChange={(e) => onSlugChange(e.target.value)}
            />
            <span className="whitespace-nowrap bg-ink-50 px-3 py-2.5 text-sm text-ink-400 dark:bg-white/[0.03]">
              .{APP_BASE_DOMAIN}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-ink-400">
            Residents and committee members will sign in at{' '}
            <span className="font-medium text-ink-600 dark:text-ink-300">{data.slug || 'your-community'}.{APP_BASE_DOMAIN}</span>.
            If it's taken, we'll add a number to the end automatically.
          </p>
          <FieldError>{errors.slug}</FieldError>
        </div>

        <div>
          <label className="label">Address</label>
          <input
            className="input"
            placeholder="Street, city, sub-city / district"
            value={data.address}
            onChange={(e) => update({ address: e.target.value })}
          />
        </div>

        <div>
          <label className="label">Other contact info (optional)</label>
          <input
            className="input"
            placeholder="Office phone, email, or anything residents might need"
            value={data.contactInfo}
            onChange={(e) => update({ contactInfo: e.target.value })}
          />
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Step 3 — Fees                                                        */
/* ------------------------------------------------------------------ */

function StepFees({ data, update, errors }) {
  function updateFee(id, patch) {
    update({ fees: data.fees.map((f) => (f.id === id ? { ...f, ...patch } : f)) })
  }
  function removeFee(id) {
    update({ fees: data.fees.filter((f) => f.id !== id) })
  }
  function addFee(preset) {
    update({ fees: [...data.fees, makeFee(preset)] })
  }

  return (
    <div>
      <SectionHeading
        eyebrow="Step 3 of 4"
        title="Set up your first fees"
        body="The fees residents will pay. You can add, edit or remove fees later from the dashboard."
      />
      <div className="space-y-4">
        {data.fees.map((fee, i) => (
          <div key={fee.id} className="rounded-xl border border-ink-200 bg-white p-4 dark:border-[#263255] dark:bg-[#131b30]">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">Fee {i + 1}</span>
              {data.fees.length > 1 && (
                <button type="button" onClick={() => removeFee(fee.id)} className="text-ink-400 hover:text-red-600" aria-label="Remove fee">
                  <Trash2 size={15} />
                </button>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="sm:col-span-2">
                <label className="label text-xs">Fee name</label>
                <input
                  className="input"
                  placeholder="e.g. Monthly maintenance"
                  value={fee.name}
                  onChange={(e) => updateFee(fee.id, { name: e.target.value })}
                />
              </div>
              <div>
                <label className="label text-xs">Amount</label>
                <input
                  type="number"
                  min="0"
                  className="input"
                  placeholder="500"
                  value={fee.amount}
                  onChange={(e) => updateFee(fee.id, { amount: e.target.value })}
                />
              </div>
              <div>
                <label className="label text-xs">Billing cycle</label>
                <select className="input" value={fee.frequency} onChange={(e) => updateFee(fee.id, { frequency: e.target.value })}>
                  {FREQUENCIES.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>
              {fee.frequency !== 'ONE_TIME' && (
                <div className="sm:col-span-4 sm:max-w-[10rem]">
                  <label className="label text-xs">Due day of month</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    className="input"
                    value={fee.dueDay}
                    onChange={(e) => updateFee(fee.id, { dueDay: e.target.value })}
                  />
                </div>
              )}
            </div>
          </div>
        ))}
        <FieldError>{errors.fees}</FieldError>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" onClick={() => addFee()} className="btn-secondary gap-1.5 text-sm">
            <Plus size={14} /> Add another fee
          </button>
          {FEE_PRESETS.map((p) => (
            <button key={p.name} type="button" onClick={() => addFee(p)} className="btn-ghost text-sm text-ink-500">
              + {p.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Step 4 — Review & launch                                             */
/* ------------------------------------------------------------------ */

function ReviewRow({ label, value }) {
  if (!value) return null
  return (
    <div className="flex items-center justify-between border-b border-ink-200 py-2.5 text-sm last:border-0 dark:border-[#263255]">
      <span className="text-ink-400">{label}</span>
      <span className="font-medium text-ink-800 dark:text-ink-100">{value}</span>
    </div>
  )
}

function StepReview({ data, onEdit, submitError }) {
  return (
    <div>
      <SectionHeading eyebrow="Step 4 of 4" title="Review & launch" body="Take a last look — you can jump back to any step to fix something." />
      <div className="space-y-5">
        <div className="rounded-xl border border-ink-200 bg-white p-5 dark:border-[#263255] dark:bg-[#131b30]">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-white"><User size={15} className="text-brand-500" /> Account</h3>
            <button type="button" onClick={() => onEdit(1)} className="text-xs font-medium text-brand-600 hover:underline">Edit</button>
          </div>
          <ReviewRow label="Name" value={data.fullName} />
          <ReviewRow label="Email" value={data.email} />
          <ReviewRow label="Phone" value={data.phone} />
        </div>

        <div className="rounded-xl border border-ink-200 bg-white p-5 dark:border-[#263255] dark:bg-[#131b30]">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-white"><Building2 size={15} className="text-brand-500" /> Community</h3>
            <button type="button" onClick={() => onEdit(2)} className="text-xs font-medium text-brand-600 hover:underline">Edit</button>
          </div>
          <ReviewRow label="Name" value={data.communityName} />
          <ReviewRow label="Web address" value={`${data.slug}.${APP_BASE_DOMAIN}`} />
          <ReviewRow label="Address" value={data.address} />
        </div>

        <div className="rounded-xl border border-ink-200 bg-white p-5 dark:border-[#263255] dark:bg-[#131b30]">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-white"><Wallet size={15} className="text-brand-500" /> Fees ({data.fees.length})</h3>
            <button type="button" onClick={() => onEdit(3)} className="text-xs font-medium text-brand-600 hover:underline">Edit</button>
          </div>
          <div className="space-y-2">
            {data.fees.map((f) => (
              <div key={f.id} className="flex items-center justify-between text-sm">
                <span className="text-ink-800 dark:text-ink-100">{f.name || 'Untitled fee'}</span>
                <span className="text-ink-400">{f.amount || '0'} · {FREQUENCIES.find((fr) => fr.value === f.frequency)?.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-dashed border-brand-300/60 bg-brand-50/60 p-4 text-xs leading-relaxed text-ink-500 dark:border-brand-500/30 dark:bg-brand-500/5 dark:text-ink-400">
          Bank/Telebirr payment accounts, residents, and additional committee members can all be added
          later from the dashboard — nothing here blocks you from launching today.
        </div>

        {submitError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-300">
            {submitError}
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Success screen                                                      */
/* ------------------------------------------------------------------ */

function SuccessScreen({ slug }) {
  const navigate = useNavigate()
  const url = communityUrl(slug)
  return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-brand-gradient shadow-glow">
        <CheckCircle2 size={40} className="text-white" />
      </div>
      <h2 className="mt-6 font-display text-3xl font-bold text-ink-900 dark:text-white">Your community is ready</h2>
      <p className="mt-3 text-ink-500 dark:text-ink-400">
        Your platform is live at <span className="font-medium text-ink-800 dark:text-ink-100">{url}</span>.
        Head to your dashboard to add residents, connect a payment account, and start collecting fees.
      </p>
      <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <button type="button" onClick={() => navigate('/admin')} className="btn-primary px-8 py-3">
          Go to dashboard <ArrowRight size={16} />
        </button>
        <Link to="/" className="btn-secondary px-8 py-3">Back to home</Link>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Validation                                                           */
/* ------------------------------------------------------------------ */

function validateStep(step, data) {
  const errors = {}
  if (step === 1) {
    if (!data.fullName.trim()) errors.fullName = 'Enter your full name.'
    if (!/^\S+@\S+\.\S+$/.test(data.email)) errors.email = 'Enter a valid email address.'
    if (!data.phone.trim()) errors.phone = 'Enter a phone number.'
    if (data.password.length < 8) errors.password = 'At least 8 characters.'
    if (data.confirmPassword !== data.password) errors.confirmPassword = "Passwords don't match."
    if (!data.confirmRole) errors.confirmRole = 'Please confirm your role to continue.'
  }
  if (step === 2) {
    if (!data.communityName.trim()) errors.communityName = 'Enter your community name.'
    if (!data.slug || data.slug.length < 2) errors.slug = 'Pick a web address at least 2 characters long.'
  }
  if (step === 3) {
    const hasValidFee = data.fees.some((f) => f.name.trim() && Number(f.amount) > 0)
    if (!hasValidFee) errors.fees = 'Add at least one fee with a name and amount.'
  }
  return errors
}

/* ------------------------------------------------------------------ */
/* Main page                                                            */
/* ------------------------------------------------------------------ */

export default function Signup() {
  const [step, setStep] = useState(1)
  const [data, setData] = useState(INITIAL_DATA)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [launchedSlug, setLaunchedSlug] = useState(null)
  const { adoptSession } = useAuth()

  function update(patch) {
    setData((prev) => ({ ...prev, ...patch }))
  }

  const errors = useMemo(() => validateStep(step, data), [step, data])
  const canAdvance = Object.keys(errors).length === 0

  function goNext() {
    if (!canAdvance) return
    if (step < 4) setStep(step + 1)
    else handleLaunch()
  }
  function goBack() {
    if (step > 1) setStep(step - 1)
  }

  async function handleLaunch() {
    setSubmitting(true)
    setSubmitError('')
    try {
      const { data: res } = await api.post(endpoints.register(), {
        community: {
          name: data.communityName,
          slug: data.slug,
          address: data.address || undefined,
          contactInfo: data.contactInfo || undefined,
        },
        admin: {
          fullName: data.fullName,
          email: data.email,
          password: data.password,
        },
      })

      const { community, user, accessToken } = res.data
      adoptSession(accessToken, user)

      // Create every fee the admin configured now that we're authenticated
      // as the new community's admin. Best-effort per row — one bad fee
      // shouldn't undo an otherwise-successful signup, so failures are
      // collected and surfaced without blocking the launch.
      const validFees = data.fees.filter((f) => f.name.trim() && Number(f.amount) > 0)
      const results = await Promise.allSettled(
        validFees.map((f) =>
          api.post(endpoints.fees(), {
            name: f.name.trim(),
            amount: Number(f.amount),
            frequency: f.frequency,
            dueDay: f.frequency === 'ONE_TIME' ? undefined : Number(f.dueDay) || 1,
          })
        )
      )
      const failedCount = results.filter((r) => r.status === 'rejected').length
      if (failedCount > 0 && failedCount === validFees.length) {
        setSubmitError(
          `Your community was created, but the fees couldn't be saved. You can add them from the dashboard's Fees page.`
        )
      }

      setLaunchedSlug(community.slug)
    } catch (e) {
      const msg = e?.response?.data?.message || e.message || 'Something went wrong creating your community.'
      setSubmitError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#eef1f9] text-ink-900 dark:bg-[#0b1120] dark:text-white">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/4 h-[28rem] w-[28rem] rounded-full bg-brand-300/15 blur-3xl dark:bg-brand-500/10" />
        <div className="absolute top-1/3 -right-20 h-[24rem] w-[24rem] rounded-full bg-teal-300/15 blur-3xl dark:bg-teal-500/10" />
      </div>

      <div className="relative z-10 mx-auto max-w-2xl px-5 pb-20 pt-10 sm:pt-14">
        <Link to="/" className="mb-8 inline-flex items-center">
          <img src="/oudaa-logo-full.png" alt="Oudaa" className="h-9 w-auto object-contain" />
        </Link>

        {!launchedSlug && (
          <>
            <Stepper step={step} />
            <div className="rounded-2xl border border-ink-200 bg-white p-6 shadow-card sm:p-8 dark:border-[#263255] dark:bg-white/[0.02]">
              {step === 1 && <StepAccount data={data} update={update} errors={errors} />}
              {step === 2 && <StepCommunity data={data} update={update} errors={errors} />}
              {step === 3 && <StepFees data={data} update={update} errors={errors} />}
              {step === 4 && <StepReview data={data} onEdit={setStep} submitError={submitError} />}

              <div className="mt-8 flex items-center justify-between border-t border-ink-200 pt-6 dark:border-[#263255]">
                <button
                  type="button"
                  onClick={goBack}
                  disabled={step === 1}
                  className={`btn-ghost gap-1.5 text-sm ${step === 1 ? 'invisible' : ''}`}
                >
                  <ArrowLeft size={15} /> Back
                </button>
                <button type="button" onClick={goNext} disabled={!canAdvance || submitting} className="btn-primary gap-1.5 px-6">
                  {step === 4 ? (submitting ? 'Creating your community…' : 'Create my community') : 'Continue'}
                  {step < 4 && <ArrowRight size={15} />}
                </button>
              </div>
            </div>

            <p className="mt-6 text-center text-sm text-ink-400">
              Already have an account? <Link to="/login" className="font-medium text-brand-600 hover:underline">Log in</Link>
            </p>
          </>
        )}

        {launchedSlug && <SuccessScreen slug={launchedSlug} />}
      </div>
    </main>
  )
}
