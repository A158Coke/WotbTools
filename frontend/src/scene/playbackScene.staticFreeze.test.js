import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, 'playback/renderLoop.ts'), 'utf8').replace(/\/\/[^\n]*/g, '').replace(/\bS\./g, '')
const mapAssetsSrc = readFileSync(resolve(here, 'playback/mapAssets.ts'), 'utf8').replace(/\/\/[^\n]*/g, '')

describe('playbackScene 手写 shader 的实例化接线', () => {
  const matSrc = ['sceneryMaterials.ts', 'sceneryLightingMaterials.ts', 'sceneryWaterMaterials.ts', 'scenerySurfaceMaterials.ts'].map(path => readFileSync(resolve(here, path), 'utf8')).join('\n')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  it('每个使用模型矩阵的 vertexShader 都必须处理 USE_INSTANCING（单 mesh 地形除外）', () => {
    const shaders = [...matSrc.matchAll(/vertexShader:\s*`([^`]*)`/g)].map((m) => m[1])
    expect(shaders.length).toBeGreaterThanOrEqual(2)
    const usingModelMatrix = shaders.filter((sh) => /\b(modelViewMatrix|modelMatrix)\b/.test(sh) && !/vXz/.test(sh))
    expect(usingModelMatrix.length).toBeGreaterThanOrEqual(2)
    for (const sh of usingModelMatrix) {
      expect(sh).toMatch(/USE_INSTANCING/)
    }
  })
})

describe('playbackScene 动态分辨率接线（?dynres）', () => {
  it('装配有空间判定（DPR 无下调空间则跳过）、只喂实际渲染帧、调整即重设尺寸', () => {
    const rendererSrc = readFileSync(resolve(here, 'playback/renderer.ts'), 'utf8')
    expect(rendererSrc).toMatch(/dynResCtl = DYNRES && baseDpr > 1/)
    expect(rendererSrc).toMatch(/createDynRes\(\{ ceilDpr: baseDpr \}\)/)
    expect(rendererSrc).toMatch(/renderer\.setSize\(container\.clientWidth, container\.clientHeight\);/)
    expect(src).toMatch(/const nd = dynResCtl\.frame\(dt \* 1000\);/)
    expect(src).toMatch(/renderer\.setPixelRatio\(nd\);/)
  })
})

describe('炮声 seek 失效接线（评审 P2）', () => {
  it('resetShotsTo（宿主 seekTo 的唯一游标入口）必须调 gunfire.invalidatePending', () => {
    const src = readFileSync(resolve(here, 'playback/battleRuntime.ts'), 'utf8')
    expect(src).toMatch(/resetShotsTo\(index: number\) \{ shotPtr = index; gunfire\.invalidatePending\(\); \},/)
  })
})
