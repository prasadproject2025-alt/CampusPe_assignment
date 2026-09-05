const GREENHOUSE_EMBED_HOSTS = new Set(['boards.greenhouse.io', 'job-boards.greenhouse.io'])

export function isAllowedEmbedUrl(value: string) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return false
    if (!GREENHOUSE_EMBED_HOSTS.has(url.hostname.toLowerCase())) return false
    return url.pathname === '/embed/job_app'
  } catch {
    return false
  }
}

export function greenhouseEmbedUrl(board: string, jobId: string) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(board) || !/^\d{1,20}$/.test(jobId)) return null
  return `https://boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(board)}&token=${encodeURIComponent(jobId)}`
}
