package com.wotb.core.model;

import com.wotb.core.replay.evidence.EntryHpSource;
import com.wotb.core.stats.PotentialDamage;

import java.util.ArrayList;
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

    // 潜在伤害: 当前保留字段链路; 逐击杀目标明细解析完成前等于实际伤害。
    public final List<PotentialDamage.KillVictim> killVictims = new ArrayList<>();
    public int potentialDamage;
    public int potentialDamageSupplement;
    public boolean potentialDamageDetailed;

    // 名册信息
    public String nickname = "";
    public String clan = "";
    public Long platoonId;
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
    public String platoonLabel = "";

    // 原始死亡时刻(ms; proto #104; 存活/未知=0)
    public long deathTimeMillis;

    // 存活时间(秒, 由 ReplayParser 计算)
    public double survivalTimeSec;

    // 明细表临时字段 (每场不同)
    public String tmpDate = "";
    public String tmpMap = "";
    public String tmpResult = "";

    // 完整原始字段 (字段号 -> 值列表), 供"原始字段"表/排查
    public Map<Integer, List<Object>> raw;
}
