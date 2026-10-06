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

describe('playbackScene 静态子树矩阵冻结（场景 GLB）', () => {
  it('场景加载定型后 bake 世界矩阵并关全树 matrixAutoUpdate（含 mapScenery 根组）', () => {
    // 根组必须一并冻结：它保持 autoUpdate 会每帧置脏 + force 传播，把冻结整个击穿
    expect(src).toMatch(/mapScenery\.updateMatrixWorld\(true\)/)
    expect(src).toMatch(/gltf\.scene\.traverse\(\(o\) => \{ o\.matrixAutoUpdate = false; \}\)/)
    expect(src).toMatch(/mapScenery\.matrixAutoUpdate = false/)
  })

  it('poseGlb 不再逐车强制全树 updateMatrixWorld（renderer 场景遍历已从根强制传播）', () => {
    const at = src.indexOf('function poseGlb(')
    expect(at).toBeGreaterThan(0)
    const body = src.slice(at, src.indexOf('async function applyGlbToggle', at))
    expect(body).not.toMatch(/updateMatrixWorld/)
  })
})

describe('playbackScene 手写 shader 的实例化接线', () => {
  // 场景 GLB 合批后，所有自定义 ShaderMaterial 都可能被 InstancedMesh 消费：
  // 手写 vertexShader 直接乘 modelViewMatrix/modelMatrix 而不带 USE_INSTANCING 分支，
  // 整批实例会全部叠画在原点（叶卡、ST| 树干各踩过一次）。锁定：每个手写顶点着色器
  // 只要用了模型矩阵就必须有实例分支。
  it('每个使用模型矩阵的 vertexShader 都必须处理 USE_INSTANCING（单 mesh 地形除外）', () => {
    const shaders = [...src.matchAll(/vertexShader:\s*`([^`]*)`/g)].map((m) => m[1])
    expect(shaders.length).toBeGreaterThanOrEqual(2)
    // vXZ = 分层地表合成 shader：只挂在单个 terrainMesh 上、永不进合批，豁免；
    // 其余（叶卡 / ST| 静态几何等场景材质）都可能成为 InstancedMesh 的消费方。
    const usingModelMatrix = shaders.filter((sh) => /\b(modelViewMatrix|modelMatrix)\b/.test(sh) && !/vXZ/.test(sh))
    expect(usingModelMatrix.length).toBeGreaterThanOrEqual(2)
    for (const sh of usingModelMatrix) {
      expect(sh).toMatch(/USE_INSTANCING/)
    }
  })
})

describe('playbackScene 场景 GLB 实例化合批接线', () => {
  it('合批后原节点必须摘除渲染图（漏摘 = 优化失效：原 Mesh 照常画一遍）', () => {
    const at = src.indexOf('const batches = groupInstanceBatches(entries)')
    expect(at).toBeGreaterThan(0)
    const body = src.slice(at, at + 600)
    expect(body).toMatch(/for \(const b of batches\) \{ b\.mesh = buildInstancedMesh\(b\); gltf\.scene\.add\(b\.mesh\); \}/)
    expect(body).toMatch(/for \(const e of entries\) e\.node\.removeFromParent\(\)/)
  })

  it('D_ 损毁态实例必须初始隐藏（writeHiddenInstance），且隐藏实例不进遮挡候选', () => {
    const at = src.indexOf('const batches = groupInstanceBatches(entries)')
    const body = src.slice(at, src.indexOf('const destructDoc = await destructDocPromise', at))
    expect(body).toMatch(/if \(e\.name && e\.name\.startsWith\('D_'\)\) \{ writeHiddenInstance\(e\.batch\.mesh, e\.idx\); e\.hidden = true; \}/)
    // 遮挡足印登记跳过 hidden / 无名字实例
    expect(body).toMatch(/if \(e\.hidden \|\| !e\.name\) continue;/)
  })

  it('树倒走逐实例矩阵（fallMatrix）且与 settled 自校验的 fallQuat 同步维护', () => {
    const at = src.indexOf('function updateDestructibles(')
    expect(at).toBeGreaterThan(0)
    const body = src.slice(at, src.indexOf('const _tmpFallAxis', at))
    // 倒伏写入 + 倒带复位，两条路径都要置脏上传
    expect(body).toMatch(/fallMatrix\(s\.base, st\.pivotPos\.x, st\.pivotPos\.y, st\.pivotPos\.z, _tmpFallAxis, f\.angle, _tmpInstM\)/)
    expect(body).toMatch(/s\.mesh\.setMatrixAt\(s\.idx, s\.base\); mark\(s\.mesh\)/)
    expect(body).toMatch(/st\.fallQuat\.w = _tmpFallQ\.w/)
    expect(body).toMatch(/st\.fallQuat\.w = 1/)
    // 不再写 pivot 四元数（旧装配已移除；残留即双写）
    expect(body).not.toMatch(/\.pivot\.quaternion/)
  })

  it('实例矩阵上传按帧合并（dirty 集合 → needsUpdate），不许逐树逐帧全量上传', () => {
    const at = src.indexOf('function updateDestructibles(')
    const body = src.slice(at, src.indexOf('const _tmpFallAxis', at))
    expect(body).toMatch(/const mark = \(mesh\) => \{ \(dirty \|\| \(dirty = new Set\(\)\)\)\.add\(mesh\); \};/)
    expect(body).toMatch(/if \(dirty\) for \(const mesh of dirty\) mesh\.instanceMatrix\.needsUpdate = true;/)
  })
})

describe('playbackScene 动态分辨率接线（?dynres）', () => {
  it('装配有空间判定（DPR 无下调空间则跳过）、只喂实际渲染帧、调整即重设尺寸', () => {
    expect(src).toMatch(/dynResCtl = DYNRES && baseDpr > 1/)
    expect(src).toMatch(/createDynRes\(\{ ceilDpr: baseDpr \}\)/)
    expect(src).toMatch(/const nd = dynResCtl\.frame\(dt \* 1000\);/)
    expect(src).toMatch(/renderer\.setPixelRatio\(nd\);/)
    expect(src).toMatch(/renderer\.setSize\(container\.clientWidth, container\.clientHeight\);/)
  })
})
