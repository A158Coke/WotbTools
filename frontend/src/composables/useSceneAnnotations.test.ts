// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive } from 'vue'
import type { Component } from 'vue'
import { mount } from '@vue/test-utils'
import AnnotationToolbar from '../components/AnnotationToolbar.vue'
import { useSceneAnnotations } from './useSceneAnnotations.js'

function sceneApi() {
  return { setAnnotations: vi.fn(), setAnnotationInteraction: vi.fn(), setAnnotationsVisible: vi.fn() }
}

/** 宿主替身：与 Replay3DPane / MapPreview3DPane 同一模板接线（v-bind props + v-on handlers）。 */
function mountHost(options: { canOpen?: () => boolean; onOpen?: () => void } = {}) {
  const api = sceneApi()
  const store = reactive({ ready: true })
  let session!: ReturnType<typeof useSceneAnnotations>
  const Host = defineComponent({
    setup() {
      session = useSceneAnnotations({ getSceneApi: () => api, interactionReady: () => store.ready, ...options })
      return () => session.annotationOpen.value
        ? h(AnnotationToolbar as Component, { ...session.toolbarProps.value, compact: true, ...toHandlers(session.toolbarHandlers) })
        : null
    },
  })
  const wrapper = mount(Host, { global: { mocks: { $t: (key: string) => key } } })
  return { wrapper, api, store, session: () => session }
}

/** 等价于模板 `v-on="obj"`：事件名 → onXxx 键（Vue toHandlers 同一规则）。 */
function toHandlers(handlers: Record<string, (...args: never[]) => unknown>) {
  return Object.fromEntries(Object.entries(handlers).map(([event, fn]) => [`on${event[0].toUpperCase()}${event.slice(1)}`, fn]))
}

describe('useSceneAnnotations', () => {
  it('open 推送当前投影 / 交互 / 可见性；canOpen 拒绝时不打开也不触发 onOpen', async () => {
    const onOpen = vi.fn()
    let allowed = false
    const { api, session } = mountHost({ canOpen: () => allowed, onOpen })
    session().openAnnotation()
    expect(session().annotationOpen.value).toBe(false)
    expect(onOpen).not.toHaveBeenCalled()
    allowed = true
    session().openAnnotation()
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(session().annotationTool.value).toBe('pen')
    expect(api.setAnnotations).toHaveBeenLastCalledWith([])
    expect(api.setAnnotationInteraction).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true, tool: 'pen' }))
    expect(api.setAnnotationsVisible).toHaveBeenLastCalledWith(true)
  })

  it('toolbar 的 v-on 对象绑定：工具 / 宽度 / 橡皮半径 / 撤销 / 关闭都回到同一 owner', async () => {
    const { wrapper, api, session } = mountHost()
    session().openAnnotation()
    await nextTick()
    await wrapper.get('[data-test="pb-annot-eraser"]').trigger('click')
    await nextTick()
    expect(api.setAnnotationInteraction).toHaveBeenLastCalledWith(expect.objectContaining({ tool: 'eraser' }))
    await wrapper.get('[data-test="pb-annot-eraser-radius"]').setValue('20')
    await nextTick()
    expect(api.setAnnotationInteraction).toHaveBeenLastCalledWith(expect.objectContaining({ eraserWidth: 20 }))
    await wrapper.get('[data-test="pb-annot-pen"]').trigger('click')
    await nextTick()
    await wrapper.get('[data-test="pb-annot-width"] input').setValue('7')
    await nextTick()
    expect(api.setAnnotationInteraction).toHaveBeenLastCalledWith(expect.objectContaining({ tool: 'pen', width: 7 }))

    const pen = { type: 'pen', color: '#fff', width: 1, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }
    session().commitAnnotationFromScene(pen)
    await nextTick()
    expect(api.setAnnotations).toHaveBeenLastCalledWith([pen])
    await wrapper.get('[data-test="pb-annot-undo"]').trigger('click')
    await nextTick()
    expect(api.setAnnotations).toHaveBeenLastCalledWith([])
    await wrapper.get('[data-test="pb-annot-redo"]').trigger('click')
    await nextTick()
    expect(api.setAnnotations).toHaveBeenLastCalledWith([pen])

    await wrapper.get('[data-test="pb-annot-close"]').trigger('click')
    await nextTick()
    expect(session().annotationOpen.value).toBe(false)
    expect(api.setAnnotationInteraction).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false, tool: null }))
  })

  it('就绪门关闭时自动收起 drawing；reset 清空历史并把内核复位', async () => {
    const { api, store, session } = mountHost()
    session().openAnnotation()
    session().commitAnnotationFromScene({ type: 'pen', color: '#fff', width: 1, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })
    store.ready = false
    await nextTick()
    expect(session().annotationOpen.value).toBe(false)
    session().resetAnnotationState()
    expect(session().annotations.value).toEqual([])
    expect(api.setAnnotations).toHaveBeenLastCalledWith([])
    expect(api.setAnnotationInteraction).toHaveBeenLastCalledWith({ enabled: false, tool: null })
    expect(api.setAnnotationsVisible).toHaveBeenLastCalledWith(true)
  })
})
