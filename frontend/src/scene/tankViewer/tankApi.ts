import type { Host } from '../tankViewer.js'
import type { PitchDeviceBonus } from '../viewer/equipmentState.ts'
export function createTankApi(S: Host) {
  return {
            destroy: S.destroy, retry: S.retry, canPick: () => S.dl.canPick(), isContextLost: S.isContextLost,
            selectTank: (mode: 'shooter' | 'target' | string, id: number | string) => S.dl.selectTank(mode, id),
            setCameraPreset: S.setCameraPreset, setDistance: S.setDistance,
            repositionResultCard: () => { S.tc.markTrajInfoDirty(); S.tc.updateTrajInfoPos(); },
            setConfig: (idx: number) => S.dl.applyConfig(idx),
            setConfigUiVisible: (visible: boolean) => S.dl.setConfigUiVisible(visible),
            setShellUiVisible: (visible: boolean) => S.dl.setShellUiVisible(visible),
            setShell: S.setShell, setShooterConfig: S.setShooterConfig, setEquipmentOverride: S.setEquipmentOverride,
            setPitchDeviceBonus: (value: PitchDeviceBonus | null | undefined) => S.eqs.setPitchDeviceBonus(value),
            setPitchDeviceAvailable: (value: unknown) => S.eqs.setPitchDeviceAvailable(value),
        };
}
