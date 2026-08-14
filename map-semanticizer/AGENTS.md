# map-semanticizer/ — 地图语义化独立工具

> 仓库级硬约定见 `.agents/AGENTS.md`。这是独立单文件 Python 工具，不是 Java/frontend 的一部分。

- 实现 = `map_semanticizer.py`（单文件）；要求 Python 3.11+，**零第三方依赖**（不需要 pip install）；测试 = `tests/`（unittest，仓库根执行 `python -m unittest discover -s map-semanticizer/tests -p 'test_*.py'`）。
- 输入：WotB 客户端地图目录/地图 ZIP 里的 `.sc2(.dvpl)`、`.heightmap(.dvpl)`（出生点/占领点/边界/场景对象）。
- 输出：`<mapId>.semantic.json`（给后端 `MapTacticalSemanticsRegistry` 读取的 areas/relationships/spawnSemantics）+ `<mapId>.semantic.txt`（LLM 注入用紧凑文本）。
- **覆盖式生成**：重跑会整份覆盖 `common/map-semantics/*.semantic.json`——已人工核验的地图严禁重跑（会丢失手工修正）；改动后同步 `docs/reference/maps.md` 与 `MapTacticalSemanticsRegistryTest`。
- 用法与字段说明见 `map-semanticizer/README.md`。
