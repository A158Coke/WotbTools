# AGENTS.md — AI coder 硬约定

**默认 caveman mode**：回复极简、砍废话、无寒暄。用户说"退出 caveman"才恢复正常。

项目：WoT Blitz `.wotbreplay` 提取 Excel + 排行榜。入口 `wotbtools.com`。

## 规则

0. **Plan-First** — 代码改动前先出 plan（范围/影响/风险），待用户批准后执行。Grill-Fix 循环内部自动进行不需用户介入，但结束后必须出具可视化审查报告。
0. **Feature 流程** — 任何 feature 类或大范围改动必须：出 plan → 等待用户批准 → 执行 → Grill-Fix 闭环 → 出具审查报告。未批准不得开始编码。小修小补（bug fix、CSS、i18n 缺漏）可跳过 plan 直接修。
1. **改动即更新文档** — 影响界面/导出/数据/构建的改动，同提交更新 CHANGELOG、DEVELOPER_GUIDE、相关 README。
2. **跨层一致** — 列 key(snake_case) API/前端/导出三方一致。显示名前端三语 locale + 导出两处一致。
3. **API 纯英文** — 只回 key+数据，中文归前端/导出。
4. **提交前通过测试** — Java `mvn -s settings.xml test`(JAVA_HOME→JDK21)、前端 `npm run build`。
5. **Grill-Fix 闭环** — 每次代码变更后反复审查（grep 残留、硬编码、未用 import、命名不一致、空值边界、并发安全），修复找到的问题，循环直到无新问题出现。详见 `.agents/skills/grill-fix/SKILL.md`。
6. **构建隔离** — Maven `-s java/settings.xml`(Aliyun + 独立 `.m2repo`)。车辆库单源 `common/tankopedia.json`。
7. **Git** — SSH remote `github-personal`，账号 `A158Coke`。中文提交，尾带 `Co-Authored-By`。
8. **Domain 分包** — 后端 Java 包按业务 domain 拆分（`user/` `leaderboard/` `replay/` `boost/` `admin/`），每个 domain 含 `controller/` `service/` `entity/` `repository/` `dto/` 子包。禁止层分包（`com.wotb.web.controller/` `service/` 等）。共享工具类（`config/` `util/`）例外。
9. **跨站 Cookie** — 主题/语言偏好写 `domain=.wotbtools.com` Cookie，localStorage 回退。
10. **显式参数名** — `@RequestParam(name="x")` 必须写名字。
11. **Java final** — 局部变量、方法入参一律 `final`。
12. **三语 i18n** — 新增页面/文案必须在 zh/en/ru 三语字典同步，主题按钮不能硬编码。
13. **数据库迁移** — 改表结构必须新增 Flyway migration（`V3__...`），不改已应用的 V1/V2；实体列与迁移列逐列对齐。
14. **安全** — 不存密码/凭据；Keycloak JWT 验证不由后端自签；token/secret或环境变量 走 GitHub Secrets。
15. **分层调用** — Controller → Service → Repository。 Controller 只能调 Service（禁止直接调 Repository）。Service 只能调自己 domain 的 Repository 或其他 domain 的 Service（禁止 Service 跨 domain 调 Repository）。
16. **线上排障** — 部署后 502/启动失败，SSH 进 VPS：`ssh -i "$env:USERPROFILE\.ssh\wotb_vps_deploy" -o IdentitiesOnly=yes root@45.136.14.101 -p 58361`，`docker logs wotb-wotb-backend-1 --tail 100`。常见根因：循环依赖、Flyway 冲突、PG volume 不兼容。
17. **结尾签名** — 完成工作后回复末尾附带：我完成了喵
18. **临时代码标记** — 调试/测试用的临时日志、工具方法必须标注 `// TODO: remove after verification`，业务跑通后清理。Grill-Fix 检查单包含临时代码残留检查。
19. **String 空值判断** — 字符串判空或 null 统一用 `org.springframework.util.StringUtils.hasText(s)`。禁止手写 `s == null || s.isBlank()`。例外：仅当项目内无处引用 Spring 的核心模块可保留手写。
20. **优先 Stream** — 集合遍历优先用 Java Stream（`map`/`filter`/`toList()` 等），不可行（如需要受检异常、多语句副作用）再回退 for-each。
21. **禁止 import \*** — 不准用 `import com.foo.*` 通配导入。必须显式逐类导入。
22. **使用 Mapper 替代 toXxx** — 禁止在 Service/Entity 中手写 `toDto()` / `toEntity()`。必须创建独立 Mapper 类（如 `UserMapper`），可用泛型接口 `Mapper<E, D>` 统一约束。DTO 转换集中在 Mapper 层，Service 只调 `mapper.toDto(entity)`。
23. **子代理完成确认** — spawn 子 agent/task 后必须显式验证完成状态：
    - `task_list` / `task_read` 检查 status=completed
    - `list_dir` 验证文件已移动到目标位置
    - `read_file` 验证关键文件内容正确
    不可假设子代理自动完成。失败/超时则手动修正或重新 spawn。
24. **子代理完成通知** — 子代理完成后以醒目格式通知用户：
    ```
    ═══════════════════════════════════
      ✅ task_xxx 完成（耗时 Ns）
      验证: <逐项结果>
    ═══════════════════════════════════
    ```

## 常用命令

```bash
cd java && JAVA_HOME=<jdk21> mvn -s settings.xml test      # 测试
cd frontend && npm run build                                 # 前端构建
cd docker/online && docker compose up -d --build             # 在线版(四容器: pg+keycloak+backend+frontend)
```

## 改动流程

### Phase 1: Plan（需用户介入）
1. 分析需求 → 确定改动范围、影响面、风险。
2. 输出 plan（文件清单 + 改动概要 + 风险评估）。
3. **等待用户审批**：批准 → 执行 / 修改重 plan / 拒绝 → 停止。

### Phase 2: Execute
4. 执行代码变更。
5. 跨层联动先走 **wotb-sync**（`.agents/wotb-sync.md`）。
6. 增删列额外走 **column-sync**（`.agents/skills/column-sync/SKILL.md`）。

### Phase 3: Grill-Fix（自动闭环，不需用户介入）
7. 代码审查 → **grill-fix**（`.agents/skills/grill-fix/SKILL.md`）。
8. 影响界面/导出/数据/构建的变更 → 额外走 **grill-with-docs**（`.agents/skills/grill-with-docs/SKILL.md`）：CHANGELOG + DEVELOPER_GUIDE + README + i18n。
9. 自查 + spawn verifier 子 agent → 审查 → 修复 → 重审 → 循环到零问题。
10. 跑测试（规则 4）。

### Phase 4: Report
11. 输出**可视化审查报告**：变动文件/行数、grill 轮次、发现问题数/修复数、测试结果。
12. **等待用户审批后提交**（规则 7）。
13. 深入背景见 [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)。

## 禁止

- 改 `target/` `node_modules/` `dist/` `.m2repo/` 内文件
- 按终端乱码判文件损坏
- API 塞中文
- 模块内放 tankopedia 副本
- 用公司 token/凭据
- 在付款/赞助页面或代码中硬编码个人收款信息
