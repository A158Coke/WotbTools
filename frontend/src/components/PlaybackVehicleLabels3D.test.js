// @vitest-environment happy-dom
/**
 * 3D 标签覆盖层的锚点契约：setAnchor **同步拷贝**进自有 per-eid 存储，不持有调用方
 * 对象引用。场景内核逐帧逐车复用同一个 scratch 对象喂所有 eid（60Hz ×14 的分配热路径），
 * 若这里存引用，全部 eid 会共享最后一辆车的坐标——这是无 GPU 单测里唯一能锁的观察面。
 */
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import { mount } from '@vue/test-utils'
import PlaybackVehicleLabels3D from './PlaybackVehicleLabels3D.vue'

const i18n = createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: {} } })

const mountOverlay = () => mount(PlaybackVehicleLabels3D, {
  props: { labelPrefs: {}, hpPrefs: {} },
  global: { plugins: [i18n] },
})

const row = (eid) => ({
  eid, playerName: `p${eid}`, tankName: 'Maus', friendly: true, destroyed: false,
  lastKnown: false, hp: null, reload: null, hpGhost: null, hpFlash: null,
})

describe('PlaybackVehicleLabels3D setAnchor 拷贝契约', () => {
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
