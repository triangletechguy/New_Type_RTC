import { useState } from 'react'
import { adminAssets } from '../../assets/rtc/catalog'

export function DashboardTabs({ tabs, activeTab, onChange }) {
  return (
    <nav className="admin-dashboard-tabs glass-card" aria-label="Admin dashboard sections">
      {tabs.map((tab) => (
        <button
          type="button"
          className={activeTab === tab.key ? 'active' : ''}
          key={tab.key}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}

export function AdminEmptyState({ title, detail }) {
  return (
    <section className="admin-empty-state glass-card">
      <img src={adminAssets.emptySessions} alt="" loading="lazy" />
      <div>
        <strong>{title}</strong>
        {detail ? <span>{detail}</span> : null}
      </div>
    </section>
  )
}

export function AdminCopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value || '')
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }

  return (
    <button type="button" className="admin-copy-button" onClick={copy}>
      {copied ? 'Copied' : label}
    </button>
  )
}

export function ApiSnippetCard({ eyebrow, title, detail, code }) {
  return (
    <article className="api-snippet-card">
      <div className="api-snippet-head">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <strong>{title}</strong>
          {detail ? <small>{detail}</small> : null}
        </div>
        <AdminCopyButton value={code} />
      </div>
      <pre>{code}</pre>
    </article>
  )
}
