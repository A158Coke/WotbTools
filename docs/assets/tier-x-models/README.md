# Tier X 专属俯视车型系统（Battle Playback Vehicle Marker System V2）

> 总计划：docs/current-plan.md（PR1–PR4）。本目录是 PR1 的系统文档与资产交接清单。
> 当前状态：**ASSET_GENERATION_READY** —— 基础设施就绪，等待 ChatGPT 生成正式车型 SVG。

## 业务目标（一句话）

> WotBTools Tankopedia 中所有 Tier X 基础车型都拥有自己可辨识的专属俯视战术模型，
> 并在真实 Battle Playback 中使用；非 Tier X 继续使用当前通用 marker。

## 系统结构

| 路径 | 职责 |
|---|---|
| `frontend/src/vehicle-models/types.js` | discriminated union 类型契约 + 统一 viewBox + metadata schema |
| `frontend/src/vehicle-models/mapping.js` | 集中静态 Tank ID → baseModelKey（84 辆 → 81 组） |
| `frontend/src/vehicle-models/assets/<modelKey>/` | 正式 SVG 资产（hull.svg / turret.svg / metadata.json） |
| `frontend/src/vehicle-models/validate.js` | validator（CI 与 CLI 共用同一逻辑） |
| `frontend/src/vehicle-models/coverage.test.js` | Tier X 100% 覆盖门禁（新增 Tier X 无 mapping → CI FAIL） |
| `frontend/src/vehicle-models/validate.test.js` | validator 单测（21 用例） |
| `frontend/src/components/VehicleModelPreviewPage.vue` | 隐藏 admin QA 页（`?view=vehicle-models`，仅 wotbtools-admin） |
| `frontend/scripts/blitzkit-references.mjs` | BlitzKit 辅助脚本（inventory + 参考图下载） |
| `frontend/scripts/validate-vehicle-models.mjs` | CLI validator（资产放回后自检） |
| `frontend/scripts/.vehicle-model-refs/` | 参考图本地缓存（gitignored） |
| `docs/assets/tier-x-models/svg-generation-spec.md` | 全局 SVG 生成规范（正式文档） |
| `docs/assets/tier-x-models/tier-x-inventory.md` | 84 辆 Tier X inventory（脚本生成） |

## Asset Handoff（ChatGPT 交接清单）

### A. Tier X inventory

84 辆完整清单（tankId / display name / baseModelKey / turreted|turretless / class / nation /
BlitzKit 参考链接）见 `tier-x-inventory.md`（由脚本从 Tankopedia + mapping.js 生成，权威）。
3 组合并（skin/特殊版本复用基础模型）：`sheridan`（Sheridan + Sheridan Missile）、
`kpz-70`（Kpz 70 + Kpz 70 Missile）、`type-5-heavy`（Type 5 Heavy + Type 5 H Zetsu）。

**待视觉确认项**（新车型结构未知，生成时请对照参考图确认 kind 与 pivot）：
114 SP2 (11057)、116-F3 (12849)、BZT-70 (14129)、AC Atlas (19825)、AC Teichos (22129)、
NC 70 Błyskawica (19585)、GSOR the TANK (25169)、SPHT (29985)；
另有 Strv K（Kranvagn 底盘 + 不同炮塔，建议独立模型）与 121B（WZ-121 变体，建议独立模型）。

### B. 目标路径

```
frontend/src/vehicle-models/assets/<modelKey>/
├── hull.svg          # 必填
├── turret.svg        # 仅 turreted
└── metadata.json     # 必填（与资产同批放回）
frontend/scripts/.vehicle-model-refs/references/<tankId>.webp   # 参考图缓存（已下载 84 张）
frontend/src/vehicle-models/mapping.js                          # mapping（已就绪，勿改）
docs/assets/tier-x-models/svg-generation-spec.md                # 全局规范（已就绪）
```

### C. SVG contract

统一 `viewBox="0 0 320 320"`；0° = 车头朝上；hull 中心 = (160,160)；
turret 绕 metadata 的 `turretPivot` 旋转；neutral 灰阶、1–3 条结构线、简化履带；
长炮管允许溢出；禁止 script/foreignObject/外部引用/独立 gun 层。
**完整规则（必须逐条遵守）见 `svg-generation-spec.md`。**

### D. Metadata schema

顶层 8 键：`modelKey / kind / blitzkitReference / turretPivot / distinctiveFeatures /
intentionalExaggeration / generationNotes / mustKeepStructures`。
完整示例：`frontend/src/vehicle-models/assets/sample/metadata.json`；契约见 spec §7。

### E. Mapping contract

`frontend/src/vehicle-models/types.js` 的 discriminated union：
`TurretedVehicleModelAsset { modelKey, kind:'turreted', hull, turret, turretPivot }` |
`TurretlessVehicleModelAsset { modelKey, kind:'turretless', hull }`。
mapping 已包含全部 84 辆 → 81 组，**生成资产时不要改 mapping**。

### F. BlitzKit references

- 参考图：`https://api.blitzkit.app/tanks/{tankId}/icons/big.webp`（已验证，缓存已下载）。
- 交互 3D 页面：`https://blitzkit.app/tanks/{slug}`（页面链接为尽力而为的 slug，以参考图为准）。
- 重新下载：`node frontend/scripts/blitzkit-references.mjs`（可 `--dry-run` 只看清单）。

### G. Validation commands（资产放回后）

```bash
node frontend/scripts/validate-vehicle-models.mjs   # 全量自检（PASS/FAIL，退出码 1 表示有错）
cd frontend && npm test                             # CI 同口径（coverage + validate 全绿）
```

### H. 第一批生成建议（8 辆，结构差异最大化）

| modelKey | tankId | 覆盖结构 |
|---|---|---|
| maus | 6929 | giant heavy，宽大方形车体 |
| leopard-1 | 14609 | narrow medium，细长车体 + 长炮 |
| grille-15 | 19217 | turreted TD，后置炮塔 + 超长炮管（溢出验证） |
| ho-ri | 3937 | turretless casemate TD |
| kranvagn | 4481 | rounded turret heavy，后置炮塔 |
| amx-50-b | 6209 | oscillating turret，前置炮塔 |
| fv4005 | 18001 | 巨大炮塔（barn） |
| sheridan | 20257 | light tank，导弹变体共享（21793 同模型） |

批 1 视觉语言稳定后再生成剩余 73 组。

## 状态流转

```
ASSET_GENERATION_READY（当前）→ ChatGPT 生成 Batch 1 → 人工 QA → 全部资产放回
→ ASSET_GENERATION_COMPLETE（CI 全绿 + admin 全车型可预览）→ PR1 完成
→ PR2 Battle Playback 集成 → PR3 状态视觉重设计 → PR4 标签与碰撞
```

## 变更记录

- PR1（本 PR）：inventory / mapping / BlitzKit helper / 全局 spec / metadata schema /
  validator / coverage CI / admin 预览骨架 / sample 契约资产 / Asset Handoff。
- 之后 PR（计划 §55）：PR2 dedicated models in Battle Playback；PR3 状态视觉重设计；
  PR4 玩家/坦克标签与碰撞。
