/**
 * Agent 装甲查看器 —— 射击复现页状态与导航（拆分自 AgentArmorView.vue，行为原样）。
 * 职责：shot 快照读取、当前弹定位、前后弹切换（URL query 驱动）、退出动作。
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { fetchReplayShots, shotViewerQuery } from '../../scene/agentData.js'
import { shotResultBadge } from '../../utils/shotPresentation.js'
import { usePointer } from '../../composables/useBreakpoint.js'

type ReplayShot = Awaited<ReturnType<typeof fetchReplayShots>>['shots'][number]

export function useArmorShotPage() {
    const { t } = useI18n()
    const router = useRouter()
    const route = useRoute()
    const isShotPage = computed(() => route.query.shot != null)
    // 射击复现没有升级态证据：缺省显式 stock（raw），不把回放未证明的配置补成 XI 满级；
    // 普通装甲检视缺省交给 resolveUpgradeSelection（XI→top）。
    const armorUpgrade = (value: string | null | undefined) => (isShotPage.value ? (value ?? 'stock') : value)
    const shotSnapshot = ref<ReplayShot[]>([])
    const battleStartRaw = ref(0)
    const activeShot = computed(() => shotSnapshot.value.find(shot => String(shot.index) === String(route.query.shot)))
    const shotPosition = computed(() => shotSnapshot.value.indexOf(activeShot.value))
    const recordedResult = computed(() => activeShot.value ? shotResultBadge(activeShot.value, t) : null)
    const navigating = ref(false)
    const navigationError = ref('')
    let alive = true
    let navigationSeq = 0
    let requestSeq = 0
    // The stored list is the selected shooter's snapshot. The scene fetches its own copy before mirroring.
    async function readShotSnapshot(seq: number) {
        if (!isShotPage.value) { shotSnapshot.value = []; return }
        try {
            const data = await fetchReplayShots()
            if (alive && seq === navigationSeq) {
                shotSnapshot.value = data.shots
                battleStartRaw.value = data.battleStartRaw ?? 0
            }
        } catch { if (alive && seq === navigationSeq) shotSnapshot.value = [] } // The scene reports the actionable missing-handoff error.
    }
    function shotTankName(role: 'shooter' | 'target') {
        return activeShot.value?.[`${role}_tank_name`] || t('agentShots.unknown_tank')
    }
    function backToShots() {
        if (canGoBack) router.back()
        else router.replace({ query: { view: 'agent-shots' } })
    }
    // 深链直达（?view=agent-armor 无 shot）没有浏览器历史可退：退出动作改走「回坦克百科」
    // replace——手机横屏沉浸态卸载外壳后，这颗按钮是页面唯一的站内出口，任何入口形态都
    // 必须在（WotbTools #767 复审 P2：直达 + 沉浸态曾让应用内导航全部消失）。
    function backOrTankopedia() {
        if (canGoBack) router.back()
        else router.replace({ query: { view: 'agent-tankopedia' } })
    }
    async function adjacentShot(offset: number) {
        const shot = shotSnapshot.value[shotPosition.value + offset]
        if (!shot || navigating.value) return
        const seq = ++requestSeq
        navigating.value = true
        navigationError.value = ''
        try {
            const query = await shotViewerQuery(shot)
            if (alive && seq === requestSeq) {
                if (query) await router.replace({ query })
                else navigationError.value = t('armor.navigation_failed')
            }
        } catch {
            if (alive && seq === requestSeq) navigationError.value = t('armor.navigation_failed')
        } finally {
            if (alive && seq === requestSeq) navigating.value = false
        }
    }
    // 审计 3D-09：从射击分析 / 坦克百科在当前标签页打开，返回走浏览器历史
    const canGoBack = typeof window !== 'undefined' && !!window.history.state?.back
    const { coarse } = usePointer()
    const hint = computed(() => t(coarse.value ? 'armor.hint_touch' : 'armor.hint'))
    const shotGestures = computed(() => ['rotate', 'zoom', 'pan'].map(action => ({
        action: t(`armor.gestures.${action}`),
        input: t(`armor.gestures.${coarse.value ? 'touch' : 'mouse'}_${action}`),
    })))
    /** 场景/路由重建共用的 navigation sequence（单一来源从宿主移入本组合式） */
    function bumpNavSeq() { return ++navigationSeq }
    function currentNavSeq() { return navigationSeq }
    function requestSeqNext() { return ++requestSeq }
    /** 离开路由：使在飞请求失效（卸载后 reject 不得再挂重试） */
    function dispose() {
        alive = false
        navigationSeq++
        requestSeq++
    }
    return {
        isShotPage, armorUpgrade, shotSnapshot, battleStartRaw, activeShot, shotPosition,
        recordedResult, navigating, navigationError, readShotSnapshot, shotTankName,
        backToShots, backOrTankopedia, adjacentShot, hint, shotGestures,
        bumpNavSeq, currentNavSeq, requestSeqNext, dispose,
    }
}
