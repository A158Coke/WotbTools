import type { Host } from '../tankViewer.js'
import { bind } from '../hostBind.ts'
// 公开 API owner（2026-11-22 自 tankViewer.js 闭包出仓，纯搬移）：initTankViewer 返回对象的唯一组装点。

export function createTankApi(S: Host) {
  return {
            destroy: S.destroy, retry: S.retry, canPick: () => S.dl.canPick(), isContextLost: S.isContextLost,
            selectTank: bind(S.dl, S.dl.selectTank),
            setCameraPreset: S.setCameraPreset, setDistance: S.setDistance,
            // 结果卡展开/收起后尺寸变化：由宿主在 nextTick 调一次，按新高度重新避让面板。
            repositionResultCard: () => { S.tc.markTrajInfoDirty(); S.tc.updateTrajInfoPos(); },
            setConfig: bind(S.dl, S.dl.applyConfig),
            setConfigUiVisible: bind(S.dl, S.dl.setConfigUiVisible), setShellUiVisible: bind(S.dl, S.dl.setShellUiVisible),
            setShell: S.setShell, setShooterConfig: S.setShooterConfig, setEquipmentOverride: S.setEquipmentOverride,
            setPitchDeviceBonus: bind(S.eqs, S.eqs.setPitchDeviceBonus), setPitchDeviceAvailable: bind(S.eqs, S.eqs.setPitchDeviceAvailable),
        };
}
