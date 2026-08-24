# CW Rating UI 收口 — 浏览器验收清单（plan §26；review PR#134 BLOCKER 2–6 追加项）

> 由人工在真实浏览器执行（happy-dom 无法证明 sticky layout）。建议最新 Chrome，登录后
> 访问 wotbtools.com 的回放解析页上传 CW 回放。测试样本：
> 30+ 份训练赛/联赛回放（common/data/34冠军赛回放/ 目录有真实样本，可一次全选）。
>
> 分支：feat/replay-cw-rating-ui-closeout（部署后此清单适用；本地可 cd frontend && npm run dev 联调后端验证）。
>
> 注意（review PR#134 MERGE GATE）：CI/unit 全绿不能代替真实浏览器验收——历史曾出现
> CI 全绿但真实浏览器 sticky 重叠。本清单必须实际执行并填写验收记录，否则不得宣称 MERGE READY。

## 前置

- [ ] 上传 30+ 份 CW 回放（含至少 2 份可评分、1 份只解析不评分如名册不完整样本）
- [ ] 解析完成后页面进入结果工作区

## Scenario 1 — Sticky P0（plan §26 S1/S2）

- [ ] 默认「汇总」Tab：玩家/Rating 列不重叠
- [ ] 切到 Battle #1 → 横向滚到最右：nickname 与 Rating 列不重叠
- [ ] Battle #10 / #20 / #30 同样不重叠
- [ ] 每场表格 toggle 显示时（tab 来回切换）sticky 列位置正确（hidden→visible 重测生效）

## Scenario 2 — Computed Style（plan §26 S2）

- [ ] DevTools 检查 nickname th：left = 0px、width > 0
- [ ] rating th：left = nickname 宽度 px（不是 0，不是固定 126/130/150）
- [ ] tbody 同样成立

## Scenario 3 — 排序（plan §26 S3）

- [ ] 点击「玩家」「Rating」「伤害」「获取点数」表头：先 ▲ 后 ▼
- [ ] 排序后 sticky 列仍不重叠（排序箭头改变列宽 → 自动重测）
- [ ] 数值列按数值排序（100/21/9 → 升序 9 21 100），缺失值恒排最后
- [ ] 文本列自然排序（Player1/Player2/Player10）
- [ ] CW 统一玩家表与战队汇总表同样可排序

## Scenario 3b — Column Contract & ColumnPicker（review PR#134 BLOCKER 2）

- [ ] 打开 ColumnPicker（CW 统一玩家表）：拖动 KAST 到前面、七维到后面、隐藏 Impact 再重新显示
- [ ] 真实 table 顺序与选择一致；玩家/Rating 始终在前两位且不可隐藏/不可拖拽
- [ ] 刷新页面：顺序与可见性保持（persistence；若 Standard 本来不持久化则与之一致即可）
- [ ] 把用户顺序改成 e.g. 玩家 | Rating | KAST | Impact | 场均伤害 | 获取点数/场 | 七维… → 立即生效
- [ ] 隐藏全部七维 + MVP：表格仍正常（它们不是 forced visible）
- [ ] reorder 后 sticky 玩家/Rating 列仍不重叠（自动重测）

## Scenario 4 — 选手 Drawer（plan §26 S4）

- [ ] 默认 Table 占满宽度、右侧无面板
- [ ] 点击汇总表任意玩家 → 右侧 Drawer 滑出
- [ ] Drawer（Summary scope）含：昵称/战队、「当前批次中位数」标签、Rating 中位数、
      七维雷达（7 轴默认）、表现指标（Contribution/KAST/Impact）、比赛事实
      （场次 + 评分场次分开、胜场/胜率/MVP 次数/场均伤害/助攻/击杀/获取点数每场）
- [ ] 点击另一玩家 → Drawer 不关闭、内容即时切换
- [ ] × 按钮 / 点击遮罩 / Escape 三种方式均可关闭
- [ ] 关闭后 Table 恢复完整宽度（不 permanent 缩窄）
- [ ] 单场 BattleTable 点击玩家 → Drawer（Battle scope：「本场表现」标签 + 本场七维 +
      本场表现指标 + 伤害/助攻/击杀/阻挡/射击/命中/击穿/存活/获取点数）
- [ ] 排序后 Drawer 仍指向原玩家（按 accountId，不串行）

## Scenario 4b — Custom Radar（review PR#134 BLOCKER 6）

- [ ] 打开 Drawer → 默认看到七维雷达
- [ ] 打开「设置指标」→ 删除几个七维、加入 KAST、Contribution、Impact → 雷达即时更新
- [ ] 调整 axis 顺序（↑/↓）→ 雷达轴序跟随
- [ ] 少于 3 个时阻止并提示；多于 8 个时阻止并提示
- [ ] 关闭 Drawer → 打开另一玩家 → 配置保留；Summary → Battle → 配置一致
- [ ] 刷新页面 → 配置仍存在（wotb-radar-metric-order）
- [ ] Table ColumnPicker 隐藏 KAST → Radar KAST 不消失（两套偏好独立）
- [ ] Rating-ineligible 场 Drawer：Rating 为 --、雷达显示「无评分数据」或「部分指标无评分数据」，
      Contribution/KAST/Impact 与 Replay facts 仍显示

## Scenario 4c — CW / Rating Boundary（review PR#134 BLOCKER 3）

- [ ] 批次含名册不完整的 CW 场（league=null 但 leagueMode=true）：该场仍是 CW UI——
      点击玩家打开 Drawer、Performance + facts 正常、Rating/七维显示 --、无伪造 MVP/战队 Rating

## Scenario 5 — 汇总结构（plan §26 S5）

- [ ] CW 汇总页只有：一个统一玩家主表 + 一个战队汇总表
- [ ] 不存在「基础玩家汇总表 + League 玩家汇总表」两张平级表
- [ ] 无 Rating 的玩家仍在统一表中（Rating/七维列显示 --，基础 facts 不丢）
- [ ] 统一表含 Contribution/KAST/Impact 列（可经 ColumnPicker 显示；null 显示 --，不显示 0%）
- [ ] 「场次」（解析场次）与「评分场次」分开显示，数值不同时明显可辨（如 12 场 / 8 场）

## Scenario 6 — 响应式（plan §26 S6）

- [ ] 1920px desktop：Table 全宽、Drawer 右滑约 360–380px、雷达完整
- [ ] 1366px desktop：同上
- [ ] ~11 英寸 tablet（约 834px）：Drawer 约 340px、Table 可横滚、sticky 不重叠
- [ ] iPhone 11 级（约 375px）：点击玩家 → 右侧 Drawer（约 92–96vw）、雷达 1:1 不截断、可关闭

## 回归 — Standard Replay（plan §27）

- [ ] 上传普通随机战回放：不显示 CW Rating / 雷达 / 战队表，AggregateTable 正常
- [ ] 所有可见列排序正常
- [ ] AI 复盘 / 战局回放不受影响

## 回归 — CW Eligibility（plan §28）

- [ ] 真实 fixtures（cw-training-15-14 / tournament-14-14）仍可评分（CI 已覆盖，人工抽查 1 份）

## 验收记录

| 场景 | 结果（PASS/FAIL） | 截图/备注 |
|---|---|---|
| S1 Sticky | | |
| S2 Computed Style | | |
| S3 排序 | | |
| S4 Drawer | | |
| S5 汇总结构 | | |
| S6 响应式 | | |
| Regression | | |