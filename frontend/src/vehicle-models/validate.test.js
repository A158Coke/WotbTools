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

const GOOD_META = {
  modelKey: 'maus',
  kind: 'turreted',
  blitzkitReference: 'https://api.blitzkit.app/tanks/6929/icons/big.webp',
  turretPivot: { x: 160, y: 160 },
  distinctiveFeatures: ['宽大车体', '厚重炮塔'],
  generationNotes: 'test',
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
  it('turretless 禁止 turretPivot', () => {
    const meta = { ...GOOD_META, modelKey: 'ho-ri', kind: 'turretless', turretPivot: undefined }
    expect(validateMetadata(meta, { modelKey: 'ho-ri', expectedKind: 'turretless' })).toEqual([])
    expect(
      validateMetadata(
        { ...GOOD_META, modelKey: 'ho-ri', kind: 'turretless', turretPivot: { x: 160, y: 160 } },
        { modelKey: 'ho-ri', expectedKind: 'turretless' },
      ),
    ).not.toEqual([])
  })
  it('拒绝未契约键与非法 URL', () => {
    expect(validateMetadata({ ...GOOD_META, extra: 1 }, { modelKey: 'maus' })).not.toEqual([])
    expect(
      validateMetadata({ ...GOOD_META, blitzkitReference: 'not-a-url' }, { modelKey: 'maus' }),
    ).not.toEqual([])
  })
})

describe('validateModelEntry', () => {
  const baseFiles = (over = {}) => ({
    hull: GOOD_SVG,
    turret: GOOD_SVG,
    metadata: JSON.stringify(GOOD_META),
    extra: [],
    ...over,
  })
  it('通过 turreted 完整目录', () => {
    expect(validateModelEntry({ modelKey: 'maus', kind: 'turreted', files: baseFiles() })).toEqual([])
  })
  it('turreted 缺 turret.svg FAIL', () => {
    expect(
      validateModelEntry({ modelKey: 'maus', kind: 'turreted', files: baseFiles({ turret: null }) }),
    ).not.toEqual([])
  })
  it('turretless 带 turret.svg FAIL', () => {
    const meta = { ...GOOD_META, kind: 'turretless', turretPivot: undefined }
    expect(
      validateModelEntry({
        modelKey: 'ho-ri',
        kind: 'turretless',
        files: baseFiles({ metadata: JSON.stringify(meta) }),
      }),
    ).not.toEqual([])
  })
  it('拒绝 gun.svg 独立 layer 与多余文件', () => {
    expect(
      validateModelEntry({ modelKey: 'maus', kind: 'turreted', files: baseFiles({ extra: ['gun.svg'] }) }),
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
