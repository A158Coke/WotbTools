/**
 * Agent 装甲查看器 —— 装配 URL 同步（拆分自 AgentArmorView.vue，行为原样）。
 * 职责：原生回退控件 / HUD / 侧配置的改动写回 query，并驱动场景就地更新。
 */
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { shouldResetShellOnConfigChange } from '../../utils/armorShellSelection.js'

/**
 * @param {{
 *  viewer: () => unknown,
 *  targetSetupId: () => number|null,
 *  shooterSetupId: () => number|null,
 *  onUpgradesChanged: () => void,   // 升级改动后宿主置 preserveToolsOnRebuild
 * }} ctx
 */
export function useArmorSetupQuery({ viewer, targetSetupId, shooterSetupId, onUpgradesChanged }) {
    const route = useRoute()
    const router = useRouter()
    /** 同一 tick 连点两下（弹种 + 开关）时，第二次写入必须基于上一次尚未落地的 query，
     *  否则会把第一击的结果覆盖回旧值（与坦克百科 pendingQuery 同因同解）。 */
    let pendingShotQuery = null
    watch(() => route.query, () => { pendingShotQuery = null }, { flush: 'sync' })

    /** 原生回退控件变更后写回 URL；场景已经自行应用，不能再回调 viewer 造成循环。 */
    function replaceArmorSetupQuery(mutate) {
        const query = { ...(pendingShotQuery || route.query) }
        mutate(query)
        pendingShotQuery = query
        router.replace({ query })
    }

    function syncNativeTargetConfig(index) {
        const n = Number(index)
        if (!Number.isInteger(n) || n < 0) return
        replaceArmorSetupQuery((query) => {
            query.config = String(n)
            // 受击方换配置不改变射击方弹表，shell 始终保留
            if (shouldResetShellOnConfigChange({ side: 'target', configChanged: true })) delete query.shell
        })
    }

    function syncNativeShell(index) {
        const n = Number(index)
        if (!Number.isInteger(n) || n < 0) return
        replaceArmorSetupQuery((query) => { query.shell = String(n) })
    }

    function syncNativeEquipment(kind, value) {
        if (kind !== 'calibrated' && kind !== 'enhanced' && kind !== 'pitch') return
        replaceArmorSetupQuery((query) => {
            if (kind === 'calibrated') query.eqcal = value ? '1' : '0'
            else if (kind === 'enhanced') query.eqenh = value ? '1' : '0'
            else query.eqpitch = value ? '1' : '0'
        })
    }

    function applyShotSetup(patch) {
        if (!patch) return
        const query = { ...(pendingShotQuery || route.query) }
        const put = (key, value) => {
            if (value == null || value === '') delete query[key]
            else query[key] = String(value)
        }
        if ('shell' in patch) put('shell', patch.shell)
        if ('eqcal' in patch) put('eqcal', patch.eqcal ? '1' : '0')
        if ('eqenh' in patch) put('eqenh', patch.eqenh ? '1' : '0')
        if ('eqpitch' in patch) put('eqpitch', patch.eqpitch ? '1' : '0')
        // 先落 URL（状态 owner），再驱动场景：场景侧异常不应该把用户的选择丢掉
        pendingShotQuery = query
        router.replace({ query })
        if ('shell' in patch) viewer()?.setShell?.(Number(patch.shell))
        if ('eqcal' in patch) viewer()?.setEquipmentOverride?.('calibrated', patch.eqcal)
        if ('eqenh' in patch) viewer()?.setEquipmentOverride?.('enhanced', patch.eqenh)
        if ('eqpitch' in patch) viewer()?.setEquipmentOverride?.('pitch', patch.eqpitch)
    }

    /**
     * 射击方 / 受击方的模块与配件改动（各自完整的详情页配置逻辑）：
     * 写各自的 URL 键并驱动场景——射击方换主炮重载弹表，受击方换配置切装甲板。
     */
    function applySide(side, patch) {
        if (!patch) return
        const query = { ...(pendingShotQuery || route.query) }
        const put = (key, value) => {
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
        // PATCH 里带 upgrade 时写显式模式（stock/top/custom 原样写回——custom 由
        // ArmorSideConfig 携带 abilities 一起发来，折叠成 top 会静默展示整套顶级数值）；
        // 缺省（无 key）= XI 顶级由场景侧决定。
        if ('upgrade' in patch) {
            put(upgradeKey, patch.upgrade === 'stock' || patch.upgrade === 'custom' ? patch.upgrade : 'top')
        }
        if ('abilities' in patch) put(abilitiesKey, patch.abilities)
        const upgradesChanged = previousUpgrade !== query[upgradeKey] || previousAbilities !== query[abilitiesKey]
        if (upgradesChanged) {
            onUpgradesChanged()
            // 旧选车器只更新场景内选择；升级重建前把实际双方车型落到 URL，避免回到先前深链。
            put('tank', targetSetupId())
            put('shooter', shooterSetupId())
        }
        if (shooter) {
            // 只有真正换炮才写 scfg：只换发动机/履带不凭空建立独立射手配置，
            // 保持 URL 最小改动。换炮时清除旧 shell 下标（弹表已换）。
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
        // 升级的装甲/俯仰/弹表共用原有场景重建；不要同时启动旧场景的换炮请求。
        if (!configChanged || upgradesChanged) return
        if (shooter) viewer()?.setShooterConfig?.(Number(patch.config))
        else viewer()?.setConfig?.(Number(patch.config))
    }
    return { replaceArmorSetupQuery, syncNativeTargetConfig, syncNativeShell, syncNativeEquipment, applyShotSetup, applySide }
}
