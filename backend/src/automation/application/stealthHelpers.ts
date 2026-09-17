/**
 * Stealth helpers for human-like browser interaction.
 *
 * Provides Bézier-curve mouse paths, Gaussian-distributed random delays,
 * natural scroll patterns, and a page "warm-up" routine so that the
 * automation looks indistinguishable from a real user to ATS fraud
 * detection systems.
 */

import type { Page } from 'playwright-core'

// ---------------------------------------------------------------------------
// Random helpers
// ---------------------------------------------------------------------------

/** Uniform random integer in [min, max]. */
export function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/** Gaussian-distributed random number (Box–Muller). */
function gaussianRandom(mean: number, stdDev: number) {
  let u1 = 0
  let u2 = 0
  while (u1 === 0) u1 = Math.random()
  while (u2 === 0) u2 = Math.random()
  return mean + stdDev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/** Human-like delay (Gaussian-clipped between min and max). */
export function humanDelay(min: number, max: number) {
  const mean = (min + max) / 2
  const stdDev = (max - min) / 4
  return Math.max(min, Math.min(max, Math.round(gaussianRandom(mean, stdDev))))
}

/** Sleep for a human-like duration. */
export async function humanPause(page: Page, min: number, max: number) {
  await page.waitForTimeout(humanDelay(min, max))
}

// ---------------------------------------------------------------------------
// Bézier curve mouse movement
// ---------------------------------------------------------------------------

type Point = { x: number; y: number }

function cubicBezier(t: number, p0: number, p1: number, p2: number, p3: number) {
  const u = 1 - t
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
}

function generateBezierPath(start: Point, end: Point, steps: number): Point[] {
  // Two random control points with slight overshoot/undershoot
  const dx = end.x - start.x
  const dy = end.y - start.y
  const cp1: Point = {
    x: start.x + dx * (0.2 + Math.random() * 0.3) + (Math.random() - 0.5) * Math.abs(dy) * 0.3,
    y: start.y + dy * (0.2 + Math.random() * 0.3) + (Math.random() - 0.5) * Math.abs(dx) * 0.3,
  }
  const cp2: Point = {
    x: start.x + dx * (0.5 + Math.random() * 0.3) + (Math.random() - 0.5) * Math.abs(dy) * 0.2,
    y: start.y + dy * (0.5 + Math.random() * 0.3) + (Math.random() - 0.5) * Math.abs(dx) * 0.2,
  }
  const points: Point[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    points.push({
      x: cubicBezier(t, start.x, cp1.x, cp2.x, end.x),
      y: cubicBezier(t, start.y, cp1.y, cp2.y, end.y),
    })
  }
  return points
}

/**
 * Move the mouse along a Bézier curve from the current (or given) position
 * to the target, with variable per-step timing.
 */
export async function bezierMouseMove(
  page: Page,
  targetX: number,
  targetY: number,
  options?: { fromX?: number; fromY?: number; steps?: number },
) {
  const vp = page.viewportSize() ?? { width: 1280, height: 800 }
  const clampedTargetX = Math.max(15, Math.min(vp.width - 15, targetX))
  const clampedTargetY = Math.max(15, Math.min(vp.height - 15, targetY))

  const rawFromX = options?.fromX ?? (clampedTargetX - randomInt(60, 180))
  const rawFromY = options?.fromY ?? (clampedTargetY - randomInt(40, 140))
  const fromX = Math.max(15, Math.min(vp.width - 15, rawFromX))
  const fromY = Math.max(15, Math.min(vp.height - 15, rawFromY))

  const steps = options?.steps ?? randomInt(18, 35)
  const path = generateBezierPath({ x: fromX, y: fromY }, { x: clampedTargetX, y: clampedTargetY }, steps)

  for (const point of path) {
    const safeX = Math.max(5, Math.min(vp.width - 5, Math.round(point.x)))
    const safeY = Math.max(5, Math.min(vp.height - 5, Math.round(point.y)))
    await page.mouse.move(safeX, safeY)
    await page.waitForTimeout(randomInt(2, 12))
  }
}

// ---------------------------------------------------------------------------
// Natural scroll
// ---------------------------------------------------------------------------

/**
 * Scroll the page like a human — gradually, with variable speed, and slight
 * deceleration near the end.
 */
export async function naturalScroll(
  page: Page,
  totalDelta: number,
  options?: { x?: number; y?: number; scrollSteps?: number },
) {
  const x = options?.x ?? randomInt(400, 800)
  const y = options?.y ?? randomInt(300, 500)
  const scrollSteps = options?.scrollSteps ?? randomInt(4, 9)
  let remaining = totalDelta
  for (let i = 0; i < scrollSteps; i++) {
    // Gradually decrease step size (deceleration)
    const fraction = (1 - (i / scrollSteps) * 0.5) / scrollSteps
    const step = Math.round(remaining * fraction * (0.8 + Math.random() * 0.4))
    const delta = Math.min(Math.abs(step), Math.abs(remaining)) * Math.sign(totalDelta)
    await page.mouse.wheel(0, delta)
    remaining -= delta
    await page.waitForTimeout(randomInt(40, 120))
  }
  if (Math.abs(remaining) > 5) {
    await page.mouse.wheel(0, remaining)
    await page.waitForTimeout(randomInt(30, 80))
  }
}

// ---------------------------------------------------------------------------
// Page warm-up — simulate a user landing and looking around
// ---------------------------------------------------------------------------

/**
 * Simulate a user who just landed on the page: move the mouse a bit, scroll
 * down to read, scroll back, pause.  This builds the behavioural "fingerprint"
 * that ATS fraud systems expect from a real visitor.
 *
 * The routine now includes:
 *  - An initial "landing dwell" (the user reads the page header)
 *  - 3–5 reading stops at different scroll positions
 *  - Random idle jitter between actions (no two sessions look the same)
 *  - Small mouse drift while "reading" (humans never keep the cursor still)
 */
export async function warmUpPage(page: Page) {
  const vp = page.viewportSize() ?? { width: 1280, height: 800 }

  // Phase 1 — Landing dwell: user waits for page to render and reads the title
  await humanPause(page, 1500, 3500)

  // Phase 2 — First mouse movement: cursor lands somewhere on the page
  const landX = randomInt(Math.round(vp.width * 0.2), Math.round(vp.width * 0.6))
  const landY = randomInt(Math.round(vp.height * 0.15), Math.round(vp.height * 0.4))
  await page.mouse.move(landX, landY, { steps: randomInt(10, 20) })
  await humanPause(page, 800, 1800)

  // Phase 3 — Reading stops: scroll down in 3–5 increments, pausing at each
  const readingStops = randomInt(3, 5)
  const scrollHeight = await page.evaluate('document.body.scrollHeight') as number
  const maxScroll = Math.max(scrollHeight - vp.height, 0)

  for (let i = 0; i < readingStops && maxScroll > 50; i++) {
    const scrollAmount = randomInt(
      Math.round(maxScroll / (readingStops + 2)),
      Math.round(maxScroll / readingStops),
    )
    await naturalScroll(page, scrollAmount, { scrollSteps: randomInt(3, 7) })

    // Simulate "reading" — small mouse drift + dwell
    const driftX = randomInt(Math.round(vp.width * 0.15), Math.round(vp.width * 0.8))
    const driftY = randomInt(Math.round(vp.height * 0.2), Math.round(vp.height * 0.7))
    await bezierMouseMove(page, driftX, driftY, { steps: randomInt(12, 25) })
    await humanPause(page, 1200, 3500)

    // Occasional micro-drift while reading (humans don't hold still)
    if (Math.random() > 0.4) {
      await page.mouse.move(
        driftX + randomInt(-30, 30),
        driftY + randomInt(-20, 20),
        { steps: randomInt(4, 8) },
      )
      await humanPause(page, 400, 1000)
    }
  }

  // Phase 4 — Scroll back up partially (user re-reads something)
  if (maxScroll > 100) {
    await naturalScroll(page, -randomInt(100, Math.round(maxScroll * 0.4)))
    await humanPause(page, 800, 1800)
  }

  // Phase 5 — Final position: move cursor near the first form field area
  await bezierMouseMove(
    page,
    randomInt(Math.round(vp.width * 0.1), Math.round(vp.width * 0.5)),
    randomInt(Math.round(vp.height * 0.2), Math.round(vp.height * 0.5)),
    { steps: randomInt(15, 30) },
  )
  await humanPause(page, 600, 1400)
}

/**
 * Pre-submit warm-up: simulate the user reviewing the form right before
 * clicking the submit button.  Scroll through the form, hover over a couple
 * of fields, pause to "read".
 */
export async function preSubmitReview(page: Page) {
  const vp = page.viewportSize() ?? { width: 1280, height: 800 }

  // Scroll to the top of the form
  await page.evaluate('window.scrollTo({ top: 0, behavior: "smooth" })')
  await humanPause(page, 800, 1600)

  // Gradually scroll down through the entire form in several steps
  const scrollHeight = await page.evaluate('document.body.scrollHeight') as number
  const scrollableDistance = Math.max(scrollHeight - vp.height, 0)
  if (scrollableDistance > 100) {
    const reviewSteps = randomInt(3, 6)
    const perStep = Math.round(scrollableDistance / reviewSteps)
    for (let i = 0; i < reviewSteps; i++) {
      const scrollDown = Math.min(perStep + randomInt(-40, 40), scrollableDistance)
      await naturalScroll(page, scrollDown, { scrollSteps: randomInt(4, 8) })

      // Hover near a form element as if checking the answer
      await bezierMouseMove(
        page,
        randomInt(Math.round(vp.width * 0.15), Math.round(vp.width * 0.65)),
        randomInt(Math.round(vp.height * 0.25), Math.round(vp.height * 0.65)),
        { steps: randomInt(12, 22) },
      )
      await humanPause(page, 800, 2200)
    }
  }

  // Final mouse position near the bottom of the form
  await bezierMouseMove(
    page,
    randomInt(Math.round(vp.width * 0.2), Math.round(vp.width * 0.6)),
    randomInt(Math.round(vp.height * 0.6), Math.round(vp.height * 0.8)),
    { steps: randomInt(15, 28) },
  )
  await humanPause(page, 500, 1200)
}

// ---------------------------------------------------------------------------
// Per-field interaction wrapper
// ---------------------------------------------------------------------------

/**
 * Simulate a human approaching a form field: scroll into view, move the mouse
 * to the field with a natural Bézier path, hover briefly, then pause.
 * Call this before filling each field.
 */
export async function approachField(page: Page, fieldLocator: import('playwright-core').Locator) {
  // Scroll the field into view with a natural scroll animation
  await fieldLocator.scrollIntoViewIfNeeded().catch(() => undefined)
  await humanPause(page, 300, 700)

  // Get the field's bounding box and move the cursor to it
  const box = await fieldLocator.boundingBox().catch(() => null)
  if (box) {
    const vp = page.viewportSize() ?? { width: 1280, height: 800 }
    const targetX = Math.max(15, Math.min(vp.width - 15, box.x + box.width * (0.3 + Math.random() * 0.4)))
    const targetY = Math.max(15, Math.min(vp.height - 15, box.y + box.height * (0.3 + Math.random() * 0.4)))

    await bezierMouseMove(page, targetX, targetY, { steps: randomInt(15, 30) })
    await humanPause(page, 200, 600)
  }
}

/**
 * Wait for Cloudflare Turnstile, reCAPTCHA, or hCaptcha tokens to resolve
 * while generating subtle mouse interaction events to satisfy anti-bot telemetry.
 */
export async function waitForAntiBotReady(page: Page, maxWaitMs = 10_000): Promise<boolean> {
  const start = Date.now()
  const vp = page.viewportSize() ?? { width: 1280, height: 800 }

  while (Date.now() - start < maxWaitMs) {
    const status = await page.evaluate(() => {
      const cfInput = document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement | null
      const gInput = document.querySelector('[name="g-recaptcha-response"], #g-recaptcha-response') as HTMLInputElement | null
      const hInput = document.querySelector('[name="h-captcha-response"]') as HTMLInputElement | null

      const cfHasVal = Boolean(cfInput && cfInput.value && cfInput.value.trim().length > 10)
      const gHasVal = Boolean(gInput && gInput.value && gInput.value.trim().length > 10)
      const hHasVal = Boolean(hInput && hInput.value && hInput.value.trim().length > 10)

      const hasTurnstile = Boolean(document.querySelector('.cf-turnstile, iframe[src*="challenges.cloudflare.com"], [data-turnstile-sitekey]'))
      const hasRecaptcha = Boolean(document.querySelector('iframe[src*="recaptcha"]'))
      const hasHcaptcha = Boolean(document.querySelector('iframe[src*="hcaptcha"], .h-captcha'))

      if (hasTurnstile && !cfHasVal) return { ready: false, pending: 'turnstile' }
      if (hasHcaptcha && !hHasVal && !cfHasVal) return { ready: false, pending: 'hcaptcha' }
      if (hasRecaptcha && !gHasVal && !cfHasVal && !hHasVal) return { ready: false, pending: 'recaptcha' }

      return { ready: true }
    }).catch(() => ({ ready: true }))

    if (status.ready) {
      return true
    }

    // Move cursor with slight human jitter while waiting for Turnstile/Captcha background worker
    const targetX = randomInt(Math.round(vp.width * 0.2), Math.round(vp.width * 0.8))
    const targetY = randomInt(Math.round(vp.height * 0.3), Math.round(vp.height * 0.7))
    await bezierMouseMove(page, targetX, targetY, { steps: randomInt(8, 16) }).catch(() => undefined)
    await page.waitForTimeout(randomInt(300, 600))
  }

  return false
}

