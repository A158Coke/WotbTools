<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppDialog from '../AppDialog.vue'
import AppButton from '../AppButton.vue'
import ArmorChangeList from './ArmorChangeList.vue'
import type { DiffPair } from '../../composables/useVersionDiff.js'
import './version-diff.css'

interface ArmorDiffDialogProps {
  open?: boolean
  tankName?: string
  armor?: unknown
  detail?: unknown
  loading?: boolean
  error?: boolean
  tankId?: number | string | null
  pair?: DiffPair | null
}

// 内容渲染全部交给 ArmorChangeList（页面内嵌与弹窗同一份）；这里只保留弹窗外壳与动作。
withDefaults(defineProps<ArmorDiffDialogProps>(), {
  open: false,
  tankName: '',
  loading: false,
  error: false,
  tankId: null,
  pair: null,
})
const emit = defineEmits<{
  close: []
  retry: []
  'open-armor-viewer': [dataset: string]
}>()
const { t } = useI18n()
</script>

<template>
  <AppDialog
    :open="open"
    :title="`${tankName} · ${t('versionDiff.armor.title')}`"
    size="lg"
    @close="emit('close')"
  >
    <div class="vd-armor">
      <p v-if="loading" role="status" class="vd-muted">{{ t('versionDiff.loading') }}</p>
      <p v-else-if="error" role="status" class="vd-error">{{ t('versionDiff.log.detailFailed') }}</p>
      <ArmorChangeList v-else :armor="armor" :detail="detail" :pair="pair" />
      <p class="vd-note">{{ t('versionDiff.armor.note') }}</p>
    </div>

    <template #actions>
      <AppButton variant="secondary" @click="emit('close')">{{ t('app.close') }}</AppButton>
      <AppButton v-if="error" variant="primary" @click="emit('retry')">{{ t('versionDiff.retry') }}</AppButton>
      <template v-else-if="tankId != null && pair && !loading">
        <AppButton variant="secondary" @click="emit('open-armor-viewer', pair.from.dataset)">
          {{ t('versionDiff.armor.openViewer') }} · {{ pair.from.dataset }}
        </AppButton>
        <AppButton variant="primary" @click="emit('open-armor-viewer', pair.to.dataset)">
          {{ t('versionDiff.armor.openViewer') }} · {{ pair.to.dataset }}
        </AppButton>
      </template>
    </template>
  </AppDialog>
</template>
