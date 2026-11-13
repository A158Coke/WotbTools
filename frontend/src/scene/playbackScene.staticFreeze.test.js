// 场景内核依赖 WebGL，无法直接实例化；沿用本仓源码级契约测试的先例
// （labelOcclusion.test.js），锁定「静态子树矩阵冻结 + 实例化合批」的接线不变量。
// 两件事都是性能关键且无 GPU 观察面：冻结漏配对 = 树倒动画整体不可见；
// 合批漏摘原节点 = draw call 优化整体失效（原 Mesh 仍在渲染图里画一遍）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, 'playbackScene.js'), 'utf8').replace(/\/\/[^\n]*/g, '')
// 场景装配块 2026-10-24 出仓 playback/mapAssets.js（Step A3），冻结/合批守卫随实现迁移
const mapAssetsSrc = readFileSync(resolve(here, 'playback/mapAssets.ts'), 'utf8').replace(/\/\/[^\n]*/g, '')

describe('playbackScene 手写 shader 的实例化接线', () => {
  // 场景 GLB 合批后，所有自定义 ShaderMaterial 都可能被 InstancedMesh 消费：
  // 手写 vertexShader 直接乘 modelViewMatrix/modelMatrix 而不带 USE_INSTANCING 分支，
  // 整批实例会全部叠画在原点（叶卡、ST| 树干各踩过一次）。锁定：每个手写顶点着色器
  // 只要用了模型矩阵就必须有实例分支。场景自定义 shader 已平移至 sceneryMaterials.js。
  const matSrc = readFileSync(resolve(here, 'sceneryMaterials.ts'), 'utf8')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  it('每个使用模型矩阵的 vertexShader 都必须处理 USE_INSTANCING（单 mesh 地形除外）', () => {
    const shaders = [...matSrc.matchAll(/vertexShader:\s*`([^`]*)`/g)].map((m) => m[1])
    expect(shaders.length).toBeGreaterThanOrEqual(2)
    // vXZ = 分层地表合成 shader：只挂在单个 terrainMesh 上、永不进合批，豁免；
    // 其余（叶卡 / ST| 静态几何等场景材质）都可能成为 InstancedMesh 的消费方。
    const usingModelMatrix = shaders.filter((sh) => /\b(modelViewMatrix|modelMatrix)\b/.test(sh) && !/vXz/.test(sh))
    expect(usingModelMatrix.length).toBeGreaterThanOrEqual(2)
    for (const sh of usingModelMatrix) {
      expect(sh).toMatch(/USE_INSTANCING/)
    }
  })
})

describe('playbackScene 动态分辨率接线（?dynres）', () => {
  it('装配有空间判定（DPR 无下调空间则跳过）、只喂实际渲染帧、调整即重设尺寸', () => {
    // 2026-10-24 渲染器创建核心出仓 playback/renderer.js（Step A2），装配断言随实现迁移；
    // 逐帧喂入/调整侧仍在 playbackScene（animate / onResize）
    const rendererSrc = readFileSync(resolve(here, 'playback/renderer.ts'), 'utf8')
    expect(rendererSrc).toMatch(/dynResCtl = DYNRES && baseDpr > 1/)
    expect(rendererSrc).toMatch(/createDynRes\(\{ ceilDpr: baseDpr \}\)/)
    expect(rendererSrc).toMatch(/renderer\.setSize\(container\.clientWidth, container\.clientHeight\);/)
    expect(src).toMatch(/const nd = dynResCtl\.frame\(dt \* 1000\);/)
    expect(src).toMatch(/renderer\.setPixelRatio\(nd\);/)
  })
})
