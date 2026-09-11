import { useEffect, useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { Mail, Phone, Lock, Eye, EyeOff, ArrowRight, ShieldCheck, TrendingUp, Users } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import api, { endpoints } from '../lib/api'
import { currentCommunitySlug } from '../lib/subdomain'
import { portalBase } from '../lib/paths'
import './Login.css'

const features = [
  { icon: ShieldCheck, text: 'Every payment logged with a verifiable receipt trail' },
  { icon: TrendingUp, text: 'Live fund balances across security, maintenance & projects' },
  { icon: Users, text: 'Residents see exactly where their contributions go' },
]

export default function Login({ communitySlug: propSlug }) {
  const { login, loading, error, demoLogins } = useAuth()
  const [method, setMethod] = useState('email') // 'email' | 'phone'
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  // Primary source: the "/:communitySlug" route param (App.jsx), i.e. this
  // community's own permanent link, https://<host>/<slug>. Falls back to
  // subdomain detection (currentCommunitySlug) for a possible future
  // custom-domain setup, then to plain /login with no community context
  // at all. Either way, when a slug is present it's sent along with the
  // login request so the backend refuses a login that doesn't actually
  // belong to this tenant (authController.login) — logging into the wrong
  // community's page never succeeds even with a correct email/password.
  const communitySlug = propSlug || currentCommunitySlug()
  const [community, setCommunity] = useState(null)
  const [communityLookupFailed, setCommunityLookupFailed] = useState(false)

  useEffect(() => {
    if (!communitySlug) return
    setCommunity(null)
    setCommunityLookupFailed(false)
    api
      .get(endpoints.communityBySlug(communitySlug))
      .then(({ data }) => setCommunity(data.data))
      .catch(() => setCommunityLookupFailed(true))
  }, [communitySlug])

  // A slug in the URL that doesn't match any community — mistyped, or a
  // community that was renamed/removed. Show that plainly instead of a
  // generic sign-in form that would just fail every attempt with the same
  // "Invalid credentials" message (see authController.login).
  if (communitySlug && communityLookupFailed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-ink-900 px-6">
        <div className="max-w-sm text-center">
          <img src="/oudaa-logo-full.png" alt="Oudaa" className="mx-auto mb-6 h-9 w-auto object-contain" />
          <h2 className="text-xl font-bold text-ink-900 dark:text-ink-50">Community not found</h2>
          <p className="mt-2 text-sm text-ink-500 dark:text-ink-400">
            There's no community at <span className="font-medium text-ink-700 dark:text-ink-300">/{communitySlug}</span>. Check the link your committee shared with you, or contact them for your community's correct sign-in address.
          </p>
        </div>
      </div>
    )
  }

  async function onSubmit(e) {
    e.preventDefault()
    try {
      const identifier = method === 'email' ? email : phone
      const u = await login(identifier, password, communitySlug || undefined)
      const dest = location.state?.from || portalBase(u)
      navigate(dest, { replace: true })
    } catch {
      // error shown via context
    }
  }

  async function fillDemo(role) {
    const d = demoLogins.find((x) => x.role === role)
    setEmail(d.email)
    setPassword(d.password)
    try {
      const u = await login(d.email, d.password, communitySlug || undefined)
      const dest = location.state?.from || portalBase(u)
      navigate(dest, { replace: true })
    } catch {
      // error shown via context
    }
  }

  return (
    <main className="auth-hero">
      <div className="bg-photo" aria-hidden="true" />
      <div className="bg-wash" aria-hidden="true" />

      <section className="hero">
        <header className="brand">
          <img src="/oudaa-logo-full.png" alt="Oudaa" />
        </header>

        <div className="copy">
          <h1>
            Every birr accounted for.
            <br />
            Every <span>resident in the</span>
            <br />
            <span>loop.</span>
          </h1>

          <p className="lead">
            A single, transparent home for contributions,
            <br className="desktop" />
            community funds, projects, and receipts — built
            <br className="desktop" />
            for committees and residents to trust the same numbers.
          </p>

          <div className="features">
            {features.map(({ icon: Icon, text }) => (
              <div className="feature" key={text}>
                <div className="feature-icon"><Icon className="h-[19px] w-[19px]" /></div>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </div>

        <footer>© {new Date().getFullYear()} Oudaa</footer>
      </section>

      <section className="login-wrap">
        <div className="login-card">
          <div className="leaf leaf-top" />
          <div className="leaf leaf-bottom" />

          <div className="login-content">
            <img className="card-logo" src="/oudaa-logo-full.png" alt="Oudaa" />

            <h2>{community ? `Sign in to ${community.name}` : 'Welcome back'}</h2>
            <p className="subtitle">Sign in to manage your community's finances.</p>

            <form onSubmit={onSubmit}>
              <label className="section-label">SIGN IN WITH</label>

              <div className="method-toggle">
                <button type="button" className={method === 'email' ? 'active' : ''} onClick={() => setMethod('email')}>
                  <Mail className="h-[17px] w-[17px]" /> Email
                </button>
                <button type="button" className={method === 'phone' ? 'active' : ''} onClick={() => setMethod('phone')}>
                  <Phone className="h-[17px] w-[17px]" /> Phone
                </button>
              </div>

              <label className="field-label">{method === 'email' ? 'EMAIL ADDRESS' : 'PHONE NUMBER'}</label>
              <div className="input-wrap">
                {method === 'email' ? <Mail className="h-[18px] w-[18px]" /> : <Phone className="h-[18px] w-[18px]" />}
                {method === 'email' ? (
                  <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@community.org" />
                ) : (
                  <input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+251 9XX XXX XXX" />
                )}
              </div>

              <label className="field-label">PASSWORD</label>
              <div className="input-wrap">
                <Lock className="h-[18px] w-[18px]" />
                <input required type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                <button className="icon-button" type="button" aria-label={showPw ? 'Hide password' : 'Show password'} onClick={() => setShowPw((v) => !v)}>
                  {showPw ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                </button>
              </div>

              {error && <div className="form-error">{error}</div>}

              <div className="options">
                <label className="remember">
                  <input type="checkbox" />
                  <span>Remember me</span>
                </label>
                <Link to="/forgot-password" className="forgot">Forgot password?</Link>
              </div>

              <button className="signin" type="submit" disabled={loading}>
                {!loading && <ArrowRight className="h-[18px] w-[18px]" />}
                <span>{loading ? 'Signing in…' : 'Sign in'}</span>
              </button>
            </form>

            {!communitySlug && (
              <div className="demo">
                <strong>Try the demo</strong>
                <span>One click, no typing — signs you straight in.</span>
                <div className="demo-buttons">
                  <button type="button" disabled={loading} onClick={() => fillDemo('admin')}>
                    {loading ? 'Signing in…' : 'Committee login'}
                  </button>
                  <button type="button" disabled={loading} onClick={() => fillDemo('resident')}>
                    {loading ? 'Signing in…' : 'Resident login'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}
