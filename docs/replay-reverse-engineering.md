# WoT Blitz 回放包逆向笔记

> 状态：进行中（分支 `re/replay-packet-reverse`）。工具：`PacketReverseProbeTest`（手动探针，不进 CI）。
> 样本：CHRD neptune 团队战（9034890693886323）、random-battle-example 夹具。

## 包格式

`data.wotreplay`：magic(4) + 未知(8) + clientHash(1+len) + clientVersion(1+len) + 1B，随后 N 个事件包：
`payload_len(u32) + type(u32) + clock(f32) + payload`。类型与含义见下。

## 已解码 / 已破解

| type | 含义 | 结构 / 备注 |
|------|------|-------------|
| 0 | basePlayerCreate | 实体创建 + **Python pickle 竞技场信息 dict**：`accountDatabaseIds`（全员账号）、`clanTags`、`teamTitles`、`wins`、`battleLevel`、`mmType` 等（已用受限 Unpickler 完整还原） |
| 1/2 | 实体创建（录像者 avatar cell 等） | type 1 含昵称 + 竞技场 pickle；结构待全解 |
| 4 | EntityLeave | entity_id(i32)（已消费） |
| 5 | 实体 enterWorld | eid + 数据块，部分含昵称；未解 |
| 7 | **属性包** | `(eid u32, propId u32, valueLen u32, value 1-4B)`；本方移动后 ~10Hz；propId 0=标志、2=平滑变化值（与 type-10 yaw/pitch 均不匹配，误差 80°/148°，疑炮塔朝向，缺炮塔数据源无法定案）、3=伤害时刻变化、4=双态（疑弹药/炮状态）、8=标志；**HP 未出现在已见 propId** |
| 8 | EntityMethod | subtype 47/48 updateArena protobuf（名册/账号映射）、8 伤害（已消费）；玩家 protobuf 字段 1-24 已全量列出，field 18=float 1.0（疑初始满血比例） |
| 10 | Position | 49B BigWorld 格式（已消费） |
| 11 | 空间信息 | 含字符串 `spaces/neptune` 等 |
| 13 | **赛后玩家档案 dump** | 容器已全解：zlib 压缩到 pickle(arenaId, 53KB protobuf)（pickle=tuple：INT(arenaId)+BINSTRING(protobuf)）；protobuf：field 8=元信息、field 25=14 玩家档案（1=账号 2=昵称 3=team 5=战队 7=头像 URL，含锦标赛统计 key） |
| 14/29/36 | 低频结束/标记包 | 未深解 |
| 23/26/28 | 4B 小包 | 值多为时间相关（疑 tick/状态）；未解 |
| 31 | 全局 ~30Hz 单 float | 值 6-54；**仅在录像者存活窗口出现**（团队 52.7–115.0s＝布丁阵亡时刻、随机 50.7–296.8s）；形态为**指数衰减到平台值后钳制**，并在关键时刻重置回 ~53 再衰减（团队 52.7s/114.5s 各一次，随机战斗中多次）；已排除：录像者车速/yaw、任一辆车 HP%、到任一车辆的平面距离；疑瞄准/散布/装填类状态，语义未定 |
| 32 | 11-27B | 422 个；未解 |
| 33 | 12B 固定 | 134 个；未解 |
| 35 | **单字节递增 tick 计数** | ~10Hz，两种模式一致，疑全局心跳/帧计数 |
| 39 | **录像者相机/瞄准状态流 120Hz × 7 floats（28B 恒定）** | 中位间隔 8.3ms（99.5% 一致）；**录像者阵亡时刻整体冻结**（团队 115.095s、随机 300.2s，随后包仍持续但值不变）；f3=离散档位（团队 20/24/35-41、随机 52-62，疑 FOV/缩放档）；f5/f6=缓变有界角（弧度，团队 -1.8..0.9 / -0.44..0.14）；f2/f3/f4 慢移且贴近录像者战车（团队 62% 样本 <30m）；f0/f1 大值快速变化、阵亡后仍持续跳变；已排除：任何车辆位置（六轴变换 + 完整 6 参数仿射拟合最佳残差 ≥73m）、瞄准射线几何（相机→(f0,f1) 方位角 vs f5 差 std=43°）；**结论：录像者客户端相机/瞄准状态，具体字段映射待第三样本或游戏内对照** |

## 关键结论

- 两种战斗模式（7v7 团队 / 30 人随机）类型集一致，频率也一致 → type 31/35/39 是**全局/录像者流**，不是按实体广播。
- **位置覆盖（2026-08-11 修正 team 标签后）**：本方（录像者队伍，本样本 CHRD=team 2）7 车全部从 1.1s 有 type-10 位置；**敌方（BSK-T=team 1）开局 0~30-50s 无位置包**（各车首包 30.5~51.9s≈首次移动时刻）。此前「本方开局缺失」是把 team 1/2 弄反——正确结论：**本方位置开局完整；敌方静止时不上报 type-10 位置**（移动/交火后才出现）。回放为服务器下发完整实体流（与点亮无关）。
- type 0 pickle 的 `accountDatabaseIds` / `clanTags` / `teamTitles` 可作**权威名册与队名来源**（优于 updateArena2 映射）；已落地：`PickleDecoder`（协议 2 精简解码器）+ `EventStreamReader.extractArenaInfo` + 真实载荷单测。
- HP 仍未定位；候选：type 39 某 float、type 8 field 18（初始满血比例）、type 13 玩家统计块、battle_results。

## 2026-08-12 进展

- **type 31 窗口 = 录像者存活期**：团队样本 type 31 在 115.0s 戛然而止，与录像者（CHRD-A158布丁 SPHT）阵亡时刻吻合；type-10 位置在其后仍持续到 146.9s 但完全静止（死车位置广播），佐证了 AI 复盘「布丁 115s 阵亡」的时间线；随机样本 type 31 窗口 50.7–296.8s 同样止于录像者存活末期。值形态为「指数衰减→平台钳制→重置 ~53→再衰减」，两次战斗共享 53.97/27.01 等平台值；已系统排除车速/HP%/到车辆距离，疑瞄准/散布/装填计时类状态。
- **type 39 = 录像者相机/瞄准状态流**：7 floats × 120Hz（恰为客户端渲染 tick），阵亡即整体冻结（后 5 元组精确冻结、f0/f1 仍跳变），两种模式结构一致；f3 离散档位疑 FOV（两样本玩家设置不同）；f2/f3/f4 慢移贴车（团队 62% <30m）；f0/f1 大值跳变疑瞄准点/视角（阵亡后观战仍动）。已排除车辆位置与简单瞄准射线模型。
- **观战镜头实体 13185652 发现**：拥有独立 type-10 流（~10Hz、0.2s–146.9s），开局 0.2–1.1s 在录像者出生点，随后静止于 (0,0,0)（yaw=-178.5°），**录像者阵亡后位置在队友间瞬移**（119.1/120.9/126.3/133.3/134.1/134.5/135.5/144.4s 各一次，均为单包位置 + 方位角跳变），即观战镜头切换痕迹。
- **神秘实体 12558633/12558634/12558649 排除**：出现后完全静止（团队样本），为场景静态物体（建筑/可破坏物），非炮弹。
- **type 7 propId=2 与炮塔朝向**：对照 eid=12558550 的 622 个 propId=2 样本与 type-10 pitch，误差分布不支持车体 pitch，炮塔朝向假设仍待炮塔数据源。

## 已知修正记录

- 2026-08-11：team 标签曾误判（以 AI 复盘中的「CHRD=A 队」为前提），经 type-0 pickle（`teamTitles{2:'chrd'}`）+ updateArena2 field 4 验证后修正：CHRD=team 2=录像者队伍；位置覆盖结论随之反转（本方完整、敌方开局缺失）。附带发现：pickle `wins{1:1,2:0}` 显示本样本胜方为 team 1（BSK-T），与早前「CHRD 7-3 获胜」的说法冲突，待用 battle_results 核验。

## 外部对照（社区先例）

- `eigenein/wotbreplay-parser`（Rust，v0.4.2）为 Blitz 回放公开实现：仅解 **type 0（BasePlayerCreate）与 type 8（EntityMethod）**，其余全部 `Unknown`；type 0 用 `serde_pickle` 解 arguments（与我们的 PickleDecoder 思路一致），字段 schema 与我们解出的 dict 吻合且我们的字段更全（clanTags/teamTitles/wins/webEmitterID 等社区未覆盖）。
- 结论：type 7/31/35/39 在全球公开资料中均未破解，本分支的成果（type 7 结构 + propId 部分语义、type 35 tick、type 13 容器、type 39/31 排除性结论）为新增贡献。

## 下一步

1. type 39 字段映射：收集第三个真实回放（最好录像者阵亡时间明确），验证冻结时刻与 f2/f3/f4 贴车规律；或游戏内录屏对照 FOV 档位/瞄准动作。
2. type 31 语义：结合多个回放统计「重置 ~53」的触发条件（疑似开火/受击/索敌）。
2. type 13 集成：zlib + protobuf 解码进解析器，提供赛后统计/玩家档案。
3. type 32/33/5 归属；type 7 propId 完整映射（对照炮塔/车体朝向、弹药）。
4. 将破解结果沉淀为解析器实现 + 契约测试。
