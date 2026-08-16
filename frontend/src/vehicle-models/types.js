/**
 * Tier X 专属俯视车型系统 — 类型契约（discriminated union）。
 *
 * 概念（docs/assets/tier-x-models/svg-generation-spec.md）：
 * - 所有正式车型 SVG 使用统一 viewBox（见 VIEWBOX）；
 * - 0° = hull 车头朝 12 点、turret/gun 朝车体正前；
 * - hull 中心 = viewBox 中心；hull 绕画布中心旋转；
 * - turret 使用车型真实 turret-ring pivot（viewBox 绝对坐标）；
 * - turretless 车型禁止伪造 turret 层。
 *
 * 本文件只放纯类型/常量，不依赖 Vue、不读文件——
 * 供运行时、validator（vitest）与 CLI 脚本共用。
 */

/** 统一 SVG viewBox（所有正式车型固定）。 */
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
 * 单车型 metadata.json 契约（geometry-source schema，任务 12）。
 * 几何必须来自 BlitzKit 真实模型（source.provider === 'blitzkit'，validator 强制）；
 * 人工 notes 只允许作为 QA 记录，不参与几何。
 *
 * @typedef {Object} VehicleModelMetadata
 * @property {string} modelKey                         必须与所在目录名一致
 * @property {'turreted'|'turretless'} kind            必须与 mapping.js 中该 modelKey 一致
 * @property {{provider:string, tankId:number, collisionModel:string, modelDefinitions:string}} source
 *     provider 必填（正式资产必须 'blitzkit'）；tankId 必填；两个 URL 记录数据源
 * @property {{x:number,y:number}} [turretPivot]       turreted 必填；x/y ∈ [0, VIEWBOX]
 * @property {{method:string, viewBox:string, physicalPixelSize?:number[], hullBounds?:object, turretBounds?:object, gunBounds?:object, selectedModules?:object, texturesUsed?:string[], desaturate?:number, notes?:string, fidelity?:string, geometryScale?:string, visibleDetailRetentionTarget?:number, detailMethod?:string, detailThresholds?:object}} generation
 *     method 必填（正式资产必须 'blitzkit-model-topdown-texture-bake'）
 *     Source-faithful PBR top-view asset 契约（正式资产强制）：fidelity='high' /
 *     geometryScale='faithful' / visibleDetailRetentionTarget ∈ (0,1]（contract target，非测量值）
 */

/** metadata.json 允许的顶层键（多余键视为契约违反，防漂移）。 */
export const METADATA_KEYS = Object.freeze([
  'modelKey',
  'kind',
  'source',
  'turretPivot',
  'generation',
])

/** 正式几何来源 provider（extractor 生成）。 */
export const SOURCE_PROVIDER_BLITZKIT = 'blitzkit'

/** 正式生成方法（texture bake 生成，PR1 正式契约）。 */
export const GENERATION_METHOD_TEXTURE_BAKE = 'blitzkit-model-topdown-texture-bake'

/** 旧 geometry-SVG 生成方法（仅 debug/reference；extractor CLI 输出）。 */
export const GENERATION_METHOD_EXTRACTION = 'blitzkit-model-topdown-extraction'

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