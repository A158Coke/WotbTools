// Wave C（#741）C1 批次的编译期负向证明：锁定「过去 JS 能静默接受的错误数据形状，
// 现在 TypeScript 会在编译期拦截」。@ts-expect-error 只出现在本测试文件中（类型迁移契约）。
import { describe, expect, it } from 'vitest'
import { impactKind } from './impactKind.js'
import { battleEndTime } from './battleEnd.js'
import { createFrameMeter, type FrameMeterSample } from './frameMeter.js'
import { buildPitchLimits, type PitchRange } from './pitchLimits.js'
import { fillOf, shellStatesAt, resolveExactMountedConfig, type ShellState } from './reloadBar.js'
import { activeVariantOf, pruneForeignVariants, type VariantPruneNode } from './variantFilter.js'

describe('C1 纯函数边界的编译期负向证明', () => {
  it('impactKind：命中分型只接受三类字面量 + null，game_hit_result 不能传字符串', () => {
    // JS 时代 game_hit_result: '3' 会在 r === 3 的严格比较下静默走 null 分支（不生成特效也不报错）
    // @ts-expect-error — negative compile proof: game_hit_result 只接受 number
    const mismatched = impactKind({ target_eid: 1, game_hit_result: '3' })
    expect(mismatched).toBeNull()

    expect(impactKind({ target_eid: 2, is_author: true, hit_flags: 0x0008 })).toBe('ricochet')
    const kindNull = impactKind({ target_eid: null })
    // @ts-expect-error — negative compile proof: 返回值可能是 null，未收窄不能当确定分型用
    const tag: import('./impactKind.js').ImpactKind = kindNull
    expect(tag).toBeNull()
  })

  it('battleEndTime：periods 条目必须带 clock/period 形状', () => {
    expect(battleEndTime({ meta: { t_start: 0, duration: 100 }, periods: [{ clock: 60, period: 4 }] })).toBe(60)
    // @ts-expect-error — negative compile proof: periods 条目缺 period 字段（旧 JS 静默当 undefined 比较）
    battleEndTime({ meta: { t_start: 0, duration: 100 }, periods: [{ clock: 60 }] })
  })

  it('frameMeter：sample 的统计形状必须完整', () => {
    const meter = createFrameMeter({ windowMs: 10 })
    meter.sample(0)
    expect(meter.sample(20)).toEqual({ fps: 50, frameMs: 20, peakMs: 20 })
    // @ts-expect-error — negative compile proof: 统计缺 peakMs 字段编译失败
    const partial: FrameMeterSample = { fps: 60, frameMs: 16 }
    expect(partial).toBeTruthy()
  })

  it('pitchLimits：PitchRange 缺 dep/ele 不能通过编译', () => {
    // @ts-expect-error — negative compile proof: dep/ele 是必填（缺失会让 WASM 解码静默兜底 hull_pitch）
    const bad: PitchRange = { ele: 5 }
    expect(bad).toBeTruthy()
    // @ts-expect-error — negative compile proof: 名册条目缺 tank_id 编译失败（旧 JS 会对 undefined 建键）
    void buildPitchLimits([{ nickname: 'x' }])
  })

  it('reloadBar：ShellState 判别集合与逐发状态数组契约', () => {
    // 开火后未有任何装填事件补弹：1 发在膛、2 发等整夹重装（unknown≠full 由 hasReloadTelemetry 另测）
    const states = shellStatesAt(
      [{ clock: 1, eid: 7, phase: 3, duration_s: 5, count: 2 }],
      [2],
      3,
      3,
    )
    expect(states).toEqual([
      { state: 'full', progress: 1 },
      { state: 'empty', progress: 0 },
      { state: 'empty', progress: 0 },
    ])
    expect(fillOf(states)).toBeCloseTo(1 / 3)

    // @ts-expect-error — negative compile proof: 'charged' 不在 ShellState 判别集合里，JS 时代会静默进入渲染分支
    const bad: ShellState = { state: 'charged', progress: 1 }
    expect(bad).toBeTruthy()

    // @ts-expect-error — negative compile proof: 把单发状态对象当数组传入（旧 JS 会读 undefined 的 .state）
    fillOf({ state: 'full', progress: 1 })

    // @ts-expect-error — negative compile proof: shellStatesAt 的相位条目缺 clock（时间归并的排序键）
    shellStatesAt([{ eid: 7, phase: 3, duration_s: 5 }], [], 1)
  })

  it('reloadBar：resolveExactMountedConfig 的 comp locals 证据形状（装甲着色的配置不能靠推断链）', () => {
    const cfgs = [
      { turret_local: 1, gun_local: 2 },
      { turret_local: 3, gun_local: 4 },
    ]
    expect(resolveExactMountedConfig({ turret_local: 3, gun_local: 4 }, { configs: cfgs })).toEqual(cfgs[1])
    expect(resolveExactMountedConfig({ turret_local: 3 }, { configs: cfgs })).toBeNull()

    // @ts-expect-error — negative compile proof: configs 条目出现契约外字段（excess property check）
    resolveExactMountedConfig(null, { configs: [{ hullWrong: 1 }] })
  })

  it('variantFilter：最小节点接口与 fail-closed 返回形状', () => {
    expect(activeVariantOf({ '12': 'md1' }, 12)).toBe('md1')
    expect(activeVariantOf(null, 12)).toBeNull()

    const keep: VariantPruneNode = { userData: { mdVariant: 'md1' }, parent: { remove: () => {} } }
    const drop: VariantPruneNode = { userData: { mdVariant: 'md2' }, parent: { remove: () => {} } }
    const root: VariantPruneNode = { userData: { variantByMapId: { 1: 'md1' } }, children: [keep, drop] }
    expect(pruneForeignVariants(root, 1)).toBe(1)

    // @ts-expect-error — negative compile proof: parent.remove 的签名不接受变体节点（函数属性严格检查）
    const wrongRemove: VariantPruneNode = { parent: { remove: (_s: string) => {} } }
    expect(wrongRemove).toBeTruthy()

    // @ts-expect-error — negative compile proof: pruneForeignVariants 的返回不是 {removed, failClosed} 对象
    const detailed: { removed: number; failClosed: boolean } = pruneForeignVariants(root, 1)
    expect(detailed).toBe(1)
  })
})
