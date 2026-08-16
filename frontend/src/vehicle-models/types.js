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
 * @property {string} hull             hull.svg（turret + 完整炮管为刚性 turret 层）
 * @property {string} turret           turret.svg
 * @property {{x:number,y:number}} turretPivot  炮塔座圈 pivot（viewBox 绝对坐标）
 */

/**
 * @typedef {Object} TurretlessVehicleModelAsset
 * @property {string} modelKey         集中静态 modelKey（kebab-case）
 * @property {'turretless'} kind       判别字段
 * @property {string} hull             hull.svg（gun 直接属于 hull）
 */

/**
 * 严格 discriminated union：turreted 必须带 turret + turretPivot；
 * turretless 禁止带 turret / turretPivot（validator 会拒绝非法组合）。
 * @typedef {TurretedVehicleModelAsset | TurretlessVehicleModelAsset} VehicleModelAsset
 */

/**
 * 单车型 metadata.json 契约（docs/assets/tier-x-models/svg-generation-spec.md）。
 * 必填：modelKey / kind / blitzkitReference；turreted 必须 turretPivot。
 * 视觉字段（distinctiveFeatures 等）由 ChatGPT 生成资产时填写，可先为空。
 *
 * @typedef {Object} VehicleModelMetadata
 * @property {string} modelKey                    必须与所在目录名一致
 * @property {'turreted'|'turretless'} kind       必须与 mapping.js 中该 modelKey 一致
 * @property {string} blitzkitReference           BlitzKit 参考 URL / identifier（空串仅允许 sample）
 * @property {{x:number,y:number}} [turretPivot]  turreted 必填；x/y ∈ [0, VIEWBOX]
 * @property {string[]} [distinctiveFeatures]     3–5 个最有辨识价值的 top-down 特征
 * @property {string[]} [intentionalExaggeration] 为 20–30px 做过的刻意夸张
 * @property {string} [generationNotes]           车型特异生成说明
 * @property {string[]} [mustKeepStructures]      必须保留/禁止丢失的结构
 */

/** metadata.json 允许的顶层键（多余键视为契约违反，防漂移）。 */
export const METADATA_KEYS = Object.freeze([
  'modelKey',
  'kind',
  'blitzkitReference',
  'turretPivot',
  'distinctiveFeatures',
  'intentionalExaggeration',
  'generationNotes',
  'mustKeepStructures',
])

/** 资产目录内允许出现的文件（gun 禁止独立 layer，故无 gun.svg）。 */
export const ASSET_FILES = Object.freeze({
  hull: 'hull.svg',
  turret: 'turret.svg',
  metadata: 'metadata.json',
})

/** modelKey 命名约定：kebab-case（小写字母/数字/连字符）。 */
export const MODEL_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** BlitzKit 参考图 URL（已验证：api.blitzkit.app/tanks/{tankId}/icons/big.webp）。 */
export function blitzkitIconUrl(tankId) {
  return `https://api.blitzkit.app/tanks/${tankId}/icons/big.webp`
}
