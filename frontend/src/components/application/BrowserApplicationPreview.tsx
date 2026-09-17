import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Bot } from 'lucide-react'
import type { AutomationRun } from './types'

function isPreviewInteractive(run: AutomationRun) {
  const assisted = run.assistedSession?.status
  if (assisted) return ['WAITING_FOR_USER', 'USER_REVIEWING', 'MANUAL_REQUIRED', 'SUBMITTING', 'VERIFYING'].includes(assisted)
  return run.status.startsWith('PAUSED_') || run.status === 'READY_FOR_REVIEW'
}

export function BrowserApplicationPreview({ run }: { run: AutomationRun | null }) {
  const imageRef = useRef<HTMLImageElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const lastMove = useRef(0)
  const [frameUrl, setFrameUrl] = useState('')
  const interactive = Boolean(run && isPreviewInteractive(run))

  useEffect(() => {
    if (interactive) viewportRef.current?.focus()
  }, [interactive])

  useEffect(() => {
    if (!run?.id) {
      setFrameUrl('')
      return
    }
    let cancelled = false
    let currentUrl = ''
    const loadFrame = async () => {
      try {
        const response = await fetch(`/api/automation/live-frames/${run.id}`, { credentials: 'include', cache: 'no-store' })
        if (cancelled || !response.ok) return
        const blob = await response.blob()
        if (blob.size < 200) return
        const nextUrl = URL.createObjectURL(blob)
        if (cancelled) { URL.revokeObjectURL(nextUrl); return }
        if (currentUrl) URL.revokeObjectURL(currentUrl)
        currentUrl = nextUrl
        setFrameUrl(nextUrl)
      } catch { /* keep the last good frame */ }
    }
    void loadFrame()
    const timer = window.setInterval(() => void loadFrame(), 280)
    return () => { cancelled = true; window.clearInterval(timer); if (currentUrl) URL.revokeObjectURL(currentUrl) }
  }, [run?.id])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const handleWheel = (event: globalThis.WheelEvent) => {
      if (!interactive) return
      if (event.cancelable) event.preventDefault()
      const image = imageRef.current
      if (!image) return
      const box = image.getBoundingClientRect()
      if (!box.width || !box.height) return
      const point = {
        x: Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1),
        y: Math.min(Math.max((event.clientY - box.top) / box.height, 0), 1)
      }
      sendInput({ type: 'scroll', ...point, deltaX: event.deltaX, deltaY: event.deltaY })
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [interactive, run?.id])

  const pointFromEvent = (event: MouseEvent) => {
    const image = imageRef.current
    if (!image) return null
    const box = image.getBoundingClientRect()
    if (!box.width || !box.height) return null
    return { x: Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1), y: Math.min(Math.max((event.clientY - box.top) / box.height, 0), 1) }
  }

  const sendInput = (body: Record<string, unknown>) => {
    if (!run || !interactive) return
    void fetch(`/api/automation/live-input/${run.id}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  }

  return (
    <div
      className="live-browser-viewport"
      ref={viewportRef}
      tabIndex={interactive ? 0 : -1}
      onContextMenu={(event) => event.preventDefault()}
      onClick={() => { if (interactive) viewportRef.current?.focus() }}
      onKeyDown={(event) => {
        if (!interactive) return
        event.preventDefault()
        const text = event.key.length === 1 && !event.metaKey && !event.ctrlKey ? event.key : undefined
        sendInput({ type: 'key', key: event.key, text })
      }}
    >
      {frameUrl ? (
        <img
          ref={imageRef}
          src={frameUrl}
          alt="Remote headless application preview"
          draggable={false}
          onMouseMove={(event) => {
            if (!interactive) return
            const now = Date.now()
            if (now - lastMove.current < 40) return
            lastMove.current = now
            const point = pointFromEvent(event)
            if (point) sendInput({ type: 'move', ...point })
          }}
          onClick={(event) => { const point = pointFromEvent(event); if (point) sendInput({ type: 'click', ...point, button: event.button === 2 ? 'right' : 'left' }) }}
          onDoubleClick={(event) => { const point = pointFromEvent(event); if (point) sendInput({ type: 'dblclick', ...point }) }}
        />
      ) : null}
      {!frameUrl && (
        <div className="live-browser-empty">
          <Bot />
          <p>{run ? 'Connecting to the windowless browser preview… This is not a native form.' : 'The remote application preview will appear here. Chrome stays hidden.'}</p>
        </div>
      )}
    </div>
  )
}
