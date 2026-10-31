/**
 * 录像者相机消费边界（上游 v0.4.21 `parseRecorderCamera`）：合法返回只有 `null` 或严格对象，
 * 形状漂移一律 fail closed，由调用方按「此回放不支持」处理。真实 pinned 产物的
 * replay fixture 校验在 `replay-local/agent-wasm-smoke.test.ts`。
 */
import { describe, expect, it } from 'vitest'

import { validateAgentRecorderCamera, type AgentRecorderCamera } from './agent-replay-facets.js'

const VALID: AgentRecorderCamera = {
  version: 1,
  author_eid: 7,
  aim: { t: [0, 1], yaw: [0, 0.1], pitch: [0, 0], ray_x: [1, 2], ray_y: [3, 4], ray_z: [5, 6] },
  mode: { t: [0, 2], raw: [1, 0x80000000] },
  zoom: { t: [2.1], raw: [27] },
  bloom: { t: [], raw: [] },
  client_options: { backward_zoom: null },
}

describe('validateAgentRecorderCamera', () => {
  it('accepts a valid facet and the null structural verdict', () => {
    expect(validateAgentRecorderCamera(VALID)).toEqual(VALID)
    expect(validateAgentRecorderCamera(null)).toBeNull()
  })

  it.each([
    ['wrong version', { ...VALID, version: 2 }],
    ['zero author', { ...VALID, author_eid: 0 }],
    ['empty aim', { ...VALID, aim: { ...VALID.aim, t: [], yaw: [], pitch: [], ray_x: [], ray_y: [], ray_z: [] } }],
    ['empty mode', { ...VALID, mode: { t: [], raw: [] } }],
    ['short column', { ...VALID, aim: { ...VALID.aim, yaw: [0] } }],
    ['descending clock', { ...VALID, zoom: { t: [3, 2], raw: [27, 27] } }],
    ['fractional mode', { ...VALID, mode: { t: [0, 2], raw: [1, 0.5] } }],
    ['negative mode', { ...VALID, mode: { t: [0, 2], raw: [1, -1] } }],
    ['mode above u32', { ...VALID, mode: { t: [0, 2], raw: [1, 4294967296] } }],
    ['non-finite value', { ...VALID, bloom: { t: [1], raw: [Number.NaN] } }],
    ['non-boolean option', { ...VALID, client_options: { backward_zoom: 'true' } }],
    ['missing section', { ...VALID, zoom: undefined }],
  ])('rejects %s', (_name, value) => {
    expect(() => validateAgentRecorderCamera(value)).toThrow(/agent facets/)
  })
})
