<script setup>
/**
 * 射击分析能力面板（回放工作台内，Master–Detail）。
 *
 * 数据面：目标回放在本机解析（上游 Rust Core WASM `parseShotReplays`，文件不出本机）→
 * 射击总览 / 射击者筛选 / 射击列表（master）+ 射击检视（detail）。
 * 文件与 session identity 由工作台唯一持有：本面板从不自己要求文件，也没有第二份 session。
 *
 * Master–Detail（design-language §9）按**容器宽度**分档，不按视口：
 * 宽档常驻右栏；中档选中后成推开式侧栏（列表让位不遮盖）；窄档整屏面板 + 遮罩，
 * 焦点在打开时进入面板、Esc / 关闭后回到触发它的那一行。
 * 窄档详情支持左右滑动 / 方向键在**当前筛选结果内**切换上一发 / 下一发（首尾不循环）。
 */
import { computed, inject, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { ONBOARDING_KEY } from '../shared/onboarding.js'
import { isOfficialDemo, OFFICIAL_DEMO } from '../replay-local/demo.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import {
  parseAgentShotsFromBytes, parseAgentPlaybackFromBytes, enrichShotsFromRoster, isShotHit,
} from '../api/agent-replay-facets.js'
import { shotResultBadge } from '../utils/shotPresentation.js'
import { storeShotsForViewer, fetchShotTankData, shotViewerQuery } from '../scene/agentData.js'
import { usePlaybackFullscreen } from '../composables/usePlaybackFullscreen.js'
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.js'
import { useShotsDecode } from './replay-shots/useShotsDecode.ts'
import { useShotsPresenters } from './replay-shots/useShotsPresenters.ts'
import { useShotsDetail } from './replay-shots/useShotsDetail.ts'
import SceneFullscreenButton from './SceneFullscreenButton.vue'
import Scene3DStatus from './Scene3DStatus.vue'
import Badge from './Badge.vue'
import StatStrip from './StatStrip.vue'
import TankClassIcon from './TankClassIcon.vue'
import AppButton from './AppButton.vue'
import Banner from './Banner.vue'
import EquipmentBadges from './EquipmentBadges.vue'
import SegmentedControl from './SegmentedControl.vue'

defineOptions({ name: 'ReplayShotsPane' })

const props = defineProps({
  /** 工作台派生的目标回放文件；null = 还没选（面板只显示提示） */
  file: { type: Object, default: null },
  /** 当前能力是否激活：false 时不解码（已在列表里的结果保留） */
  active: { type: Boolean, default: false },
  /** 工作台给出的不可用原因（多文件未选场次等）；非空时不解析 */
  blockedReason: { type: String, default: '' },
  /** 工作台注入的导航（router owner 不变）：在 3D 装甲查看器里打开这一发 */
  navigate: { type: Function, default: null },
  /** 工作台的「进入查看器」事件序号（Android 手机 App 自动全屏的边沿触发身份）。 */
  autoFullscreenToken: { type: Number, default: 0 },
})
const { t } = useI18n()
const onboarding = inject(ONBOARDING_KEY, null)
const selectedIndex = ref(null)
const shooter = ref('own')
const decodeApi = useShotsDecode({
  t,
  resetSelection: () => { selectedIndex.value = null },
  resetScope: () => { shooter.value = 'own' },
})
const {
  shots, parsing, err, authorError, othersError, authorEid, recorderTankName, battleStartRaw,
  beginDecode, dispose: disposeDecode, parseSeqNow, parsedFileNow, decodingNow,
} = decodeApi

onMounted(() => onboarding?.registerSurface('shots', {
  ready: () => props.active && selectedShot.value != null,
  prepare: () => { closeDetail(); shooter.value = 'own'; return decodingNow() },
  setGuideInset: pixels => { guideInset.value = Math.max(0, pixels) },
  cleanup: () => { guideInset.value = 0 },
  failed: () => !!err.value || !!props.blockedReason || (!parsing.value && parsedFileNow() === props.file && !filteredShots.value.some(rowHas3d)),
}))
onBeforeUnmount(() => onboarding?.registerSurface('shots', null))
onBeforeUnmount(() => {
  disposeDecode()
})
const { requireFeature, availability } = useFeatureGate()

const {
  shotClock, shellBadge, resultBadge, qualityIssues, playerName,
  isOwnShot, tankName, targetName,
  shooterOptions, shooterGroups, selectedShooter,
  ownShots, filteredShots, scopeTitle, scopeSubtitle,
  shotSummary, summaryStats, selectedShot,
  trajectoryLength, rowHas3d, hasEquipment,
} = useShotsPresenters({
  shots, authorEid, recorderTankName, battleStartRaw, shooter, selectedIndex, props, t,
})

const guideShot = computed(() => (isOfficialDemo(props.file)
  ? filteredShots.value.find(shot => shot.shot_id === OFFICIAL_DEMO.cue.shotId)
  : null) || filteredShots.value.find(rowHas3d))


const paneRoot = ref(null)
/** KeepAlive 停用（切到别的页面）时同样视为不可见：挂起的全屏请求迟到完成也必须交还 */
const lifecycleVisible = ref(true)
const viewerActive = () => props.active && lifecycleVisible.value
const { isPhone } = usePlaybackPhoneForm()
/**
 * 全屏目标是本面板根：筛选 / 选中 / 详情都是本组件状态，全屏只换容器尺寸，不重解析、不重置。
 * 全屏事实源仍是 usePlaybackFullscreen（document.fullscreenElement），无第二套状态。
 */
const { isFullscreen, fullscreenSupported, toggleFullscreen, unlockOrientation, exitOwnedFullscreen } = usePlaybackFullscreen({
  target: () => paneRoot.value,
  isPhone,
  isActive: viewerActive,
  // 成功就绪 = 当前文件已解析完成、无错误、至少一发射击（空结果只是空态）；解析中 / 终态错误 / 被阻断都不触发。
  auto: () => ({ token: props.autoFullscreenToken, key: props.file, active: viewerActive(), ready: !!props.file && !props.blockedReason && !parsing.value && !err.value && parsedFileNow() === props.file && shots.value.length > 0 }),
})
const releaseFullscreen = () => { unlockOrientation(); exitOwnedFullscreen() }
watch(() => props.active, (active) => { if (!active) releaseFullscreen() })
onDeactivated(() => { lifecycleVisible.value = false; releaseFullscreen() })
onActivated(() => { lifecycleVisible.value = true })



/**
 * 解码时机 = 能力激活（首次进入射击分析）：一个 watcher 同时覆盖"初始就激活"（深链直达）
 * 与"之后才激活"，也覆盖激活期间换了目标回放。同一文件不重复解码；切走不解码、保留结果。
 */
watch([() => props.active, () => props.file, () => props.blockedReason], ([active, file, blocked]) => {
  beginDecode(active, file, blocked)
}, { immediate: true })


/**
 * 在 3D 装甲查看器里复现这一发：装甲查看器属于坦克百科侧（独立页面），
 * 工作台只把发射数据交出去（本地交接通道，无服务端），导航仍走 router。
 * 返回是否真的发起了导航（compact 直达据此决定清选择还是退回本地检视面板）。
 */
const {
  layout, guideLayout, directOpening, detailOpen, isOverlay,
  detailPane, guideInset, setGuideInset,
  applyLayout, selectShot, showDetail, closeDetail,
  selectedPosition, hasPreviousShot, hasNextShot, goToAdjacentShot,
  onDetailKeydown, onDetailPointerDown, onDetailPointerUp, onDetailPointerCancel,
} = useShotsDetail({
  shots, filteredShots, selectedIndex, paneRoot, onboarding,
  availability3d: () => availability(Feature.PLAYBACK_3D), openInViewer, rowHas3d,
})

async function openInViewer(s) {
  if (!requireFeature(Feature.PLAYBACK_3D)) return false
  if (!rowHas3d(s)) return false
  const shooterTank = s.shooter_tank_id || 0
  const tank = s.target_tank_id || shooterTank || 0
  if (!tank) return false
  // **点击时刻的射击快照**贯穿交接与导航（评审 P2）：storeShotsForViewer 在调用时
  // 同步序列化（点击时版本），而 shotViewerQuery 的 await 期间后台配置注解可能就地
  // 修改 live 对象——继续读 live 会得到「交接 JSON 按点击时配置装配模型/炮口、URL
  // scfg 按注解后配置选弹表」的错位组合。快照后两处消费同一版本；未注解字段在
  // shotViewerQuery / tankViewer 内各自走既有回退，语义一致。
  // s 是 reactive proxy（selectedShot 派生），structuredClone 不可克隆 → JSON 往返
  // （shot facet 全为可 JSON 值，与 storeShotsForViewer 的序列化口径一致）。
  s = JSON.parse(JSON.stringify(s))
  const sequence = parseSeqNow()
  storeShotsForViewer(JSON.parse(JSON.stringify(filteredShots.value.filter(rowHas3d))), { battleStartRaw: battleStartRaw.value })
  const query = await shotViewerQuery(s)
  if (sequence !== parseSeqNow() || selectedIndex.value !== s.index || !props.active || !query || !requireFeature(Feature.PLAYBACK_3D)) return false
  // Routing remains owned by the workspace. Both entry and viewer navigation share one config resolver.
  if (!props.navigate) return false
  props.navigate({ query })
  return true
}
</script>

<template>
  <!-- data-pane-ready：解析中不置位（工作台自动居中要等真实内容）。 -->
  <div ref="paneRoot" class="shots-pane" data-testid="replay-shots-pane" :data-pane-ready="parsing ? undefined : 'true'" @keydown="onDetailKeydown">
    <Scene3DStatus v-if="parsing" mode="loading" :message="$t('agentShots.parsing')" />
    <!-- 解析期间不显示"没选文件 / 被阻断 / 解析失败"：那些是解析**结果**，不是进行中的状态 -->
    <p v-else-if="blockedReason" class="shots-note" data-testid="shots-blocked">{{ blockedReason }}</p>
    <p v-else-if="!file" class="shots-note" data-testid="shots-empty">{{ $t('workspace.capability_upload_hint') }}</p>
    <Banner v-else-if="err" tone="danger" data-testid="shots-error">
      <p>{{ err }}</p>
    </Banner>
    <template v-else>
      <!-- 作者严格路径 fail-visible（契约 v0.1.9 核心目标）：独立于列表 / 空态状态链——
           author_path=error 且他人宽松路径 0 发时，警示与空态并存，
           绝不允许只显示"没有射击"把作者链失败伪装成正常空结果 -->
      <Banner v-if="authorError" tone="warning" data-testid="shots-author-error">
        <p>{{ $t('agentShots.author_path_error') }}</p>
        <p class="shots-cause">{{ authorError.slice(0, 160) }}</p>
      </Banner>
      <!-- 他人宽松路径 fail-visible（上游 v0.4.20）：others 缺失而 others_error 在场 =
           内部不变量破坏（代码缺陷），不是"没有其他玩家射击"——绝不静默当全 0 统计 -->
      <Banner v-if="othersError" tone="warning" data-testid="shots-others-error">
        <p>{{ $t('agentShots.others_error') }}</p>
        <p class="shots-cause">{{ othersError.slice(0, 160) }}</p>
      </Banner>

      <header class="shots-overview">
        <div class="shots-scope">
          <h2>{{ scopeTitle }}</h2>
          <p>{{ scopeSubtitle }}</p>
        </div>
        <SceneFullscreenButton
          v-if="isPhone && fullscreenSupported"
          class="shots-fullscreen"
          :is-fullscreen="isFullscreen"
          :floating="false"
          data-testid="shots-fullscreen"
          @toggle="toggleFullscreen()"
        />
        <!-- compact：射击者先给两项分段（我的 / 全部），按玩家筛选保留在下方下拉里 -->
        <SegmentedControl
          v-if="layout === 'compact'"
          class="shots-scope-switch"
          presentation="tiles"
          :model-value="shooter === 'own' || shooter === 'all' ? shooter : ''"
          :options="[
            { value: 'own', label: `${$t('agentShots.my_shots')} · ${ownShots.length}`, testid: 'shots-scope-own' },
            { value: 'all', label: `${$t('agentShots.all_shooters')} · ${shots.length}`, testid: 'shots-scope-all' },
          ]"
          :ariaLabel="$t('agentShots.shooter')"
          @update:model-value="value => shooter = value"
        />
        <div class="shots-filter">
          <label class="shots-filter-label" for="shots-shooter-select">{{ $t('agentShots.shooter') }}</label>
          <select id="shots-shooter-select" v-model="shooter" class="shots-select" data-testid="shots-shooter-select">
            <option value="own">{{ $t('agentShots.my_shots') }} ({{ ownShots.length }})</option>
            <option value="all">{{ $t('agentShots.all_shooters') }} ({{ shots.length }})</option>
            <template v-for="(options, group) in shooterGroups" :key="group">
              <optgroup v-if="options.length" :label="$t(`agentShots.${group === 'unknown' ? 'unknown_side' : group}`)">
                <option v-for="option in options" :key="option.key" :value="option.value">{{ option.tankName }} · {{ option.name }} ({{ option.n }})</option>
              </optgroup>
            </template>
          </select>
        </div>
      </header>
      <StatStrip :stats="summaryStats" />
      <p class="shots-recording-hint">{{ $t('agentShots.recording_hint') }}</p>
      <div v-if="!filteredShots.length" class="shots-empty-state" data-testid="shots-no-shots">
        <strong>{{ $t('agentShots.no_shots') }}</strong>
        <p>{{ $t(shooter === 'own' ? 'agentShots.no_own_shots' : 'agentShots.no_filtered_shots') }}</p>
        <AppButton v-if="shooter === 'own' && shots.length" @click="shooter = 'all'">{{ $t('agentShots.browse_all_shots') }}</AppButton>
      </div>
      <div v-else class="shots-split" :class="[`is-${guideLayout}`, { 'has-detail': detailOpen }]">
        <div class="shot-master">
          <div class="shot-list-heading"><h3>{{ $t('agentShots.shot_sequence') }}</h3><span>{{ $t('agentShots.shot_count', { count: filteredShots.length }) }}</span></div>
        <ul class="shot-list" :aria-label="$t('agentShots.title')">
          <li v-for="(s, position) in filteredShots" :key="s.index">
            <button
              type="button"
              class="shot-row"
              :class="{ 'is-selected': selectedIndex === s.index }"
              :aria-current="selectedIndex === s.index ? 'true' : undefined"
              :data-testid="`shot-row-${s.index}`"
              :data-tour="s === guideShot ? 'shots-first-shot' : undefined"
              @click="selectShot(s.index, $event)"
            >
              <span class="shot-time"><span class="shot-ordinal">{{ position + 1 }}</span><span class="shot-clock">{{ shotClock(s) }}</span></span>
              <span class="shot-path">
                <span class="shot-names">
                  <span class="shot-vehicle"><span class="shot-name"><TankClassIcon :tank-class="s.shooter_tank_class" />{{ tankName(s, 'shooter') }}</span><span class="shot-player">{{ playerName(s.shooter_name) }}</span></span>
                  <span class="shot-arrow" aria-hidden="true">→</span>
                  <span class="shot-vehicle"><span class="shot-name"><TankClassIcon v-if="s.target_eid != null" :tank-class="s.target_tank_class" />{{ targetName(s) }}</span><span v-if="s.target_eid != null" class="shot-player">{{ playerName(s.target_name) }}</span></span>
                </span>
                <span class="shot-meta">
                  <Badge :text="resultBadge(s).text" :tone="resultBadge(s).tone" />
                  <Badge v-if="shellBadge(s).label" :text="shellBadge(s).label" :tone="shellBadge(s).tone" />
                  <span v-if="shellBadge(s).pen" class="shot-dim">{{ shellBadge(s).pen }} mm</span>
                  <span v-if="s.damage" class="shot-dmg">{{ $t('agentShots.damage_value', { damage: s.damage }) }}</span>
                  <span v-if="s.is_kill" class="shot-kill">{{ $t('agentShots.stat_kills') }}</span>
                  <span v-if="qualityIssues(s).length" class="shot-flag" :title="qualityIssues(s).join('; ')">!</span>
                </span>
              </span>
            </button>
          </li>
        </ul>
        </div>

        <aside
          v-if="detailOpen"
          ref="detailPane"
          class="shot-detail"
          tabindex="-1"
          data-testid="shot-inspector"
          data-tour="shots-inspector"
          :style="guideInset > 0 ? { insetBlockEnd: `${guideInset}px` } : undefined"
          :role="isOverlay ? 'dialog' : undefined"
          :aria-modal="isOverlay ? 'true' : undefined"
          :aria-label="$t('agentShots.inspector_title')"
          @pointerdown="onDetailPointerDown"
          @pointerup="onDetailPointerUp"
          @pointercancel="onDetailPointerCancel"
        >
          <header class="shot-detail-head">
            <div><h3 class="shot-detail-title">{{ $t('agentShots.inspector_title') }}</h3><p class="shot-detail-position">{{ $t('agentShots.shot_position', { current: selectedPosition + 1, total: filteredShots.length }) }} · {{ shotClock(selectedShot) }}</p></div>
            <div class="shot-detail-nav">
              <!-- 滑动是快捷方式，按钮是可发现 / 可键盘操作的等价路径（首尾各自 disabled，不循环） -->
              <button
                type="button"
                class="shot-nav-btn"
                data-testid="shot-prev"
                :disabled="!hasPreviousShot"
                :title="$t('agentShots.prev_shot')"
                :aria-label="$t('agentShots.prev_shot')"
                @click="goToAdjacentShot(-1)"
              ><ChevronLeft :size="16" aria-hidden="true" /></button>
              <button
                type="button"
                class="shot-nav-btn"
                data-testid="shot-next"
                :disabled="!hasNextShot"
                :title="$t('agentShots.next_shot')"
                :aria-label="$t('agentShots.next_shot')"
                @click="goToAdjacentShot(1)"
              ><ChevronRight :size="16" aria-hidden="true" /></button>
              <AppButton size="sm" data-testid="shot-detail-close" @click="closeDetail">{{ $t('agentShots.close') }}</AppButton>
            </div>
          </header>
          <div class="shot-matchup">
            <div><span class="shot-player">{{ $t('agentShots.col_shooter') }}</span><strong><TankClassIcon :tank-class="selectedShot.shooter_tank_class" />{{ tankName(selectedShot, 'shooter') }}</strong><span class="shot-player">{{ playerName(selectedShot.shooter_name) }}</span></div>
            <span class="shot-arrow" aria-hidden="true">→</span>
            <div><span class="shot-player">{{ $t('agentShots.col_target') }}</span><strong><TankClassIcon v-if="selectedShot.target_eid != null" :tank-class="selectedShot.target_tank_class" />{{ targetName(selectedShot) }}</strong><span v-if="selectedShot.target_eid != null" class="shot-player">{{ playerName(selectedShot.target_name) }}</span></div>
          </div>
          <AppButton
            v-if="rowHas3d(selectedShot)"
            variant="primary"
            data-testid="shot-open-viewer"
            data-tour="shot-open-viewer"
            @click="openInViewer(selectedShot)"
          >{{ $t('agentShots.open_viewer') }}</AppButton>
          <dl class="shot-detail-grid">
            <div class="shot-detail-row"><dt>{{ $t('agentShots.col_time') }}</dt><dd>{{ shotClock(selectedShot) }}</dd></div>
            <div class="shot-detail-row"><dt>{{ $t('agentShots.col_shell') }}</dt><dd>
              <Badge v-if="shellBadge(selectedShot).label" :text="shellBadge(selectedShot).label" :tone="shellBadge(selectedShot).tone" />
              <span v-else class="shot-dim">{{ $t('agentShots.shell_unknown') }}</span>
              <span v-if="shellBadge(selectedShot).pen" class="shot-dim">{{ shellBadge(selectedShot).pen }} mm</span>
            </dd></div>
            <div class="shot-detail-row"><dt>{{ $t('agentShots.col_result') }}</dt><dd>
              <Badge :text="resultBadge(selectedShot).text" :tone="resultBadge(selectedShot).tone" />
            </dd></div>
            <div class="shot-detail-row"><dt>{{ $t('agentShots.col_dmg') }}</dt><dd>{{ selectedShot.damage || 0 }}</dd></div>
            <div class="shot-detail-row"><dt>{{ $t('agentShots.detail_impact') }}</dt><dd>
              {{ selectedShot.target_eid != null ? $t('agentShots.impact_hit') : $t('agentShots.impact_miss') }}
            </dd></div>
            <div v-if="trajectoryLength(selectedShot) != null" class="shot-detail-row">
              <dt>{{ $t('agentShots.detail_trajectory') }}</dt>
              <dd>{{ trajectoryLength(selectedShot).toFixed(1) }} m</dd>
            </div>
            <div v-if="hasEquipment(selectedShot)" class="shot-detail-row">
              <dt>{{ $t('agentShots.col_equipment') }}</dt>
              <dd>
                <EquipmentBadges :ids="selectedShot.shooter_equipment?.raw ?? null" />
              </dd>
            </div>
          </dl>

          <details v-if="qualityIssues(selectedShot).length" class="shot-detail-quality">
            <summary>{{ $t('agentShots.detail_quality') }} · {{ qualityIssues(selectedShot).length }}</summary>
            <ul>
              <li v-for="issue in qualityIssues(selectedShot)" :key="issue">{{ issue }}</li>
            </ul>
          </details>

          <p class="shot-detail-hint">{{ $t('agentShots.inspector_hint') }}</p>
        </aside>
        <div v-else-if="layout === 'expanded'" class="shot-detail-placeholder"><h3>{{ $t('agentShots.select_shot') }}</h3><p>{{ $t('agentShots.select_shot_hint') }}</p></div>
      </div>
    </template>
  </div>
</template>

<style scoped src="./replay-shots.css"></style>
