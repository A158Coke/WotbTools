import { Readable } from 'node:stream'
const servers = ['CN', 'ASIA', 'NA', 'EU', 'LESTA']
const coverId = '493199ec-c421-456b-a865-dcd69ef4c62a'
export function createBroadcastFixture({ preview = false, rich = false } = {}) {
  let db
  function reset() {
    db = { seasons: [{ id: 10, server: 'CN', year: 2026, nameZh: '夏季联赛——国际赛事', nameEn: 'Summer league — international tournament', nameRu: null, startDate: '2026-08-16', createdAt: '2026-07-01T00:00:00Z', version: 0, rootCount: 1, replayCount: 1 }],
      categories: [{ id: 20, seasonId: 10, type: 'POINTS' }],
      nodes: [{ id: 30, categoryId: 20, roundNumber: 1, format: null, replays: [{ id: 40, nodeId: 30, title: 'Final day — a long broadcast title for narrow screens', url: 'https://example.org/watch', matchDate: '2026-08-16', dayNumber: 7, groupNumber: 7, bracket: null, teams: ['Followed team', 'Other international team'], perspective: 'POV', coverId }] }],
      replayStarts: { 40: '2026-08-16T11:00:00Z' }, nextId: 100, failNext: false }
    if (preview || rich) {
      const original = structuredClone(db.nodes[0])
      if (preview) { db.seasons[0].nameZh = '秋季联赛'; db.seasons[0].nameEn = 'Autumn Championship' }
      db.categories.push({ id: 21, seasonId: 10, type: 'QUARTER_FINALS' }, { id: 22, seasonId: 10, type: 'SEMI_FINALS' })
      db.nodes.push({ id: 31, categoryId: 20, roundNumber: 2, format: null, replays: [] },
        { id: 32, categoryId: 20, roundNumber: 3, format: null, replays: [] },
        { id: 33, categoryId: 21, roundNumber: null, format: 'KNOCKOUT', replays: [] },
        { id: 34, categoryId: 22, roundNumber: null, format: null, replays: [] })
      const titles = ['积分赛 · 第一天 A 组', '积分赛 · 第二轮焦点战', '积分赛 · 第三轮收官战', '八强赛 · 上半区淘汰赛', '四强赛 · 决胜之夜']
      db.nodes.forEach((node, index) => {
        node.replays = [0, 1].map(offset => ({ id: 40 + index * 2 + offset, nodeId: node.id,
          title: titles[index] + (offset ? ' · 赛后复盘' : ' · 完整回放'), url: 'https://example.org/local-preview',
          matchDate: `2026-10-${String(12 + index).padStart(2, '0')}`, dayNumber: index + 1,
          groupNumber: index < 3 ? offset + 1 : null, bracket: index === 3 ? 'WINNERS' : null,
          teams: offset ? ['NOVA', 'RAID'] : ['TEAM FLASH', 'NAVI'], perspective: offset ? 'OBSERVER' : 'POV', coverId: null }))
        node.replays.forEach(replay => { db.replayStarts[replay.id] = `${replay.matchDate}T11:00:00Z` })
      })
      if (!preview) { db.nodes[0] = original; db.replayStarts[40] = '2026-08-16T11:00:00Z'; delete db.replayStarts[41] }
      recount(db.seasons[0])
    }
  }
  const publicBase = '/api/tournament-broadcasts', adminBase = '/api/admin/tournament-broadcasts'
  const coverBase = '/api/tournament-broadcasts/covers/'
  function send(response, status, value) {
    response.statusCode = status
    if (value === undefined) { response.end(); return }
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(value))
  }
  function failure(response, status, code) {
    send(response, status, { id: 'broadcast-browser-fixture', errorCode: code, errorMsg: null, status, retryable: false, details: {}, timestamp: null })
  }
  const seasonView = season => ({ season, categories: db.categories.filter(value => value.seasonId === season.id), coverUploadAvailable: true })
  const categoryView = category => ({ season: db.seasons.find(value => value.id === category.seasonId), category, nodes: db.nodes.filter(value => value.categoryId === category.id), coverUploadAvailable: true })
  function timedCategoryView(category) {
    const data = categoryView(category)
    const defaultTimeZone = { CN: 'Asia/Shanghai', ASIA: 'Asia/Shanghai', NA: 'America/Los_Angeles', EU: 'Europe/Berlin', LESTA: 'Europe/Moscow' }[data.season.server]
    return { data, defaultTimeZone, replayStarts: data.nodes.flatMap(node => node.replays)
      .filter(replay => db.replayStarts?.[replay.id]).map(replay => ({ replayId: replay.id, startsAt: db.replayStarts[replay.id] })) }
  }
  function recount(season) {
    const categories = db.categories.filter(value => value.seasonId === season.id).map(value => value.id)
    const nodes = db.nodes.filter(value => categories.includes(value.categoryId))
    season.rootCount = nodes.length; season.replayCount = nodes.reduce((sum, value) => sum + value.replays.length, 0)
  }
  const middleware = async (request, response, next) => {
    const url = new URL(request.url, 'http://fixture'), path = url.pathname
    if (path === '/__broadcast-preview/reset' && preview && request.method === 'POST') { reset(); send(response, 204); return }
    if (path === '/api/observability/events') { send(response, 204); return }
    if (path.startsWith(coverBase)) { response.statusCode = 404; response.end(); return }
    if (![publicBase, adminBase].some(base => path === base || path.startsWith(`${base}/`))) { next(); return }
    try {
      const admin = path.startsWith(adminBase)
      const base = admin ? adminBase : publicBase
      const parts = path.slice(base.length).split('/').filter(Boolean), targetId = Number(parts[1])
      if (admin && request.headers.authorization !== 'Bearer fixture-access-token') { failure(response, 403, 'AUTH_FORBIDDEN'); return }
      if (!parts.length) { send(response, 200, { servers, seasons: db.seasons.filter(value => value.server === url.searchParams.get('server')), coverUploadAvailable: true }); return }
      let season = parts[0] === 'seasons' ? db.seasons.find(value => value.id === targetId) : null
      let category = parts[0] === 'categories' ? db.categories.find(value => value.id === targetId) : null
      let node = parts[0] === 'nodes' ? db.nodes.find(value => value.id === targetId) : null
      const replay = parts[0] === 'replays' ? db.nodes.flatMap(value => value.replays).find(value => value.id === targetId) : null
      if (replay) node = db.nodes.find(value => value.id === replay.nodeId)
      if (node) category = db.categories.find(value => value.id === node.categoryId)
      if (category) season = db.seasons.find(value => value.id === category.seasonId)
      if (request.method === 'GET') {
        if (!season) { failure(response, 404, 'RESOURCE_NOT_FOUND'); return }
        if (parts[2] === 'contents') {
          const categories = db.categories.filter(value => value.seasonId === season.id)
          const nodes = db.nodes.filter(node => categories.some(category => category.id === node.categoryId))
          send(response, 200, { ...seasonView(season), nodes, defaultTimeZone: 'Asia/Shanghai', replayStarts: nodes.flatMap(node => node.replays).filter(replay => db.replayStarts[replay.id]).map(replay => ({ replayId: replay.id, startsAt: db.replayStarts[replay.id] })) })
        }
        else if (parts[2] === 'deletion-preview') send(response, 200, { seasonId: season.id, expectedVersion: season.version, rootCount: node ? 1 : category ? db.nodes.filter(value => value.categoryId === category.id).length : season.rootCount, replayCount: node ? node.replays.length : category ? db.nodes.filter(value => value.categoryId === category.id).reduce((sum, node) => sum + node.replays.length, 0) : season.replayCount })
        else send(response, 200, category ? timedCategoryView(category) : seasonView(season))
        return
      }
      let payload, startsAt
      if (request.method !== 'DELETE') {
        const incoming = new Request(url, { method: request.method, headers: request.headers, body: Readable.toWeb(request), duplex: 'half' })
        if (String(request.headers['content-type']).startsWith('multipart/')) {
          const envelope = JSON.parse(await (await incoming.formData()).get('payload').text())
          payload = envelope.replay; startsAt = envelope.startsAt
        } else payload = await incoming.json()
      }
      if (db.failNext) { db.failNext = false; failure(response, 400, 'INVALID_ARGUMENT'); return }
      if (season && (payload?.expectedVersion ?? Number(url.searchParams.get('expectedVersion'))) !== season.version) { failure(response, 409, 'BROADCAST_VERSION_CONFLICT'); return }
      if (request.method === 'DELETE') {
        if (replay) node.replays = node.replays.filter(value => value.id !== targetId)
        else if (node) db.nodes = db.nodes.filter(value => value.id !== targetId)
        else if (category) { db.nodes = db.nodes.filter(value => value.categoryId !== category.id); db.categories = db.categories.filter(value => value.id !== category.id) }
        else if (season) db.seasons = db.seasons.filter(value => value.id !== targetId)
        if (season) { season.version++; recount(season) }
        send(response, 204); return
      }
      if (parts[0] === 'seasons' && parts.length === 1) {
        season = { ...payload, id: db.nextId++, version: 0, createdAt: '2026-10-16T00:00:00Z', rootCount: 0, replayCount: 0 }
        db.seasons.push(season)
      } else if (parts[0] === 'seasons' && parts.length === 2) {
        Object.assign(season, { year: payload.year, nameZh: payload.nameZh, nameEn: payload.nameEn, nameRu: payload.nameRu, startDate: payload.startDate }); season.version++
      } else if (parts[2] === 'categories') {
        category = { id: db.nextId++, seasonId: season.id, type: payload.type }; db.categories.push(category); season.version++
        send(response, 200, seasonView(season)); return
      } else if (parts[2] === 'nodes') {
        node = { id: db.nextId++, categoryId: category.id, roundNumber: payload.roundNumber, format: payload.format, replays: [] }
        db.nodes.push(node); season.version++; recount(season)
      } else {
        const { expectedVersion, coverAction, ...fields } = payload
        const saved = replay || { id: db.nextId++, nodeId: node.id, coverId: null }
        Object.assign(saved, fields)
        if (!replay) node.replays.push(saved)
        db.replayStarts[saved.id] = startsAt
        season.version++; recount(season)
      }
      send(response, 200, category ? timedCategoryView(category) : seasonView(season))
    } catch (error) { console.error(error); failure(response, 500, 'INTERNAL_ERROR') }
  }

  reset()
  return { get db() { return db }, reset, middleware }
}
