import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  aimedVehicle, armorEquipmentCoeffs, armorHighlightBlock, armorPosePart, armorWorldMatrix,
  authorShellAt, isSolidOccluder, mountedShell,
} from './armorHighlight.js'

const AP = { type: 'ap', penetration: 200, caliber: 100 }
const CONFIG = { shell_global_ids: [32362, 32618], shells: [AP, { type: 'ap_cr', penetration: 300 }], caliber: 105 }
const eligible = {
  targetTankId: 1, targetConfig: {}, authorConfig: CONFIG, shellId: 32362,
  targetEquipment: [], authorEquipment: [],
}

describe('authorShellAt', () => {
  const timeline = [{ t: 5, shell_id: 1 }, { t: 30, shell_id: 2 }, { t: 40, shell_id: 3 }]

  it('取时刻 t 及之前最新的确认值，边界含等号', () => {
    expect(authorShellAt(timeline, 5)).toBe(1)
    expect(authorShellAt(timeline, 29.99)).toBe(1)
    expect(authorShellAt(timeline, 30)).toBe(2)
    expect(authorShellAt(timeline, 999)).toBe(3)
  })

  it('首条之前与缺字段都是未知，不取首发弹种顶替', () => {
    expect(authorShellAt(timeline, 4.99)).toBeNull()
    expect(authorShellAt(undefined, 10)).toBeNull()
    expect(authorShellAt([], 10)).toBeNull()
  })
})

describe('mountedShell', () => {
  it('弹体无 caliber 时取该炮口径；不在弹表返回 null', () => {
    expect(mountedShell(CONFIG, 32362).caliber).toBe(100)
    expect(mountedShell(CONFIG, 32618).caliber).toBe(105)
    expect(mountedShell(CONFIG, 999)).toBeNull()
  })
})

describe('armorHighlightBlock（证据不足一律关闭）', () => {
  it('全部满足时放行', () => {
    expect(armorHighlightBlock(eligible)).toBeNull()
  })

  it.each([
    ['target_config_unknown', { targetConfig: null }],
    ['author_config_unknown', { authorConfig: null }],
    ['shell_unknown', { shellId: null }],
    ['shell_not_mounted', { shellId: 999 }],
    ['shell_type_unknown', { authorConfig: { ...CONFIG, shells: [{ type: 'mystery', caliber: 100 }] } }],
    ['caliber_unknown', { authorConfig: { shell_global_ids: [32362], shells: [{ type: 'ap' }] } }],
    ['equipment_unknown', { targetEquipment: undefined }],
    ['equipment_unknown', { authorEquipment: undefined }],
    ['dynamic_armor', { targetTankId: 17777 }],
  ])('%s', (reason, patch) => {
    expect(armorHighlightBlock({ ...eligible, ...patch })).toBe(reason)
  })
})

describe('armorEquipmentCoeffs', () => {
  it('校准弹按弹种口径、强化装甲只看目标', () => {
    expect(armorEquipmentCoeffs(AP, [103], [])).toEqual({ penMul: 1.06, thickMul: 1 })
    expect(armorEquipmentCoeffs({ type: 'he' }, [103], [110])).toEqual({ penMul: 1.07, thickMul: 1.04 })
    expect(armorEquipmentCoeffs(AP, [110], [103])).toEqual({ penMul: 1, thickMul: 1 })
  })
})

describe('aimedVehicle', () => {
  const box = new THREE.Box3(new THREE.Vector3(-2, -1, -3), new THREE.Vector3(2, 1, 3))
  const at = (x, z) => {
    const glb = new THREE.Object3D()
    glb.position.set(x, 0, z)
    glb.updateMatrixWorld(true)
    return { glb }
  }
  const origin = new THREE.Vector3(0, 0, 0)
  const forward = new THREE.Vector3(0, 0, 1)

  it('取视线上最近的一台，偏离包围盒不算', () => {
    const near = at(0, 50), far = at(0, 120), aside = at(30, 20)
    expect(aimedVehicle(origin, forward, [far, aside, near], () => box)).toBe(near)
    expect(aimedVehicle(origin, forward, [aside], () => box)).toBeNull()
  })
})

describe('isSolidOccluder', () => {
  const mesh = (material) => ({ material })

  it('不透明写深度的几何挡视线', () => {
    expect(isSolidOccluder(mesh({ transparent: false, depthWrite: true }))).toBe(true)
  })

  it('半透明、不写深度（天空/贴花）、植被都不挡；多材质一项不挡即排除', () => {
    expect(isSolidOccluder(mesh({ transparent: true }))).toBe(false)
    expect(isSolidOccluder(mesh({ depthWrite: false }))).toBe(false)
    expect(isSolidOccluder(mesh({ uniforms: { uFoliageClip: { value: 0 } } }))).toBe(false)
    expect(isSolidOccluder(mesh([{}, { transparent: true }]))).toBe(false)
  })

  it('镂空的硬表面按实心处理：宁可不着色也不穿墙', () => {
    expect(isSolidOccluder(mesh({ uniforms: { uAlphaCut: { value: 0.33 } } }))).toBe(true)
  })
})

describe('armor 姿态', () => {
  it('网格名决定跟随部件（含动态装甲 state 段）', () => {
    expect(armorPosePart('hull_armor_3')).toBe('hull')
    expect(armorPosePart('turret_01_state_01_armor_12')).toBe('turret')
    expect(armorPosePart('gun_02_armor_1')).toBe('gun')
  })

  it('世界矩阵 = 根 × 部件姿态 × 静止矩阵，顺序不可换', () => {
    const root = new THREE.Matrix4().makeTranslation(10, 0, 0)
    const pose = new THREE.Matrix4().makeRotationZ(Math.PI / 2)
    const rest = new THREE.Matrix4().makeTranslation(1, 0, 0)
    const p = new THREE.Vector3().applyMatrix4(armorWorldMatrix(root, pose, rest, new THREE.Matrix4()))
    expect(p.x).toBeCloseTo(10)
    expect(p.y).toBeCloseTo(1)
  })
})
