/**
 * 名人堂 / 百场 / 三环提交的客户端结算事实：本机解析回放（上游 Rust Core WASM `parseResult`），
 * 投影成服务端 `ClientReplayFacts` 接收的 `Battle` JSON。服务器没有 parser——它只做结构校验，
 * 原始回放作为证据附件一并提交，防伪造靠管理员审核。
 */
import { parseAgentResultFromBytes } from '../api/agent-replay-facets.js'
import { ApiError } from '../utils/http.js'
import { toBattleFacts } from './battleFacts.js'

/** 解析失败一律映射为稳定的 INVALID_REPLAY_FILE（沿用服务端旧错误码与文案） */
export async function replayFactsJson(file: Blob): Promise<string> {
  try {
    const result = await parseAgentResultFromBytes(new Uint8Array(await file.arrayBuffer()))
    return JSON.stringify(toBattleFacts(result))
  } catch (error) {
    console.warn('[hof] local replay parse failed', error)
    throw new ApiError({ code: 'INVALID_REPLAY_FILE', status: 400, retryable: false })
  }
}

/** 本机解析回放，返回录像者的数值 accountId（个人主页「用回放验证账号」） */
export async function replayRecorderAccountId(file: Blob): Promise<number> {
  try {
    const result = await parseAgentResultFromBytes(new Uint8Array(await file.arrayBuffer()))
    if (!(result.author_account_id > 0)) throw new Error('recorder account id missing')
    return result.author_account_id
  } catch (error) {
    console.warn('[profile] local replay parse failed', error)
    throw new ApiError({ code: 'INVALID_REPLAY_FILE', status: 400, retryable: false })
  }
}

/** 多回放表单：按 `replays` 字段顺序逐个追加 `facts`（服务端按同序一一对应） */
export async function appendReplayFacts(formData: FormData, replaysField = 'replays'): Promise<void> {
  const replays = formData.getAll(replaysField).filter((v): v is File => v instanceof Blob)
  const facts = await Promise.all(replays.map((f) => replayFactsJson(f)))
  formData.delete('facts')
  for (const json of facts) formData.append('facts', json)
}
