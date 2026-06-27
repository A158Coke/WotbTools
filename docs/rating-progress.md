# Rating 扩展进度记录

记录日期：2026-06-27

## 最终目标

完整解析回放参数字段；不改当前参数解析页面和字段；额外提供 rating 跳转入口和实时上传计算接口。基于本次上传的回放记录实时展示每名选手：

- rating
- KAST
- 贡献率
- 影响力
- 均伤
- 潜在均伤
- 人头
- 场均人头

不需要历史记录功能，不落库。

## 目标算法因子

- `potential-DPB`：潜在场均。
- `KAST`：不白给率，Kill / Assist / Survivor / Traded death。
  - Kill 替换为 `DPB / average-HP`。
  - Assist 使用 WoT Blitz 的协助伤害。
  - Trade 需要分析帧信息，用玩家死亡前后 5 秒（10 秒窗口）内敌方死亡人数充当交换比。
- `impact`：主要统计赢局里个人 `DPB + Assist + kills` 对回合平均胜率的影响。
  - `DPB + Assist` 看个人占比。
  - 每个人头按 `1/7` 直接加入单局 impact。
- `AST`：协助伤害。
- 多伤率：单局中 `DPB > average-HP` 且 `kills > 1` 视为多伤。
- 平均人头：平均 `kills`。

权重待定，由实现时根据数据可解释性决定。

## 当前完成度

整体约 40%。框架已经搭好，最终 rating 算法还没真正完成。

## 已完成

- 最新仓库已迁移。
- 原参数解析页面保持不动。
- 新扩展页 `/extended` 已有。
- 实时接口 `POST /api/rating` 已有，只按本次上传回放实时计算，不写历史库。
- 扩展页已能展示：rating、KAST、贡献率、影响力、均伤、潜在均伤、人头、场均人头。
- 基础字段已解析：伤害、协助、格挡、击杀、命中、击穿、承伤、击伤、存活、存活时间、车辆、玩家、战队、排、军阶等。
- `xp` / `credits` 已保留解析，但不展示、不用于 rating。
- 潜在伤害字段链路已打通，补增公式已有测试。

## 未完成 / 临时实现

- `potential-DPB` 还不是真正潜在均伤：当前基本等于实际均伤，因为还没解析出“击杀者对每个被击杀者造成的伤害 + 击穿次数”。
- `KAST` 仍是简化版：`kills > 0 || assistDamage > 0 || survived`。
- `KAST` 还没按 `DPB / average-HP`、协助、存活、Trade death 计算。
- Trade death 未完成：还没做“死亡前后 5 秒窗口内敌方死亡人数”的帧/事件分析。
- `impact` 仍是临时影响力：按贡献占比、人头占比、击伤占比加权。
- `impact` 还不是目标定义里的“赢局中 DPB + Assist + kills 对胜率影响”。
- `AST` 基础数据已有，但还没作为独立 rating 因子设计。
- 多伤率未实现。
- `average-HP` 未实现，需要车辆 HP 数据源，或从回放/车辆库补字段。
- 最终 rating 权重未设计。

## 验证状态

记录时最近一次验证：

- Java 测试通过：`cd java && JAVA_HOME=<jdk21> mvn -s settings.xml test`
- 前端构建通过：`cd frontend && npm run build`

## 下一步建议

1. 先确定 `average-HP` 数据来源：车辆库 HP 字段优先；缺失时再考虑从回放/样本估算。
2. 补 Trade death 事件分析：从 `data.wotreplay` 死亡时间线建立 10 秒窗口。
3. 重写 `KAST`：按 `DPB / average-HP`、Assist、Survivor、Trade 四项计算。
4. 重写 `impact`：只或主要基于赢局统计 `DPB + Assist + kills` 占比。
5. 加多伤率和 AST 因子。
6. 最后再定 rating 权重，并补测试与 `docs/rating-system.md` 正式算法说明。
