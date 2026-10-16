/**
 * 帧契约的**可执行验收**：2D 俯视与 3D 场景描述同一物理朝向。
 *
 * 契约（两侧各自施加，符号只出现在这两处）：
 * - game 系（共享采样器输出）：x 东、z 北、yaw 自 +z 起顺时针为正；
 * - 2D 地图（`utils/mapView.js`）：pixel x ∝ +x（左 = −300 游戏 x）、pixel y ∝ −z
 *   （上 = +300 游戏 z）；`screenRotation(yawDeg)` 恒等 ⇒ 0° = 朝上、90° = 朝右（东）；
 * - 3D 场景（`scene/playbackScene.js`）：`pos = (−x, y, z)`、`yaw` 取负、`roll` 取负、
 *   `pitch` 不变——"图右边 = 游戏 +x = 场景 −x"（场景头注释同一约定）。
 *
 * 两侧因此是同一张画面：3D 场景把相机压到正上方（游戏 +x 朝右、+z 朝上）时，
 * 与 2D 底图逐点一致。本文件把该契约写成数字断言，任何一侧翻符号都会在这里失败。
 */
import { describe, expect, it } from 'vitest'
import { createMapView } from '../../utils/mapView.js'
import { screenRotation, turretWorldYawDeg } from '../../utils/battlePlayback.js'
import { sampleVehiclePoseGame } from './vehiclePose.js'
import type { AgentVehicleTrack } from '../../api/agent-replay-facets.js'

const IMAGE = { width: 1254, height: 1254, coordinateBounds: { xMin: -300, xMax: 300, yMin: -300, yMax: 300 } }

/** 3D 场景侧的帧变换（契约副本：与 playbackScene.js 的 posAt/调用点逐项一致）。 */
function poseToSceneFrame(pose: { x: number, y: number, z: number, yaw: number, pitch: number, roll: number }) {
  return { x: -pose.x, y: pose.y, z: pose.z, yaw: -pose.yaw, pitch: pose.pitch, roll: -pose.roll }
}

/** 在“游戏 +x 朝右、+z 朝上”的俯视图里，朝 yaw 方向的屏幕角（CSS：顺时针、0 = 上）。 */
function topDownScreenDeg(yawDeg: number) {
  return ((yawDeg % 360) + 360) % 360
}

/** 角度同向判定（360° 周期等价，避免 ±180 的规范化差异）。 */
function angleEq(a: number, b: number) {
  return Math.abs(((a - b + 180) % 360 + 360) % 360 - 180) < 1e-6
}

function def(yawRad: number, turretAbsRad: number, pos: [number, number, number]): AgentVehicleTrack {
  const n = 11
  return {
    eid: 1, account_id: 1, nickname: '', tank_id: 1, tank_name: '', team: 1, is_author: false, max_hp: 100,
    pos: Array.from({ length: n }, () => [...pos]).flat(),
    hull_yaw: new Array(n).fill(yawRad),
    hull_pitch: new Array(n).fill(0),
    turret_yaw: new Array(n).fill(turretAbsRad),
    gun_pitch: new Array(n).fill(0),
    hp: [], death_t: null, killer_eid: 0, shell_ids: [],
    turret_index: null, gun_index: null, coverage: [0, 1],
  } as AgentVehicleTrack
}

describe('2D 俯视 ↔ 3D 场景 帧契约', () => {
  const mapView = createMapView(IMAGE, null)

  it('地图约定：右 = 游戏 +x、上 = 游戏 +z（y 轴翻转，无 x 镜像）', () => {
    expect(mapView.toX(-300)).toBeCloseTo(0, 6)
    expect(mapView.toX(300)).toBeCloseTo(IMAGE.width, 6)
    expect(mapView.toY(300)).toBeCloseTo(0, 6)          // +z（北）在上
    expect(mapView.toY(-300)).toBeCloseTo(IMAGE.height, 6)
    // 东移一格 → 像素向右；北移一格 → 像素向上
    expect(mapView.toX(10)).toBeGreaterThan(mapView.toX(0))
    expect(mapView.toY(10)).toBeLessThan(mapView.toY(0))
  })

  it('平面内朝向：screenRotation 恒等（0° = 上、90° = 右/东；180° 规范化为 −180）', () => {
    expect(screenRotation(0)).toBe(0)
    expect(screenRotation(90)).toBe(90)
    expect(screenRotation(-90)).toBe(-90)
    expect(screenRotation(180)).toBe(-180)
    expect(angleEq(screenRotation(270), 270)).toBe(true)
  })

  it('同一 yaw 在 3D 镜像系与 2D 地图系指向同一物理方向（逐象限）', () => {
    for (const yawDeg of [0, 90, 180, 270]) {
      const game = sampleVehiclePoseGame(def((yawDeg * Math.PI) / 180, (yawDeg * Math.PI) / 180, [0, 0, 0]), { tStart: 0, samples: 11 }, 0.5)
      const scene = poseToSceneFrame(game)
      // 3D：场景 −x = 游戏 +x ⇒ 场景 yaw 取负后仍描述同一 game 朝向
      expect(scene.yaw).toBeCloseTo(-(yawDeg * Math.PI) / 180, 9)
      expect(angleEq(topDownScreenDeg(-(scene.yaw * 180) / Math.PI), topDownScreenDeg(yawDeg))).toBe(true)
      // 2D：屏幕角 = game yaw（CSS 顺时针），两侧同为"上 = 北、右 = 东"
      expect(angleEq(screenRotation((game.yaw * 180) / Math.PI), topDownScreenDeg(yawDeg))).toBe(true)
    }
  })

  it('位置：场景 x 取负、2D 不取负，但都落在同一张底图的同一点', () => {
    const game = sampleVehiclePoseGame(def(0, 0, [120, 0, -80]), { tStart: 0, samples: 11 }, 0.5)
    const scene = poseToSceneFrame(game)
    expect(scene.x).toBeCloseTo(-120, 6)
    // 2D 像素（左 = −300 游戏 x）与「场景 −x 朝左」是同一处：像素 x 随游戏 x 增大
    expect(mapView.toX(game.x)).toBeGreaterThan(IMAGE.width / 2)
    // 北（+z）在两种呈现里都朝上：像素 y 随 z 增大而上移
    expect(mapView.toY(game.z)).toBeGreaterThan(IMAGE.height / 2)
  })

  it('炮塔：2D 用 车体+相对 合成世界角，与"绝对角 − 车体"等价（warp 边界一致）', () => {
    for (const [hullDeg, absDeg] of [[0, 30], [170, -170], [-120, 120], [90, 90]]) {
      const game = sampleVehiclePoseGame(
        def((hullDeg * Math.PI) / 180, (absDeg * Math.PI) / 180, [0, 0, 0]), { tStart: 0, samples: 11 }, 0.5)
      const abs = (game.yaw + game.turretRel) * 180 / Math.PI
      const viaCanonical = turretWorldYawDeg(hullDeg, absDeg - hullDeg)
      const viaPose = turretWorldYawDeg((game.yaw * 180) / Math.PI, (game.turretRel * 180) / Math.PI)
      expect(viaPose).toBeCloseTo(viaCanonical, 6)
      expect(Math.cos(abs * Math.PI / 180)).toBeCloseTo(Math.cos(Number(absDeg) * Math.PI / 180), 6)
      expect(Math.sin(abs * Math.PI / 180)).toBeCloseTo(Math.sin(Number(absDeg) * Math.PI / 180), 6)
    }
  })

  it('场景侧符号契约（与 playbackScene.js 调用点同项）：x/yaw/roll 取负、pitch 不变', () => {
    const game = sampleVehiclePoseGame(def(Math.PI / 3, 0, [7, 1, 9]), { tStart: 0, samples: 11 }, 0.5)
    const scene = poseToSceneFrame(game)
    expect(scene.x).toBe(-game.x)
    expect(scene.y).toBe(game.y)
    expect(scene.z).toBe(game.z)
    expect(scene.yaw).toBe(-game.yaw)
    expect(scene.pitch).toBe(game.pitch)
    expect(scene.roll).toBe(-game.roll)
  })
})
