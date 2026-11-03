// Wave C（#741）C3 批次的编译期负向证明：async asset / resource ownership 边界。
// 锁定：assetProvider 的 logical path 契约、untrusted JSON 必须显式声明期望形状、
// 渲染器装配参数完整（漏容器/回调编译失败）。@ts-expect-error 仅限本文件。
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { assetProvider } from './assetProvider.js'
import type { AssetPath } from './assetProvider.js'
import type { SceneCoreOptions } from './playback/renderer.js'
import { buildPitchLimits } from './pitchLimits.js'

describe('C3 async asset / resource ownership 的编译期负向证明', () => {
  it('assetProvider.json：untrusted JSON 必须显式声明期望形状才能读字段', async () => {
    // 无运行时网络（configured() false 时 url() 抛错）；这里只锁编译期形状
    const doc = await assetProvider.json<{ configs?: Array<{ pitch_limits?: { max?: number } | null }> | null }>(
      '/tank/1.json',
    ).catch(() => null)
    expect(doc === null || typeof doc === 'object').toBe(true)
    if (doc?.configs?.length) {
      expect(doc.configs[0]).toBeTruthy()
    }
    // @ts-expect-error — negative compile proof: 宽松 Record 上把 unknown 字段读成具体类型编译失败（形状必须显式收窄）
    const n: number | undefined = (await assetProvider.json('/tank/1.json').catch(() => null))?.count
    expect(n).toBeUndefined()
  })

  it('assetProvider：logical path 是唯一入口（bytes/json/url 同一条 API）', () => {
    expect(assetProvider.configured()).toBe(false)
    // @ts-expect-error — negative compile proof: AssetPath 只收 string（数字 id 不能当路径传）
    const bad: AssetPath = 17
    expect(bad).toBeTruthy()
  })

  it('pitchLimits：资产包 tank JSON 的期望形状在调用点声明（缺 pitch_limits 判空跳过）', async () => {
    // 资产源未配置 → buildPitchLimits 返回空表（不抛——每个玩家独立 fail-soft）
    const limits = await buildPitchLimits([{ nickname: 'a', tank_id: 1 }])
    expect(limits).toEqual({})
    // @ts-expect-error — negative compile proof: 名册条目缺 tank_id 编译失败（WASM 解码按车型查极限）
    void buildPitchLimits([{ nickname: 'a' }])
  })

  it('createSceneCore：装配参数完整（容器/回调缺失编译失败——宿主闭包契约）', () => {
    // @ts-expect-error — negative compile proof: 缺 container / onResize / 指针回调不能通过编译
    const opts: SceneCoreOptions = { quality: { antialias: true, maxDpr: 2 }, logdepth: false, dynres: false, debug: false }
    expect(opts).toBeTruthy()
    const incomplete: SceneCoreOptions = {
      container: document.createElement('div'),
      // @ts-expect-error — negative compile proof: quality 缺 antialias/maxDpr（渲染器构造直接消费）编译失败
      quality: {},
      logdepth: false, dynres: false, debug: false,
      onResize: () => {}, onPointerDown: () => {}, onPointerUp: () => {},
    }
    expect(incomplete).toBeTruthy()
  })
})
