import { useEffect, useState } from 'react'
import { useTheme } from '../context/ThemeContext'

const COLORS = {
  light: '#f5f8ff',
  dark: '#141414',
}
const GLOW = {
  light: 'rgba(90,164,255,0.55)',
  dark: 'rgba(37,112,245,0.5)',
}

// Two triangles — one racing in from the top-right corner, one from the
// bottom-left — that grow to meet along the diagonal, fully covering the
// screen, then shrink back out to reveal the new theme underneath.
export default function ThemeTransitionOverlay() {
  const { transition } = useTheme()
  const { phase, target, coverMs, revealMs } = transition
  // `grown` controls whether the triangles are at their full covering
  // size (true) or collapsed to their origin corner (false). Toggled a
  // frame after mount so the browser actually animates the change
  // instead of snapping straight to the end state.
  const [grown, setGrown] = useState(false)

  useEffect(() => {
    if (phase === 'covering') {
      setGrown(false)
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setGrown(true)))
      return () => cancelAnimationFrame(raf)
    }
    if (phase === 'revealing') {
      setGrown(false)
    }
  }, [phase])

  if (!phase) return null

  const bg = COLORS[target] || COLORS.light
  const glow = GLOW[target] || GLOW.light
  const duration = phase === 'covering' ? coverMs : revealMs
  const ease = phase === 'covering' ? 'cubic-bezier(.5,0,.2,1)' : 'cubic-bezier(.65,0,.35,1)'

  const trBase = 'polygon(100% 0%, 100% 0%, 100% 0%)'
  const trFull = 'polygon(0% 0%, 100% 0%, 100% 100%)'
  const blBase = 'polygon(0% 100%, 0% 100%, 0% 100%)'
  const blFull = 'polygon(0% 0%, 0% 100%, 100% 100%)'

  const shared = {
    position: 'fixed',
    inset: 0,
    background: bg,
    transition: `clip-path ${duration}ms ${ease}`,
    filter: `drop-shadow(0 0 22px ${glow})`,
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999]" aria-hidden="true">
      <div style={{ ...shared, clipPath: grown ? trFull : trBase }} />
      <div style={{ ...shared, clipPath: grown ? blFull : blBase }} />
    </div>
  )
}
