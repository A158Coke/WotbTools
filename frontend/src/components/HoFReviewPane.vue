<script setup lang="ts">
// 百场 / 三环审核详情（design-language §7 / current-plan Step 11「审核模板」）：
// 证据 + 「用户申报 / 管理员确认」对照 + Replay 校验清单，底部固定决定栏。纯展示组件，状态与请求都在 HoFAdminPage。
// 大屏内联在队列右侧；小屏经 Teleport 成为一屏全屏详情，顶部上一条 / 下一条，底部是拇指区决定栏。
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Check, ChevronLeft, ChevronRight, Download, X } from 'lucide-vue-next'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'

type Prefix = 'hundredAdmin' | 'mark3Admin'
interface Row { label: string; value: string; strong?: boolean }
interface Compare { label: string; claimed: string; confirmed: string }
interface Replay { id: string | number; slot: string | number; name: string; sizeLabel: string; raw: unknown }
interface Validation { ok: boolean; label: string }

const props = defineProps<{
  prefix: Prefix
  title: string
  status: string
  statusLabel: string
  loading: boolean
  phase: string
  busy: boolean
  message: string
  compare: Compare[]
  meta: Row[]
  screenshots: string[]
  replays: Replay[]
  evidenceLoading: boolean
  evidenceError: string
  evidenceComplete: boolean
  checks: Validation[]
  position: number
  total: number
  compact: boolean
  rejectReasons: Record<string, string>
  deleteReasons: Record<string, string>
}>()
const rejectReason = defineModel<string>('rejectReason', { default: '' })
const rejectText = defineModel<string>('rejectText', { default: '' })
const deleteReason = defineModel<string>('deleteReason', { default: '' })
const deleteText = defineModel<string>('deleteText', { default: '' })
const emit = defineEmits<{
  close: []; prev: []; next: []
  askReject: []; askApprove: []; askDelete: []; cancel: []
  confirmApprove: []; confirmReject: []; confirmDelete: []
  downloadScreenshot: [index: number]; zoom: [index: number]; downloadReplay: [raw: unknown]
}>()

const inline = inject(DIALOG_INLINE_KEY, false)
const pending = computed(() => props.status === 'PENDING')
const confirmedHeader = computed(() => pending.value ? 'hofAdmin.reviewAfterApprove' : 'hofAdmin.reviewConfirmed')

/*
 * 窄屏覆盖层是模态的：传送到 body 后，打开时把焦点移进来，Tab 在层内循环，背后的 #app 设为 inert
 * （键盘与读屏都操作不到看不见的队列）；关闭后焦点回到打开前的元素（队列里那一条）。
 */
const root = ref<HTMLElement | null>(null)
const back = ref<HTMLButtonElement | null>(null)
let returnFocus: HTMLElement | null = null
let inertTarget: HTMLElement | null = null
const modal = computed(() => props.compact && !inline)
function release() {
  if (inertTarget) { inertTarget.inert = false; inertTarget = null }
  if (returnFocus?.isConnected) returnFocus.focus()
  returnFocus = null
}
watch(modal, async (on) => {
  if (!on) { release(); return }
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  inertTarget = document.getElementById('app')
  if (inertTarget && !inertTarget.contains(root.value)) inertTarget.inert = true
  else inertTarget = null
  await nextTick()
  ;(back.value ?? root.value)?.focus()
}, { immediate: true, flush: 'post' })
onBeforeUnmount(release)

function trapTab(event: KeyboardEvent) {
  if (!modal.value || !root.value) return
  const focusable = [...root.value.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
  if (!focusable.length) return
  const first = focusable[0], last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
</script>

<template>
  <Teleport to="body" :disabled="!compact || inline">
    <section
      ref="root"
      class="hof-review-pane"
      :class="{ 'is-overlay': compact }"
      :role="modal ? 'dialog' : undefined"
      :aria-modal="modal ? 'true' : undefined"
      :aria-label="$t('hofAdmin.reviewDetail')"
      :tabindex="modal ? -1 : undefined"
      data-testid="hof-review-pane"
      @keydown.esc="emit('close')"
      @keydown.tab="trapTab"
    >
      <header class="hof-review-top">
        <button ref="back" type="button" class="btn-sm hof-review-back" data-testid="hof-review-back" :disabled="busy" @click="emit('close')"><ChevronLeft :size="16" aria-hidden="true" />{{ $t('hofAdmin.reviewBack') }}</button>
        <span v-if="position" class="hof-review-position" role="status">{{ $t('hofAdmin.reviewPosition', { position, total }) }}</span>
        <span class="hof-review-step">
          <button type="button" class="btn-sm btn-icon" :disabled="busy || position <= 1" :aria-label="$t('hofAdmin.reviewPrev')" data-testid="hof-review-prev" @click="emit('prev')"><ChevronLeft :size="16" aria-hidden="true" /></button>
          <button type="button" class="btn-sm btn-icon" :disabled="busy || position >= total" :aria-label="$t('hofAdmin.reviewNext')" data-testid="hof-review-next" @click="emit('next')"><ChevronRight :size="16" aria-hidden="true" /></button>
        </span>
      </header>

      <div class="hof-review-body">
        <p v-if="loading" class="muted">{{ $t(prefix + '.loading') }}</p>
        <template v-else-if="title">
          <div class="hof-review-evidence">
            <h2>{{ $t(prefix + '.evidence') }}</h2>
            <template v-if="pending">
              <div class="mark3-admin-screenshots">
                <div v-for="(src, index) in screenshots" :key="index" class="hundred-proof-row">
                  <img class="hundred-proof" :src="src" :alt="$t(prefix + '.screenshot', { number: index + 1 })" @click="emit('zoom', index)" />
                  <button type="button" class="btn-sm" @click="emit('downloadScreenshot', index)">{{ $t(prefix + '.downloadScreenshot') }}</button>
                </div>
              </div>
              <span v-if="!screenshots.length" class="hundred-proof-empty">—</span>
              <p v-if="evidenceLoading" class="muted">{{ $t(prefix + '.loading') }}</p>
              <p v-else-if="evidenceError" class="error">{{ evidenceError }}</p>
              <template v-else>
                <p v-if="!replays.length" class="hundred-legacy-warn">{{ $t(prefix + '.legacyNoReplays') }}</p>
                <template v-else>
                  <p v-if="replays.length !== 5" class="hundred-legacy-warn">{{ $t(prefix + '.evidenceIncomplete') }}</p>
                  <ul class="replay-evidence-list">
                    <li v-for="ev in replays" :key="ev.id" class="replay-evidence-item">
                      <span class="replay-slot">#{{ ev.slot }}</span>
                      <span class="replay-name" :title="ev.name">{{ ev.name }}</span>
                      <span class="replay-size">{{ ev.sizeLabel }}</span>
                      <button type="button" class="btn-sm btn-icon" :title="$t(prefix + '.replayDownload')" :aria-label="$t(prefix + '.replayDownload')" @click="emit('downloadReplay', ev.raw)"><Download :size="16" aria-hidden="true" /></button>
                    </li>
                  </ul>
                </template>
              </template>
            </template>
            <p v-else class="muted">{{ $t('hofAdmin.reviewNoEvidence') }}</p>
          </div>

          <div class="hof-review-facts">
            <div>
              <h2>{{ title }} <span class="hundred-status" :class="'hundred-status-' + status.toLowerCase()">{{ statusLabel }}</span></h2>
              <dl class="hof-review-compare">
                <dt></dt><dd class="hof-review-col">{{ $t('hofAdmin.reviewClaimed') }}</dd><dd class="hof-review-col">{{ $t(confirmedHeader) }}</dd>
                <template v-for="row in compare" :key="row.label">
                  <dt>{{ row.label }}</dt><dd>{{ row.claimed }}</dd><dd class="is-confirmed">{{ row.confirmed }}</dd>
                </template>
              </dl>
            </div>
            <div>
              <h3 class="hundred-review-label">{{ $t(prefix + '.replayValidation') }}</h3>
              <ul class="val-list">
                <li v-for="check in checks" :key="check.label" :class="check.ok ? 'val-ok' : 'val-bad'">
                  <component :is="check.ok ? Check : X" class="val-mark" :size="16" role="img" :aria-label="check.ok ? $t('hofAdmin.valPass') : $t('hofAdmin.valFail')" />{{ check.label }}
                </li>
              </ul>
            </div>
            <dl class="hof-review-meta">
              <template v-for="row in meta" :key="row.label"><dt>{{ row.label }}</dt><dd :class="{ dmg: row.strong }">{{ row.value }}</dd></template>
            </dl>
          </div>
        </template>
      </div>

      <footer v-if="title && !loading" class="hof-review-decision" role="group" :aria-label="$t('hofAdmin.reviewActions')" data-testid="hof-review-decision">
        <p v-if="message" class="error">{{ message }}</p>

        <div v-if="pending && phase === 'view'" class="modal-actions">
          <span class="hof-review-note">{{ $t('hofAdmin.reviewApproveNote') }}</span>
          <select v-model="rejectReason" :aria-label="$t(prefix + '.rejectReason')">
            <option value="">{{ $t(prefix + '.rejectReasonRequired') }}</option>
            <option v-for="(label, key) in rejectReasons" :key="key" :value="key">{{ label }}</option>
          </select>
          <button type="button" class="btn-sm danger" :disabled="busy" @click="emit('askReject')">{{ $t(prefix + '.reject') }}</button>
          <button type="button" class="btn-sm ok" :disabled="busy || !evidenceComplete" :title="evidenceComplete ? '' : $t(prefix + '.approveDisabledHint')" @click="emit('askApprove')">{{ $t(prefix + '.approve') }}</button>
        </div>

        <div v-else-if="pending && phase === 'approve-confirm'" class="hundred-action-area">
          <p class="hundred-confirm">{{ $t(prefix + '.approveConfirm') }}</p>
          <div class="modal-actions">
            <button type="button" class="btn-sm" :disabled="busy" @click="emit('cancel')">{{ $t(prefix + '.cancel') }}</button>
            <button type="button" class="btn-sm ok" :disabled="busy" @click="emit('confirmApprove')">{{ busy ? $t(prefix + '.approving') : $t(prefix + '.approve') }}</button>
          </div>
        </div>

        <div v-else-if="pending && phase === 'reject-form'" class="hundred-action-area">
          <label class="hundred-reason-label">{{ $t(prefix + '.rejectReason') }}</label>
          <select v-model="rejectReason">
            <option value="">{{ $t(prefix + '.rejectReasonRequired') }}</option>
            <option v-for="(label, key) in rejectReasons" :key="key" :value="key">{{ label }}</option>
          </select>
          <textarea v-model="rejectText" rows="2" maxlength="500" :placeholder="$t(prefix + '.rejectReasonPlaceholder')"></textarea>
          <p class="hundred-confirm">{{ $t(prefix + '.rejectConfirm') }}</p>
          <div class="modal-actions">
            <button type="button" class="btn-sm" :disabled="busy" @click="emit('cancel')">{{ $t(prefix + '.cancel') }}</button>
            <button type="button" class="btn-sm danger" :disabled="busy" @click="emit('confirmReject')">{{ busy ? $t(prefix + '.rejecting') : $t(prefix + '.reject') }}</button>
          </div>
        </div>

        <div v-else-if="status === 'CURRENT' && phase === 'view'" class="modal-actions">
          <button type="button" class="btn-sm danger" :disabled="busy" @click="emit('askDelete')">{{ $t(prefix + '.delete') }}</button>
        </div>

        <div v-else-if="status === 'CURRENT' && phase === 'delete-form'" class="hundred-action-area">
          <label class="hundred-reason-label">{{ $t(prefix + '.deleteReason') }}</label>
          <select v-model="deleteReason">
            <option value="">{{ $t(prefix + '.deleteReasonRequired') }}</option>
            <option v-for="(label, key) in deleteReasons" :key="key" :value="key">{{ label }}</option>
          </select>
          <textarea v-model="deleteText" rows="2" maxlength="500" :placeholder="$t(prefix + '.deleteReasonPlaceholder')"></textarea>
          <p class="hundred-confirm">{{ $t(prefix + '.deleteConfirm') }}</p>
          <div class="modal-actions">
            <button type="button" class="btn-sm" :disabled="busy" @click="emit('cancel')">{{ $t(prefix + '.cancel') }}</button>
            <button type="button" class="btn-sm danger" :disabled="busy" @click="emit('confirmDelete')">{{ busy ? $t(prefix + '.deleting') : $t(prefix + '.delete') }}</button>
          </div>
        </div>
      </footer>
    </section>
  </Teleport>
</template>

<style scoped>
.hof-review-pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-lg); background: var(--color-surface-1); color: var(--color-text-primary); font: var(--type-body); }
.hof-review-pane.is-overlay { position: fixed; inset: 0; z-index: var(--z-dialog); border: 0; border-radius: 0; background: var(--color-canvas); }
.hof-review-top { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--color-border-subtle); }
.hof-review-back { display: none; }
.is-overlay .hof-review-back { display: inline-flex; }
.hof-review-position { flex: 1; color: var(--color-text-secondary); font: var(--type-caption); }
.hof-review-step { display: inline-flex; gap: var(--space-1); margin-inline-start: auto; }
.hof-review-body { display: grid; flex: 1; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: var(--space-5); align-content: start; padding: var(--space-5); overflow-y: auto; }
.hof-review-body > .muted { grid-column: 1 / -1; }
.hof-review-evidence, .hof-review-facts { display: grid; gap: var(--space-3); align-content: start; min-width: 0; }
.hof-review-pane h2 { margin: 0; font: var(--type-h3); overflow-wrap: anywhere; }
.hof-review-compare { display: grid; grid-template-columns: 1fr auto auto; gap: var(--space-2) var(--space-4); margin: var(--space-2) 0 0; padding: var(--space-3); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--color-surface-2); }
.hof-review-compare dt { color: var(--color-text-secondary); }
.hof-review-compare dd { margin: 0; text-align: end; font-weight: 700; font-variant-numeric: tabular-nums; }
.hof-review-compare .hof-review-col { color: var(--color-text-secondary); font: var(--type-caption); }
.hof-review-compare .is-confirmed { color: var(--color-accent-text); }
.hof-review-meta { display: grid; grid-template-columns: minmax(0, auto) minmax(0, 1fr); gap: var(--space-1) var(--space-3); margin: 0; color: var(--color-text-secondary); }
.hof-review-meta dd { margin: 0; color: var(--color-text-primary); overflow-wrap: anywhere; }
.hof-review-meta .dmg { color: var(--color-accent-text); font-weight: 600; }
.hof-review-decision { position: sticky; bottom: 0; padding: var(--space-3) var(--space-4) calc(var(--space-3) + env(safe-area-inset-bottom)); border-top: 1px solid var(--color-border-subtle); background: var(--color-surface-2); }
.modal-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--space-2); }
.hof-review-note { flex: 1 1 var(--form-field-min); color: var(--color-text-secondary); }
.hundred-reason-label, .hundred-review-label { display: block; margin: 0 0 var(--space-1); color: var(--color-text-secondary); font: var(--type-caption); font-weight: 600; }
.hundred-confirm, .hundred-legacy-warn { margin: var(--space-2) 0; color: var(--color-warning); }
.hundred-proof { display: block; max-width: 100%; max-height: 320px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); cursor: zoom-in; }
.hundred-proof-empty, .muted { color: var(--color-text-tertiary); }
.hundred-proof-row { display: flex; align-items: flex-start; gap: var(--space-3); }
.hundred-proof-row .btn-sm { flex: none; white-space: nowrap; }
.mark3-admin-screenshots { display: grid; gap: var(--space-3); }
.replay-evidence-list, .val-list { margin: 0; padding: 0; list-style: none; }
.replay-evidence-item { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-1) 0; }
.replay-slot { min-width: 2.2em; color: var(--color-text-secondary); font-weight: 600; }
.replay-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.replay-size { color: var(--color-text-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; }
.val-list li { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) 0; }
.val-mark { flex: none; }
.val-ok { color: var(--color-success); }
.val-bad { color: var(--color-danger); }
.hundred-status { display: inline-block; padding: 0 var(--space-2); border-radius: var(--radius-sm); background: var(--color-surface-3); color: var(--color-text-secondary); font: var(--type-caption); font-weight: 600; vertical-align: middle; }
.hundred-status-current { background: color-mix(in oklab, var(--color-success) 14%, var(--color-surface-1)); color: var(--color-success); }
.hundred-status-pending { background: color-mix(in oklab, var(--color-warning) 14%, var(--color-surface-1)); color: var(--color-warning); }
.hundred-status-rejected, .hundred-status-deleted { background: color-mix(in oklab, var(--color-danger) 14%, var(--color-surface-1)); color: var(--color-danger); }
.error { display: inline-block; margin: 0 0 var(--space-2); padding: var(--space-2) var(--space-3); border: 1px solid color-mix(in oklab, var(--color-danger) 45%, var(--color-border-subtle)); border-radius: var(--radius-md); background: color-mix(in oklab, var(--color-danger) 14%, var(--color-surface-1)); color: var(--color-danger); }
.btn-sm { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-1); min-height: var(--control-h-sm); padding: 0 var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface-1); color: var(--color-text-primary); font: var(--type-body); cursor: pointer; }
.btn-icon { min-width: var(--control-h-sm); padding: 0; }
.btn-sm.danger { border-color: var(--color-danger); color: var(--color-danger); }
.btn-sm.ok { border-color: var(--color-success); color: var(--color-success); }
.btn-sm:disabled { opacity: .5; cursor: not-allowed; }
.btn-sm:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.hof-review-pane select, .hof-review-pane textarea { box-sizing: border-box; min-width: 0; min-height: var(--control-h-md); padding: var(--space-1) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface-1); color: var(--color-text-primary); font: var(--type-body); }
.hundred-action-area select, .hundred-action-area textarea { display: block; width: 100%; margin: var(--space-1) 0 var(--space-2); }
.hundred-action-area textarea { min-height: auto; padding-block: var(--space-2); }
@media (hover: hover) { .btn-sm:hover:not(:disabled) { background: var(--color-surface-2); } }
@media (width < 1200px) { .hof-review-body { grid-template-columns: minmax(0, 1fr); } }
@media (width < 768px) {
  .hof-review-body { padding: var(--space-4); }
  .hof-review-decision .modal-actions { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .hof-review-note, .hof-review-decision select { grid-column: 1 / -1; }
  .hof-review-decision .btn-sm { min-height: var(--control-h-lg); }
}
</style>