const at = '2026-01-01T00:00:00Z'
const options = Array.from({ length: 12 }, (_, index) => ({
  tankId: 1000 + index, tankName: `Fixture Tank ${index + 1}`, nation: 'UK', type: 'MEDIUM_TANK', tier: 10,
}))

const proof = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aB0AAAAASUVORK5CYII='
const page = items => ({ items, page: 1, size: 50, totalItems: items.length, totalPages: items.length ? 1 : 0 })
const listRow = (id, mark3) => ({
  id, status: 'PENDING', vehicleId: 385, vehicleName: 'Progetto 65', nicknameSnapshot: `Pilot ${id}`,
  wotbServer: 'EU', wotbAccountId: 2000 + id, approvedAverageDamage: null, approvedBattleCount: null,
  submittedAt: at, approvedAt: null, deleteReason: null, rejectReason: null,
  replayParseOk: true, replayGameIdMatch: true, replayVehicleMatch: true, replayDistinctBattles: true,
  ...(mark3 ? { claimedAverageDamage: 4100, claimedBattleCount: 100, claimedWinRate: 64, approvedWinRate: null } : {}),
})

export function createHofAdminFixture() {
  const requests = []
  const queues = new Map()
  const countFailures = new Map()
  const countBarriers = new Map()
  function setPendingCounts(hundred, mark3) {
    for (const [domain, count, first] of [['hundred', hundred, 11], ['mark3', mark3, 31]]) {
      const items = Array.from({ length: count }, (_, i) => listRow(first + i, domain === 'mark3'))
      for (const [index, status] of ['CURRENT', 'REJECTED'].entries()) {
        items.push({ ...listRow(first + count + index, domain === 'mark3'), status })
      }
      queues.set(domain, items)
    }
  }
  function setCountFailure(domain, status) { countFailures.set(domain, status) }
  function holdCount(domain) {
    const { promise, resolve } = Promise.withResolvers()
    countBarriers.set(domain, promise)
    return () => { if (countBarriers.get(domain) === promise) countBarriers.delete(domain); resolve() }
  }
  let records
  function reset() {
    requests.length = 0
    records = [71, 72, 73].map(id => ({
      id, accountId: id + 100, nickname: 'Pilot ' + id, tankId: 1011, tankName: 'Fixture Tank 12',
      battleType: 'RANDOM', damageDealt: 3500, mapName: 'erlenberg', version: '11.0', battleTime: at,
      createdAt: at, replayHash: 'a'.repeat(64), replayFileName: 'battle.wotbreplay', replaySize: 32,
      replayUploadedBy: 'fixture', replayAvailable: true,
    }))
    setPendingCounts(7, 5)
    countFailures.clear()
    countBarriers.clear()
  }
  reset()
  function middleware(request, response, next) {
    const { pathname, searchParams } = new URL(request.url, 'http://fixture')
    if (!pathname.startsWith('/api/admin/')) return next()
    const method = request.method
    requests.push({ method, pathname, query: Object.fromEntries(searchParams) })
    function json(value, status = 200) {
      response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value))
    }
    if (method === 'GET' && pathname === '/api/admin/hof/vehicle-options') return json(options)
    if (method === 'GET' && pathname === '/api/admin/hof') {
      const tankId = searchParams.get('tankId')
      return json(page(records.filter(row => !tankId || String(row.tankId) === tankId)))
    }
    if (method === 'GET' && pathname === '/api/admin/hof/audit') return json(page([]))
    if (method === 'GET' && pathname === '/api/admin/hof/71/replay') {
      return response.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end('fixture replay')
    }
    if (method === 'DELETE' && pathname === '/api/admin/hof/71') {
      records = records.filter(row => row.id !== 71)
      return response.writeHead(204).end()
    }
    if (method === 'POST' && pathname === '/api/admin/hof/records/bulk-delete') {
      let body = ''
      request.on('data', chunk => { body += chunk })
      request.on('end', () => {
        if (JSON.stringify(JSON.parse(body).ids) !== '[72,73]') return json({ error: 'unexpected selection' }, 422)
        records = records.filter(row => row.id !== 72)
        json({ requested: 2, deleted: 1, failed: 1, results: [
          { id: 72, deleted: true }, { id: 73, deleted: false, errorCode: 'RECORD_NOT_FOUND' },
        ] })
      })
      return
    }

    const route = /^\/api\/admin\/hof\/(hundred|mark3)\/submissions(?:\/(\d+)(?:\/(replays|approve))?)?$/.exec(pathname)
    if (!route) return json({ error: pathname }, 404)
    const [, domain, id, action] = route
    const rows = queues.get(domain)
    if (!id && method === 'GET') {
      const status = searchParams.get('status')
      const filtered = rows.filter(item => !status || item.status === status)
      if (searchParams.get('size') !== '1' || status !== 'PENDING') return json(page(filtered))
      const size = 1
      const payload = { items: structuredClone(filtered.slice(0, size)), page: 1, size, totalItems: filtered.length, totalPages: filtered.length }
      const failure = countFailures.get(domain)
      void Promise.resolve(countBarriers.get(domain)).then(() => {
        if (response.destroyed) return
        if (failure === 'invalid') return json({ ...payload, totalItems: -1 })
        if (failure) return json({ error: 'count unavailable' }, failure)
        json(payload)
      })
      return
    }
    const row = rows.find(item => String(item.id) === id)
    if (!row) return json({ error: id }, 404)
    const claimed = { claimedAverageDamage: 4100, claimedBattleCount: 100 }
    if (!action && method === 'GET') {
      return json({ ...row, ...claimed, approvedBy: null, rejectedAt: null, rejectedBy: null, rejectReasonText: null,
        cancelledAt: null, deletedAt: null, deletedBy: null, deleteReasonText: null,
        ...(domain === 'mark3' ? { proofScreenshots: [proof, proof] } : { proofScreenshot: proof }) })
    }
    if (action === 'replays' && method === 'GET') {
      return json(Array.from({ length: row.id % 10 === 3 ? 4 : 5 }, (_, index) => ({
        id: 500 + index, slot: index + 1, originalFilename: `game-${index}.wotbreplay`, fileSize: 32,
        arenaId: String(index), sha256: 'a'.repeat(64), createdAt: at,
      })))
    }
    if (action === 'approve' && method === 'POST' && row.status === 'PENDING') {
      row.status = 'CURRENT'
      return json({ id: row.id, vehicleId: row.vehicleId, vehicleName: row.vehicleName, status: row.status,
        ...claimed, approvedBattleCount: claimed.claimedBattleCount, approvedAverageDamage: claimed.claimedAverageDamage,
        submittedAt: at, approvedAt: at, rejectReason: null, rejectReasonText: null,
        ...(domain === 'mark3' ? { claimedWinRate: 64, approvedWinRate: 64 } : {}) })
    }
    return json({ error: `${method} ${pathname}` }, 405)
  }
  return { middleware, requests, reset, setPendingCounts, setCountFailure, holdCount }
}
