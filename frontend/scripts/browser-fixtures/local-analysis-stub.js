/**
 * 批次分析边界替身：3D / 射击门禁用几个字节的假文件驱动面板，场景与解析由各自的 stub 提供。
 * 工作台选文件即加载，假文件过不了真实解析器，所以这些场景连批次分析一起替换：
 * 每个文件成功产出一场。真实解析链路由 multifile / offline / replay-collection 场景覆盖。
 */
export class ReplayEngineUnavailableError extends Error {}

export async function parseReplayFiles(files, { onFile, onProgress } = {}) {
  return files.map((file, index) => {
    const parsed = { name: file.name, result: {}, error: null }
    onFile?.(index, parsed)
    onProgress?.(index + 1, files.length)
    return parsed
  })
}

export function analyzeReplayBatch(parsed) {
  return {
    dataset: {},
    preview: {
      battles: parsed.map((file, index) => ({
        sourceId: `r${index}`, sourceName: file.name, arenaId: file.name, mapName: null,
        startTime: null, durationS: null, winnerTeam: null, players: [],
      })),
      aggregate: [], duplicates: [], failures: [], playerColumns: [], aggregateColumns: [], leagueMode: false,
    },
  }
}
