// 场景装配规则表（SSOT）：3D 运行时（playbackScene）与俯视烘焙（scripts/bake-ground-overhead.mjs）
// 共用**同一份判定**。两侧各自保留装载脚手架，但"剔不剔/算不算水面"只此一份，守卫锁定。
//
// 2026-10-14 抽层动因（漂移事故）：运行时的"水面语义优先"修复（材质 `extras.water` 权威、
// 节点名仅旧包回退——名字启发式曾把水塔 `bld_er_water_tower_pbr` 误判成水面退回受光材质，
// 2026-10-09 用户报障）**没有同步到俯视烘焙**：烘焙自持一份 `/water|sea|river|lake/i` 名字
// 剔除，两个方向都出错（36 图 census 实测）——
//   ① 过剔除：水塔/水罐建筑 ~35 个（12 图）、`env_searchlight.sc2`（"sea"rchlight 子串）10 个
//      被从俯视底图剔除；
//   ② 漏剔除：`skit_ocean.sc2`/`port_ocean.sc2`（"ocean" 不被任何 token 命中）、malinovka
//      25 块浮冰 `env_ma_ice02_*`（water 标记、名字不含水词）被当固体烘进底图。
import { isWaterName } from './sceneryMaterials.js'

/** 新包判据：`asset.extras.surfaceFlags`（导出器 2026-10-09 起写入）——材质级 water 标记为权威。 */
export function strictSurfacesOf(gltfScene) {
  return !!(gltfScene && gltfScene.userData && gltfScene.userData.surfaceFlags)
}

/** 材质级水面标记（`extras.water`；材质或材质数组，取首个——数组是 GLTFLoader 的多材质网格）。 */
export function materialIsWater(mat) {
  const m0 = Array.isArray(mat) ? mat[0] : mat
  return !!(m0 && m0.userData && m0.userData.water)
}

/** 材质级天空标记（`extras.sky`；材质或材质数组，任一命中）。 */
export function materialHasSky(mat) {
  const ms = Array.isArray(mat) ? mat : [mat]
  return ms.some((m) => !!(m && m.userData && m.userData.sky))
}

/** 整份材质组都是天空语义（多材质网格按 group 共享一个节点；混合组无法安全拆分
 *  无限远/普通两种投影，按 fail-closed 整件当普通网格处理，避免把普通 group 投到
 *  无限远或让烘焙丢掉整件）。 */
export function materialAllSky(mat) {
  const ms = Array.isArray(mat) ? mat : [mat]
  return ms.length > 0 && ms.every((m) => !!(m && m.userData && m.userData.sky))
}

/** 场景里是否存在任何 sky 语义标记（新包由导出器按 Skyobject 材质写入）。
 *  存在时天空判据只认材质标记；整份 GLB 都没有标记（旧包）才允许名字 fallback。 */
export function sceneHasSkyFlags(root) {
  let found = false
  const walk = (o) => {
    if (found || !o) return
    if (o.isMesh && materialHasSky(o.material)) { found = true; return }
    for (const c of o.children || []) walk(c)
  }
  walk(root)
  return found
}

/** 水面语义判定：新包看材质标记，旧包回退节点名启发式（含 fountain）。 */
export function isWaterNode(name, mat, { strictSurfaces }) {
  if (!strictSurfaces) return isWaterName(name)
  return materialIsWater(mat)
}

/** 旧包天空壳名字 fallback（新包用 `isSkyShell` 的材质 extras.sky 判据）。
 *
 *  ⚠️ 2026-10-14 收窄（用户报障"顶棚类构件没渲染"）：此前词表为
 *  `/sky|dome|loonar|spacedome|stars/i`，把**地图上的穹顶建筑/舱室**一并剔除——实测
 *  faust 13 件 `env_fa_dome01..04.sc2`（圆顶建筑）+ moon 3 件（`loonar_module.sc2` 12 m
 *  月面舱室、`spacedome.sc2` 120 m 穹顶）被当天空壳丢掉；而运行时（无此词表）正常渲染
 *  它们，两端口径分离。真正**覆盖全图幅**的大件（plant_surroundings_*、
 *  grossberg surroundings、erlenberg mountain_1..3 与 land_main1、lumber clouds 等）运行时本就
 *  渲染——烘焙 2026-10-14 起同样保留（此前"≥90% 图幅"几何剔除会把它们整块剔掉，露出可玩
 *  区外客户端 colormap 的暗色边带 = 用户报的"米德尔堡右上角黑块"；探针实证保留后该处
 *  恢复山体）。 */
export function isSkyShellName(name) {
  return /sky/i.test(name || '')
}

/** 天空语义判定：新包（存在 sky 标记）只认材质 `extras.sky`；旧包回退节点名。 */
export function isSkyShell(name, mat, { skyFlagsAvailable = false } = {}) {
  // 新包只要存在 sky 标记就按材质语义判定；`strictSurfaces` 属于水面判定，不得把天空
  // 退回节点名（否则烘焙与 3D 运行时会保留/剔除不同的网格）。多材质网格必须整组
  // 命中才走天空路径（混合组见 materialAllSky 的 fail-closed 说明）。
  if (skyFlagsAvailable) return materialAllSky(mat)
  return isSkyShellName(name)
}

/** 非完好态可破坏件（`D_` 前缀 / `State N`，N≥1，与旧烘焙正则逐字同式）：
 *  烘焙只烘当前完好态；运行时按回放时刻切换（不走此判定）。 */
export function isNonIntactStateName(name) {
  return /^D_|State ?[1-9]/i.test(name || '')
}

/**
 * 俯视烘焙的节点剔除判定（SSOT）。
 *
 * 语义优先：**水面按 `isWaterNode`、天空按 `isSkyShell`**（strict 包 = 材质标记）——名字只作
 * 旧包天空 fallback，与"非完好态/隐形/图幅壳"这类烘焙专有策略，**不参与水面判定**。
 *
 * `keepWater`（2026-10-14，地面 pass 落地后）：烘焙接管地面渲染（`cm×lm×tile/mask` 实时
 * 合成，见 groundPass.js），底图不再由客户端地图图的水系配色承担 ⇒ 水语义件**渲染**而非
 * 剔除（与 3D 运行时同源）。此时天空壳名字检查也让位于水材质标记——NewBay 海面
 * `SkySeaSurface.sc2` 名字含 "sky"、材质却是客户端水材质，运行时会渲染它（语义先于名字），
 * 烘焙必须同判，否则该图海面系统性缺失。`keepWater:false`（缺省）= 旧口径（水件一律不烘）。
 *
 * ⚠️ 2026-10-14 删除 `surroundings|^plane` 名字分支（用户报障同批）：该启发式源自旧烘焙、
 * 运行时并无此剔除，实测把运行时正常渲染的地形块/小件一并剔掉——lumber `Plane017/020/022`
 * （229–363 m 山体）、italy `Plane0xx`（23 件）、rock `Plane002..004`（11–14 m 岩石）、
 * rudniki/skit `plane.sc2`（26–46 件、1–2 m）。真正的整幅壳（plant_surroundings_*、
 * grossberg/surroundings、canal、lumber clouds、erlenberg mountain_1..3 等）运行时全部渲染，
 * 烘焙同样保留（不作为剔除项）；按名/按图幅再剔只会过剔。
 *
 * `mdVariant`（跨变体标记节点）另算。
 */
export function bakeDropNode(name, mat, {
  strictSurfaces, mdVariant = false, keepWater = false, skyFlagsAvailable = false,
} = {}) {
  if (mdVariant) return true
  if (isNonIntactStateName(name)) return true
  if (/invisible/i.test(name || '')) return true
  if (!keepWater && isWaterNode(name, mat, { strictSurfaces })) return true
  if (isSkyShell(name, mat, { strictSurfaces, skyFlagsAvailable }) && !materialIsWater(mat)) return true
  return false
}
