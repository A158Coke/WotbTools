/**
 * Agent 装甲查看器 —— 122 俯仰配件可用性解析（拆分自 AgentArmorView.vue，行为原样）。
 * 职责：按目标车预取 devices/modules，得出「模块目录支持」与「回放真值」之外的
 * 目录侧可用性；瞬时失败带界重试（不清理 URL 覆盖）。
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { fetchTankData } from '../../scene/agentData.js'
import { loadDevices, loadTankModules } from '../../utils/researchCatalog.js'
import { findTankModules, pitchDeviceBonus, presetProvidesPitchDevice } from '../../replay-local/compute/tankSetup'

/**
 * @param {{ targetSetupId: import('vue').Ref<number|null> }} ctx
 * @param {(patch: { fromModules: boolean, known: boolean }) => void} apply
 */
export function useArmorPitchAvailability(targetSetupId) {
    const pitchFromModules = ref(false)
    const pitchFromModulesKnown = ref(false)
    /** 122 的俯仰加成数值（宿主从 research/devices.json 读，注入场景；场景不硬编码）。 */
    const pitchDeviceBonusValue = ref(null)
    let pitchAvailabilitySeq = 0
    let pitchAvailabilityTimer = null
    const PITCH_AVAILABILITY_RETRY_MS = 5000
    const PITCH_AVAILABILITY_MAX_ATTEMPTS = 3
    async function resolvePitchAvailability(tankId, attempt = 0) {
        const seq = ++pitchAvailabilitySeq
        if (pitchAvailabilityTimer) {
            clearTimeout(pitchAvailabilityTimer)
            pitchAvailabilityTimer = null
        }
        if (!(tankId > 0)) {
            pitchFromModules.value = false
            pitchFromModulesKnown.value = true
            return
        }
        try {
            const [detail, devices] = await Promise.all([fetchTankData(tankId), loadDevices()])
            if (seq !== pitchAvailabilitySeq) return
            // 加成数值只依赖 devices.json：先落盘再等模块目录。模块请求失败只影响槽位确认，
            // 不得阻断已取得的 4°/3°（回放真值仍可让 HUD/场景启用 122）。
            pitchDeviceBonusValue.value = pitchDeviceBonus([122], devices)
            const nationData = await loadTankModules(detail.nation)
            if (seq !== pitchAvailabilitySeq) return
            const modules = findTankModules(nationData, tankId)
            pitchFromModules.value = presetProvidesPitchDevice(modules, { devicePresets: devices?.devicePresets })
            // 只有成功读到目录才允许后续「确认不支持 → 清理 URL 覆盖」。
            pitchFromModulesKnown.value = true
        } catch {
            if (seq !== pitchAvailabilitySeq) return
            // 瞬时网络/资产失败 ≠ 该车不支持：保留 unknown（不清理 eqpitch），临时停用加成并重试。
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
        // 换车后旧车的 122 可用性不再有效；先 fail-closed，等目标车模块目录返回。
        pitchFromModules.value = false
        pitchFromModulesKnown.value = false
        resolvePitchAvailability(id)
    }, { immediate: true })
    onBeforeUnmount(() => {
        // 先进位使在飞行请求的 seq 失效：卸载后 reject 不得再挂 5s 重试。
        pitchAvailabilitySeq++
        if (pitchAvailabilityTimer) {
            clearTimeout(pitchAvailabilityTimer)
            pitchAvailabilityTimer = null
        }
    })
    return { pitchFromModules, pitchFromModulesKnown, pitchDeviceBonusValue }
}
