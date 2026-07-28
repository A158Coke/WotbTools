````markdown
# WotbTools：Tier X 车辆知识库、装甲分析与 AI Profile 最终设计

## 1. 项目目标

为 WotbTools 的 AI 回放分析系统建立一个可复用的 **Tier X 车辆知识层**，使 AI 能够结合：

- 车辆火力；
- 车辆机动；
- 火控能力；
- 血量与生存能力；
- 三维装甲模型；
- 炮塔与车体防护差异；
- 不同角度下的装甲表现；
- 弹夹、自动装填等特殊机制；
- 本场回放中的位置、移动、开火、受伤和装填事件；

生成可信、可解释、与本场操作相关的复盘结论。

预计使用的 AI 模型为 DSV4，不进行模型训练或微调。

因此系统不能依赖 AI 自行记忆车辆知识，也不能要求 AI 直接理解复杂的三维装甲模型。

核心原则：

```text
Tankopedia 数值和装甲模型
        ↓
离线确定性分析
        ↓
生成结构化 VehicleTacticalProfile
        ↓
保存到 PostgreSQL
        ↓
结合本场回放事件
        ↓
通过 Harness / Prompt 交给 DSV4
        ↓
生成最终复盘
```

职责划分：

```text
离线分析程序负责事实、数值和装甲计算
后端负责回放事件与车辆 Profile 的匹配
DSV4 负责解释、归纳和生成自然语言建议
```

---

# 2. 当前支持范围

第一阶段只支持：

```text
Tier X
```

暂不支持：

- VIII 级；
- IX 级；
- 低级车辆；
- 娱乐模式特殊车辆；
- 临时活动车辆；
- 未取得可靠模型或数值的车辆。

数据来源：

```text
Blitz Tankopedia / BlitzKit Tankopedia
```

不使用 WG API。

中国服务器与 WG 服务器车辆数值一致，因此 Tankopedia 中对应版本的车辆数值可以作为当前阶段的数据源。

所有数据通过离线工具导入。

禁止在用户上传回放并请求 AI 分析时实时访问 Tankopedia。

---

# 3. 总体架构

```text
Tankopedia Tier X 数据
        │
        ├── 车辆基础数值
        ├── 火炮和炮弹数值
        ├── 机动和火控数值
        └── 三维装甲模型
                ↓
Tankopedia Importer
                ↓
Armor Model Importer
                ↓
Armor Analyzer / Simulator
                ↓
Vehicle Metric Calculator
                ↓
Vehicle Profile Builder
                ↓
最终 VehicleTacticalProfile JSON
                ↓
PostgreSQL
                ↓
TankKnowledgeService
                ↓
回放事件特征提取
                ↓
TankAwareBattleAnalysisContext
                ↓
DSV4
```

生产环境只需要查询最终 Profile。

生产环境不需要：

- 重新下载装甲模型；
- 解析三角网格；
- 执行大量射线检测；
- 重新计算所有车辆分位数；
- 在用户请求期间构建 Profile。

---

# 4. 数据抓取原则

## 4.1 离线抓取

正确流程：

```text
游戏版本更新
→ 手动或 CI 运行 Importer
→ 抓取 Tier X 数据
→ 分析装甲模型
→ 生成 Profile
→ 人工检查和测试
→ 写入 PostgreSQL
→ 后端正式使用
```

禁止：

```text
用户上传回放
→ 实时请求 Tankopedia
→ 实时下载车辆模型
→ 实时生成 Profile
```

原因：

- 第三方站点可能不可用；
- 页面结构可能变化；
- 会增加分析延迟；
- 无法保证旧回放使用正确版本；
- 无法复现历史 AI 报告；
- 装甲分析计算成本较高。

---

## 4.2 数据获取优先级

按照以下优先级获取数据：

1. 页面 Network 中使用的结构化 JSON；
2. 页面内嵌的结构化 JSON；
3. 站点使用的静态数据文件；
4. 独立模型或资产地址；
5. 最后才解析 HTML 可见文本。

避免依赖：

- CSS class；
- 页面布局；
- 人类可读格式；
- 攻略文章；
- 车辆介绍文字。

第三方攻略文字不应直接作为 AI 知识来源。

---

# 5. 车辆配置基准

所有 Tier X 车辆必须使用统一配置。

第一阶段统一采用：

```text
顶配模块
基础车辆状态
无装备
无补给
不假设乘员技能
不假设特殊涂装加成
标准火炮配置
```

如果 Tankopedia 默认展示的数值受装备、补给或页面选项影响，Importer 必须显式恢复为统一基础配置。

Profile 中需要注明：

```json
{
  "configuration": "BASE_TOP_CONFIGURATION",
  "equipmentIncluded": false,
  "provisionsIncluded": false,
  "crewSkillsIncluded": false
}
```

不能因为 Tankopedia 页面可以选择装备，就假设回放中的玩家实际使用了对应装备。

---

# 6. 需要抓取的车辆数据

## 6.1 基础信息

```text
tankId
tankCode
tankName
tier
vehicleClass
nation
hitPoints
viewRange
gameVersion
```

## 6.2 火力数据

```text
alphaDamage
standardPenetration
premiumPenetration
reloadTime
fireRate
aimTime
dispersion
gunDepression
gunElevation
clipCapacity
intraClipReload
fullClipReload
shellType
shellVelocity（如果可靠）
```

## 6.3 机动数据

```text
forwardSpeed
backwardSpeed
enginePower
weight
powerToWeight
hullTraverseSpeed
turretTraverseSpeed
```

## 6.4 纸面装甲数据

```text
hullFront
hullSide
hullRear
turretFront
turretSide
turretRear
```

纸面装甲仅作为辅助数据。

最终装甲能力必须主要来自三维装甲模型分析。

---

# 7. 不需要抓取的数据

第一阶段不需要：

```text
车辆背景故事
自然语言攻略
车辆评价文章
宣传图片
高清视频
完整科技树
银币价格
金币价格
研发经验
低级模块组合
所有装备方案
所有补给方案
所有语言文本
玩家评论
胜率统计
服务器热度
```

这些数据不会直接提高单场回放分析质量。

---

# 8. 原始车辆数据模型

```java
public record VehicleRawProfile(
        long tankId,
        String tankCode,
        String tankName,
        int tier,
        VehicleClass vehicleClass,
        String nation,
        int hitPoints,
        FirepowerRawProfile firepower,
        MobilityRawProfile mobility,
        NominalArmorProfile nominalArmor,
        double viewRange,
        VehicleSourceMetadata source
) {
}
```

```java
public record FirepowerRawProfile(
        double alphaDamage,
        double standardPenetration,
        double premiumPenetration,
        double reloadTime,
        double fireRate,
        double aimTime,
        double dispersion,
        double gunDepression,
        double gunElevation,
        int clipCapacity,
        Double intraClipReload,
        Double fullClipReload,
        List<ShellRawProfile> shells
) {
}
```

```java
public record ShellRawProfile(
        ShellType shellType,
        double penetration,
        double damage,
        Double velocity
) {
}
```

```java
public record MobilityRawProfile(
        double forwardSpeed,
        double backwardSpeed,
        double enginePower,
        double weight,
        double hullTraverseSpeed,
        double turretTraverseSpeed
) {
}
```

```java
public record NominalArmorProfile(
        double hullFront,
        double hullSide,
        double hullRear,
        double turretFront,
        double turretSide,
        double turretRear
) {
}
```

```java
public record VehicleSourceMetadata(
        String source,
        String sourceVersion,
        String gameVersion,
        String sourceHash,
        Instant importedAt
) {
}
```

---

# 9. 装甲模型要求

每辆车的装甲分析需要尽量获得：

- 车体装甲模型；
- 炮塔装甲模型；
- 炮盾；
- 间隙装甲；
- 外部模块；
- 履带区域；
- 装甲厚度；
- 顶点；
- 三角面；
- 面法线；
- 车体与炮塔变换关系；
- 炮塔旋转中心；
- 火炮俯仰轴；
- 模型版本。

建议的离线模型：

```java
public record TankArmorModel(
        long tankId,
        String tankCode,
        String gameVersion,
        List<ArmorMesh> meshes,
        ArmorModelMetadata metadata
) {
}
```

```java
public record ArmorMesh(
        String meshId,
        ArmorLayerType layerType,
        double nominalThicknessMm,
        List<Vector3> vertices,
        List<Triangle> triangles
) {
}
```

```java
public enum ArmorLayerType {
    PRIMARY_ARMOR,
    SPACED_ARMOR,
    GUN_MANTLET,
    EXTERNAL_MODULE,
    TRACK,
    GUN,
    UNKNOWN
}
```

---

# 10. 装甲模型不能直接交给 DSV4

禁止：

```text
完整三维 mesh
→ 直接发给 DSV4
→ 要求 AI 判断装甲强弱
```

原因：

- DSV4 不能可靠读取大型三角网格；
- 无法稳定处理面法线；
- 无法准确计算入射角；
- 无法正确处理多层装甲；
- 不同车辆之间难以保持相同评价标准；
- 结果无法稳定复现；
- Token 消耗过大；
- 容易产生看似合理但错误的装甲结论。

正确方式：

```text
装甲模型
→ 离线确定性仿真
→ 生成结构化 ArmorTacticalProfile
→ DSV4 读取 Profile
```

---

# 11. 装甲仿真原则

最基本的倾斜装甲近似关系：

```text
effectiveThickness =
    nominalThickness / cos(impactAngle)
```

但实际装甲分析不能只依赖这个公式。

需要考虑：

- 炮弹入射角；
- 装甲面法线；
- AP 归一化；
- APCR 归一化；
- HEAT 无归一化或不同机制；
- 自动跳弹角；
- 炮弹口径；
- 多层装甲；
- 间隙装甲；
- 外部模块；
- 履带；
- 炮盾；
- 炮塔旋转；
- 车体摆角；
- 攻击者与目标的高低差；
- 攻击者视角下的投影面积。

第一阶段至少支持：

```text
AP
APCR
HEAT
```

暂不要求：

```text
HE
HESH
爆炸溅射
内部模块损伤
乘员损伤
精确炮弹随机穿深
```

---

# 12. 标准装甲测试场景

每辆 Tier X 车辆需要在统一场景下进行测试。

## 12.1 车体方向

```text
正面 0°
斜摆 15°
斜摆 25°
斜摆 35°
侧面 90°
后面 180°
```

建议额外测试：

```text
正面偏左 10°
正面偏右 10°
```

用于发现左右不对称结构。

## 12.2 高低差

```text
攻击者与目标同高度
攻击者高于目标 3m
攻击者高于目标 6m
攻击者低于目标 3m
攻击者低于目标 6m
```

## 12.3 火炮俯角姿态

```text
炮管 0°
使用 50% 最大俯角
使用最大俯角
```

## 12.4 穿深档位

第一版可使用：

```text
240 mm
260 mm
280 mm
300 mm
320 mm
340 mm
```

更合理的后续方案是根据 Tier X 车辆穿深分布自动生成代表档位：

```text
Tier X 标准弹 P25
Tier X 标准弹 P50
Tier X 标准弹 P75
Tier X 特种弹 P50
Tier X 特种弹 P75
```

---

# 13. 装甲仿真输出

## 13.1 穿透覆盖率

```java
public record PenetrationCoverage(
        ArmorScenario scenario,
        ShellType shellType,
        double penetrationMm,
        double penetrableAreaRatio,
        double nonPenetrableAreaRatio,
        double uncertainAreaRatio
) {
}
```

示例：

```json
{
  "scenario": "FRONT_FLAT",
  "shellType": "AP",
  "penetrationMm": 280,
  "penetrableAreaRatio": 0.42,
  "nonPenetrableAreaRatio": 0.49,
  "uncertainAreaRatio": 0.09
}
```

面积比例必须根据攻击者视角中的投影面积计算。

不能简单统计：

- 三角形数量；
- mesh 数量；
- 顶点数量。

## 13.2 炮塔和车体分开计算

至少区分：

```text
FRONTAL_HULL
FRONTAL_TURRET
SIDE_HULL
SIDE_TURRET
REAR_HULL
REAR_TURRET
GUN_MANTLET
LOWER_HULL
UPPER_HULL
ROOF
```

如果无法可靠识别具体弱点名称，可以使用几何位置标签：

```text
FRONTAL_HULL_LOWER
FRONTAL_HULL_UPPER
FRONTAL_TURRET_LEFT
FRONTAL_TURRET_RIGHT
```

不得为了自然语言可读性而猜测零件名称。

## 13.3 弱点区域

```java
public record ArmorWeakZone(
        String zoneCode,
        String description,
        double projectedAreaRatio,
        double penetrableAreaRatio,
        double medianEffectiveArmorMm,
        double minimumEffectiveArmorMm,
        double maximumEffectiveArmorMm,
        double confidence
) {
}
```

## 13.4 强防护区域

```java
public record ArmorStrengthZone(
        String zoneCode,
        double projectedAreaRatio,
        double nonPenetrableAreaRatio,
        double medianEffectiveArmorMm,
        double confidence
) {
}
```

## 13.5 姿态收益

```java
public record ArmorPoseBenefit(
        ArmorScenario baseline,
        ArmorScenario comparison,
        double nonPenetrableAreaGain,
        double penetrableAreaReduction,
        double newlyExposedWeakArea,
        double confidence
) {
}
```

摆角不一定只有收益。

例如：

```text
首上等效装甲提高
但侧面或肩部弱点暴露
```

因此必须同时记录：

- 防护提升；
- 可击穿面积减少；
- 新暴露弱区。

---

# 14. ArmorTacticalProfile

```java
public record ArmorTacticalProfile(
        RelativeRating frontalProtection,
        RelativeRating turretProtection,
        RelativeRating hullProtection,
        RelativeRating sideProtection,
        RelativeRating rearProtection,
        RelativeRating hullDownProtection,
        RelativeRating anglingBenefit,

        List<PenetrationCoverage> representativeCoverage,
        List<ArmorWeakZone> weakZones,
        List<ArmorStrengthZone> strongZones,
        List<ArmorPoseBenefit> poseBenefits,

        List<String> strengths,
        List<String> weaknesses,
        List<String> tacticalConstraints,
        List<String> limitations
) {
}
```

示例：

```json
{
  "frontalProtection": "AVERAGE",
  "turretProtection": "VERY_HIGH",
  "hullProtection": "LOW",
  "hullDownProtection": "VERY_HIGH",
  "anglingBenefit": "LOW",
  "strengths": [
    "炮塔正面防护显著高于同级重坦平均水平",
    "隐藏车体后可击穿投影面积明显下降"
  ],
  "weaknesses": [
    "平地正面车体存在较大的可击穿面积",
    "斜摆后侧肩区域暴露增加"
  ],
  "tacticalConstraints": [
    "不适合长时间完全暴露车体进行正面对射",
    "不能仅凭炮塔强度判断任意坡地都适合作战"
  ]
}
```

---

# 15. 火力派生指标

## 15.1 单发炮

```text
DPM =
    alphaDamage × 60 / reloadTime
```

## 15.2 弹夹炮

```text
clipDamage =
    alphaDamage × clipCapacity
```

```text
clipDumpTime =
    intraClipReload × (clipCapacity - 1)
```

```text
cycleTime =
    clipDumpTime + fullClipReload
```

```text
sustainedDpm =
    clipDamage × 60 / cycleTime
```

需要保存：

- 单发伤害；
- 弹夹总伤害；
- 弹夹倾泻时间；
- 完整循环时间；
- 长装填时间；
- 持续 DPM；
- 短期爆发能力；
- 火力真空期。

不能仅用普通 DPM 评价弹夹车。

---

# 16. 机动派生指标

```text
powerToWeight =
    enginePower / weight
```

机动评价至少考虑：

- 前进极速；
- 后退极速；
- 功重比；
- 车体转向；
- 炮塔转向；
- 车辆类型；
- 同级同类型车辆分位数。

车辆 Profile 中保存理论能力。

回放分析时再增加：

- 实际平均速度；
- 开局到关键区域的耗时；
- 实际爬坡速度；
- 装填期间移动距离；
- 撤退速度；
- 转场距离。

---

# 17. 同级相对分位数

原始数值必须经过相对比较。

例如：

```text
40 km/h
```

本身不能直接说明十级重坦是快还是慢。

因此需要计算：

```text
Tier X 全部车辆分位数
Tier X 同类型车辆分位数
Tier X 同装填机制车辆分位数
```

建议等级：

```text
0%–10%    → VERY_LOW
10%–35%   → LOW
35%–65%   → AVERAGE
65%–90%   → HIGH
90%–100%  → VERY_HIGH
```

```java
public record RelativeVehicleMetric(
        String metricCode,
        double rawValue,
        double tierPercentile,
        double classPercentile,
        Double mechanismPercentile,
        RelativeRating rating
) {
}
```

需要计算的指标至少包括：

```text
ALPHA_DAMAGE
STANDARD_PENETRATION
PREMIUM_PENETRATION
DPM
CLIP_DAMAGE
CLIP_DUMP_TIME
FIREPOWER_DOWNTIME
AIM_TIME
DISPERSION
GUN_DEPRESSION
FORWARD_SPEED
BACKWARD_SPEED
POWER_TO_WEIGHT
HULL_TRAVERSE
TURRET_TRAVERSE
HIT_POINTS
FRONTAL_PROTECTION
TURRET_PROTECTION
HULL_PROTECTION
HULL_DOWN_PROTECTION
ANGLING_BENEFIT
```

---

# 18. 车辆 Archetype

车辆可以同时属于多个定位。

```java
public enum VehicleArchetype {
    BURST_HEAVY,
    SUSTAINED_FIRE_HEAVY,
    MOBILE_HEAVY,
    ASSAULT_HEAVY,
    HULL_DOWN_HEAVY,
    SUPPORT_HEAVY,

    FLANKING_MEDIUM,
    SUPPORT_MEDIUM,
    HULL_DOWN_MEDIUM,
    BURST_MEDIUM,

    ASSAULT_TD,
    SNIPER_TD,
    SUPPORT_TD,

    SCOUT_LIGHT,
    DAMAGE_LIGHT,

    UNKNOWN
}
```

```java
public record VehicleArchetypeMatch(
        VehicleArchetype archetype,
        double confidence,
        List<String> evidence
) {
}
```

示例：

```json
{
  "archetype": "HULL_DOWN_HEAVY",
  "confidence": 0.91,
  "evidence": [
    "炮塔防护处于 Tier X 重坦前 10%",
    "火炮俯角高于同级平均",
    "车体防护仅处于同级中下水平"
  ]
}
```

不要强制每辆车只有一个 archetype。

---

# 19. 最终 VehicleTacticalProfile

```java
public record VehicleTacticalProfile(
        VehicleIdentity vehicle,
        VehicleConfiguration configuration,

        ArmorTacticalProfile armor,
        FirepowerTacticalProfile firepower,
        MobilityTacticalProfile mobility,
        GunHandlingTacticalProfile gunHandling,

        List<VehicleArchetypeMatch> archetypes,
        List<TacticalStrength> strengths,
        List<TacticalWeakness> weaknesses,
        List<TacticalConstraint> constraints,
        List<String> recommendedBehaviors,
        List<String> discouragedBehaviors,
        List<String> limitations,

        VehicleProfileMetadata metadata
) {
}
```

```java
public record VehicleIdentity(
        long tankId,
        String tankCode,
        String tankName,
        int tier,
        VehicleClass vehicleClass,
        String nation
) {
}
```

```java
public record VehicleProfileMetadata(
        String gameVersion,
        int profileSchemaVersion,
        String profileBuilderVersion,
        String source,
        String sourceVersion,
        String sourceHash,
        String armorModelHash,
        String profileHash,
        Instant generatedAt
) {
}
```

---

# 20. Profile 示例

```json
{
  "vehicle": {
    "tankId": 12345,
    "tankCode": "Kranvagn",
    "tankName": "Kranvagn",
    "tier": 10,
    "vehicleClass": "HEAVY",
    "nation": "SWEDEN"
  },
  "configuration": {
    "type": "BASE_TOP_CONFIGURATION",
    "equipmentIncluded": false,
    "provisionsIncluded": false,
    "crewSkillsIncluded": false
  },
  "archetypes": [
    {
      "type": "HULL_DOWN_HEAVY",
      "confidence": 0.91
    },
    {
      "type": "BURST_HEAVY",
      "confidence": 0.88
    }
  ],
  "armor": {
    "frontalProtection": "AVERAGE",
    "turretProtection": "VERY_HIGH",
    "hullProtection": "LOW",
    "hullDownProtection": "VERY_HIGH",
    "anglingBenefit": "LOW"
  },
  "firepower": {
    "alphaRating": "HIGH",
    "clipDamageRating": "VERY_HIGH",
    "sustainedDpmRating": "AVERAGE",
    "firepowerDowntimeRating": "HIGH"
  },
  "mobility": {
    "forwardSpeedRating": "AVERAGE",
    "reverseSpeedRating": "AVERAGE",
    "powerToWeightRating": "AVERAGE",
    "traverseRating": "LOW"
  },
  "strengths": [
    {
      "type": "TURRET_PROTECTION",
      "rating": "VERY_HIGH",
      "evidence": [
        "对代表性 280 mm AP，炮塔正面不可击穿投影面积约 82%",
        "炮塔防护处于 Tier X 重坦前 10%"
      ]
    },
    {
      "type": "CLIP_BURST",
      "rating": "VERY_HIGH",
      "evidence": [
        "弹夹总伤害处于 Tier X 弹夹重坦前 15%"
      ]
    }
  ],
  "weaknesses": [
    {
      "type": "HULL_PROTECTION",
      "rating": "LOW",
      "evidence": [
        "平地正面车体对代表性十级穿深存在较大可击穿投影"
      ]
    },
    {
      "type": "MAGAZINE_DOWNTIME",
      "rating": "HIGH",
      "evidence": [
        "完整弹夹后的火力真空期较长"
      ]
    }
  ],
  "constraints": [
    "打空弹夹前应确认撤退方向或队友掩护",
    "应减少车体在平地交火中的持续暴露",
    "只有在地形确实能够隐藏车体时才能发挥炮塔优势"
  ],
  "recommendedBehaviors": [
    "利用短时间窗口完成弹夹输出",
    "装填期间主动脱离火线",
    "优先使用能够减少车体暴露的位置"
  ],
  "discouragedBehaviors": [
    "在长装填期间停留于敌方火力范围",
    "依赖车体正面进行长时间持续换血",
    "将炮塔防护理解为整车无弱点"
  ],
  "limitations": [
    "未考虑玩家实际装备和补给",
    "未考虑玩家实际乘员技能",
    "Profile 不代表任意距离和角度下的绝对击穿结果",
    "实际战斗中的弹着点和随机穿深可能改变结果"
  ]
}
```

---

# 21. PostgreSQL 的职责

当前阶段 PostgreSQL 不保存车辆研究过程。

PostgreSQL 只保存：

```text
坦克 ID
坦克 code
坦克名称
对应版本
最终 Profile
Profile hash
更新时间
```

不保存：

- 完整装甲模型；
- 三角形；
- 顶点；
- 法线；
- 每条射线结果；
- 全部热力图像素；
- 中间仿真结果；
- 抓取原始 HTML；
- Tankopedia 全量原始响应；
- 复杂构建任务状态；
- 每个数值的独立数据库表。

这些内容只存在于离线 Profile Builder 中。

---

# 22. PostgreSQL 最小表设计

```sql
CREATE TABLE tank_tactical_profile (
    tank_id BIGINT NOT NULL,
    tank_code VARCHAR(128) NOT NULL,
    tank_name VARCHAR(128) NOT NULL,

    game_version VARCHAR(32) NOT NULL,
    profile_schema_version INTEGER NOT NULL,

    profile JSONB NOT NULL,

    source_hash VARCHAR(64),
    profile_hash VARCHAR(64) NOT NULL,

    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (
        tank_id,
        game_version,
        profile_schema_version
    )
);
```

索引：

```sql
CREATE INDEX idx_tank_tactical_profile_lookup
ON tank_tactical_profile (
    tank_id,
    game_version,
    profile_schema_version DESC
);
```

当前阶段不需要把 Profile 拆成几十张表。

`profile JSONB` 直接保存最终 `VehicleTacticalProfile`。

---

# 23. Profile UPSERT

```sql
INSERT INTO tank_tactical_profile (
    tank_id,
    tank_code,
    tank_name,
    game_version,
    profile_schema_version,
    profile,
    source_hash,
    profile_hash,
    generated_at,
    updated_at
)
VALUES (
    :tankId,
    :tankCode,
    :tankName,
    :gameVersion,
    :profileSchemaVersion,
    CAST(:profile AS JSONB),
    :sourceHash,
    :profileHash,
    NOW(),
    NOW()
)
ON CONFLICT (
    tank_id,
    game_version,
    profile_schema_version
)
DO UPDATE SET
    tank_code = EXCLUDED.tank_code,
    tank_name = EXCLUDED.tank_name,
    profile = EXCLUDED.profile,
    source_hash = EXCLUDED.source_hash,
    profile_hash = EXCLUDED.profile_hash,
    generated_at = EXCLUDED.generated_at,
    updated_at = NOW();
```

---

# 24. Java Entity

```java
@Entity
@Table(name = "tank_tactical_profile")
@IdClass(TankTacticalProfileId.class)
public class TankTacticalProfileEntity {

    @Id
    @Column(name = "tank_id", nullable = false)
    private Long tankId;

    @Id
    @Column(name = "game_version", nullable = false)
    private String gameVersion;

    @Id
    @Column(name = "profile_schema_version", nullable = false)
    private Integer profileSchemaVersion;

    @Column(name = "tank_code", nullable = false)
    private String tankCode;

    @Column(name = "tank_name", nullable = false)
    private String tankName;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "profile", columnDefinition = "jsonb", nullable = false)
    private VehicleTacticalProfile profile;

    @Column(name = "source_hash")
    private String sourceHash;

    @Column(name = "profile_hash", nullable = false)
    private String profileHash;

    @Column(name = "generated_at", nullable = false)
    private Instant generatedAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
```

复合 ID：

```java
public class TankTacticalProfileId implements Serializable {

    private Long tankId;
    private String gameVersion;
    private Integer profileSchemaVersion;
}
```

---

# 25. Repository

```java
public interface TankTacticalProfileRepository
        extends JpaRepository<
                TankTacticalProfileEntity,
                TankTacticalProfileId
        > {

    Optional<TankTacticalProfileEntity>
    findFirstByTankIdAndGameVersionOrderByProfileSchemaVersionDesc(
            long tankId,
            String gameVersion
    );

    Optional<TankTacticalProfileEntity>
    findFirstByTankIdOrderByGameVersionDescProfileSchemaVersionDesc(
            long tankId
    );

    List<TankTacticalProfileEntity>
    findByTankIdInAndGameVersion(
            Collection<Long> tankIds,
            String gameVersion
    );
}
```

---

# 26. TankKnowledgeService

```java
public interface TankKnowledgeService {

    VehicleTacticalProfile getFullProfile(
            long tankId,
            String replayVersion
    );

    BattleVehicleSummary getSummary(
            long tankId,
            String replayVersion
    );

    Map<Long, BattleVehicleSummary> getSummaries(
            Collection<Long> tankIds,
            String replayVersion
    );
}
```

运行时查询逻辑：

```text
回放 tankId + 回放版本
        ↓
匹配完全相同版本 Profile
        ↓
没有完全匹配时进行明确降级
        ↓
返回 VehicleTacticalProfile
```

匹配优先级：

```text
1. 完全相同版本
2. 同主次版本的最近旧版本
3. 最近旧版本
4. 当前版本
5. UNKNOWN
```

不能默认使用未来版本分析旧回放。

发生降级时，需要增加 limitation：

```text
当前 Profile 版本与回放版本不完全一致。
```

---

# 27. Caffeine 缓存

PostgreSQL 是持久化源。

运行时可以使用 Caffeine 缓存热点 Profile：

```java
@Cacheable(
    cacheNames = "tank-tactical-profile",
    key = "#tankId + ':' + #replayVersion"
)
public VehicleTacticalProfile getFullProfile(
        long tankId,
        String replayVersion
) {
    // query PostgreSQL
}
```

缓存内容：

- 完整 Profile；
- 简化 Profile；
- 版本匹配结果。

不缓存：

- 原始三维模型；
- 装甲仿真明细；
- 大型热力图。

---

# 28. 回放分析集成

用户上传回放后：

```text
解析回放
→ 获取录像者 tankId
→ 获取对局车辆 tankId
→ 查询录像者完整 Profile
→ 查询关键敌车简化 Profile
→ 提取本场关键事件
→ 判断行为是否符合车辆 Profile
→ 构建 AI Context
→ 调用 DSV4
```

录像者车辆：

```text
使用完整 VehicleTacticalProfile
```

关键敌车：

```text
使用简化 BattleVehicleSummary
```

普通非关键车辆：

```text
只提供 tankId、名称、类型和主要 archetype
```

不需要把 14 辆车的完整 Profile 全部发送给 AI。

---

# 29. 关键敌车筛选

关键敌车包括：

- 对录像者造成大量伤害；
- 被录像者多次攻击；
- 击毁录像者；
- 被录像者击毁；
- 与录像者发生近距离交火；
- 参与关键转折；
- 在玩家死亡前持续形成威胁；
- 与录像者发生明显的装填窗口博弈。

通常只需要选择：

```text
3–6 辆关键车辆
```

---

# 30. 行为与车辆特点匹配

```java
public enum VehicleBehaviorAlignment {
    ALIGNED,
    PARTIALLY_ALIGNED,
    MISALIGNED,
    UNKNOWN
}
```

```java
public record VehicleBehaviorFinding(
        double startTime,
        double endTime,
        VehicleBehaviorAlignment alignment,
        String vehicleRule,
        List<String> vehicleEvidence,
        List<String> battleEvidence,
        double confidence
) {
}
```

---

# 31. 行为匹配示例

## 31.1 弹夹车长装填期间暴露

条件：

```text
弹夹打空
+ 进入长装填
+ 位移距离很小
+ 仍在敌方火力范围
+ 受到明显伤害
```

结果：

```text
MISALIGNED
```

输出证据：

```json
{
  "timeRange": [92.4, 118.7],
  "vehicleRule": "打空弹夹后应脱离火线或依赖队友掩护",
  "vehicleEvidence": [
    "该车完整弹夹后的火力真空期较长"
  ],
  "battleEvidence": [
    "装填期间仅移动 3.2 米",
    "装填期间受到 840 伤害"
  ]
}
```

## 31.2 高单发、低持续 DPM 车辆

条件：

```text
每次开火后及时回撤
+ 避免长时间持续暴露
+ 没有进入不利 DPM 换血
```

结果：

```text
ALIGNED
```

## 31.3 炮塔强、车体弱车辆

条件：

```text
本场存在较长时间车体正面完全暴露
+ 承受多次正面穿透
+ 地图上下文没有证明该位置能够隐藏车体
```

结果：

```text
可能 MISALIGNED
```

但 AI 不能直接说：

```text
你应该在这个位置卖头
```

除非地图知识层确认该位置有合适高低差和掩体。

---

# 32. TankAwareBattleAnalysisContext

```java
public record TankAwareBattleAnalysisContext(
        BattleSummary battle,
        VehicleTacticalProfile ownVehicle,
        List<BattleVehicleSummary> relevantVehicles,
        List<VehicleBehaviorFinding> behaviorFindings,
        List<KeyBattleEvent> keyEvents,
        List<String> limitations
) {
}
```

关键原则：

```text
后端先计算和压缩事实
DSV4 不读取全部原始回放事件
```

不要把数万条位置事件和所有 Tankopedia 原始数值直接发给 DSV4。

---

# 33. DSV4 Harness 设计

DSV4 不需要训练。

通过 Harness 提供：

- 车辆完整 Profile；
- 关键敌车摘要；
- 本场事件；
- 行为匹配结果；
- 地图能力限制；
- 回放数据限制；
- 输出 JSON Schema。

推荐链路：

```text
ReplayFeatureExtractor
        ↓
TankKnowledgeService
        ↓
VehicleBehaviorEvaluator
        ↓
BattleContextAssembler
        ↓
PromptBuilder
        ↓
DSV4
        ↓
OutputValidator
```

---

# 34. DSV4 System Prompt 约束

```text
你是《坦克世界闪击战》回放分析器。

车辆能力、优势、弱点、装甲表现、分位数和战术约束均由后端提供。

必须遵守以下规则：

1. 不得根据车辆名称自行补充输入中不存在的车辆知识。
2. 不得自行计算装甲等效厚度。
3. 不得只根据纸面装甲判断炮弹必定击穿或必定弹开。
4. 不得假设玩家使用了特定装备、补给或乘员技能。
5. 不得假设敌人正在装填，除非事件中明确提供可靠装填窗口。
6. 只能在车辆约束和本场行为存在明确冲突时批评玩家。
7. 每个车辆相关结论必须同时包含车辆证据和回放证据。
8. 不能因为车辆炮塔强，就假设当前地图位置一定适合隐藏车体。
9. 没有地图碰撞和射线数据时，不得判断某处掩体一定有效。
10. 高度差不等于一定存在卖头坡。
11. 车辆具有高机动不代表任意情况下都应当主动冲锋。
12. 车辆具有高血量不代表应该无条件换血。
13. 车辆具有高爆发不代表应该无条件打空弹夹。
14. 数据不足时返回 UNKNOWN，不得猜测。
15. 重点分析玩家本场是否发挥车辆特点，不要输出泛化车辆攻略。
```

---

# 35. DSV4 输入示例

```json
{
  "ownVehicle": {
    "tankId": 12345,
    "name": "Kranvagn",
    "archetypes": [
      "HULL_DOWN_HEAVY",
      "BURST_HEAVY"
    ],
    "strengths": [
      {
        "type": "TURRET_PROTECTION",
        "rating": "VERY_HIGH",
        "evidence": [
          "对 280 mm AP，炮塔正面不可击穿投影面积约 82%"
        ]
      },
      {
        "type": "CLIP_BURST",
        "rating": "VERY_HIGH",
        "evidence": [
          "弹夹总伤害处于同类车辆高分位"
        ]
      }
    ],
    "weaknesses": [
      {
        "type": "HULL_PROTECTION",
        "rating": "LOW"
      },
      {
        "type": "MAGAZINE_DOWNTIME",
        "rating": "HIGH"
      }
    ],
    "constraints": [
      "打空弹夹后应脱离火线或依赖队友掩护",
      "应减少车体在平地交火中的持续暴露"
    ]
  },
  "behaviorFindings": [
    {
      "timeRange": [92.4, 118.7],
      "alignment": "MISALIGNED",
      "vehicleRule": "打空弹夹后应脱离火线",
      "vehicleEvidence": [
        "完整弹夹后的火力真空期较长"
      ],
      "battleEvidence": [
        "装填期间仅移动 3.2 米",
        "装填期间受到 840 伤害"
      ]
    }
  ],
  "limitations": [
    "未取得玩家实际装备",
    "未取得玩家实际补给",
    "没有完整地图碰撞模型",
    "无法确认具体位置是否具备有效卖头条件"
  ]
}
```

---

# 36. DSV4 输出要求

AI 输出必须是结构化 JSON。

```json
{
  "summary": "本场没有充分发挥车辆的弹夹和炮塔优势。",
  "findings": [
    {
      "type": "VEHICLE_USAGE",
      "severity": "HIGH",
      "startTime": 92.4,
      "endTime": 118.7,
      "conclusion": "打空弹夹后未及时脱离火线。",
      "vehicleEvidence": [
        "该车完整弹夹后的火力真空期较长。"
      ],
      "battleEvidence": [
        "装填期间仅移动 3.2 米。",
        "装填期间受到 840 伤害。"
      ],
      "recommendation": "打出最后一发前提前规划后撤方向，并将长装填阶段安排在掩体或队友火力覆盖后方。",
      "confidence": 0.94
    }
  ],
  "limitations": [
    "无法确认该位置是否存在可靠地图掩体。"
  ]
}
```

---

# 37. 离线构建目录建议

```text
tools/
├── tankopedia-importer/
├── armor-model-importer/
├── armor-analyzer/
└── vehicle-profile-builder/
```

构建产物：

```text
build/tank-knowledge/
└── {gameVersion}/
    ├── raw/
    │   ├── tanks.json
    │   └── armor-models/
    ├── normalized/
    │   └── armor-models/
    ├── simulation/
    │   ├── armor-results/
    │   └── heatmaps/
    └── profiles/
        └── tier-10-profiles.json
```

最终只把：

```text
tier-10-profiles.json
```

或者其中的单车 Profile 写入 PostgreSQL。

---

# 38. 装甲热力图

每辆车可以离线生成：

```text
front-flat-ap-280.png
front-angled-25-ap-280.png
front-flat-heat-320.png
hull-down-ap-280.png
side-ap-280.png
```

热力图用途：

- 人工验证；
- 调试装甲分析；
- 前端展示；
- 比较版本变化；
- 检查弱点区域。

热力图不是 DSV4 的主要数据源。

DSV4 主要读取结构化 Profile。

---

# 39. 版本管理

每个 Profile 至少绑定：

```text
gameVersion
profileSchemaVersion
profileBuilderVersion
sourceVersion
sourceHash
armorModelHash
profileHash
generatedAt
```

当数据版本更新时：

```text
下载新版本 Tier X 数据
→ 比较 sourceHash
→ 比较 armorModelHash
→ 重新生成受影响车辆 Profile
→ 检查差异
→ 写入 PostgreSQL
```

旧版本 Profile 可以继续保留。

不需要在 PG 保存所有分析中间数据。

只需要保留最终版本化 Profile。

---

# 40. Profile Hash

Profile Builder 应对规范化 JSON 计算 hash：

```text
profileHash = SHA-256(canonicalProfileJson)
```

用途：

- 判断 Profile 是否变化；
- 避免重复写入；
- 缓存失效；
- AI 分析复现；
- 版本对比；
- 排查生成器异常。

---

# 41. AI 分析缓存

同一份回放在以下条件完全一致时，可以复用结果：

```text
replayContentHash
+
profileHash
+
promptSchemaVersion
+
featureExtractorVersion
+
modelName
```

当前阶段不一定需要增加复杂数据库表。

可以后续根据实际成本再添加。

---

# 42. 推荐实施顺序

## Milestone 1：Tier X 数值导入

完成：

- Tankopedia Importer；
- 只抓 Tier X；
- 统一基础顶配配置；
- 输出标准化 JSON；
- 生成 sourceHash；
- 完成数据校验。

## Milestone 2：派生指标

完成：

- DPM；
- 弹夹总伤害；
- 弹夹倾泻时间；
- 火力真空；
- 功重比；
- Tier X 分位数；
- 同类型分位数；
- 同机制分位数。

## Milestone 3：装甲模型导入

完成：

- 获取装甲模型；
- 识别车辆与模型关系；
- 标准化 mesh；
- 区分主要装甲与间隙装甲；
- 生成 armorModelHash。

## Milestone 4：基础装甲仿真

完成：

- 射线检测；
- 面法线；
- 入射角；
- 基础 AP/APCR/HEAT；
- 固定方向；
- 固定穿深；
- 穿透覆盖率。

## Milestone 5：高级装甲场景

完成：

- 斜摆；
- 高低差；
- 炮塔与车体分离；
- 隐藏车体场景；
- 弱区和强区；
- 姿态收益。

## Milestone 6：VehicleTacticalProfile

完成：

- Armor Profile；
- Firepower Profile；
- Mobility Profile；
- Gun Handling Profile；
- archetypes；
- strengths；
- weaknesses；
- constraints；
- recommended behaviors；
- limitations。

## Milestone 7：PostgreSQL

完成：

- 最小 `tank_tactical_profile` 表；
- JSONB Profile；
- UPSERT；
- Repository；
- TankKnowledgeService；
- Caffeine 缓存。

## Milestone 8：回放集成

完成：

- 根据 tankId 查询 Profile；
- 识别关键敌车；
- 车辆行为匹配；
- 构建 TankAwareBattleAnalysisContext。

## Milestone 9：DSV4 Harness

完成：

- System Prompt；
- JSON Schema；
- 输出验证；
- 禁止自行补充车辆知识；
- 强制车辆证据 + 回放证据；
- 不确定性处理。

---

# 43. 数据校验要求

每次导入必须检查：

```text
所有车辆 tier == 10
tankId 唯一
tankCode 非空
tankName 非空
vehicleClass 有效
hitPoints > 0
alphaDamage > 0
penetration > 0
forwardSpeed > 0
clipCapacity >= 1
模型能够匹配 tankId
模型顶点和三角面有效
装甲厚度大于零
Profile hash 可重复生成
```

如果车辆数量相比上一个版本异常下降，需要终止发布。

---

# 44. 测试要求

## 44.1 Importer 测试

- 只导入 Tier X；
- 不解析错误层级；
- 页面字段变化时明确失败；
- 不静默填入错误默认值；
- hash 稳定；
- 重复 tankId 检测。

## 44.2 Armor Analyzer 测试

- 垂直装甲；
- 倾斜装甲；
- 正面；
- 侧面；
- 炮塔；
- 车体；
- 间隙装甲；
- 多层射线；
- AP；
- APCR；
- HEAT；
- 斜摆；
- 高低差；
- 同一输入结果可复现。

## 44.3 Profile Builder 测试

- 普通 DPM；
- 弹夹 DPM；
- clipDamage；
- clipDumpTime；
- firepowerDowntime；
- powerToWeight；
- 各类 percentile；
- archetype；
- strengths 和 evidence；
- weaknesses 和 evidence；
- 不生成互相矛盾的结论。

## 44.4 PostgreSQL 测试

- Profile 写入；
- Profile 更新；
- 版本并存；
- JSONB 映射；
- 根据 tankId 和版本查询；
- fallback；
- 缓存失效。

## 44.5 AI Context 测试

- 录像者使用完整 Profile；
- 关键敌车使用摘要；
- 不发送完整装甲模型；
- 不发送全部 Tier X 数据；
- 每个 finding 同时包含车辆证据和回放证据；
- limitations 不被遗漏。

---

# 45. 明确禁止

不要：

- 让 DSV4 直接读取完整三维装甲模型；
- 让 DSV4 自行计算等效装甲；
- 只根据纸面厚度评价车辆；
- 只根据车辆名称让模型回忆攻略；
- 把第三方攻略文章直接作为事实；
- 在用户请求中实时抓取 Tankopedia；
- 在用户请求中实时运行装甲仿真；
- 把所有中间分析数据塞进 PostgreSQL；
- 把全部 Tier X Profile 都发给 DSV4；
- 假设玩家实际使用某个装备；
- 假设玩家实际使用某个补给；
- 假设敌人正在装填；
- 将炮塔强直接等同于任意位置都能卖头；
- 将纸面装甲高等同于必定弹开；
- 将高血量等同于应该主动换血；
- 将高爆发等同于必须打空弹夹；
- 在数据不足时生成确定性结论。

---

# 46. 最终 PostgreSQL 结构

最终只需要一张核心表：

```sql
CREATE TABLE tank_tactical_profile (
    tank_id BIGINT NOT NULL,
    tank_code VARCHAR(128) NOT NULL,
    tank_name VARCHAR(128) NOT NULL,

    game_version VARCHAR(32) NOT NULL,
    profile_schema_version INTEGER NOT NULL,

    profile JSONB NOT NULL,

    source_hash VARCHAR(64),
    profile_hash VARCHAR(64) NOT NULL,

    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (
        tank_id,
        game_version,
        profile_schema_version
    )
);
```

PG 的职责：

```text
tankId
→ 查找到对应版本的最终 VehicleTacticalProfile
```

PG 不负责保存：

```text
原始装甲模型
模型顶点
模型三角面
完整射线结果
仿真中间数据
抓取过程
所有车辆原始数据
```

---

# 47. 最终运行流程

```text
用户上传回放
        ↓
解析回放并获得 tankId
        ↓
根据 tankId 和回放版本查询 PostgreSQL
        ↓
获得 VehicleTacticalProfile
        ↓
提取关键敌车简化 Profile
        ↓
分析本场行为是否符合车辆特点
        ↓
构建 TankAwareBattleAnalysisContext
        ↓
通过 Harness 调用 DSV4
        ↓
验证 JSON 输出
        ↓
展示 AI 复盘
```

---

# 48. 最终产品示例

AI 最终可以输出：

```text
这辆车的主要优势是炮塔防护和弹夹爆发，但车体正面防护低于其炮塔水平。

本场 74–96 秒，你在车体持续暴露的情况下进行正面对射。车辆 Profile 显示，该车对代表性十级 AP 穿深时，
平地正面车体存在较大的可击穿投影，因此这段交火没有充分发挥炮塔防护优势。

92.4 秒打空弹夹后，你在约 26 秒的火力真空期内仅移动了 3.2 米，并受到 840 伤害。该行为与这辆车需要在长装填期间脱离火线的使用约束冲突。

建议：

1. 打出弹夹最后一发前提前规划撤退方向。
2. 长装填期间优先脱离敌方直接火力范围。
3. 减少车体在平地正面对射中的持续暴露。
4. 优先寻找能够减少车体暴露的位置。

当前系统没有完整地图碰撞和射线数据，因此无法确认本场具体坐标是否具备有效卖头条件。
```

---

# 49. 最终核心原则

```text
Tankopedia 提供车辆原始数据
装甲模型提供防护证据
离线工具负责装甲和数值计算
VehicleTacticalProfile 提供结构化车辆知识
PostgreSQL 只保存最终 Profile
回放提供本场行为证据
Harness 负责组织上下文和规则
DSV4 负责最终解释
```

最终目标不是让 DSV4 “记住所有坦克”。

最终目标是：

```text
让 DSV4 在每次分析时，都能拿到准确、精简、版本化、
可验证并且与本场事件直接相关的车辆知识。
```
````


