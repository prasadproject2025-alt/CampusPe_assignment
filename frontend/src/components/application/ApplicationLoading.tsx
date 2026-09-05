import { Bot } from 'lucide-react'

export function ApplicationLoading({ message }: { message?: string }) {
  return (
    <div className="application-loading" aria-busy="true">
      <div className="application-skeleton-header" />
      <div className="application-skeleton-row" />
      <div className="application-skeleton-row" />
      <div className="application-skeleton-row" />
      <p>{message || 'Loading application form…'}</p>
    </div>
  )
}

export function ApplicationEmpty() {
  return (
    <div className="live-browser-empty light">
      <Bot />
      <p>Paste a job link. JobCopilot extracts the application fields into this panel — never Chrome, and never a new tab.</p>
    </div>
  )
}
