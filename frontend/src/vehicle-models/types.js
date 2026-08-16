/**
 * Tier X 专属俯视车型系统 — 类型契约（discriminated union）。
 *
 * 正式资产 = Source-faithful PBR top-view WebP asset（640×640 physical / 320×320 logical，
 * viewBox 见 VIEWBOX）；0° = hull 车头朝 12 点、turret/gun 朝车体正前；
 * hull 绕画布中心旋转；turret 使用车型真实 turret-ring pivot（viewBox 绝对坐标）；
 * turretless 车型禁止伪造 turret 层。旧 SVG 仅为 debug/reference（extractor CLI 输出）。
 *
 * 本文件只放纯类型/常量，不依赖 Vue、不读文件——
 * 供运行时、validator（vitest）与 CLI 脚本共用。
 */

/** 统一逻辑 viewBox（所有正式车型固定；physical 渲染 640×640）。 */
export const VIEWBOX = Object.freeze({ width: 320, height: 320 })

/**
 * @typedef {Object} TurretedVehicleModelAsset
 * @property {string} modelKey         集中静态 modelKey（kebab-case）
 * @property {'turreted'} kind         判别字段
 * @property {string} hull             hull.webp（texture-baked 高保真）
 * @property {string} turret           turret.webp（turret + mantlet + gun 刚性层）
 * @property {{x:number,y:number}} turretPivot  炮塔座圈 pivot（viewBox 绝对坐标）
 */

/**
 * @typedef {Object} TurretlessVehicleModelAsset
 * @property {string} modelKey         集中静态 modelKey（kebab-case）
 * @property {'turretless'} kind       判别字段
 * @property {string} hull             hull.webp（gun/mantlet/casemate 已 bake 进 hull）
 */

/**
 * 严格 discriminated union：turreted 必须带 turret + turretPivot；
 * turretless 禁止带 turret / turretPivot（validator 会拒绝非法组合）。
 * @typedef {TurretedVehicleModelAsset | TurretlessVehicleModelAsset} VehicleModelAsset
 */

/**
 * 单车型 metadata.json 契约（Source-faithful PBR top-view asset）。
 * 视觉信息必须来自 BlitzKit 真实模型 LOD0 geometry + 内嵌材质/纹理
 * （source.provider === 'blitzkit'，validator 强制）；人工 notes 只允许作为 QA 记录。
 *
 * @typedef {Object} VehicleModelMetadata
 * @property {string} modelKey                         必须与所在目录名一致
 * @property {'turreted'|'turretless'} kind            必须与 mapping.js 中该 modelKey 一致
 * @property {{provider:string, tankId:number, modelGlb:string, modelDefinitions:string}} source
 *     provider 必填（正式资产必须 'blitzkit'）；tankId 必填；modelGlb = 视觉 model.glb URL
 *     （非 collision.glb）；modelDefinitions = models.pb URL
 * @property {{x:number,y:number}} [turretPivot]       turreted 必填；x/y ∈ [0, VIEWBOX]
 * @property {{logicalMinX:number, logicalMinY:number, logicalMaxX:number, logicalMaxY:number, pixelWidth:number, pixelHeight:number, pivotX:number, pivotY:number}} [turretRaster]
 *     turreted 必填（raster overflow contract）：turret.webp 画布 = turret+mantlet+完整 gun 的
 *     logical bounds（可超出 320 画布，避免炮管裁切）；pivotX/pivotY = turretPivot 在 turret.webp
 *     内（相对 raster 原点）的逻辑坐标
 * @property {{method:string, viewBox:string, physicalPixelSize?:number[], hullBounds?:object, turretBounds?:object, gunBounds?:object, selectedModules?:object, texturesUsed?:string[], desaturate?:number, notes?:string, fidelity?:string, geometryScale?:string, visibleDetailRetentionTarget?:number, detailMethod?:string, detailThresholds?:object}} generation
 *     生成审计数据；turretRaster 是 authoritative runtime geometry contract，只存在于顶层（禁止重复）
 *     method 必填（正式资产必须 'blitzkit-model-topdown-texture-bake'）
 *     Source-faithful PBR 契约（正式资产强制）：fidelity='high' / geometryScale='faithful'；
 *     visibleDetailRetentionTarget ∈ (0,1] 仅为 visual QA target（非 geometric-detail-retention
 *     guarantee——几何上限 = BlitzKit/WoTB LOD0 source）
 */

/** metadata.json 允许的顶层键（多余键视为契约违反，防漂移）。 */
export const METADATA_KEYS = Object.freeze([
  'modelKey',
  'kind',
  'source',
  'turretPivot',
  'turretRaster',
  'generation',
])

/** 正式几何来源 provider（extractor 生成）。 */
export const SOURCE_PROVIDER_BLITZKIT = 'blitzkit'

/** 正式生成方法（texture bake 生成，PR1 正式契约）。 */
export const GENERATION_METHOD_TEXTURE_BAKE = 'blitzkit-model-topdown-texture-bake'

/**
 * 正式资产目录契约（raster-backed high-fidelity）：
 * - hull.webp / turret.webp（turreted）：RGBA WebP，640×640 physical / 320×320 logical；
 * - metadata.json：Source-faithful PBR top-view asset 契约；
 * - bake-report.json：生成记录（developer QA，validator 要求存在）。
 * 旧 hull.svg / turret.svg 不再属于正式契约（extractor 输出到 gitignored debug 目录）。
 */
export const ASSET_FILES = Object.freeze({
  hull: 'hull.webp',
  turret: 'turret.webp',
  metadata: 'metadata.json',
  bakeReport: 'bake-report.json',
})

/** modelKey 命名约定：kebab-case（小写字母/数字/连字符）。 */
export const MODEL_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** BlitzKit 参考图 URL（已验证：api.blitzkit.app/tanks/{tankId}/icons/big.webp）。 */
export function blitzkitIconUrl(tankId) {
  return `https://api.blitzkit.app/tanks/${tankId}/icons/big.webp`
}