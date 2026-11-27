// 管理员目录及反馈的本地 HTTP fixture。每个场景独立持有读写记录。
export function createAdminDirectory() {
  const requests = []
  const users = Array.from({ length: 27 }, (_, index) => {
    const id = String(index + 1)
    return {
      keycloakUserId: id, keycloakUsername: 'fixture-' + id, keycloakEmail: null,
      keycloakEnabled: true, profileId: null, displayName: null, wotbAccountId: null,
      wotbNickname: null, wotbServer: null, profileCreatedAt: null, hasLocalProfile: false,
      keycloakUserMissing: false,
    }
  })
  const feedback = new Map(['ai-review-feedback', 'site-feedback'].map(domain => [domain,
    Array.from({ length: 26 }, (_, index) => ({
      id: String(index + 1), reasonCodes: ['OTHER'], status: 'PENDING',
      createdAt: '2026-11-10T00:00:00Z', feedbackText: 'Fixture feedback ' + (index + 1),
      ...(domain === 'site-feedback' ? { pageView: 'hof' } : { model: null }),
    })),
  ]))
  let rejectFirstDelete = true
  let rejectFirstStatus = true
  async function middleware(req, res, next) {
    const url = new URL(req.url, 'http://localhost')
    if (!url.pathname.startsWith('/api/admin/')) return next()
    const [, , , domain, id, action] = url.pathname.split('/')
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null
    requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body })
    function send(value, status = 200) {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(value == null ? undefined : JSON.stringify(value))
    }
    function list(rows) {
      const size = Number(url.searchParams.get('size') ?? 25), page = Number(url.searchParams.get('page') ?? 0)
      return send({ items: rows.slice(page * size, (page + 1) * size), page, size, totalItems: rows.length, totalPages: Math.ceil(rows.length / size) })
    }
    if (domain === 'users' && !id && req.method === 'GET') return list(users.filter(u => u.keycloakUsername.includes(url.searchParams.get('query') || '')))
    if (domain === 'users' && id && req.method === 'GET') return send({ keycloakUserId: id, keycloak: null, profile: null, warnings: [] })
    if (domain === 'users' && !id && req.method === 'DELETE' && url.searchParams.get('confirm') === 'true') {
      const results = body.map((userId, index) => {
        const target = users.findIndex(row => row.keycloakUserId === userId)
        const deleted = target >= 0 && !(rejectFirstDelete && index === 0)
        if (deleted) users.splice(target, 1)
        return { userId, deleted, errorCode: deleted ? null : 'DELETE_FAILED' }
      })
      rejectFirstDelete = false
      const deleted = results.filter(r => r.deleted).length
      return send({ requested: results.length, deleted, failed: results.length - deleted, results })
    }
    const rows = feedback.get(domain)
    if (rows && !id && req.method === 'GET') return list(rows)
    const row = rows?.find(item => item.id === id)
    if (row && !action && req.method === 'GET') return send(domain === 'site-feedback' ? row : { ...row, aiResponseText: 'fixture reply' })
    if (row && action === 'status' && req.method === 'PATCH') {
      if (rejectFirstStatus) { rejectFirstStatus = false; return send({}, 409) }
      row.status = body.status
      return send(null, 204)
    }
    if (row && !action && req.method === 'DELETE') {
      rows.splice(rows.indexOf(row), 1)
      return send(null, 204)
    }
    return send({ error: 'Unmatched admin fixture request' }, 404)
  }
  return { middleware, requests }
}
