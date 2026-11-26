package com.wotb.core.model;


import java.util.List;
import java.util.Map;

public class PlayerResult {
    public long accountId;
    public int team;
    public long tankId;
    public int nShots;
    public int nHitsDealt;
    public int nPenetrationsDealt;
    public int damageDealt;
    public int damageAssisted;
    public int damageReceived;
    public int nHitsReceived;
    public int nPenetrationsReceived;
    public int nEnemiesDamaged;
    public int kills;
    public int damageBlocked;
    public int victoryPointsEarned;
    public int victoryPointsSeized;
    public boolean survived;
    public int xp;
    public int credits;

    public String nickname = "";
    public String clan = "";
    public Long prebattleGroupId;
    public Long rank;

    public String tankName = "";

    public Double contribution;
    public Double kast;
    public Double impact;
    public Integer observedMaxHp;

    public EntryHpSource entryHpSource;

    public Integer entryHp;
    public Object tankTier = "";
    public String tankType = "";
    public String tankNation = "";
    public Object alphaDamage = "";

    @Deprecated(forRemoval = false)
    public long deathTimeMillis;

    public long settlementResultEntityId;
    public double settlementLifeTimeSec;
    public Long settlementKillerResultEntityId;
    public Integer settlementDeathReasonRaw;
    public Long killerAccountId;

    @Deprecated(forRemoval = false)
    public double survivalTimeSec;

    public Map<Integer, List<Object>> raw;
}
