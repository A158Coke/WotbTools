// 回放血条 / 左右状态条外形契约（2026-11-19 用户口径）：
// 车辆名牌 HP/装填条、HUD 左右队伍血条、名册行血条统一为矩形，不再使用胶囊圆角；
// 圆角只保留在卡片、徽章等容器上。用 source-level 规则守卫，防止主题/样式重构把圆角加回来。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')
const rule = (src, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = src.match(new RegExp('(?:^|\\n)\\s*' + escaped + '\\s*\\{([^}]*)\\}'))
  return m ? m[1] : ''
}

describe('回放血条与左右状态条：矩形外形', () => {
  it('车辆名牌 HP / 装填条', () => {
    const body = rule(read('./PlaybackVehicleLabel.vue'), '.pb-hp-bar, .reload-bar')
    expect(body).toContain('border-radius: 0')
    expect(body).not.toContain('--radius-full')
    expect(body).not.toContain('corner-shape')
  })

  it('HUD 左右队伍血条（2D / 3D 共用）', () => {
    const body = rule(read('./BattlePlaybackHud.vue'), '.pb-hud-track')
    expect(body).toContain('border-radius: 0')
    expect(body).not.toContain('--radius-full')
    expect(body).not.toContain('corner-shape')
  })

  it('名册行血条（行背景即 track）', () => {
    const body = rule(read('./PlaybackRoster.vue'), '.pb-roster-row')
    expect(body).toContain('border-radius: 0')
    expect(body).not.toContain('--radius-full')
  })
})