import { FX_BUDGETS } from '../battleFx.js'

export const QUALITY_PRESETS = {
  low:   { label: '流畅', antialias: false, maxDpr: 1,    scenery: true,  groundLayers: false, anisotropy: 1, terrainSeg: 192, allowGlb: false, treadMarks: false, forceGlb: false, waterReflection: false, fx: FX_BUDGETS.low },
  mid:   { label: '均衡', antialias: true,  maxDpr: 1.25, scenery: true,  groundLayers: false, anisotropy: 2, terrainSeg: 256, allowGlb: true,  treadMarks: false, forceGlb: false, waterReflection: false, fx: FX_BUDGETS.mid },
  high:  { label: '高清', antialias: true,  maxDpr: 1.5,  scenery: true,  groundLayers: true,  anisotropy: 4, terrainSeg: 384, allowGlb: true,  treadMarks: true,  forceGlb: true, waterReflection: true,  fx: FX_BUDGETS.high },
  ultra: { label: '极致', antialias: true,  maxDpr: 2,    scenery: true,  groundLayers: true,  anisotropy: 8, terrainSeg: 512, allowGlb: true,  treadMarks: true,  forceGlb: true, waterReflection: true,  fx: FX_BUDGETS.ultra },
}

export function shadowQualityEligible(key: string): boolean {
  return key === 'high' || key === 'ultra'
}

export type QualityKey = keyof typeof QUALITY_PRESETS
export type WaterTier = 'medium' | 'high' | 'ultra'

export interface QualityFeatures {
  water: {
    tier: WaterTier
    reflection: boolean
    refraction: boolean
    reflectionScale: number
    reflectionIntervalFrames: number
  }
  grass: {
    instances: number
    geometryTier: 500
  }
  shadows: {
    csm: boolean
    tankContact: boolean
    silhouettes: boolean
  }
  decals: { projected: boolean }
}

export const GRASS_LAYER_ENABLED = false

export const QUALITY_FEATURES: Record<QualityKey, QualityFeatures> = {
  low: {
    water: { tier: 'medium', reflection: false, refraction: false, reflectionScale: 0, reflectionIntervalFrames: 0 },
    grass: { instances: 0, geometryTier: 500 },
    shadows: { csm: false, tankContact: false, silhouettes: false },
    decals: { projected: false },
  },
  mid: {
    water: { tier: 'medium', reflection: false, refraction: false, reflectionScale: 0, reflectionIntervalFrames: 0 },
    grass: { instances: 0, geometryTier: 500 },
    shadows: { csm: false, tankContact: false, silhouettes: false },
    decals: { projected: false },
  },
  high: {
    water: { tier: 'high', reflection: true, refraction: false, reflectionScale: 0.5, reflectionIntervalFrames: 2 },
    grass: { instances: GRASS_LAYER_ENABLED ? 60000 : 0, geometryTier: 500 },
    shadows: { csm: false, tankContact: true, silhouettes: true },
    decals: { projected: false },
  },
  ultra: {
    water: { tier: 'ultra', reflection: true, refraction: false, reflectionScale: 0.5, reflectionIntervalFrames: 1 },
    grass: { instances: GRASS_LAYER_ENABLED ? 60000 : 0, geometryTier: 500 },
    shadows: { csm: false, tankContact: true, silhouettes: true },
    decals: { projected: false },
  },
}

export function qualityFeatures(key: string): QualityFeatures {
  return QUALITY_FEATURES[key as QualityKey] || QUALITY_FEATURES.mid
}
