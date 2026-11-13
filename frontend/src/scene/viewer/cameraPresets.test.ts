import { describe, expect, it } from 'vitest'
import { Euler, Matrix4, Vector3 } from 'three'
import { armorCameraPreset, armorPresetGunPitch, armorPresetViewPlacement } from './cameraPresets'
import EUROPEAN from '../../replay-local/compute/__fixtures__/modules/european.json'
import { pitchAtBearing } from '../../replay-local/compute/tankSetup'

const root = new Matrix4().makeRotationX(-Math.PI / 2)
const pivot = new Vector3(0, 0, 2)
const angle = (value: number) => value * Math.PI / 180

describe('armor camera presets', () => {
  it.each([-5, -10, -13])('keeps local depression %s and a 15m gun-line view', down => {
    const pitch = armorPresetGunPitch('hull_down', { down, up: 20 })
    const world = root.clone().multiply(new Matrix4().makeRotationX(angle(pitch)))
    const pose = armorCameraPreset(pivot, world, 15)
    const direction = pose.position.clone().sub(pose.target)
    expect(pitch).toBe(down)
    expect(direction.length()).toBeCloseTo(15)
    expect(Math.atan2(direction.y, -direction.z) * 180 / Math.PI).toBeCloseTo(down)
  })
  it('front and vehicles without depression keep local pitch at zero', () => {
    expect(armorPresetGunPitch('front', { down: -10, up: 20 })).toBe(0)
    expect(armorPresetGunPitch('hull_down', { down: 0, up: 20 })).toBe(0)
  })
  it.each([['front', 0, -3], ['hull_down', -7, -10]] as const)(
    'real Minotauro: %s separates local gun angle from world gun line', (kind, local, worldAngle) => {
      const modules = EUROPEAN.tanks.It21_Controcarro3_Minotauro
      const limits = pitchAtBearing(modules.turrets[0]!.guns[0]!.stats.pitchLimits, 0)
      const pitch = armorPresetGunPitch(kind, limits)
      const itr = modules.initialTurretRotation
      const world = root.clone().multiply(new Matrix4().makeRotationFromEuler(
        new Euler(-angle(itr.pitch), -angle(itr.roll), -angle(itr.yaw), 'XYZ')))
        .multiply(new Matrix4().makeRotationX(angle(pitch)))
      const pose = armorCameraPreset(pivot, world, 15)
      const direction = pose.position.clone().sub(pose.target)
      expect(pitch).toBe(local)
      expect(Math.atan2(direction.y, -direction.z) * 180 / Math.PI).toBeCloseTo(worldAngle)
    })
  it('applies pitch-device bonuses to the same front/hull-down presets', () => {
    const modules = EUROPEAN.tanks.It21_Controcarro3_Minotauro
    const baseLimits = pitchAtBearing(modules.turrets[0]!.guns[0]!.stats.pitchLimits, 0)
    const bonus = { up: 4, down: 3 }
    const limits = pitchAtBearing(modules.turrets[0]!.guns[0]!.stats.pitchLimits, 0, bonus)

    expect(limits.up).toBeCloseTo(baseLimits.up + bonus.up)
    expect(limits.down).toBeCloseTo(baseLimits.down - bonus.down)
    expect(armorPresetGunPitch('front', limits)).toBe(0)
    expect(armorPresetGunPitch('hull_down', limits)).toBe(limits.down)

    const world = root.clone().multiply(new Matrix4().makeRotationX(angle(limits.down)))
    const pose = armorCameraPreset(pivot, world, 15)
    const direction = pose.position.clone().sub(pose.target)
    expect(Math.atan2(direction.y, -direction.z) * 180 / Math.PI).toBeCloseTo(limits.down)
  })
  it('honors full yaw/roll and transformed gun pivot, without mutating the supplied matrix', () => {
    const world = root.clone().multiply(new Matrix4().makeTranslation(1, 2, 3))
      .multiply(new Matrix4().makeRotationFromEuler(new Euler(.2, .1, .4, 'XYZ')))
    const before = world.clone()
    const pose = armorCameraPreset(pivot, world, 15)
    const breech = pivot.clone().applyMatrix4(world)
    const muzzle = pivot.clone().add(new Vector3(0, 1, 0)).applyMatrix4(world)
    expect(pose.target.distanceTo(breech)).toBeCloseTo(0)
    expect(pose.position.clone().sub(breech).normalize().distanceTo(muzzle.sub(breech).normalize())).toBeCloseTo(0)
    expect(world.equals(before)).toBe(true)
  })
})

describe('armor preset view placement', () => {
  const world = new Matrix4().makeRotationX(-Math.PI / 2)
  const gunLine = () => armorCameraPreset(pivot, world, 15)
  // world = Rx(-90°)：局部 (0,0,2) 枢轴 → 世界 (0,2,0)，局部炮线 (0,1,0) → 世界 (0,0,-1)。
  const pivotWorld = new Vector3(0, 2, 0)
  const gunDirection = new Vector3(0, 0, -1)
  const MAXD = 500

  it('rotation center unchanged AND camera on the gun axis at the user distance', () => {
    const pose = gunLine()
    const prevTarget = new Vector3(3, 1, 4)
    const prevCamera = prevTarget.clone().add(new Vector3(0, 0, 7)) // 用户距离 7m
    const placement = armorPresetViewPlacement(prevTarget, prevCamera, pose, MAXD)
    // 约束 1：旋转中心不动。
    expect(placement.target.distanceTo(prevTarget)).toBeCloseTo(0)
    // 约束 2：机位在炮轴线上（x=0, y=2 的竖线）→ 炮管正对镜头。
    expect(placement.position.x).toBeCloseTo(0, 9)
    expect(placement.position.y).toBeCloseTo(pivotWorld.y, 9)
    expect(placement.position.clone().sub(pivotWorld).dot(gunDirection)).toBeGreaterThan(0)
    // 距中心 = 用户距离（缩放层级保留）。
    expect(placement.position.distanceTo(prevTarget)).toBeCloseTo(7, 6)
  })

  it('zero user offset falls back to the preset stand-off distance (15m from center)', () => {
    const pose = gunLine()
    const prevTarget = new Vector3(3, 1, 4)
    const placement = armorPresetViewPlacement(prevTarget, prevTarget.clone(), pose, MAXD)
    expect(placement.target.distanceTo(prevTarget)).toBeCloseTo(0)
    expect(placement.position.distanceTo(prevTarget)).toBeCloseTo(15, 6)
    expect(placement.position.x).toBeCloseTo(0, 9)
  })

  it('unreachable (D < perp): center kept, camera on the axis at the safe station', () => {
    const pose = gunLine()
    // 中心 (50,2,0)：到炮轴垂距 50m > 用户距离 7m → 垂足不可达，取安全站位 15m。
    const prevTarget = new Vector3(50, 2, 0)
    const prevCamera = prevTarget.clone().add(new Vector3(0, 0, 7))
    const placement = armorPresetViewPlacement(prevTarget, prevCamera, pose, MAXD)
    expect(placement.target.distanceTo(prevTarget)).toBeCloseTo(0)
    expect(placement.position.x).toBeCloseTo(0, 9)
    expect(placement.position.y).toBeCloseTo(pivotWorld.y, 9)
    expect(placement.position.clone().sub(pivotWorld).dot(gunDirection)).toBeCloseTo(15, 6)
    expect(placement.position.distanceTo(prevTarget)).toBeGreaterThan(7)
  })

  it('station beyond OrbitControls maxDistance is not chosen (update() would break aiming)', () => {
    const pose = gunLine()
    // 中心 (600,2,0)：炮轴垂距 600m > maxDistance 500m——轴上任何站位都会被
    // controls.update() 拉回 500m 内而破坏指向 → 不摆位，保持用户当前取景。
    const prevTarget = new Vector3(600, 2, 0)
    const prevCamera = prevTarget.clone().add(new Vector3(0, 0, 7))
    const placement = armorPresetViewPlacement(prevTarget, prevCamera, pose, MAXD)
    expect(placement.target.distanceTo(prevTarget)).toBeCloseTo(0)
    expect(placement.position.distanceTo(prevCamera)).toBeCloseTo(0)
  })

  it('center behind the breech: exact user distance still solvable on the forward axis', () => {
    const pose = gunLine()
    // 中心在枢轴后方（proj = -3）：前向轴上仍有精确解 t = 4 → 距中心 7m。
    const prevTarget = new Vector3(0, 2, 3)
    const prevCamera = prevTarget.clone().add(new Vector3(0, 0, 7))
    const placement = armorPresetViewPlacement(prevTarget, prevCamera, pose, MAXD)
    expect(placement.target.distanceTo(prevTarget)).toBeCloseTo(0)
    expect(placement.position.x).toBeCloseTo(0, 9)
    expect(placement.position.y).toBeCloseTo(pivotWorld.y, 9)
    expect(placement.position.distanceTo(prevTarget)).toBeCloseTo(7, 6)
  })

  it('zero-length preset direction falls back to the full preset pose', () => {
    const pose = { target: new Vector3(1, 2, 3), position: new Vector3(1, 2, 3) }
    expect(armorPresetViewPlacement(new Vector3(0, 0, 0), new Vector3(5, 0, 0), pose, MAXD)).toBe(pose)
  })
})
