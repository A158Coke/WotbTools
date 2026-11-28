<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { datasetTankModelUrl, fetchDatasetTank } from '../../composables/useVersionDiff.js'
import { armorComparisonChoices } from '../../scene/viewer/armorComparisonModel.js'
import type { ArmorDiffDetail, ComparisonTank } from '../../scene/viewer/armorComparisonModel.js'
import type { ArmorComparisonLabel, mountArmorComparison, loadArmorComparisonModels } from '../../scene/viewer/armorComparisonScene.js'
import AppButton from '../AppButton.vue'
import VersionCompareDivider from './VersionCompareDivider.vue'

const emit = defineEmits(['select'])
const props = defineProps<{
  tankId: number | string
  tankName: string
  pair: { from: { dataset: string }; to: { dataset: string } }
  verification: 'pending' | 'verified' | 'mismatch'
  loadDetail: () => Promise<ArmorDiffDetail>
  /** 文字行点选的板件隔离键；非空时对比器突出对应板、淡化其余装甲。 */
  isolateKeys?: string[] | null
  /** 隔离键所属配置（turretLocal/gunLocal）：与当前 3D 配置不同时先切到该配置。 */
  isolateConfigKey?: string | null
}>()

const { t } = useI18n()
const host = ref<HTMLDivElement | null>(null)
const visible = ref(false)
const attempt = ref(0)
const compare = ref(50)
const choiceKey = ref('')
const choices = shallowRef<ReturnType<typeof armorComparisonChoices>>([])
const status = ref<'loading' | 'ready' | 'error' | 'configuration'>('loading')
const matched = ref(0)
const inspected = ref<{ side: 0 | 1; thickness: number } | null>(null)
const versions = computed(() => [props.pair.from.dataset, props.pair.to.dataset] as const)
const choice = computed(() => choices.value.find(entry => entry.key === choiceKey.value))
const active = computed(() => visible.value && props.verification === 'verified')
let viewer: ReturnType<typeof mountArmorComparison> | null = null
let observer: IntersectionObserver | null = null

onMounted(() => {
  if (!host.value) return
  if (typeof IntersectionObserver === 'undefined') {
    visible.value = true
    return
  }
  observer = new IntersectionObserver((entries) => {
    visible.value = entries.at(-1)?.isIntersecting ?? false
  }, { rootMargin: '200px 0px' })
  observer.observe(host.value)
})

onBeforeUnmount(() => observer?.disconnect())

// 当前 3D 配置应使用的隔离键：文字行的选中属于别的配置时不能沿用（板号可能相同）。
function choiceIsolationKeys() {
  if (!props.isolateKeys?.length) return null
  if (props.isolateConfigKey && props.isolateConfigKey !== choiceKey.value) return null
  return props.isolateKeys
}

function displayChoice() {
  if (!choice.value || !viewer) return
  try {
    matched.value = viewer.setChoice(choice.value)
    // setChoice 重建图层时会沿用一个配置的隔离键；切换后按当前配置重新应用。
    viewer.setIsolated(choiceIsolationKeys())
    status.value = 'ready'
  } catch {
    status.value = 'error'
  }
}

function setCompare(position: number) {
  compare.value = position
  viewer?.setCompare(position)
}

function handleIsolateRequest(key: string | null) {
  emit('select', { configKey: key ? choiceKey.value : '', keys: key ? [key] : [] })
}

// 旁注文案：每块改动装甲一条，同时带修改前后数值（绘制在场景的 2D 叠加画布上，
// 与 WebGL 同帧同步，旋转/缩放零延迟）。
function formatLabel(item: ArmorComparisonLabel) {
  const unit = t('agentTanks.units.MILLIMETER')
  // 只标注厚度变化，不带板号：`120 → 135 ${unit}`；单侧存在标 `+新值` / `−旧值`。
  if (item.left != null && item.right != null) return `${item.left} → ${item.right} ${unit}`
  if (item.right != null) return `+${item.right} ${unit}`
  if (item.left != null) return `−${item.left} ${unit}`
  if (item.kind === 'spaced') return t('versionDiff.armor.spaced')
  return '±'
}

watch(choiceKey, displayChoice)
watch([() => props.isolateKeys, () => props.isolateConfigKey], ([keys, configKey]) => {
  // 配置级行来自别的配置：先切 3D 配置；displayChoice 在重建后按新配置应用隔离键。
  if (keys && keys.length && configKey && configKey !== choiceKey.value
    && choices.value.some(entry => entry.key === configKey)) {
    choiceKey.value = configKey
    return
  }
  viewer?.setIsolated(choiceIsolationKeys())
})
watch([active, attempt], async ([enabled], _, onCleanup) => {
  if (!enabled) return
  const abort = new AbortController()
  let releaseModels: (() => void) | null = null
  function release() {
    viewer?.destroy()
    viewer = null
    releaseModels?.()
    releaseModels = null
  }
  onCleanup(() => {
    abort.abort()
    release()
  })
  status.value = 'loading'
  inspected.value = null
  try {
    const [detail, old, next, scene] = await Promise.all([
      props.loadDetail(),
      fetchDatasetTank(versions.value[0], props.tankId) as Promise<ComparisonTank>,
      fetchDatasetTank(versions.value[1], props.tankId) as Promise<ComparisonTank>,
      import('../../scene/viewer/armorComparisonScene.js'),
    ])
    if (abort.signal.aborted || !host.value) return
    choices.value = armorComparisonChoices(old, next, detail)
    if (!choices.value.length) {
      status.value = 'configuration'
      return
    }
    if (props.isolateConfigKey && choices.value.some(entry => entry.key === props.isolateConfigKey)) {
      choiceKey.value = props.isolateConfigKey
    }
    if (!choice.value) choiceKey.value = choices.value[0].key
    // 视觉模型总是加载：厚度模式下要展示炮管与履带（与装甲查看器同口径）。
    const source = (tank: ComparisonTank, dataset: string) => ({
      tank,
      collision: datasetTankModelUrl(dataset, tank.model_url),
      chassis: tank.visual_model_url ? datasetTankModelUrl(dataset, tank.visual_model_url) : null,
    })
    const sources: Parameters<typeof loadArmorComparisonModels>[0] = [
      source(old, versions.value[0]), source(next, versions.value[1]),
    ]
    const models = await scene.loadArmorComparisonModels(sources, abort.signal)
    if (abort.signal.aborted || !host.value) {
      scene.disposeArmorComparisonModels(models)
      return
    }
    releaseModels = () => scene.disposeArmorComparisonModels(models)
    viewer = scene.mountArmorComparison(host.value, sources, models, () => {
      status.value = 'error'
    }, plate => { inspected.value = plate }, formatLabel, key => handleIsolateRequest(key))
    viewer.setIsolated(props.isolateKeys ?? null)
    viewer.setCompare(compare.value)
    displayChoice()
  } catch {
    if (abort.signal.aborted) return
    release()
    status.value = 'error'
  }
})
</script>

<template>
  <div class="vd-armor-comparison">
    <div class="vd-armor-viewport vd-compare-frame">
      <div ref="host" class="vd-armor-canvas" aria-hidden="true"></div>
      <template v-if="status === 'ready' && active">
        <output v-if="inspected" class="vd-armor-thickness">
          {{ versions[inspected.side] }} · {{ inspected.thickness }} {{ t('agentTanks.units.MILLIMETER') }}
        </output>
        <VersionCompareDivider
          :model-value="compare"
          :from="versions[0]"
          :to="versions[1]"
          :label="t('versionDiff.armor.compareSlider', { tank: tankName })"
          @update:model-value="setCompare"
        />
      </template>
      <div v-else class="vd-armor-status" role="status">
        <template v-if="verification === 'mismatch'">{{ t('versionDiff.armor.compareMismatch') }}</template>
        <template v-else-if="status === 'configuration'">{{ t('versionDiff.armor.compareConfiguration') }}</template>
        <template v-else-if="status === 'error'">
          <span>{{ t('versionDiff.armor.compareError') }}</span>
          <AppButton variant="secondary" size="sm" @click="attempt++">{{ t('versionDiff.retry') }}</AppButton>
        </template>
        <template v-else>{{ t('versionDiff.loading') }}</template>
      </div>
    </div>

    <div v-if="status === 'ready' && active" class="vd-armor-compare-meta">
      <span class="vd-muted">{{ t(choiceIsolationKeys() ? 'versionDiff.armor.compareSelected' : matched ? 'versionDiff.armor.compareHighlight' : 'versionDiff.armor.compareNoPlate') }}</span>
      <select v-if="choices.length > 1" v-model="choiceKey" class="vd-select" :aria-label="t('versionDiff.tank.config')">
        <option v-for="item in choices" :key="item.key" :value="item.key">{{ item.label || item.key }}</option>
      </select>
    </div>
  </div>
</template>
