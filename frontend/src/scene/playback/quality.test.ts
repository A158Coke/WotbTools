// 画质档语义表（P1）：四档只由 QUALITY_FEATURES 提供跨模块语义，且必须与
// QUALITY_PRESETS（渲染器数值旋钮）在重叠字段上一致。未实现项固定 false。
import { describe, expect, it } from 'vitest'
import { playbackSceneSource } from '../__tests__/sceneSource.ts'
import {
  QUALITY_FEATURES,
  QUALITY_PRESETS,
  qualityFeatures,
  shadowQualityEligible,
  type QualityKey,
} from './quality.js'

const KEYS = Object.keys(QUALITY_PRESETS) as QualityKey[]

describe('QUALITY_FEATURES', () => {
  it('每档都有语义表条目，未知档回落均衡档', () => {
    for (const k of KEYS) expect(QUALITY_FEATURES[k]).toBeTruthy()
    expect(qualityFeatures('nope')).toBe(QUALITY_FEATURES.mid)
  })

  it('与 QUALITY_PRESETS 重叠字段一致（单一语义来源，不允许两表打架）', () => {
    for (const k of KEYS) {
      const f = QUALITY_FEATURES[k]
      expect(f.water.reflection).toBe(QUALITY_PRESETS[k].waterReflection)
      if (f.water.reflection) {
        expect(f.water.reflectionScale).toBeGreaterThan(0)
        expect(f.water.reflectionIntervalFrames).toBeGreaterThan(0)
      } else {
        expect(f.water.reflectionScale).toBe(0)
        expect(f.water.reflectionIntervalFrames).toBe(0)
      }
    }
  })

  it('水面档位：低/均衡 MEDIUM，高清 HIGH，极致 ULTRA；间隔随档收紧', () => {
    expect(QUALITY_FEATURES.low.water.tier).toBe('medium')
    expect(QUALITY_FEATURES.mid.water.tier).toBe('medium')
    expect(QUALITY_FEATURES.high.water.tier).toBe('high')
    expect(QUALITY_FEATURES.ultra.water.tier).toBe('ultra')
    expect(QUALITY_FEATURES.high.water.reflectionIntervalFrames).toBe(2)
    expect(QUALITY_FEATURES.ultra.water.reflectionIntervalFrames).toBe(1)
    expect(QUALITY_FEATURES.high.water.reflectionScale).toBe(0.5)
  })

  it('草：低/均衡不加载，高清/极致按实例预算（几何统一 500 档 = 导出档）', () => {
    expect(QUALITY_FEATURES.low.grass.instances).toBe(0)
    expect(QUALITY_FEATURES.mid.grass.instances).toBe(0)
    expect(QUALITY_FEATURES.high.grass.instances).toBe(60000)
    expect(QUALITY_FEATURES.ultra.grass.instances).toBe(60000)
    for (const k of KEYS) expect(QUALITY_FEATURES[k].grass.geometryTier).toBe(500)
  })

  it('坦克阴影：接触/轮廓只在有资格档启用（与 shadowQualityEligible 同口径）', () => {
    for (const k of KEYS) {
      const f = QUALITY_FEATURES[k]
      expect(f.shadows.tankContact).toBe(shadowQualityEligible(k))
      expect(f.shadows.silhouettes).toBe(shadowQualityEligible(k))
    }
  })

  it('未实现能力固定 false（表不得提前宣布支持）', () => {
    for (const k of KEYS) {
      expect(QUALITY_FEATURES[k].shadows.csm).toBe(false)
      expect(QUALITY_FEATURES[k].water.refraction).toBe(false)
      expect(QUALITY_FEATURES[k].decals.projected).toBe(false)
    }
  })
})

describe('画质语义表的消费接线', () => {
  it('playbackScene 只经 qualityFeatures() 消费语义，不再读原始档位布尔', () => {
    const src = playbackSceneSource().split('\n').map((line) => line.split('//')[0]).join('\n')
    expect(src).toContain('qualityFeatures(QKEY)')
    expect(src.includes('Q.waterReflection')).toBe(false)
    expect(src).toContain('grassInstanceBudget: () => qualityFeatures(QKEY).grass.instances')
  })
})
