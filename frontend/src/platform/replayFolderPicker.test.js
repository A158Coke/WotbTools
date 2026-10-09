// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { callBridge, getCapabilities, getNativeBridgeVersion } from '../composables/usePlatformBridge.js'
import { pickNativeReplayFolder, supportsNativeReplayFolder } from './replayFolderPicker.js'
import { NATIVE_REPLAY_FOLDER_RESOURCE_URL } from './nativeBridgeContract.js'

vi.mock('../composables/usePlatformBridge.js', () => ({
  callBridge: vi.fn(), getCapabilities: vi.fn(), getNativeBridgeVersion: vi.fn(),
  isNativeBridgeCompatible: version => version === 2,
}))
// Small byte budgets exercise the real streaming boundary without allocating 200 MiB per unit test.
vi.mock('../utils/replayUpload.js', () => ({ MAX_REPLAY_FILE_BYTES: 4, MAX_REPLAY_TOTAL_BYTES: 6 }))
const metadata = (fileId, extra = {}) => ({
  fileId, name: 'same.wotbreplay', relativePath: `${fileId}/same.wotbreplay`, size: 1, lastModified: 1234, ...extra,
})
const selected = files => ({ status: 'selected', selectionId: 'selection-1', files })
const fetchMock = vi.fn()
const prepareFiles = files => files
function bytesResponse(bytes, status = 200) {
  return { ok: status === 200, status, body: new ReadableStream({
    start(controller) { controller.enqueue(Uint8Array.from(bytes)); controller.close() },
  }) }
}
function pickResponse(result) {
  callBridge.mockImplementation(async method => method === 'pickReplayFolder' ? result : true)
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  getNativeBridgeVersion.mockResolvedValue(2)
  getCapabilities.mockResolvedValue(['replay-folder-picker'])
  pickResponse(selected([metadata('a')]))
  fetchMock.mockResolvedValue(bytesResponse([1]))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Native directory platform boundary', () => {
  it('requires both a compatible bridge and the optional capability', async () => {
    expect(await supportsNativeReplayFolder()).toBe(true)
    getCapabilities.mockResolvedValue([])
    expect(await supportsNativeReplayFolder()).toBe(false)
    getNativeBridgeVersion.mockResolvedValue(1)
    getCapabilities.mockClear()
    expect(await supportsNativeReplayFolder()).toBe(false)
    expect(getCapabilities).not.toHaveBeenCalled()
  })
  it('cancellation does not fetch or release an unrelated selection', async () => {
    pickResponse({ status: 'cancelled', selectionId: null, files: [] })
    expect(await pickNativeReplayFolder({ prepareFiles })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(callBridge).toHaveBeenCalledTimes(1)
  })
  it.each([null, { status: 'failed', selectionId: null, files: [] }])('handles picker failure %j', async result => {
    pickResponse(result)
    await expect(pickNativeReplayFolder({ prepareFiles })).rejects.toThrow('selection failed')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('reads the actual bytes and preserves subdirectory paths for same-named files', async () => {
    pickResponse(selected([metadata('a'), metadata('b', { size: null })]))
    fetchMock.mockResolvedValueOnce(bytesResponse([1, 2])).mockResolvedValueOnce(bytesResponse([3]))
    const files = await pickNativeReplayFolder({ prepareFiles })
    expect(files.map(file => [file.name, file.webkitRelativePath, file.size, file.lastModified])).toEqual([
      ['same.wotbreplay', 'a/same.wotbreplay', 2, 1234], ['same.wotbreplay', 'b/same.wotbreplay', 1, 1234],
    ])
    expect(new Uint8Array(await files[0].arrayBuffer())).toEqual(Uint8Array.from([1, 2]))
    expect(fetchMock).toHaveBeenCalledWith(NATIVE_REPLAY_FOLDER_RESOURCE_URL, expect.objectContaining({
      cache: 'no-store', headers: { 'X-Wotb-Folder-Selection-Id': 'selection-1', 'X-Wotb-Folder-File-Id': 'a' },
    }))
    expect(callBridge).toHaveBeenLastCalledWith('releaseReplayFolderSelection', { selectionId: 'selection-1' })
  })
  it('preflight rejection or an empty directory releases without reading', async () => {
    expect(await pickNativeReplayFolder({ prepareFiles: () => [] })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(callBridge).toHaveBeenLastCalledWith('releaseReplayFolderSelection', { selectionId: 'selection-1' })
    pickResponse(selected([]))
    expect(await pickNativeReplayFolder({ prepareFiles })).toBeNull()
  })
  it.each([
    { fileId: '' }, { size: -1 }, { size: 1.5 }, { relativePath: null }, { lastModified: -1 },
  ])('rejects malformed metadata %j before fetch and releases it', async extra => {
    pickResponse(selected([metadata('a', extra)]))
    await expect(pickNativeReplayFolder({ prepareFiles })).rejects.toThrow('metadata')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(callBridge).toHaveBeenLastCalledWith('releaseReplayFolderSelection', { selectionId: 'selection-1' })
  })
  it('rejects duplicate file identity and never uses producer-supplied URLs', async () => {
    pickResponse(selected([metadata('a'), metadata('a')]))
    await expect(pickNativeReplayFolder({ prepareFiles })).rejects.toThrow('metadata')
    pickResponse(selected([metadata('a', { uri: 'https://untrusted.invalid/private' })]))
    await pickNativeReplayFolder({ prepareFiles })
    expect(fetchMock.mock.calls.every(([url]) => url === NATIVE_REPLAY_FOLDER_RESOURCE_URL)).toBe(true)
  })
  it('rejects ambiguous replay paths before reading instead of silently deduplicating files', async () => {
    pickResponse(selected([metadata('a', { relativePath: 'same.wotbreplay' }), metadata('b', { relativePath: 'same.wotbreplay' })]))
    await expect(pickNativeReplayFolder({ prepareFiles })).rejects.toMatchObject({ code: 'ambiguous-paths' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(callBridge).toHaveBeenLastCalledWith('releaseReplayFolderSelection', { selectionId: 'selection-1' })
  })
  it('ignored non-replay path collisions do not block the accepted replay', async () => {
    pickResponse(selected([
      metadata('a'), metadata('txt-1', { name: 'readme.txt', relativePath: 'readme.txt' }),
      metadata('txt-2', { name: 'readme.txt', relativePath: 'readme.txt' }),
    ]))
    expect(await pickNativeReplayFolder({ prepareFiles: files => files.filter(file => file.name.endsWith('.wotbreplay')) })).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('a failed later file does not return a partial batch', async () => {
    pickResponse(selected([metadata('a'), metadata('b')]))
    fetchMock.mockResolvedValueOnce(bytesResponse([1])).mockResolvedValueOnce(bytesResponse([], 500))
    await expect(pickNativeReplayFolder({ prepareFiles })).rejects.toThrow('read failed')
    expect(callBridge).toHaveBeenLastCalledWith('releaseReplayFolderSelection', { selectionId: 'selection-1' })
  })
  it('enforces actual per-file bytes when provider size is wrong or unknown', async () => {
    pickResponse(selected([metadata('a', { size: null })]))
    fetchMock.mockResolvedValue(bytesResponse([1, 2, 3, 4, 5]))
    await expect(pickNativeReplayFolder({ prepareFiles })).rejects.toThrow('limits')
    expect(callBridge).toHaveBeenLastCalledWith('releaseReplayFolderSelection', { selectionId: 'selection-1' })
  })
  it('enforces actual batch bytes without returning the earlier successful file', async () => {
    pickResponse(selected([metadata('a'), metadata('b')]))
    fetchMock.mockResolvedValueOnce(bytesResponse([1, 2, 3, 4])).mockResolvedValueOnce(bytesResponse([1, 2, 3]))
    await expect(pickNativeReplayFolder({ prepareFiles })).rejects.toThrow('limits')
    expect(callBridge).toHaveBeenLastCalledWith('releaseReplayFolderSelection', { selectionId: 'selection-1' })
  })
  it('ignores a picker result that arrives after the owning component aborted', async () => {
    let reply
    callBridge.mockImplementation(method => method === 'pickReplayFolder'
      ? new Promise(resolve => { reply = resolve }) : Promise.resolve(true))
    const controller = new AbortController()
    const promise = pickNativeReplayFolder({ prepareFiles, signal: controller.signal })
    const rejected = expect(promise).rejects.toThrow('cancelled')
    controller.abort()
    const pickCall = callBridge.mock.calls.find(([method]) => method === 'pickReplayFolder')
    expect(callBridge).toHaveBeenCalledWith('cancelReplayFolderPicker', { requestId: pickCall[1].requestId })
    reply(selected([metadata('a')]))
    await rejected
    expect(fetchMock).not.toHaveBeenCalled()
    expect(callBridge).toHaveBeenLastCalledWith('releaseReplayFolderSelection', { selectionId: 'selection-1' })
  })
  it('aborts active reading on owner cancellation and releases selection', async () => {
    fetchMock.mockImplementation((_, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const controller = new AbortController()
    const promise = pickNativeReplayFolder({ prepareFiles, signal: controller.signal })
    const rejected = expect(promise).rejects.toThrow('aborted')
    await flushPromises()
    controller.abort()
    await rejected
    expect(callBridge).toHaveBeenLastCalledWith('releaseReplayFolderSelection', { selectionId: 'selection-1' })
  })
  it('bounds a stalled read without leaving the selected resource active', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation((_, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('read timed out')), { once: true })
    }))
    const promise = pickNativeReplayFolder({ prepareFiles })
    const rejected = expect(promise).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(120000)
    await rejected
    expect(callBridge).toHaveBeenLastCalledWith('releaseReplayFolderSelection', { selectionId: 'selection-1' })
  })
})
