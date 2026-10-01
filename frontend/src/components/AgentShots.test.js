// @vitest-environment happy-dom
/**
 * AgentShots 状态链回归（契约 v0.1.9 fail-visible 评审 blocker）：
 * - author_path="error" 且他人宽松路径 0 发 → 警示必须可见，且与空态并存——
 *   绝不允许只显示"没有射击"把作者链失败伪装成正常空结果；
 * - 正常 outcome 不出警示。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const i18n = vi.hoisted(() => ({ t: vi.fn((key) => key) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: i18n.t }) }))

const parseAgentShotsFromBytes = vi.hoisted(() => vi.fn())
const parseAgentPlaybackFromBytes = vi.hoisted(() => vi.fn())
vi.mock('../api/agent-replay-facets.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    parseAgentShotsFromBytes,
    parseAgentPlaybackFromBytes,
  }
})

vi.mock('../scene/agentData.js', () => ({
  tankImageUrl: (id) => `img:${id}`,
  storeShotsForViewer: vi.fn(),
  fetchTankData: async () => ({ configs: [] }),
}))

import AgentShots from './AgentShots.vue'

function mkFile() {
  return new File([new Uint8Array([1, 2, 3, 4])], 'cn.wotbreplay')
}

async function mountAndPick() {
  const wrapper = mount(AgentShots, { global: { mocks: { $t: i18n.t } } })
  const input = wrapper.find('input[type="file"]')
  // @vue/test-utils 禁止经 trigger 注入 target——直接在元素上定义 files 后触发
  Object.defineProperty(input.element, 'files', {
    value: [mkFile()], configurable: true,
  })
  await input.trigger('change')
  // 解析链有多层 await（含动态 import JSON 的模块加载）——轮询至终态而非定数 tick
  await vi.waitFor(() => {
    if (!wrapper.text().includes('agentShots.no_shots') && wrapper.findAll('table').length === 0) {
      throw new Error('still parsing')
    }
  }, { timeout: 3000 })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  parseAgentShotsFromBytes.mockReset()
  parseAgentPlaybackFromBytes.mockReset()
  parseAgentPlaybackFromBytes.mockResolvedValue({ vehicles: [] })
})

describe('AgentShots author_path fail-visible（评审 blocker 回归）', () => {
  it('author_path=error 且 shots=[] → 警示可见并与空态并存（不得只显示 no_shots）', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [],
      author_path: 'error',
      author_error: 'shot #1: 受击者实体 0x123 不在 type=5 名册中',
      author_eid: 7,
      others: { total_launches: 0, skipped_no_endpoint: 0, skipped_no_target_state: 0, muzzle_fallback: 0 },
    })
    const wrapper = await mountAndPick()
    const warn = wrapper.findAll('.status.warn')
    expect(warn.length).toBe(1)
    expect(warn[0].text()).toContain('agentShots.author_path_error')
    expect(warn[0].attributes('title')).toContain('type=5 名册')
    // 与空态并存：no_shots 仍渲染（用户知道确实 0 发），但警示是第一眼信息
    expect(wrapper.text()).toContain('agentShots.no_shots')
  })

  it('author_path=ok → 无警示', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [],
      author_path: 'ok',
      author_eid: 7,
      others: { total_launches: 12, skipped_no_endpoint: 0, skipped_no_target_state: 0, muzzle_fallback: 0 },
    })
    const wrapper = await mountAndPick()
    expect(wrapper.findAll('.status.warn').length).toBe(0)
  })

  it('shooter 分组三态：ally/enemy/unknown（unknown 绝不并入 Allies——评审 blocker 回归）', async () => {
    parseAgentPlaybackFromBytes.mockResolvedValue({
      vehicles: [
        { eid: 100, nickname: '名雅山庄', team: 1, tank_id: 30085, is_author: true },
        { eid: 200, nickname: '林肝美', team: 2, tank_id: 40085 },
        { eid: 300, nickname: '观察者', team: 0, tank_id: 0 },
      ],
    })
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [
        { index: 1, time_s: 5, damage: 100, target_name: 'x', is_kill: false, shooter_eid: 100, shooter_name: '名雅山庄', target_eid: 200, hit_flags: 16, game_hit_result: 3, shell_id: 0 },
        { index: 2, time_s: 6, damage: 100, target_name: 'y', is_kill: false, shooter_eid: 200, shooter_name: '林肝美', target_eid: 100, hit_flags: 0, game_hit_result: 255, shell_id: 0 },
        { index: 3, time_s: 7, damage: 0, target_name: '', is_kill: false, shooter_eid: 300, hit_flags: 0, game_hit_result: 255, shell_id: 0 },
      ],
      author_path: 'ok',
      author_eid: 100,
      others: { total_launches: 3, skipped_no_endpoint: 0, skipped_no_target_state: 0, muzzle_fallback: 0 },
    })
    const wrapper = await mountAndPick()
    const labels = wrapper.findAll('optgroup').map((g) => g.attributes('label'))
    expect(labels).toEqual(['agentShots.allies', 'agentShots.enemies', 'agentShots.unknown_side'])
    const options = wrapper.findAll('option').map((o) => o.text())
    expect(options.some((t) => t.startsWith('名雅山庄'))).toBe(true)
    expect(options.some((t) => t.startsWith('林肝美'))).toBe(true)
    expect(options.some((t) => t.startsWith('eid:300'))).toBe(true)
  })

  it('author_path=error 但他人路径有 shots → 警示与表格并存', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [{
        index: 1, time_s: 5, damage: 100, target_name: '林肝美', is_kill: false,
        shooter_eid: 200, target_eid: 101, hit_flags: 0, game_hit_result: 255, shell_id: 0,
      }],
      author_path: 'error',
      author_error: 'boom',
      author_eid: 7,
      others: { total_launches: 1, skipped_no_endpoint: 0, skipped_no_target_state: 0, muzzle_fallback: 0 },
    })
    const wrapper = await mountAndPick()
    expect(wrapper.findAll('.status.warn').length).toBe(1)
    expect(wrapper.find('table.shot-table').exists()).toBe(true)
    // 命中在案（target_eid）但结果未知（255）→ "命中·结果未知"，不得伪装成未击穿
    expect(wrapper.text()).toContain('agentShots.res_hit_unknown')
    expect(wrapper.text()).not.toContain('agentShots.res_miss')
    expect(wrapper.text()).not.toContain('agentShots.res_nopen')
  })
})
