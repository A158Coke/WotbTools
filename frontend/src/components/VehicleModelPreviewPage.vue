<script setup>
// 隐藏 QA 页：Tier X 专属俯视车型资产的单车型预览（计划 §46/§47 骨架版）。
// 只允许 wotbtools-admin；不放导航入口，仅深链 ?view=vehicle-models。
// 渲染方式与生产 BattlePlayback 一致（HTML 双层 + 绕 pivot CSS rotate），
// PR2 落地 production VehicleMarker 后本页改为直接复用该组件。
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import { VIEWBOX } from '../vehicle-models/types.js'
import { hullLayerTransform, turretAssemblyTransform, turretImageTransform, turretRingPosition } from '../vehicle-models/pivot.js'

const { t } = useI18n()
const { initPromise, tokenParsed, authenticated, login } = useAuth()

const LOGIN_VIEW = 'vehicle-models'

// 资产目录注册表（正式契约 = texture-baked webp）：hull/turret URL + metadata。
const hullUrls = import.meta.glob('../vehicle-models/assets/*/hull.webp', { eager: true, query: '?url', import: 'default' })
const turretUrls = import.meta.glob('../vehicle-models/assets/*/turret.webp', { eager: true, query: '?url', import: 'default' })
const metadataMap = import.meta.glob('../vehicle-models/assets/*/metadata.json', { eager: true, import: 'default' })
const bakeReportMap = import.meta.glob('../vehicle-models/assets/*/bake-report.json', { eager: true, import: 'default' })
// QA 对比（A=geometry SVG debug / C=source reference）仅 dev 环境存在（gitignored 缓存），构建后自动隐藏。
const qaSvgUrls = import.meta.glob('../../scripts/.vehicle-model-refs/debug/*/final-hull.svg', { eager: true, query: '?url', import: 'default' })
const qaRefUrls = import.meta.glob('../../scripts/.vehicle-model-refs/debug/*/_textured-canvas-320.png', { eager: true, query: '?url', import: 'default' })

const isAdmin = computed(() => {
  const roles = tokenParsed.value?.realm_access?.roles
  return Array.isArray(roles) && roles.includes('wotbtools-admin')
})

const authPhase = ref(authenticated.value ? 'ready' : 'init')
const ready = ref(false)
const denied = ref(false)
const modelMeta = ref(null) // { modelKey, kind, tankIds, names }

onMounted(async () => {
  let loggedIn = false
  try {
    loggedIn = Boolean(await initPromise)
  } catch {
    loggedIn = false
  }
  if (!loggedIn) {
    authPhase.value = 'login'
    login(LOGIN_VIEW)
    return
  }
  authPhase.value = 'ready'
  if (!isAdmin.value) {
    denied.value = true
    return
  }
  // 车型清单（mapping + Tankopedia 名称）动态加载，避免进主包。
  const [{ MODEL_DEFINITIONS }, tp] = await Promise.all([
    import('../vehicle-models/mapping.js'),
    import('../../../common/tankopedia-tier10.json'),
  ])
  const byId = new Map(tp.default.vehicles.map((v) => [v.id, v]))
  const entries = Object.entries(MODEL_DEFINITIONS).map(([modelKey, def]) => ({
    modelKey,
    kind: def.kind,
    tankIds: def.tankIds,
    names: def.tankIds.map((id) => byId.get(id)?.name || String(id)),
  }))
  modelMeta.value = entries
  ready.value = true
})

// —— 选择与状态 ——
const selectedKey = ref('maus')
const hullDeg = ref(0)
const turretDeg = ref(0)
const showDestroyed = ref(false)
const showLastKnown = ref(false)
const showSelected = ref(false)
const showRecorder = ref(false)
const showPivot = ref(true)
const canvasSize = ref(320)

const selected = computed(() => modelMeta.value?.find((m) => m.modelKey === selectedKey.value) || null)
const isTurreted = computed(() => selected.value?.kind === 'turreted')
const metadataJson = computed(() => metadataMap[`../vehicle-models/assets/${selectedKey.value}/metadata.json`] || null)
const pivot = computed(() => metadataJson.value?.turretPivot || null)
const hullUrl = computed(() => hullUrls[`../vehicle-models/assets/${selectedKey.value}/hull.webp`] || null)
const turretUrl = computed(() => turretUrls[`../vehicle-models/assets/${selectedKey.value}/turret.webp`] || null)
const hasAssets = computed(() => Boolean(hullUrl.value))
// —— QA 对比（正式 bake 为主；A=geometry SVG debug / C=source reference 仅 dev）——
const qaSvgUrl = computed(() => qaSvgUrls[`../../scripts/.vehicle-model-refs/debug/${selectedKey.value}/final-hull.svg`] || null)
const qaRefUrl = computed(() => qaRefUrls[`../../scripts/.vehicle-model-refs/debug/${selectedKey.value}/_textured-canvas-320.png`] || null)
const bakeReport = computed(() => bakeReportMap[`../vehicle-models/assets/${selectedKey.value}/bake-report.json`] || null)
// QA 报告行（i18n；turretless / 缺字段以 — 兜底）
const qaReportText = computed(() => {
  if (!bakeReport.value) return ''
  const m = bakeReport.value.selectedModules
  const p = bakeReport.value.turretPivot
  return t('adminPreview.qaReport', {
    turretId: m ? m.turretId : '—',
    gunId: m ? m.gunId : '—',
    hullBytes: bakeReport.value.assets?.hullWebp ?? '—',
    turretBytes: bakeReport.value.assets?.turretWebp ?? '—',
    pivotX: p ? p.x : '—',
    pivotY: p ? p.y : '—',
  })
})
const hasQa = computed(() => Boolean(hullUrl.value))
const protoSize = ref(320)
const PROTO_SIZES = [320, 128, 64, 28, 24, 20]
const protoGeomStyle = computed(() => ({
  width: protoSize.value + 'px',
  height: protoSize.value + 'px',
  position: 'relative',
  overflow: 'visible',
}))
const protoBakeStyle = computed(() => ({
  width: protoSize.value + 'px',
  height: protoSize.value + 'px',
  position: 'relative',
}))
const bakeHullLayerStyle = computed(() => {
  // PR92 Review B1 修复：transform-origin 必须随 protoSize 缩放（此前写死 160px，
  // protoSize≠320 时 hull 绕盒外点旋转，车体视觉漂移、被误读为 pivot 偏后）——
  // 与 bakeTurretAssemblyStyle 的 renderScale 同构。
  const s = protoSize.value / 320
  return {
    position: 'absolute', left: '0', top: '0', width: '100%', height: '100%',
    transform: 'rotate(' + hullDeg.value + 'deg)',
    transformOrigin: (VIEWBOX.width / 2) * s + 'px ' + (VIEWBOX.height / 2) * s + 'px', // hull 绕画布中心（随 protoSize 缩放）
  }
})
// QA 对比 cell：与正式渲染同构的嵌套 transform（父层随 hull 旋转，子层绕 image-local pivot）
const bakeTurretAssemblyStyle = computed(() => {
  if (!pivot.value) return null
  const s = protoSize.value / 320
  return {
    position: 'absolute', left: '0', top: '0', width: '100%', height: '100%',
    ...turretAssemblyTransform({ hullDeg: hullDeg.value, renderScale: s }),
  }
})
const bakeTurretLayerStyle = computed(() => {
  if (!pivot.value) return null
  const raster = metadataJson.value?.turretRaster
  if (!raster) return null
  const s = protoSize.value / 320
  return {
    position: 'absolute',
    left: raster.logicalMinX * s + 'px',
    top: raster.logicalMinY * s + 'px',
    width: (raster.pixelWidth / 2) * s + 'px',
    height: (raster.pixelHeight / 2) * s + 'px',
    // 子层只转 (T - H)：父层已转 hullDeg，最终 world yaw = turretDeg
    ...turretImageTransform({ hullDeg: hullDeg.value, turretWorldDeg: turretDeg.value, pivot: { x: raster.pivotX, y: raster.pivotY }, renderScale: s }),
  }
})

// 旋转数学（pivot.js，Blocker 2 OFF_CENTER_TURRET_HULL_COMPOSITION）：
// turretDeg 是 authoritative turret world yaw（T）。hull 旋转 H 后炮塔座圈随车体
// 围绕画布中心 C 移动：P' = C + rotate(P - C, H)（非固定 screen point）。
// 嵌套 transform：assembly 父层 rotate(H) around C；image 子层 rotate(T - H)
// around image-local pivot（raster.pivotX/pivotY）——最终 world yaw = T。
// img 与 320×320 viewBox 1:1 对齐，origin 用 viewBox 坐标 × renderScale。
const renderScale = computed(() => canvasSize.value / VIEWBOX.width)
const hullLayerStyle = computed(() => hullLayerTransform({ deg: hullDeg.value, renderScale: renderScale.value }))
const turretAssemblyStyle = computed(() => {
  // 无 pivot / 无 turretRaster（turretless / 缺契约）时不设置 style
  if (!isTurreted.value || !pivot.value) return null
  return {
    position: 'absolute', left: '0', top: '0', width: '100%', height: '100%',
    ...turretAssemblyTransform({ hullDeg: hullDeg.value, renderScale: renderScale.value }),
  }
})
const turretLayerStyle = computed(() => {
  if (!isTurreted.value || !pivot.value) return null
  const raster = metadataJson.value?.turretRaster
  if (!raster) return null
  // raster overflow contract：turret.webp 画布 = turret+mantlet+完整 gun 的 logical bounds
  // （可超出 320 画布）——img 以 raster 原点定位，transform-origin = raster 内 pivot。
  const s = renderScale.value
  return {
    position: 'absolute',
    left: raster.logicalMinX * s + 'px',
    top: raster.logicalMinY * s + 'px',
    width: (raster.pixelWidth / 2) * s + 'px',
    height: (raster.pixelHeight / 2) * s + 'px',
    ...turretImageTransform({ hullDeg: hullDeg.value, turretWorldDeg: turretDeg.value, pivot: { x: raster.pivotX, y: raster.pivotY }, renderScale: s }),
  }
})
const pivotStyle = computed(() => {
  if (!pivot.value) return {}
  const s = renderScale.value
  // hull 旋转后的真实炮塔座圈位置（非固定 turretPivot）
  const ring = turretRingPosition({ pivot: pivot.value, hullDeg: hullDeg.value })
  return { left: ring.x * s + 'px', top: ring.y * s + 'px' }
})

// —— PR92 Review B1：炮塔视觉质心参照（人工 QA 辅助）——
// turret.webp 含完整炮管（raster overflow contract）：炮管占图像上部，座圈（红圈）
// 位于其下方——视觉上"pivot 偏后"，但这是真实几何（座圈=炮管根部），不是数值偏差。
// 本标记显示 turret.webp 非透明像素质心（青色圆点），QA 对照红圈即可确认：
// 座圈落在炮塔主体上即正确；"偏后"量 ≈ 炮管在图像中的占比效应。
const showCentroid = ref(false)
const turretCentroidLogical = ref(null) // {x,y} 320 logical 画布坐标
watch(turretUrl, async () => {
  turretCentroidLogical.value = null
  const url = turretUrl.value
  const raster = metadataJson.value?.turretRaster
  if (!url || !raster) return
  try {
    const res = await fetch(url)
    if (!res.ok) return
    const blob = await res.blob()
    const bmp = await createImageBitmap(blob)
    const cv = document.createElement('canvas')
    cv.width = bmp.width
    cv.height = bmp.height
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.drawImage(bmp, 0, 0)
    const data = ctx.getImageData(0, 0, cv.width, cv.height).data
    let sx = 0, sy = 0, cnt = 0
    for (let y = 0; y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) {
        if (data[(y * cv.width + x) * 4 + 3] > 40) { sx += x; sy += y; cnt++ }
      }
    }
    if (!cnt) return
    // 物理像素 / 2 = logical；+ raster 原点 → 320 画布坐标
    turretCentroidLogical.value = {
      x: raster.logicalMinX + (sx / cnt) / 2,
      y: raster.logicalMinY + (sy / cnt) / 2,
    }
  } catch {
    /* dev-only QA 辅助：图像解码失败静默（如 happy-dom 测试环境） */
  }
})
const centroidStyle = computed(() => {
  const c = turretCentroidLogical.value
  if (!c) return { display: 'none' }
  const s = renderScale.value
  return { left: c.x * s + 'px', top: c.y * s + 'px' }
})
</script>

<template>
  <div class="vmp-page">
    <h2>{{ t('adminPreview.title') }}</h2>
    <p class="vmp-hint">{{ t('adminPreview.hint') }}</p>

    <div v-if="authPhase === 'init'">{{ t('adminPreview.loading') }}</div>
    <div v-else-if="denied" class="vmp-denied">{{ t('adminPreview.denied') }}</div>

    <template v-else-if="ready">
      <div class="vmp-toolbar">
        <label>
          {{ t('adminPreview.model') }}
          <select v-model="selectedKey">
            <option v-for="m in modelMeta" :key="m.modelKey" :value="m.modelKey">
              {{ m.modelKey }}（{{ m.names.join(' / ') }}）
            </option>
          </select>
        </label>
        <label>
          {{ t('adminPreview.hullRot') }}
          <input v-model.number="hullDeg" type="range" min="0" max="359" step="1">
          <span class="vmp-val">{{ hullDeg }}°</span>
        </label>
        <label v-if="isTurreted">
          {{ t('adminPreview.turretRot') }}
          <input v-model.number="turretDeg" type="range" min="0" max="359" step="1">
          <span class="vmp-val">{{ turretDeg }}°</span>
        </label>
        <label>
          {{ t('adminPreview.canvasSize') }}
          <input v-model.number="canvasSize" type="range" min="160" max="480" step="16">
        </label>
      </div>

      <div class="vmp-states">
        <span class="vmp-states-label">{{ t('adminPreview.states') }}:</span>
        <label><input v-model="showSelected" type="checkbox"> {{ t('adminPreview.selected') }}</label>
        <label><input v-model="showRecorder" type="checkbox"> {{ t('adminPreview.recorder') }}</label>
        <label><input v-model="showDestroyed" type="checkbox"> {{ t('adminPreview.destroyed') }}</label>
        <label><input v-model="showLastKnown" type="checkbox"> {{ t('adminPreview.lastKnown') }}</label>
        <label v-if="isTurreted"><input v-model="showPivot" type="checkbox"> {{ t('adminPreview.showPivot') }}</label>
        <label v-if="isTurreted"><input v-model="showCentroid" type="checkbox"> {{ t('adminPreview.showCentroid') }}</label>
      </div>

      <div class="vmp-stage">
        <div
          class="vmp-canvas"
          :class="{ 'vmp-destroyed': showDestroyed, 'vmp-last-known': showLastKnown }"
          :style="{ width: canvasSize + 'px', height: canvasSize + 'px' }"
        >
          <img v-if="hullUrl" class="vmp-hull" :src="hullUrl" alt="" :style="hullLayerStyle">
          <div v-if="isTurreted && turretUrl" class="vmp-turret-assembly" :style="turretAssemblyStyle">
            <img class="vmp-turret" :src="turretUrl" alt="" :style="turretLayerStyle">
          </div>
          <span
            v-if="showSelected"
            class="vmp-selected"
            data-test="vmp-selected"
            :style="{ borderTopColor: '#e5484d', zIndex: 6 }"
          ></span>
          <span v-if="showRecorder" class="vmp-recorder"></span>
          <span v-if="showDestroyed" class="vmp-death">✕</span>
          <span v-if="isTurreted && showPivot && pivot" class="vmp-pivot" :style="pivotStyle"></span>
          <span v-if="isTurreted && showCentroid" class="vmp-centroid" :style="centroidStyle"></span>
          <span v-if="selected && !hasAssets" class="vmp-pending">{{ t('adminPreview.pending') }}</span>
          <span v-if="selected" class="vmp-name">{{ selected.names.join(' / ') }}</span>
        </div>
      </div>

      <!-- QA 对比（正式 bake 资产；A=geometry SVG debug / C=source reference 仅 dev 有缓存时显示） -->
      <div v-if="hasQa" class="vmp-proto">
        <h3>{{ t('adminPreview.qaTitle') }}</h3>
        <div class="vmp-proto-sizes">
          <span>{{ t('adminPreview.protoSize') }}:</span>
          <button
            v-for="sz in PROTO_SIZES"
            :key="sz"
            class="vmp-proto-btn"
            :class="{ 'vmp-proto-active': protoSize === sz }"
            @click="protoSize = sz"
          >{{ sz }}</button>
        </div>
        <div class="vmp-proto-row">
          <div class="vmp-proto-cell">
            <p class="vmp-proto-label">{{ t('adminPreview.qaLabelA') }}</p>
            <div v-if="qaSvgUrl" :style="protoGeomStyle">
              <img class="vmp-proto-img" :src="qaSvgUrl" alt="" :style="bakeHullLayerStyle">
            </div>
            <p v-else class="vmp-proto-none">{{ t('adminPreview.qaDevOnly') }}</p>
          </div>
          <div class="vmp-proto-cell">
            <p class="vmp-proto-label">{{ t('adminPreview.qaLabelB') }}</p>
            <div :style="protoBakeStyle">
              <img v-if="hullUrl" class="vmp-proto-img" :src="hullUrl" alt="" :style="bakeHullLayerStyle">
              <div v-if="isTurreted && turretUrl" :style="bakeTurretAssemblyStyle">
                <img class="vmp-proto-img" :src="turretUrl" alt="" :style="bakeTurretLayerStyle">
              </div>
            </div>
          </div>
          <div class="vmp-proto-cell">
            <p class="vmp-proto-label">{{ t('adminPreview.qaLabelC') }}</p>
            <img v-if="qaRefUrl" class="vmp-proto-img" :src="qaRefUrl" alt="" :style="{ width: protoSize + 'px', height: protoSize + 'px', background: 'rgba(0,0,0,0.08)' }">
            <p v-else class="vmp-proto-none">{{ t('adminPreview.qaDevOnly') }}</p>
          </div>
        </div>
        <p v-if="bakeReport" class="vmp-proto-report">{{ qaReportText }}</p>
      </div>

      <div class="vmp-info" v-if="selected">
        <p><strong>{{ selected.modelKey }}</strong> · {{ isTurreted ? t('adminPreview.turreted') : t('adminPreview.turretless') }} · {{ selected.tankIds.join(', ') }}</p>
        <p v-if="!hasAssets">{{ t('adminPreview.pending') }}</p>
        <template v-else>
          <p v-if="pivot">{{ t('adminPreview.pivot') }}: {{ pivot.x }}, {{ pivot.y }}</p>
          <p v-if="metadataJson?.blitzkitReference">
            {{ t('adminPreview.reference') }}: <a :href="metadataJson.blitzkitReference" target="_blank" rel="noopener">{{ metadataJson.blitzkitReference }}</a>
          </p>
          <p v-if="metadataJson?.distinctiveFeatures?.length">
            {{ t('adminPreview.features') }}: {{ metadataJson.distinctiveFeatures.join('；') }}
          </p>
          <p v-if="metadataJson?.generationNotes">{{ metadataJson.generationNotes }}</p>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.vmp-page {
  max-width: 1080px;
  margin: 0 auto;
  padding: 16px 20px 40px;
  color: var(--text, #1e231f);
}
.vmp-hint { color: var(--text-sub, #72796f); font-size: 13px; }
.vmp-denied { color: var(--error, #b6362e); font-weight: 600; }
.vmp-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  align-items: center;
  margin: 14px 0;
}
.vmp-toolbar label { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }
.vmp-val { min-width: 3em; text-align: right; font-variant-numeric: tabular-nums; }
.vmp-states { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 14px; font-size: 13px; }
.vmp-states-label { color: var(--text-sub, #72796f); }
.vmp-stage { display: flex; justify-content: center; padding: 12px; background: var(--bg-card2, #eef1eb); border: 1px solid var(--border, #d9ded2); border-radius: 8px; }
.vmp-canvas {
  position: relative;
  background:
    linear-gradient(45deg, var(--bg-card, #fff) 25%, transparent 25%, transparent 75%, var(--bg-card, #fff) 75%),
    linear-gradient(45deg, var(--bg-card, #fff) 25%, var(--bg-card2, #eef1eb) 25%, var(--bg-card2, #eef1eb) 75%, var(--bg-card, #fff) 75%);
  background-size: 24px 24px;
  background-position: 0 0, 12px 12px;
  border: 1px solid var(--border, #d9ded2);
  border-radius: 6px;
  /* 契约 §5：长炮管允许合理超出统一 viewBox（overflow 仅为视觉显示，
     不影响后续 production marker 的 collision bounds / hitbox contract） */
  overflow: visible;
}
.vmp-hull, .vmp-turret {
  position: absolute;
  /* img 与 320×320 viewBox 1:1 对齐：局部坐标 == viewBox 坐标，
     transform-origin 可直接用 pivot 的 viewBox 像素值 */
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  max-width: none;
  will-change: transform;
}
.vmp-hull { z-index: 1; }
/* turret assembly 父层：随 hull 绕画布中心旋转（座圈随车体移动，见 pivot.js） */
.vmp-turret-assembly { z-index: 2; }
.vmp-turret { z-index: 1; }
/* 状态叠加：与生产 BattlePlayback 当前视觉语言一致（PR3 重设计后再同步） */
.vmp-destroyed .vmp-hull, .vmp-destroyed .vmp-turret { opacity: 0.35; filter: grayscale(1); }
.vmp-last-known .vmp-hull, .vmp-last-known .vmp-turret { opacity: 0.3; }
/* selected 指示器（PR #92 Review B）：红色倒三角，车辆正上方——
   位置在画布顶（overflow:visible 不裁剪）、z-index 最高（不被 hull/turret/其他 overlay
   遮挡）、深色描边阴影保证浅/深背景都可见；border-top 颜色由 inline borderTopColor 提供
   （可测试），此块负责形状/位置/阴影。 */
.vmp-selected {
  position: absolute;
  left: 50%;
  top: -14px;
  width: 0;
  height: 0;
  border-left: 9px solid transparent;
  border-right: 9px solid transparent;
  border-top: 14px solid transparent;
  transform: translateX(-50%);
  pointer-events: none;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.7));
}
.vmp-recorder {
  position: absolute; inset: -4px;
  border: 2px solid #ffd76a; border-radius: 50%;
  z-index: 3; pointer-events: none;
  filter: drop-shadow(0 0 3px #ffd76a);
}
.vmp-death {
  position: absolute; left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  z-index: 4; pointer-events: none;
  font-size: 26px; font-weight: 700; color: #f2f2f0;
  text-shadow: 0 0 2px rgba(0, 0, 0, 0.85), 0 0 6px rgba(0, 0, 0, 0.5);
  line-height: 1;
}
.vmp-pivot {
  position: absolute;
  width: 12px; height: 12px;
  transform: translate(-50%, -50%);
  z-index: 5; pointer-events: none;
  border: 1.5px solid #e5484d;
  border-radius: 50%;
}
.vmp-pivot::before, .vmp-pivot::after {
  content: '';
  position: absolute; left: 50%; top: 50%;
  background: #e5484d;
}
.vmp-pivot::before { width: 2px; height: 18px; transform: translate(-50%, -50%); }
.vmp-pivot::after { width: 18px; height: 2px; transform: translate(-50%, -50%); }
/* PR92 Review B1：炮塔视觉质心参照（青色圆点）——炮管占图像上部使质心偏前，
   与红色座圈红圈对照，确认"偏后"感知来自炮管效应而非 pivot 数值偏差 */
.vmp-centroid {
  position: absolute;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: rgba(64, 192, 255, 0.85);
  box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.55);
  transform: translate(-50%, -50%);
  z-index: 5; pointer-events: none;
}
.vmp-name {
  position: absolute;
  bottom: calc(100% + 2px); left: 50%;
  transform: translateX(-50%);
  font-size: 11px; line-height: 1.2;
  color: #fff; background: rgba(0, 0, 0, 0.55);
  padding: 1px 4px; border-radius: 3px;
  white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis;
  z-index: 5; pointer-events: none;
}
.vmp-pending {
  position: absolute; left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  z-index: 5; pointer-events: none;
  font-size: 13px; color: var(--text-sub, #72796f);
  background: var(--bg-card, #fff); border: 1px dashed var(--border, #d9ded2);
  padding: 6px 10px; border-radius: 4px;
}
.vmp-info { margin-top: 14px; font-size: 13px; line-height: 1.7; word-break: break-all; }
.vmp-info p { margin: 4px 0; }
.vmp-proto {
  margin-top: 18px; padding: 12px 14px;
  border: 1px solid var(--border, #d8ddd5); border-radius: 8px;
  background: var(--bg-card, #fff);
}
.vmp-proto h3 { margin: 0 0 8px; font-size: 14px; }
.vmp-proto-sizes { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; font-size: 13px; }
.vmp-proto-btn {
  border: 1px solid var(--border, #d8ddd5); background: transparent;
  border-radius: 4px; padding: 2px 8px; font-size: 12px; cursor: pointer;
}
.vmp-proto-btn.vmp-proto-active { background: #2f6f4f; color: #fff; border-color: #2f6f4f; }
.vmp-proto-row { display: flex; gap: 14px; flex-wrap: wrap; align-items: flex-start; }
.vmp-proto-cell { text-align: center; }
.vmp-proto-label { font-size: 12px; color: var(--text-sub, #72796f); margin: 0 0 4px; }
.vmp-proto-none { font-size: 11px; color: var(--text-sub, #72796f); margin: 40px 0; }
.vmp-proto-img { image-rendering: auto; }
.vmp-proto-report { margin: 10px 0 0; font-size: 12px; color: var(--text-sub, #72796f); }
</style>
