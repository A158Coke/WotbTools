// 宿主对象工厂（2026-11-22 tankViewer.js 拆分）：跨模块共享的可变状态与宿主回调统一挂在
// S 上；各 owner 模块只经 S 读写，闭包语义与拆分前逐字一致。宿主参数在此一次性落位。
export function createTankHost({
    labels = {},
    onLoadState = null,
    onTankList = null,
    onTankSelection = null,
    onConfigSelection = null,
    onShellSelection = null,
    onEquipmentSelection = null,
    onDistanceChange = null,
    initialTankId = null,
    initialShooterId = null,
    pitchDeviceBonus = null,
    pitchDeviceAvailable: initialPitchDeviceAvailable = false,
} = {}) {
    return {
        labels,
        onLoadState,
        onTankList,
        onTankSelection,
        onConfigSelection,
        onShellSelection,
        onEquipmentSelection,
        onDistanceChange,
        initialTankId,
        initialShooterId,
        pitchDeviceBonus,
        initialPitchDeviceAvailable,
    }
}
