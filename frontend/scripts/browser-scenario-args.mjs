export function parseScenarioArgs(argv) {
  if (argv.some((arg) => arg.startsWith('--shard='))) throw new Error('--shard 需要写成 `--shard i/n`')
  const shardFlagAt = argv.indexOf('--shard')
  const shardArg = shardFlagAt >= 0 ? argv[shardFlagAt + 1] : null
  if (shardFlagAt >= 0 && !shardArg) throw new Error('--shard 缺少 i/n')
  const match = shardArg ? /^([1-9]\d*)\/([1-9]\d*)$/.exec(shardArg) : null
  if (shardArg && !match) throw new Error(`--shard 需要 i/n 形式（1 基）: ${shardArg}`)
  if (match && Number(match[1]) > Number(match[2])) throw new Error(`--shard 下标超出分片数: ${shardArg}`)
  return {
    nameFilter: argv.find((arg, index) => !arg.startsWith('-') && (shardFlagAt < 0 || index !== shardFlagAt + 1)),
    shard: match ? { index: Number(match[1]) - 1, total: Number(match[2]), label: shardArg } : null,
  }
}

export function selectShard(scenarios, { nameFilter, shard }) {
  const selected = shard ? scenarios.filter((_, index) => index % shard.total === shard.index) : scenarios
  if ((nameFilter || shard) && selected.length === 0) {
    throw new Error(`no scenario matches (filter=${nameFilter ?? '-'} shard=${shard?.label ?? '-'})`)
  }
  return selected
}
