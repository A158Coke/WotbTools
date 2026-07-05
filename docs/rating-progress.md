# Rating 扩展进度记录

记录日期：2026-06-28

## 当前状态

扩展页、实时接口和目标算法主体已完成。`average_hp` 的公式口径已确定，但本地车辆库当前查不到 HP，回放里的每台车实际进场血量 / 双方总血量字段也尚未确认解析；当前暂定未知单车 HP 为 2400。`potential-DPB` 已先接通 direct HP damage 事件链路，剩余核心缺口是精确 `average_hp` 数据源和特殊伤害/真实样本校验。

## 已完成

- 原参数解析页面保持不动。
- 新扩展页 `/extended` 已有。
- 实时接口 `POST /api/rating` 已有，只按本次上传回放实时计算，不写历史库。
- 扩展页已展示：rating、KAST、贡献率、Impact、均伤、潜在均伤、场均协助、多伤率、人头、场均人头；平均血量和账号 ID 不再展示。
- 基础字段已解析：伤害、协助、格挡、击杀、命中、击穿、承伤、击伤、存活、存活时间、车辆、玩家、战队、排、军阶等。
- `xp` / `credits` 已保留解析，但不展示、不用于 rating。
- `average_hp` 公式已确定：敌方 7 台车实际进场总血量 / 7；车辆库无 HP 时未知单车 HP 暂定 2400。
- KAST 已改为单场最大贡献项：伤害、协助、胜局存活、Trade death、伤害+协助五项取最大值后跨场平均，并封顶 100%。
- Trade death 已用玩家死亡前后 5 秒窗口内敌方死亡判断，KAST 中按成立 / 不成立处理；最终 KAST 封顶 100%。
- impact 已改为统计全部场次，按双方 `damage + assist` 总池占比和人头影响计算，并以百分比展示。
- AST 已作为 `assist_avg` 独立进入 rating 因子。
- 多伤率已实现：`1.5 倍均血输出`、`1.2 倍均血输出 + 1 人头`、`1 倍均血输出 + 2 人头`、`3 人头` 任一成立。
- 最终 rating 系数已落地：potential 0.70、KAST 0.15、impact 0.25、AST 0.30、多伤率 0.10、场均人头 0.10。

## 剩余缺口

- 精确 `average_hp` 数据源：当前 `common/tankopedia.json` 和更新脚本都没有 HP 字段，还没从回放确认/解析每台车实际进场血量或双方总血量。当前实现为：车辆库有 HP 时用车辆库，否则未知单车 HP 暂定 2400。
- 真实 `potential-DPB`：已从 Type 8 / subtype 8 / sub=3 direct HP damage 事件推断“击杀者 -> 被击杀者”的逐目标伤害和击穿次数，并填充 `killVictims`；当事件缺失或无法映射时仍回退为 `potential_damage == damage_dealt`。
- 后续需要用更多真实样本校验特殊伤害、殉爆/火烧等非 direct HP damage 场景，避免误补或漏补。

## 验证状态

最近一次本地验证（2026-07-05）：

- `cd java && JAVA_HOME=D:\Env-Web-Java\jdk\temurin-21 mvn -s settings.xml -pl wotb-core test`
  - Core：3 tests，0 failures，0 errors，0 skipped。
- `cd java && JAVA_HOME=D:\Env-Web-Java\jdk\temurin-21 mvn -s settings.xml test`
  - Core 与非 Docker Web 测试通过；`WebApiTest` 需要 Testcontainers，但当前本机没有可用 Docker 环境，因此失败于 `Could not find a valid Docker environment`。
- `cd frontend && npm run build`

## 下一步建议

1. 深挖 `battle_results.dat` 或 `data.wotreplay`，确认/解析每台车实际进场血量或双方总血量。
2. 扩展 `data.wotreplay` 解析，校验特殊伤害、殉爆/火烧等非 direct HP damage 场景。
3. 用真实比赛批量样本导出 rating 分布，微调权重和封顶值。
