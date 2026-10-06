// 场景内核依赖 WebGL，无法直接实例化；沿用本仓源码级契约测试的先例
// （labelOcclusion.test.js），锁定「静态子树矩阵冻结」的接线不变量。
// 冻结是性能关键路径：加载后全树 matrixAutoUpdate=false，运行期唯一的变换写入点是
// 树倒 pivot——漏配对刷新 = 树倒动画整体不可见（世界矩阵停在加载时的直立态），
// 而这类回归在无 GPU 的单测里没有其它观察面。
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

  it('树倒 pivot 的每次四元数写入都必须配对刷新（compose 局部矩阵 + 置世界脏）', () => {
    const at = src.indexOf('function updateDestructibles(')
    expect(at).toBeGreaterThan(0)
    const body = src.slice(at, src.indexOf('function refreshFrozenPivot', at))
    // 倒伏写入与 rewind 直立复位，两条写路径都要刷新
    expect(body).toMatch(/setFromAxisAngle\([^;]*;\s*refreshFrozenPivot\(st\.pivot\)/)
    expect(body).toMatch(/quaternion\.identity\(\);\s*refreshFrozenPivot\(st\.pivot\)/)
  })

  it('refreshFrozenPivot 必须置 matrixWorldNeedsUpdate（父链已冻结，靠脏标记传播进树冠）', () => {
    const at = src.indexOf('function refreshFrozenPivot')
    const body = src.slice(at, at + 300)
    expect(body).toMatch(/pivot\.updateMatrix\(\)/)
    expect(body).toMatch(/pivot\.matrixWorldNeedsUpdate = true/)
  })

  it('poseGlb 不再逐车强制全树 updateMatrixWorld（renderer 场景遍历已从根强制传播）', () => {
    const at = src.indexOf('function poseGlb(')
    expect(at).toBeGreaterThan(0)
    const body = src.slice(at, src.indexOf('async function applyGlbToggle', at))
    expect(body).not.toMatch(/updateMatrixWorld/)
  })
})
