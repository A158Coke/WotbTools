import { onBeforeUnmount, ref, watch } from 'vue'
import { fetchTankData } from '../../scene/agentData.js'
import { loadDevices, loadTankModules } from '../../utils/researchCatalog.js'
import { findTankModules, pitchDeviceBonus, presetProvidesPitchDevice } from '../../replay-local/compute/tankSetup'

/**
 * @param {{ targetSetupId: import('vue').Ref<number|null> }} ctx
 * @param {(patch: { fromModules: boolean, known: boolean }) => void} apply
 */
export function useArmorPitchAvailability(targetSetupId: import('vue').Ref<number | null>) {
    const pitchFromModules = ref(false)
    const pitchFromModulesKnown = ref(false)
    const pitchDeviceBonusValue = ref<{ up: number; down: number } | null>(null)
    let pitchAvailabilitySeq = 0
    let pitchAvailabilityTimer: ReturnType<typeof setTimeout> | null = null
    const PITCH_AVAILABILITY_RETRY_MS = 5000
    const PITCH_AVAILABILITY_MAX_ATTEMPTS = 3
    async function resolvePitchAvailability(tankId: number | null, attempt = 0): Promise<void> {
        const seq = ++pitchAvailabilitySeq
        if (pitchAvailabilityTimer) {
            clearTimeout(pitchAvailabilityTimer)
            pitchAvailabilityTimer = null
        }
        if (tankId == null || !(tankId > 0)) {
            pitchFromModules.value = false
            pitchFromModulesKnown.value = true
            return
        }
        try {
            const [detail, devices] = await Promise.all([fetchTankData(tankId), loadDevices()])
            if (seq !== pitchAvailabilitySeq) return
            pitchDeviceBonusValue.value = pitchDeviceBonus([122], devices)
            const nationData = await loadTankModules(detail.nation)
            if (seq !== pitchAvailabilitySeq) return
            const modules = findTankModules(nationData, tankId)
            pitchFromModules.value = presetProvidesPitchDevice(modules, { devicePresets: devices?.devicePresets })
            pitchFromModulesKnown.value = true
        } catch {
            if (seq !== pitchAvailabilitySeq) return
            pitchFromModules.value = false
            pitchFromModulesKnown.value = false
            if (attempt + 1 < PITCH_AVAILABILITY_MAX_ATTEMPTS) {
                pitchAvailabilityTimer = setTimeout(() => {
                    pitchAvailabilityTimer = null
                    if (seq === pitchAvailabilitySeq) resolvePitchAvailability(tankId, attempt + 1)
                }, PITCH_AVAILABILITY_RETRY_MS)
            }
        }
    }
    watch(targetSetupId, (id) => {
        pitchFromModules.value = false
        pitchFromModulesKnown.value = false
        resolvePitchAvailability(id)
    }, { immediate: true })
    onBeforeUnmount(() => {
        pitchAvailabilitySeq++
        if (pitchAvailabilityTimer) {
            clearTimeout(pitchAvailabilityTimer)
            pitchAvailabilityTimer = null
        }
    })
    return { pitchFromModules, pitchFromModulesKnown, pitchDeviceBonusValue }
}
