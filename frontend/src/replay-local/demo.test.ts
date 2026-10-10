import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isOfficialDemo, loadOfficialDemo, OFFICIAL_DEMO } from './demo.js'
import { useReplaySession } from '../composables/useReplaySession.js'
import { replayFacets, requireFixtures, shotsViaPinnedWasm } from './__golden__/agentWasmNode.js'
import { resolveReplayClock } from './canonical/facts.js'

const samplePath = new URL(`../../../common/assets${OFFICIAL_DEMO.path}`, import.meta.url)
const sampleBytes = readFileSync(samplePath)

function serve(bytes = sampleBytes) {
  const fetchMock = vi.fn(async () => new Response(bytes))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('official sample provenance', () => {
  it('qualifies only the verified loader File identity, never matching metadata or a copy', async () => {
    const fetch = serve()
    const file = await loadOfficialDemo()
    expect(fetch).toHaveBeenCalledWith(OFFICIAL_DEMO.path, { signal: undefined })
    expect(isOfficialDemo(file)).toBe(true)
    expect(isOfficialDemo(new File([sampleBytes], file.name, { lastModified: 0 }))).toBe(false)
    expect(isOfficialDemo(null)).toBe(false)
    expect(file.size).toBe(OFFICIAL_DEMO.bytes)
  })

  it('fails closed for a failed download, wrong length or modified bytes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    await expect(loadOfficialDemo()).rejects.toThrow('download failed')
    serve(Buffer.from('short'))
    await expect(loadOfficialDemo()).rejects.toThrow('size mismatch')
    const corrupt = Buffer.from(sampleBytes)
    corrupt[0] ^= 1
    serve(corrupt)
    await expect(loadOfficialDemo()).rejects.toThrow('hash mismatch')
  })

  it('does not qualify a download cancelled before identity creation', async () => {
    serve()
    const controller = new AbortController()
    controller.abort()
    await expect(loadOfficialDemo(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('ordinary reselection, mixed selection and clear all revoke session qualification', async () => {
    serve()
    const demo = await loadOfficialDemo()
    const userFile = new File(['private'], 'private.wotbreplay')
    const session = useReplaySession()
    expect(() => session.replaceDemoSelection(userFile)).toThrow('Unverified')
    expect(session.files.value).toEqual([])
    for (const next of [[demo], [demo, userFile], [userFile], []]) {
      session.replaceDemoSelection(demo)
      expect(session.isDemoSelection.value).toBe(true)
      session.replaceSelection(next)
      expect(session.isDemoSelection.value).toBe(false)
    }
  })

  it('cannot retain qualification when files are changed outside the selection command', async () => {
    serve()
    const demo = await loadOfficialDemo()
    const session = useReplaySession()
    session.replaceDemoSelection(demo)
    session.files.value.push(new File(['private'], 'private.wotbreplay'))
    expect(session.isDemoSelection.value).toBe(false)
  })
})

describe('bundled sample teaching cues', () => {
  // This integration case boots pinned WASM and decodes a real replay under concurrent CI;
  // the provenance policy cases above retain the ordinary test timeout.
  it('resolves the published time and shot identity with the pinned real parser', async () => {
    const parsed = requireFixtures(await replayFacets(fileURLToPath(samplePath)))
    expect(Buffer.from(parsed.bytes)).toEqual(sampleBytes)
    expect(parsed.result.map_key).toBe(OFFICIAL_DEMO.mapCode)
    const clock = resolveReplayClock(parsed.aiReview.battle.periods, parsed.result, parsed.playback.meta.duration)
    const outcome = await shotsViaPinnedWasm(parsed.bytes)
    const shot = outcome.shots.find(s => s.shot_id === OFFICIAL_DEMO.cue.shotId)
    expect(clock?.startRaw).toBe(OFFICIAL_DEMO.cue.rawBattleStartSeconds)
    expect(shot).toMatchObject({
      shooter_eid: OFFICIAL_DEMO.cue.shooterEid,
      target_eid: OFFICIAL_DEMO.cue.targetEid,
      time_s: OFFICIAL_DEMO.cue.shotRawSeconds,
    })
    expect(shot!.time_s - clock!.startRaw).toBeCloseTo(OFFICIAL_DEMO.cue.playbackSeconds, 6)
    expect(OFFICIAL_DEMO.cue.playbackSeconds).toBeGreaterThan(0)
    expect(OFFICIAL_DEMO.cue.playbackSeconds).toBeLessThan(clock!.durationSec)
    expect(parsed.playback.vehicles.some(v => v.eid === OFFICIAL_DEMO.cue.vehicleEid)).toBe(true)
    expect(shot!.ball_a).toHaveLength(3)
    expect(shot!.target_pos).toHaveLength(3)
  }, 30_000)
})
