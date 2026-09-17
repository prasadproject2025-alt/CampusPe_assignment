import { chmodSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

try {
  process.loadEnvFile(resolve(import.meta.dirname, '../.env'))
} catch {}

export const rootDir = resolve(import.meta.dirname, '../..')
export const dataDir = resolve(rootDir, 'data')
export const uploadDir = resolve(rootDir, 'uploads', 'resumes')
export const tailoredResumeDir = resolve(uploadDir, 'tailored')
export const browserDataDir = resolve(rootDir, 'browser-data')
export const databasePath = resolve(dataDir, 'jobcopilot.db')
export const encryptionKeyPath = resolve(dataDir, 'jobcopilot.key')
export const port = Number(process.env.PORT || 3001)

// CAPTCHA Configuration (backend-only, never exposed to frontend)
export const captchaConfig = {
  get sessionTimeoutMs() { return Number(process.env.CAPTCHA_SESSION_TIMEOUT_MS || 600000) },
  get monitorIntervalMs() { return Number(process.env.CAPTCHA_MONITOR_INTERVAL_MS || 2000) },
  get capsolverApiKey() { return process.env.CAPSOLVER_API_KEY || null },
}

process.umask(0o077)
mkdirSync(dataDir, { recursive: true, mode: 0o700 })
mkdirSync(uploadDir, { recursive: true, mode: 0o700 })
mkdirSync(tailoredResumeDir, { recursive: true, mode: 0o700 })
mkdirSync(browserDataDir, { recursive: true, mode: 0o700 })
chmodSync(dataDir, 0o700)
chmodSync(uploadDir, 0o700)
chmodSync(tailoredResumeDir, 0o700)
chmodSync(browserDataDir, 0o700)
