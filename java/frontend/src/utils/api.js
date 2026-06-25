export async function healthCheck() {
  const r = await fetch('/api/health')
  if (!r.ok) throw new Error('Health check failed: HTTP ' + r.status)
  return r.json()
}

export async function preview(body) {
  const r = await fetch('/api/preview', { method: 'POST', body })
  if (!r.ok) throw new Error('解析失败: HTTP ' + r.status)
  return r.json()
}

export async function downloadBlob(mode, body) {
  const r = await fetch(`/api/export?mode=${encodeURIComponent(mode)}`, { method: 'POST', body })
  if (!r.ok) throw new Error('导出失败: HTTP ' + r.status)
  const blob = await r.blob()
  const cd = r.headers.get('Content-Disposition') || ''
  return { blob, disposition: cd }
}

export async function shutdown() {
  await fetch('/api/shutdown', { method: 'POST' })
}
