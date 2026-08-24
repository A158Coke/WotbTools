# CW Rating UI 收口 — 浏览器验收清单（plan §26）

> 由人工在真实浏览器执行（happy-dom 无法证明 sticky layout）。建议最新 Chrome，登录后
> 访问 wotbtools.com 的回放解析页上传 CW 回放。测试样本：
> 30+ 份训练赛/联赛回放（common/data/34冠军赛回放/ 目录有真实样本，可一次全选）。
>
> 分支：feat/replay-cw-rating-ui-closeout（部署后此清单适用；本地可 cd frontend && npm run dev 联调后端验证）。

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

## Scenario 4 — 选手 Drawer（plan §26 S4）

- [ ] 默认 Table 占满宽度、右侧无面板
- [ ] 点击汇总表任意玩家 → 右侧 Drawer 滑出
- [ ] Drawer 含：昵称/战队、Rating、七维雷达（7 轴）、场次/胜率/场均伤害/助攻/击杀/获取点数/场
- [ ] 点击另一玩家 → Drawer 不关闭、内容即时切换
- [ ] × 按钮 / 点击遮罩 / Escape 三种方式均可关闭
- [ ] 关闭后 Table 恢复完整宽度（不 permanent 缩窄）
- [ ] 单场 BattleTable 点击玩家同样打开 Drawer（本场七维 + 本场表现 + 获取点数）
- [ ] 排序后 Drawer 仍指向原玩家（按 accountId，不串行）

## Scenario 5 — 汇总结构（plan §26 S5）

- [ ] CW 汇总页只有：一个统一玩家主表 + 一个战队汇总表
- [ ] 不存在「基础玩家汇总表 + League 玩家汇总表」两张平级表
- [ ] 无 Rating 的玩家仍在统一表中（Rating/七维列显示 --，基础 facts 不丢）

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