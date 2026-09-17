import { ShieldAlert } from 'lucide-react'
import type { ApplicationModel } from './types'

export function EmbeddedApplication({ application }: { application: ApplicationModel }) {
  return <div className="live-browser-empty light"><ShieldAlert /><p>{application.company || 'This employer'} requires an assisted browser session. Application embeds are disabled.</p></div>
}
