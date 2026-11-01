<script setup>
/**
 * 地图预览页（?view=map-preview）：不依赖回放文件，从资产包清单选择地图后进入
 * 与回放一致的 2D 战术图 / 3D 场景（相机与标注绘制全保留，无车辆、无传输）。
 *
 * 职责边界：本页只拥有**地图选择与模式切换**（URL 契约 ?map= &mode=）；场景生命周期
 * 归 3D 面板（playbackScene.loadMapOnly），2D 手势与标注归 2D 面板。地图清单来自
 * 资产包 /index.json（loadMapIndex），按 key 去重——变体空间（milbase 50-54 等）归并
 * 基础图，取首个出现的 id 作为 3D 装载入口。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Map as MapIcon } from 'lucide-vue-next'
import { useAuth } from '../composables/useAuth.js'
import { loadMapIndex, mapCoverUrl } from '../scene/replaySource.js'
import { mapImages } from '../data/mapImages.js'
import { mapBases } from '../data/mapBases.js'
import { mapLabel } from '../utils/helpers.js'
import { Feature } from '../app/featureCapabilities.js'
import AppButton from './AppButton.vue'
import Banner from './Banner.vue'
import EmptyState from './EmptyState.vue'
import ReplayCapabilityAuthGate from './ReplayCapabilityAuthGate.vue'
import SegmentedControl from './SegmentedControl.vue'
import MapPreview3DPane from './MapPreview3DPane.vue'
import MapPreview2DPane from './MapPreview2DPane.vue'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const { authenticated } = useAuth()

// ---- 地图清单（资产包 index.json → 按 key 去重的 picker 模型）----
/** 目录数据保持 locale 中性（rawMaps 只存 key/id/display）；显示名与排序是
 *  当前 locale 的**派生投影**（computed）——运行中切语言即时生效，不残留旧语言。 */
const rawMaps = ref([])
const failedThumbs = ref(new Set())
const nameOf = (m) => {
  const localized = mapLabel(m.key, locale.value)
  return localized !== m.key ? localized : (m.packDisplay || m.key)
}
const maps = computed(() => rawMaps.value
  .map((m) => ({
    ...m,
    name: nameOf(m),
    thumb: failedThumbs.value.has(m.key) ? null : m.thumb,
  }))
  .sort((a, b) => collator.compare(a.name, b.name)))
const indexFailed = ref(false)
const indexLoaded = ref(false)
const collator = new Intl.Collator()

async function loadMaps() {
  indexFailed.value = false
  const idx = await loadMapIndex()
  const entries = idx && idx.maps ? Object.entries(idx.maps) : null
  if (!entries) {
    // 资产源未配置 / 索引拉取失败（loadMapIndex 已告警）：预览没有 3D 数据面，明确失败
    indexFailed.value = true
    rawMaps.value = []
    indexLoaded.value = true
    return
  }
  const byKey = new Map()
  for (const [id, m] of entries) {
    const key = String(m.key || '')
    if (!key || byKey.has(key)) continue   // 变体空间归并基础图（首个出现的 id = 基础 id）
    const bundled = mapImages[key] || null
    byKey.set(key, {
      key,
      mapId: Number(id),
      packDisplay: m.display || '',
      // 底图双源（2D 面板用）：bundled 打包注册表优先（离线 + 逐图校准），
      // 未收录的图回退资产包 map2d 校准图（1254² 战术底图，±300 契约框）。
      basemap: bundled
        ? { kind: 'bundled', image: bundled }
        : { kind: 'map2d', mapKey: key },
      // 封面统一 cover.webp（512² 战术风格，43/43 同源同风格，~100KB/张）；
      // bundled.src 留作 cover 加载失败时的兜底（离线打包资产，必可用）。
      thumb: safeCoverUrl(key),
      thumbFallback: bundled ? bundled.src : null,
      // 点位（遭遇/争霸基地）：仅打包注册表收录的 29 张有（客户端 .sc2 提取），
      // 未收录图无几何数据——fail-closed 不显示点位开关，不做统计猜测。
      bases: mapBases[key] || null,
    })
  }
  rawMaps.value = [...byKey.values()]
  indexLoaded.value = true
}
/** 封面 URL（cover.webp，512² 战术风格，43/43 同源）：assetProvider 在 Android 离线
 *  门控下可抛（NETWORK_ERROR）——吞为 null 由 bundled.src 兜底，不让整份清单失败。 */
function safeCoverUrl(key) {
  try {
    return mapCoverUrl(key)
  } catch {
    return null
  }
}

/**
 * cover 加载失败 → 记住该 key，派生投影把 thumb 置空（模板走 thumbFallback
 * 打包底图；无 bundled 才落占位图标）。集合式记录避免重试循环：同一 key 只
 * 失败一次，渲染不再请求远端 URL。
 */
function onThumbError(m) {
  if (!m.thumb || failedThumbs.value.has(m.key)) return
  const next = new Set(failedThumbs.value)
  next.add(m.key)
  failedThumbs.value = next
}
watch(authenticated, (ok) => { if (ok && !indexLoaded.value) loadMaps() }, { immediate: true })

// ---- URL 契约：?map=<key> &mode=3d|2d &bases=supremacy|encounter ----
const selected = computed(() => maps.value.find((m) => m.key === route.query.map) || null)
const mode = computed(() => (route.query.mode === '2d' ? '2d' : '3d'))

/**
 * 基地点位（贴地环 / 2D 圆标）模式：?bases=supremacy|encounter 显式选择；
 * 无该键或值无对应几何时按「有争霸先争霸」回落。kind 是下发到两个 pane 的
 * mapBases 组键（'supremacy' | 'assault' | null）；遭遇的几何承载在 mapBases
 * 的 assault 组（攻防/遭遇共用，客户端 .sc2 提取）。无几何 → null（不显示、
 * 不显示切换），绝不由内容猜。
 */
const BASES_QUERY_KINDS = { supremacy: 'supremacy', encounter: 'assault' }
const basesKind = computed(() => {
  const bases = selected.value?.bases
  if (!bases) return null
  const fromUrl = BASES_QUERY_KINDS[route.query.bases]
  if (fromUrl && bases[fromUrl]?.length) return fromUrl
  if (bases.supremacy?.length) return 'supremacy'
  if (bases.assault?.length) return 'assault'
  return null
})
const basesOptions = computed(() => {
  const bases = selected.value?.bases
  if (!bases) return []
  return [
    ...(bases.supremacy?.length
      ? [{ value: 'supremacy', label: t('mapPreview.basesSupremacy'), testid: 'map-bases-supremacy' }]
      : []),
    ...(bases.assault?.length
      ? [{ value: 'encounter', label: t('mapPreview.basesEncounter'), testid: 'map-bases-encounter' }]
      : []),
  ]
})

function openMap(entry) {
  router.replace({ query: { ...route.query, map: entry.key, mode: mode.value } })
}
function setMode(value) {
  router.replace({ query: { ...route.query, mode: value } })
}
function setBases(value) {
  router.replace({ query: { ...route.query, bases: value } })
}
function backToPicker() {
  const query = { ...route.query }
  delete query.map
  delete query.mode
  delete query.bases
  router.replace({ query })
}

const modeOptions = computed(() => [
  { value: '3d', label: t('mapPreview.mode3d'), testid: 'map-mode-3d' },
  { value: '2d', label: t('mapPreview.mode2d'), testid: 'map-mode-2d' },
])
</script>

<template>
  <section class="map-preview" data-testid="map-preview-page">
    <ReplayCapabilityAuthGate
      v-if="!authenticated"
      :icon="MapIcon"
      :title="$t('mapPreview.title')"
      :description="$t('mapPreview.loginRequired')"
      login-destination="map-preview"
    />
    <template v-else>
      <EmptyState
        v-if="indexFailed"
        role="alert"
        :icon="MapIcon"
        :title="$t('mapPreview.title')"
        :description="$t('mapPreview.loadFailed')"
      >
        <AppButton data-testid="map-retry" @click="loadMaps">{{ $t('mapPreview.retry') }}</AppButton>
      </EmptyState>
      <EmptyState
        v-else-if="indexLoaded && !maps.length"
        :icon="MapIcon"
        :title="$t('mapPreview.title')"
        :description="$t('mapPreview.empty')"
      />

      <!-- 地图选择网格 -->
      <div v-else-if="!selected" class="map-picker">
        <header class="map-picker-head">
          <h1 class="map-picker-title">{{ $t('mapPreview.title') }}</h1>
          <p class="map-picker-subtitle">{{ $t('mapPreview.subtitle') }}</p>
        </header>
        <ul class="map-grid" data-testid="map-grid">
          <li v-for="m in maps" :key="m.key">
            <button
              type="button"
              class="map-card"
              :data-testid="`map-card-${m.key}`"
              @click="openMap(m)"
            >
              <span class="map-card-thumb">
                <img
                  v-if="m.thumb"
                  :src="m.thumb"
                  alt=""
                  loading="lazy"
                  :data-testid="`map-thumb-${m.key}`"
                  @error="onThumbError(m)"
                />
                <img
                  v-else-if="m.thumbFallback"
                  :src="m.thumbFallback"
                  alt=""
                  loading="lazy"
                  :data-testid="`map-thumb-fallback-${m.key}`"
                />
                <MapIcon v-else class="map-card-thumb-fallback" aria-hidden="true" />
              </span>
              <span class="map-card-name">{{ m.name }}</span>
              <span class="map-card-badge">{{ $t('mapPreview.twoDBadge') }}</span>
            </button>
          </li>
        </ul>
      </div>

      <!-- 地图视图：2D / 3D（v-show 保留 3D 场景，切模式不重建） -->
      <div v-else class="map-stage">
        <header class="map-stage-head">
          <AppButton variant="ghost" size="sm" data-testid="map-back" @click="backToPicker">
            <ArrowLeft aria-hidden="true" />
            {{ $t('mapPreview.backToPicker') }}
          </AppButton>
          <h1 class="map-stage-name">{{ selected.name }}</h1>
          <SegmentedControl
            v-if="basesOptions.length"
            class="map-bases-switch"
            :model-value="basesKind === 'assault' ? 'encounter' : basesKind"
            :options="basesOptions"
            :aria-label="$t('mapPreview.basesSwitch')"
            @update:model-value="setBases"
          />
          <SegmentedControl
            class="map-mode-switch"
            :model-value="mode"
            :options="modeOptions"
            :aria-label="$t('mapPreview.title')"
            @update:model-value="setMode"
          />
        </header>
        <div v-show="mode === '3d'" class="map-stage-pane">
          <MapPreview3DPane :map-id="selected.mapId" :map-name="selected.name" :map-key="selected.key" :bases-kind="basesKind" :active="mode === '3d'" />
        </div>
        <div v-show="mode === '2d'" class="map-stage-pane">
          <MapPreview2DPane :map-key="selected.key" :basemap="selected.basemap" :bases-kind="basesKind" />
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.map-preview {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.map-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
}

.map-picker-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.map-picker-title {
  font-size: var(--font-size-h2);
  line-height: var(--line-height-h2);
  margin: 0;
}

.map-picker-subtitle {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
}

.map-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-3);
}

.map-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2);
  border: var(--border-width) solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
  color: inherit;
  cursor: pointer;
  text-align: start;
}

.map-card:hover {
  border-color: var(--color-border-strong);
}

.map-card:focus-visible {
  outline: var(--focus-outline);
  outline-offset: var(--focus-outline-offset);
}

.map-card-thumb {
  display: block;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
}

.map-card-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.map-card-thumb-fallback {
  width: 100%;
  height: 100%;
  padding: var(--space-6);
  color: var(--color-text-tertiary);
}

.map-card-name {
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
}

.map-card-badge {
  position: absolute;
  inset-block-start: var(--space-2);
  inset-inline-end: var(--space-2);
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  background: var(--color-surface-3);
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption-xs);
  line-height: var(--line-height-caption-xs);
}

.map-stage {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.map-stage-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
}

.map-stage-name {
  font-size: var(--font-size-h3);
  line-height: var(--line-height-h3);
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.map-bases-switch,
.map-mode-switch {
  flex-shrink: 0;
}

/* 右侧控件组（点位切换 + 2D/3D）整体推到行尾，两组相邻 */
.map-bases-switch {
  margin-inline-start: auto;
}

.map-stage-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
</style>
