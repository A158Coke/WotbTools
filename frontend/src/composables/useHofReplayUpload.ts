import { ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { showToast } from './useToast.js'
import { notify } from './useNotifications.js'
import { apiErrorLabel } from '../utils/display.js'
import * as api from '../api/hall-of-fame.js'

interface ReplayUploadOptions {
  requireLogin: () => boolean
  fileInput: Readonly<Ref<HTMLInputElement | null>>
  afterUpload: () => Promise<void>
}

export function useHofReplayUpload({ requireLogin, fileInput, afterUpload }: ReplayUploadOptions) {
  const { t, te } = useI18n()
  const uploading = ref(false)
  const uploadMsg = ref('')
  const uploadOk = ref(false)
  const dragging = ref(false)

  async function upload(file: File) {
    if (uploading.value) return
    if (!requireLogin()) return
    if (!file.name.toLowerCase().endsWith('.wotbreplay')) {
      uploadMsg.value = t('hof.invalid_file')
      return
    }
    uploading.value = true
    uploadMsg.value = ''
    uploadOk.value = false
    let uploaded = false
    try {
      const result = await api.hofUpload(file)
      if (result.status === 'skipped') {
        uploadMsg.value = t('hof.upload_skipped', {
          reason: result.reasonCode && te(`hof.reason.${result.reasonCode}`)
            ? t(`hof.reason.${result.reasonCode}`)
            : t('hof.upload_skipped_default'),
        })
      } else if (result.status === 'already_recorded') {
        uploadMsg.value = t('hof.upload_already_recorded')
        uploadOk.value = true
      } else {
        uploadMsg.value = t('hof.upload_success')
        uploadOk.value = true
        notify({ kind: 'submission', titleKey: 'notifications.submitted', bodyKey: 'notifications.submittedBody', view: 'hof' })
        showToast({ tone: 'success', title: uploadMsg.value })
      }
      if (fileInput.value) fileInput.value.value = ''
      uploaded = true
    } catch (e) {
      uploadMsg.value = apiErrorLabel(t, te, e)
    } finally {
      uploading.value = false
    }
    if (uploaded) await afterUpload()
  }

  function onUploadButtonClick() {
    if (uploading.value) return
    if (!requireLogin()) return
    fileInput.value?.click()
  }

  function onFileChange(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (file) upload(file)
  }

  function onDrop(event: DragEvent) {
    dragging.value = false
    if (!requireLogin()) return
    const file = event.dataTransfer?.files?.[0]
    if (file) upload(file)
  }

  return { uploading, uploadMsg, uploadOk, dragging, onUploadButtonClick, onFileChange, onDrop }
}
