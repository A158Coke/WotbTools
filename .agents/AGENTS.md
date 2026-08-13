# AGENTS.md — AI coder 硬约定

**默认 caveman mode**：回复极简、砍废话、无寒暄。用户说"退出 caveman"才恢复正常。

项目：WoT Blitz `.wotbreplay` 提取 Excel + 排行榜。入口 `wotbtools.com`。

## 规则

1. **Plan-First** — 代码改动前先出 plan（范围/影响/风险），待用户批准后执行。Review-Fix 循环内部自动进行不需用户介入，但结束后必须出具可视化审查报告。
2. **Feature 流程** — 任何 feature 类或大范围改动必须：需求澄清（grill-me）→ 方案设计（plan-designer，自动前置 grill-me）→ 出 plan → 等待用户批准 → 执行 → Review-Fix 闭环 → 出具审查报告。未批准不得开始编码。小修小补（bug fix、CSS、i18n 缺漏）可跳过 plan 直接修。
3. **改动即更新文档** — 影响界面/导出/数据/构建的改动，同提交更新 CHANGELOG（技术变更）、CHANGELOG-PRODUCT（产品功能变更）、DEVELOPER_GUIDE、相关 README、`docs/current-plan.md`（任务状态）。
4. **跨层一致** — 列 key(snake_case) API/前端/导出三方一致。显示名前端三语 locale + 导出两处一致。
5. **API 纯英文** — 只回 key+数据，中文归前端/导出。
6. **提交前通过测试** — Java `mvn -s settings.xml test`(JAVA_HOME→JDK21)、前端 `npm run build`。
7. **Review-Fix 闭环** — 每次代码变更后反复审查（grep 残留、硬编码、未用 import、命名不一致、空值边界、并发安全），修复找到的问题，循环直到无新问题出现。详见 `.agents/skills/review-fix/SKILL.md`。
8. **构建隔离** — Maven `-s java/settings.xml`(Aliyun + 独立 `.m2repo`)。车辆库单源 `common/tankopedia.json`。
9. **Git** — SSH remote `github-personal`，账号 `A158Coke`。中文提交，尾带 `Co-Authored-By`。
10. **Domain 分包** — 后端 Java 包按业务 domain 拆分（`user/` `leaderboard/` `replay/` `boost/` `admin/`），每个 domain 含 `controller/` `service/` `entity/` `repository/` `dto/` 子包。禁止层分包（`com.wotb.web.controller/` `service/` 等）。共享工具类（`config/` `util/`）例外。
11. **跨站 Cookie** — 主题/语言偏好写 `domain=.wotbtools.com` Cookie，localStorage 回退。
12. **显式参数名** — `@RequestParam(name="x")` 必须写名字。
13. **Java final** — 局部变量、方法入参一律 `final`。
14. **三语 i18n** — 新增页面/文案必须在 zh/en/ru 三语字典同步，主题按钮不能硬编码。
15. **数据库迁移** — 改表结构必须新增 Flyway migration（`V3__...`），不改已应用的 V1/V2；实体列与迁移列逐列对齐。
16. **安全** — 不存密码/凭据；Keycloak JWT 验证不由后端自签；token/secret或环境变量 走 GitHub Secrets。
17. **分层调用** — Controller → Service → Repository。 Controller 只能调 Service（禁止直接调 Repository）。Service 只能调自己 domain 的 Repository 或其他 domain 的 Service（禁止 Service 跨 domain 调 Repository）。
18. **线上排障** — 部署后 502/启动失败，SSH 进 VPS：`ssh -i "$env:USERPROFILE\.ssh\wotb_vps_deploy" -o IdentitiesOnly=yes root@45.136.14.101 -p 58361`，`docker logs wotb-wotb-backend-1 --tail 100`。常见根因：循环依赖、Flyway 冲突、PG volume 不兼容。
19. **结尾签名** — 完成工作后回复末尾附带：我完成了喵
20. **临时代码标记** — 调试/测试用的临时日志、工具方法必须标注 `// TODO: remove after verification`，业务跑通后清理。Review-Fix 检查单包含临时代码残留检查。
21. **String 空值判断** — 字符串判空或 null 统一用 `org.springframework.util.StringUtils.hasText(s)`。禁止手写 `s == null || s.isBlank()`。例外：仅当项目内无处引用 Spring 的核心模块可保留手写。
22. **优先 Stream** — 集合遍历优先用 Java Stream（`map`/`filter`/`toList()` 等），不可行（如需要受检异常、多语句副作用）再回退 for-each。
23. **禁止 import \*** — 不准用 `import com.foo.*` 通配导入。必须显式逐类导入。
24. **使用 Mapper 替代 toXxx** — 禁止在 Service/Entity 中手写 `toDto()` / `toEntity()`。必须创建独立 Mapper 类（如 `UserMapper`），可用泛型接口 `Mapper<E, D>` 统一约束。DTO 转换集中在 Mapper 层，Service 只调 `mapper.toDto(entity)`。
25. **子代理完成确认** — spawn 子 agent/task 后必须显式验证完成状态：
    - `task_list` / `task_read` 检查 status=completed
    - `list_dir` 验证文件已移动到目标位置
    - `read_file` 验证关键文件内容正确
    不可假设子代理自动完成。失败/超时则手动修正或重新 spawn。
26. **子代理完成通知** — 子代理完成后以醒目格式通知用户：
    ```
    ═══════════════════════════════════
      ✅ task_xxx 完成（耗时 Ns）
      验证: <逐项结果>
    ═══════════════════════════════════
    ```
27. **大需求拆分** — 一次性遇到大/长需求的情况下，拆分需求计划为多个小任务。每个小任务专注一个目标。 然后每个小任务分配一个子代理完成。 主代理最后执行 review-fix skill。
28. **战局回放坦克标记** — 开发 AI Review 战局回放/地图标记时，默认复用 `frontend/src/assets/tank-icons/tank-marker-{hull,turret}.png` 的通用半立体 MT 双层模型，并遵循 `docs/assets/battle-replay/tank-marker-state-spec.png` 规范表与 `frontend/src/assets/tank-icons/README.md` 契约：车体按 `hullYaw` 旋转、炮塔按 `turretWorldYaw = hullYaw + turretRelativeYaw` 整体旋转，炮管不得脱离炮塔独立旋转；轨迹只代表历史位置不代表朝向。该契约为未来播放器接入准备（当前 BattlePlayback 仍为圆点标记，DTO 尚未提供方向字段）。禁止退化为普通圆点、重复生成坦克素材或绘制与现有资产风格不一致的新图标。

## 常用命令

```bash
cd java && JAVA_HOME=<jdk21> mvn -s settings.xml test      # 测试
cd frontend && npm run build                                 # 前端构建
cd docker/online && docker compose up -d --build             # 在线版(四容器: pg+keycloak+backend+frontend)
```

## 改动流程

### Phase 1: 需求 grill + Plan（需用户介入）
0. 需求边界不清 → 先走 **grill-me**（`.agents/skills/grill-me/SKILL.md`）：澄清目标/范围/非目标/验收标准/假设，输出《需求确认单》。
1. 方案设计 → **plan-designer**（`.agents/skills/plan-designer/SKILL.md`）：自动前置 grill-me 澄清需求，再结合文档与代码核对可落地性、影响面，输出开发方案。
2. 分析需求 → 确定改动范围、影响面、风险。
3. 输出 plan 并写入 `docs/current-plan.md`（文件清单 + 改动概要 + 风险评估）。
4. **等待用户审批**：批准 → 执行 / 修改重 plan / 拒绝 → 停止。

### Phase 2: Execute
5. 执行代码变更。
6. 跨层联动先走 **wotb-sync**（`.agents/wotb-sync.md`）。
7. 增删列额外走 **column-sync**（`.agents/skills/column-sync/SKILL.md`）。

### Phase 3: Review-Fix（自动闭环，不需用户介入）
8. 代码审查 → **review-fix**（`.agents/skills/review-fix/SKILL.md`）。
9. 影响界面/导出/数据/构建的变更 → 额外走 **review-with-docs**（`.agents/skills/review-with-docs/SKILL.md`）：CHANGELOG + DEVELOPER_GUIDE + README + i18n。
10. 自审 + spawn verifier 子 agent → 审查 → 修复 → 重审 → 循环到零问题。
11. 跑测试（规则 6）。

### Phase 4: Report
12. 输出**可视化审查报告**：变动文件/行数、审查轮次、发现问题数/修复数、测试结果；并更新 `docs/current-plan.md` 任务状态（IN PROGRESS → COMPLETED / BLOCKED）。
13. **提交**：review-with-docs 审查零 blocker 时允许直接提交并开 PR（无需再等用户指示）；
    存在 blocker/未闭环问题时等待用户审批后提交（规则 9）。
14. 深入背景见 [DEVELOPER_GUIDE.md](../docs/DEVELOPER_GUIDE.md)。
## 禁止

- 改 `target/` `node_modules/` `dist/` `.m2repo/` 内文件
- 按终端乱码判文件损坏
- API 塞中文
- 模块内放 tankopedia 副本
- 用公司 token/凭据
- 在付款/赞助页面或代码中硬编码个人收款信息

## Ponytail — 懒资深工程师模式

懒 = 高效，非马虎。最好的代码是没写的代码。先理解问题（读任务 + 读它触碰的代码 + 端到端追真实流程），再沿梯子往上爬，停在第一个成立的档：

1. 根本不用建？
2. 代码库已有？复用现成 helper/util/pattern，别重写。
3. 标准库能做？用它。
4. 平台原生特性覆盖？用它。
5. 已装依赖能解？用它。
6. 能一行？写成一行。
7. 都不行才写：能跑的最小代码。

**Bug fix = 根因非表象**：报告只给症状。grep 你要改的函数的所有调用方，在共享函数处修一次——一处 guard 比每个调用方各修一次的 diff 更小；只补 ticket 点名的那条路径会漏掉兄弟调用方。

规则：

- 不做没被明确要求的抽象；能免则免新依赖；不写没人要的样板。
- 删优于增，无聊优于炫技，文件数最少。
- 最短能跑的 diff 胜——但仅在理解问题之后。错位置的最小改动不是懒，是第二个 bug。
- 质疑复杂需求："你真需要 X，还是 Y 就够？"
- 两个标准库写法体量相同时选边界正确的那个——懒是少写代码，不是选更脆的算法。
- 故意抄近路、有已知天花板的简化（全局锁、O(n²) 扫描、朴素启发式）必须留 `ponytail:` 注释，写明天花板 + 升级路径。

**不许偷懒**：理解问题、信任边界的输入校验、防数据丢失的错误处理、安全、可访问性、真实硬件需要的校准、任何被明确要求的东西。带非平凡逻辑的懒代码必须留 ONE 可运行自检（assert 自检 demo 或一个小测试文件，无框架无 fixture）——最小的、逻辑坏了就会失败的东西。平凡一行无需测试。

（本规则同样约束你自己。）
