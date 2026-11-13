<script setup>
// 名人堂页面外壳：连接横幅 / Tab / URL query 同步 / 手机筛选 sheet 的开合与焦点归还。
// 三个榜单的业务状态各归其组件（HofSingleBoard / HofHundredBoard / HofMark3Board）；本组件是 URL query 的唯一 owner，
// 通过 board 暴露的 queryState() 读取、applyQuery() / activate() / reload() 下发一次性命令，不缓存任何榜单状态。
import { nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { parseHofQuery, sameHofQuery, serializeHofQuery } from '../utils/hofQuery.js'
import { useHofAccess } from './hofBoardShared.js'
import Banner from './Banner.vue'
import HofSingleBoard from './HofSingleBoard.vue'
import HofHundredBoard from './HofHundredBoard.vue'
import HofMark3Board from './HofMark3Board.vue'

const { hofAvailability, requireHofOnline } = useHofAccess()

const activeTab = ref('single')
const singleBoard = ref(null)
const hundredBoard = ref(null)
const mark3Board = ref(null)
const boards = { single: singleBoard, hundred: hundredBoard, mark3: mark3Board }
const activeBoard = () => boards[activeTab.value].value

// ── URL 状态（审计 PG-08）：Tab / 筛选 / 页码写进 query；前进 / 后退 / 刷新 / 分享都能恢复 ──
// 页面可能被 KeepAlive 保留，只在 view=hof 时读写，离开后不改别的页面的 URL。
const route = useRoute()
const router = useRouter()
const onHofView = () => route?.query?.view === 'hof'
const currentHofQuery = () => ({ view: 'hof', ...serializeHofQuery(activeBoard().queryState()) })

/** 最近一次自己写入的 query：路由监听遇到它就跳过（它反映的是当时的状态，不是外部导航） */
let lastWrittenQuery = null
/** board 每次加载时 emit('query-change')；写入的始终是当前 Tab 的状态。 */
function writeHofQuery() {
  if (!router || !onHofView()) return
  const next = currentHofQuery()
  if (sameHofQuery(route.query, next)) return
  lastWrittenQuery = next
  router.replace({ query: next })
}

/** 把 URL 状态应用到对应榜单并加载（首次进入 / 前进后退）。 */
function applyHofQuery(query) {
  const q = parseHofQuery(query)
  activeTab.value = q.tab
  boards[q.tab].value.applyQuery(q)
}

if (route) {
  watch(() => route.query, (query) => {
    if (query?.view !== 'hof' || sameHofQuery(query, currentHofQuery())) return
    if (lastWrittenQuery && sameHofQuery(query, lastWrittenQuery)) return
    applyHofQuery(query)
  })
}

// ── 手机筛选（审计 PG-05 / design-language §9）：筛选收进底部 sheet；同一时间最多一个 Tab 的 sheet 打开 ──
const boardTop = ref(null)
const filterSheet = ref(null) // null | 'single' | 'hundred' | 'mark3'
let filterSheetOpener = null
function toggleFilterSheet(tab) {
  if (filterSheet.value === tab) return closeFilterSheet()
  filterSheetOpener = document.activeElement
  filterSheet.value = tab
  nextTick(() => document.querySelector('.lb-toolbar-host.is-sheet select, .lb-toolbar-host.is-sheet input')?.focus())
}
function closeFilterSheet() {
  filterSheet.value = null
  const opener = filterSheetOpener
  filterSheetOpener = null
  nextTick(() => opener?.focus?.())
}

function switchTab(tab) {
  activeTab.value = tab
  filterSheet.value = null
  writeHofQuery()
  boards[tab].value.activate()
}

onMounted(() => {
  if (!hofAvailability.value.available) requireHofOnline()
  if (route && onHofView()) applyHofQuery(route.query)
  else singleBoard.value.reload()
  singleBoard.value.loadVehicleOptions()
})

// Only availability recovery resumes the visible board; business errors remain explicit retries.
// 失联时各 board 自行作废在途请求（useHofEpoch）；恢复时由这里按当前 URL / Tab 重新加载。
watch(() => hofAvailability.value.available, (available, previous) => {
  if (!available || previous !== false || (route && !onHofView())) return
  if (route && onHofView()) applyHofQuery(route.query)
  else activeBoard().reload()
  singleBoard.value.loadVehicleOptions()
})
</script>

<template>
  <div ref="boardTop" class="lb-wrap" data-tour="hof-workspace">
    <Banner v-if="!hofAvailability.pending && !hofAvailability.available" tone="info" data-testid="hof-connectivity">
      <p>{{ $t(hofAvailability.messageKey) }}</p>
    </Banner>
    <div class="tabs" data-tour="hof-tabs">
      <button type="button" :class="{ active: activeTab === 'single' }" @click="switchTab('single')">{{ $t('hof.singleTab') }}</button>
      <button type="button" :class="{ active: activeTab === 'hundred' }" @click="switchTab('hundred')">{{ $t('hundred.tab') }}</button>
      <button type="button" :class="{ active: activeTab === 'mark3' }" @click="switchTab('mark3')">{{ $t('mark3.tab') }}</button>
    </div>

    <HofSingleBoard v-show="activeTab === 'single'" ref="singleBoard" :active="activeTab === 'single'"
                    :filter-open="filterSheet === 'single'" :sheet-target="boardTop"
                    @query-change="writeHofQuery" @toggle-filters="toggleFilterSheet('single')" @close-filters="closeFilterSheet" />
    <HofHundredBoard v-show="activeTab === 'hundred'" ref="hundredBoard" :active="activeTab === 'hundred'"
                     :filter-open="filterSheet === 'hundred'" :sheet-target="boardTop"
                     @query-change="writeHofQuery" @toggle-filters="toggleFilterSheet('hundred')" @close-filters="closeFilterSheet" />
    <HofMark3Board v-show="activeTab === 'mark3'" ref="mark3Board" :active="activeTab === 'mark3'"
                   :filter-open="filterSheet === 'mark3'" :sheet-target="boardTop"
                   @query-change="writeHofQuery" @toggle-filters="toggleFilterSheet('mark3')" @close-filters="closeFilterSheet" />
  </div>
</template>

<style scoped>
.lb-wrap { max-width: var(--wide-max, 1600px); margin: 0 auto; padding: 24px 20px 56px; }

@media (width < 768px) {
  .lb-wrap { padding: 14px 12px 48px; }
}
</style>

<style>
/* 非 scoped：规则作用在 Hof* 子组件内部 DOM（含 Teleport 出去的对话框），统一挂 HoF 专属祖先前缀，
 * specificity 与原 scoped 版逐条相同（:is() 取一个 class）。迁移到设计语言 token 前保留在本文件（stylelint legacy）。 */
/* 手机筛选 sheet（审计 PG-05）：容器 / 遮罩 / 焦点 / 安全区由 AppSheet 提供，这里只负责工具栏在 sheet 内的网格 */
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-toolbar-host.is-sheet { display: grid; gap: var(--space-3); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-toolbar-host.is-sheet .lb-toolbar :is(select, input, button) { min-height: var(--hit-min); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-sheet-head { display: flex; align-items: center; justify-content: space-between; color: var(--color-text-primary); font: var(--type-h3); }
/* 手机卡片列表（审计 PG-05 / PG-19：下载按钮与车辆链接满足 44px 点击区域） */
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-cards { display: grid; gap: var(--space-2); margin: var(--space-3) 0 0; padding: 0; list-style: none; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
}
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-card-main { display: grid; gap: var(--space-0); min-width: 0; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-card-name { overflow: hidden; font: var(--type-body); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-card-tank {
  justify-self: start;
  min-height: var(--control-h-sm);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-accent-text);
  font: var(--type-body);
  text-align: start;
}
:is(.lb-wrap, .hof-upload-modal, .h100-modal) button.lb-card-tank { cursor: pointer; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) span.lb-card-tank { min-height: 0; color: var(--color-text-secondary); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-card-meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); color: var(--color-text-secondary); font: var(--type-caption); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-card-value { display: grid; justify-items: end; font: var(--type-h3); font-variant-numeric: tabular-nums; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-card-value small { color: var(--color-text-secondary); font: var(--type-caption); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-card-download {
  display: inline-grid;
  place-items: center;
  min-width: var(--hit-min);
  min-height: var(--hit-min);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  color: var(--color-text-primary);
  cursor: pointer;
}
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-card-download:disabled { cursor: progress; opacity: .5; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-card-tank:focus-visible,
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-card-download:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
/* 审计 BZ-18：提交弹窗里的上榜规则与当前门槛 */
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .hof-rules {
  margin: var(--space-3) 0;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
  font: var(--type-body);
}
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .hof-rules-title { margin: 0 0 var(--space-1); color: var(--color-text-primary); font: var(--type-h3); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .hof-rules ul { display: grid; gap: var(--space-1); margin: 0; padding-inline-start: var(--space-5); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .hof-threshold { display: grid; gap: var(--space-0); margin: var(--space-2) 0 0; color: var(--color-text-secondary); font: var(--type-body); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .hof-threshold strong { color: var(--color-text-primary); font: var(--type-caption); font-weight: 600; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .hof-threshold.is-blocked { color: var(--color-warning); }
/* 审计 BZ-15：空榜说明怎样上榜 */
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-empty { display: grid; gap: var(--space-2); margin-top: var(--space-3); padding: var(--space-6) var(--space-4); border: 1px dashed var(--color-border-strong); border-radius: var(--radius-lg); text-align: center; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-empty-title { margin: 0; color: var(--color-text-primary); font: var(--type-h3); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-empty-how { margin: 0; color: var(--color-text-secondary); font: var(--type-body); }
/* 审计 PG-07：翻页 / 改筛选时保留旧数据并变暗，不整表替换成一行文字导致跳动 */
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .tablewrap.is-stale,
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-cards.is-stale { opacity: .55; transition: opacity var(--duration-base) var(--ease-standard); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-toolbar { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px 14px;
  align-items: end; margin: 16px 0 12px; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-limit { font-size: 13px; color: var(--text-label); display: grid; gap: 4px; min-width: 0; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-limit .lb-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-limit select { border: 1px solid var(--border-ghost);
  background: var(--bg-card2); color: var(--text-label); padding: 5px 10px; border-radius: 7px;
  font-size: 13px; cursor: pointer; font-family: inherit; width: 100%; min-width: 0; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-nick-input { border: 1px solid var(--border-ghost); background: var(--bg-card2); color: var(--text-label);
  padding: 5px 10px; border-radius: 7px; font-size: 13px; font-family: inherit; width: 100%; min-width: 0; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-nick-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; min-width: 0; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-dmg { font-weight: 800; color: var(--accent-dark); font-variant-numeric: tabular-nums; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-replay { white-space: nowrap; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .bt-badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 12px; font-weight: 600; white-space: nowrap; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .bt-random { background: var(--rating-good-bg); color: var(--rating-good-fg); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .bt-rating { background: var(--rating-great-bg); color: var(--rating-great-fg); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-download {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 26px; padding: 0;
  border: 1px solid var(--border-ghost); border-radius: 7px;
  background: var(--bg-card2); color: var(--text-label);
  font-family: inherit; cursor: pointer;
}
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-download .ic { width: 15px; height: 15px; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-download:hover:not(:disabled) { background: var(--bg-card-hover); color: var(--accent); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-download:disabled { opacity: .55; cursor: not-allowed; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-no-replay { color: var(--text-muted); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-time { color: var(--text-muted); font-size: .9em; white-space: nowrap; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-version { color: var(--text-muted); font-size: .85em; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-tank-link {
  background: none; border: none; padding: 0; color: var(--accent); font-family: inherit;
  font-size: inherit; cursor: pointer; text-decoration: none;
}
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-tank-link:hover { text-decoration: underline; color: var(--accent-hover); background: var(--accent-shadow); border-radius: 3px; transition: all .12s; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-filter-hint { margin: 8px 0 10px; font-size: 13px; color: var(--text-label); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-filter-hint strong { color: var(--accent-dark); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .rk { display: inline-block; min-width: 26px; padding: 1px 8px; border-radius: 6px; font-size: 12px;
  font-weight: 600; background: var(--bg-chip); color: var(--text-label); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .rk-gold { background: var(--rating-good-bg); color: var(--rating-good-fg); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .rk-silver { background: var(--bg-chip); color: var(--text-label); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .rk-bronze { background: var(--rating-great-bg); color: var(--rating-great-fg); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .muted { padding: 28px 4px; color: var(--text-muted); }

:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-submit-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-hero-stat-label { color: var(--color-text-secondary); font: var(--type-caption); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-submit-row .lb-upload-msg { margin: 0; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-upload-msg.err { color: var(--color-danger); }
.hof-upload-modal .lb-upload-section .lb-upload-card { padding: 26px 18px; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-upload-section { margin: 16px 0; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-upload-card {
  position: relative;
  overflow: hidden;
  border: 1.5px dashed var(--border-dashed);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 9%, transparent), transparent 48%),
    var(--bg-upload);
  border-radius: 8px;
  padding: 30px 20px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  transition: border-color .12s, background .12s, box-shadow .12s, transform .12s;
}
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-upload-card::after {
  content: "";
  position: absolute;
  inset: auto 0 0;
  height: 3px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  opacity: .75;
}
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-upload-card.dragging { border-color: var(--accent); background: var(--bg-blue-light); box-shadow: 0 16px 36px var(--accent-shadow); transform: translateY(-1px); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-upload-card .up-title { max-width: 420px; margin-top: 10px; line-height: 1.25; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-upload-card .up-sub { max-width: 360px; margin-top: 8px; line-height: 1.5; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-upload-card .filebtn { margin-top: 18px; position: relative; z-index: 1; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-hidden-input { display: none; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-upload-card .filebtn.lb-uploading { opacity: .6; pointer-events: none; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-upload-msg { margin-top: 10px; font-size: 13px; text-align: center; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-upload-msg.err { color: var(--error); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .pagination { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 12px; padding: 16px 0; font-size: .85rem; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .pagination button { padding: 6px 14px; border: 1px solid var(--border-ghost); border-radius: 7px; background: var(--bg-card2); color: var(--text-label); cursor: pointer; font-family: inherit; font-size: .82rem; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .pagination button:disabled { opacity: .4; cursor: not-allowed; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .pagination button:hover:not(:disabled) { background: var(--bg-card-hover); }
/* 直接跳页：输入框与相邻按钮同高同字号，宽度按 3–5 位页码设计（含数字输入的步进箭头） */
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .page-jump { display: inline-flex; align-items: center; gap: 8px; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .page-jump input {
  width: 5.5rem;
  padding: 6px 10px;
  border: 1px solid var(--border-ghost);
  border-radius: 7px;
  background: var(--bg-card2);
  color: var(--text-label);
  font-family: inherit;
  font-size: .82rem;
  text-align: center;
}
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .page-jump input:focus-visible,
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .page-jump button:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

/* ── 百场 Tab ─────────────────────────────────── */
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-vehicle-filter, :is(.lb-wrap, .hof-upload-modal, .h100-modal) .mark3-vehicle-filter { flex-wrap: wrap; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .hof-vehicle-select, :is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-vehicle-select, :is(.lb-wrap, .hof-upload-modal, .h100-modal) .mark3-vehicle-select { min-width: 200px; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-submit-vehicle, :is(.lb-wrap, .hof-upload-modal, .h100-modal) .mark3-submit-vehicle { max-width: 360px; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-pending-card {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  margin: 12px 0; padding: 12px 14px;
  border: 1px solid var(--border); border-radius: 8px;
  background: var(--bg-card); box-shadow: var(--surface-shadow);
}
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-pending-body { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-pending-title { font-size: 13px; font-weight: 700; color: var(--accent-dark); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-pending-meta { display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; color: var(--text-label); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-pending-meta strong { color: var(--accent-dark); font-variant-numeric: tabular-nums; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-pending-time { color: var(--text-muted); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-pending-card .ghost { margin-left: auto; }

/* 提交弹窗 */
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-draft-hint {
  margin: 8px 0 12px; padding: 8px 10px;
  border: 1px solid var(--border-ghost); border-radius: 7px;
  background: var(--bg-card2); color: var(--text-muted);
  font-size: 12px; line-height: 1.5;
}
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-field { margin: 12px 0; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-field-label { display: block; font-size: 13px; color: var(--text-label); font-weight: 600; margin-bottom: 4px; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-field select, :is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-field input[type="number"] {
  border: 1px solid var(--border-ghost); background: var(--bg-card2); color: var(--text-label);
  padding: 6px 10px; border-radius: 7px; font-size: 13px; font-family: inherit; max-width: 100%;
}
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-field input[type="number"] { width: 170px; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-field small { display: block; color: var(--text-muted); font-size: 12px; margin-top: 3px; line-height: 1.5; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-field input[type="file"] { font-size: 12px; color: var(--text-label); margin-top: 2px; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-counter { font-size: 12px; font-weight: 700; color: var(--accent-dark); margin-left: 8px; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-file-reading { margin: 6px 0 0; color: var(--text-muted); font-size: 12px; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-selected-files { display: grid; gap: 5px; margin: 8px 0 0; padding: 0; list-style: none; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-selected-file {
  display: flex; align-items: center; gap: 8px; min-width: 0;
  margin-top: 6px; padding: 6px 8px;
  border: 1px solid var(--border-ghost); border-radius: 7px;
  background: var(--bg-card2); color: var(--text-label); font-size: 12px;
}
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-selected-files .h100-selected-file { margin-top: 0; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .mark3-proof-item { align-items: center; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .mark3-proof-preview {
  width: 48px; height: 36px; flex: 0 0 auto; object-fit: cover;
  border: 1px solid var(--border-ghost); border-radius: 5px; background: var(--bg-card);
}
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-file-index {
  display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
  width: 20px; height: 20px; border-radius: 50%; corner-shape: round;
  background: var(--bg-rating); color: var(--accent-dark); font-weight: 700;
}
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-selected-name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-remove-file {
  display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
  width: 24px; height: 24px; padding: 0;
  border: 1px solid var(--border-ghost); border-radius: 6px;
  background: transparent; color: var(--error); cursor: pointer; font: inherit;
}
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-remove-file:hover { background: color-mix(in srgb, var(--error) 10%, transparent); }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-clear-draft { margin-right: auto; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-err { color: var(--error); font-size: 13px; margin: 6px 0 0; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-need-profile { color: var(--error); font-size: 13px; margin: 8px 0 0; line-height: 1.6; }
:is(.lb-wrap, .hof-upload-modal, .h100-modal) .h100-need-profile a { color: var(--accent); font-weight: 600; }

@media (width < 768px) {
  :is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-upload-card { min-height: 230px; padding: 28px 16px; }
  :is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-upload-card .up-title { max-width: 260px; }
  :is(.lb-wrap, .hof-upload-modal, .h100-modal) .lb-upload-card .up-sub { max-width: 240px; }
}
</style>
