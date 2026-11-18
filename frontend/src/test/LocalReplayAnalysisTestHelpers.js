export const TANKOPEDIA = Object.freeze({ tanks: 'tankopedia' })

export function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

export function replayFile(name) {
  return new File([name], name)
}

export function preview(battleCount = 1) {
  return {
    battles: Array.from({ length: battleCount }, (_, i) => ({ sourceId: `r${i}`, sourceName: `${i}.wotbreplay`, mapName: 'Lagoon', players: [] })),
    aggregate: [], duplicates: [], failures: [], playerColumns: [], aggregateColumns: [], leagueMode: false,
  }
}

export function parsedOf(files) {
  return files.map(f => ({ name: f.name, result: { file: f.name }, error: null }))
}
