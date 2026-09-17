#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const endpoint = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
const model = process.env.OLLAMA_MODEL || 'gemma3:4b'

function whichOllama() {
  const found = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ollama'], { encoding: 'utf8' })
  const path = found.stdout.trim().split(/\r?\n/).find(Boolean)
  return found.status === 0 && path && existsSync(path.split('\n')[0].trim()) ? path.split('\n')[0].trim() : ''
}

async function healthy() {
  try {
    const response = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(2_000) })
    return response.ok
  } catch {
    return false
  }
}

async function modelInstalled() {
  try {
    const response = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(2_000) })
    if (!response.ok) return false
    const payload = await response.json()
    const names = Array.isArray(payload?.models) ? payload.models.map((item) => String(item.name || '')) : []
    const want = model.toLowerCase()
    return names.some((name) => {
      const value = name.toLowerCase()
      return value === want || value.startsWith(`${want}:`) || value.split(':')[0] === want.split(':')[0]
    })
  } catch {
    return false
  }
}

async function waitUntilHealthy(ms) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await healthy()) return true
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  return false
}

function printManual() {
  console.warn(`[ollama] Not running at ${endpoint}. Resume analysis and drafted answers need it.`)
  console.warn('Install: https://ollama.com/download')
  console.warn('Then in a separate terminal:')
  console.warn('  ollama serve')
  console.warn(`  ollama pull ${model}`)
}

const already = await healthy()
if (!already) {
  const bin = whichOllama()
  if (!bin) {
    printManual()
    process.exit(0)
  }
  console.log('[ollama] Starting `ollama serve`…')
  const child = spawn(bin, ['serve'], { detached: true, stdio: 'ignore' })
  child.unref()
  if (!await waitUntilHealthy(12_000)) {
    printManual()
    process.exit(0)
  }
}

console.log(`[ollama] Ready at ${endpoint}`)
if (!await modelInstalled()) {
  console.warn(`[ollama] Model ${model} is not installed. Run: ollama pull ${model}`)
}
process.exit(0)
