<script setup>
// 百场人工提交弹窗：表单草稿 / 证据 / 本地校验 / 提交的唯一 owner。弹窗 keep-mounted，关闭后草稿保留。
// 个人状态（pending / current）与候选车辆归 HofHundredBoard，这里只读。
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { confirm } from '../composables/useConfirm.js'
import { apiErrorLabel } from '../utils/display.js'
import { HUNDRED_VEHICLES } from '../utils/hundredVehicles.js'
import * as api from '../api/hall-of-fame.js'
import { findVehicleStatus, formatHofNumber, mergeReplayFiles, replayFileKey, tierXPickerOption, useHofAccess, REPLAY_EVIDENCE_COUNT } from './hofBoardShared.js'
import AppDialog from './AppDialog.vue'
import ImageDataUploader from './ImageDataUploader.vue'
import VehiclePicker from './VehiclePicker.vue'

const props = defineProps({
  /** 百场榜当前筛选后的候选车辆 */
  vehicles: { type: Array, required: true },
  pendingList: { type: Array, required: true },
  currentList: { type: Array, required: true },
  /** 提交成功（草稿已清空、弹窗已关闭）后由榜单刷新；提交中状态持续到它完成 */
  afterSubmit: { type: Function, required: true },
})

const { t, te } = useI18n()
const { requireLogin } = useHofAccess()

const show = ref(false)
const submitting = ref(false)
const submitError = ref('')
const needProfile = ref(false)
const screenshotErr = ref('')
const replayErr = ref('')
const screenshotUploader = ref(null)
const replaysInput = ref(null)
const screenshotName = ref('')
const screenshotReading = ref(false)
const form = reactive({
  vehicleId: null,
  averageDamage: '',
  battleCount: '',
  screenshot: '',
  replays: []
})

const hasDraft = computed(() => Boolean(
  form.vehicleId
  || form.averageDamage !== ''
  || form.battleCount !== ''
  || form.screenshot
  || form.replays.length
))

const pickerOptions = computed(() => {
  const candidates = props.vehicles
  const draftVehicle = HUNDRED_VEHICLES.find(vehicle => vehicle.id === Number(form.vehicleId))
  const list = !draftVehicle || candidates.some(vehicle => vehicle.id === draftVehicle.id)
    ? candidates
    : [draftVehicle, ...candidates].sort((a, b) => a.name.localeCompare(b.name))
  return list.map(vehicle => tierXPickerOption(t, te, vehicle))
})

/**
 * 提交弹窗里的当前门槛（审计 BZ-18）：门槛是「你在该车的当前纪录」。没有纪录时明确说明这是第一条纪录，
 * 而不是提示「须高于当前纪录」。
 */
const threshold = computed(() => {
  const vehicleId = form.vehicleId
  if (!vehicleId) return { key: 'hofRules.threshold.chooseVehicle' }
  if (findVehicleStatus(props.pendingList, vehicleId)) return { key: 'hofRules.threshold.pending', blocked: true }
  const current = findVehicleStatus(props.currentList, vehicleId)
  if (!current) return { key: 'hofRules.threshold.hundredFirst' }
  return {
    key: 'hofRules.threshold.hundredCurrent',
    params: {
      damage: formatHofNumber(current.approvedAverageDamage ?? current.claimedAverageDamage),
      battles: formatHofNumber(current.approvedBattleCount ?? current.claimedBattleCount),
    },
  }
})

function open(defaultVehicleId) {
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
  if (submitting.value) return
  show.value = false
}

function resetDraft() {
  form.vehicleId = null
  form.averageDamage = ''
  form.battleCount = ''
  screenshotUploader.value?.invalidatePendingRead()
  screenshotReading.value = false
  form.screenshot = ''
  form.replays = []
  screenshotName.value = ''
  screenshotErr.value = ''
  replayErr.value = ''
  if (replaysInput.value) replaysInput.value.value = ''
  submitError.value = ''
  needProfile.value = false
}

async function clearDraft() {
  if (!hasDraft.value || submitting.value) return
  if (!(await confirm({ title: t('hundred.clearDraftConfirm'), confirmLabel: t('hundred.clearDraft'), danger: true }))) return
  resetDraft()
}

function onScreenshotSelected(images) {
  const screenshot = images[0]
  if (!screenshot) return
  screenshotErr.value = ''
  form.screenshot = screenshot.data
  screenshotName.value = screenshot.name
}

function onScreenshotUploadError(code) {
  const errorKey = {
    'invalid-type': 'hundred.invalidImageType',
    'too-large': 'hundred.invalidImageSize',
  }[code] || 'hundred.imageReadError'
  screenshotErr.value = t(errorKey)
}

function removeScreenshot() {
  screenshotUploader.value?.invalidatePendingRead()
  screenshotReading.value = false
  form.screenshot = ''
  screenshotName.value = ''
  screenshotErr.value = ''
}

function onReplaysChange(e) {
  const input = e.target
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length) return
  const { error, additions, duplicateCount } = mergeReplayFiles(form.replays, files)
  if (error) {
    replayErr.value = t(error === 'type' ? 'hundred.invalidReplayType' : 'hundred.replayLimit')
    return
  }
  form.replays.push(...additions)
  replayErr.value = duplicateCount ? t('hundred.replayDuplicateIgnored') : ''
}

function removeReplay(index) {
  form.replays.splice(index, 1)
  replayErr.value = ''
}

async function submit() {
  if (!requireLogin()) return
  if (submitting.value) return
  const damage = Number(form.averageDamage)
  const battles = Number(form.battleCount)
  const commonInvalid = !form.vehicleId
    || !Number.isInteger(damage) || damage <= 0
    || !Number.isInteger(battles) || battles <= 0
  if (commonInvalid || !form.screenshot || screenshotReading.value || form.replays.length !== REPLAY_EVIDENCE_COUNT) {
    submitError.value = t('hundred.fillRequired')
    return
  }
  // 提交前本地提示：所选车辆已有 PENDING 时立即阻止（backend 409 仍保留为最终兜底）。
  if (findVehicleStatus(props.pendingList, form.vehicleId)) {
    submitError.value = t('hundred.pendingExistsLocal')
    return
  }
  submitting.value = true
  submitError.value = ''
  needProfile.value = false
  try {
    const fd = new FormData()
    fd.append('vehicleId', String(form.vehicleId))
    fd.append('averageDamage', String(damage))
    fd.append('battleCount', String(battles))
    fd.append('screenshot', form.screenshot)
    for (const r of form.replays) fd.append('replays', r)
    await api.hofHundredSubmit(fd)
    resetDraft()
    show.value = false
    await props.afterSubmit()
  } catch (e) {
    const code = e?.code
    if (code === 'HUNDRED_PROFILE_GAME_ID_REQUIRED' || code === 'HUNDRED_PROFILE_NICKNAME_REQUIRED') {
      needProfile.value = true
      submitError.value = t('hundred.needProfile')
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
  <AppDialog :open="show" :title="$t('hundred.submitTitle')" size="lg" keep-mounted scrim-class="h100-submit-overlay" class="h100-modal" @close="close">
      <p>{{ $t('hundred.submitDesc') }}</p>
      <section class="hof-rules" data-testid="hof-rules-hundred">
        <h3 class="hof-rules-title">{{ $t('hofRules.title') }}</h3>
        <ul>
          <li>{{ $t('hofRules.hundred.tierX') }}</li>
          <li>{{ $t('hofRules.hundred.evidence') }}</li>
          <li>{{ $t('hofRules.hundred.higher') }}</li>
        </ul>
      </section>
      <p class="h100-draft-hint">{{ $t('hundred.draftHint') }}</p>

      <div class="h100-field">
        <label class="h100-field-label" for="h100-submit-vehicle">{{ $t('hundred.selectVehicle') }}</label>
        <VehiclePicker v-model="form.vehicleId" class="h100-submit-vehicle" input-id="h100-submit-vehicle"
                       :options="pickerOptions" :placeholder="$t('hundred.chooseVehicle')" />
        <p class="hof-threshold" :class="{ 'is-blocked': threshold.blocked }" data-testid="hundred-threshold">
          <strong>{{ $t('hofRules.threshold.title') }}</strong>{{ $t(threshold.key, threshold.params || {}) }}
        </p>
      </div>

      <div class="h100-field">
        <label class="h100-field-label" for="h100-submit-damage">{{ $t('hundred.claimedDamage') }}</label>
        <input id="h100-submit-damage" v-model.number="form.averageDamage" type="number" min="1" step="1" />
        <small>{{ $t('hofRules.positiveInteger') }}</small>
      </div>

      <div class="h100-field">
        <label class="h100-field-label" for="h100-submit-battles">{{ $t('hundred.claimedBattles') }}</label>
        <input id="h100-submit-battles" v-model.number="form.battleCount" type="number" min="1" step="1" />
        <small>{{ $t('hundred.claimedBattlesHint') }}</small>
      </div>

      <div class="h100-manual-evidence">
        <div class="h100-field">
          <span class="h100-field-label">{{ $t('hundred.screenshotLabel') }}</span>
        <ImageDataUploader ref="screenshotUploader"
                            @selected="onScreenshotSelected"
                            @error="onScreenshotUploadError"
                            @reading="screenshotReading = $event" />
          <small>{{ $t('hundred.screenshotHint') }}</small>
          <p v-if="screenshotReading" class="h100-file-reading">{{ $t('hundred.readingScreenshot') }}</p>
          <div v-else-if="screenshotName" class="h100-selected-file">
            <span class="h100-selected-name" :title="screenshotName">{{ screenshotName }}</span>
            <button type="button" class="h100-remove-file" :aria-label="$t('hundred.removeFile', { name: screenshotName })" @click="removeScreenshot">×</button>
          </div>
          <p v-if="screenshotErr" class="h100-err">{{ screenshotErr }}</p>
        </div>

        <div class="h100-field">
          <span class="h100-field-label">{{ $t('hundred.replaysLabel') }}
            <span class="h100-counter">{{ $t('hundred.replayCounter', { current: form.replays.length }) }}</span>
          </span>
          <input ref="replaysInput" type="file" accept=".wotbreplay" multiple @change="onReplaysChange" />
          <small>{{ $t('hundred.replaysHint') }}</small>
          <ul v-if="form.replays.length" class="h100-selected-files">
            <li v-for="(replay, index) in form.replays" :key="replayFileKey(replay)" class="h100-selected-file">
              <span class="h100-file-index">{{ index + 1 }}</span>
              <span class="h100-selected-name" :title="replay.name">{{ replay.name }}</span>
              <button type="button" class="h100-remove-file" :aria-label="$t('hundred.removeFile', { name: replay.name })" @click="removeReplay(index)">×</button>
            </li>
          </ul>
          <p v-if="replayErr" class="h100-err">{{ replayErr }}</p>
        </div>
      </div>

      <p v-if="needProfile" class="h100-need-profile">
        {{ submitError }} <a href="/?view=profile">{{ $t('hundred.goProfile') }}</a>
      </p>
      <p v-else-if="submitError" class="h100-err">{{ submitError }}</p>

      <template #actions>
        <button type="button" class="ghost danger h100-clear-draft" :disabled="submitting || !hasDraft" @click="clearDraft">{{ $t('hundred.clearDraft') }}</button>
        <button type="button" class="ghost" :disabled="submitting" @click="close">{{ $t('app.close') }}</button>
        <button type="button" class="filebtn h100-modal-submit"
                :disabled="submitting || screenshotReading" @click="submit">
          {{ submitting ? $t('hundred.submitting') : $t('hundred.submit') }}
        </button>
      </template>
  </AppDialog>
</template>
