# 客户端解析迁移（服务器没有 parser）

> 状态：**执行中**（2026-10-01 用户确认）。目标：**服务器没有 parser**——唯一解析器是上游 Rust Core
> （浏览器 / Android 跑 WASM）；汇总、评分、导出等一切对解析结果的计算也在客户端完成。服务端只保留存储、
> 去重键、授权、名人堂记录与 AI 编排。后端需要的字段一律向上游 Rust Core 要（用户同时是上游 contributor，
> 直接改上游、发版、升级 `deploy/agent/source.json`）。

## 已确认的决策
- 一致性：`tools/parity` 本地逐字段对比 Java 与 WASM；仓库 fixture 的 golden 常驻 CI（`frontend/src/replay-local/__golden__`），Java 删除后作为回归基线。
- 缺字段：只向上游要，不在客户端启发式推导（已补：v0.3.2 xp/credits/result_id/killer_account_id/map_key/survived；v0.3.3 无胜方）。
- WASM 解析失败：直接显示原因，**不回退服务端**。
- 名人堂：客户端解析后提交 facts，原始回放作为附件存档；防伪造靠管理员审核。
- 绑定账号的回放自动验证随 processing-jobs 一起退役（改为管理员审核时人工确认）。

## PR 拆分
| PR | 内容 | 线上行为 |
|---|---|---|
| A | parity 工具 + 上游 v0.3.3 + 解析 Worker + 结算事实映射 + 批次计算 TS 移植（golden 全链路一致） | 不变（只新增模块） |
| B | 客户端 xlsx 导出（exceljs 按需加载；补录制者车辆等上游字段） | 不变 |
| C | 2D 回放转换层：PlaybackData → 现有 BattlePlaybackDataset | 不变 |
| D | 工作台一次性切换到本地（数据 / 导出 / 2D），删除前端 processing-jobs 代码 | 切换 |
| E | 名人堂提交客户端 facts | 切换 |
| F | Android | 切换 |
| G | 删除 parser-worker / parser MQ / processing-jobs / Java ReplayParser 与批次计算 / wotb-playback | 删除 |
