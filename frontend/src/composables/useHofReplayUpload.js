// 名人堂单场榜的回放上传流程（选择 / 拖拽 → 登录门禁 → 上传 → 结果提示 → 刷新榜单）。
// 状态由调用它的 HofSingleBoard 实例持有；结果提示同时显示在页头与上传弹窗里。
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { showToast } from './useToast.js'
import { notify } from './useNotifications.js'
import { apiErrorLabel } from '../utils/display.js'
import * as api from '../api/hall-of-fame.js'

export function useHofReplayUpload({ requireLogin, afterUpload }) {
  const { t, te } = useI18n()
  const uploading = ref(false)
  const uploadMsg = ref('')
  const uploadOk = ref(false)
  const dragging = ref(false)
  const fileInput = ref(null)

  async function upload(file) {
    if (uploading.value) return
    if (!requireLogin()) return
    if (!file || !file.name.toLowerCase().endsWith('.wotbreplay')) {
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
        // 同一场战斗 + 同一回放早已上榜：不是失败，但也不是「新上榜」
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
      // 结果提示出现时按钮必须已恢复；刷新榜单在其后进行（不再与「上传中…」并存）
      uploading.value = false
    }
    if (uploaded) await afterUpload()
  }

  // 未登录点击「选择回放文件」→ 立即 login('hof')，绝不先打开系统文件选择器。
  // 登录完成后回跳 ?view=hof，用户再次点击才会打开 picker。
  function onUploadButtonClick() {
    if (uploading.value) return
    if (!requireLogin()) return
    fileInput.value?.click()
  }

  function onFileChange(e) {
    const f = e.target.files?.[0]
    if (f) upload(f)
  }

  // 未登录拖拽回放 → 立即 login，不读取/不发送文件。
  function onDrop(e) {
    dragging.value = false
    if (!requireLogin()) return
    const f = e.dataTransfer.files?.[0]
    if (f) upload(f)
  }

  return { uploading, uploadMsg, uploadOk, dragging, fileInput, onUploadButtonClick, onFileChange, onDrop }
}
