import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 源码级守卫只锁「谁拥有什么」；真实几何（Team 1 | 正方形 Stage | Team 2、传输控件在 Stage 之下、
// 详情可拖过三栏）由 test:browser-interaction 的 ws2d-*-fullscreen 场景在真实全屏里断言。
const read = (name) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const mobileFs = strip(read('./playback-mobile-fullscreen.css'))
const workspace = strip(read('./playback-workspace.css'))

function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(?:^|[}\\s,])${escaped}\\s*\\{([^}]*)\\}`))
  return match ? match[1] : null
}

describe('mobile fullscreen playback = same square-Stage workspace', () => {
  it('has no persistent rail column and no Details column / sheet', () => {
    expect(ruleBody(mobileFs, '.battle-playback.pb-form-mobile:fullscreen')).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(ruleBody(mobileFs, '.battle-playback.pb-form-mobile:fullscreen:not(.pb-drawer-open) .pb-left-rail')).toContain('display: none')
    // 旧的 Details 抽屉 / sheet / 详情列规则全部移除
    expect(mobileFs).not.toContain('pb-side-panel-shell')
    expect(mobileFs).not.toContain('pb-sidebar')
    expect(mobileFs).not.toContain('--pb-rail-w')
  })

  it('lays out Team 1 | Stage | Team 2 with phone-width lanes and the transport in the centre column', () => {
    expect(ruleBody(mobileFs, '.battle-playback.pb-form-mobile.pb-roster-lanes:fullscreen .pb-main'))
      .toContain('grid-template-columns: var(--pb-lane-w-phone) minmax(0, 1fr) var(--pb-lane-w-phone)')
    const overlay = ruleBody(mobileFs, '.battle-playback.pb-form-mobile.pb-roster-lanes:fullscreen .pb-mobile-overlay')
    expect(overlay).toContain('left: calc(var(--pb-lane-w-phone) + var(--space-2))')
    expect(overlay).toContain('right: calc(var(--pb-lane-w-phone) + var(--space-2))')
    // 瞬时浮层的外层透传指针：不能吞掉 Stage 与详情拖动柄上的触摸
    expect(ruleBody(mobileFs, '.battle-playback.pb-form-mobile:fullscreen .pb-mobile-overlay')).toContain('pointer-events: none')
  })

  it('takes the generic fullscreen square-Stage rules from playback-workspace.css', () => {
    expect(ruleBody(workspace, '.battle-playback:fullscreen .pb-main')).toContain('padding-block-start: var(--pb-hud-h, 48px)')
    expect(ruleBody(workspace, '.battle-playback.pb-roster-lanes:fullscreen .pb-main > .pb-map-stage')).toContain('grid-column: 2')
    const map = ruleBody(workspace, '.battle-playback:fullscreen .pb-main .pb-map')
    expect(map).toContain('aspect-ratio: 1 / 1')
    expect(map).toContain('var(--pb-square-avail-h')
  })
})
