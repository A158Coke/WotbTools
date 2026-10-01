# Replay parity（迁移期一次性工具）

服务端 Java 解析器退役前的安全网：同一批回放分别跑 **Java `ReplayParser`**（即将删除）与
**上游 Rust Core WASM**（`common/assets/wasm`，按 `deploy/agent/source.json` 锁定），逐字段对比。
Java 解析器删除时本目录一起删除。

**回放与输出都不入库**：回放放在仓库外，输出写到临时目录。

```bash
# 1) Java 侧（在 java/ 下先 mvn -s settings.xml -pl wotb-core -am -DskipTests install）
mvn -q -s settings.xml -pl wotb-core dependency:build-classpath -Dmdep.outputFile=/tmp/cp.txt
cd <回放目录> && java -cp "<java>/wotb-core/target/classes;$(cat /tmp/cp.txt)" \
  <repo>/tools/parity/JavaReplayDump.java . <out>/java.json

# 2) WASM 侧（先 scripts/fetch-agent-wasm.sh）
node tools/parity/wasm-dump.mjs <回放目录> <out>/wasm.json

# 3) 对比
node tools/parity/compare.mjs <out>/java.json <out>/wasm.json
```

批次计算的 golden（去重 → League Rating → 指标 → Preview 投影），classpath 换成
`wotb-replay-coordinator`（`mvn ... -pl wotb-replay-coordinator -am install` 后 `dependency:build-classpath`）：

```bash
# 不带清单：根目录一批 + 每个子目录一批 + 每个回放单场一批（本地语料）
java -cp "<coordinator classpath>" tools/parity/JavaPreviewDump.java <回放目录> <out>/java-preview.json
# 带清单：仓库 fixture golden（frontend/src/replay-local/__golden__/batches.json，路径相对仓库根）
java -cp "<coordinator classpath>" tools/parity/JavaPreviewDump.java <repo> <golden>/java-preview.json <golden>/batches.json
```

Windows 注意：回放目录名含中文时，Java 的命令行参数会乱码——先 `cd` 进回放目录再传 `.`。

## 记录
- 2026-10-01 · v0.3.1：37 字段 32 一致；差异（xp/credits、地图代号、击杀者账号、survived）由上游
  fanypcd/WoT-Blitz-Agent#1 补齐。
- 2026-10-01 · v0.3.2：23 场 / 322 名战斗者，38 字段全部一致。
- 2026-10-01 · v0.3.3：仓库 fixture（普通 / 联赛 / CW / 9.8 训练室 / 损坏文件）发现无胜方被报成 1 队胜，
  由 fanypcd/WoT-Blitz-Agent#2 修复；fixture 与冠军赛语料全部一致。fixture 侧的回归在
  `frontend/src/replay-local/__golden__`（CI 常驻）。
