package com.wotb.core.model;


import java.util.List;
import java.util.Map;

/** 一名玩家在一场战斗中的战绩 (对应 protobuf #301 -> #2)。 */
public class PlayerResult {
    // 解析自 protobuf 的原始战绩
    public long accountId;
    public int team;
    public long tankId;
    public int nShots;
    public int nHitsDealt;
    public int nPenetrationsDealt;
    public int damageDealt;
    public int damageAssisted;     // #9 + #10
    public int damageReceived;
    public int nHitsReceived;
    public int nPenetrationsReceived;
    public int nEnemiesDamaged;
    public int kills;
    public int damageBlocked;
    /** 占点得分（protobuf #32，supremacy 争霸赛逐人统计）。 */
    public int victoryPointsEarned;
    /** 占点占领分（protobuf #33，supremacy 争霸赛逐人统计）。 */
    public int victoryPointsSeized;
    public boolean survived;
    public int xp;
    public int credits;

    // 名册信息
    public String nickname = "";
    public String clan = "";
    /** #201 field2 = prebattle/training-room grouping ID（PR147: NOT a platoon ID；battle-results.md）。 */
    public Long prebattleGroupId;
    public Long rank;

    // 展示派生字段 (enrich)
    public String tankName = "";

    // 单场表现派生字段 (PerformanceMetricsCalculator.populateBattle 回填; null = HP unknown 时 unavailable)
    public Double contribution;
    public Double kast;
    public Double impact;
    /** 本场实测最大血量（type-7 propId=3 含装备加成，经 ObservedMaxHp.populate 回填；null=未解析）。
     * 注意：这只是「整场观测到的最大当前 HP」，不是进场满血——不得直接当 entry full HP。 */
    public Integer observedMaxHp;

    /** 进场满血量 provenance（经 ObservedMaxHp.populate 回填；null=未回填，调用方按 BASE_FALLBACK 处理）。
     * 仅 {@link EntryHpSource#OBSERVED_EXACT} 时 {@link #entryHp} 才是已证明的 actual entry full HP。 */
    public EntryHpSource entryHpSource;

    /** 已证明的进场满血量（含装备/物资加成）；仅 entryHpSource==OBSERVED_EXACT 时有效，否则为 null。 */
    public Integer entryHp;
    public Object tankTier = "";
    public String tankType = "";
    public String tankNation = "";
    public Object alphaDamage = "";

    /** @deprecated compatibility projection of settlementLifeTimeSec; not an authority. */
    @Deprecated(forRemoval = false)
    public long deathTimeMillis;

    // ---- PR147 settlement 原始证据（battle_results.dat #301；均未 reconciliation，只保留 raw）----
    /** #301 <b>outer</b> field1 = result/entity ID（killerID 与 field25 用同一 namespace，经此映射到 accountId）。 */
    public long settlementResultEntityId;
    /** #301 inner field24 = lifeTime（秒；阵亡时=结算死亡秒；存活时=整场时长；未证明时 0）。 */
    public double settlementLifeTimeSec;
    /** #301 inner field25 = 击杀者 result/entity ID（非 accountId；用 {@link #settlementResultEntityId} namespace 解析；缺失=null。 */
    public Long settlementKillerResultEntityId;
    /** #301 inner field105 = deathReason 原始值（-1=幸存 sentinel；其它=死亡原因 raw；缺失=null）。 */
    public Integer settlementDeathReasonRaw;
    /** 由 field25 killer result id 经 result/entity-id → accountId 映射得到的击杀者账号（=0/null 表示无法证明/环境击杀）。 */
    public Long killerAccountId;

    /** @deprecated compatibility projection of settlementLifeTimeSec/duration; not an authority. */
    @Deprecated(forRemoval = false)
    public double survivalTimeSec;

    // 完整原始字段 (字段号 -> 值列表), 供"原始字段"表/排查
    public Map<Integer, List<Object>> raw;
}
