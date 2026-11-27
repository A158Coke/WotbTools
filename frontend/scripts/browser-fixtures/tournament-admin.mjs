import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'

const events = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1, version: 3, year: 2026 - i, region: 'CN', season: 'SUMMER', roundCount: 4,
  daysPerRound: 2, dayLabels: ['Day 1', 'Day 2'], configLocked: false,
}))
const event = events[0]
const clans = Array.from({ length: 12 }, (_, i) => 'CLAN-' + String(i + 1).padStart(2, '0'))
const rounds = Array.from({ length: 4 }, (_, i) => ({
  roundNumber: i + 1, rulesVersion: 2, complete: true, locked: i === 1,
  days: [1, 2].map(dayNumber => ({ dayNumber, points: [1, 2, 3, 4].map(rank => ({ rank, points: 5 - rank })) })),
}))
const defaults = { version: 4, active: true, sourceEventId: null, sourceLabel: '', updatedAt: null, rounds: rounds.map(({ roundNumber, days }) => ({ roundNumber, days })) }
const standings = { event, days: [], rows: [] }
const day = { eventId: 1, roundNumber: 1, dayNumber: 1, version: 1, eventVersion: 3, rulesVersion: 2, status: 'FINALIZED', expectedGroupCount: 1, groups: [], published: true, standings }
const base = '/api/admin/tournaments'
function send(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(data))
}

export function createTournamentFixture() {
  const writes = []
  const previews = []
  const unexpected = []
  const stored = { rounds: structuredClone(rounds), defaults: structuredClone(defaults) }
  function reset() {
    stored.rounds = structuredClone(rounds)
    stored.defaults = structuredClone(defaults)
  }
  async function middleware(request, response, next) {
    const path = new URL(request.url, 'http://fixture').pathname
    const method = request.method
    if (path === '/api/tournaments') return send(response, 200, events)
    if (!path.startsWith('/api/admin/')) return next()
    if (request.headers.authorization !== 'Bearer fixture-access-token') return send(response, 403, {})
    if (method === 'HEAD' && path === base) {
      response.setHeader('X-Tournament-Default-Rules', '1')
      response.setHeader('X-Tournament-Csv-Import', '1')
      return send(response, 200)
    }
    if (method === 'GET') {
      const data = new Map([
        [base, events],
        [base + '/1', { event, rounds: stored.rounds, clans }],
        [base + '/rules/default', stored.defaults],
        [base + '/1/rule-source', { eventVersion: 3, source: 'CUSTOM', defaultVersion: null, isDefaultSource: stored.defaults.sourceEventId === 1, defaultOutdated: false }],
        [base + '/1/rounds/1/days/1', day],
        [base + '/1/audit', []],
        [base + '/1/historical-import', { eventVersion: 3, imported: false, canImport: false, historical: false }],
      ])
      if (data.has(path)) return send(response, 200, data.get(path))
    } else if (method === 'POST' || method === 'PUT') {
      const incoming = new Request(new URL(request.url, 'http://fixture'), { method, headers: request.headers, body: Readable.toWeb(request), duplex: 'half' })
      if (method === 'POST' && [base + '/1/csv-import/preview', base + '/1/csv-import'].includes(path)) {
        const form = await incoming.formData()
        const file = form.get('file')
        const sha = createHash('sha256').update(await file.text()).digest('hex')
        const record = { ...Object.fromEntries(form.entries()), file: file.name }
        if (path.endsWith('/preview')) previews.push(record)
        else writes.push(record)
        return send(response, 200, { standings, eventVersion: 3, sourceName: file.name, sourceSha256: sha,
          sourceRowCount: 1, clanCount: 1, missingCellCount: 0,
          changes: { addedClans: 1, changedClans: 0, removedClans: 0, addedScores: 8, changedScores: 0, removedScores: 0, preservedClears: 0 } })
      }
      if (method === 'PUT' && path === base + '/1/rounds/1') {
        const value = await incoming.json()
        writes.push(value)
        stored.rounds[0].days = value.days
        stored.rounds[0].rulesVersion++
        return send(response, 200, { event, rounds: stored.rounds, clans })
      }
      if (method === 'PUT' && path === base + '/rules/default') {
        const value = await incoming.json()
        writes.push(value)
        stored.defaults = { ...stored.defaults, version: stored.defaults.version + 1, sourceEventId: value.eventId, rounds: stored.rounds.map(({ roundNumber, days }) => ({ roundNumber, days })) }
        return send(response, 200, stored.defaults)
      }
      if (method === 'POST' && path === base + '/1/clear-points') {
        writes.push(await incoming.json())
        return send(response, 200, standings)
      }
    }
    unexpected.push(method + ' ' + path)
    return send(response, 404, {})
  }
  return { middleware, writes, previews, unexpected, reset }
}
