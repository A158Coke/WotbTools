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
