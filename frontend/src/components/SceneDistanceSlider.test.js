// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SceneDistanceSlider from './SceneDistanceSlider.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (k, vals) => k + (vals ? JSON.stringify(vals) : '') }),
}))

const mountSlider = (props) => mount(SceneDistanceSlider, {
  props,
  attachTo: document.body,
})

/** happy-dom 没有 PointerEvent 构造器的完整实现时，用可赋值对象兜底。 */
function pointerEvent(type, x, y, pointerId = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  event.pointerId = pointerId
  event.button = 0
  event.clientX = x
  event.clientY = y
  return event
}

describe('SceneDistanceSlider', () => {
  it('visible=false 不渲染；场景 unavailable 也不渲染数值外的 DOM', async () => {
    const getSceneApi = () => ({ cameraDistanceState: () => ({ available: false }) })
    const wrapper = mountSlider({ getSceneApi, visible: false })
    expect(wrapper.find('[data-testid="scene-distance-slider"]').exists()).toBe(false)
    await wrapper.setProps({ visible: true })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="scene-distance-slider"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('挂载即从相机反推 v；轮询跟随相机真实状态（外部移动后滑块同步）', async () => {
    vi.useFakeTimers()
    let state = { available: true, mode: 'free', v: 0.8 }
    const getSceneApi = () => ({ cameraDistanceState: () => state })
    const wrapper = mountSlider({ getSceneApi, visible: true })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="slider"]').attributes('aria-valuenow')).toBe('80')
    state = { available: true, mode: 'free', v: 0.2 }   // 键盘飞行移动了相机
    vi.advanceTimersByTime(450)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="slider"]').attributes('aria-valuenow')).toBe('20')
    vi.useRealTimers()
    wrapper.unmount()
  })

  it('竖直拖动：立即 setCameraDistance，拇指跟随手指；松手停住不回中', async () => {
    const setCameraDistance = vi.fn()
    const getSceneApi = () => ({ cameraDistanceState: () => ({ available: false }), setCameraDistance })
    const wrapper = mountSlider({ getSceneApi, visible: true })
    await wrapper.vm.$nextTick()
    const track = wrapper.find('.scene-dist-track')
    Object.defineProperty(track.element, 'getBoundingClientRect', {
      value: () => ({ top: 100, height: 100, left: 0, right: 20, bottom: 200, width: 20 }),
    })
    const root = wrapper.find('[data-testid="scene-distance-slider"]')
    await root.element.dispatchEvent(pointerEvent('pointerdown', 10, 150))       // 中点 → v=0.5
    expect(setCameraDistance).toHaveBeenLastCalledWith(0.5)
    await root.element.dispatchEvent(pointerEvent('pointermove', 10, 110))       // 顶部 → v=0.9
    expect(setCameraDistance).toHaveBeenLastCalledWith(0.9)
    await root.element.dispatchEvent(pointerEvent('pointerup', 10, 110))
    expect(setCameraDistance).toHaveBeenCalledTimes(2)
    // 松手后指针移动不再驱动相机（拖动态结束）
    await root.element.dispatchEvent(pointerEvent('pointermove', 10, 190))
    expect(setCameraDistance).toHaveBeenCalledTimes(2)
    // 不回中：值停留在最后位置
    expect(wrapper.find('[role="slider"]').attributes('aria-valuenow')).toBe('90')
    wrapper.unmount()
  })

  it('拇指方向：v=1 顶部（近）、v=0 底部（远），与拖动方向一致', async () => {
    const wrapper = mountSlider({ getSceneApi: () => ({ cameraDistanceState: () => ({ available: true, mode: 'free', v: 1 }) }), visible: true })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.scene-dist-thumb').element.style.bottom).toBe('100%')   // v=1 → 轨道顶部
    // 拖动驱动 v：按到底部 → v=0 拇指在底部；按到中部 → 50%
    Object.defineProperty(wrapper.find('.scene-dist-track').element, 'getBoundingClientRect', {
      value: () => ({ top: 100, height: 100, left: 0, right: 20, bottom: 200, width: 20 }),
    })
    const root = wrapper.find('[data-testid="scene-distance-slider"]')
    await root.element.dispatchEvent(pointerEvent('pointerdown', 10, 200))
    expect(wrapper.find('.scene-dist-thumb').element.style.bottom).toBe('0%')     // v=0 → 底部
    await root.element.dispatchEvent(pointerEvent('pointermove', 10, 150))
    expect(wrapper.find('.scene-dist-thumb').element.style.bottom).toBe('50%')
    wrapper.unmount()
  })

  it('多指抢占与取消：第二指被忽略；pointercancel / lostpointercapture 不留 ghost input', async () => {
    const setCameraDistance = vi.fn()
    const getSceneApi = () => ({ cameraDistanceState: () => ({ available: false }), setCameraDistance })
    const wrapper = mountSlider({ getSceneApi, visible: true })
    await wrapper.vm.$nextTick()
    const track = wrapper.find('.scene-dist-track')
    Object.defineProperty(track.element, 'getBoundingClientRect', {
      value: () => ({ top: 100, height: 100, left: 0, right: 20, bottom: 200, width: 20 }),
    })
    const root = wrapper.find('[data-testid="scene-distance-slider"]')
    await root.element.dispatchEvent(pointerEvent('pointerdown', 10, 150, 1))    // 手指 1 按下
    expect(setCameraDistance).toHaveBeenLastCalledWith(0.5)
    // 第二指落下：被忽略，不产生新的相机调用
    await root.element.dispatchEvent(pointerEvent('pointerdown', 10, 110, 2))
    expect(setCameraDistance).toHaveBeenCalledTimes(1)
    // 手指 2 移动不驱动相机；手指 1 仍驱动
    await root.element.dispatchEvent(pointerEvent('pointermove', 10, 110, 2))
    expect(setCameraDistance).toHaveBeenCalledTimes(1)
    await root.element.dispatchEvent(pointerEvent('pointermove', 10, 120, 1))
    expect(setCameraDistance).toHaveBeenCalledTimes(2)
    // pointercancel（手指 1）：手势结束，后续 move 不再驱动
    await root.element.dispatchEvent(pointerEvent('pointercancel', 10, 130, 1))
    await root.element.dispatchEvent(pointerEvent('pointermove', 10, 190, 1))
    expect(setCameraDistance).toHaveBeenCalledTimes(2)
    // 重新按下后 lostpointercapture 也结束手势
    await root.element.dispatchEvent(pointerEvent('pointerdown', 10, 150, 3))
    expect(setCameraDistance).toHaveBeenCalledTimes(3)
    const lost = new Event('lostpointercapture', { bubbles: true })
    lost.pointerId = 3
    await root.element.dispatchEvent(lost)
    await root.element.dispatchEvent(pointerEvent('pointermove', 10, 190, 3))
    expect(setCameraDistance).toHaveBeenCalledTimes(3)
    wrapper.unmount()
  })

  it('键盘：↑/↓ 微调、Home/End 端点，均走同一 setCameraDistance', async () => {
    const setCameraDistance = vi.fn()
    const getSceneApi = () => ({ cameraDistanceState: () => ({ available: false }), setCameraDistance })
    const wrapper = mountSlider({ getSceneApi, visible: true })
    await wrapper.vm.$nextTick()
    const root = wrapper.find('[data-testid="scene-distance-slider"]')
    await root.trigger('keydown', { key: 'ArrowUp' })
    expect(setCameraDistance).toHaveBeenLastCalledWith(0.52)
    await root.trigger('keydown', { key: 'End' })
    expect(setCameraDistance).toHaveBeenLastCalledWith(0)
    await root.trigger('keydown', { key: 'Home' })
    expect(setCameraDistance).toHaveBeenLastCalledWith(1)
    wrapper.unmount()
  })
})
