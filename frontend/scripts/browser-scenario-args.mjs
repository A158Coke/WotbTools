/**
 * 浏览器门禁的场景选择参数（browser-workspace-interaction / browser-armor-mobile 共用）。
 *
 * `--shard i/n`（1 基）按**静态列表下标取模**切分：场景清单是编译期常量，切分跨 run 稳定，
 * 对任意 n 成立。参数错误一律抛错：CI 分片传错时不得静默退回全量或空跑。
 */
export function parseScenarioArgs(argv) {
  if (argv.some((arg) => arg.startsWith('--shard='))) throw new Error('--shard 需要写成 `--shard i/n`')
  const shardFlagAt = argv.indexOf('--shard')
  const shardArg = shardFlagAt >= 0 ? argv[shardFlagAt + 1] : null
  if (shardFlagAt >= 0 && !shardArg) throw new Error('--shard 缺少 i/n')
  const match = shardArg ? /^([1-9]\d*)\/([1-9]\d*)$/.exec(shardArg) : null
  if (shardArg && !match) throw new Error(`--shard 需要 i/n 形式（1 基）: ${shardArg}`)
  if (match && Number(match[1]) > Number(match[2])) throw new Error(`--shard 下标超出分片数: ${shardArg}`)
  return {
    // 名过滤器忽略 --shard 的**值**（`1/3` 不以 - 开头，否则会被误当场景名）
    nameFilter: argv.find((arg, index) => !arg.startsWith('-') && (shardFlagAt < 0 || index !== shardFlagAt + 1)),
    shard: match ? { index: Number(match[1]) - 1, total: Number(match[2]), label: shardArg } : null,
  }
}

/** 取当前分片；调用方已先按名过滤。显式选择但结果为空时抛错，防止门禁空跑变绿。 */
export function selectShard(scenarios, { nameFilter, shard }) {
  const selected = shard ? scenarios.filter((_, index) => index % shard.total === shard.index) : scenarios
  if ((nameFilter || shard) && selected.length === 0) {
    throw new Error(`no scenario matches (filter=${nameFilter ?? '-'} shard=${shard?.label ?? '-'})`)
  }
  return selected
}
