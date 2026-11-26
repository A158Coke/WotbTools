// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import { mount } from '@vue/test-utils'
import PlaybackVehicleLabels3D from './PlaybackVehicleLabels3D.vue'
import overlaySource from './PlaybackVehicleLabels3D.vue?raw'

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

const rect = (left, top, width, height) => ({
  left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}),
})
const stubRect = (el, r) => { el.getBoundingClientRect = () => r }
const stubNumber = (el, key, value) => Object.defineProperty(el, key, { configurable: true, value })

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
    const anchor = wrapper.get('.vehicle-label-anchor').element
    expect(anchor.hidden).toBe(true)
    wrapper.vm.setAnchor(7, { x: 85, y: 96, visible: true, occluded: true })
    expect(anchor.hidden).toBe(false)
    expect(anchor.style.transform).toContain('translate(85px, 96px)')
    expect(anchor.classList.contains('label-occluded')).toBe(true)
    wrapper.unmount()
  })
  it('同一 scratch 对象喂多个 eid：各自保留自己那一次的值（不共享最后写入）', async () => {
    const wrapper = mountOverlay()
    wrapper.vm.setLabels([row(1), row(2)])
    await nextTick()

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

  it('begin/end 批处理：setAnchor 只收集，end 后统一落位；舞台宽度由调用方传入（不读 rootEl.clientWidth）', async () => {
    const wrapper = mountOverlay()
    wrapper.vm.setLabels([row(1), row(2)])
    await nextTick()
    const root = wrapper.get('[data-testid="vehicle-label-overlay"]').element
    let rootReads = 0
    Object.defineProperty(root, 'clientWidth', { configurable: true, get() { rootReads++; return 1234 } })
    const [a, b] = wrapper.findAll('.vehicle-label-anchor')
    wrapper.vm.beginAnchors({ x: 500, y: 600 })
    wrapper.vm.setAnchor(1, { x: 10, y: 20, visible: true, occluded: false })
    wrapper.vm.setAnchor(2, { x: 30, y: 40, visible: true, occluded: true })
    expect(a.element.hidden).toBe(true)
    wrapper.vm.endAnchors()
    expect(a.element.style.transform).toContain('translate(10px, 20px)')
    expect(b.element.style.transform).toContain('translate(30px, 40px)')
    expect(b.element.classList.contains('label-occluded')).toBe(true)
    expect(rootReads, '逻辑舞台宽度必须来自调用方，不得读覆盖层布局').toBe(0)
    wrapper.unmount()
  })

  it('战场快捷标记来源卡：同一 DOM 卡片机制——内容行按 key 渲染、锚点重摆、visible 翻转隐藏、clear 清空', async () => {
    const wrapper = mountOverlay()
    wrapper.vm.setMarkerLabels([
      { key: '0', kind: 'ping', player: 'Anonyme', tank: 'BZT-70' },
      { key: '1', kind: 'sector', player: 'SiLuck97', tank: 'T-34' },
    ])
    await nextTick()
    const [ping, sector] = wrapper.findAll('.battle-marker-anchor')
    expect(ping.attributes('data-marker')).toBe('0')
    wrapper.vm.setMarkerAnchor('0', { x: 40, y: 50, visible: true })
    wrapper.vm.setMarkerAnchor('1', { x: 200, y: 80, visible: true })
    await nextTick()
    expect(ping.element.style.transform).toContain('translate(40px, 50px)')
    expect(ping.element.hidden).toBe(false)
    expect(wrapper.get('[data-marker="0"]').text()).toContain('Anonyme')
    expect(wrapper.get('[data-marker="0"]').text()).toContain('BZT-70')
    wrapper.vm.setMarkerAnchor('0', { x: 40, y: 50, visible: false })
    expect(ping.element.hidden).toBe(true)
    expect(ping.text()).not.toBe('')
    await wrapper.setProps({ markerKindLabels: {
      attack: '攻击目标', retreat: '请求撤退',
      target_attack: (target, who) => `${who} 要求攻击 ${target}`,
      target_retreat: (target, who) => `${who} 要求 ${target} 撤退`,
    } })
    wrapper.vm.setMarkerLabels([
      { key: '2', kind: 'target', intent: 'attack', player: 'A', tank: 'X', target: 'KRV' },
      { key: '3', kind: 'target', intent: 'retreat', player: 'B', tank: 'Y', target: 'FV4005' },
      { key: '4', kind: 'target', intent: 'attack', player: '', tank: '', target: 'KRV' },
      { key: '5', kind: 'ping', player: 'C', tank: 'Z' },
    ])
    await nextTick()
    expect(wrapper.get('[data-marker="2"] .battle-marker-kind').text()).toBe('A · X 要求攻击 KRV')
    expect(wrapper.get('[data-marker="3"] .battle-marker-kind').text()).toBe('B · Y 要求 FV4005 撤退')
    expect(wrapper.get('[data-marker="2"]').attributes('data-target')).toBe('KRV')
    expect(wrapper.get('[data-marker="2"]').find('.pb-labels').exists()).toBe(false)
    expect(wrapper.get('[data-marker="4"] .battle-marker-kind').text()).toBe('攻击目标 · KRV')
    expect(wrapper.find('[data-marker="5"] .battle-marker-kind').exists()).toBe(false)
    wrapper.vm.setMarkerAnchor('2', { x: 1, y: 2, visible: true, opacity: 0.5 })
    expect(wrapper.get('[data-marker="2"]').element.style.opacity).toBe('0.5')
    wrapper.vm.setMarkerAnchor('2', { x: 1, y: 2, visible: true, opacity: 0 })
    expect(wrapper.get('[data-marker="2"]').element.style.opacity).toBe('0')
    wrapper.vm.clear()
    await nextTick()
    expect(wrapper.findAll('.battle-marker-anchor')).toHaveLength(0)
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

describe('PlaybackVehicleLabels3D 伤害数字落点', () => {
  afterEach(() => vi.useRealTimers())

  async function mountedLabel({ hpPrefs = { showHp: true }, rowValue = hpRow(7), markerPrefs } = {}) {
    const wrapper = mountOverlay({ hpPrefs, markerPrefs })
    wrapper.vm.setLabels([rowValue])
    await nextTick()
    const anchorEl = wrapper.get('.vehicle-label-anchor').element
    stubRect(anchorEl, rect(100, 40, 40, 60))
    return { wrapper, anchorEl }
  }
  const shownAnchor = { x: 120, y: 100, visible: true, occluded: false, projected: true }
  const damage = (wrapper, index = 0) => wrapper.findAll('[data-test="pb-damage"]')[index]
  const textOf = (wrapper, index = 0) => damage(wrapper, index).find('.pb-damage-text').element

  it('落在血条右缘 + 间隙、垂直居中于血条：不覆盖血条，也不覆盖名牌文本', async () => {
    vi.useFakeTimers()
    const { wrapper } = await mountedLabel()
    stubRect(wrapper.get('.pb-hp-bar').element, rect(108, 64, 24, 16))
    wrapper.vm.spawnDamage(7, 342, 2000)
    await nextTick()
    wrapper.vm.setAnchor(7, shownAnchor)
    const el = damage(wrapper)
    expect(el.text()).toBe('-342')
    expect(el.element.hidden).toBe(false)
    expect(el.element.style.transform).toBe('translate3d(140px, 72px, 0)')
    wrapper.unmount()
  })

  it('血条关掉但名牌仍在 → 退回名牌块右侧；血条 / 名牌都没有内容 → 退回锚点上方', async () => {
    vi.useFakeTimers()
    const { wrapper, anchorEl } = await mountedLabel({
      hpPrefs: { showHp: false },
      rowValue: { ...row(7), hp: null },
    })
    expect(wrapper.find('.pb-hp-bar').exists()).toBe(false)
    stubRect(wrapper.get('.vehicle-label').element, rect(104, 50, 32, 40))
    wrapper.vm.spawnDamage(7, 400, 2000)
    await nextTick()
    wrapper.vm.setAnchor(7, shownAnchor)
    expect(damage(wrapper).element.style.transform).toBe('translate3d(144px, 70px, 0)')

    wrapper.vm.clearDamages()
    await nextTick()
    stubRect(wrapper.get('.vehicle-label').element, rect(120, 100, 0, 0))
    wrapper.vm.spawnDamage(7, 400, 2000)
    await nextTick()
    wrapper.vm.setAnchor(7, shownAnchor)
    expect(damage(wrapper).element.style.transform).toBe('translate3d(120px, 80px, 0)')
    expect(anchorEl.hidden).toBe(false)
    wrapper.unmount()
  })

  it('真实 0×0 空名牌（姓名 / 车型 / HP / 装填全关）→ 回退到锚点上方，不能一直 hidden', async () => {
    vi.useFakeTimers()
    const { wrapper, anchorEl } = await mountedLabel({
      hpPrefs: { showHp: false },
      rowValue: { ...row(7), hp: null, playerName: '', tankName: '' },
      markerPrefs: { classIcons: false, showStatus: true },
    })
    stubRect(anchorEl, rect(120, 100, 0, 0))
    wrapper.vm.spawnDamage(7, 400, 2000)
    await nextTick()
    wrapper.vm.setAnchor(7, shownAnchor)
    const el = damage(wrapper)
    expect(el.element.hidden, '0×0 空名牌不是"DOM 没 ready"，必须走 fallback').toBe(false)
    expect(el.element.style.transform).toBe('translate3d(120px, 80px, 0)')
    wrapper.unmount()
  })

  it('行 DOM 还没 patch → 本帧不定位（不用错位置），patch 后按血条右缘落位', async () => {
    vi.useFakeTimers()
    const wrapper = mountOverlay({ hpPrefs: { showHp: true } })
    wrapper.vm.spawnDamage(7, 400, 2000)
    wrapper.vm.setAnchor(7, shownAnchor)
    await nextTick()
    expect(damage(wrapper).element.hidden).toBe(true)

    wrapper.vm.setLabels([hpRow(7)])
    await nextTick()
    stubRect(wrapper.get('.vehicle-label-anchor').element, rect(100, 40, 40, 60))
    stubRect(wrapper.get('.pb-hp-bar').element, rect(108, 64, 24, 16))
    wrapper.vm.setAnchor(7, shownAnchor)
    expect(damage(wrapper).element.hidden).toBe(false)
    expect(damage(wrapper).element.style.transform).toBe('translate3d(140px, 72px, 0)')
    wrapper.unmount()
  })

  it('屏外重入 / 数字存活期间重开名牌：集中读几何前先解除宿主 hidden', async () => {
    vi.useFakeTimers()
    const { wrapper, anchorEl } = await mountedLabel()
    stubRect(wrapper.get('.pb-hp-bar').element, rect(108, 64, 24, 16))
    wrapper.vm.spawnDamage(7, 342, 2000)
    await nextTick()
    wrapper.vm.setAnchor(7, shownAnchor)
    expect(damage(wrapper).element.hidden).toBe(false)

    wrapper.vm.setAnchor(7, { ...shownAnchor, visible: false, projected: false })
    expect(anchorEl.hidden).toBe(true)
    wrapper.vm.setLabels([hpRow(7)])
    await nextTick()

    const observedHidden = []
    anchorEl.getBoundingClientRect = () => {
      observedHidden.push(anchorEl.hidden)
      return rect(100, 40, 40, 60)
    }
    wrapper.vm.beginAnchors({ x: 300, y: 600 })
    wrapper.vm.setAnchor(7, { ...shownAnchor, x: 200 })
    wrapper.vm.endAnchors()

    expect(observedHidden.length, '重入帧必须重新量名牌几何').toBeGreaterThan(0)
    expect(observedHidden.every((hidden) => hidden === false), '测量时宿主必须已解除 hidden').toBe(true)
    expect(damage(wrapper).element.hidden).toBe(false)
    expect(damage(wrapper).element.style.transform).toBe('translate3d(220px, 72px, 0)')
    wrapper.unmount()
  })

  it('跟随当前 anchor：车辆 / 相机每帧移动时按同一 dx / dy 一起走（不缓存屏幕绝对坐标）', async () => {
    vi.useFakeTimers()
    const { wrapper } = await mountedLabel()
    stubRect(wrapper.get('.pb-hp-bar').element, rect(108, 64, 24, 16))
    wrapper.vm.spawnDamage(7, 342, 2000)
    await nextTick()
    wrapper.vm.setAnchor(7, shownAnchor)
    expect(damage(wrapper).element.style.transform).toBe('translate3d(140px, 72px, 0)')

    wrapper.vm.setAnchor(7, { ...shownAnchor, x: 160, y: 140 })
    expect(damage(wrapper).element.style.transform, 'anchor 移动 (+40, +40) → 数字同步移动').toBe('translate3d(180px, 112px, 0)')
    wrapper.unmount()
  })

  it('车辆出屏（projected=false）→ 立即隐藏；回到视锥内 → 按新 anchor 继续显示', async () => {
    vi.useFakeTimers()
    const { wrapper } = await mountedLabel()
    stubRect(wrapper.get('.pb-hp-bar').element, rect(108, 64, 24, 16))
    wrapper.vm.spawnDamage(7, 342, 2000)
    await nextTick()
    wrapper.vm.setAnchor(7, shownAnchor)
    expect(damage(wrapper).element.hidden).toBe(false)

    wrapper.vm.setAnchor(7, { ...shownAnchor, x: 900, y: 700, projected: false })
    expect(damage(wrapper).element.hidden, '出屏后不得继续停在旧坐标').toBe(true)

    wrapper.vm.setAnchor(7, { ...shownAnchor, x: 200, y: 150 })
    expect(damage(wrapper).element.hidden).toBe(false)
    expect(damage(wrapper).element.style.transform).toBe('translate3d(220px, 122px, 0)')
    wrapper.unmount()
  })

  it('整层名牌关掉（关名牌）→ 车辆模型上方仍然显示', async () => {
    vi.useFakeTimers()
    const { wrapper } = await mountedLabel()
    wrapper.vm.spawnDamage(7, 500, 2000)
    await nextTick()
    wrapper.vm.setAnchor(7, { ...shownAnchor, visible: false })
    const el = damage(wrapper)
    expect(el.element.hidden).toBe(false)
    expect(el.element.style.transform).toBe('translate3d(120px, 80px, 0)')
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
    expect(damage(wrapper, 0).element.style.transform).toBe('translate3d(140px, 72px, 0)')
    expect(damage(wrapper, 1).element.style.transform).toBe('translate3d(140px, 92px, 0)')
    wrapper.unmount()
  })

  it('贴屏幕右缘放不下（含漂移行程）→ 镜像到血条左侧，且漂移反向（远离血条、不出左边界）', async () => {
    vi.useFakeTimers()
    const { wrapper } = await mountedLabel()
    stubRect(wrapper.get('.pb-hp-bar').element, rect(108, 64, 24, 16))
    wrapper.vm.spawnDamage(7, 1234, 2000)
    await nextTick()
    stubNumber(damage(wrapper).element, 'offsetWidth', 90)
    wrapper.vm.beginAnchors({ x: 300, y: 600 })
    wrapper.vm.setAnchor(7, { ...shownAnchor, x: 200 })
    wrapper.vm.endAnchors()
    const el = damage(wrapper).element
    expect(el.style.transform).toBe('translate3d(90px, 72px, 0)')
    expect(200 + (-110) + 90).toBeLessThan(200 + 20)
    expect(el.style.getPropertyValue('--pb-damage-drift-x')).toBe('-20px')
    expect(90 - 20).toBeGreaterThanOrEqual(0)
    wrapper.unmount()
  })

  it('viewport fit 把漂移行程算进去：出生帧放得下、漂移后放不下 → 也必须镜像', async () => {
    vi.useFakeTimers()
    const { wrapper } = await mountedLabel()
    stubRect(wrapper.get('.pb-hp-bar').element, rect(108, 64, 24, 16))
    wrapper.vm.spawnDamage(7, 1234, 2000)
    await nextTick()
    stubNumber(damage(wrapper).element, 'offsetWidth', 90)
    wrapper.vm.beginAnchors({ x: 320, y: 600 })
    wrapper.vm.setAnchor(7, { ...shownAnchor, x: 200 })
    wrapper.vm.endAnchors()
    const el = damage(wrapper).element
    expect(el.style.transform, '只看出生帧就会漏掉漂移后的裁切').toBe('translate3d(90px, 72px, 0)')
    expect(el.style.getPropertyValue('--pb-damage-drift-x')).toBe('-20px')
    wrapper.unmount()
  })

  it('animation-delay 在存活期间稳定：rerender 不重新按 age 计算（不重复快进动画）', async () => {
    vi.useFakeTimers()
    const { wrapper } = await mountedLabel()
    stubRect(wrapper.get('.pb-hp-bar').element, rect(108, 64, 24, 16))
    wrapper.vm.spawnDamage(7, 342, 2000)
    await nextTick()
    const delayBefore = textOf(wrapper).style.animationDelay
    expect(delayBefore).toBe('')

    vi.advanceTimersByTime(100)
    wrapper.vm.setLabels([hpRow(7), hpRow(8)])
    wrapper.vm.spawnDamage(7, 100, 2000)
    await nextTick()
    expect(textOf(wrapper).style.animationDelay, 'delay 必须保持稳定').toBe(delayBefore)
    expect(textOf(wrapper).style.animationDuration).toBe('2000ms')
    wrapper.unmount()
  })

  it('H 隐藏→恢复按壁钟补偿一次；普通更新不改 delay，到期不延长', async () => {
    vi.useFakeTimers()
    const { wrapper } = await mountedLabel()
    wrapper.vm.spawnDamage(7, 342, 4000)
    await nextTick()
    const original = damage(wrapper).element
    vi.advanceTimersByTime(500)
    await wrapper.setProps({ hidden: true })
    vi.advanceTimersByTime(700)
    await wrapper.setProps({ hidden: false })
    expect(damage(wrapper).element).toBe(original)
    expect(textOf(wrapper).style.animationDelay).toBe('-1200ms')
    vi.advanceTimersByTime(300)
    wrapper.vm.setLabels([hpRow(7), hpRow(8)])
    const second = wrapper.vm.spawnDamage(7, 100, 4000)
    await nextTick()
    wrapper.vm.setAnchor(7, shownAnchor)
    wrapper.vm.removeDamage(second)
    await nextTick()
    expect(textOf(wrapper).style.animationDelay).toBe('-1200ms')
    vi.advanceTimersByTime(2499)
    await nextTick()
    expect(damage(wrapper).exists()).toBe(true)
    vi.advanceTimersByTime(1)
    await nextTick()
    expect(wrapper.find('[data-test="pb-damage"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('出屏→进屏按壁钟恢复一次，首次显示及后续 anchor 更新不补偿', async () => {
    vi.useFakeTimers()
    const { wrapper } = await mountedLabel()
    wrapper.vm.spawnDamage(7, 342, 4000)
    await nextTick()
    wrapper.vm.setAnchor(7, shownAnchor)
    expect(textOf(wrapper).style.animationDelay).toBe('')
    vi.advanceTimersByTime(500)
    wrapper.vm.setAnchor(7, { ...shownAnchor, projected: false })
    expect(damage(wrapper).element.hidden).toBe(true)
    vi.advanceTimersByTime(700)
    wrapper.vm.setAnchor(7, shownAnchor)
    expect(damage(wrapper).element.hidden).toBe(false)
    expect(textOf(wrapper).style.animationDelay).toBe('-1200ms')
    vi.advanceTimersByTime(300)
    wrapper.vm.setAnchor(7, { ...shownAnchor, x: 160 })
    wrapper.vm.setLabels([hpRow(7), hpRow(8)])
    await nextTick()
    expect(textOf(wrapper).style.animationDelay).toBe('-1200ms')
    vi.advanceTimersByTime(2500)
    await nextTick()
    expect(wrapper.find('[data-test="pb-damage"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('出生时就在视野外：延迟首次进屏补偿 age，后续更新稳定且原期限摘除', async () => {
    vi.useFakeTimers()
    const { wrapper } = await mountedLabel()
    wrapper.vm.setAnchor(7, { ...shownAnchor, projected: false })
    wrapper.vm.spawnDamage(7, 342, 4000)
    await nextTick()
    wrapper.vm.setAnchor(7, { ...shownAnchor, projected: false })
    expect(damage(wrapper).element.hidden).toBe(true)
    vi.advanceTimersByTime(1200)
    wrapper.vm.setAnchor(7, shownAnchor)
    expect(damage(wrapper).element.hidden).toBe(false)
    expect(textOf(wrapper).style.animationDelay).toBe('-1200ms')
    vi.advanceTimersByTime(300)
    wrapper.vm.setAnchor(7, { ...shownAnchor, x: 160 })
    wrapper.vm.setLabels([hpRow(7), hpRow(8)])
    await nextTick()
    expect(textOf(wrapper).style.animationDelay).toBe('-1200ms')
    vi.advanceTimersByTime(2499)
    await nextTick()
    expect(damage(wrapper).exists()).toBe(true)
    vi.advanceTimersByTime(1)
    await nextTick()
    expect(wrapper.find('[data-test="pb-damage"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('旧数字到期后复用空槽，不与存活数字占同一槽', async () => {
    vi.useFakeTimers()
    const { wrapper } = await mountedLabel()
    wrapper.vm.spawnDamage(7, 100, 500)
    wrapper.vm.spawnDamage(7, 200, 4000)
    wrapper.vm.spawnDamage(7, 300, 4000)
    await nextTick()
    vi.advanceTimersByTime(500)
    await nextTick()
    wrapper.vm.spawnDamage(7, 400, 4000)
    await nextTick()
    wrapper.vm.setAnchor(7, shownAnchor)
    const positions = wrapper.findAll('[data-test="pb-damage"]').map(el => el.element.style.transform)
    expect(new Set(positions).size).toBe(3)
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

  it('showStatus=false（状态标记关闭 / 防遮）不影响伤害数字', async () => {
    const { wrapper } = await mountedLabel({ markerPrefs: { classIcons: false, showStatus: false } })
    wrapper.vm.spawnDamage(7, 415, 2000)
    await nextTick()
    wrapper.vm.setAnchor(7, shownAnchor)
    expect(damage(wrapper).text()).toBe('-415')
    expect(damage(wrapper).element.hidden).toBe(false)
    wrapper.unmount()
  })

  describe('幽灵段从 display:none 恢复时按壁钟续播', () => {
    const ghostOf = (wrapper) => wrapper.get('[data-test="pb-hp-ghost"]').element
    async function withGhost() {
      vi.useFakeTimers()
      const { wrapper } = await mountedLabel()
      const hpGhost = { prevPct: 50, nextPct: 30, bornMs: performance.now(), durationMs: 1200 }
      wrapper.vm.setLabels([{ ...hpRow(7), hpGhost }])
      await nextTick()
      wrapper.vm.setAnchor(7, shownAnchor)
      expect(ghostOf(wrapper).style.animationDelay).toBe('0ms')
      vi.advanceTimersByTime(800)
      return wrapper
    }

    it('隐藏全部 UI 后恢复', async () => {
      const wrapper = await withGhost()
      await wrapper.setProps({ hidden: true })
      await wrapper.setProps({ hidden: false })
      expect(ghostOf(wrapper).style.animationDelay).toBe('-800ms')
      wrapper.unmount()
    })

    it('名牌出屏后返回；可见时逐帧更新不改相位', async () => {
      const wrapper = await withGhost()
      wrapper.vm.setAnchor(7, shownAnchor)
      expect(ghostOf(wrapper).style.animationDelay).toBe('0ms')
      wrapper.vm.setAnchor(7, { ...shownAnchor, visible: false, projected: false })
      wrapper.vm.setAnchor(7, shownAnchor)
      expect(ghostOf(wrapper).style.animationDelay).toBe('-800ms')
      wrapper.unmount()
    })
  })

  it('隐藏全部 UI 一起隐藏数字、幽灵段与受击闪；恢复后数字不重新计时', async () => {
    vi.useFakeTimers()
    const { wrapper } = await mountedLabel()
    wrapper.vm.setLabels([{ ...hpRow(7), hpGhost: { prevPct: 50, nextPct: 30, durationMs: 1200 }, hpFlash: true }])
    wrapper.vm.spawnDamage(7, 415, 2000)
    await nextTick()
    wrapper.vm.setAnchor(7, shownAnchor)
    expect(wrapper.find('[data-test="pb-hp-ghost"]').exists()).toBe(true)
    expect(wrapper.find('.pb-hp-flash').exists()).toBe(true)
    vi.advanceTimersByTime(500)
    await wrapper.setProps({ hidden: true })
    expect(wrapper.get('[data-testid="vehicle-label-overlay"]').element.hidden).toBe(true)
    await wrapper.setProps({ hidden: false })
    expect(textOf(wrapper).style.animationDelay).toBe('-500ms')
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
    expect(damage(wrapper).element.style.transform).toBe('translate3d(140px, 72px, 0)')
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

describe('3D 名牌卡不得使用 backdrop-filter', () => {
  const source = overlaySource

  it('覆盖层用平面底色替换磨砂玻璃', () => {
    const block = /\.vehicle-label-overlay :deep\(\.pb-labels\) \{([\s\S]*?)\}/.exec(source)?.[1] ?? ''
    expect(block, '缺少 .vehicle-label-overlay :deep(.pb-labels) 覆盖规则').not.toBe('')
    expect(block).toMatch(/backdrop-filter:\s*none/)
    expect(block).not.toMatch(/backdrop-filter:\s*blur/)
    expect(block).toMatch(/background:\s*color-mix\(in oklab, var\(--color-canvas\)/)
  })

  it('本文件样式里不得再引入任何模糊滤镜', () => {
    const style = /<style scoped>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? ''
    expect(style).not.toMatch(/backdrop-filter:\s*blur/)
    expect(style).not.toMatch(/-webkit-backdrop-filter:\s*blur/)
  })
})
