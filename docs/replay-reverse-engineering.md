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
| 7 | **属性包** | `(eid u32, propId u32, valueLen u32, value 1-4B)`；本方移动后 ~10Hz；propId 0=标志、2=角度（平滑，疑炮塔/车体朝向）、3=伤害时刻变化、4=双态（疑弹药/炮状态）、8=标志；**HP 未出现在已见 propId** |
| 8 | EntityMethod | subtype 47/48 updateArena protobuf（名册/账号映射）、8 伤害（已消费）；玩家 protobuf 字段 1-24 已全量列出，field 18=float 1.0（疑初始满血比例） |
| 10 | Position | 49B BigWorld 格式（已消费） |
| 11 | 空间信息 | 含字符串 `spaces/neptune` 等 |
| 13 | **赛后结果 dump（zlib 压缩）** | 解压 53KB：竞技场 ID 字符串 + protobuf（地图池、14 玩家档案：账号/昵称/team/clanTag/头像 URL/锦标赛统计） |
| 14/29/36 | 低频结束/标记包 | 未深解 |
| 23/26/28 | 4B 小包 | 值多为时间相关（疑 tick/状态）；未解 |
| 31 | 全局 ~30Hz 单 float | 值 13-54；非按实体（7v7 与随机战频率一致）；疑录像者本地状态；未归属 |
| 32 | 11-27B | 422 个；未解 |
| 33 | 12B 固定 | 134 个；未解 |
| 35 | **单字节递增 tick 计数** | ~10Hz，两种模式一致，疑全局心跳/帧计数 |
| 39 | **全局固定 120Hz × 7 floats** | 中位间隔 8.3ms（99.5% 一致）；与 type-10 位置零匹配（六种轴变换仅换轴后 6.6% 命中）；非按实体；疑录像者瞄准/输入/物理状态；**未破解** |

## 关键结论

- 两种战斗模式（7v7 团队 / 30 人随机）类型集一致，频率也一致 → type 31/35/39 是**全局/录像者流**，不是按实体广播。
- 本方静止无 type-10 位置、移动后才有 → 协议行为（本地模拟），非解码缺陷；开局初始状态候选在 type 0/7/13。
- type 0 pickle 的 `accountDatabaseIds` / `clanTags` / `teamTitles` 可作**权威名册与队名来源**（优于 updateArena2 映射）；已落地：`PickleDecoder`（协议 2 精简解码器）+ `EventStreamReader.extractArenaInfo` + 真实载荷单测。
- HP 仍未定位；候选：type 39 某 float、type 8 field 18（初始满血比例）、type 13 玩家统计块、battle_results。

## 下一步

1. type 39 语义：与录像者自身状态（相机/瞄准/输入）关联；确认是否含 HP 分数。
2. type 13 集成：zlib + protobuf 解码进解析器，提供赛后统计/玩家档案。
3. type 31/32/33/5 归属；type 7 propId 完整映射（对照炮塔/车体朝向、弹药）。
4. 将破解结果沉淀为解析器实现 + 契约测试。
