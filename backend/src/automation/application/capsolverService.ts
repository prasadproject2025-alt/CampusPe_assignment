import type { Page } from 'playwright-core'
import { captchaConfig } from '../../config.js'

export interface CapSolverResult {
  success: boolean
  token?: string
  type?: 'hcaptcha' | 'recaptcha' | 'turnstile'
  error?: string
}

export function isCapSolverConfigured(): boolean {
  const key = process.env.CAPSOLVER_API_KEY?.trim() || captchaConfig.capsolverApiKey?.trim()
  return Boolean(key)
}

export function getCapSolverApiKey(): string {
  return process.env.CAPSOLVER_API_KEY?.trim() || captchaConfig.capsolverApiKey?.trim() || ''
}

export async function hasValidCaptchaSolution(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    // Check Lever-specific input
    const leverInput = document.getElementById('hcaptchaResponseInput') as HTMLInputElement | null
    if (leverInput && leverInput.value && leverInput.value.length > 20) {
      const expired = (window as any).hcaptchaTokenExpired
      if (!expired) return true
    }

    // Check hCaptcha textareas/inputs
    const hResps = document.querySelectorAll('[name="h-captcha-response"], textarea[name="h-captcha-response"]')
    for (let i = 0; i < hResps.length; i++) {
      const val = (hResps[i] as HTMLInputElement | HTMLTextAreaElement).value
      if (val && val.length > 20) return true
    }

    // Check reCAPTCHA response
    const gResps = document.querySelectorAll('[name="g-recaptcha-response"], textarea[name="g-recaptcha-response"], #g-recaptcha-response')
    for (let i = 0; i < gResps.length; i++) {
      const val = (gResps[i] as HTMLInputElement | HTMLTextAreaElement).value
      if (val && val.length > 20) return true
    }

    // Check Cloudflare Turnstile
    const cfResps = document.querySelectorAll('[name="cf-turnstile-response"]')
    for (let i = 0; i < cfResps.length; i++) {
      const val = (cfResps[i] as HTMLInputElement).value
      if (val && val.length > 20) return true
    }

    return false
  }).catch(() => false)
}

export async function detectCaptchaOnPage(page: Page): Promise<{
  detected: boolean
  type?: 'hcaptcha' | 'recaptcha' | 'turnstile'
  siteKey?: string
  url?: string
  isInvisible?: boolean
}> {
  return page.evaluate(() => {
    // 1. Lever or standard hCaptcha container
    const hCaptchaEl = document.querySelector('#h-captcha, .h-captcha, [data-hcaptcha-widget-id]')
    if (hCaptchaEl) {
      const siteKey = hCaptchaEl.getAttribute('data-sitekey')
      if (siteKey) {
        return { detected: true, type: 'hcaptcha' as const, siteKey, url: window.location.href, isInvisible: true }
      }
    }

    // 2. hCaptcha iframe
    const hIframe = document.querySelector('iframe[src*="hcaptcha.com"]') as HTMLIFrameElement | null
    if (hIframe && hIframe.src) {
      const match = hIframe.src.match(/[#?&]sitekey=([a-f0-9-]+)/i)
      if (match) {
        return { detected: true, type: 'hcaptcha' as const, siteKey: match[1], url: window.location.href, isInvisible: false }
      }
    }

    // 3. Cloudflare Turnstile
    const cfEl = document.querySelector('.cf-turnstile, [data-turnstile-sitekey]')
    if (cfEl) {
      const siteKey = cfEl.getAttribute('data-sitekey') || cfEl.getAttribute('data-turnstile-sitekey')
      if (siteKey) {
        return { detected: true, type: 'turnstile' as const, siteKey, url: window.location.href, isInvisible: false }
      }
    }

    const cfIframe = document.querySelector('iframe[src*="challenges.cloudflare.com"]') as HTMLIFrameElement | null
    if (cfIframe && cfIframe.src) {
      const match = cfIframe.src.match(/[?&]sitekey=([a-zA-Z0-9_-]+)/i)
      if (match && match[1]) {
        return { detected: true, type: 'turnstile' as const, siteKey: match[1], url: window.location.href, isInvisible: false }
      }
    }

    // 4. Any element with data-sitekey (hCaptcha, Turnstile, or reCAPTCHA)
    const allSitekeys = document.querySelectorAll('[data-sitekey]:not(.cf-turnstile)')
    for (const el of Array.from(allSitekeys)) {
      const key = el.getAttribute('data-sitekey')
      if (key) {
        if (/^0x4/i.test(key)) {
          return { detected: true, type: 'turnstile' as const, siteKey: key, url: window.location.href, isInvisible: false }
        }
        // Hex / UUID format with hyphens is hCaptcha
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
          return { detected: true, type: 'hcaptcha' as const, siteKey: key, url: window.location.href, isInvisible: true }
        }
        return { detected: true, type: 'recaptcha' as const, siteKey: key, url: window.location.href, isInvisible: false }
      }
    }

    // 5. reCAPTCHA iframe
    const gIframe = document.querySelector('iframe[src*="recaptcha"]') as HTMLIFrameElement | null
    if (gIframe && gIframe.src) {
      const match = gIframe.src.match(/[?&]k=([a-zA-Z0-9_-]+)/i)
      if (match && match[1]) {
        return { detected: true, type: 'recaptcha' as const, siteKey: match[1], url: window.location.href, isInvisible: gIframe.src.includes('size=invisible') }
      }
    }

    return { detected: false }
  }).catch(() => ({ detected: false }))
}

export async function injectCaptchaToken(page: Page, token: string, type: 'hcaptcha' | 'recaptcha' | 'turnstile'): Promise<void> {
  await page.evaluate(({ token, type }) => {
    if (type === 'hcaptcha') {
      // Lever-specific element
      const leverInput = document.getElementById('hcaptchaResponseInput') as HTMLInputElement | null
      if (leverInput) {
        leverInput.value = token
        leverInput.dispatchEvent(new Event('input', { bubbles: true }))
        leverInput.dispatchEvent(new Event('change', { bubbles: true }))
      }

      if (typeof (window as any).hcaptchaTokenExpired !== 'undefined') {
        (window as any).hcaptchaTokenExpired = false
      }

      // Generic hCaptcha inputs and textareas
      const hResps = document.querySelectorAll('[name="h-captcha-response"], textarea[name="h-captcha-response"]')
      hResps.forEach(el => {
        ;(el as HTMLTextAreaElement | HTMLInputElement).value = token
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      })

      // Standard g-recaptcha response often used as hCaptcha fallback
      const gResps = document.querySelectorAll('[name="g-recaptcha-response"], textarea[name="g-recaptcha-response"]')
      gResps.forEach(el => {
        ;(el as HTMLTextAreaElement | HTMLInputElement).value = token
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      })

      // Call page callback if registered (Lever has onSuccess in global scope)
      if (typeof (window as any).onSuccess === 'function') {
        try {
          (window as any).onSuccess(token)
        } catch (err) {
          console.warn('Error invoking onSuccess callback:', err)
        }
      }
    } else if (type === 'recaptcha') {
      const gResps = document.querySelectorAll('[name="g-recaptcha-response"], textarea[name="g-recaptcha-response"], #g-recaptcha-response')
      gResps.forEach(el => {
        ;(el as HTMLTextAreaElement | HTMLInputElement).value = token
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      })

      // Check grecaptcha clients for callbacks
      const cfg = (window as any).___grecaptcha_cfg
      if (cfg && cfg.clients) {
        for (const clientId of Object.keys(cfg.clients)) {
          const client = cfg.clients[clientId]
          const searchAndInvoke = (obj: any, depth = 0) => {
            if (!obj || depth > 5) return
            for (const key of Object.keys(obj)) {
              if (key === 'callback' && typeof obj[key] === 'function') {
                try { obj[key](token) } catch {}
              } else if (typeof obj[key] === 'object') {
                searchAndInvoke(obj[key], depth + 1)
              }
            }
          }
          searchAndInvoke(client)
        }
      }
    } else if (type === 'turnstile') {
      const cfResps = document.querySelectorAll('[name="cf-turnstile-response"]')
      cfResps.forEach(el => {
        ;(el as HTMLInputElement).value = token
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      })
    }
  }, { token, type }).catch(err => {
    console.warn('[CapSolver] Error injecting captcha token into page:', err)
  })
}

export async function solveCaptchaWithCapSolver(
  apiKey: string,
  type: 'hcaptcha' | 'recaptcha' | 'turnstile',
  websiteURL: string,
  websiteKey: string,
  isInvisible?: boolean,
): Promise<{ success: boolean; token?: string; error?: string }> {
  try {
    const taskType = type === 'hcaptcha'
      ? 'HCaptchaTaskProxyless'
      : type === 'recaptcha'
        ? 'ReCaptchaV2TaskProxyless'
        : 'AntiTurnstileTaskProxyless'

    const taskPayload: Record<string, any> = {
      clientKey: apiKey,
      task: {
        type: taskType,
        websiteURL,
        websiteKey,
      },
    }

    if (isInvisible && type === 'hcaptcha') {
      taskPayload.task.isInvisible = true
    }

    const createRes = await fetch('https://api.capsolver.com/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskPayload),
    })

    const createData = await createRes.json() as any
    if (createData.errorId && createData.errorId !== 0) {
      const err = `${createData.errorCode || 'ERROR'}: ${createData.errorDescription || 'CapSolver error'}`
      return { success: false, error: err }
    }

    if (createData.status === 'ready' && createData.solution) {
      const token = createData.solution.token || createData.solution.gRecaptchaResponse || createData.solution.text
      if (token) return { success: true, token }
    }

    const taskId = createData.taskId
    if (!taskId) {
      return { success: false, error: 'CapSolver did not return a taskId.' }
    }

    // Poll for result up to 60 seconds
    const startTime = Date.now()
    const maxWaitMs = 60_000
    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, 2000))

      const pollRes = await fetch('https://api.capsolver.com/getTaskResult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: apiKey, taskId }),
      })

      const pollData = await pollRes.json() as any
      if (pollData.errorId && pollData.errorId !== 0) {
        return {
          success: false,
          error: `${pollData.errorCode || 'ERROR'}: ${pollData.errorDescription || 'Polling error'}`,
        }
      }

      if (pollData.status === 'ready' && pollData.solution) {
        const token = pollData.solution.token || pollData.solution.gRecaptchaResponse || pollData.solution.text
        if (token) return { success: true, token }
      }

      if (pollData.status === 'failed') {
        return { success: false, error: 'CapSolver failed to solve the challenge.' }
      }
    }

    return { success: false, error: 'CapSolver timed out waiting for result (60s).' }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Track recent solve attempts per page to avoid redundant calls within short window
const recentAttempts = new WeakMap<Page, { timestamp: number; success: boolean }>()

export async function solveCaptchaOnPage(page: Page): Promise<CapSolverResult> {
  if (!isCapSolverConfigured()) {
    return { success: false, error: 'CAPSOLVER_API_KEY is not configured.' }
  }

  // Check if page already has a valid solution
  if (await hasValidCaptchaSolution(page)) {
    return { success: true }
  }

  const lastAttempt = recentAttempts.get(page)
  if (lastAttempt && Date.now() - lastAttempt.timestamp < 10_000 && !lastAttempt.success) {
    return { success: false, error: 'Previous CapSolver attempt recently failed, waiting cooldown.' }
  }

  const detected = await detectCaptchaOnPage(page)
  if (!detected.detected || !detected.type || !detected.siteKey) {
    return { success: false, error: 'No solvable CAPTCHA detected on page.' }
  }

  const apiKey = getCapSolverApiKey()
  console.log(`[CapSolver] Solving ${detected.type} challenge (siteKey: ${detected.siteKey}) for ${page.url()}...`)

  const solveResult = await solveCaptchaWithCapSolver(
    apiKey,
    detected.type,
    detected.url || page.url(),
    detected.siteKey,
    detected.isInvisible,
  )

  if (!solveResult.success || !solveResult.token) {
    recentAttempts.set(page, { timestamp: Date.now(), success: false })
    console.warn(`[CapSolver] Solving failed: ${solveResult.error}`)
    return { success: false, type: detected.type, error: solveResult.error }
  }

  console.log(`[CapSolver] Challenge solved! Injecting response token...`)
  await injectCaptchaToken(page, solveResult.token, detected.type)
  recentAttempts.set(page, { timestamp: Date.now(), success: true })

  return { success: true, token: solveResult.token, type: detected.type }
}
