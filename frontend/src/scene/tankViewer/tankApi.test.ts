import { describe, expect, it, vi } from 'vitest'
import { createTankApi } from './tankApi.ts'
import type { Host } from '../tankViewer.js'

// 回归：dataLoader / equipmentState 暴露的是闭包，不是 host-first 函数。
// 曾经用 bind(S.dl, S.dl.setShellUiVisible) 包装，导致 dl 对象被当成第一个实参，
// 原生弹种下拉不隐藏、picker 选车静默失败（Armor viewer CI 2026-11-22）。
function createHost() {
  const dl = {
    canPick: vi.fn(() => true),
    selectTank: vi.fn(() => true),
    applyConfig: vi.fn(),
    setConfigUiVisible: vi.fn(),
    setShellUiVisible: vi.fn(),
  }
  const eqs = {
    setPitchDeviceBonus: vi.fn(),
    setPitchDeviceAvailable: vi.fn(),
  }
  const S = {
    dl,
    eqs,
    destroy: vi.fn(),
    retry: vi.fn(),
    isContextLost: vi.fn(() => false),
    setCameraPreset: vi.fn(),
    setDistance: vi.fn(),
    setShell: vi.fn(),
    setShooterConfig: vi.fn(),
    setEquipmentOverride: vi.fn(),
    tc: { markTrajInfoDirty: vi.fn(), updateTrajInfoPos: vi.fn() },
  }
  return { S: S as unknown as Host, dl, eqs }
}

describe('createTankApi', () => {
  it('闭包 API 只转发调用方实参，不注入宿主对象', () => {
    const { S, dl, eqs } = createHost()
    const api = createTankApi(S)

    expect(api.selectTank('target', 9002)).toBe(true)
    expect(dl.selectTank).toHaveBeenCalledWith('target', 9002)
    api.setConfig(1)
    expect(dl.applyConfig).toHaveBeenCalledWith(1)
    api.setConfigUiVisible(false)
    expect(dl.setConfigUiVisible).toHaveBeenCalledWith(false)
    api.setShellUiVisible(false)
    expect(dl.setShellUiVisible).toHaveBeenCalledWith(false)
    api.setPitchDeviceBonus(null)
    expect(eqs.setPitchDeviceBonus).toHaveBeenCalledWith(null)
    api.setPitchDeviceAvailable(true)
    expect(eqs.setPitchDeviceAvailable).toHaveBeenCalledWith(true)
  })
})
