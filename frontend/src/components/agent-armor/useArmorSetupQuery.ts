import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { LocationQuery } from 'vue-router'
import { shouldResetShellOnConfigChange } from '../../utils/armorShellSelection.js'

type Viewer = {
    setShell?: (index: number) => void
    setEquipmentOverride?: (kind: string, value: boolean | undefined) => void
    setShooterConfig?: (index: number) => void
    setConfig?: (index: number) => void
}
type SetupContext = { viewer: () => Viewer | null; targetSetupId: () => number | null; shooterSetupId: () => number | null; onUpgradesChanged: () => void }
type ShotPatch = { shell?: number; eqcal?: boolean; eqenh?: boolean; eqpitch?: boolean }
type SidePatch = { configChanged?: boolean; config?: string | number | null; engine?: string | number | null; track?: string | number | null; dev?: string | null; upgrade?: string | null; abilities?: string | string[] | null }

/**
 * @param {{
 *  viewer: () => unknown,
 *  targetSetupId: () => number|null,
 *  shooterSetupId: () => number|null,
 *  onUpgradesChanged: () => void,   // 升级改动后宿主置 preserveToolsOnRebuild
 * }} ctx
 */
export function useArmorSetupQuery({ viewer, targetSetupId, shooterSetupId, onUpgradesChanged }: SetupContext) {
    const route = useRoute()
    const router = useRouter()
    let pendingShotQuery: LocationQuery | null = null
    watch(() => route.query, () => { pendingShotQuery = null }, { flush: 'sync' })

    function replaceArmorSetupQuery(mutate: (query: LocationQuery) => void) {
        const query = { ...(pendingShotQuery || route.query) }
        mutate(query)
        pendingShotQuery = query
        router.replace({ query })
    }

    function syncNativeTargetConfig(index: number | string) {
        const n = Number(index)
        if (!Number.isInteger(n) || n < 0) return
        replaceArmorSetupQuery((query) => {
            query.config = String(n)
            if (shouldResetShellOnConfigChange({ side: 'target', configChanged: true })) delete query.shell
        })
    }

    function syncNativeShell(index: number | string) {
        const n = Number(index)
        if (!Number.isInteger(n) || n < 0) return
        replaceArmorSetupQuery((query) => { query.shell = String(n) })
    }

    function syncNativeEquipment(kind: string, value: boolean) {
        if (kind !== 'calibrated' && kind !== 'enhanced' && kind !== 'pitch') return
        replaceArmorSetupQuery((query) => {
            if (kind === 'calibrated') query.eqcal = value ? '1' : '0'
            else if (kind === 'enhanced') query.eqenh = value ? '1' : '0'
            else query.eqpitch = value ? '1' : '0'
        })
    }

    function applyShotSetup(patch: ShotPatch | null) {
        if (!patch) return
        const query = { ...(pendingShotQuery || route.query) }
        const put = (key: string, value: string | number | null | undefined) => {
            if (value == null || value === '') delete query[key]
            else query[key] = String(value)
        }
        if ('shell' in patch) put('shell', patch.shell)
        if ('eqcal' in patch) put('eqcal', patch.eqcal ? '1' : '0')
        if ('eqenh' in patch) put('eqenh', patch.eqenh ? '1' : '0')
        if ('eqpitch' in patch) put('eqpitch', patch.eqpitch ? '1' : '0')
        pendingShotQuery = query
        router.replace({ query })
        if ('shell' in patch) viewer()?.setShell?.(Number(patch.shell))
        if ('eqcal' in patch) viewer()?.setEquipmentOverride?.('calibrated', patch.eqcal)
        if ('eqenh' in patch) viewer()?.setEquipmentOverride?.('enhanced', patch.eqenh)
        if ('eqpitch' in patch) viewer()?.setEquipmentOverride?.('pitch', patch.eqpitch)
    }

    function applySide(side: 'shooter' | 'target', patch: SidePatch | null) {
        if (!patch) return
        const query = { ...(pendingShotQuery || route.query) }
        const put = (key: string, value: string | number | string[] | null | undefined) => {
            const text = Array.isArray(value) ? value.join(',') : value
            if (text == null || text === '') delete query[key]
            else query[key] = String(text)
        }
        const shooter = side === 'shooter'
        const configChanged = patch.configChanged === true
        const upgradeKey = shooter ? 'supgrade' : 'upgrade'
        const abilitiesKey = shooter ? 'sabilities' : 'abilities'
        const previousUpgrade = query[upgradeKey]
        const previousAbilities = query[abilitiesKey]
        if ('upgrade' in patch) {
            put(upgradeKey, patch.upgrade === 'stock' || patch.upgrade === 'custom' ? patch.upgrade : 'top')
        }
        if ('abilities' in patch) put(abilitiesKey, patch.abilities)
        const upgradesChanged = previousUpgrade !== query[upgradeKey] || previousAbilities !== query[abilitiesKey]
        if (upgradesChanged) {
            onUpgradesChanged()
            put('tank', targetSetupId())
            put('shooter', shooterSetupId())
        }
        if (shooter) {
            if (configChanged) put('scfg', patch.config)
            put('sengine', patch.engine)
            put('strack', patch.track)
            put('sdev', patch.dev)
        } else {
            put('config', patch.config)
            put('engine', patch.engine)
            put('track', patch.track)
            put('dev', patch.dev)
        }
        if (shouldResetShellOnConfigChange({ side, configChanged })) delete query.shell
        pendingShotQuery = query
        router.replace({ query })
        if (!configChanged || upgradesChanged) return
        if (shooter) viewer()?.setShooterConfig?.(Number(patch.config))
        else viewer()?.setConfig?.(Number(patch.config))
    }
    return { replaceArmorSetupQuery, syncNativeTargetConfig, syncNativeShell, syncNativeEquipment, applyShotSetup, applySide }
}
