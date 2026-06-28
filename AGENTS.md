# AGENTS.md — AI coder 硬约定

**默认 caveman mode**：回复极简、砍废话、无寒暄。用户说"退出 caveman"才恢复正常。

项目：WoT Blitz `.wotbreplay` 提取 Excel + 排行榜。入口 `wotbtools.com`。

## 规则

1. **改动即更新文档** — 影响界面/导出/数据/构建的改动，同提交更新 CHANGELOG、DEVELOPER_GUIDE、相关 README。
2. **跨层一致** — 列 key(snake_case) API/前端/导出三方一致。显示名前端三语 locale + 导出两处一致。
3. **API 纯英文** — 只回 key+数据，中文归前端/导出。
4. **提交前通过测试** — Java `mvn -s settings.xml test`(JAVA_HOME→JDK21)、前端 `npm run build`。
5. **构建隔离** — Maven `-s java/settings.xml`(Aliyun + 独立 `.m2repo`)。车辆库单源 `common/tankopedia.json`。
6. **Git** — SSH remote `github-personal`，账号 `A158Coke`。中文提交，尾带 `Co-Authored-By`。
7. **跨站 Cookie** — 主题/语言偏好写 `domain=.wotbtools.com` Cookie，localStorage 回退。
8. **显式参数名** — `@RequestParam(name="x")` 必须写名字。
9. **Java final** — 局部变量、方法入参一律 `final`。
10. **三语 i18n** — 新增页面/文案必须在 zh/en/ru 三语字典同步，主题按钮不能硬编码。
11. **数据库迁移** — 改表结构必须新增 Flyway migration（`V3__...`），不改已应用的 V1/V2；实体列与迁移列逐列对齐。
12. **安全** — 不存密码/凭据；Keycloak JWT 验证不由后端自签；token/secret 走 GitHub Secrets。

## 常用命令

```bash
cd java && JAVA_HOME=<jdk21> mvn -s settings.xml test      # 测试
cd frontend && npm run build                                 # 前端构建
cd docker/online && docker compose up -d --build             # 在线版(四容器: pg+keycloak+backend+frontend)
```

## 改动流程

跨层联动（增删列/改解析/改评分）先走 `.agents/wotb-sync.md` 检查单。
深入背景见 [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)。

## 禁止

- 改 `target/` `node_modules/` `dist/` `.m2repo/` 内文件
- 按终端乱码判文件损坏
- API 塞中文
- 模块内放 tankopedia 副本
- 用公司 token/凭据
- 在付款/赞助页面或代码中硬编码个人收款信息
