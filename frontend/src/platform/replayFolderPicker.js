import { callBridge, getCapabilities, getNativeBridgeVersion, isNativeBridgeCompatible } from '../composables/usePlatformBridge.js'
import { NATIVE_REPLAY_FOLDER_CAPABILITY, NATIVE_REPLAY_FOLDER_RESOURCE_URL } from './nativeBridgeContract.js'
import { MAX_REPLAY_FILE_BYTES, MAX_REPLAY_TOTAL_BYTES } from '../utils/replayUpload.js'

// Includes time in the system chooser; reading itself is abortable on component destruction.
const FOLDER_PICKER_TIMEOUT_MS = 10 * 60 * 1000
const FOLDER_READ_TIMEOUT_MS = 2 * 60 * 1000

export async function supportsNativeReplayFolder() {
  const version = await getNativeBridgeVersion()
  return isNativeBridgeCompatible(version)
    && (await getCapabilities()).includes(NATIVE_REPLAY_FOLDER_CAPABILITY)
}

function identity(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
}

function validFile(file) {
  return file && identity(file.fileId) && typeof file.name === 'string' && file.name.length > 0
    && typeof file.relativePath === 'string' && file.relativePath.length > 0
    && (file.size === null || (Number.isSafeInteger(file.size) && file.size >= 0))
    && Number.isSafeInteger(file.lastModified) && file.lastModified >= 0
}

/** Provider sizes can be absent or wrong. Enforce actual bytes before constructing a File. */
async function readFolderFile(selectionId, metadata, remainingBytes, signal) {
  const response = await fetch(NATIVE_REPLAY_FOLDER_RESOURCE_URL, {
    headers: {
      'X-Wotb-Folder-Selection-Id': selectionId,
      'X-Wotb-Folder-File-Id': metadata.fileId,
    },
    cache: 'no-store',
    signal,
  })
  if (!response.ok || !response.body?.getReader) throw new Error('Native folder read failed')
  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  try {
    while (true) {
      if (signal?.aborted) throw new Error('Native folder read cancelled')
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_REPLAY_FILE_BYTES || bytes > remainingBytes) {
        await reader.cancel()
        throw new Error('Native folder read exceeds replay limits')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const file = new File(chunks, metadata.name, {
    type: 'application/octet-stream', lastModified: metadata.lastModified,
  })
  Object.defineProperty(file, 'webkitRelativePath', { value: metadata.relativePath })
  return file
}

/**
 * Only the system-selected transient batch can be read. FileDrop owns replay filtering,
 * merging and preflight; prepareFiles returns the accepted new metadata or [] on rejection.
 * No partial batch is returned, and every selected batch is released even on abort/error.
 */
export async function pickNativeReplayFolder({ signal, prepareFiles }) {
  if (signal?.aborted) return null
  const requestId = crypto.randomUUID ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
  const cancelPicker = () => { void callBridge('cancelReplayFolderPicker', { requestId }) }
  signal?.addEventListener('abort', cancelPicker, { once: true })
  let selectionId
  let readTimeout
  let onAbort
  try {
    const result = await callBridge('pickReplayFolder', { requestId }, { timeoutMs: FOLDER_PICKER_TIMEOUT_MS })
    if (result?.status === 'cancelled') return null
    if (result?.status !== 'selected' || !identity(result.selectionId)) {
      throw new Error('Native folder selection failed')
    }
    selectionId = result.selectionId
    if (signal?.aborted) throw new Error('Native folder read cancelled')
    if (!Array.isArray(result.files) || !result.files.every(validFile)
      || new Set(result.files.map(file => file.fileId)).size !== result.files.length) {
      throw new Error('Invalid native folder metadata')
    }
    const metadata = result.files.map(file => ({ ...file, webkitRelativePath: file.relativePath }))
    const candidates = prepareFiles(metadata)
    if (!candidates.length) return null
    if (new Set(candidates.map(file => file.relativePath)).size !== candidates.length) {
      throw Object.assign(new Error('Ambiguous native folder paths'), { code: 'ambiguous-paths' })
    }
    const readController = new AbortController()
    onAbort = () => readController.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    readTimeout = setTimeout(onAbort, FOLDER_READ_TIMEOUT_MS)
    const files = []
    let bytes = 0
    for (const candidate of candidates) {
      const file = await readFolderFile(selectionId, candidate, MAX_REPLAY_TOTAL_BYTES - bytes, readController.signal)
      bytes += file.size
      files.push(file)
    }
    if (signal?.aborted) throw new Error('Native folder read cancelled')
    return files
  } finally {
    clearTimeout(readTimeout)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
    signal?.removeEventListener('abort', cancelPicker)
    if (selectionId) await callBridge('releaseReplayFolderSelection', { selectionId })
  }
}
