# 管理页设计契约验收

2026-11-27 在 Windows 的 Chrome 158 上对照管理导航、视图注册表和本地 API 夹具核验了 8 个入口。修复前基线为 `de76b12b956ae2b9c067241f0b3eb2bf90b60df5`。目录内对照图左侧为基线，右侧为修复后的同一操作。表中的结论限于列出的断言与场景。[Issue #808 及方案](https://github.com/A158Coke/WotbTools/issues/808) · [规则原文](../../../frontend/design-language.md)

## 页面、规则与证据

命令在 `frontend` 下运行。用户、战斗数据及反馈使用 `wotbtools-admin`，名人堂专项使用 `HoF-admin`，赛事使用 `tournament-admin`，推荐配置使用 `content-admin`。所有写操作均由本地夹具处理。

| 入口 | 规则 | 数据、操作与结论 | 复验入口 |
|---|---|---|---|
| 用户管理 | DC-ARC-03、SEL-01、STA-02/03/04、FOC-02 | 身份源、页码、条数和列表依据同一成功响应更新。验证未提交输入、查询失败及乱序。27 个用户分两页，首页全选后翻页，用第二页两人执行取消、确认、部分失败和重试，重试只带失败 ID。已修复并验证。 | `test:browser-admin-directory`、`AdminUsersPage.*.test.js`、[对照](admin-users.webp) |
| 战斗数据 | DC-SEL-01/03/07、ARC-03、STA-03、FOC-02 | 29 张已审地图，可按本地化名称或原 key 查找。1280 像素宽时在地图选项与表格的重叠处用鼠标选择，核对实际命中元素和选中值。键盘选择、收起、无结果、默认日期、未知地图、平局 0、分页、旧响应与请求中编辑均有断言。删地图芯片只发送成功快照中的其余条件。已修复并验证。 | `test:browser-battle-data`、`BattleDataAdminPage.test.ts`、`SearchableSelect.test.ts`、[对照](battle.webp) |
| AI 复盘反馈 | DC-SEL-02、STA-02/03/04、FOC-02 | 两态行内控件只在更新或回读成功后显示新状态。验证 PATCH 拒绝、重试、详情、删除取消零写入，取消回到删除按钮，删除第二页最后记录后焦点回到列表区域。 | `test:browser-admin-directory`、`AdminAiReviewFeedbackPage.test.js`、[对照](admin-ai-review-feedback.webp) |
| 站点反馈 | DC-SEL-02、STA-02/03/04、FOC-02 | 在独立站点反馈 endpoint 上重复翻页、状态更新、详情、取消和确认删除。检查行内操作不会误开详情，以及回读失败、其他记录的迟到响应。 | `test:browser-admin-directory`、`AdminSiteFeedbackPage.test.js`、[对照](admin-site-feedback.webp) |
| 名人堂管理 | DC-SEL-01/03/04、ARC-03/08、OCC、FOC-02、STA-03/04 | 单场 12 辆夹具车，百场/三环各 85 辆。选车只查询一次，手机在筛选面板操作。单场验证下载、删除和取消，百场与三环各连续审批两份记录，缺少回放不能通过。操作后按记录返焦。Tier 和单场三处双项下拉沿用契约和 `selection-policy.test.ts` 登记的例外。导航计数见下文。 | `test:browser-hof-admin-tabs`、`test:browser-hof-pending`、`HoFAdminPage.test.js`、[对照](hof.webp) |
| 赛事积分配置 | DC-SEL-03、OCC、FOC-02、STA-03/04 | 12 项赛事，含全局默认选项。分别验证编辑矩阵、保存、设默认的取消与确认、锁定轮次。小屏逐一滚入规则输入并检查五点命中。 | `test:browser-tournament-admin`、`TournamentPointsConfigPage.test.ts`、[对照](tournament-points-config.webp) |
| 赛事录分 | DC-SEL-03、STA-02/03/04、FOC-02、OCC | 在 12 个候选军团中搜索，验证清分取消、原因清空及返焦。导入预览后取消和确认分别检查实际写入，并核对发布使用的版本及幂等键。 | `test:browser-tournament-admin`、`TournamentPointsAdminPage.test.ts`、[对照](tournament-points-admin.webp) |
| 推荐配置 | DC-STA-02/03/04、FRM-04/05、ARC-01/08 | UP 和 VIDEO 切换、脏草稿取消保留、保存失败与重试、独立角色边界和四季基础结构通过。复用现有业务实现。 | `test:browser-creators summer-content-lifecycle summer-videos-390 winter-videos-1440 summer-1440`、`CreatorsConfigPage.test.ts` |

`RatingV2AdminPage` 在基线导航与注册表中均无入口。

## 角色、四季及视口

- `test:browser-admin-contract` 覆盖匿名、普通用户、四种独立管理员角色和组合角色。56 条深链中 17 条允许、39 条拒绝。拒绝时，29 条未请求管理 API，另 10 条仅因用户具备 HoF 权限而发出两条全局待审采样请求。14 组桌面和抽屉的入口集合均与夹具角色相符。
- 对全部入口分别验证 360×740、412×839、390×664、375×553、844×340 粗指针，以及 900 和 1280 宽。五个小屏视口使用各自的安全区，按滚动位置检查可见控件。修复覆盖规则输入的保存栏、短横屏名人堂吸顶区和用户表头后，56 个入口及尺寸组合通过。滚区反例检查裁切内的控件、滚入后的命中和真实遮挡。
- 8 个入口在相同桌面尺寸分别切换四季，并读取 `data-ui-profile`、标题、控件顺序和主按钮。32 个组合均有单个标题，操作在紧凑横幅之外。用户页、战斗页、赛事规则和推荐配置各有一个填充主按钮，其余默认根视图未呈现此类按钮。模态内的行为由各专项脚本验证。
- DC-THM-05/07、CLR-01 的证据包括四季真实资产与玻璃表面的色彩测试、实际渲染的管理横幅标题及短标签取样。在 390 和 1280 宽、四季和八入口共 64 组场景中，隐藏文字后按文字范围采样背景最差像素，与前景按 WCAG 相对亮度计算。使用普通字 4.5、大字 3 的门槛。修复前寒冬手机存在低至 1.08 的短标签，修复后 64 组均达标。横幅、地图和管理状态的长期断言分别在 `test:browser-showcase-hero`、`test:browser-battle-data` 和 `test:browser-admin-directory`。

## 待审计数与本地后端

[查看图标侧栏与手机抽屉对照](hof-pending.webp)。在真实 AppShell 中验收展开侧栏、900 宽图标侧栏、390/360 手机和 844×340 横屏抽屉。后台按 `status=PENDING&page=1&size=1` 各读百场和三环一次。7 + 5 显示 12，双零收起数字，大于 99 显示 99+ 并在可访问名称中保留完整数字。抽屉关闭后返焦菜单。确认审核后离开页面，再放行夹具的 POST 响应，导航更新为 11，写入次数为一次。`useHofPendingCount.test.ts` 和 HoF API 测试另覆盖失败、失权冻结、换号、过时响应、超时及 Android 静默读取。

本地成本试验使用该基线的 Spring MVC、安全过滤链、`ROLE_HoF-admin` 测试身份、Flyway 和 PostgreSQL 18 Testcontainer。两表分别插入 7/5 条待审记录，并各混入一条 CURRENT 和 REJECTED。每个截图列写入 439,626 字节的 PNG data URL。每端点采样三次，200 响应均只有一条摘要。Hibernate 每次执行一条带截图列的实体分页查询及一条 COUNT。

| 端点 | totalItems | HTTP 正文字节 | 本机三次请求耗时（毫秒，按执行顺序） |
|---|---:|---:|---|
| 百场 | 7 | 448 | 1206.16、59.08、60.43 |
| 三环 | 5 | 548 | 100.17、80.27、110.45 |

两次查询没有跨接口事务。上述成本来自小规模本地数据，生产分布、并发和延迟仍需线上观测。浏览器结果来自 Chromium 仿真，Safari、GeckoView 与真实软键盘未作真机验收。
