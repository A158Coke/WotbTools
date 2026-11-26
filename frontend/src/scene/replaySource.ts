
import { loadAgentWasmModule, validateAgentPlayback, validateAgentRecorderCamera } from '../api/agent-replay-facets.js'
import { buildPitchLimits } from './pitchLimits.js'
import type { AgentPlaybackFacet } from '../api/agent-replay-facets.js'
import type { PlaybackParseKind, PlaybackParseDiagnostics } from './playbackParse.worker.js'

export type PlaybackDiagnosticEvent = { stage: string; durationMs?: number; status?: string; digest?: string }
export type PlaybackDiagnosticObserver = (event: PlaybackDiagnosticEvent) => void

function emitPlaybackDiagnostic(observer: PlaybackDiagnosticObserver | undefined, event: PlaybackDiagnosticEvent) {
  try { observer?.(event) } catch { /* observer is best effort */ }
}
function measured(observer: PlaybackDiagnosticObserver | undefined, stage: string, start: number) {
  if (observer) emitPlaybackDiagnostic(observer, { stage, durationMs: performance.now() - start })
}


type ReplayFile = Blob & { name?: string; lastModified?: number }
type ParseReply = { id?: number; json?: string; error?: string; diagnostics?: PlaybackParseDiagnostics }
interface ParsePending {
  resolve: (reply: ParseReply) => void
  reject: (error: unknown) => void
  signal?: AbortSignal
  watchdog: ReturnType<typeof setTimeout> | null
  onAbort: (() => void) | null
}

let tankNamesPromise: Promise<Map<number, string>> | null = null
export function tankNamesStatic() {
  if (!tankNamesPromise) {
    tankNamesPromise = assetProvider.json<Record<string, { name?: string } | null>>('/data/tank_cache.json').then((cache) => {
      const out = new Map<number, string>()
      for (const [id, info] of Object.entries(cache || {})) {
        if (info && info.name) out.set(Number(id), info.name)
      }
      return out
    }).catch(() => {
      tankNamesPromise = null
      return new Map()
    })
  }
  return tankNamesPromise
}

const PLAYBACK_JSON_CACHE_MAX = 3;
const playbackJsonCache = new Map<string, string>();
let parseWorker: Worker | null = null;
let parseSeq = 0;
const parsePending = new Map<number, ParsePending>();
const PARSE_WATCHDOG_MS = 120_000;

function playbackParseAbortError() {
  return new DOMException('playback 解析已被撤下（清空 / 换文件 / 销毁）', 'AbortError')
}

function abandonParseWorker(error: unknown) {
  const pendings = [...parsePending.values()];
  parsePending.clear();
  for (const pending of pendings) {
    if (pending.watchdog) clearTimeout(pending.watchdog);
    pending.signal?.removeEventListener('abort', pending.onAbort!);
    pending.reject(error);
  }
  if (parseWorker) {
    try { parseWorker.terminate(); } catch { /* 已死 */ }
    parseWorker = null;
  }
}

function wireParseWorker(worker: Worker) {
  worker.onmessage = (event: MessageEvent<ParseReply | null>) => {
    const { id, error }: ParseReply = event.data || {};
    const pending = parsePending.get(id as number);
    if (!pending) return false;
    parsePending.delete(id as number);
    if (pending.watchdog) clearTimeout(pending.watchdog);
    pending.signal?.removeEventListener('abort', pending.onAbort!);
    if (error) pending.reject(new Error(error)); else pending.resolve(event.data || {});
    return true;
  };
  worker.onerror = (event) => {
    abandonParseWorker(new Error(event.message || 'playback parse worker crashed'));
  };
}

let testParseWorker: Worker | (() => Worker) | null = null;
export function __setParseWorkerForTest(worker: Worker | (() => Worker) | null) {
  testParseWorker = worker;
}

if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')) {
  window.__pbReplaySource = { __setParseWorkerForTest };
}

function parseWorkerInstance() {
  if (parseWorker) return parseWorker;
  try {
    const worker = typeof testParseWorker === 'function' ? testParseWorker() : testParseWorker
      ?? new Worker(new URL('./playbackParse.worker.ts', import.meta.url), { type: 'module' });
    wireParseWorker(worker);
    parseWorker = worker;
  } catch { parseWorker = null; }
  return parseWorker;
}

export function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('exact replay bytes expected (Uint8Array)')
  }
  return (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer) as ArrayBuffer;
}

export function playbackParsePayload(bytes: Uint8Array) {
  return exactArrayBuffer(bytes);
}

export async function replayContentDigest(bytes: Uint8Array) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest('SHA-256', exactArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function fileCacheKey(fileObject: ReplayFile, bytes: Uint8Array) {
  const digest = await replayContentDigest(bytes);
  if (!digest) return null;
  return [fileObject && fileObject.name ? fileObject.name : '',
          bytes.byteLength,
          fileObject && fileObject.lastModified ? fileObject.lastModified : 0, digest].join('|');
}

export function __resetPlaybackJsonCacheForTest() { playbackJsonCache.clear(); }

export async function loadFromLocalFile(
  fileObject: ReplayFile,
  signal?: AbortSignal,
  observer?: PlaybackDiagnosticObserver,
  onDigest?: (digest: string) => void,
) {
  let started = observer ? performance.now() : 0
  if (signal?.aborted) throw playbackParseAbortError()
  const arrayBuffer = await fileObject.arrayBuffer()
  measured(observer, 'file.arrayBuffer', started)
  const bytes = new Uint8Array(arrayBuffer)
  if (signal?.aborted) throw playbackParseAbortError()
  started = observer ? performance.now() : 0
  const cacheKey = await fileCacheKey(fileObject, bytes)
  measured(observer, 'replay.digest', started)
  const replayDigest = cacheKey?.split('|').at(-1)
  if (replayDigest) onDigest?.(replayDigest)
  if (observer) emitPlaybackDiagnostic(observer, { stage: 'replay.identity', digest: replayDigest })
  if (signal?.aborted) throw playbackParseAbortError()
  const cachedJson = cacheKey === null ? undefined : playbackJsonCache.get(cacheKey)
  if (observer) emitPlaybackDiagnostic(observer, { stage: 'json.cache', status: cachedJson !== undefined ? 'hit' : 'miss' })
  if (cachedJson !== undefined) {
    playbackJsonCache.delete(cacheKey!); playbackJsonCache.set(cacheKey!, cachedJson);
    if (observer) {
      for (const stage of ['first.parse', 'pitchLimits.wait', 'second.parse']) {
        emitPlaybackDiagnostic(observer, { stage, status: 'skipped' })
      }
    }
    return decodePlayback(cachedJson, observer)
  }
  let json = await parsePlaybackJsonOffThread(bytes, signal, undefined, 'playback', observer, 'first')
  let secondParseStarted = false
  try {
    started = observer ? performance.now() : 0
    const first = JSON.parse(json)
    measured(observer, 'first.json.parse', started)
    started = observer ? performance.now() : 0
    const limits = await buildPitchLimits(first.vehicles)
    measured(observer, 'pitchLimits.wait', started)
    if (Object.keys(limits).length) {
      const limitsJson = JSON.stringify(limits)
      secondParseStarted = true
      json = await parsePlaybackJsonOffThread(bytes, signal, limitsJson, 'playback', observer, 'second')
    } else if (observer) emitPlaybackDiagnostic(observer, { stage: 'second.parse', status: 'skipped' })
  } catch (err) {
    if ((err as Error | null)?.name === 'AbortError') throw err
    if (observer) {
      emitPlaybackDiagnostic(observer, { stage: secondParseStarted ? 'second.parse' : 'pitchLimits.wait', status: 'fallback' })
      if (!secondParseStarted) emitPlaybackDiagnostic(observer, { stage: 'second.parse', status: 'skipped' })
    }
  }
  if (cacheKey !== null) {
    playbackJsonCache.set(cacheKey, json)
    if (playbackJsonCache.size > PLAYBACK_JSON_CACHE_MAX) {
      playbackJsonCache.delete(playbackJsonCache.keys().next().value as string)
    }
  }
  return decodePlayback(json, observer)
}

async function decodePlayback(json: string, observer?: PlaybackDiagnosticObserver) {
  let start = observer ? performance.now() : 0
  const parsed = JSON.parse(json)
  measured(observer, 'json.parse', start)
  start = observer ? performance.now() : 0
  const validated = validateAgentPlayback(parsed)
  measured(observer, 'validation', start)
  start = observer ? performance.now() : 0
  const result = await enrichPlayback(validated)
  measured(observer, 'enrichment', start)
  return result
}
async function parsePlaybackJsonOffThread(
  bytes: Uint8Array,
  signal?: AbortSignal,
  limitsJson?: string,
  kind: PlaybackParseKind = 'playback',
  observer?: PlaybackDiagnosticObserver,
  pass = 'first',
): Promise<string> {
  if (signal?.aborted) throw playbackParseAbortError()
  const worker = parseWorkerInstance();
  if (worker) {
    try {
      const start = observer ? performance.now() : 0
      const reply = await new Promise<ParseReply>((resolve, reject) => {
        const id = ++parseSeq;
        const pending: ParsePending = { resolve, reject, signal, watchdog: null, onAbort: null };
        parsePending.set(id, pending);
        pending.watchdog = setTimeout(() => {
          abandonParseWorker(new Error(
            `playback 解析 Worker ${Math.round(PARSE_WATCHDOG_MS / 1000)}s 未回包，已重建（可重试）`,
          ));
        }, PARSE_WATCHDOG_MS);
        pending.onAbort = () => {
          if (parsePending.has(id)) abandonParseWorker(playbackParseAbortError())
        };
        signal?.addEventListener('abort', pending.onAbort, { once: true });
        worker.postMessage({ id, kind, bytes: playbackParsePayload(bytes), limitsJson, ...(observer ? { diagnostics: true } : {}) });
      });
      if (observer) {
        const roundtrip = performance.now() - start
        emitPlaybackDiagnostic(observer, { stage: `${pass}.worker.roundtrip`, durationMs: roundtrip })
        const d = reply.diagnostics
        if (d && Number.isFinite(d.wasmReadyMs) && d.wasmReadyMs >= 0 && Number.isFinite(d.parseMs) && d.parseMs >= 0) {
          emitPlaybackDiagnostic(observer, { stage: `${pass}.wasm.ready`, durationMs: d.wasmReadyMs })
          emitPlaybackDiagnostic(observer, { stage: `${pass}.parse`, durationMs: d.parseMs })
          const unattributed = roundtrip - d.wasmReadyMs - d.parseMs
          emitPlaybackDiagnostic(observer, unattributed >= 0
            ? { stage: `${pass}.worker.unattributed`, durationMs: unattributed }
            : { stage: `${pass}.worker.unattributed`, status: 'unavailable' })
        } else emitPlaybackDiagnostic(observer, { stage: `${pass}.worker.timing`, status: 'unavailable' })
      }
      return reply.json as string
    } catch (err) {
      if (!parseWorker) {
        throw err;
      }
      console.warn('[playback] 解析 Worker 不可用，回退主线程解析:', err);
      parseWorker = null;
    }
  }
  if (observer) emitPlaybackDiagnostic(observer, { stage: `${pass}.worker`, status: 'fallback' })
  let started = observer ? performance.now() : 0
  const mod = await loadAgentWasmModule();
  measured(observer, `${pass}.wasm.ready`, started)
  if (signal?.aborted) throw playbackParseAbortError()
  if (kind === 'recorder-camera') {
    if (typeof mod.parseRecorderCamera !== 'function') {
      throw new Error('agent wasm: parseRecorderCamera 缺失（产物版本早于 v0.4.21）')
    }
    return mod.parseRecorderCamera(bytes);
  }
  if (typeof mod.parsePlayback !== 'function') {
    throw new Error('agent wasm: parsePlayback 缺失（产物版本早于契约 v2）')
  }
  started = observer ? performance.now() : 0
  const json = mod.parsePlayback(bytes, undefined, limitsJson || undefined);
  measured(observer, `${pass}.parse`, started)
  return json;
}

export async function loadRecorderCameraFromFile(fileObject: ReplayFile, signal?: AbortSignal) {
  if (signal?.aborted) throw playbackParseAbortError()
  const bytes = new Uint8Array(await fileObject.arrayBuffer())
  const json = await parsePlaybackJsonOffThread(bytes, signal, undefined, 'recorder-camera')
  return validateAgentRecorderCamera(JSON.parse(json))
}

async function enrichPlayback(data: AgentPlaybackFacet) {
  try {
    const names = await tankNamesStatic()
    if (names.size) {
      for (const v of data.vehicles || []) {
        if (v.tank_id && !v.tank_name) v.tank_name = names.get(v.tank_id) || ''
      }
    }
  } catch { /* 资产缺失：兜底显示 */ }
  return data
}

export async function loadPlaybackData(source: { kind?: string; file?: ReplayFile; signal?: AbortSignal; observer?: PlaybackDiagnosticObserver } | null | undefined) {
  if (source && source.kind === 'local' && source.file) {
    return loadFromLocalFile(source.file, source.signal, source.observer)
  }
  throw new Error('回放数据源仅支持本地文件（client-only 拓扑，无服务端通道）')
}


import { assetProvider } from './assetProvider.js'
export {
  __resetMap2dIndexForTest,
  __resetMapIndexForTest,
  loadMap2dIndex,
  loadMapIndex,
  map2dCanonicalUrl,
  mapCoverUrl,
  mapStaticUrl,
  resolveMap2dBasemap,
  resolveMapKey,
} from './replayMapAssets.js'
