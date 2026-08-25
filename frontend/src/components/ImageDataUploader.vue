<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { fileKey } from '../utils/helpers.js'

const props = defineProps({
  multiple: Boolean,
  maxBytes: {
    type: Number,
    default: 4 * 1024 * 1024,
  },
})

const emit = defineEmits(['selected', 'error', 'reading'])
const input = ref(null)
let readGeneration = 0

function invalidatePendingRead() {
  readGeneration += 1
  if (input.value) input.value.value = ''
  emit('reading', false)
}

function validateImages(files) {
  if (files.some(file => !file.type?.startsWith('image/'))) return 'invalid-type'
  if (files.some(file => file.size > props.maxBytes)) return 'too-large'
  return ''
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const data = String(reader.result || '')
      if (!data.startsWith('data:image/')) {
        reject(new Error('invalid-data'))
        return
      }
      resolve({ key: fileKey(file), name: file.name, data })
    }
    reader.onerror = () => reject(new Error('read-error'))
    reader.readAsDataURL(file)
  })
}

function onPick(event) {
  const files = Array.from(event.target.files || [])
  event.target.value = ''
  const generation = ++readGeneration
  emit('reading', false)
  if (!files.length) return

  const validationError = validateImages(files)
  if (validationError) {
    emit('error', validationError)
    return
  }

  emit('reading', true)
  Promise.all(files.map(readImage))
    .then(images => {
      if (generation === readGeneration) emit('selected', images)
    })
    .catch(error => {
      if (generation === readGeneration) emit('error', error?.message || 'read-error')
    })
    .finally(() => {
      if (generation === readGeneration) emit('reading', false)
    })
}

onBeforeUnmount(() => {
  readGeneration += 1
})

defineExpose({ invalidatePendingRead })
</script>

<template>
  <input ref="input" type="file" accept="image/*" :multiple="multiple" @change="onPick" />
</template>
