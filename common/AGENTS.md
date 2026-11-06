# common/ — 共享数据指令（单一来源数据目录）

> 仓库级硬约定见 `.agents/AGENTS.md`。
> **何时必读本文件**：改动 `common/` 下任何数据文件、JSON 结构、校验脚本，
> 或新增消费这些数据的代码时。

## 硬约束（不可协商）

- 本目录是**数据的单一来源**：Java 构建时经 `wotb-core/pom.xml` 复制到 classpath，
  前端经 vite 或 Dockerfile 复制 import——**禁止在模块内放副本**。
- 本目录在 `frontend/` 之外，**Vite 不监听**：重新导出后必须重启 `pnpm run dev`；
  资产包由 `serve_asset_pack.mjs` 直接读磁盘，替换后刷新即可。
- `tank_ids.json` 是**生成产物，禁止手改**（由 `update_tankopedia.py:roster_payload`
  产出，随 `update-tankopedia.yml` 提交）。
- `map-semantics/*.semantic.json` 由 `map-semanticizer/` 覆盖式生成：
  **已人工核验的地图严禁整份重跑语义化器**（会覆盖手工修正）。
- `tank_aliases.json`：**稀疏存储**——没有 alias 的车辆不出现（缺 key == `aliases []`），
  禁止写 `[]` 占位；更新必须保留已有手工别名，不能用新快照整份覆盖。
- 乘员语义分域不得互相套用：`crew-skills.json`（回放/AI，默认全部 7 级）与
  资产包 `skills.json`（配置器 0–7，默认 0）是两套口径；
  `crew-skills.json.semantics` 固定字段值的修改必须显式 review。
- `fixtures/replays/*.wotbreplay` 提交入库、CI 无条件执行；
  本地私人回放绝不提交；本地扩展样本放 gitignored `data/` 子目录，
  不假定存在自动递归发现入口。
- 数据文件更新一律走 `.github/workflows/update-*.yml` 或
  `common/python/update_*.py`，经 `scripts/ci/publish-data-update.sh` 发布 PR；
  车辆库数据源只认 BlitzKit production definitions，写入前完整性门禁 fail closed。

## 数据文件 → canonical 文档

| 文件 | 事实/细节 canonical 出处 |
|---|---|
| `tankopedia-tier{1..10}.json` / `tank_ids.json` / `tank_aliases.json` | [`docs/architecture/tankopedia-reference-data.md`](../docs/architecture/tankopedia-reference-data.md)（roster、alias 维护流程「How to add an alias」） |
| 车辆库同步链 / 完整性门禁 | [`docs/reference/replay-data.md`](../docs/reference/replay-data.md)「全等级车型资料」 |
| `research/` 资产包（配置器数据、数据源、BK 裁定、vehicleFilter、乘员分域） | [`docs/operations/agent-asset-origin.md`](../docs/operations/agent-asset-origin.md)「research 资产包数据语义」「发布：生成与上传资产包」 |
| 配置器消费侧（researchCatalog、图标 URL 表） | [`docs/frontend/architecture.md`](../docs/frontend/architecture.md) 坦克百科配置器节 |
| `map_names.json`（三语名、`mapNameCn()`/`mapLabel()` 同源、默认可见性门槛） | [`docs/reference/maps.md`](../docs/reference/maps.md)「命名与维护约定」 |
| `map-semantics/` | [`docs/reference/maps.md`](../docs/reference/maps.md)「语义数据手工调整」 |
| `tank_tactical_profiles.json` | [`docs/architecture/ai-review.md`](../docs/architecture/ai-review.md) |
| `assets/`（Vite `publicDir`、Dockerfile 复制） | [`docs/DEVELOPER_GUIDE.md`](../docs/DEVELOPER_GUIDE.md) 与 [`docs/operations/sponsor-runtime-content.md`](../docs/operations/sponsor-runtime-content.md) |
| `fixtures/` vs `data/` 边界 | [`docs/DEVELOPER_GUIDE.md`](../docs/DEVELOPER_GUIDE.md) 回放样本小节 |

## 验证命令入口

- 别名契约：`cd common/python && python validate_tank_aliases.py`
  （非法 JSON / 重复 key / 空 alias / 同车重复 alias → CI 失败；跨车重复仅 warning）。
- 车辆库/名册：`update_tankopedia.py` 内建 `validate_roster` 门禁
  + `common/python/tests/test_update_tankopedia.py`。
