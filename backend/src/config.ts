import { chmodSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

export const rootDir = resolve(import.meta.dirname, '../..')
export const dataDir = resolve(rootDir, 'data')
export const uploadDir = resolve(rootDir, 'uploads', 'resumes')
export const tailoredResumeDir = resolve(uploadDir, 'tailored')
export const browserDataDir = resolve(rootDir, 'browser-data')
export const databasePath = resolve(dataDir, 'jobcopilot.db')
export const encryptionKeyPath = resolve(dataDir, 'jobcopilot.key')
export const port = Number(process.env.PORT || 3001)

process.umask(0o077)
mkdirSync(dataDir, { recursive: true, mode: 0o700 })
mkdirSync(uploadDir, { recursive: true, mode: 0o700 })
mkdirSync(tailoredResumeDir, { recursive: true, mode: 0o700 })
mkdirSync(browserDataDir, { recursive: true, mode: 0o700 })
chmodSync(dataDir, 0o700)
chmodSync(uploadDir, 0o700)
chmodSync(tailoredResumeDir, 0o700)
chmodSync(browserDataDir, 0o700)
