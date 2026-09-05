import type { Page } from 'playwright-core'

export const automationViewport = { width: 1280, height: 800 }

export const emptyJpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wAAAQIBAQEBAQIBAQECAgICAgMCAgICAwMDAwMDAwQEBQQEBQUEBAUFBQUFBQUGBgYGBgYHBwcHBwgICAgICAgJCQkJCQn/wAARCAABAAEDAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA//2Q==',
  'base64',
)

export type PreviewInput =
  | { type: 'click'; x: number; y: number; button?: 'left' | 'right' }
  | { type: 'dblclick'; x: number; y: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'scroll'; x: number; y: number; deltaX: number; deltaY: number }
  | { type: 'key'; key: string; text?: string }

type PreviewSession = {
  page: Page
  frame: Buffer | null
  deviceWidth: number
  deviceHeight: number
  timer: ReturnType<typeof setInterval> | null
}

const sessions = new Map<string, PreviewSession>()

export function getRunPreview(runId: string) {
  const session = sessions.get(runId)
  if (!session) return null
  return { frame: session.frame, deviceWidth: session.deviceWidth, deviceHeight: session.deviceHeight }
}

async function captureFrame(session: PreviewSession) {
  if (session.page.isClosed()) return
  session.frame = await session.page.screenshot({ type: 'jpeg', quality: 50, animations: 'disabled' })
  const size = session.page.viewportSize()
  if (size) {
    session.deviceWidth = size.width
    session.deviceHeight = size.height
  }
}

export async function startRunPreview(runId: string, page: Page) {
  await stopRunPreview(runId)
  await page.setViewportSize(automationViewport).catch(() => undefined)
  const session: PreviewSession = {
    page,
    frame: null,
    deviceWidth: automationViewport.width,
    deviceHeight: automationViewport.height,
    timer: null,
  }
  sessions.set(runId, session)
  await captureFrame(session)
  session.timer = setInterval(() => { void captureFrame(session).catch(() => undefined) }, 250)
}

export async function stopRunPreview(runId: string) {
  const session = sessions.get(runId)
  if (!session) return
  sessions.delete(runId)
  if (session.timer) clearInterval(session.timer)
}

function toPagePoint(session: PreviewSession, x: number, y: number) {
  return {
    x: Math.min(Math.max(x * session.deviceWidth, 0), session.deviceWidth),
    y: Math.min(Math.max(y * session.deviceHeight, 0), session.deviceHeight),
  }
}

export async function dispatchPreviewInput(runId: string, input: PreviewInput) {
  const session = sessions.get(runId)
  if (!session) throw new Error('The live application view is not available.')
  const { page } = session
  if (input.type === 'move') {
    const point = toPagePoint(session, input.x, input.y)
    await page.mouse.move(point.x, point.y)
    return
  }
  if (input.type === 'click') {
    const point = toPagePoint(session, input.x, input.y)
    await page.mouse.click(point.x, point.y, { button: input.button || 'left' })
    return
  }
  if (input.type === 'dblclick') {
    const point = toPagePoint(session, input.x, input.y)
    await page.mouse.dblclick(point.x, point.y)
    return
  }
  if (input.type === 'scroll') {
    const point = toPagePoint(session, input.x, input.y)
    await page.mouse.move(point.x, point.y)
    await page.mouse.wheel(input.deltaX, input.deltaY)
    return
  }
  if (input.text) {
    await page.keyboard.insertText(input.text)
    return
  }
  const key = input.key === ' ' ? 'Space' : input.key
  await page.keyboard.press(key)
}
