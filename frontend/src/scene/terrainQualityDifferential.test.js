// 跨画质档地形差分基线（Issue #857 Step 0；#857 计划 §20）。
//
// 目的：独立证明「terrain geometry 是否随画质档漂移」。四档共用同一份 height field
// （资产侧 terrain.json/terrain.u16.bin 与档位无关）、同一相机姿态、同一走廊掩码时，
// buildGroundGeometry 的 positions/indices 必须逐字节一致——quality preset 的任何字段
// 都不是地形几何的输入。这条测试永久阻止未来把 fidelity 参数接进 world-surface truth。
//
// 已知合法的跨档差异只有一个来源：走廊 refine mask 由场景 GLB 装配期派生
//（mapAssets.buildCorridorRefineMask），low/mid 无场景 GLB ⇒ 无掩码。掩码语义
//（命中补片强制细分到最细层、只加细分不改高度值）由 terrainMesh.test.js 锁定；
// 本文件在其上锁定「档位身份」这一输入为非法。
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildGroundGeometry } from './groundPass.js'
import { QUALITY_PRESETS } from './playback/quality.js'
import { CLIENT_NORMAL_CAMERA_FOV_H, buildRefineMask, terrainSurfaceHeightAt } from './terrainMesh.js'

// 固定特征场：平台 + 山脊 + 河谷 + 边界下沿，覆盖四类采样 corpus（计划 §3 Step 0A）。
const N = 64
const SPAN = 600
function featureField(n) {
  const field = new Float32Array(n * n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = (j / n - 0.5) * SPAN, z = (i / n - 0.5) * SPAN
      const ridge = 14 * Math.exp(-((z - 60) ** 2) / 2 / 18 ** 2)          // 东西向山脊
      const valley = -10 * Math.exp(-((x - 40) ** 2) / 2 / 25 ** 2)        // 南北向河谷
      const plateau = (Math.abs(x) < 90 && Math.abs(z) < 90) ? 8 : 0       // 中央高台
      const border = -6 * Math.max(0, (Math.abs(x) - 240) / 60, (Math.abs(z) - 240) / 60)
      field[i * n + j] = ridge + valley + plateau + border
    }
  }
  return field
}

const FIELD = featureField(N)
const CAM = { x: -80, y: 140, z: 60 }
const FOV_Y = (55 * Math.PI) / 180
const ASPECT = 16 / 9
const HFov = CLIENT_NORMAL_CAMERA_FOV_H

// 走廊掩码：一条穿越河谷的贴地薄构件走廊（与场景 GLB 派生语义同构的输入形状）。
function corridorMask() {
  const pts = []
  for (let s = 0; s <= 40; s++) pts.push(-SPAN / 2 + (SPAN * s) / 40, -30)
  return buildRefineMask(pts, N, SPAN, 2)
}

function bufferDigest(arr) {
  return createHash('sha256')
    .update(String(arr.constructor.name))
    .update(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength))
    .digest('hex')
}

function geometryDigest(g) {
  return {
    positions: bufferDigest(g.attributes.position.array),
    indices: bufferDigest(g.index.array),
    quads: g.userData.terrainBuild.quads,
    overBudget: g.userData.terrainBuild.overBudget,
  }
}

/** 固定输入按档位建几何：**只传几何宿主参数**——preset 本身必须不是输入。 */
function buildForPreset(presetKey, refineMask) {
  return buildGroundGeometry({
    field: FIELD, n: N, span: SPAN,
    cam: CAM, fovY: FOV_Y, aspect: ASPECT, hFovDeg: HFov, refineMask,
  })
}

// 采样 corpus（计划 §3 Step 0A）：texel 网格全量 + 山脊线 + 河谷线 + 边界圈。
function sampleCorpus() {
  const pts = []
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) pts.push([(j / N - 0.5) * SPAN, (i / N - 0.5) * SPAN])
  for (let s = 0; s <= 60; s++) {
    const t = -SPAN / 2 + (SPAN * s) / 60
    pts.push([t, 60], [40, t])                        // 山脊线 / 河谷线
    pts.push([t, -SPAN / 2 + 2], [t, SPAN / 2 - 2])   // 地图边界
  }
  return pts
}

function surfaceErrorStats(geometry) {
  const truth = (x, z) => {
    // 真值索引按 GetHeightClamp 口径夹到边缘 texel（边界外侧采样不越界）
    const j = Math.min(N - 1, Math.max(0, Math.round((x / SPAN + 0.5) * N)))
    const i = Math.min(N - 1, Math.max(0, Math.round((z / SPAN + 0.5) * N)))
    return FIELD[i * N + j]
  }
  const errs = []
  for (const [x, z] of sampleCorpus()) {
    const y = terrainSurfaceHeightAt(geometry.userData.terrainBuild, x, z)
    if (y === null) continue
    errs.push(Math.abs(y - truth(x, z)))
  }
  errs.sort((a, b) => a - b)
  const at = (p) => errs[Math.min(errs.length - 1, Math.floor(p * (errs.length - 1)))]
  return { count: errs.length, p50: at(0.5), p95: at(0.95), max: errs[errs.length - 1] }
}

describe('跨画质档地形差分基线（#857 Step 0）', () => {
  const PRESET_KEYS = Object.keys(QUALITY_PRESETS)

  it('四档画质预设不改变地面几何：positions/indices/quads 逐字节一致（含走廊掩码在场）', () => {
    const mask = corridorMask()
    const digests = PRESET_KEYS.map((k) => geometryDigest(buildForPreset(k, mask)))
    for (const d of digests) expect(d).toEqual(digests[0])
  })

  it('无走廊掩码（low/mid 无场景 GLB 的形态）时四档几何同样逐字节一致', () => {
    const digests = PRESET_KEYS.map((k) => geometryDigest(buildForPreset(k, null)))
    for (const d of digests) expect(d).toEqual(digests[0])
  })

  it('走廊掩码是唯一合法的几何差异来源：只加细分（quads 不减），高度真值不变', () => {
    const mask = corridorMask()
    const base = geometryDigest(buildForPreset('low', null))
    const refined = geometryDigest(buildForPreset('low', mask))
    expect(refined.quads).toBeGreaterThanOrEqual(base.quads)
    // 掩码只影响细分密度；无掩码四档与有掩码四档各自内部一致 ⇒ 差异只能归因于掩码本身
    for (const k of PRESET_KEYS) {
      expect(geometryDigest(buildForPreset(k, mask))).toEqual(refined)
      expect(geometryDigest(buildForPreset(k, null))).toEqual(base)
    }
  })

  it('terrain truth 差分：网格表面 vs 高度场误差 corpus 跨档一致（Step 0 baseline）', () => {
    // 只锁「跨档相等」——误差数值本身是本用例固定输入下的 baseline 记录
    //（当前输入下 p50 ≈ 0.04 m、p95 ≈ 1.4 m、max ≈ 4.6 m，最大误差出现在地图边界粗 LOD
    // 区；不据此发明阈值门槛，#857 计划 §26：无 baseline 证据前不设 performance target）。
    const stats = PRESET_KEYS.map((k) => surfaceErrorStats(buildForPreset(k, corridorMask())))
    for (const s of stats) {
      expect(s.count).toBeGreaterThan(0)
      expect(s).toEqual(stats[0])
    }
  })
})
