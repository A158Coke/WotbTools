
export const VIEWBOX = Object.freeze({ width: 320, height: 320 })

/**
 * @typedef {Object} TurretedVehicleModelAsset
 * @property {string} modelKey         集中静态 modelKey（kebab-case）
 * @property {'turreted'} kind         判别字段
 * @property {string} hull             hull.webp（texture-baked 高保真；固定 640×640 physical）
 * @property {string} turret           turret.webp（turret + mantlet + gun 刚性层；physical 尺寸可变）
 * @property {{x:number,y:number}} turretPivot  炮塔座圈 pivot（viewBox 绝对坐标，320 画布）
 * @property {TurretRaster} turretRaster        turret.webp 的 authoritative runtime geometry
 *     contract（尺寸/原点/枢轴全部由此字段给出，禁止假设 640×640）
 */

/**
 * @typedef {Object} TurretlessVehicleModelAsset
 * @property {string} modelKey         集中静态 modelKey（kebab-case）
 * @property {'turretless'} kind       判别字段
 * @property {string} hull             hull.webp（gun/mantlet/casemate 已 bake 进 hull）
 */

/**
 * @typedef {Object} TurretRaster
 * @property {number} logicalMinX  turret.webp 画布左缘在 320 logical viewBox 中的 x（可 <0：炮管溢出）
 * @property {number} logicalMinY  turret.webp 画布上缘在 320 logical viewBox 中的 y（可 <0）
 * @property {number} logicalMaxX  画布右缘 logical x（logicalMaxX - logicalMinX = pixelWidth / 2）
 * @property {number} logicalMaxY  画布下缘 logical y（logicalMaxY - logicalMinY = pixelHeight / 2）
 * @property {number} pixelWidth   turret.webp 实际 physical 宽度（px，可变，非固定 640）
 * @property {number} pixelHeight  turret.webp 实际 physical 高度（px，可变，非固定 640）
 * @property {number} pivotX       turretPivot 相对 raster 原点（logicalMinX/Y）的 image-local x
 * @property {number} pivotY       turretPivot 相对 raster 原点（logicalMinX/Y）的 image-local y
 */

/**
 * 严格 discriminated union：turreted 必须带 turret + turretPivot + turretRaster；
 * turretless 禁止带 turret / turretPivot / turretRaster（validator 会拒绝非法组合）。
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
 * @property {{method:string, viewBox:string, hullPhysicalPixelSize?:number[], hullBounds?:object, turretBounds?:object, gunBounds?:object, selectedModules?:object, texturesUsed?:string[], desaturate?:number, notes?:string, fidelity?:string, geometryScale?:string, visibleDetailRetentionTarget?:number, detailMethod?:string, detailThresholds?:object}} generation
 *     生成审计数据；turretRaster 是 authoritative runtime geometry contract，只存在于顶层（禁止重复）
 *     hullPhysicalPixelSize = hull.webp 固定 physical 尺寸 [640,640]（turret 尺寸请读 turretRaster，
 *     不得从 generation 推断——turret.webp 是 variable-size canvas）
 *     method 必填（正式资产必须 'blitzkit-model-topdown-texture-bake'）
 *     Source-faithful PBR 契约（正式资产强制）：fidelity='high' / geometryScale='faithful'；
 *     visibleDetailRetentionTarget ∈ (0,1] 仅为 visual QA target（非 geometric-detail-retention
 *     guarantee——几何上限 = BlitzKit/WoTB LOD0 source）
 */

export const METADATA_KEYS = Object.freeze([
  'modelKey',
  'kind',
  'source',
  'turretPivot',
  'turretRaster',
  'generation',
])

export const SOURCE_PROVIDER_BLITZKIT = 'blitzkit'

export const GENERATION_METHOD_TEXTURE_BAKE = 'blitzkit-model-topdown-texture-bake'

export const ASSET_FILES = Object.freeze({
  hull: 'hull.webp',
  turret: 'turret.webp',
  metadata: 'metadata.json',
  bakeReport: 'bake-report.json',
})

export const MODEL_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function blitzkitIconUrl(tankId) {
  return `https://api.blitzkit.app/tanks/${tankId}/icons/big.webp`
}