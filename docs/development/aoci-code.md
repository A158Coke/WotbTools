# AOCI-CODE 接入与认知索引维护

> 本文是外部工具 AOCI-CODE 的本仓库接入操作入口，**不是** AOCI Whole-Index，也不代表仓库已完成 AOCI 初始化。仓库源码、测试、配置和现有 canonical 文档仍是事实来源。AOCI 只提供可追溯的 AI 认知索引，不取代它们。

## 权威与适用范围

- AOCI-CODE 官方仓库：https://github.com/aoci-spec/aoci-code
- 官方中文操作与格式规范：https://github.com/aoci-spec/aoci-code/blob/main/README.zh-CN.md
- WotBTools 现有开发入口：`docs/DEVELOPER_GUIDE.md`、`.agents/AGENTS.md`、相关目录 `AGENTS.md`、`docs/README.md`。
- 不另建项目架构或协议的第二事实源；AOCI 条目必须由源码、测试、配置和必要的现有文档佐证。与源码冲突时以实际代码和测试为准，并在同一次变更中修正漂移。
- 本文仅说明工具操作和验证边界。AOCI 的协议、文件格式、FRAS 约束及恢复语义以所安装版本的可执行契约和官方文档为准，不在本仓库复制一份可漂移规范。

## 首次接入（维护者本地执行）

在受信任的维护机器上完成安装，不把本机二进制或绝对路径提交到 Git：

1. 从官方 GitHub Releases 取得适合当前操作系统的发布包，按发布页的安装指南验证；或者从官方源码构建。使用稳定的二进制绝对路径，并记录实际 `--version`。不要假设 README 中的版本就是本机安装版本。
2. 在 WotBTools 仓库根目录，先确认工作树状态、当前分支和现有 `AGENTS.md` / MCP 配置。初始化会修改宿主规则或配置，必须查看 diff，不能覆盖既有 Designer / Executor / Review 合同。
3. 按当前宿主选择 `--agent`。例如 Codex： 

   ```bash
   /absolute/path/to/aoci --repo . init --locale zh-CN --agent codex
   /absolute/path/to/aoci --repo . scan
   ```

   使用 Claude Code、Cursor 或 OpenCode 时，按照对应官方宿主指南选择 agent 配置。Windows PowerShell 中用实际的 `aoci.exe` 绝对路径替换示例路径。
4. `init` / `scan` 后检查 Git diff 与忽略规则。应纳入 Git 的治理资产通常包括 `aoci.txt`、`aoci.meta.txt`、`aoci.code.txt`、`.aoci/config.json`、`.aoci/baseline.json` 及按需的 `.aoci/curation.json`。不要把它们放进 `.gitignore` 或 `.git/info/exclude`。以工具生成的实际资产清单为准。
5. 宿主 MCP 配置包含本机绑定的绝对路径（如 `.mcp.json`、`.codex/config.toml`、`opencode.json` 等），应忽略而非提交。**修改仓库已有的同名配置之前先核对并保留原有条目**，不得为了接入 AOCI 覆盖其他 MCP 或项目配置。
6. 重启/刷新 Agent 会话，确认当前宿主连接的 AOCI MCP 指向本仓库。仅在 MCP 真正连接后，让 Agent 按官方 Guide 读取真实源码、测试、配置和当前文档，并建立索引。不要手写虚假的 FRAS 条目，也不要仅凭文件名生成业务职责。

## WotBTools 的索引证据边界

建索引时优先实查这些事实来源，而非从旧架构故事推断当前系统：

- 客户端回放解析、WASM、2D/3D：实际源码、`deploy/agent/source.json`、`docs/architecture/replay-pipeline.md` 与相应测试。
- Java Business Backend、AI Service 与 HTTP 契约：对应源码、OpenAPI / runtime schema、集成测试和 `docs/architecture/`。
- Keycloak / PostgreSQL / OpenTofu / Komodo：声明式配置、迁移、部署边界、`docs/operations/` 和可获得的验证证据。运行时事实不得只凭仓库文件声称已验证。
- Android、前端 UI：对应源码、行为契约、设备/浏览器测试与 `docs/android/`、`docs/frontend/`。
- 数据库索引 `aoci.database.txt` 是**可选项**，必须先确认当前工具对目标 PostgreSQL 的支持、授权和只读访问边界；不能把生产凭据或表数据写进 Git。

## 验证与日常维护

初次建立 Whole-Index 后在本机运行：

```bash
/absolute/path/to/aoci --repo . verify
/absolute/path/to/aoci --repo . check
/absolute/path/to/aoci --repo . doctor
```

验收必须能独立观察到：MCP 所报 `runtime_repository_root` 与当前仓库一致；当前工具版本和宿主配置一致；索引覆盖声明的 Managed Scope；`verify` / `check` 的终态为 `aligned`；没有悬而未决的恢复或漂移状态。若未对齐，先读取当前版本的实时 Guide 并排查，不通过手改基线、强行 `scan --force` 或跳过失败来制造绿色结果。

此后 AI Agent 修改受管源码、配置或测试且验证稳定后，按照 AOCI MCP 当前 Guide 增量维护受影响条目。索引更新是开发收尾的一部分，但不能取代既有 CI、测试、Designer 审批、Review 或生产实测。PR 中同时审查受影响的索引与源码差异；独立验证依然以真实测试/构建/行为证据为准。

## 回滚

接入前记录 Git 工作树与宿主 MCP 配置的原状。若仅本地初始化尚未提交，按实际 diff 分别恢复 AOCI 生成文件和宿主配置，避免删除原有 `AGENTS.md` 内容或第三方 MCP 设置。若索引已由 Git 提交，通过正常 revert 恢复版本化资产；宿主级二进制/绝对路径配置需在各维护机器上单独撤销。存在 AOCI 未完成的事务或 Recovery 状态时，必须先按该版本实时 Guide 恢复，不能直接删除状态目录来掩盖未完成写入。
