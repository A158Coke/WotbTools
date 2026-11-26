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
