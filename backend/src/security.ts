import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { encryptionKeyPath } from './config.js'

const getEncryptionKey = () => {
  if (!existsSync(encryptionKeyPath)) {
    writeFileSync(encryptionKeyPath, randomBytes(32), { mode: 0o600 })
  }
  chmodSync(encryptionKeyPath, 0o600)
  return readFileSync(encryptionKeyPath)
}

export const hashPassword = (password: string, salt = randomBytes(16).toString('hex')) => ({
  salt,
  hash: scryptSync(password, salt, 64).toString('hex'),
})

export const verifyPassword = (password: string, salt: string, expectedHash: string) => {
  const actual = scryptSync(password, salt, 64)
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
export const createSessionToken = () => randomBytes(32).toString('base64url')

export const encryptJson = (value: unknown) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
}

export const decryptJson = <T>(payload: string | null, fallback: T): T => {
  if (!payload) return fallback
  try {
    const [ivPart, tagPart, dataPart] = payload.split('.')
    if (!ivPart || !tagPart || !dataPart) return fallback
    const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivPart, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()])
    return JSON.parse(decrypted.toString('utf8')) as T
  } catch {
    return fallback
  }
}
