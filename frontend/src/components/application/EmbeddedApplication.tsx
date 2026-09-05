import { ShieldAlert } from 'lucide-react'
import type { ApplicationModel } from './types'

function isAllowedEmbedUrl(value: string) {
  try {
    const url = new URL(value)
    return (url.hostname === 'boards.greenhouse.io' || url.hostname === 'job-boards.greenhouse.io') && url.pathname === '/embed/job_app'
  } catch {
    return false
  }
}

export function EmbeddedApplication({ application }: { application: ApplicationModel }) {
  const embedUrl = application.embedUrl && isAllowedEmbedUrl(application.embedUrl) ? application.embedUrl : null
  if (!embedUrl) {
    return (
      <div className="live-browser-empty light">
        <ShieldAlert />
        <p>This board does not allow an official in-page embed. JobCopilot will not iframe the public application URL.</p>
      </div>
    )
  }
  return (
    <iframe
      className="embedded-application-frame"
      title={`${application.company || 'Employer'} application form`}
      src={embedUrl}
      sandbox="allow-scripts allow-same-origin allow-forms"
    />
  )
}
