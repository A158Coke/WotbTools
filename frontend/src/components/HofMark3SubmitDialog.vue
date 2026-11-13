<script setup lang="ts">
// 三环人工提交弹窗：表单草稿 / 1–2 张证明截图 / 5 份回放 / 本地校验 / 提交的唯一 owner。弹窗 keep-mounted，关闭后草稿保留。
// 个人状态（current / pending）与候选车辆归 HofMark3Board，这里只读。
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { confirm } from '../composables/useConfirm.js'
import { apiErrorLabel } from '../utils/display.js'
import * as api from '../api/hall-of-fame.js'
import type { components } from '../api/generated/http-contract.js'
import { errorCode, findVehicleStatus, formatHofNumber, mergeReplayFiles, replayFileKey, takeInputFiles, tierXPickerOption, useHofAccess, withDraftVehicle, REPLAY_EVIDENCE_COUNT, type TierXVehicle } from './hofBoardShared.js'
import AppDialog from './AppDialog.vue'
import ImageDataUploader from './ImageDataUploader.vue'
import VehiclePicker from './VehiclePicker.vue'

type SubmissionSummary = components['schemas']['Mark3SubmissionSummary']
interface ProofScreenshot { key: string, data: string, name: string }
interface SubmissionValues { vehicleId: number, battleCount: number, averageDamage: number, winRate: number }

const props = defineProps<{
  /** 三环榜当前筛选后的候选车辆 */
  vehicles: readonly TierXVehicle[]
  currentList: readonly SubmissionSummary[]
  pendingList: readonly SubmissionSummary[]
  /** 提交成功（草稿已清空、弹窗已关闭）后由榜单刷新；提交中状态持续到它完成 */
  afterSubmit: () => Promise<void>
}>()

const { t, te } = useI18n()
const { requireLogin } = useHofAccess()

const show = ref(false)
const submitting = ref(false)
const submitError = ref('')
const needProfile = ref(false)
const screenshotErr = ref('')
const replayErr = ref('')
const screenshotUploader = ref<InstanceType<typeof ImageDataUploader> | null>(null)
const replaysInput = ref<HTMLInputElement | null>(null)
const screenshotsReading = ref(false)
const form = reactive({
  vehicleId: null as number | null,
  battleCount: '' as number | '',
  averageDamage: '' as number | '',
  winRate: '' as number | '',
  proofScreenshots: [] as ProofScreenshot[],
  replays: [] as File[],
})

const hasDraft = computed(() => Boolean(
  form.vehicleId
  || form.battleCount !== ''
  || form.averageDamage !== ''
  || form.winRate !== ''
  || form.proofScreenshots.length
  || form.replays.length
))

const pickerOptions = computed(() => withDraftVehicle(props.vehicles, form.vehicleId).map(vehicle => tierXPickerOption(t, te, vehicle)))

/** 三环没有分数门槛：已有通过纪录即不能再提交，没有纪录时说明这是第一条纪录（审计 BZ-18）。 */
const threshold = computed(() => {
  const vehicleId = form.vehicleId
  if (!vehicleId) return { key: 'hofRules.threshold.chooseVehicle' }
  const current = findVehicleStatus(props.currentList, vehicleId)
  if (current) {
    return {
      key: 'hofRules.threshold.mark3Current',
      blocked: true,
      params: { battles: formatHofNumber(current.approvedBattleCount ?? current.claimedBattleCount) },
    }
  }
  if (findVehicleStatus(props.pendingList, vehicleId)) return { key: 'hofRules.threshold.pending', blocked: true }
  return { key: 'hofRules.threshold.mark3First' }
})

function open(defaultVehicleId: number | null) {
  if (!requireLogin()) return
  show.value = true
  submitting.value = false
  needProfile.value = false
  submitError.value = ''
  screenshotErr.value = ''
  replayErr.value = ''
  if (!form.vehicleId && defaultVehicleId) form.vehicleId = defaultVehicleId
}

function close() {
  if (!submitting.value) show.value = false
}

function resetDraft() {
  screenshotUploader.value?.invalidatePendingRead()
  screenshotsReading.value = false
  form.vehicleId = null
  form.battleCount = ''
  form.averageDamage = ''
  form.winRate = ''
  form.proofScreenshots = []
  form.replays = []
  submitError.value = ''
  needProfile.value = false
  screenshotErr.value = ''
  replayErr.value = ''
  if (replaysInput.value) replaysInput.value.value = ''
}

async function clearDraft() {
  if (!hasDraft.value || submitting.value) return
  if (!(await confirm({ title: t('mark3.clearDraftConfirm'), confirmLabel: t('mark3.clearDraft'), danger: true }))) return
  resetDraft()
}

function onScreenshotsSelected(screenshots: ProofScreenshot[], duplicateCount: number) {
  form.proofScreenshots.push(...screenshots)
  screenshotErr.value = duplicateCount ? t('mark3.screenshotDuplicateIgnored') : ''
}

function onScreenshotUploadError(code: string) {
  const errorKey = ({
    'invalid-type': 'mark3.invalidImageType',
    'too-large': 'mark3.invalidImageSize',
    'too-many': 'mark3.screenshotLimit',
  } as Record<string, string | undefined>)[code] || 'mark3.imageReadError'
  screenshotErr.value = t(errorKey)
}

function removeScreenshot(index: number) {
  screenshotUploader.value?.invalidatePendingRead()
  form.proofScreenshots.splice(index, 1)
  screenshotErr.value = ''
}

function onReplaysChange(event: Event) {
  const files = takeInputFiles(event)
  if (!files.length) return
  const { error, additions, duplicateCount } = mergeReplayFiles(form.replays, files)
  if (error) {
    replayErr.value = t(error === 'type' ? 'mark3.invalidReplayType' : 'mark3.replayLimit')
    return
  }
  form.replays.push(...additions)
  replayErr.value = duplicateCount ? t('mark3.replayDuplicateIgnored') : ''
}

function removeReplay(index: number) {
  form.replays.splice(index, 1)
  replayErr.value = ''
}

function isWinRate(value: number) {
  return Number.isFinite(value)
    && value >= 0
    && value <= 100
    && Math.abs(value * 100 - Math.round(value * 100)) < 1e-8
}

const isPositiveInteger = (value: number) => Number.isInteger(value) && value > 0

function validationKey(values: SubmissionValues) {
  const validMetrics = isPositiveInteger(values.vehicleId)
    && isPositiveInteger(values.battleCount)
    && isPositiveInteger(values.averageDamage)
    && form.winRate !== ''
    && isWinRate(values.winRate)
  const screenshotCount = form.proofScreenshots.length
  const completeEvidence = !screenshotsReading.value
    && screenshotCount >= 1
    && screenshotCount <= 2
    && form.replays.length === REPLAY_EVIDENCE_COUNT
  if (!validMetrics || !completeEvidence) return 'mark3.fillRequired'
  if (findVehicleStatus(props.currentList, values.vehicleId)) return 'mark3.currentExistsLocal'
  if (findVehicleStatus(props.pendingList, values.vehicleId)) return 'mark3.pendingExistsLocal'
  return ''
}

function createFormData(values: SubmissionValues) {
  const formData = new FormData()
  formData.append('vehicleId', String(values.vehicleId))
  formData.append('battleCount', String(values.battleCount))
  formData.append('averageDamage', String(values.averageDamage))
  formData.append('winRate', String(values.winRate))
  for (const screenshot of form.proofScreenshots) formData.append('proofScreenshots', screenshot.data)
  for (const replay of form.replays) formData.append('replays', replay)
  return formData
}

async function submit() {
  if (!requireLogin()) return
  if (submitting.value) return
  const values: SubmissionValues = {
    vehicleId: Number(form.vehicleId),
    battleCount: Number(form.battleCount),
    averageDamage: Number(form.averageDamage),
    winRate: Number(form.winRate),
  }
  const key = validationKey(values)
  if (key) {
    submitError.value = t(key)
    return
  }
  submitting.value = true
  submitError.value = ''
  needProfile.value = false
  try {
    await api.hofMark3Submit(createFormData(values))
    resetDraft()
    show.value = false
    await props.afterSubmit()
  } catch (e) {
    const code = errorCode(e)
    if (code === 'MARK3_PROFILE_GAME_ID_REQUIRED' || code === 'MARK3_PROFILE_NICKNAME_REQUIRED') {
      needProfile.value = true
      submitError.value = t('mark3.needProfile')
    } else {
      submitError.value = apiErrorLabel(t, te, e)
    }
  } finally {
    submitting.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <AppDialog :open="show" :title="$t('mark3.submitTitle')" size="lg" keep-mounted scrim-class="mark3-submit-overlay" class="h100-modal mark3-modal" @close="close">
      <p>{{ $t('mark3.submitDesc') }}</p>
      <section class="hof-rules" data-testid="hof-rules-mark3">
        <h3 class="hof-rules-title">{{ $t('hofRules.title') }}</h3>
        <ul>
          <li>{{ $t('hofRules.mark3.ranking') }}</li>
          <li>{{ $t('hofRules.mark3.evidence') }}</li>
          <li>{{ $t('hofRules.mark3.once') }}</li>
        </ul>
      </section>
      <p class="h100-draft-hint">{{ $t('mark3.draftHint') }}</p>

      <div class="h100-field">
        <label class="h100-field-label" for="mark3-submit-vehicle">{{ $t('mark3.selectVehicle') }}</label>
        <VehiclePicker :model-value="form.vehicleId ?? undefined" @update:model-value="form.vehicleId = $event" class="mark3-submit-vehicle" input-id="mark3-submit-vehicle"
                       :options="pickerOptions" :placeholder="$t('mark3.chooseVehicle')" />
        <p class="hof-threshold" :class="{ 'is-blocked': threshold.blocked }" data-testid="mark3-threshold">
          <strong>{{ $t('hofRules.threshold.title') }}</strong>{{ $t(threshold.key, threshold.params || {}) }}
        </p>
      </div>

      <div class="h100-field">
        <label class="h100-field-label" for="mark3-submit-battles">{{ $t('mark3.claimedBattles') }}</label>
        <input id="mark3-submit-battles" v-model.number="form.battleCount" type="number" min="1" step="1" />
        <small>{{ $t('mark3.claimedBattlesHint') }}</small>
      </div>

      <div class="h100-field">
        <label class="h100-field-label" for="mark3-submit-damage">{{ $t('mark3.claimedDamage') }}</label>
        <input id="mark3-submit-damage" v-model.number="form.averageDamage" type="number" min="1" step="1" />
        <small>{{ $t('mark3.claimedDamageHint') }}</small>
      </div>

      <div class="h100-field">
        <label class="h100-field-label" for="mark3-submit-win-rate">{{ $t('mark3.claimedWinRate') }}</label>
        <input id="mark3-submit-win-rate" v-model.number="form.winRate" type="number" min="0" max="100" step="0.01" />
        <small>{{ $t('mark3.claimedWinRateHint') }}</small>
      </div>

      <div class="h100-field">
        <span class="h100-field-label">{{ $t('mark3.screenshotLabel') }}
          <span class="h100-counter">{{ $t('mark3.screenshotCounter', { current: form.proofScreenshots.length }) }}</span>
        </span>
        <ImageDataUploader ref="screenshotUploader" multiple :max-files="2"
                            :existing-keys="form.proofScreenshots.map(screenshot => screenshot.key)"
                            @selected="onScreenshotsSelected"
                            @error="onScreenshotUploadError"
                            @reading="screenshotsReading = $event" />
        <small>{{ $t('mark3.screenshotHint') }}</small>
        <p v-if="screenshotsReading" class="h100-file-reading">{{ $t('mark3.readingScreenshots') }}</p>
        <ul v-if="form.proofScreenshots.length" class="h100-selected-files mark3-proof-list">
          <li v-for="(screenshot, index) in form.proofScreenshots" :key="screenshot.key" class="h100-selected-file mark3-proof-item">
            <img class="mark3-proof-preview" :src="screenshot.data" :alt="$t('mark3.screenshotPreview', { number: index + 1 })" />
            <span class="h100-file-index">{{ index + 1 }}</span>
            <span class="h100-selected-name" :title="screenshot.name">{{ screenshot.name }}</span>
            <button type="button" class="h100-remove-file" :aria-label="$t('mark3.removeFile', { name: screenshot.name })" @click="removeScreenshot(index)">×</button>
          </li>
        </ul>
        <p v-if="screenshotErr" class="h100-err">{{ screenshotErr }}</p>
      </div>

      <div class="h100-field">
        <span class="h100-field-label">{{ $t('mark3.replaysLabel') }}
          <span class="h100-counter">{{ $t('mark3.replayCounter', { current: form.replays.length }) }}</span>
        </span>
        <input ref="replaysInput" type="file" accept=".wotbreplay" multiple @change="onReplaysChange" />
        <small>{{ $t('mark3.replaysHint') }}</small>
        <ul v-if="form.replays.length" class="h100-selected-files">
          <li v-for="(replay, index) in form.replays" :key="replayFileKey(replay)" class="h100-selected-file">
            <span class="h100-file-index">{{ index + 1 }}</span>
            <span class="h100-selected-name" :title="replay.name">{{ replay.name }}</span>
            <button type="button" class="h100-remove-file" :aria-label="$t('mark3.removeFile', { name: replay.name })" @click="removeReplay(index)">×</button>
          </li>
        </ul>
        <p v-if="replayErr" class="h100-err">{{ replayErr }}</p>
      </div>

      <p v-if="needProfile" class="h100-need-profile">
        {{ submitError }} <a href="/?view=profile">{{ $t('mark3.goProfile') }}</a>
      </p>
      <p v-else-if="submitError" class="h100-err">{{ submitError }}</p>

      <template #actions>
        <button type="button" class="ghost danger h100-clear-draft" :disabled="submitting || !hasDraft" @click="clearDraft">{{ $t('mark3.clearDraft') }}</button>
        <button type="button" class="ghost" :disabled="submitting" @click="close">{{ $t('app.close') }}</button>
        <button type="button" class="filebtn mark3-modal-submit" :disabled="submitting || screenshotsReading" @click="submit">
          {{ submitting ? $t('mark3.submitting') : $t('mark3.submit') }}
        </button>
      </template>
  </AppDialog>
</template>
