import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserContext } from 'playwright-core'
import { dataDir } from '../../config.js'

// Opt-in: traces contain form values and network payloads. Keep them local and
// outside source control; never publish or attach them automatically.
export async function startSubmissionTrace(context: BrowserContext, runId: string) {
  if (process.env.AUTOMATION_TRACE !== '1') return undefined
  const directory = join(dataDir, 'traces')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, `${runId.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`)
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true, title: `JobCopilot ${runId}` })
  return async () => { await context.tracing.stop({ path }) }
}
