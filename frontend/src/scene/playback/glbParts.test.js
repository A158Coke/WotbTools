import { describe, it, expect, vi, afterEach } from 'vitest'
import * as THREE from 'three'
import { collectGlbParts } from './glbParts.ts'

// 真实 THREE scene graph fixtures：节点命名与导出器产物一致（tools/export_tank_glb.py
// 不造节点，按客户端源场景图忠实导出——gun_NN 组挂 turret_NN，turret_NN 挂根；
// chassis_track/wheel_* 也挂根）。

// 子 mesh 命名不得命中 ^gun_\d / ^turret_\d（traverse 全树收集，真实 GLB 里
// 挂在 gun_NN 组下的部件不重复占用节点名——组本身就是被收集的节点）
const namedMesh = (name) => {
  const m = new THREE.Mesh(new THREE.BufferGeometry())
  m.name = name
  return m
}

/** 普通坦克：turret_01/turret_02 + gun_01/gun_02 组（gun_01 带 mask 子树）+ 底盘节点 */
function normalTank() {
  const root = new THREE.Group()
  const gun01 = new THREE.Group(); gun01.name = 'gun_01'
  gun01.add(namedMesh('m_barrel'))
  const gunMask = new THREE.Group(); gunMask.name = 'gun_01_mask'
  gunMask.add(namedMesh('m_mask'))
  gun01.add(gunMask)
  const gun02 = new THREE.Group(); gun02.name = 'gun_02'
  gun02.add(namedMesh('m_barrel2'))
  const t1 = new THREE.Group(); t1.name = 'turret_01'; t1.add(gun01)
  const t2 = new THREE.Group(); t2.name = 'turret_02'; t2.add(gun02)
  root.add(namedMesh('hull'), t1, t2)
  root.add(namedMesh('chassis_track_L'), namedMesh('chassis_track_R'))
  root.add(namedMesh('chassis_wheel_L_01'), namedMesh('chassis_wheel_R_01'))
  return root
}

/** 固定战斗室 TD：无 turret_N 实体，gun_01 直接挂根 */
function tdTank() {
  const root = new THREE.Group()
  const gun = new THREE.Group(); gun.name = 'gun_01'
  gun.add(namedMesh('m_barrel'))
  root.add(namedMesh('hull'), gun)
  root.add(namedMesh('chassis_track_L'), namedMesh('chassis_track_R'))
  return root
}

const origins = { track: [1, 2, 3], turret: [10, 20, 30] }
const sdOf = (extra = {}) => ({ model_origins: origins, configs: null, ...extra })

afterEach(() => vi.restoreAllMocks())

describe('collectGlbParts（普通坦克）', () => {
  it('缺省 sel + 无 configs → 顶级配置 = 最后一组的 dense 索引（这里只有一组）', () => {
    const model = normalTank()
    const p = collectGlbParts(model, sdOf(), null)
    expect(p).not.toBeNull()
    expect(p.turretNode.name).toBe('turret_01')
    // gun_01 本体 + 精确命名的炮盾 gun_01_mask 都进摆位集
    expect(p.gunNodes.map(n => n.name)).toEqual(['gun_01', 'gun_01_mask'])
    // 可见性：选中组/炮塔可见，其余隐藏
    expect(model.getObjectByName('turret_01').visible).toBe(true)
    expect(model.getObjectByName('turret_02').visible).toBe(false)
    expect(model.getObjectByName('gun_02').visible).toBe(false)
    // 枢轴链：tP = track+turret
    expect(p.tP).toEqual([11, 22, 33])
    // 无选中配置的 gun_origin → gP = tP 副本
    expect(p.gP).toEqual([11, 22, 33])
    expect(p.gP).not.toBe(p.tP)
    expect(p.itr).toBeNull()
    expect(p.poseT).toEqual(new THREE.Matrix4())
    expect(p.poseG).toEqual(new THREE.Matrix4())
  })

  it('configs 存在时 sel.gun_index 选组，gun_origin 进 gP', () => {
    const sd = {
      model_origins: origins,
      configs: [
        { turret_index: 0, gun_index: 0, gun_origin: [0, 1, 2] },
        { turret_index: 1, gun_index: 1, gun_origin: [0.5, 1.5, 2.5] },
      ],
    }
    const model = normalTank()
    const p = collectGlbParts(model, sd, { turret_index: 1, gun_index: 1 })
    expect(p.turretNode.name).toBe('turret_02')
    expect(p.gunNodes.map(n => n.name)).toEqual(['gun_02'])
    expect(model.getObjectByName('gun_01').visible).toBe(false)
    expect(model.getObjectByName('gun_02').visible).toBe(true)
    expect(p.gP).toEqual([11.5, 23.5, 35.5])
  })

  it('sel 传 null（如 v.def 无索引）→ 回退 configs 顶级', () => {
    const sd = {
      model_origins: origins,
      configs: [
        { turret_index: 0, gun_index: 0 },
        { turret_index: 1, gun_index: 1 },
      ],
    }
    const p = collectGlbParts(normalTank(), sd, { turret_index: null, gun_index: null })
    expect(p.turretNode.name).toBe('turret_02')
    expect(p.gunNodes.map(n => n.name)).toEqual(['gun_02'])
  })

  it('炮盾子树：摆位只取 gun_NN(+_mask)，其余 gun_XX_* 不进 gunNodes（避免双重旋转）', () => {
    const model = normalTank()
    const nc = new THREE.Group(); nc.name = 'gun_01_mask_nc'
    model.getObjectByName('gun_01').add(nc)
    const p = collectGlbParts(model, sdOf(), null)
    const names = p.gunNodes.map(n => n.name)
    expect(names).toEqual(['gun_01', 'gun_01_mask'])
    expect(names).not.toContain('gun_01_mask_nc')
  })

  it('组内无精确命名节点 → 回落整组（不丢受姿部件）', () => {
    const root = new THREE.Group()
    const gun = new THREE.Group(); gun.name = 'gun_01_weird'
    gun.add(namedMesh('m_barrel'))
    root.add(gun, namedMesh('hull'))
    const p = collectGlbParts(root, sdOf(), null)
    expect(p).not.toBeNull()
    expect(p.gunNodes.map(n => n.name)).toEqual(['gun_01_weird'])
  })

  it('__hullGroup：非底盘子树移入 hullGroup，底盘留根上，hullGroup 挂回根', () => {
    const model = normalTank()
    const p = collectGlbParts(model, sdOf(), null)
    const hg = model.getObjectByName('__hullGroup')
    expect(hg).not.toBeNull()
    expect(p.hullGroup).toBe(hg)
    const childNames = hg.children.map(c => c.name).sort()
    expect(childNames).toEqual(['hull', 'turret_01', 'turret_02'])
    // 底盘留根（被 hullGroup 排除）
    expect(model.children.map(c => c.name)).toContain('chassis_track_L')
    expect(model.children.map(c => c.name)).toContain('chassis_wheel_R_01')
  })

  it('底盘命名不符（未知模型）→ hullGroup=null（fail-safe 回落刚体）', () => {
    const root = new THREE.Group()
    const gun = new THREE.Group(); gun.name = 'gun_01'
    gun.add(namedMesh('m_barrel'))
    root.add(namedMesh('hull'), gun, namedMesh('bogey_left'))
    const p = collectGlbParts(root, sdOf(), null)
    expect(p).not.toBeNull()
    expect(p.hullGroup).toBeNull()
  })

  it('initial_turret_rotation 透传为 itr', () => {
    const sd = sdOf({ initial_turret_rotation: { pitch: 1 } })
    expect(collectGlbParts(normalTank(), sd, null).itr).toEqual({ pitch: 1 })
  })
})

describe('collectGlbParts（固定战斗室 TD）', () => {
  it('无 turret_N 实体但炮管组在 → 正常装配，turretNode=null（fallback 而非退代理车）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const model = tdTank()
    const p = collectGlbParts(model, sdOf(), null)
    expect(warn).not.toHaveBeenCalled()
    expect(p).not.toBeNull()
    expect(p.turretNode).toBeNull()
    expect(p.gunNodes.map(n => n.name)).toEqual(['gun_01'])
    expect(p.tP).toEqual([11, 22, 33])
  })

  it('连炮管组都没有（无受姿部件）→ 返回 null 退代理车（fail-visible）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const root = new THREE.Group()
    root.add(namedMesh('hull'))
    expect(collectGlbParts(root, sdOf(), null)).toBeNull()
    expect(warn).toHaveBeenCalledWith('[playback] GLB 部位不全，保留代理车（无炮塔且无炮管组）')
  })
})

describe('collectGlbParts（数据不全）', () => {
  it('缺失 model_origins（或 track/turret）→ null，不挂半装载 GLB', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(collectGlbParts(normalTank(), null, null)).toBeNull()
    expect(collectGlbParts(normalTank(), { model_origins: { track: [1, 2, 3] } }, null)).toBeNull()
    expect(collectGlbParts(normalTank(), {}, null)).toBeNull()
    expect(warn).toHaveBeenCalled()
  })
})

describe('collectGlbParts（节点顺序契约）', () => {
  it('turret 节点乱序出现 → 按编号升序分组（dense 索引语义，与出现顺序无关）', () => {
    const root = new THREE.Group()
    const gun = new THREE.Group(); gun.name = 'gun_01'
    gun.add(namedMesh('m_barrel'))
    const t3 = new THREE.Group(); t3.name = 'turret_03'; t3.add(namedMesh('m_t3'))
    const t1 = new THREE.Group(); t1.name = 'turret_01'; t1.add(gun)
    root.add(t3, t1)   // 乱序：03 在 01 前
    const p = collectGlbParts(root, sdOf(), { turret_index: 1, gun_index: 0 })
    expect(p.turretNode.name).toBe('turret_03')   // dense 索引 1 = 升序第二位
  })
})
