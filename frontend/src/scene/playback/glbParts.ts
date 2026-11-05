// GLB 部件收集 + 装配（#820 Wave B4B 自 playbackScene.collectGlbParts 原样出仓）：
// 只做节点选择、配置选择、枢轴原点链与 hullGroup 装配；姿态计算在 glbRig（SSOT）、
// 异步加载/cache/dispose 语义留在 playbackScene（loadGlb），本模块均为同步纯函数。
import * as THREE from 'three'
import type { Object3D } from 'three'

/** 资产平面 tank/{id}.json 的装配相关字段（WotBTools client-only：dump-tank-data 物化）。 */
export interface GlbStaticData {
  configs?: Array<{ turret_index: number; gun_index: number; gun_origin?: number[] }> | null
  model_origins?: { track?: number[]; turret?: number[] } | null
  initial_turret_rotation?: { pitch?: number; roll?: number; yaw?: number } | null
}

/** 变体选择（回放证据推断的 dense 索引；null = 走默认顶级配置）。 */
export interface GlbVariantSelection {
  turret_index: number | null
  gun_index: number | null
}

/** collectGlbParts 的装配产物（消费方：playbackScene 挂载 + poseGlbRig 每帧摆位）。 */
export interface GlbParts {
  /** 炮塔节点（固定战斗室车辆 = null） */
  turretNode: Object3D | null
  /** 炮管本体+炮盾节点（精确命名过滤后；组内其余节点是炮盾子树，见下） */
  gunNodes: Object3D[]
  /** 炮塔枢轴（track+turret，模型系） */
  tP: [number, number, number]
  /** 炮管枢轴（tP + 选中配置 gun_origin；无配置数据 = tP） */
  gP: [number, number, number]
  /** 车体挂点（底盘节点名不符时 = null，消费端回落整台刚体） */
  hullGroup: THREE.Group | null
  /** 本帧部件姿态（模型系），armor 网格同步用 */
  poseT: THREE.Matrix4
  poseG: THREE.Matrix4
  itr: { pitch?: number; roll?: number; yaw?: number } | null
}

/**
 * 炮塔/炮管驱动部件收集 + 枢轴原点链（track+turret / +gun_origin，models.pb 数据）。
 * 同一 GLB fixture 下可见性、层级、返回对象与后续 poseGlbRig 矩阵结果与原实现一致。
 */
export function collectGlbParts(model: Object3D, sd: GlbStaticData | null, sel: GlbVariantSelection | null): GlbParts | null {
  // 节点分组（装甲查看器 collectConfigNodes 同式）：gun_XX(+_mask 等) 按编号分组升序、
  // turret_XX 升序——与 build_configs 的 dense 索引序一致
  const byGroup = new Map<number, Object3D[]>(); const turrets: Object3D[] = []
  model.traverse(n => {
    const nm = n.name || ''
    const gm = nm.match(/^gun_(\d+)/)
    const tm = nm.match(/^turret_(\d+)$/)
    if (gm) { const g = parseInt(gm[1], 10); if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g)!.push(n) }
    else if (tm) turrets.push(n)
  })
  const gunGroups = Array.from(byGroup.keys()).sort((a, b) => a - b)
    .map(k => byGroup.get(k)!.sort((a, b) => ((a.name || '') < (b.name || '') ? -1 : 1)))
  // 原实现 `?.[0] | 0`：位运算把数字串强转数值（undefined→0），这里等价显式化
  const turretNo = (n: Object3D) => parseInt(n.name.match(/\d+/)?.[0] ?? '', 10) || 0
  turrets.sort((a, b) => (turretNo(a) - turretNo(b)))
  // 选中变体 = 回放证据推断的 dense 索引（缺省 = 顶级配置），其余隐藏
  const cfgs = (sd && sd.configs && sd.configs.length) ? sd.configs : null
  const gi = (sel && sel.gun_index != null) ? sel.gun_index
    : (cfgs ? cfgs[cfgs.length - 1].gun_index : 0)
  const ti = (sel && sel.turret_index != null) ? sel.turret_index
    : (cfgs ? cfgs[cfgs.length - 1].turret_index : 0)
  gunGroups.forEach((grp, i) => grp.forEach(n => n.visible = (i === (gi % gunGroups.length))))
  turrets.forEach((n, i) => n.visible = (i === (ti % turrets.length)))
  const turretNode = turrets.length ? turrets[ti % turrets.length] : null
  // 摆位只取炮管本体+炮盾（精确命名）；组内其余节点（gun_XX_mask_nc 等）是炮盾子树，
  // 直接摆位会与父节点继承叠加成双重旋转（装甲查看器 gunBarrelNodes 同款过滤）
  const grp = gunGroups.length ? gunGroups[gi % gunGroups.length] : []
  const barrelNodes = grp.filter(n => /^gun_\d+(_mask)?$/.test(n.name || ''))
  const gunNodes = barrelNodes.length ? barrelNodes : grp
  const mo = sd && sd.model_origins
  if (!mo || !mo.track || !mo.turret) {
    console.warn('[playback] glb parts incomplete: turret=' + !!turretNode + ' origins=' + !!(mo && mo.track))
    return null
  }
  // 固定战斗室车辆（歼击车，实测资产包 44/735：T110E3/ISU-152/T28/SU-85/StuG…）
  // 客户端源模型**没有 turret_N 实体**——炮管组直接装在车体上，导出器按源场景图
  // 忠实导出（tools/export_tank_glb.py 不造节点）。摆位证据其实齐全：track/turret
  // 枢轴在 tank.json model_origins、炮管组在 GLB——照常挂载，炮塔横转由 poseGlbRig
  // 施加到炮管组（mG 本就 = mT·Rx(gr)，与客户端「TD 的炮塔 = 炮架横转」同构）。
  // 连炮管组都没有的模型无任何受姿部件，仍退代理车（fail-visible）。
  if (!turretNode && !gunNodes.length) {
    console.warn('[playback] GLB 部位不全，保留代理车（无炮塔且无炮管组）')
    return null
  }
  const tP: [number, number, number] = [mo.track[0] + mo.turret[0], mo.track[1] + mo.turret[1], mo.track[2] + mo.turret[2]]
  // 火炮枢轴用选中配置的 gun_origin（非默认顶级）
  const cfg = cfgs ? (cfgs.find(c => c.turret_index === ti && c.gun_index === gi) || cfgs[cfgs.length - 1]) : null
  const gP: [number, number, number] = (cfg && cfg.gun_origin)
    ? [tP[0] + cfg.gun_origin[0], tP[1] + cfg.gun_origin[1], tP[2] + cfg.gun_origin[2]]
    : [tP[0], tP[1], tP[2]]
  // —— __hullGroup：后续「逐轮贴地 + 履带分段」的挂点，当前恒归单位（不参与摆放）——
  // 底盘（`chassis_track_*` / `chassis_wheel_*`，实测 200/200 辆坦克 GLB 都有）按名字
  // 分离出车体子树：车体进 hullGroup（identity ⇒ 与拆分前逐像素等价），底盘留根上。
  // 客户端里车体 = 记录位姿、底盘由 `Suspension*System` 按模型几何解算（逆向证据见
  // 上游 docs/tank-suspension-client-re.md），悬挂实现落地时在此挂点内摆残差。
  // 命名不符（未知模型）→ hullGroup=null，消费端回落整台刚体（fail-safe）。
  let hullGroup: THREE.Group | null = null
  const chassisNode = (() => {
    let hit: Object3D | null = null
    model.traverse((n) => {
      if (!hit && /^chassis_(track|wheel)_/i.test(n.name || '')) hit = n
    })
    // TS 窄化不识别 traverse 回调内的赋值（hit 被窄成 never/null），显式还原宽类型
    return hit as Object3D | null
  })()
  const modelRoot = chassisNode && chassisNode.parent ? chassisNode.parent : null
  if (modelRoot) {
    hullGroup = new THREE.Group()
    hullGroup.name = '__hullGroup'
    for (const child of [...modelRoot.children]) {
      if (/^chassis_(track|wheel)_/i.test(child.name || '')) continue
      hullGroup.add(child)
    }
    modelRoot.add(hullGroup)
  }
  return { turretNode, gunNodes, tP, gP, hullGroup,
           poseT: new THREE.Matrix4(), poseG: new THREE.Matrix4(),   // 本帧部件姿态（模型系），armor 网格同步用
           itr: (sd && sd.initial_turret_rotation) || null }
}
