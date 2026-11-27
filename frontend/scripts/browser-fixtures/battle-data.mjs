const stat = (mapKey, arenaBonusType, side, wins, draws, losses) => ({ mapKey, arenaBonusType, side, battles: wins + draws + losses, wins, draws, losses })
const summary = {
  asOf: '2026-11-10T00:00:00Z', totalBattles: 128, last24Hours: 128, last7Days: 128, last30Days: 128, windowBattles: 128,
  latestReceivedAt: '2026-11-10T00:00:00Z', distinctMaps: 1, distinctClientVersions: 1,
  modes: [{ key: 0, count: 128 }], winnerTeams: [{ key: 1, count: 70 }], schemaVersions: [{ key: 1, count: 128 }], daily: [],
  maps: [{ key: 'erlenberg', count: 128, latestReceivedAt: '2026-11-10T00:00:00Z' }], clientVersions: [],
  spawnStats: [stat('erlenberg', null, 'NORTH', 70, 5, 53), stat('erlenberg', null, 'SOUTH', 53, 5, 70)],
}
const battle = { id: '1', arenaId: '18446744073709551615', schemaVersion: 1, arenaBonusType: 1, mapId: 1, mapKey: 'erlenberg', clientVersion: '11.18', winnerTeam: 1, team1Spawn: 'NORTH', team2Spawn: 'SOUTH', receivedAt: '2026-11-10T00:00:00Z' }
const vehicles = Array.from({ length: 14 }, (_, i) => ({ team: i < 7 ? 1 : 2, spawn: i < 7 ? 'NORTH' : 'SOUTH', slot: i % 7, vehicleId: 10 + i }))

export function createBattleDataFixture() {
  const listQueries = []
  function middleware(request, response, next) {
    const url = new URL(request.url, 'http://localhost')
    if (!url.pathname.startsWith('/api/admin/battle-data/')) return next()
    response.setHeader('Content-Type', 'application/json')
    if (request.method === 'GET') {
      if (url.pathname === '/api/admin/battle-data/summary') return response.end(JSON.stringify(summary))
      if (url.pathname === '/api/admin/battle-data/battles') {
        listQueries.push(Object.fromEntries(url.searchParams))
        return response.end(JSON.stringify({ items: [battle], nextCursor: null }))
      }
      if (url.pathname === '/api/admin/battle-data/battles/' + battle.id) return response.end(JSON.stringify({ battle, vehicles }))
    }
    response.statusCode = 404
    response.end(JSON.stringify({ error: 'Unmatched battle data fixture request' }))
  }
  return { listQueries, middleware }
}
