# 完整回放重建（Replay Pipeline）

> 从 `data.wotreplay` 完整扫描事件流并重建战场状态的独立能力。开发入口见 `docs/DEVELOPER_GUIDE.md`；
> 数据字典见 `docs/reference/replay-data.md`；AI 分析数据流见 `docs/architecture/ai-review.md`。

### 架构

```text
.wotbreplay
    │
    ▼
Replay archive reader (ReplayReconstructionService)
    │
    ▼
ReplayPacketStreamReader  (stream 包)
    │  ├── ReplayStreamHeader 解析
    │  ├── 从头到尾扫描所有合法包
    │  ├── 头部版本读出（供版本门禁；见 ReplayVersionGate）
    │  └── ReplayStreamDiagnostics 输出
    │
    ▼
ReplayPacketDecoderRegistry  (decoder 包)
    │  ├── ReplayPacketDecoder 接口
    │  ├── PositionDecoder (Type 10)
    │  ├── EntityMethodDecoder (Type 8, method0/1/4/5/8/17/20/27/29/36/38)
    │  ├── EntityLeaveDecoder (Type 4)
    │  ├── BattleEndDecoder (Type 14 → ReplayStreamClosedEvent，仅流关闭)
    │  ├── EntityCreateDecoder (Type 0/1/2)
    │  ├── MaterializationDecoder (Type 5) + MaterializationAnnouncedDecoder (Type 33)
    │  ├── EntityPropertyDecoder (Type 7, prop2/prop3 HP)
    │  ├── GunMarkerSizeDecoder (Type 31) / AimRayStateDecoder (Type 39)
    │  ├── SessionDecisecondLowByteDecoder (Type 35) / AmmunitionSelectionDecoder
    │  └── VehicleModuleCrewStateDecoder (method8 专用子型前置)
    │
    ▼
BattleStateReconstructor  (reconstruction 包)
    │  ├── BattleState (可变状态)
    │  ├── VehicleState (每车状态)
    │  ├── 事件 applier
    │  └── Checkpoint (每秒/每 500 事件)
    │
    ▼
ReplayReconstruction 输出
    ├── 事件时间线
    ├── 实体状态时间线
    ├── stateAt(time) 查询
    ├── ReplayCoverage
    └── ReplayStreamDiagnostics
```

### 新增/修改文件 (wotb-core)

**stream 包**:

- `replay/stream/PacketReadStatus.java` — 包读取状态枚举
- `replay/stream/RawReplayPacket.java` — 原始包 record（共享 source 数组）
- `replay/stream/ReplayStreamHeader.java` — 流头部模型
- `replay/stream/ReplayHeaderException.java` — 头部异常
- `replay/stream/PacketTypeDiagnostics.java` — 类型诊断
- `replay/stream/ReplayStreamDiagnostics.java` — 流诊断
- `replay/stream/ReplayPacketStreamReader.java` — 流读取器

**event 包**:

- `replay/event/ReplayTimestamp.java` — 双时间模型（raw + battle）
- `replay/event/DecodeConfidence.java` — 解码置信度
- `replay/event/ReplayEvent.java` — 领域事件接口
- `replay/event/PositionChangedEvent.java` — 位置更新
- `replay/event/HealthChangedEvent.java` — 血量变化
- `replay/event/DamageEvent.java` — 伤害事件
- `replay/event/EntityCreatedEvent.java` — 实体创建
- `replay/event/EntityRemovedEvent.java` — 实体移除
- `replay/event/VehicleDestroyedEvent.java` — 车辆击毁
- `replay/event/BattleEndedEvent.java` — 战斗结束
- `replay/event/UnknownReplayEvent.java` — 未知事件
- `replay/event/ParticipantMappingEvent.java` — 账号映射

**decoder 包**:

- `replay/decoder/ReplayDecodeContext.java` — 解码上下文
- `replay/decoder/DecodeStatus.java` — 解码状态
- `replay/decoder/ReplayDecodeWarning.java` — 解码警告
- `replay/decoder/ReplayDecodeResult.java` — 解码结果
- `replay/decoder/ReplayPacketDecoder.java` — 解码器接口
- `replay/decoder/ReplayPacketDecoderRegistry.java` — 解码器注册中心
- `replay/decoder/ProtobufDecoder.java` — protobuf 解码工具
- `replay/decoder/PositionDecoder.java` — Type 10 解码器
- `replay/decoder/EntityMethodDecoder.java` — Type 8 解码器（damage + mapping）
- `replay/decoder/EntityLeaveDecoder.java` — Type 4 解码器
- `replay/decoder/BattleEndDecoder.java` — Type 14 解码器
- `replay/decoder/EntityCreateDecoder.java` — Type 0/1/2 解码器
- `replay/decoder/EntityPropertyDecoder.java` — Type 7 解码器（占位）
- `replay/decoder/PlaceholderDecoder.java` — 占位解码器（Type 5/31/35/39）

**reconstruction 包**:

- `replay/reconstruction/LifeState.java` — 存活状态枚举
- `replay/reconstruction/ObservationState.java` — 观测状态枚举
- `replay/reconstruction/BattleLifecycle.java` — 战斗阶段枚举
- `replay/reconstruction/Vector3.java` — 三维向量
- `replay/reconstruction/Rotation.java` — 三维旋转
- `replay/reconstruction/VehicleState.java` — 车辆状态
- `replay/reconstruction/BattleState.java` — 可变战场状态
- `replay/reconstruction/BattleStateSnapshot.java` — 不可变快照
- `replay/reconstruction/BattleStateCheckpoint.java` — 检查点
- `replay/reconstruction/BattleParticipant.java` — 参与者
- `replay/reconstruction/ReplayMetadata.java` — 回放元数据
- `replay/reconstruction/ReplayCoverage.java` — 覆盖率
- `replay/reconstruction/ReplayReconstruction.java` — 重建结果
- `replay/reconstruction/BattleStateReconstructor.java` — 状态重建器
- `replay/reconstruction/ReplayReconstructionService.java` — 服务编排

### 修改文件 (wotb-web)

- `config/SecurityConfig.java` — `/api/replay/analyze`、`/reconstruct-batch`、`/process` 需 `wotbtools-user` 或 `wotbtools-admin`
- `replay/controller/ReconstructionController.java` — 新建 controller

> 2026-07 更新：`POST /api/replay/reconstruct` 与 `POST /api/replay/state-at` 两个端点已随前端简化一并移除
> （`ReconstructSummary` / `StateAtResponse` DTO 和 `ReplayReconstructionService.stateAt()` 同时删除）。
> 重建能力保留在 core，由 `/api/replay/analyze` 在内部调用；`BattleStateReconstructor.stateAt(...)` 仍是 core 公共 API。
> 下文对这两个端点的请求/响应示例仅作历史记录。

### 测试文件

- `replay/stream/ReplayPacketStreamReaderTest.java` — 流读取单元测试

### 已支持的 packet type

| Type | 含义                   | 解码状态          | 说明                       |
|------|----------------------|---------------|--------------------------|
| 0    | BasePlayerCreate     | PARTIAL       | 实体创建，payload 格式待深度解析     |
| 1    | CellCreate           | PARTIAL       | 同上                       |
| 2    | Control/PlayerCreate | PARTIAL       | 同上                       |
| 4    | EntityLeave          | EXACT         | entityId 精确提取            |
| 8    | EntityMethod         | EXACT         | damage + updateArena2 映射 |
| 10   | Position             | EXACT         | 完整位置解析，NaN/Infinity 验证   |
| 14   | StreamClose         | EXACT         | data.wotreplay 流关闭（ReplayStreamClosedEvent） |

### 部分支持的 packet type

| Type | 含义                 | 状态      | 说明                |
|------|--------------------|---------|-------------------|
| 7    | EntityProperty     | EXACT   | propId=3 当前 HP / propId=2 炮塔方向（PR147 证明） |
| 5    | Materialization    | EXACT/PARTIAL | Type 5 实体物化（payload 长度门禁，非 Spotting） |
| 31   | GunMarkerSize      | EXACT   | 炮口大小（closed semantics 版本门禁） |
| 35   | SessionDecisecond  | EXACT   | 秒级 decisecond 低字节（PR147 证明） |
| 39   | AimRayState        | EXACT   | 瞄准射线状态（method36 protobuf） |

### 尚未支持的 packet type

11 (EntityMethod 未知), 23 (Game-specific), 29 (Game-specific), 32 (Game-specific), 以及其他未观察到的类型。

### 时间模型

- `rawClockSec` — 来自 `data.wotreplay` 的原始时钟，永久保留
- `battleClockSec` — 战斗相对时间（= raw - battleStartRawClockSec）
- 战斗开始时刻识别：由 `BattleStartResolver` 完成，返回 IDENTIFIED / ESTIMATED / UNRESOLVED；`battleClockSec` 通过 `battleRelative(rawClock)` 计算

### 450 秒限制

- 默认 `maxClockSec=450`, `clockToleranceSec=5`
- 允许范围 = 0 ~ 455 秒
- 超出时返回 `REPLAY_DURATION_EXCEEDED`
- 不 clamp、不修改事件时间

### 状态查询

```java
BattleStateSnapshot stateAt(float rawClockSec, List<ReplayEvent>, List<BattleStateCheckpoint>);
```

- 默认 checkpoint 间隔 1 秒 或 500 事件
- 查询时从最近 checkpoint 恢复后继续应用事件
- 同一回放同一时间产生确定性一致结果

### 位置查询

- 默认使用最后一次已知位置
- 不默认线性插值
- 敌人失去数据更新后保留 `lastKnownPosition`，标记 `STALE`

### API 接口

```http
POST /api/replay/reconstruct
Content-Type: multipart/form-data
Body: file=<单个 .wotbreplay>
```

默认响应（摘要）：

```json
{
  "battleDurationSec": 327.42,
  "battleStartRawClockSec": null,
  "packetCount": 98341,
  "decodedPacketCount": 52100,
  "participantCount": 14,
  "entityCount": 16,
  "eventCount": 48322,
  "checkpointCount": 328,
  "finalState": {},
  "coverage": {},
  "diagnostics": {}
}
```

状态查询：

```http
POST /api/replay/state-at?time=135.5
Content-Type: multipart/form-data
Body: file=<单个 .wotbreplay>
```

---
