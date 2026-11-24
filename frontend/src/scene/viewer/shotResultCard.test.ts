// 射击结果卡 presentation 的行为测试（Issue #820 Wave B3A）。
// renderShotResultCardHtml 是从 tankViewer.js showTrajectory() 出仓的纯函数；
// 这里锁定卡片语义：概率 0/部分/100 与边界显示、HE 命中/溅射/采样不可用、
// 跳弹多段标题与概率层着色、无主装甲不回填伤害、三语 labels 与 HTML escaping、
// 紧凑/普通卡片尺寸。判定输入（概率链、伤害、轨迹色）由调用方计算——本文件
// 只构造已算好的确定性输入，不重复实现领域逻辑。
import { describe, expect, it } from 'vitest'
import { evaluateProbabilityChain } from '../armorInspectorChance.js'
import { renderShotResultCardHtml } from './shotResultCard.js'
import type { ShotResultCardInput, ShotResultCardLabels } from './shotResultCard.js'
import { shotResultCardMetrics } from '../../utils/shotResultCardMetrics.js'

const EN: ShotResultCardLabels = {
  shotDistance: 'Engagement distance', distanceUnit: 'm',
  effectivePenetration: 'effective penetration', heRadius: 'splash radius',
  shotSplashDamage: 'splash damage', shotAvgShort: 'avg', mayPenetrate: 'May penetrate',
  resultName: (result) => result, shotPenChance: 'penetration chance',
  expectedDamage: 'expected damage', heSamplingUnavailable: 'splash sampling unavailable',
  noPrimaryBlocked: 'No primary armor hit; treated as non-penetration',
  directHit: 'direct hit', partName: (name) => String(name), sectionName: (section) => String(section),
  heBestSample: 'best sample', heBestSampleUpper: 'best sample (upper)', heBestSampleLower: 'best sample (lower)',
  shotRicochetSeg: 'ricochet (-25% penetration)', shotLoss: 'loss', shotNominal: 'nominal', shotBlocked: 'blocked',
  fragMismatch: 'fragment check differs from the server armor group',
}

const baseInput = (): ShotResultCardInput => ({
  result: 'PENETRATION',
  layers: [],
  partialChainLayers: null,
  chancePen: 200,
  dmgVal: 400,
  distVal: 0,
  dmgDealt: 0,
  resultRole: 'PENETRATION',
  cardChance: 1,
  heInfo: null,
  heChance: 0,
  heDirectHit: null,
  probabilityMode: true,
  overallChance: 1,
  hasChance: true,
  chancePartial: false,
  blockedNoPrimary: false,
  cardMetrics: shotResultCardMetrics(false),
  cardMaxWidth: null,
  labels: EN,
})

describe('shotResultCard · 概率显示（0 / 部分 / 100 / 边界）', () => {
  it('0%：BLOCKED 红标题 + 显式 0 伤害 + 0% 概率行', () => {
    const html = renderShotResultCardHtml({ ...baseInput(), overallChance: 0, hasChance: false, cardChance: 0 })
    expect(html).toContain('<span>BLOCKED</span>')
    expect(html).toContain('· 0</span>')
    expect(html).toContain('penetration chance: 0%')
    expect(html).toContain('font-weight:bold;color:var(--red);margin-bottom')
  })
  it('部分概率：May penetrate 黄标题 + 满伤 + 精确百分比', () => {
    const html = renderShotResultCardHtml({ ...baseInput(), overallChance: 0.4, cardChance: 0.4 })
    expect(html).toContain('<span>May penetrate</span>')
    expect(html).toContain('· 400</span>')
    expect(html).toContain('penetration chance: 40%')
    expect(html).toContain('font-weight:bold;color:var(--yellow);margin-bottom')
  })
  it('100%：PENETRATION 绿标题 + 满伤 + 100%', () => {
    const html = renderShotResultCardHtml(baseInput())
    expect(html).toContain('<span>PENETRATION</span>')
    expect(html).toContain('· 400</span>')
    expect(html).toContain('penetration chance: 100%')
    expect(html).toContain('font-weight:bold;color:var(--green);margin-bottom')
  })
  it('接近 0/100 的不确定性不能被取整成 0%/100%（<1 / >99）', () => {
    const low = renderShotResultCardHtml({ ...baseInput(), overallChance: 0.004, cardChance: 0.004 })
    expect(low).toContain('penetration chance: <1%')
    const high = renderShotResultCardHtml({ ...baseInput(), overallChance: 0.996, cardChance: 0.996 })
    expect(high).toContain('penetration chance: >99%')
  })
  it('概率模式无击穿可能时伤害回 0，有概率时按满伤口径（hasChance ? dmgVal : 0）', () => {
    const zero = renderShotResultCardHtml({ ...baseInput(), overallChance: 0, hasChance: false, cardChance: 0 })
    expect(zero).toContain('· 0</span>')
    const partial = renderShotResultCardHtml({ ...baseInput(), overallChance: 0.4, cardChance: 0.4 })
    expect(partial).toContain('· 400</span>')
  })
  it('层行圆点按该层局部 layerChance 着色（与 3D 接触点同语义）', () => {
    const html = renderShotResultCardHtml({
      ...baseInput(),
      layers: [
        { name: 'spaced', eff: 20, angle: 30, thickness: 20, seg: 0, chance: 0.5, layerChance: 1 },
        { name: 'hull', eff: 200, angle: 30, thickness: 220, seg: 0, chance: 0.5, layerChance: 0 },
      ],
      overallChance: 0.5,
      cardChance: 0.5,
    })
    // 总体仍是“可能击穿”黄标题；层行圆点分别表达本层状态。
    expect(html).toContain('font-weight:bold;color:var(--yellow);margin-bottom')
    expect(html).toContain('color:var(--green);">●')
    expect(html).toContain('color:var(--red);">●')
  })
  it('提供 layerRoles 时直接消费（与 3D 层点同一数组，不再自行推导）', () => {
    const html = renderShotResultCardHtml({
      ...baseInput(),
      layers: [
        { name: 'spaced', eff: 20, angle: 30, thickness: 20, seg: 0, layerChance: 0 },
        { name: 'hull', eff: 30, angle: 30, thickness: 30, seg: 0, layerChance: 1 },
      ],
      layerRoles: ['PENETRATION', 'UNREACHED'],
      overallChance: 1,
      cardChance: 1,
    })
    expect(html).toContain('color:var(--green);">●')
    expect(html).toContain('color:var(--muted);">●')
    expect(html).not.toContain('color:var(--red);">●')
  })
  it('真实概率链：首层必穿、次层挡下、第三层未到达 → 绿/红/灰三色', () => {
    const chain = evaluateProbabilityChain(200, [
      { name: 'spaced', eff: 20, thickness: 20, angle: 30, seg: 0 },
      { name: 'hull', eff: 300, thickness: 300, angle: 30, seg: 0 },
      { name: 'turret', eff: 80, thickness: 80, angle: 30, seg: 0 },
    ])
    const html = renderShotResultCardHtml({
      ...baseInput(),
      layers: chain.layers,
      overallChance: chain.chance,
      hasChance: chain.chance > 0,
      chancePartial: chain.chance > 0 && chain.chance < 1,
      cardChance: chain.chance,
    })
    expect(chain.layers.map((layer) => layer.layerChance)).toEqual([1, 0, 0])
    expect(chain.layers.map((layer) => layer.reached)).toEqual([true, true, false])
    expect(html).toContain('color:var(--green);">●')
    expect(html).toContain('color:var(--red);">●')
    expect(html).toContain('color:var(--muted);">●')
  })
})

describe('shotResultCard · HE 命中 / 溅射 / 采样不可用', () => {
  const heInfo = { splash_min: 90, splash_max: 130, splash_avg: 110, explosion_radius: 3, expected_damage: 255 }
  it('可能击穿的 HE：满伤 + 溅射范围小字 + expected damage 行', () => {
    const html = renderShotResultCardHtml({ ...baseInput(), heInfo, heChance: 0.5, dmgVal: 440, cardChance: 0.5 })
    expect(html).toContain('<span>May penetrate</span>')
    expect(html).toContain('· 440 <span style="font-size:12px;color:var(--muted);font-weight:normal;">(splash damage 110 · 90 - 130)</span>')
    expect(html).toContain('expected damage: 255')
    expect(html).toContain('splash radius: 3 m')
  })
  it('HE 100%：PENETRATION 满伤、无溅射小字、无 expected 行', () => {
    const html = renderShotResultCardHtml({ ...baseInput(), heInfo, heChance: 1, dmgVal: 440 })
    expect(html).toContain('<span>PENETRATION</span>')
    expect(html).toContain('· 440</span>')
    expect(html).not.toContain('splash damage')
    expect(html).not.toContain('expected damage')
  })
  it('0% 有效溅射：SPLASH 橙标题 + avg 伤害 + 范围小字', () => {
    const html = renderShotResultCardHtml({ ...baseInput(), heInfo, heChance: 0, cardChance: 0, dmgVal: 440 })
    expect(html).toContain('<span>SPLASH</span>')
    expect(html).toContain('· avg 110 <span style="font-size:12px;color:var(--muted);font-weight:normal;">(90 - 130)</span>')
    expect(html).toContain('font-weight:bold;color:var(--orange);margin-bottom')
  })
  it('0% 无溅射：BLOCKED + 显式 0', () => {
    const dry = { splash_min: 0, splash_max: 0, splash_avg: 0, explosion_radius: 3 }
    const html = renderShotResultCardHtml({ ...baseInput(), heInfo: dry, heChance: 0, cardChance: 0, dmgVal: 440 })
    expect(html).toContain('<span>BLOCKED</span>')
    expect(html).toContain('· 0</span>')
  })
  it('采样不可用：ERROR 标题、伤害 —、概率行换成显式原因', () => {
    const html = renderShotResultCardHtml({
      ...baseInput(), heInfo: { ...heInfo, unavailable: true, reason: 'collision-grid:missing' }, heChance: 0, cardChance: 0, dmgVal: 440,
    })
    expect(html).toContain('<span>ERROR</span>')
    expect(html).toContain('· —</span>')
    expect(html).toContain('splash sampling unavailable<span style="color:var(--muted);"> · collision-grid:missing</span>')
    expect(html).not.toContain('penetration chance')
  })
  it('直接命中行：位置 + 名义厚度，无等效/角度/概率', () => {
    const html = renderShotResultCardHtml({
      ...baseInput(), heInfo, heChance: 0.5, dmgVal: 440, cardChance: 0.5,
      heDirectHit: { name: 'hull front', thickness: 250 },
    })
    expect(html).toContain('direct hit:</span>')
    expect(html).toContain('hull front</span>')
    expect(html).toContain('250mm</span>')
    expect(html).not.toContain('@')
  })
  it('最佳样本：前 4 层 + 剩余层数 + 距离；upper/lower 不同时两行', () => {
    const bestLayers = Array.from({ length: 6 }, () => ({ section: 'hull', armor: 50 }))
    const same = renderShotResultCardHtml({
      ...baseInput(),
      heInfo: { ...heInfo, best: { distance: 0.1, layers: bestLayers } },
      heChance: 0.5, dmgVal: 440, cardChance: 0.5,
    })
    expect(same).toContain('best sample: hull 50mm → hull 50mm → hull 50mm → hull 50mm → +2 @ 0.10 m')
    const split = renderShotResultCardHtml({
      ...baseInput(),
      heInfo: { ...heInfo, best: { distance: 0.1, armor: 50, layers: bestLayers }, best_lower: { distance: 0.2, armor: 60, layers: bestLayers } },
      heChance: 0.5, dmgVal: 440, cardChance: 0.5,
    })
    expect(split).toContain('best sample (upper): hull 50mm → hull 50mm → hull 50mm → hull 50mm → +2 @ 0.10 m')
    expect(split).toContain('best sample (lower): hull 50mm → hull 50mm → hull 50mm → hull 50mm → +2 @ 0.20 m')
  })
})

describe('shotResultCard · 跳弹多段与概率层着色', () => {
  const ricLayers = [
    { name: 'upper plate', eff: 200, angle: 30, thickness: 220, penetrated: false, ricochet: true, seg: 0 },
    { name: 'lower plate', eff: 100, angle: 20, thickness: 110, penetrated: true, seg: 1 },
  ]
  it('两段结果：分隔线 + 段标题 + 概率行只在最终段', () => {
    const html = renderShotResultCardHtml({
      ...baseInput(),
      result: 'RICOCHET → PENETRATION',
      layers: ricLayers,
      partialChainLayers: [{ seg: 0, chance: 0 }, { seg: 1, chance: 0.6 }],
      probabilityMode: false,
      overallChance: 0,
      hasChance: false,
      chancePartial: true,
      cardChance: 0.6,
    })
    expect(html).toContain('<span>RICOCHET</span>')
    expect(html).toContain('ricochet (-25% penetration)</span>')
    expect(html).toContain('<span>May penetrate</span>')
    expect(html).toContain('penetration chance: 60%')
    expect(html).toContain('· 400</span>')   // 1–99% 中段满伤，不是确定性 0
    // 跳弹段紫色（热力图同色相）、最终段按累计概率黄色
    expect(html).toContain('color:var(--purple);">●')
    expect(html).toContain('color:var(--yellow);">●')
  })
  it('续飞段的跳弹层仍保持跳弹紫（不被累计概率染黄）', () => {
    const html = renderShotResultCardHtml({
      ...baseInput(),
      result: 'RICOCHET → RICOCHET',
      layers: [
        { name: 'upper plate', eff: 200, angle: 30, thickness: 220, penetrated: false, ricochet: true, seg: 0 },
        { name: 'spaced plate', eff: 20, angle: 60, thickness: 20, penetrated: false, ricochet: true, seg: 1 },
      ],
      partialChainLayers: [{ seg: 0, chance: 0 }, { seg: 1, chance: 0.6 }],
      probabilityMode: false,
      overallChance: 0,
      hasChance: false,
      chancePartial: true,
      cardChance: 0.6,
    })
    expect((html.match(/color:var\(--purple\);">●/g) || [])).toHaveLength(2)
    expect(html).not.toContain('color:var(--yellow);">●')
  })
  it('非概率模式无 partial 链时最终段保持确定性着色', () => {
    const html = renderShotResultCardHtml({
      ...baseInput(),
      result: 'BLOCKED',
      layers: [{ name: 'hull', eff: 200, angle: 30, thickness: 220, penetrated: false, seg: 0 }],
      probabilityMode: false,
      overallChance: 0,
      hasChance: false,
      chancePartial: false,
      cardChance: 0,
    })
    expect(html).toContain('<span>BLOCKED</span>')
    expect(html).toContain('color:var(--red);">●')
    expect(html).toContain('· 0</span>')
  })
})

describe('shotResultCard · 无主装甲（blockedNoPrimary）', () => {
  it('终态 BLOCKED：不回填概率/满伤，层点全红，显示原因行', () => {
    const html = renderShotResultCardHtml({
      ...baseInput(),
      result: 'BLOCKED',
      layers: [{ name: 'track', thickness: 20, seg: 0 }],
      probabilityMode: false,
      overallChance: 0,
      hasChance: false,
      chancePartial: false,
      blockedNoPrimary: true,
      dmgDealt: 0,
      cardChance: 0,
    })
    expect(html).toContain('<span>BLOCKED</span>')
    expect(html).toContain('No primary armor hit; treated as non-penetration')
    expect(html).toContain('· 0</span>')
    expect(html).toContain('color:var(--red);">●')
    expect(html).not.toContain('May penetrate')
  })
})

describe('shotResultCard · 逐层明细格式', () => {
  it('主装甲：等效@角度 + nominal；HEAT 间隙：距离 + loss；外部模块：flat 厚度 + blocked', () => {
    const html = renderShotResultCardHtml({
      ...baseInput(),
      result: 'BLOCKED',
      layers: [
        { name: 'hull front', eff: 248.4, angle: 30.2, thickness: 250, penetrated: false, seg: 0 },
        { name: 'Gap 1.50m', gap: true, thickness: 0, seg: 0 },
        { name: 'chassis', thickness: 20, penetrated: false, seg: 0 },
      ],
      probabilityMode: false,
      overallChance: 0,
      hasChance: false,
      chancePartial: false,
      cardChance: 0,
    })
    expect(html).toContain('248.4mm @ 30°')
    expect(html).toContain('nominal 250mm')
    expect(html).toContain('1500mm')
    expect(html).toContain('loss -75%')
    expect(html).toContain('>20mm</span>')
    expect(html).toContain('blocked</span>')
  })
  it('非跳弹的 0mm 板不显示“跳弹 (-25% 穿深)”子标签', () => {
    const html = renderShotResultCardHtml({
      ...baseInput(),
      result: 'BLOCKED',
      layers: [{ name: '0mm plate', thickness: 0, angle: 0, penetrated: false, seg: 0 }],
      probabilityMode: false,
      overallChance: 0,
      hasChance: false,
      chancePartial: false,
      cardChance: 0,
    })
    expect(html).toContain('0mm @ 0°')
    expect(html).not.toContain('ricochet (-25% penetration)')
  })
  it('概率模式：外部模块 chance=0 显示 blocked，层点按累计概率着色', () => {
    const html = renderShotResultCardHtml({
      ...baseInput(),
      result: 'PENETRATION',
      layers: [
        { name: 'chassis', thickness: 20, seg: 0, chance: 1 },
        { name: 'hull', eff: 100, angle: 0, thickness: 100, seg: 0, chance: 0.4 },
      ],
      overallChance: 0.4,
      cardChance: 0.4,
    })
    expect(html).toContain('color:var(--green);">●')
    expect(html).toContain('color:var(--yellow);">●')
  })
})

describe('shotResultCard · 片元校验徽标', () => {
  it('fragValidated=false：输出黄色徽标；true/null 静默', () => {
    const mismatch = renderShotResultCardHtml({ ...baseInput(), fragValidated: false })
    expect(mismatch).toContain('data-card-badge="frag-mismatch"')
    expect(mismatch).toContain('▲ fragment check differs from the server armor group')
    expect(renderShotResultCardHtml({ ...baseInput(), fragValidated: true })).not.toContain('data-card-badge="frag-mismatch"')
    expect(renderShotResultCardHtml(baseInput())).not.toContain('data-card-badge="frag-mismatch"')
  })
})

describe('shotResultCard · 非概率模式边框按结果角色着色', () => {
  it('RICOCHET → 紫；BLOCKED → 红；PENETRATION → 绿', () => {
    const base = { ...baseInput(), probabilityMode: false, overallChance: 0, hasChance: false, chancePartial: false, cardChance: 0 }
    expect(renderShotResultCardHtml({ ...base, result: 'RICOCHET', resultRole: 'RICOCHET' })).toContain('border-left:4px solid var(--purple)')
    expect(renderShotResultCardHtml({ ...base, result: 'BLOCKED', resultRole: 'BLOCKED' })).toContain('border-left:4px solid var(--red)')
    expect(renderShotResultCardHtml({ ...base, result: 'PENETRATION', resultRole: 'PENETRATION' })).toContain('border-left:4px solid var(--green)')
  })
})

describe('shotResultCard · labels 三语与 HTML escaping', () => {
  it('未可信文本（层名/labels 注入）必须转义，不得出现可执行 HTML', () => {
    const html = renderShotResultCardHtml({
      ...baseInput(),
      layers: [{ name: '"><script>alert(1)</script>', thickness: 20, seg: 0 }],
      overallChance: 0.4,
      cardChance: 0.4,
      labels: { ...EN, mayPenetrate: '<b>May</b> penetrate' },
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>May</b>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&quot;&gt;')
    expect(html).toContain('&lt;b&gt;May&lt;/b&gt; penetrate')
    // title 属性同样转义
    expect(html).toContain('title="&quot;&gt;&lt;script&gt;')
  })
  it('中文 labels：判定/概率行/顶行走宿主注入文案', () => {
    const ZH: ShotResultCardLabels = {
      ...EN,
      shotDistance: '交战距离', effectivePenetration: '有效穿深',
      mayPenetrate: '可能击穿', shotPenChance: '击穿概率',
      resultName: (r) => ({ PENETRATION: '击穿', BLOCKED: '未击穿', RICOCHET: '跳弹', SPLASH: '溅射', ERROR: '错误' })[r] ?? r,
    }
    const html = renderShotResultCardHtml({ ...baseInput(), overallChance: 0.4, cardChance: 0.4, distVal: 15, labels: ZH })
    expect(html).toContain('<span>可能击穿</span>')
    expect(html).toContain('击穿概率: 40%')
    expect(html).toContain('交战距离: 15 m')
    expect(html).toContain('有效穿深: 200mm')
    expect(html).not.toContain('May penetrate')
  })
  it('俄文 labels：结果名与距离行', () => {
    const RU: ShotResultCardLabels = {
      ...EN,
      shotDistance: 'Дистанция боя', distanceUnit: 'м',
      mayPenetrate: 'Может пробить', shotPenChance: 'шанс пробития',
      resultName: (r) => ({ PENETRATION: 'ПРОБИТИЕ', BLOCKED: 'ЗАБЛОКИРОВАНО' })[r] ?? r,
    }
    const html = renderShotResultCardHtml({ ...baseInput(), distVal: 15, labels: RU })
    expect(html).toContain('<span>ПРОБИТИЕ</span>')
    expect(html).toContain('шанс пробития: 100%')
    expect(html).toContain('Дистанция боя: 15 м')
  })
})

describe('shotResultCard · 卡片尺寸与 HTML 语义', () => {
  it('紧凑档与普通档使用注入的 cardMetrics（padding/字号随档位）', () => {
    const compact = renderShotResultCardHtml({ ...baseInput(), cardMetrics: shotResultCardMetrics(true) })
    expect(compact).toContain('padding:4px 8px')
    expect(compact).toContain('font-size:13px;font-weight:bold')
    const normal = renderShotResultCardHtml(baseInput())
    expect(normal).toContain('padding:10px 16px')
    expect(normal).toContain('font-size:18px;font-weight:bold')
  })
  it('maxWidth 注入 360 时输出 max-width 上限；null 时不设上限', () => {
    expect(renderShotResultCardHtml({ ...baseInput(), cardMaxWidth: 360 })).toContain('max-width:360px;')
    expect(renderShotResultCardHtml(baseInput())).not.toContain('max-width:')
  })
  it('顶行 join、卡片根节点与层行结构保持原语义', () => {
    const html = renderShotResultCardHtml({
      ...baseInput(), distVal: 15,
      layers: [{ name: 'hull', eff: 200, angle: 30, thickness: 220, penetrated: true, seg: 0 }],
    })
    expect(html.startsWith('<div style="background:var(--tooltip-bg)')).toBe(true)
    expect(html.endsWith('</div>')).toBe(true)
    expect(html).toContain('border-left:4px solid var(--green)')
    expect(html).toContain('effective penetration: 200mm')
    expect(html).toContain('>●</span>')
    // 概率行用 tabular-nums
    expect(html).toContain('font-variant-numeric:tabular-nums;')
  })
})
