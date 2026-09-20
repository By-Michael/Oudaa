import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

export default function PlatformPageHeader({ title, description, icon: Icon, eyebrow, backTo, backLabel, actions }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {backTo && (
          <Link to={backTo} className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 rounded mb-2">
            {backLabel || 'Back'}
          </Link>
        )}
        {eyebrow && <div className="text-[11px] uppercase tracking-[0.18em] text-ink-600 font-semibold mb-1">{eyebrow}</div>}
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-5 h-5 text-teal-400 shrink-0" aria-hidden="true" />}
          <h1 className="text-xl font-semibold tracking-tight text-white">{title}</h1>
        </div>
        {description && <p className="mt-1 text-sm text-ink-400 max-w-3xl">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0 flex-wrap">{actions}</div>}
    </div>
  )
}

export function Breadcrumbs({ items = [] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-ink-500 flex-wrap">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="inline-flex items-center gap-1">
          {index > 0 && <ChevronRight className="w-3 h-3 text-ink-700" aria-hidden="true" />}
          {item.to && index < items.length - 1 ? <Link to={item.to} className="hover:text-ink-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 rounded">{item.label}</Link> : <span className={index === items.length - 1 ? 'text-ink-300' : ''}>{item.label}</span>}
        </span>
      ))}
    </nav>
  )
}
