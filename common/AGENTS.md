# common/ — 共享数据指令（单一来源数据目录）

> 仓库级硬约定见 `.agents/AGENTS.md`。本目录是**数据的单一来源**：Java 构建时经 `wotb-core/pom.xml` 复制到 classpath，前端经 vite 或 Dockerfile 复制 import——**禁止在模块内放副本**。

## 数据文件与更新方式（经真实文件核对）

- **车辆库**：`tankopedia-tier{7,8,9,10}.json`（4 个文件，无 `tankopedia.json`）。数据源 blitzkit（`assets.blitzkit.app/definitions/*.pb`）；更新走 `.github/workflows/update-tankopedia.yml`（手动触发，自动提交）或本地 `cd common/python && python update_tankopedia.py`；写入前有完整性门禁（总量/tier 骤降、重复 id、缺 id/name/hp/gun 即失败）。
- **成员技能**：`crew-skills.json`。数据源 BlitzKit `assets.blitzkit.app/definitions/skills.pb`（`SkillDefinitions`：车型 class → canonical skill id）；更新走 `.github/workflows/update-crew-skills.yml`（手动触发，自动提交）或本地 `python common/python/update_crew_skills.py`。当前仅落档 BlitzKit 明确提供的车型归属、skill id 与可推导 icon URL，不猜测显示名/描述/效果数值；写入前校验四个车型、每类最小技能数、id 格式与重复项。**车型归属只表示训练资格：必须使用对应类型车辆训练该类技能；技能一旦训练，其加成对所有车辆生效，消费端禁止按当前车辆类型过滤已训练技能效果。WotBTools 默认所有成员技能均已训练至 7 级（满级），任何技能效果/属性计算一律使用该技能的最高档加成，不做 1–6 级缩放。** `crew-skills.json.semantics` 固定记录 `trainingEligibility=class_specific`、`effectScope=all_vehicles`、`defaultSkillLevel=7`、`maxSkillLevel=7` 与 `effectValuePolicy=use_max_level_bonus`，修改这些语义必须显式 review。
- **地图三语名** `map_names.json`：内部名(小写) → {zh,en,ru}；导出端 `MapNames.cn()` 与前端 `mapLabel()` 共用。
- **地图语义** `map-semantics/*.semantic.json`：由 `map-semanticizer/` 生成（覆盖式）；**已人工核验的地图严禁整份重跑语义化器**（会覆盖手工修正），改语义 JSON 时同步 `docs/reference/maps.md` 与 `MapTacticalSemanticsRegistryTest` 断言。
- **坦克战术画像** `tank_tactical_profiles.json`：AI 复盘注入用；十级车全覆盖有回归测试守卫。
- `assets/`（logo/图标/silent-check-sso.html）：Dockerfile 构建时复制到 homepage + frontend/public。

## 回放样本边界

- `fixtures/replays/*.wotbreplay`：**提交入库**的夹具（CI 无条件执行）。
- `data/`（gitignored）：本地扩展样本。**ParityTest 对 data 根目录每个样本断言 14 名玩家且场次唯一**——重复场次/单练/特殊样本放 `data/` 子目录（探针会递归发现，ParityTest 非递归不受影响）。
- 本地私人回放绝不提交进仓库。
