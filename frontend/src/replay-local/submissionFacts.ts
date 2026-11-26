import { parseAgentResultFromBytes } from '../api/agent-replay-facets.js'
import { ApiError } from '../utils/http.js'
import { toBattleFacts } from './battleFacts.js'
import { tryCollect } from './battle-data/collector.js'

export async function replayFactsJson(file: Blob): Promise<string> {
  try {
    const result = await parseAgentResultFromBytes(new Uint8Array(await file.arrayBuffer()))
    const json = JSON.stringify(toBattleFacts(result))
    tryCollect(file, result)
    return json
  } catch (error) {
    console.warn('[hof] local replay parse failed', error)
    throw new ApiError({ code: 'INVALID_REPLAY_FILE', status: 400, retryable: false })
  }
}

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

export async function appendReplayFacts(formData: FormData, replaysField = 'replays'): Promise<void> {
  const replays = formData.getAll(replaysField).filter((v): v is File => v instanceof Blob)
  const facts = await Promise.all(replays.map((f) => replayFactsJson(f)))
  formData.delete('facts')
  for (const json of facts) formData.append('facts', json)
}
