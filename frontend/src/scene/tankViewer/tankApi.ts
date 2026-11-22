import type { Host } from '../tankViewer.js'
import type { PitchDeviceBonus } from '../viewer/equipmentState.ts'
// 公开 API owner（2026-11-22 自 tankViewer.js 闭包出仓，纯搬移）：initTankViewer 返回对象的唯一组装点。
// 注意：dl/eqs 的方法都是闭包，不是 host-first；这里必须直传参数，不能套 bind（bind 会多传宿主）。
export function createTankApi(S: Host) {
  return {
            destroy: S.destroy, retry: S.retry, canPick: () => S.dl.canPick(), isContextLost: S.isContextLost,
            selectTank: (mode: 'shooter' | 'target' | string, id: number | string) => S.dl.selectTank(mode, id),
            setCameraPreset: S.setCameraPreset, setDistance: S.setDistance,
            // 结果卡展开/收起后尺寸变化：由宿主在 nextTick 调一次，按新高度重新避让面板。
            repositionResultCard: () => { S.tc.markTrajInfoDirty(); S.tc.updateTrajInfoPos(); },
            setConfig: (idx: number) => S.dl.applyConfig(idx),
            setConfigUiVisible: (visible: boolean) => S.dl.setConfigUiVisible(visible),
            setShellUiVisible: (visible: boolean) => S.dl.setShellUiVisible(visible),
            setShell: S.setShell, setShooterConfig: S.setShooterConfig, setEquipmentOverride: S.setEquipmentOverride,
            setPitchDeviceBonus: (value: PitchDeviceBonus | null | undefined) => S.eqs.setPitchDeviceBonus(value),
            setPitchDeviceAvailable: (value: unknown) => S.eqs.setPitchDeviceAvailable(value),
        };
}
