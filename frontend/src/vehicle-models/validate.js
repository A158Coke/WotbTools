/**
 * Tier X 专属车型 — validator（纯逻辑，vitest 与 CLI 脚本共用）。
 *
 * 校验层次（docs/assets/tier-x-models/README.md「Validation」）：
 * 1. validateCoverage     — Tankopedia Tier X 100% mapping 覆盖 + mapping 完整性
 * 2. validateMetadata     — metadata.json 契约（含与 mapping 的 kind 一致性）
 * 3. validateSvgText      — SVG 技术契约（仅 Legacy/debug extractor 输出；正式资产无 SVG）
 * 4. validateModelEntry   — 单车型目录完整性（hull.webp 必填、turreted 必配 turret.webp +
 *                           turretPivot + turretRaster、turretless 禁止 turret、禁止多余文件）
 *
 * 设计：assets/ 下出现 metadata.json 即视为“资产已就位”，hull.webp（+turret.webp，turreted）
 * 必须同时完整——半成品目录会直接 FAIL，防止覆盖率静默退化。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  VIEWBOX,
  METADATA_KEYS,
  ASSET_FILES,
  MODEL_KEY_PATTERN,
  SOURCE_PROVIDER_BLITZKIT,
  GENERATION_METHOD_TEXTURE_BAKE,
} from './types.js'

const ASSETS_DIR = fileURLToPath(new URL('./assets/', import.meta.url))

/** 简单 XML 结构检查：根元素 + 标签平衡（不引入 XML 解析依赖）。 */
export function validateSvgText(svgText) {
  const errors = []
  if (typeof svgText !== 'string' || svgText.trim() === '') {
    return ['SVG 内容为空']
  }
  const open = (svgText.match(/<svg[\s>]/g) || []).length
  const close = (svgText.match(/<\/svg>/g) || []).length
  if (open !== 1 || close !== 1) {
    errors.push(`SVG 根元素不平衡（open=${open}, close=${close}）`)
  }
  const viewBoxMatch = svgText.match(/viewBox\s*=\s*"([^"]+)"/)
  const expected = `0 0 ${VIEWBOX.width} ${VIEWBOX.height}`
  if (!viewBoxMatch) {
    errors.push('缺少 viewBox 属性')
  } else if (viewBoxMatch[1].replace(/\s+/g, ' ').trim() !== expected) {
    errors.push(`viewBox 必须为 ${expected}，实际 "${viewBoxMatch[1]}"`)
  }
  for (const forbidden of ['<script', '<foreignObject', 'xlink:href', 'onload=', 'onerror=', '<image']) {
    if (svgText.includes(forbidden)) {
      errors.push(`SVG 包含禁止元素/属性：${forbidden}`)
    }
  }
  const externalHref = svgText.match(/href\s*=\s*"https?:\/\//)
  if (externalHref) {
    errors.push('SVG 禁止外部 href 引用')
  }
  return errors
}

/**
 * metadata.json 契约校验（Source-faithful PBR top-view asset）。
 * expectedKind 来自 mapping（null = 非映射目录）。
 * 正式资产（mapping 内 modelKey）强制 source.provider === 'blitzkit'。
 */
export function validateMetadata(meta, { modelKey, expectedKind = null }) {
  const errors = []
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return ['metadata 不是对象']
  }
  const unknownKeys = Object.keys(meta).filter((k) => !METADATA_KEYS.includes(k))
  if (unknownKeys.length > 0) {
    errors.push(`metadata 含未契约键：${unknownKeys.join(', ')}`)
  }
  if (meta.modelKey !== modelKey) {
    errors.push(`modelKey 必须与目录名一致：${JSON.stringify(meta.modelKey)} !== ${modelKey}`)
  }
  if (meta.kind !== 'turreted' && meta.kind !== 'turretless') {
    errors.push(`kind 必须为 turreted/turretless，实际 ${JSON.stringify(meta.kind)}`)
  } else if (expectedKind && meta.kind !== expectedKind) {
    errors.push(`metadata.kind=${meta.kind} 与 mapping ${modelKey}.kind=${expectedKind} 不一致`)
  }
  // —— source（BlitzKit 数据源契约：视觉 model.glb + models.pb）——
  const src = meta.source
  if (!src || typeof src !== 'object') {
    errors.push('metadata 必须提供 source（几何来源）')
  } else {
    if (typeof src.provider !== 'string' || src.provider === '') {
      errors.push('source.provider 必须为非空字符串')
    } else if (expectedKind && src.provider !== SOURCE_PROVIDER_BLITZKIT) {
      errors.push(`正式资产（mapping 内）source.provider 必须为 blitzkit，实际 ${JSON.stringify(src.provider)}`)
    }
    if (src.provider === SOURCE_PROVIDER_BLITZKIT) {
      // 正式 blitzkit 资产：tankId + 数据源 URL 必填
      if (!Number.isInteger(src.tankId) || src.tankId <= 0) {
        errors.push('source.tankId 必须为正整数')
      }
      for (const urlKey of ['modelGlb', 'modelDefinitions']) {
        const u = src[urlKey]
        if (typeof u !== 'string' || u === '') {
          errors.push(`source.${urlKey} 必须为非空字符串`)
        } else {
          try {
            const url = new URL(u)
            if (!/^https?:$/.test(url.protocol)) errors.push(`source.${urlKey} 必须为 http(s) URL`)
          } catch {
            errors.push(`source.${urlKey} 不是合法 URL：${u}`)
          }
        }
      }
    }
  }
  // —— generation（生成记录）——
  const gen = meta.generation
  if (!gen || typeof gen !== 'object') {
    errors.push('metadata 必须提供 generation（生成记录）')
  } else {
    if (typeof gen.method !== 'string' || gen.method === '') {
      errors.push('generation.method 必须为非空字符串')
    } else if (expectedKind && gen.method !== GENERATION_METHOD_TEXTURE_BAKE) {
      errors.push(`正式资产 generation.method 必须为 ${GENERATION_METHOD_TEXTURE_BAKE}，实际 ${JSON.stringify(gen.method)}`)
    }
    if (typeof gen.viewBox !== 'string') {
      errors.push('generation.viewBox 必须为字符串')
    }
    if (gen.notes !== undefined && typeof gen.notes !== 'string') {
      errors.push('generation.notes 必须为字符串')
    }
    // turretRaster 是 authoritative runtime geometry contract，只允许在顶层——
    // generation 内重复出现视为 schema 漂移（PR2 用顶层做 asset positioning）
    if (gen.turretRaster !== undefined) {
      errors.push('generation 内禁止 turretRaster（authoritative 契约只在顶层 metadata.turretRaster）')
    }
    // Source-faithful PBR 契约（正式资产强制）：fidelity=high、geometryScale=faithful；
    // visibleDetailRetentionTarget ∈ (0,1] 仅为 visual QA target（非 geometric-detail-retention
    // guarantee——几何上限 = BlitzKit/WoTB LOD0 source）
    if (expectedKind) {
      if (gen.fidelity !== 'high') {
        errors.push('正式资产 generation.fidelity 必须为 "high"（HIGH-FIDELITY ASSET）')
      }
      if (gen.geometryScale !== 'faithful') {
        errors.push('正式资产 generation.geometryScale 必须为 "faithful"（真实比例，无夸大）')
      }
      const t = gen.visibleDetailRetentionTarget
      if (typeof t !== 'number' || !(t > 0 && t <= 1)) {
        errors.push('正式资产 generation.visibleDetailRetentionTarget 必须在 (0,1]')
      }
    }
  }
  // —— turretRaster（raster overflow contract：炮管超出 320 画布的 turret 资产）——
  if (meta.kind === 'turreted') {
    const r = meta.turretRaster
    if (!r || typeof r !== 'object') {
      errors.push('turreted 必须提供 turretRaster（raster overflow contract）')
    } else {
      for (const key of ['logicalMinX', 'logicalMinY', 'logicalMaxX', 'logicalMaxY', 'pixelWidth', 'pixelHeight', 'pivotX', 'pivotY']) {
        if (typeof r[key] !== 'number' || !Number.isFinite(r[key])) {
          errors.push(`turretRaster.${key} 必须为有限数字`)
        }
      }
      if (typeof r.pixelWidth === 'number' && r.pixelWidth <= 0) errors.push('turretRaster.pixelWidth 必须 > 0')
      if (typeof r.pixelHeight === 'number' && r.pixelHeight <= 0) errors.push('turretRaster.pixelHeight 必须 > 0')
      // pivot 是 image-local 逻辑坐标，必须落在 raster bounds 内（0..logicalW/H）
      if (typeof r.pivotX === 'number' && !(r.pivotX >= 0 && r.pivotX <= r.pixelWidth / 2 + 0.01)) {
        errors.push('turretRaster.pivotX 必须落在 image-local raster bounds 内（0..pixelWidth/2）')
      }
      if (typeof r.pivotY === 'number' && !(r.pivotY >= 0 && r.pivotY <= r.pixelHeight / 2 + 0.01)) {
        errors.push('turretRaster.pivotY 必须落在 image-local raster bounds 内（0..pixelHeight/2）')
      }
      // turretPivot（320 画布坐标）与 raster 数学映射一致：pivot = logicalMin + image-local pivot
      const pv = meta.turretPivot
      if (pv && typeof pv.x === 'number' && typeof pv.y === 'number' && typeof r.logicalMinX === 'number' && typeof r.pivotX === 'number') {
        if (Math.abs(pv.x - (r.logicalMinX + r.pivotX)) > 0.11) {
          errors.push('turretPivot.x(' + pv.x + ') 与 turretRaster 映射不一致（logicalMinX+pivotX=' + (r.logicalMinX + r.pivotX).toFixed(2) + '）')
        }
        if (Math.abs(pv.y - (r.logicalMinY + r.pivotY)) > 0.11) {
          errors.push('turretPivot.y(' + pv.y + ') 与 turretRaster 映射不一致（logicalMinY+pivotY=' + (r.logicalMinY + r.pivotY).toFixed(2) + '）')
        }
      }
    }
  } else if (meta.turretRaster !== undefined) {
    errors.push('turretless 禁止 turretRaster')
  }
  // —— turretPivot ——
  if (meta.kind === 'turreted') {
    const p = meta.turretPivot
    if (!p || typeof p !== 'object') {
      errors.push('turreted 必须提供 turretPivot')
    } else {
      const { x, y } = p
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        errors.push(`turretPivot 必须为有限数字：${JSON.stringify(p)}`)
      } else {
        const maxX = VIEWBOX.width
        const maxY = VIEWBOX.height
        if (x < 0 || x > maxX || y < 0 || y > maxY) {
          errors.push(`turretPivot 超出 viewBox：${x},${y}（允许 0..${maxX},0..${maxY}）`)
        }
      }
    }
  } else if (meta.turretPivot !== undefined) {
    errors.push('turretless 禁止 turretPivot')
  }
  return errors
}

export function validateModelEntry({ modelKey, kind, files }) {
  const errors = []
  if (!MODEL_KEY_PATTERN.test(modelKey)) {
    errors.push(`modelKey 必须为 kebab-case：${modelKey}`)
  }
  if (kind !== null && kind !== 'turreted' && kind !== 'turretless') {
    errors.push(`kind 非法：${kind}`)
  }
  if (!files.metadata || files.metadata.trim() === '') {
    errors.push('metadata.json 缺失或为空')
  } else {
    let meta = null
    try {
      meta = JSON.parse(files.metadata)
    } catch (e) {
      errors.push(`metadata.json 不是合法 JSON：${e.message}`)
    }
    if (meta) errors.push(...validateMetadata(meta, { modelKey, expectedKind: kind }))
    // 非映射目录（kind=null，如 sample）用 metadata 自声明的 kind 继续做资产校验
    if (kind === null && meta && (meta.kind === 'turreted' || meta.kind === 'turretless')) {
      kind = meta.kind
    }
  }
  // 正式资产 = texture-baked webp（hull.webp 必填；turreted 必配 turret.webp）
  if (!files.hull || !isWebp(files.hull)) {
    errors.push('hull.webp 缺失或不是 WebP 二进制')
  }
  if (kind === 'turreted') {
    if (!files.turret || !isWebp(files.turret)) {
      errors.push('turreted 车型必须提供 turret.webp（WebP 二进制）')
    } else {
      // turretRaster.pixelWidth/pixelHeight 必须与实际 turret.webp 尺寸一致
      let meta2 = null
      try { meta2 = files.metadata ? JSON.parse(files.metadata) : null } catch { meta2 = null }
      const r = meta2?.turretRaster
      if (r && typeof r.pixelWidth === 'number' && typeof r.pixelHeight === 'number') {
        const d = webpDimensions(files.turret)
        if (d && (d.width !== r.pixelWidth || d.height !== r.pixelHeight)) {
          errors.push('turret.webp 尺寸 ' + d.width + 'x' + d.height + ' 与 turretRaster ' + r.pixelWidth + 'x' + r.pixelHeight + ' 不一致')
        }
      }
    }
  } else if (files.turret) {
    errors.push('turretless 车型禁止 turret.webp')
  }
  if (!files.bakeReport || files.bakeReport.trim() === '') {
    errors.push('bake-report.json 缺失或为空（生成记录契约）')
  } else {
    try {
      JSON.parse(files.bakeReport)
    } catch (e) {
      errors.push(`bake-report.json 不是合法 JSON：${e.message}`)
    }
  }
  if (files.extra && files.extra.length > 0) {
    errors.push(`目录含未契约文件（gun 禁止独立 layer）：${files.extra.join(', ')}`)
  }
  return errors
}

/** 解析 WebP 尺寸（VP8X/VP8/VP8L 头；失败返回 null）。 */
function webpDimensions(buf) {
  if (typeof buf !== 'string' || buf.length < 24) return null
  let off = 12
  while (off < buf.length - 8) {
    const tag = buf.slice(off, off + 4)
    const sz = buf.charCodeAt(off + 4) | (buf.charCodeAt(off + 5) << 8) | (buf.charCodeAt(off + 6) << 16) | (buf.charCodeAt(off + 7) << 24)
    if (tag === 'VP8X' && off + 20 < buf.length) {
      const w = 1 + (buf.charCodeAt(off + 12) | (buf.charCodeAt(off + 13) << 8) | (buf.charCodeAt(off + 14) << 16))
      const h = 1 + (buf.charCodeAt(off + 15) | (buf.charCodeAt(off + 16) << 8) | (buf.charCodeAt(off + 17) << 16))
      return { width: w, height: h }
    }
    if (tag === 'VP8 ' && off + 18 < buf.length) {
      const w = (buf.charCodeAt(off + 14) | (buf.charCodeAt(off + 15) << 8)) & 0x3fff
      const h = (buf.charCodeAt(off + 16) | (buf.charCodeAt(off + 17) << 8)) & 0x3fff
      return { width: w, height: h }
    }
    off += 8 + sz + (sz & 1)
  }
  return null
}

/** WebP 魔数检查（RIFF....WEBP）。 */
function isWebp(buf) {
  return (
    typeof buf === 'string' &&
    buf.length >= 12 &&
    buf.slice(0, 4) === 'RIFF' &&
    buf.slice(8, 12) === 'WEBP'
  )
}

/** 读取 assets/<modelKey>/ 目录（缺失文件为 null；webp 按 latin1 读以便魔数检查）。 */
export function readModelDir(modelKey) {
  const dir = path.join(ASSETS_DIR, modelKey)
  const files = { hull: null, turret: null, metadata: null, bakeReport: null, extra: [] }
  let names = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return files // 目录不存在
  }
  for (const name of names) {
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) {
      files.extra.push(name + '/')
      continue
    }
    if (name === ASSET_FILES.hull) files.hull = fs.readFileSync(full, 'latin1')
    else if (name === ASSET_FILES.turret) files.turret = fs.readFileSync(full, 'latin1')
    else if (name === ASSET_FILES.metadata) files.metadata = fs.readFileSync(full, 'utf8')
    else if (name === ASSET_FILES.bakeReport) files.bakeReport = fs.readFileSync(full, 'utf8')
    else files.extra.push(name)
  }
  return files
}

/** 列出 assets/ 下所有子目录（modelKey）。 */
export function listModelKeys() {
  let names = []
  try {
    names = fs.readdirSync(ASSETS_DIR)
  } catch {
    return []
  }
  return names.filter((n) => fs.statSync(path.join(ASSETS_DIR, n)).isDirectory())
}

/**
 * Tier X 覆盖校验：tankopedia 全量 vs mapping。
 * 返回 { errors, stats }；errors 为空即通过。
 */
export function validateCoverage({ tankopedia, tankIdToModel, modelDefinitions }) {
  const errors = []
  const stats = { tankCount: 0, mappedCount: 0, modelKeyCount: Object.keys(modelDefinitions).length }
  if (!tankopedia || !Array.isArray(tankopedia.vehicles)) {
    return { errors: ['tankopedia 数据无效（缺 vehicles 数组）'], stats }
  }
  stats.tankCount = tankopedia.vehicles.length
  const tankopediaIds = new Set(tankopedia.vehicles.map((v) => String(v.id)))
  for (const v of tankopedia.vehicles) {
    const key = String(v.id)
    if (!tankIdToModel[key]) {
      errors.push(`Tier X ${v.id} ${v.name} 缺少 baseModelKey mapping（新增 Tier X 必须补 mapping）`)
    } else {
      stats.mappedCount += 1
    }
  }
  for (const [tankId, modelKey] of Object.entries(tankIdToModel)) {
    if (!modelDefinitions[modelKey]) {
      errors.push(`mapping ${tankId} → ${modelKey} 指向不存在的 modelKey`)
    }
    if (!tankopediaIds.has(tankId)) {
      errors.push(`mapping 含 Tankopedia 之外的 tankId：${tankId}`)
    }
  }
  for (const [modelKey, def] of Object.entries(modelDefinitions)) {
    if (!MODEL_KEY_PATTERN.test(modelKey)) {
      errors.push(`modelKey 命名非法：${modelKey}`)
    }
    if (def.kind !== 'turreted' && def.kind !== 'turretless') {
      errors.push(`modelKey ${modelKey} kind 非法：${def.kind}`)
    }
    if (!Array.isArray(def.tankIds) || def.tankIds.length === 0 || def.tankIds.some((id) => !Number.isInteger(id))) {
      errors.push(`modelKey ${modelKey} tankIds 必须为非空整数数组`)
    }
  }
  return { errors, stats }
}