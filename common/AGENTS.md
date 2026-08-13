# common/ — 共享数据指令（单一来源数据目录）

> 仓库级硬约定见 `.agents/AGENTS.md`。本目录是**数据的单一来源**：Java 构建时经 `wotb-core/pom.xml` 复制到 classpath，前端经 vite 或 Dockerfile 复制 import——**禁止在模块内放副本**。

## 数据文件与更新方式（经真实文件核对）

- **车辆库**：`tankopedia-tier{7,8,9,10}.json`（4 个文件，无 `tankopedia.json`）。数据源 blitzkit（`assets.blitzkit.app/definitions/*.pb`）；更新走 `.github/workflows/update-tankopedia.yml`（手动触发，自动提交）或本地 `cd common/python && python update_tankopedia.py`；写入前有完整性门禁（总量/tier 骤降、重复 id、缺 id/name/hp/gun 即失败）。
- **评分参数** `rating.json`：改数值（权重/系数/阈值/车型系数）只改此文件；改公式结构才动 `wotb-core` 的 `Rating.java`。
- **地图三语名** `map_names.json`：内部名(小写) → {zh,en,ru}；导出端 `MapNames.cn()` 与前端 `mapLabel()` 共用。
- **地图语义** `map-semantics/*.semantic.json`：由 `map-semanticizer/` 生成（覆盖式）；**已人工核验的地图严禁整份重跑语义化器**（会覆盖手工修正），改语义 JSON 时同步 `docs/map-catalog.md` 与 `MapTacticalSemanticsRegistryTest` 断言。
- **坦克战术画像** `tank_tactical_profiles.json`：AI 复盘注入用；十级车全覆盖有回归测试守卫。
- `assets/`（logo/图标/silent-check-sso.html）：Dockerfile 构建时复制到 homepage + frontend/public。

## 回放样本边界

- `fixtures/replays/*.wotbreplay`：**提交入库**的夹具（CI 无条件执行）。
- `data/`（gitignored）：本地扩展样本。**ParityTest 对 data 根目录每个样本断言 14 名玩家且场次唯一**——重复场次/单练/特殊样本放 `data/` 子目录（探针会递归发现，ParityTest 非递归不受影响）。
- 本地私人回放绝不提交进仓库。