import type { Ref } from 'vue'
import * as hof from './hall-of-fame.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../utils/http.js'

// 只 mock useAuth（避免实例化 Keycloak）与全局 fetch——
// 绝不 mock hall-of-fame.ts 本身，否则会漏掉 hofUpload() 的真实实现 bug。
const auth = vi.hoisted(() => ({
  token: vi.fn(() => 'test-token'),
  ensureToken: vi.fn(async () => true),
  login: vi.fn(),
}))

const connectivityState = vi.hoisted(() => ({ state: null as unknown as Ref<string>, settled: null as unknown as Ref<boolean> }))
vi.mock('../composables/useConnectivity.js', async () => {
  const { ref } = await import('vue')
  connectivityState.state = ref('online')
  connectivityState.settled = ref(true)
  return { useConnectivity: () => ({ connectivity: connectivityState.state, settled: connectivityState.settled, isSettled: () => connectivityState.settled.value, whenSettled: () => Promise.resolve() }) }
})

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => auth,
}))

// 服务器没有 parser：HoF 提交前在本机解析回放得到结算事实。mock 最底层的 WASM 解析入口，
// 保留真实 submissionFacts（facts 顺序 / 失败映射都在那里）。
const localParse = vi.hoisted(() => ({
  parseAgentResultFromBytes: vi.fn(async (bytes) => ({ text: new TextDecoder().decode(bytes) })),
}))
vi.mock('../api/agent-replay-facets.js', () => localParse)
vi.mock('../replay-local/battleFacts.js', () => ({
  toBattleFacts: (result) => ({ source: result.text }),
}))

import {
  hofAdminHundredApprove,
  hofAdminMark3Approve,
  hofDownload,
  hofMark3Submit,
  hofHundredSubmit,
  hofUpload,
} from './hall-of-fame.js'

function jsonResponse(status: number, body: unknown): Response {
  return Response.json(body, { status })
}

const summary = {
  id: 17, vehicleId: 385, vehicleName: 'Tank', status: 'CURRENT',
  claimedAverageDamage: 4000, claimedBattleCount: 100,
}
const nullableSummary = {
  ...summary, approvedAverageDamage: null, approvedBattleCount: null,
  submittedAt: null, approvedAt: null, rejectReason: null, rejectReasonText: null,
}
const page = { items: [], page: 0, size: 25, totalItems: 0, totalPages: 0 }
const detail = {
  ...summary, wotbServer: 'EU', wotbAccountId: 123, nicknameSnapshot: 'Player',
  replayParseOk: true, replayGameIdMatch: true, replayVehicleMatch: true, replayDistinctBattles: true,
}
const evidence = { id: 7, slot: 1, originalFilename: 'battle.wotbreplay', fileSize: 123, arenaId: 'arena', sha256: 'a'.repeat(64), createdAt: null }
const bulk = { requested: 2, deleted: 1, failed: 1, results: [{ id: 1, deleted: true }, { id: 2, deleted: false, errorCode: 'HUNDRED_NOT_CURRENT' }] }
const hardened: { name: keyof typeof hof, args: () => unknown[], valid: unknown, nullable: unknown }[] = [
  { name: 'hofAdminBulkDeleteRecords', args: () => [[1, 2]], valid: bulk, nullable: { ...bulk, results: [{ id: 1, deleted: true, errorCode: null }] } },
  { name: 'hofHundredList', args: () => [], valid: page, nullable: { ...page, vehicleId: null, vehicleName: null, items: [{ id: 1, rank: null, vehicleId: 385, vehicleName: 'Tank', nickname: 'Player', approvedAverageDamage: 4000, approvedBattleCount: 100, approvedAt: null }] } },
  { name: 'hofHundredSubmit', args: () => [new FormData()], valid: { id: 17, status: 'PENDING' }, nullable: { id: 17, status: 'PENDING' } },
  { name: 'hofHundredCancel', args: () => [17], valid: summary, nullable: nullableSummary },
  { name: 'hofHundredMyStatus', args: () => [], valid: { current: [], pending: [], rejected: [] }, nullable: { current: [nullableSummary], pending: [], rejected: [] } },
  { name: 'hofAdminHundredList', args: () => [], valid: page, nullable: { ...page, items: [{ id: 17, status: 'CURRENT', vehicleId: 385, vehicleName: 'Tank', wotbServer: 'EU', wotbAccountId: 123, nicknameSnapshot: 'Player', approvedAverageDamage: null, approvedAt: null }] } },
  { name: 'hofAdminHundredDetail', args: () => [17], valid: detail, nullable: { ...detail, proofScreenshot: null, approvedAt: null, approvedBy: null, deletedAt: null, deleteReasonText: null } },
  { name: 'hofAdminHundredReplays', args: () => [17], valid: [], nullable: [evidence] },
  { name: 'hofAdminHundredApprove', args: () => [17], valid: summary, nullable: nullableSummary },
  { name: 'hofAdminHundredReject', args: () => [17, { rejectReason: 'OTHER' }], valid: summary, nullable: nullableSummary },
  { name: 'hofAdminHundredDelete', args: () => [17, { deleteReason: 'OTHER' }], valid: summary, nullable: nullableSummary },
  { name: 'hofAdminBulkDeleteHundred', args: () => [[17], { reason: 'OTHER' }], valid: bulk, nullable: { ...bulk, results: [{ id: 17, deleted: true, errorCode: null }] } },
  { name: 'hofAdminBulkDeleteMark3', args: () => [[23], { reason: 'OTHER' }], valid: bulk, nullable: { ...bulk, results: [{ id: 23, deleted: true, errorCode: null }] } },
]

describe('authenticated HoF API requests (real hall-of-fame.ts, fetch mocked)', () => {
  const file = new File(['bytes'], 'battle.wotbreplay', { type: 'application/octet-stream' })

  beforeEach(() => {
    connectivityState.state.value = 'online'
    vi.stubGlobal('fetch', vi.fn())
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    localParse.parseAgentResultFromBytes.mockClear()
    auth.login.mockClear()
    auth.ensureToken.mockClear()
    auth.token.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const requests: [keyof typeof hof, unknown[], string, string, unknown?][] = [
    ['hofVehicleOptions', [], '/api/hof/vehicle-options', 'GET'],
    ['hofAdminList', [{ page: 2, skip: null, empty: '', active: false }], '/api/admin/hof?page=2&active=false', 'GET'],
    ['hofAdminVehicleOptions', [], '/api/admin/hof/vehicle-options', 'GET'],
    ['hofAdminAudit', [{ page: 2 }], '/api/admin/hof/audit?page=2', 'GET'],
    ['hofAdminDelete', ['a/b'], '/api/admin/hof/a%2Fb', 'DELETE'],
    ['hofAdminBulkDeleteRecords', [[1, 2]], '/api/admin/hof/records/bulk-delete', 'POST', { ids: [1, 2] }],
    ['hofHundredList', [{ vehicleId: 3 }], '/api/hof/hundred?vehicleId=3', 'GET'],
    ['hofHundredCancel', ['a/b'], '/api/hof/hundred/submissions/a%2Fb/cancel', 'POST'],
    ['hofHundredMyStatus', [], '/api/users/hundred/status', 'GET'],
    ['hofAdminHundredList', [{ status: 'PENDING' }], '/api/admin/hof/hundred/submissions?status=PENDING', 'GET'],
    ['hofAdminHundredDetail', ['a/b'], '/api/admin/hof/hundred/submissions/a%2Fb', 'GET'],
    ['hofAdminHundredReplays', [17], '/api/admin/hof/hundred/submissions/17/replays', 'GET'],
    ['hofAdminHundredApprove', [17], '/api/admin/hof/hundred/submissions/17/approve', 'POST'],
    ['hofAdminHundredReject', [17, { rejectReason: 'OTHER' }], '/api/admin/hof/hundred/submissions/17/reject', 'POST', { rejectReason: 'OTHER' }],
    ['hofAdminHundredDelete', [17, { deleteReason: 'OTHER' }], '/api/admin/hof/hundred/submissions/17/delete', 'POST', { deleteReason: 'OTHER' }],
    ['hofAdminBulkDeleteHundred', [[17], { reason: 'OTHER' }], '/api/admin/hof/hundred/submissions/bulk-delete', 'POST', { ids: [17], reason: 'OTHER' }],
    ['hofMark3List', [{ vehicleId: 3 }], '/api/hof/mark3?vehicleId=3', 'GET'],
    ['hofMark3Cancel', [23], '/api/hof/mark3/submissions/23/cancel', 'POST'],
    ['hofMark3MyStatus', [], '/api/users/mark3/status', 'GET'],
    ['hofAdminMark3List', [{ status: 'PENDING' }], '/api/admin/hof/mark3/submissions?status=PENDING', 'GET'],
    ['hofAdminMark3Detail', [23], '/api/admin/hof/mark3/submissions/23', 'GET'],
    ['hofAdminMark3Replays', [23], '/api/admin/hof/mark3/submissions/23/replays', 'GET'],
    ['hofAdminMark3Approve', [23], '/api/admin/hof/mark3/submissions/23/approve', 'POST'],
    ['hofAdminMark3Reject', [23, { rejectReason: 'OTHER' }], '/api/admin/hof/mark3/submissions/23/reject', 'POST', { rejectReason: 'OTHER' }],
    ['hofAdminMark3Delete', [23, { deleteReason: 'OTHER' }], '/api/admin/hof/mark3/submissions/23/delete', 'POST', { deleteReason: 'OTHER' }],
    ['hofAdminBulkDeleteMark3', [[23], { reason: 'OTHER' }], '/api/admin/hof/mark3/submissions/bulk-delete', 'POST', { ids: [23], reason: 'OTHER' }],
  ]

  it.each(requests)('%s preserves endpoint, method, payload and result', async (name, args, url, method, body) => {
    const responseBody = hardened.find(entry => entry.name === name)?.valid ?? { preserved: true }
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, responseBody))
    const result = await (hof[name] as (...args: any[]) => Promise<unknown>)(...args)
    expect(result).toEqual(name === 'hofAdminDelete' ? undefined : responseBody)
    const [actualUrl, options] = vi.mocked(fetch).mock.calls[0]
    expect(actualUrl).toBe(url)
    expect(options?.method ?? 'GET').toBe(method)
    expect(options?.body).toBe(body === undefined ? undefined : JSON.stringify(body))
    const publicRequest = ['hofVehicleOptions', 'hofHundredList', 'hofMark3List'].includes(name)
    if (publicRequest) expect(auth.ensureToken).not.toHaveBeenCalled()
    else {
      expect(auth.ensureToken).toHaveBeenCalledWith(30)
      expect(options?.headers).toMatchObject({ Authorization: 'Bearer test-token' })
    }
  })

  it.each(hardened)('$name accepts canonical and optional/null payloads unchanged', async ({ name, args, valid, nullable }) => {
    for (const payload of [valid, nullable]) {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(name === 'hofHundredSubmit' ? 201 : 200, payload))
      await expect((hof[name] as (...args: any[]) => Promise<unknown>)(...args())).resolves.toEqual(payload)
    }
  })

  it.each(hardened)('$name rejects malformed shapes and JSON syntax safely', async ({ name, args }) => {
    for (const response of [jsonResponse(200, { wrong: true }), new Response('{invalid-json')]) {
      vi.mocked(fetch).mockResolvedValueOnce(response)
      await expect((hof[name] as (...args: any[]) => Promise<unknown>)(...args())).rejects.toMatchObject({ code: 'INVALID_RESPONSE', retryable: false })
    }
  })

  it.each([
    ['hofList', {}], ['hofHundredList', { ...page, items: [{}] }],
    ['hofHundredMyStatus', { current: [{}], pending: [], rejected: [] }],
    ['hofAdminHundredList', { ...page, items: [{}] }],
    ['hofAdminHundredReplays', [evidence, { ...evidence, slot: 'one' }]],
    ['hofAdminBulkDeleteRecords', { ...bulk, results: [{}] }],
  ] as const)('%s rejects invalid array items and roots', async (name, payload) => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, payload))
    await expect((hof[name] as (...args: any[]) => Promise<unknown>)(17)).rejects.toMatchObject({ code: 'INVALID_RESPONSE', retryable: false })
  })

  it.each([
    { ...summary, status: 'UNKNOWN' }, { ...summary, id: '17' }, { ...summary, vehicleName: undefined },
  ])('rejects invalid summary enum, scalar and missing required values', async payload => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, payload))
    await expect(hof.hofHundredCancel(17)).rejects.toMatchObject({ code: 'INVALID_RESPONSE', retryable: false })
  })

  it.each(['hofList', 'hofHundredList', 'hofAdminHundredReplays'] as const)('%s preserves body-read abort semantics', async name => {
    const response = new Response('{}')
    const abort = new DOMException('Aborted', 'AbortError')
    vi.spyOn(response, 'json').mockRejectedValueOnce(abort)
    vi.mocked(fetch).mockResolvedValueOnce(response)
    await expect((hof[name] as (...args: any[]) => Promise<unknown>)(17)).rejects.toBe(abort)
  })

  it('normalizes public HoF JSON syntax failures', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{broken'))
    await expect(hof.hofList()).rejects.toMatchObject({ code: 'INVALID_RESPONSE', retryable: false })
  })

  it('keeps the export surface covered', () => {
    expect(Object.keys(hof).sort()).toEqual([
      ...requests.map(([name]) => name), 'hofList', 'hofUpload', 'hofHundredSubmit', 'hofMark3Submit',
      'hofDownload', 'hofAdminDownload', 'hofAdminHundredReplayDownload', 'hofAdminMark3ReplayDownload',
    ].sort())
  })

  it('keeps public list validation and query contract', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { wrong: true }))
    await expect(hof.hofList({ tier: 10, nickname: 'a b' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect(fetch).toHaveBeenCalledWith('/api/hof?tier=10&nickname=a+b')
    expect(auth.ensureToken).not.toHaveBeenCalled()
  })

  it('returns a valid generated HoF page unchanged', async () => {
    const page = { items: [], page: 0, size: 25, totalItems: 0, totalPages: 0 }
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, page))
    await expect(hof.hofList()).resolves.toEqual(page)
  })

  it.each([
    ['hofAdminDownload', [42], '/api/admin/hof/42/replay', 'replay-42.wotbreplay'],
    ['hofAdminHundredReplayDownload', [17, 'a/b'], '/api/admin/hof/hundred/submissions/17/replays/a%2Fb', 'replay-a/b.wotbreplay'],
    ['hofAdminMark3ReplayDownload', [23, 7], '/api/admin/hof/mark3/submissions/23/replays/7', 'replay-7.wotbreplay'],
    ['hofDownload', [42], '/api/hof/42/replay', 'replay-42.wotbreplay'],
  ] as const)('%s downloads with Bearer and cleans object URL', async (name, args, url, fallback) => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
    const appendChild = vi.fn()
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { appendChild } })
    vi.mocked(fetch).mockResolvedValue(new Response('bytes'))
    await (hof[name] as (...args: any[]) => Promise<unknown>)(...args)
    expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }))
    expect(anchor.download).toBe(fallback)
    expect(create).toHaveBeenCalledOnce()
    expect(appendChild).toHaveBeenCalledWith(anchor)
    expect(anchor.click).toHaveBeenCalledOnce()
    expect(anchor.remove).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith('blob:test')
  })

  it.each([
    ["attachment; filename=plain.wotbreplay; filename*=UTF-8''%E4%B8%AD.wotbreplay", '中.wotbreplay'],
    ["attachment; filename=plain.wotbreplay; filename*=UTF-8''%ZZ", 'plain.wotbreplay'],
    ['attachment; filename="quoted.wotbreplay"', 'quoted.wotbreplay'],
  ])('preserves download filename: %s', async (disposition, expected) => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
    vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: vi.fn() } })
    vi.mocked(fetch).mockResolvedValue(new Response('bytes', { headers: { 'Content-Disposition': disposition } }))
    await hofDownload(42)
    expect(anchor.download).toBe(expected)
  })

  it.each([
    ['hofHundredMyStatus', 'hof'], ['hofMark3MyStatus', 'hof'], ['hofAdminList', 'hof-admin'],
  ] as const)('%s preserves 401 destination', async (name, destination) => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(401, {}))
    await expect(hof[name]()).rejects.toMatchObject({ code: 'AUTH_UNAUTHENTICATED' })
    expect(auth.login).toHaveBeenCalledWith(destination)
  })

  it('does not redirect when connectivity disappears during a 401 request', async () => {
    vi.mocked(fetch).mockImplementationOnce(async () => {
      connectivityState.state.value = 'offline'
      return jsonResponse(401, {})
    })
    await expect(hof.hofAdminList()).rejects.toMatchObject({ code: 'AUTH_UNAUTHENTICATED' })
    expect(auth.login).not.toHaveBeenCalled()
  })

  it('rejects offline uploads before local parsing, token refresh, login or HTTP', async () => {
    connectivityState.state.value = 'offline'
    await expect(hofUpload(file)).rejects.toBeInstanceOf(ApiError)
    expect(localParse.parseAgentResultFromBytes).not.toHaveBeenCalled()
    expect(auth.ensureToken).not.toHaveBeenCalled()
    expect(auth.login).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rechecks connectivity after token refresh before HTTP', async () => {
    auth.ensureToken.mockImplementationOnce(async () => { connectivityState.state.value = 'offline'; return true })
    await expect(hofDownload(1)).rejects.toBeInstanceOf(ApiError)
    expect(fetch).not.toHaveBeenCalled()
    expect(auth.login).not.toHaveBeenCalled()
  })

  it('resolves parsed JSON on HTTP 200 — must catch old requireOk(r).json() Promise bug', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { status: 'ok', arenaId: 'arena-1' }))

    const result = await hofUpload(file)

    expect(result).toEqual({ status: 'ok', arenaId: 'arena-1' })
    expect(auth.ensureToken).toHaveBeenCalledWith(30)
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/hof/upload',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-token' },
      }),
    )
    // 旧实现 return requireOk(r).json()（requireOk 是 async → Promise 无 .json）会抛
    // TypeError，本用例直接 fail，正是该回归测试的意义。
  })

  it('rejects with ApiError UNSUPPORTED_BATTLE_TYPE on HTTP 400, not a generic network failure', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(400, { error: 'UNSUPPORTED_BATTLE_TYPE', timestamp: '2026-01-01T00:00:00Z' }),
    )

    const err = await hofUpload(file).catch(e => e)

    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('UNSUPPORTED_BATTLE_TYPE')
    expect(err.status).toBe(400)
    expect(err.code).not.toBe('NETWORK_ERROR')
    expect(err.code).not.toBe('HTTP_400')
  })

  it('keeps 401 → login("hof") + canonical auth error without regressing', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(401, { error: 'unauthorized' }))

    const err = await hofUpload(file).catch(e => e)

    expect(auth.login).toHaveBeenCalledWith('hof')
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('AUTH_UNAUTHENTICATED')
    expect(err.status).toBe(401)
  })

  it('hofDownload 401 → login("hof") + canonical auth error, no download side effects', async () => {
    const objectUrlSpy = vi.fn(() => 'blob:fake')
    URL.createObjectURL = objectUrlSpy
    vi.mocked(fetch).mockResolvedValue(jsonResponse(401, { error: 'unauthorized' }))

    const err = await hofDownload(42).catch(e => e)

    expect(auth.login).toHaveBeenCalledWith('hof')
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('AUTH_UNAUTHENTICATED')
    expect(err.status).toBe(401)
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/hof/42/replay',
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    )
    // 401 在创建 blob / object URL / 触发下载之前抛错，不得有任何下载副作用
    expect(objectUrlSpy).not.toHaveBeenCalled()
  })

  it('approves a hundred-battle submission without a score payload', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, summary))

    await hofAdminHundredApprove(17)

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/admin/hof/hundred/submissions/17/approve',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-token' },
      }),
    )
    const [, options] = vi.mocked(fetch).mock.calls[0]
    expect(options).not.toHaveProperty('body')
    expect(options!.headers).not.toHaveProperty('Content-Type')
  })

  it('submits Mark 3 evidence with the exact repeated multipart keys', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { id: 23, status: 'PENDING' }))
    const formData = new FormData()
    formData.append('vehicleId', '385')
    formData.append('battleCount', '86')
    formData.append('averageDamage', '4123')
    formData.append('winRate', '67.25')
    formData.append('proofScreenshots', 'data:image/png;base64,one')
    formData.append('proofScreenshots', 'data:image/png;base64,two')
    formData.append('replays', file)

    const result = await hofMark3Submit(formData)

    expect(result).toEqual({ id: 23, status: 'PENDING' })
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/hof/mark3/submissions',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-token' },
        body: formData,
      }),
    )
    expect(formData.getAll('proofScreenshots')).toHaveLength(2)
    expect(formData.getAll('replays')).toHaveLength(1)
  })

  it('approves a Mark 3 submission without a score payload', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { status: 'CURRENT' }))

    await hofAdminMark3Approve(23)

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/admin/hof/mark3/submissions/23/approve',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-token' },
      }),
    )
    const [, options] = vi.mocked(fetch).mock.calls[0]
    expect(options).not.toHaveProperty('body')
    expect(options!.headers).not.toHaveProperty('Content-Type')
  })

  it('hofUpload appends locally parsed facts next to the raw replay', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { status: 'ok' }))

    await hofUpload(file)

    const [, options] = vi.mocked(fetch).mock.calls[0]
    expect((options!.body as FormData).get('file')).toBe(file)
    expect(JSON.parse((options!.body as FormData).get('facts') as string)).toEqual({ source: 'bytes' })
  })

  it('hofUpload maps a local parse failure to INVALID_REPLAY_FILE and never hits the server', async () => {
    localParse.parseAgentResultFromBytes.mockRejectedValueOnce(new Error('wasm: bad replay'))

    const error = await hofUpload(file).catch(e => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('INVALID_REPLAY_FILE')
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('hofHundredSubmit appends one facts entry per replay in the same order', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { id: 5, status: 'PENDING' }))
    const formData = new FormData()
    formData.append('vehicleId', '385')
    for (const name of ['r1', 'r2', 'r3']) {
      formData.append('replays', new File([name], `${name}.wotbreplay`))
    }

    await hofHundredSubmit(formData)

    expect(formData.getAll('facts').map(f => JSON.parse(f as string).source)).toEqual(['r1', 'r2', 'r3'])
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/hof/hundred/submissions')
    expect(options!.body).toBe(formData)
  })

  it('hofMark3Submit replaces stale facts and maps a parse failure to INVALID_REPLAY_FILE', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { id: 1 }))
    const formData = new FormData()
    formData.append('facts', 'stale')
    formData.append('replays', new File(['a'], 'a.wotbreplay'))
    formData.append('replays', new File(['b'], 'b.wotbreplay'))

    await hofMark3Submit(formData)
    expect(formData.getAll('facts').map(f => JSON.parse(f as string).source)).toEqual(['a', 'b'])

    vi.mocked(fetch).mockClear()
    localParse.parseAgentResultFromBytes.mockRejectedValueOnce(new Error('corrupt'))
    const error = await hofMark3Submit(formData).catch(e => e)
    expect(error.code).toBe('INVALID_REPLAY_FILE')
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })
})
