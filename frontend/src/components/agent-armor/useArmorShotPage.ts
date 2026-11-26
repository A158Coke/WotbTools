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
    async function readShotSnapshot(seq: number) {
        if (!isShotPage.value) { shotSnapshot.value = []; return }
        try {
            const data = await fetchReplayShots()
            if (alive && seq === navigationSeq) {
                shotSnapshot.value = data.shots
                battleStartRaw.value = data.battleStartRaw ?? 0
            }
        } catch { if (alive && seq === navigationSeq) shotSnapshot.value = [] }
    }
    function shotTankName(role: 'shooter' | 'target') {
        return activeShot.value?.[`${role}_tank_name`] || t('agentShots.unknown_tank')
    }
    function backToShots() {
        if (canGoBack) router.back()
        else router.replace({ query: { view: 'agent-shots' } })
    }
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
    const canGoBack = typeof window !== 'undefined' && !!window.history.state?.back
    const { coarse } = usePointer()
    const hint = computed(() => t(coarse.value ? 'armor.hint_touch' : 'armor.hint'))
    const shotGestures = computed(() => ['rotate', 'zoom', 'pan'].map(action => ({
        action: t(`armor.gestures.${action}`),
        input: t(`armor.gestures.${coarse.value ? 'touch' : 'mouse'}_${action}`),
    })))
    function bumpNavSeq() { return ++navigationSeq }
    function currentNavSeq() { return navigationSeq }
    function requestSeqNext() { return ++requestSeq }
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
