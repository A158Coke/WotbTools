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

  it('keeps the user pivot and distance, only adopting the gun-line direction', () => {
    const pose = gunLine()
    const prevTarget = new Vector3(0.4, 1.9, 0.2)
    const prevCamera = new Vector3(0.4, 1.6, -7)
    const placement = armorPresetViewPlacement(prevTarget, prevCamera, pose)
    const userDistance = prevCamera.distanceTo(prevTarget)
    expect(placement.target.equals(prevTarget)).toBe(true)
    expect(placement.position.distanceTo(prevTarget)).toBeCloseTo(userDistance)
    const gunDirection = pose.position.clone().sub(pose.target).normalize()
    expect(placement.position.clone().sub(prevTarget).normalize().distanceTo(gunDirection)).toBeCloseTo(0)
  })

  it('degenerate orbit offset adopts the preset distance instead of collapsing the camera', () => {
    const pose = gunLine()
    const prevTarget = new Vector3(1, 2, 3)
    const placement = armorPresetViewPlacement(prevTarget, prevTarget.clone(), pose)
    expect(placement.target.distanceTo(prevTarget)).toBeCloseTo(0)
    expect(placement.position.distanceTo(prevTarget)).toBeCloseTo(15)
  })

  it('zero-length preset direction falls back to the full preset pose', () => {
    const pose = { target: new Vector3(1, 2, 3), position: new Vector3(1, 2, 3) }
    const placement = armorPresetViewPlacement(new Vector3(), new Vector3(0, 0, -5), pose)
    expect(placement).toBe(pose)
  })
})
