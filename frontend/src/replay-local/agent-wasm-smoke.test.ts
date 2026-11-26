import { sampleRecorderCamera } from '../scene/playback/cameraRig.js'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  FIXTURE_REPLAYS,
  authorInitialPositionViaPinnedWasm,
  recorderCameraViaPinnedWasm,
  fixtureFacets,
  reloadTelemetryFor,
  replayFacets,
  requireFixtures,
  shotsViaPinnedWasm,
} from './__golden__/agentWasmNode.js'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const SMOKE_REPLAY = process.env.WOTB_SMOKE_REPLAY
const FIXTURES = Object.keys(FIXTURE_REPLAYS)
const REFERENCE = 'random-battle-example.wotbreplay'
const RECORDER_CAMERA_ORACLE: Record<string, [number, number]> = {
  'random-battle-example.wotbreplay': [39, 7926],
  'cw-training-15-14-example.wotbreplay': [14, 2026],
  'tournament-14-14-example.wotbreplay': [11, 1847],
}
const LAUNCH_LAG_SEC = 0.2
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const wrapDeg = (deg: number) => Math.abs(((deg + 180) % 360 + 360) % 360 - 180)

describe('Agent WASM 五入口 smoke（pin 产物真实解析）', () => {
  it('fixture 名单非空（scanner self-check）', () => {
    expect(FIXTURES.length).toBeGreaterThan(0)
  })

  it.each(FIXTURES)('%s：parseResult / parsePlayback / parseAiReview 全部可用', async (file) => {
    const facets = await fixtureFacets(file)
    expect(facets.result.players.length).toBeGreaterThan(0)
    expect(facets.playback?.version).toBe(2)
    expect(facets.aiReview?.version).toBe(1)
    expect(Array.isArray(facets.aiReview?.poses)).toBe(true)
    expect(Array.isArray(facets.aiReview?.turrets)).toBe(true)
    expect(Array.isArray(facets.aiReview?.events)).toBe(true)
    expect(Array.isArray(facets.aiReview?.rosters)).toBe(true)
  })

  it('poses / turrets 是 per-entity 数组（锁存在性，不锁条数）', async () => {
    const { aiReview } = requireFixtures(await fixtureFacets(REFERENCE))
    expect(aiReview.poses.length).toBeGreaterThan(0)
    expect(aiReview.turrets.length).toBeGreaterThan(0)
    for (const track of [...aiReview.poses, ...aiReview.turrets]) {
      expect(typeof track.eid).toBe('number')
      expect(Array.isArray(track.t)).toBe(true)
    }
  })

  it('parseShotReplays 入口可用（author_path ∈ ok|error，shots 是数组）', async () => {
    const bytes = new Uint8Array(readFileSync(join(REPO, FIXTURE_REPLAYS[REFERENCE])))
    const outcome = await shotsViaPinnedWasm(bytes)
    expect(Array.isArray(outcome.shots)).toBe(true)
    expect(['ok', 'error']).toContain(outcome.author_path)
    if (outcome.author_path === 'error') expect(typeof outcome.author_error).toBe('string')
  })

  it('parseAuthorInitialPosition 入口可用（录像者初始世界位姿 / null）', async () => {
    const bytes = new Uint8Array(readFileSync(join(REPO, FIXTURE_REPLAYS[REFERENCE])))
    const position = await authorInitialPositionViaPinnedWasm(bytes)
    expect(position).not.toBeNull()
    expect(position!.author_eid).toBeGreaterThan(0)
    expect(Number.isFinite(position!.clock)).toBe(true)
    expect(position!.clock).toBeGreaterThanOrEqual(0)
    expect(position!.position).toHaveLength(3)
    for (const value of position!.position) expect(Number.isFinite(value)).toBe(true)
  })

  it.each(Object.entries(RECORDER_CAMERA_ORACLE))(
    'parseRecorderCamera 与独立分帧计数一致：%s',
    async (name, [sessions, zoomSamples]) => {
      const bytes = new Uint8Array(readFileSync(join(REPO, FIXTURE_REPLAYS[name])))
      const camera = await recorderCameraViaPinnedWasm(bytes)
      expect(camera).not.toBeNull()
      expect(camera!.mode.raw.filter((raw) => raw !== 1)).toHaveLength(sessions)
      expect(camera!.zoom.t).toHaveLength(zoomSamples)
    },
  )

  it('瞄准方向与 method29 发射向量一致（独立物理 oracle，同时验证时钟对齐）', async () => {
    const yawErrors: number[] = []
    const pitchErrors: number[] = []
    const zeroLagPitchErrors: number[] = []
    for (const name of Object.keys(RECORDER_CAMERA_ORACLE)) {
      const bytes = new Uint8Array(readFileSync(join(REPO, FIXTURE_REPLAYS[name])))
      const camera = await recorderCameraViaPinnedWasm(bytes)
      const { shots } = await shotsViaPinnedWasm(bytes)
      for (const shot of shots) {
        if (!shot.is_author || shot.launch_velocity?.length !== 3) continue
        const [vx, vy, vz] = shot.launch_velocity
        const launchPitch = Math.atan2(vy, Math.hypot(vx, vz))
        const aim = sampleRecorderCamera(camera!, shot.time_s - LAUNCH_LAG_SEC) as { yaw: number; pitch: number }
        yawErrors.push(wrapDeg(((aim.yaw - Math.atan2(vx, vz)) * 180) / Math.PI))
        pitchErrors.push(Math.abs((aim.pitch - launchPitch) * 180 / Math.PI))
        const zeroLag = sampleRecorderCamera(camera!, shot.time_s) as { pitch: number }
        zeroLagPitchErrors.push(Math.abs((zeroLag.pitch - launchPitch) * 180 / Math.PI))
      }
    }
    expect(yawErrors.length).toBeGreaterThan(20)
    expect(median(yawErrors)).toBeLessThan(0.5)
    expect(median(pitchErrors)).toBeLessThan(1)
    expect(median(zeroLagPitchErrors)).toBeGreaterThan(median(pitchErrors))
  })

  it('装填遥测形状：reloads 是数组，条目带 clock/eid/phase（无遥测则整场为空数组）', async () => {
    const { playback } = requireFixtures(await fixtureFacets(REFERENCE))
    expect(Array.isArray(playback.reloads)).toBe(true)
    for (const event of playback.reloads ?? []) {
      expect(Number.isFinite(event.clock)).toBe(true)
      expect(typeof event.eid).toBe('number')
      expect(typeof event.phase).toBe('number')
    }
  })
})

describe('Agent WASM 装填遥测 smoke（fixture）', () => {
  it.each(FIXTURES)('%s：作者车装填遥测与逐发状态一致（无遥测 → 不伪造）', async (file) => {
    const { playback } = requireFixtures(await fixtureFacets(file))
    const telemetry = reloadTelemetryFor(playback)
    expect(telemetry.samples.length).toBe(telemetry.authorUsablePhases)
    if (telemetry.authorUsablePhases === 0) {
      expect(telemetry.samples).toHaveLength(0)
      expect(telemetry.magazineSize).toBeGreaterThanOrEqual(1)
      return
    }
    expect(telemetry.magazineSize).toBeGreaterThanOrEqual(1)
    for (const { t, states } of telemetry.samples) {
      expect(states, `${file} t=${t} 采样得到 null（无遥测）`).not.toBeNull()
    }
  })
})

const describeSmoke = SMOKE_REPLAY ? describe : describe.skip
describeSmoke('原始问题回放（WOTB_SMOKE_REPLAY）', () => {
  it('AI Review 不再报 poses 缺失：poses = 18、turrets = 14', async () => {
    const facets = await replayFacets(SMOKE_REPLAY as string)
    const { aiReview, playback } = requireFixtures(facets)
    expect(aiReview.poses).toHaveLength(18)
    expect(aiReview.turrets).toHaveLength(14)
    expect(playback.version).toBe(2)
    expect(facets.result.players.length).toBeGreaterThan(0)
  })

  it('装填条不再"永远不动"：作者车有 reload timeline，逐发状态随相位变化', async () => {
    const { playback } = requireFixtures(await replayFacets(SMOKE_REPLAY as string))
    const reloads = playback.reloads ?? []
    expect(reloads.length).toBeGreaterThan(0)
    expect(playback.reload_effective == null || Array.isArray(playback.reload_effective)).toBe(true)

    const telemetry = reloadTelemetryFor(playback)
    const authorEid = playback.meta.author_eid
    expect(reloads.some((event) => event.eid === authorEid)).toBe(true)
    expect(telemetry.authorEid).toBe(authorEid)
    expect(telemetry.authorUsablePhases).toBeGreaterThan(0)

    const signatures = new Set<string>()
    for (const { t, states } of telemetry.samples) {
      expect(states, `t=${t} 无装填状态（装填条无从绘制）`).not.toBeNull()
      signatures.add(JSON.stringify(states))
    }
    expect(signatures.size).toBeGreaterThan(1)
  })
})
