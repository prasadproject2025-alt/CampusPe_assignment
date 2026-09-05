import { extractApplicationSchema } from './extractor.js'

export { shouldLaunchBrowserForStrategy } from './capabilities.js'

export async function loadCustomApplicationForm(board: string, jobUrl: string) {
  return extractApplicationSchema(board, jobUrl)
}
