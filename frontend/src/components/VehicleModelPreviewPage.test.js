// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import VehicleModelPreviewPage from './VehicleModelPreviewPage.vue'

const authState = vi.hoisted(() => ({
  authenticated: { value: true },
  roles: ['wotbtools-admin'],
}))

const authFns = vi.hoisted(() => ({
  login: vi.fn(),
}))

const i18n = vi.hoisted(() => ({
  t: vi.fn((key) => key),
}))

const i18nLocale = vi.hoisted(() => ({ value: 'zh' }))

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => ({
    tokenParsed: {
      value: authState.roles.length
        ? { realm_access: { roles: authState.roles } }
        : null,
    },
    authenticated: authState.authenticated,
    initPromise: Promise.resolve(authState.authenticated.value),
    login: authFns.login,
  }),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: i18n.t, locale: i18nLocale }),
}))

// 动态 import（mapping + tankopedia JSON）与 import.meta.glob 需要真实事件循环；
// 全量并行跑时模块转换耗时不定，轮询等待组件就绪（最长 3s）。
async function waitFor(cond, timeoutMs = 3000) {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) return false
    await new Promise((r) => setTimeout(r, 25))
  }
  return true
}

describe('VehicleModelPreviewPage', () => {
  beforeEach(() => {
    authFns.login.mockReset()
    i18n.t.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('wotbtools-admin 可看到车型选择与画布', async () => {
    authState.roles = ['wotbtools-admin']
    authState.authenticated.value = true
    const wrapper = mount(VehicleModelPreviewPage)
    expect(await waitFor(() => wrapper.find('.vmp-toolbar').exists())).toBe(true)
    expect(wrapper.find('.vmp-canvas').exists()).toBe(true)
    const options = wrapper.findAll('select option')
    expect(options.length).toBeGreaterThanOrEqual(2) // 81 modelKeys
    expect(authFns.login).not.toHaveBeenCalled()
  })

  it('默认选中 maus 并渲染双层 webp 标记', async () => {
    authState.roles = ['wotbtools-admin']
    authState.authenticated.value = true
    const wrapper = mount(VehicleModelPreviewPage)
    expect(await waitFor(() => wrapper.find('select').exists())).toBe(true)
    const select = wrapper.find('select').element
    expect(select.value).toBe('maus')
    expect(wrapper.find('.vmp-hull').exists()).toBe(true)
    expect(wrapper.find('.vmp-turret').exists()).toBe(true)
  })

  it('turret img 的 transform-origin 精确等于 turretRaster 内 pivot（raster overflow contract）', async () => {
    authState.roles = ['wotbtools-admin']
    authState.authenticated.value = true
    const wrapper = mount(VehicleModelPreviewPage)
    expect(await waitFor(() => wrapper.find('.vmp-turret').exists())).toBe(true)
    const hullStyle = wrapper.find('.vmp-hull').attributes('style') || ''
    const turretStyle = wrapper.find('.vmp-turret').attributes('style') || ''
    // hull 绕画布中心 (160,160)
    expect(hullStyle).toContain('transform-origin: 160px 160px')
    // turret 绕 turretRaster 内 pivot（maus：pivotX=47.81 pivotY=212.87，相对扩展画布）——非画布中心
    expect(turretStyle).toContain('transform-origin: 47.81px 212.87px')
    expect(turretStyle).toContain('rotate(0deg)')
    // turret 层按 raster 原点定位（logicalMinX=112.19；炮管方向 top=-19.64 超出 320 画布）
    expect(turretStyle).toContain('left: 112.19px')
    expect(turretStyle).toContain('top: -19.64px')
  })

  it('hull 90° 时 turret assembly 父层绕画布中心旋转、子层抵消、座圈随车体移动（OFF_CENTER_TURRET_HULL_COMPOSITION）', async () => {
    authState.roles = ['wotbtools-admin']
    authState.authenticated.value = true
    const wrapper = mount(VehicleModelPreviewPage)
    expect(await waitFor(() => wrapper.find('.vmp-turret-assembly').exists())).toBe(true)
    // hullRot = 90°（第一个 range input）
    await wrapper.findAll('input[type="range"]')[0].setValue(90)
    const assemblyStyle = wrapper.find('.vmp-turret-assembly').attributes('style') || ''
    // 父层：绕画布中心 (160,160) 旋转 hullDeg——座圈随车体围绕 C 移动
    expect(assemblyStyle).toContain('transform-origin: 160px 160px')
    expect(assemblyStyle).toContain('rotate(90deg)')
    const turretStyle = wrapper.find('.vmp-turret').attributes('style') || ''
    // 子层：绕 raster 内 pivot 旋转 (T - H) = 0 - 90 = -90（最终 world yaw = T = 0）
    expect(turretStyle).toContain('transform-origin: 47.81px 212.87px')
    expect(turretStyle).toContain('rotate(-90deg)')
    // pivot marker 显示旋转后真实座圈位置：P' = C + R90(P-C)（maus P=(160,193.23)）
    // R90·(0,33.23) = (-33.23, 0) → P' = (126.77, 160)（非固定 screen point）
    const pivotEl = wrapper.find('.vmp-pivot').attributes('style') || ''
    expect(pivotEl).toContain('left: 126.77px')
    expect(pivotEl).toContain('top: 160px')
  })

  it('hull 90° + turret world 45°：子层 rotate(T-H) 后最终 world yaw = T', async () => {
    authState.roles = ['wotbtools-admin']
    authState.authenticated.value = true
    const wrapper = mount(VehicleModelPreviewPage)
    expect(await waitFor(() => wrapper.find('.vmp-turret-assembly').exists())).toBe(true)
    await wrapper.findAll('input[type="range"]')[0].setValue(90) // hullRot
    await wrapper.findAll('input[type="range"]')[1].setValue(45) // turretRot（world yaw）
    const turretStyle = wrapper.find('.vmp-turret').attributes('style') || ''
    expect(turretStyle).toContain('rotate(-45deg)') // T - H = 45 - 90
  })

  it('pivot debug marker 位置与 turret 旋转轴一致（同源坐标）', async () => {
    authState.roles = ['wotbtools-admin']
    authState.authenticated.value = true
    const wrapper = mount(VehicleModelPreviewPage)
    expect(await waitFor(() => wrapper.find('.vmp-pivot').exists())).toBe(true)
    const pivotEl = wrapper.find('.vmp-pivot').attributes('style') || ''
    // 画布 320px：marker left/top = pivot × scale = 160px 193.23px（maus，画布坐标不变）
    expect(pivotEl).toContain('left: 160px')
    expect(pivotEl).toContain('top: 193.23px')
    const turretStyle = wrapper.find('.vmp-turret').attributes('style') || ''
    expect(turretStyle).toContain('transform-origin: 47.81px 212.87px')
  })

  it('selected 指示器：默认关闭不渲染；开启后为红色倒三角且层级最高（PR #92 Review B）', async () => {
    authState.roles = ['wotbtools-admin']
    authState.authenticated.value = true
    const wrapper = mount(VehicleModelPreviewPage)
    expect(await waitFor(() => wrapper.find('.vmp-canvas').exists())).toBe(true)
    // 默认 showSelected=false → 不渲染
    expect(wrapper.find('.vmp-selected').exists()).toBe(false)
    // 第一个 checkbox = selected（模板顺序：selected/recorder/destroyed/lastKnown/pivot）
    await wrapper.findAll('input[type="checkbox"]')[0].setValue(true)
    const sel = wrapper.find('[data-test="vmp-selected"]')
    expect(sel.exists()).toBe(true)
    expect(sel.classes()).toContain('vmp-selected')
    const style = sel.attributes('style') || ''
    expect(style).toContain('border-top-color: #e5484d') // 红色倒三角
    expect(style).toContain('z-index: 6') // 高于 hull(1)/turret(2)/pivot(5)——不被车型图层遮挡
    // 关闭后消失
    await wrapper.findAll('input[type="checkbox"]')[0].setValue(false)
    expect(wrapper.find('.vmp-selected').exists()).toBe(false)
  })

  it('非 admin 角色显示无权限，不渲染工具栏', async () => {
    authState.roles = ['wotbtools-user']
    authState.authenticated.value = true
    const wrapper = mount(VehicleModelPreviewPage)
    expect(await waitFor(() => wrapper.find('.vmp-denied').exists())).toBe(true)
    expect(wrapper.find('.vmp-toolbar').exists()).toBe(false)
  })

  it('未登录自动跳转登录页（回跳 view=vehicle-models）', async () => {
    authState.roles = ['wotbtools-admin']
    authState.authenticated.value = false
    mount(VehicleModelPreviewPage)
    expect(await waitFor(() => authFns.login.mock.calls.length > 0)).toBe(true)
    expect(authFns.login).toHaveBeenCalledWith('vehicle-models')
  })
})
