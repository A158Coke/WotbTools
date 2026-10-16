// @vitest-environment happy-dom
/**
 * 3D 标签覆盖层的锚点契约：setAnchor **同步拷贝**进自有 per-eid 存储，不持有调用方
 * 对象引用。场景内核逐帧逐车复用同一个 scratch 对象喂所有 eid（60Hz ×14 的分配热路径），
 * 若这里存引用，全部 eid 会共享最后一辆车的坐标——这是无 GPU 单测里唯一能锁的观察面。
 */
import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import { mount } from '@vue/test-utils'
import PlaybackVehicleLabels3D from './PlaybackVehicleLabels3D.vue'

const i18n = createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: {} } })

const mountOverlay = (props = {}) => mount(PlaybackVehicleLabels3D, {
  props: { labelPrefs: {}, hpPrefs: {}, ...props },
  global: { plugins: [i18n] },
})

const row = (eid) => ({
  eid, playerName: `p${eid}`, tankName: 'Maus', friendly: true, destroyed: false,
  lastKnown: false, hp: null, reload: null, hpGhost: null, hpFlash: null,
})

const hpRow = (eid) => ({ ...row(eid), hp: { current: 800, pct: 80, state: 'CURRENT' } })

/** happy-dom 不做布局：几何一律显式 stub（这是本组测试要锁的真实输入）。 */
const rect = (left, top, width, height) => ({
  left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}),
})
const stubRect = (el, r) => { el.getBoundingClientRect = () => r }

describe('PlaybackVehicleLabels3D setAnchor 拷贝契约', () => {
  it('class icons preserve visible anchors, tank identity and selectable entity while hiding extra label lines', async () => {
    const wrapper = mountOverlay()
    await wrapper.setProps({ markerPrefs: { classIcons: true }, labelPrefs: { showPlayerName: false, showTankName: true, showReload: false }, hpPrefs: { showHp: false }, selectedEid: 7 })
    wrapper.vm.setLabels([{ ...row(7), tankClass: 'Heavy tank', hp: { current: 100, pct: 50, state: 'CURRENT' }, reload: [{ state: 'loading', progress: .5 }] }])
    await nextTick()
    wrapper.vm.setAnchor(7, { x: 50, y: 60, visible: true, occluded: false })
    expect(wrapper.text()).toBe('Maus')
    expect(wrapper.get('.vehicle-class-button').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-tank-class]').attributes('data-tank-class')).toBe('HT')
    expect(wrapper.find('.pb-hp-hud').exists()).toBe(false)
    expect(wrapper.find('.reload-bar').exists()).toBe(false)
    await wrapper.get('.vehicle-class-button').trigger('click')
    expect(wrapper.emitted('select')[0][0]).toBe(7)
    wrapper.vm.setAnchor(7, { x: 50, y: 60, visible: false, occluded: false })
    expect(wrapper.get('.vehicle-label-anchor').element.hidden).toBe(true)
    wrapper.unmount()
  })
  it('同一 scratch 对象喂多个 eid：各自保留自己那一次的值（不共享最后写入）', async () => {
    const wrapper = mountOverlay()
    wrapper.vm.setLabels([row(1), row(2)])
    await nextTick()   // 等 v-for 的 ref 绑定完成

    const scratch = { x: 0, y: 0, visible: false, occluded: false }
    scratch.x = 10; scratch.y = 20; scratch.visible = true
    wrapper.vm.setAnchor(1, scratch)
    scratch.x = 300; scratch.y = 400; scratch.occluded = true
    wrapper.vm.setAnchor(2, scratch)

    const [a, b] = wrapper.findAll('.vehicle-label-anchor')
    expect(a.attributes('data-eid')).toBe('1')
    expect(a.element.style.transform).toContain('translate(10px, 20px)')
    expect(a.element.classList.contains('label-occluded')).toBe(false)
    expect(b.element.style.transform).toContain('translate(300px, 400px)')
    expect(b.element.classList.contains('label-occluded')).toBe(true)
    wrapper.unmount()
  })

  it('重挂（v-for 重建 ref）后用内部存储重绘，且更新走复用对象（不重建条目）', async () => {
    const wrapper = mountOverlay()
    wrapper.vm.setLabels([row(7)])
    await nextTick()

    const scratch = { x: 5, y: 6, visible: true, occluded: false }
    wrapper.vm.setAnchor(7, scratch)
    const el = wrapper.get('.vehicle-label-anchor')
    expect(el.element.style.transform).toContain('translate(5px, 6px)')

    scratch.x = 50; scratch.y = 60
    wrapper.vm.setAnchor(7, scratch)
    await nextTick()
    expect(wrapper.get('.vehicle-label-anchor').element.style.transform).toContain('translate(50px, 60px)')
    wrapper.unmount()
  })
})

/**
 * 伤害数字的落点契约：出生在受击车 **HP 血条右侧**（不覆盖血条本身），HP 关掉退回名牌
 * 右侧，整块名牌关掉退回锚点上方（车辆模型上方）。名牌是 canvas 之上的 HTML 层，
 * 数字与它同层后位置只能来自 DOM 几何——这是无 GPU 单测里能锁的真实输入输出。
 */
describe('PlaybackVehicleLabels3D 伤害数字落点', () => {
  afterEach(() => vi.useRealTimers())

  /** 挂一块名牌（锚点几何 = 名牌块底边中点）并返回 { wrapper, anchorEl } */
  async function mountedLabel({ hpPrefs = { showHp: true }, rowValue = hpRow(7), markerPrefs } = {}) {
    const wrapper = mountOverlay({ hpPrefs, markerPrefs })
    wrapper.vm.setLabels([rowValue])
    await nextTick()
    const anchorEl = wrapper.get('.vehicle-label-anchor').element
    stubRect(anchorEl, rect(100, 40, 40, 60))   // 锚点 = (120, 100)
    return { wrapper, anchorEl }
  }
  const shownAnchor = { x: 120, y: 100, visible: true, occluded: false, projected: true }

  it('落在血条右缘 + 间隙、垂直居中于血条：不覆盖血条，也不覆盖名牌文本', async () => {
    vi.useFakeTimers()
    const { wrapper } = await mountedLabel()
    stubRect(wrapper.get('.pb-hp-bar').element, rect(108, 64, 24, 16))   // 右缘 132、中心 72
    wrapper.vm.spawnDamage(7, 342, 2000)
    await nextTick()                                   // 等伤害节点挂载（ref 绑定）
    wrapper.vm.setAnchor(7, shownAnchor)
    const el = wrapper.get('[data-test="pb-damage"]')
    expect(el.text()).toBe('-342')
    expect(el.element.hidden).toBe(false)
    expect(el.element.style.transform).toBe('translate3d(140px, 72px, 0)')
    // 数字左缘 140 > 血条右缘 132：不覆盖血条
    wrapper.unmount()
  })

  it('血条关掉但名牌仍在 → 退回名牌块右侧；血条 / 名牌都没有内容 → 退回锚点上方', async () => {
    vi.useFakeTimers()
    const { wrapper, anchorEl } = await mountedLabel({
      hpPrefs: { showHp: false },
      rowValue: { ...row(7), hp: null },
    })
    expect(wrapper.find('.pb-hp-bar').exists()).toBe(false)
    stubRect(wrapper.get('.vehicle-label').element, rect(104, 50, 32, 40))   // 右缘 136、中心 70
    wrapper.vm.spawnDamage(7, 400, 2000)
    await nextTick()
    wrapper.vm.setAnchor(7, shownAnchor)
    expect(wrapper.get('[data-test="pb-damage"]').element.style.transform).toBe('translate3d(144px, 70px, 0)')

    // 名牌整块没有可见内容（姓名也关）→ 落回锚点上方
    wrapper.vm.clearDamages()
    await nextTick()
    stubRect(wrapper.get('.vehicle-label').element, rect(120, 100, 0, 0))
    wrapper.vm.spawnDamage(7, 400, 2000)
    await nextTick()
    wrapper.vm.setAnchor(7, shownAnchor)
    expect(wrapper.get('[data-test="pb-damage"]').element.style.transform).toBe('translate3d(120px, 80px, 0)')
    expect(anchorEl.hidden).toBe(false)
    wrapper.unmount()
  })

  it('整层名牌关掉（关名牌）→ 车辆模型上方仍然显示；车辆不在视锥内 → 不显示', async () => {
    vi.useFakeTimers()
    const { wrapper } = await mountedLabel()
    wrapper.vm.spawnDamage(7, 500, 2000)
    await nextTick()
    // 关名牌：visible=false，但车辆仍在视锥内（projected）
    wrapper.vm.setAnchor(7, { ...shownAnchor, visible: false })
    const el = wrapper.get('[data-test="pb-damage"]')
    expect(el.element.hidden).toBe(false)
    expect(el.element.style.transform).toBe('translate3d(120px, 80px, 0)')

    // 出屏 / 车体不可见：hidden（下一帧回来再定位）
    wrapper.vm.spawnDamage(7, 600, 2000)
    await nextTick()
    wrapper.vm.setAnchor(7, { ...shownAnchor, projected: false })
    expect(wrapper.findAll('[data-test="pb-damage"]')[1].element.hidden).toBe(true)
    wrapper.unmount()
  })

  it('连续受击：同车多个数字错开槽位，不完全重叠', async () => {
    vi.useFakeTimers()
    const { wrapper } = await mountedLabel()
    stubRect(wrapper.get('.pb-hp-bar').element, rect(108, 64, 24, 16))
    wrapper.vm.spawnDamage(7, 300, 2000)
    wrapper.vm.spawnDamage(7, 200, 2000)
    await nextTick()
    wrapper.vm.setAnchor(7, shownAnchor)
    const [a, b] = wrapper.findAll('[data-test="pb-damage"]')
    expect(a.element.style.transform).toBe('translate3d(140px, 72px, 0)')
    expect(b.element.style.transform).toBe('translate3d(140px, 92px, 0)')
    wrapper.unmount()
  })

  it('车辆贴屏幕右缘、右侧放不下 → 镜像到血条左侧（不被 viewport 裁掉、不覆盖血条）', async () => {
    vi.useFakeTimers()
    const { wrapper } = await mountedLabel()
    stubRect(wrapper.get('.pb-hp-bar').element, rect(108, 64, 24, 16))
    Object.defineProperty(wrapper.get('.vehicle-label-overlay').element, 'clientWidth', { value: 200 })
    wrapper.vm.spawnDamage(7, 1234, 2000)
    await nextTick()
    Object.defineProperty(wrapper.get('[data-test="pb-damage"]').element, 'offsetWidth', { value: 90 })
    wrapper.vm.setAnchor(7, shownAnchor)
    // 140 + 90 > 200 → 镜像：血条左缘 108 − 间隙 8 − 宽度 90 = 10，右缘恰好贴住血条左缘
    expect(wrapper.get('[data-test="pb-damage"]').element.style.transform).toBe('translate3d(10px, 72px, 0)')
    wrapper.unmount()
  })

  it('到期自动摘除；seek / 会话重置清空（不补播历史数字）', async () => {
    vi.useFakeTimers()
    const { wrapper } = await mountedLabel()
    wrapper.vm.spawnDamage(7, 400, 2000)
    await nextTick()
    expect(wrapper.findAll('[data-test="pb-damage"]')).toHaveLength(1)
    vi.advanceTimersByTime(2000)
    await nextTick()
    expect(wrapper.findAll('[data-test="pb-damage"]')).toHaveLength(0)

    wrapper.vm.spawnDamage(7, 400, 2000)
    wrapper.vm.clear()
    await nextTick()
    expect(wrapper.findAll('[data-test="pb-damage"]')).toHaveLength(0)
    wrapper.unmount()
  })

  it('关掉"车辆徽章与伤害数字"（showStatus=false）→ 伤害层不渲染', async () => {
    const { wrapper } = await mountedLabel({ markerPrefs: { classIcons: false, showStatus: false } })
    wrapper.vm.spawnDamage(7, 400, 2000)
    await nextTick()
    expect(wrapper.find('[data-test="pb-damage"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('车辆类型图标（symbol mode）不改变落点：仍贴血条右缘，不漂到图标内部', async () => {
    vi.useFakeTimers()
    const wrapper = mountOverlay({ hpPrefs: { showHp: true }, markerPrefs: { classIcons: true, showStatus: true } })
    wrapper.vm.setLabels([{ ...hpRow(7), tankClass: 'Heavy tank' }])
    await nextTick()
    expect(wrapper.find('.vehicle-class-button').exists()).toBe(true)
    stubRect(wrapper.get('.vehicle-label-anchor').element, rect(100, 40, 40, 60))
    stubRect(wrapper.get('.pb-hp-bar').element, rect(108, 64, 24, 16))
    wrapper.vm.spawnDamage(7, 400, 2000)
    await nextTick()
    wrapper.vm.setAnchor(7, shownAnchor)
    expect(wrapper.get('[data-test="pb-damage"]').element.style.transform).toBe('translate3d(140px, 72px, 0)')
    wrapper.unmount()
  })
})

it('late marks use accountId rather than scene eid and disappear with hidden tank labels', async () => {
  const wrapper = mountOverlay()
  await wrapper.setProps({ labelPrefs: { showTankName: true } })
  wrapper.vm.setLabels([{ ...row(7), accountId: 1001 }])
  await nextTick()
  expect(wrapper.find('[data-gun-marks]').exists()).toBe(false)
  await wrapper.setProps({ gunMarks: new Map([[1001, 2], [7, 3]]) })
  expect(wrapper.get('[data-gun-marks]').attributes('data-gun-marks')).toBe('2')
  await wrapper.setProps({ labelPrefs: { showTankName: false } })
  expect(wrapper.find('[data-gun-marks]').exists()).toBe(false)
  wrapper.vm.clear()
  await nextTick()
  expect(wrapper.find('.vehicle-label-anchor').exists()).toBe(false)
  wrapper.unmount()
})
