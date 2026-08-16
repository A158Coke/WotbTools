/**
 * Validator 单测：SVG 契约 / metadata 契约 / 目录完整性 / 覆盖校验（含非法输入）。
 */
import { describe, expect, it } from 'vitest'
import { VIEWBOX } from './types.js'
import { MODEL_DEFINITIONS } from './mapping.js'
import {
  validateSvgText,
  validateMetadata,
  validateModelEntry,
  validateCoverage,
} from './validate.js'

const GOOD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX.width} ${VIEWBOX.height}">
  <g id="hull"><rect x="100" y="50" width="120" height="200"/></g>
</svg>`

/** 最小合法 WebP 二进制（RIFF....WEBP 魔数 + 填充）。 */
const GOOD_WEBP = 'RIFF' + String.fromCharCode(0x20, 0, 0, 0) + 'WEBP' + 'x'.repeat(64)

const GOOD_META = {
  modelKey: 'maus',
  kind: 'turreted',
  source: {
    provider: 'blitzkit',
    tankId: 6929,
    modelGlb: 'https://api.blitzkit.app/tanks/6929/model.glb',
    modelDefinitions: 'https://api.blitzkit.app/definitions/models.pb',
  },
  turretPivot: { x: 160, y: 193.23 },
  turretRaster: {
    logicalMinX: 120.01, logicalMinY: -19.6, logicalMaxX: 200.19, logicalMaxY: 292.86,
    pixelWidth: 160, pixelHeight: 625, pivotX: 40, pivotY: 212.8,
  },
  generation: {
    method: 'blitzkit-model-topdown-texture-bake',
    viewBox: '0 0 320 320',
    physicalPixelSize: [640, 640],
    notes: 'test',
    fidelity: 'high',
    geometryScale: 'faithful',
    visibleDetailRetentionTarget: 0.9,
  },
}

describe('validateSvgText', () => {
  it('通过合法 SVG（统一 viewBox）', () => {
    expect(validateSvgText(GOOD_SVG)).toEqual([])
  })
  it('拒绝非统一 viewBox', () => {
    const bad = GOOD_SVG.replace('320 320', '400 400')
    expect(validateSvgText(bad)).toHaveLength(1)
  })
  it('拒绝 script / foreignObject / 外部 href', () => {
    expect(validateSvgText(GOOD_SVG + '<script>alert(1)</script>')).not.toEqual([])
    expect(validateSvgText(GOOD_SVG.replace('<g', '<foreignObject><g'))).not.toEqual([])
    expect(validateSvgText(GOOD_SVG.replace('<g', '<g href="https://evil.example/x"'))).not.toEqual([])
  })
  it('拒绝空内容与标签不平衡', () => {
    expect(validateSvgText('')).not.toEqual([])
    expect(validateSvgText(GOOD_SVG.replace('</svg>', ''))).not.toEqual([])
  })
})

describe('validateMetadata', () => {
  it('通过合法 turreted metadata', () => {
    expect(validateMetadata(GOOD_META, { modelKey: 'maus' })).toEqual([])
  })
  it('拒绝 modelKey 不一致', () => {
    expect(validateMetadata(GOOD_META, { modelKey: 'e-100' })).not.toEqual([])
  })
  it('拒绝与 mapping kind 不一致', () => {
    expect(validateMetadata(GOOD_META, { modelKey: 'maus', expectedKind: 'turretless' })).not.toEqual([])
  })
  it('turreted 缺 turretPivot / pivot 越界', () => {
    const { turretPivot, ...noPivot } = GOOD_META
    expect(validateMetadata(noPivot, { modelKey: 'maus' })).not.toEqual([])
    expect(
      validateMetadata({ ...GOOD_META, turretPivot: { x: 999, y: 160 } }, { modelKey: 'maus' }),
    ).not.toEqual([])
  })
  it('turretless 禁止 turretPivot / turretRaster', () => {
    const meta = { ...GOOD_META, modelKey: 'ho-ri', kind: 'turretless', turretPivot: undefined, turretRaster: undefined }
    expect(validateMetadata(meta, { modelKey: 'ho-ri', expectedKind: 'turretless' })).toEqual([])
    expect(
      validateMetadata(
        { ...GOOD_META, modelKey: 'ho-ri', kind: 'turretless', turretPivot: { x: 160, y: 160 }, turretRaster: undefined },
        { modelKey: 'ho-ri', expectedKind: 'turretless' },
      ),
    ).not.toEqual([])
  })
  it('拒绝未契约键与非法 URL', () => {
    expect(validateMetadata({ ...GOOD_META, extra: 1 }, { modelKey: 'maus' })).not.toEqual([])
    expect(
      validateMetadata(
        { ...GOOD_META, source: { ...GOOD_META.source, modelGlb: 'not-a-url' } },
        { modelKey: 'maus' },
      ),
    ).not.toEqual([])
  })
  it('generation 内出现 turretRaster 视为 schema 漂移 FAIL（authoritative 只在顶层）', () => {
    const dup = { ...GOOD_META, generation: { ...GOOD_META.generation, turretRaster: GOOD_META.turretRaster } }
    expect(validateMetadata(dup, { modelKey: 'maus' })).not.toEqual([])
  })
  it('turretPivot 与 turretRaster 映射一致；不一致 FAIL', () => {
    const meta = { ...GOOD_META, turretRaster: { ...GOOD_META.turretRaster, pivotX: 50, pivotY: 200 } }
    // GOOD_META: pivot(160,193.23)；raster logicalMin(120.01,-19.6) → 映射 160+? 需一致
    // 直接构造一致 case：logicalMin(110,0) + pivot(50,193.23) = (160,193.23)
    const consistent = {
      ...GOOD_META,
      turretRaster: { ...GOOD_META.turretRaster, logicalMinX: 110, logicalMinY: 0, pivotX: 50, pivotY: 193.23 },
    }
    expect(validateMetadata(consistent, { modelKey: 'maus' })).toEqual([])
    const broken = { ...GOOD_META, turretRaster: { ...GOOD_META.turretRaster, logicalMinX: 120, pivotX: 60 } }
    expect(validateMetadata(broken, { modelKey: 'maus' })).not.toEqual([])
  })
  it('turretRaster.pivot 必须落在 image-local raster bounds 内', () => {
    const bad = { ...GOOD_META, turretRaster: { ...GOOD_META.turretRaster, pivotX: 999 } }
    expect(validateMetadata(bad, { modelKey: 'maus' })).not.toEqual([])
  })
  it('正式资产强制 source.provider=blitzkit / generation.method=extraction', () => {
    const badProvider = {
      ...GOOD_META,
      source: { ...GOOD_META.source, provider: 'ai-hand-drawn' },
    }
    expect(validateMetadata(badProvider, { modelKey: 'maus', expectedKind: 'turreted' })).not.toEqual([])
    const badMethod = {
      ...GOOD_META,
      generation: { ...GOOD_META.generation, method: 'manual' },
    }
    expect(validateMetadata(badMethod, { modelKey: 'maus', expectedKind: 'turreted' })).not.toEqual([])
  })
  it('正式资产强制 HIGH-FIDELITY 契约（fidelity/geometryScale/retention target）', () => {
    const noFidelity = { ...GOOD_META, generation: { ...GOOD_META.generation, fidelity: undefined } }
    expect(validateMetadata(noFidelity, { modelKey: 'maus', expectedKind: 'turreted' })).not.toEqual([])
    const notHigh = { ...GOOD_META, generation: { ...GOOD_META.generation, fidelity: 'low' } }
    expect(validateMetadata(notHigh, { modelKey: 'maus', expectedKind: 'turreted' })).not.toEqual([])
    const notFaithful = { ...GOOD_META, generation: { ...GOOD_META.generation, geometryScale: 'stylized' } }
    expect(validateMetadata(notFaithful, { modelKey: 'maus', expectedKind: 'turreted' })).not.toEqual([])
    const badTarget = { ...GOOD_META, generation: { ...GOOD_META.generation, visibleDetailRetentionTarget: 0 } }
    expect(validateMetadata(badTarget, { modelKey: 'maus', expectedKind: 'turreted' })).not.toEqual([])
    // 非正式资产（expectedKind=null，如 sample 目录）不强制 fidelity 契约
    expect(validateMetadata({ ...GOOD_META, generation: { ...GOOD_META.generation, fidelity: undefined } }, { modelKey: 'maus' })).toEqual([])
  })
  it('source 缺失 / sourceTankId 非法 FAIL', () => {
    const { source, ...noSource } = GOOD_META
    expect(validateMetadata(noSource, { modelKey: 'maus' })).not.toEqual([])
    expect(
      validateMetadata(
        { ...GOOD_META, source: { ...GOOD_META.source, tankId: 0 } },
        { modelKey: 'maus' },
      ),
    ).not.toEqual([])
  })
  it('sample（非 mapping）允许非 blitzkit provider', () => {
    const sampleMeta = {
      modelKey: 'sample',
      kind: 'turreted',
      source: { provider: 'manual-contract-sample', tankId: 0, modelGlb: '', modelDefinitions: '' },
      turretPivot: { x: 160, y: 150 },
      turretRaster: { logicalMinX: 0, logicalMinY: 0, logicalMaxX: 320, logicalMaxY: 320, pixelWidth: 640, pixelHeight: 640, pivotX: 160, pivotY: 150 },
      generation: { method: 'manual-contract-sample', viewBox: '0 0 320 320' },
    }
    expect(validateMetadata(sampleMeta, { modelKey: 'sample', expectedKind: null })).toEqual([])
  })
})

describe('validateModelEntry', () => {
  const baseFiles = (over = {}) => ({
    hull: GOOD_WEBP,
    turret: GOOD_WEBP,
    metadata: JSON.stringify(GOOD_META),
    bakeReport: JSON.stringify({ tankId: 6929 }),
    extra: [],
    ...over,
  })
  it('通过 turreted 完整目录', () => {
    expect(validateModelEntry({ modelKey: 'maus', kind: 'turreted', files: baseFiles() })).toEqual([])
  })
  it('turreted 缺 turret.webp FAIL', () => {
    expect(
      validateModelEntry({ modelKey: 'maus', kind: 'turreted', files: baseFiles({ turret: null }) }),
    ).not.toEqual([])
  })
  it('hull 非 WebP 二进制 FAIL', () => {
    expect(
      validateModelEntry({ modelKey: 'maus', kind: 'turreted', files: baseFiles({ hull: 'not a webp' }) }),
    ).not.toEqual([])
  })
  it('turretless 带 turret.webp FAIL', () => {
    const meta = { ...GOOD_META, kind: 'turretless', turretPivot: undefined }
    expect(
      validateModelEntry({
        modelKey: 'ho-ri',
        kind: 'turretless',
        files: baseFiles({ metadata: JSON.stringify(meta) }),
      }),
    ).not.toEqual([])
  })
  it('拒绝 gun 独立 layer 与多余文件', () => {
    expect(
      validateModelEntry({ modelKey: 'maus', kind: 'turreted', files: baseFiles({ extra: ['gun.svg'] }) }),
    ).not.toEqual([])
  })
  it('bake-report.json 缺失 FAIL', () => {
    expect(
      validateModelEntry({ modelKey: 'maus', kind: 'turreted', files: baseFiles({ bakeReport: null }) }),
    ).not.toEqual([])
  })
  it('拒绝非法 modelKey 命名', () => {
    expect(
      validateModelEntry({ modelKey: 'Bad Name', kind: 'turreted', files: baseFiles() }),
    ).not.toEqual([])
  })
  it('metadata.json 非 JSON FAIL', () => {
    expect(
      validateModelEntry({ modelKey: 'maus', kind: 'turreted', files: baseFiles({ metadata: '{oops' }) }),
    ).not.toEqual([])
  })
})

describe('validateCoverage', () => {
  const tankopedia = {
    vehicles: [
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
      { id: 3, name: 'C' },
    ],
  }
  it('全量覆盖通过', () => {
    const modelDefinitions = { a: { kind: 'turreted', tankIds: [1, 2] }, b: { kind: 'turretless', tankIds: [3] } }
    const tankIdToModel = { '1': 'a', '2': 'a', '3': 'b' }
    const { errors, stats } = validateCoverage({ tankopedia, tankIdToModel, modelDefinitions })
    expect(errors).toEqual([])
    expect(stats.mappedCount).toBe(3)
  })
  it('新增 Tier X 无 mapping → FAIL', () => {
    const modelDefinitions = { a: { kind: 'turreted', tankIds: [1] } }
    const tankIdToModel = { '1': 'a' }
    const { errors } = validateCoverage({ tankopedia, tankIdToModel, modelDefinitions })
    expect(errors.some((e) => e.includes('2') || e.includes('B'))).toBe(true)
    expect(errors.some((e) => e.includes('C'))).toBe(true)
  })
  it('mapping 指向不存在 modelKey / 含未知 tankId → FAIL', () => {
    const { errors } = validateCoverage({
      tankopedia,
      tankIdToModel: { '1': 'nope', '99': 'a' },
      modelDefinitions: { a: { kind: 'turreted', tankIds: [1] } },
    })
    expect(errors.some((e) => e.includes('nope'))).toBe(true)
    expect(errors.some((e) => e.includes('99'))).toBe(true)
  })
  it('modelDefinitions 结构非法（kind / tankIds）→ FAIL', () => {
    const { errors } = validateCoverage({
      tankopedia,
      tankIdToModel: { '1': 'a' },
      modelDefinitions: { a: { kind: 'floating', tankIds: [] } },
    })
    expect(errors.length).toBeGreaterThanOrEqual(2)
  })
  it('真实 mapping 与真实 tankopedia 通过（复用 production 数据）', async () => {
    const realTp = (await import('../../../common/tankopedia-tier10.json')).default
    const { MODEL_DEFINITIONS: defs, TANK_ID_TO_MODEL: map } = await import('./mapping.js')
    const { errors, stats } = validateCoverage({ tankopedia: realTp, tankIdToModel: map, modelDefinitions: defs })
    expect(errors).toEqual([])
    expect(stats.tankCount).toBe(84)
  })
})
