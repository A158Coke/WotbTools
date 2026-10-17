# common/ — 共享数据指令（单一来源数据目录）

> 仓库级硬约定见 `.agents/AGENTS.md`。本目录是**数据的单一来源**：Java 构建时经 `wotb-core/pom.xml` 复制到 classpath，前端经 vite 或 Dockerfile 复制 import——**禁止在模块内放副本**。

## 数据文件与更新方式（经真实文件核对）

- **车辆库**：`tankopedia-tier{1..10}.json`（10 个文件，无 `tankopedia.json`）。数据源 BlitzKit production definitions（`api.blitzkit.app/definitions/*.pb`）；`.github/workflows/update-tankopedia.yml` 与本地 `cd common/python && python update_tankopedia.py` 共用同一 production API source of truth；写入前有完整性门禁（总量/tier 骤降、重复 id、缺 id/name/hp/gun 即失败）。车型基础资料覆盖 1–10；物资/装备 reviewed 建模仍限 7–10，低级资料不声明未建模的 allowed* 列表。
- **搜索别名**：`tank_aliases.json`。**WotBTools 自己的搜索 metadata，不是游戏事实数据**：由开发者人工维护（不从 WoT-Blitz-Agent / BlitzKit / WG API / LLM / 社区 API 生成）。结构 `tank_id`（canonical 十进制字符串）→ 非空 alias 字符串数组，中英俄混排不按语言分桶（alias 用于 search recall，不是 localized display）。**稀疏存储**：没有 alias 的车辆直接不出现在文件里（缺 key == `aliases []`），禁止写 `[]` 占位；新车进 `tank_cache.json` **不需要**同步改这个文件。只扩坦克百科搜索召回，不进入车辆身份、显示名、排序名、导出或 API（Aliases affect discovery, never identity）。前端在构建期相对路径 `import`（`frontend/src/utils/tankopediaQuery.js`：`normalizeTankCache` 投影 `aliases` + `selectTanks` 取 `max(车名分, alias 分)`），Web 与 Android 内置前端同一份，**无后端接口 / 数据库 / 第二资产源**。契约由 `common/python/validate_tank_aliases.py` 与 `common/python/tests/test_validate_tank_aliases.py` fail closed 守卫（非法 JSON、重复 tank_id key、顶层非对象、非法/未知 tank_id、值非数组、空数组、alias 非字符串、空白 alias、同车重复 alias（大小写不敏感）→ CI 失败；**跨车重复只是 warning**——两辆车共用一个社区简称是合法的，由搜索相关度决定排序）。**tank_id 校验源是完整车辆名册 `tank_ids.json`**（见下条，覆盖全部 tier、CI 不联网），任何坦克百科车辆都能配 alias。**当前文件是空对象 `{}`（合法初始状态：0 条 alias）——架构已就位，alias 由开发者按需逐条录入。** 维护流程：查 tank_id → 编辑 JSON（id 已存在则追加 alias）→ `cd common/python && python validate_tank_aliases.py` → PR；**格式示例、查 tank_id 命令与被拒样例见 [`docs/architecture/tankopedia-reference-data.md`](../docs/architecture/tankopedia-reference-data.md) 的 “How to add an alias”**。
- **完整车辆名册**：`tank_ids.json`。**生成产物，禁止手改**：`tank_id` → 权威英文名，**覆盖全部 tier**（738 辆 @ 11.21.0.1235，车型基础资料同样覆盖 738）。由 `update_tankopedia.py:roster_payload` 在与 tier 文件**同一次 BlitzKit 稳定快照**、物资/装备范围过滤**之前**产出（meta 记录 `source_game_version` 与 tanks.pb 哈希），随 `update-tankopedia.yml` 一并拷回并提交。只含 id ↔ 名字：**不是属性来源**，车辆事实仍在 `tankopedia-tier*.json`（tier 1–10）与资产包 `tank_cache.json`（全 tier）。用途是需要离线按任意 `tank_id` 校验/查询的消费方（`tank_aliases.json` 的 validator 与其维护流程）。门禁：`validate_roster`（空名册 / 数量骤降 fail closed）+ `test_update_tankopedia.py:RosterTest`（tier 文件里每辆车必须在名册中同名出现，名册至少覆盖这些车辆；反向不断言——名册可能来自更新的快照）。
- **成员技能**：`crew-skills.json`。数据源 BlitzKit `assets.blitzkit.app/definitions/skills.pb`（`SkillDefinitions`：车型 class → canonical skill id）；更新走 `.github/workflows/update-crew-skills.yml`（手动触发，自动提交）或本地 `python common/python/update_crew_skills.py`。当前仅落档 BlitzKit 明确提供的车型归属、skill id 与可推导 icon URL，不猜测显示名/描述/效果数值；写入前校验四个车型、每类最小技能数、id 格式与重复项。**车型归属只表示训练资格：必须使用对应类型车辆训练该类技能；技能一旦训练，其加成对所有车辆生效，消费端禁止按当前车辆类型过滤已训练技能效果。WotBTools 默认所有成员技能均已训练至 7 级（满级），任何技能效果/属性计算一律使用该技能的最高档加成，不做 1–6 级缩放。** `crew-skills.json.semantics` 固定记录 `trainingEligibility=class_specific`、`effectScope=all_vehicles`、`defaultSkillLevel=7`、`maxSkillLevel=7` 与 `effectValuePolicy=use_max_level_bonus`，修改这些语义必须显式 review。
- ~~**射击本地参数** `shot-tank-data.json`~~：**已退役（2026-10-15）**——射击检视的搭载输入与弹种表改为运行期直读资产包（`tank/{id}.json` 紧凑投影 + `/data/shellKinds.json`，经 assetProvider），数据随上游包更新，不再内嵌进前端构建、不再需要快照更新脚本。
- **地图三语名** `map_names.json`：内部名(小写) → {zh,en,ru}；客户端导出层 `frontend/src/replay-local/export/format.ts` 的 `mapNameCn()`（固定中文）与前端 `frontend/src/utils/helpers.js` 的 `mapLabel()`（按 locale）**同源读这一份**。
- **地图语义** `map-semantics/*.semantic.json`：由 `map-semanticizer/` 生成（覆盖式）；**已人工核验的地图严禁整份重跑语义化器**（会覆盖手工修正），改语义 JSON 时同步 `docs/reference/maps.md` 与 `MapTacticalSemanticsRegistryTest` 断言。
- **坦克战术画像** `tank_tactical_profiles.json`：AI 复盘注入用；十级车全覆盖有回归测试守卫。
- `assets/`（logo/图标/silent-check-sso.html）：Vite 的 `publicDir` 直接指向 `common/assets`；`docker/Dockerfile.frontend` 构建时复制共享资源，最终 nginx 站点额外放置 logo / 图标，不维护 homepage 副本。

## 回放样本边界

- `fixtures/replays/*.wotbreplay`：**提交入库**的夹具（CI 无条件执行）。
- `data/`（gitignored）：本地扩展样本。重复场次/单练/特殊样本放 `data/` 子目录，避免与提交入库的 `fixtures/replays/*.wotbreplay` 夹具（CI 无条件执行）及客户端 golden 基线（`frontend/src/replay-local/__golden__/`）冲突；是否消费本地样本由具体测试 / probe 显式决定，不假定存在自动递归发现入口。
- 本地私人回放绝不提交进仓库。
