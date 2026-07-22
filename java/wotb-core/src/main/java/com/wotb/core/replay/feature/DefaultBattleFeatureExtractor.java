package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.BattleEndedEvent;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.VehicleDestroyedEvent;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

import java.util.ArrayList;
import java.util.List;

/**
 * 默认战斗特征提取器（第一阶段：为 AI 战术复盘提供关键事件时间线）。
 * <p>
 * 从领域事件流中提取"关键事件"：首次伤害、车辆击毁、高额伤害、战斗结束。
 * 只做保守、可从数据直接得出的标注，不猜测未知信息。
 * </p>
 */
public class DefaultBattleFeatureExtractor implements BattleFeatureExtractor {

    /** 单次伤害达到此阈值视为高额伤害（DAMAGE_SPIKE） */
    static final int DAMAGE_SPIKE_THRESHOLD = 400;

    /** 关键事件数量上限，避免时间线过长撑爆 prompt */
    static final int MAX_KEY_EVENTS = 60;

    @Override
    public BattleFeatureSet extract(ReplayReconstruction reconstruction, BattleStateSnapshot finalState) {
        final String battleId = battleId(reconstruction);
        final List<KeyBattleEvent> keyEvents = new ArrayList<>();

        boolean firstBloodRecorded = false;

        for (final ReplayEvent event : reconstruction.events()) {
            if (keyEvents.size() >= MAX_KEY_EVENTS) {
                break;
            }
            switch (event) {
                case DamageEvent d -> {
                    if (d.damage() <= 0) {
                        continue;
                    }
                    if (!firstBloodRecorded) {
                        firstBloodRecorded = true;
                        keyEvents.add(new KeyBattleEvent(
                                clockOf(d.timestamp()), "FIRST_BLOOD",
                                "首次伤害 EID" + d.attackerEid() + " → EID" + d.victimEid()
                                        + " (" + d.damage() + ")"));
                    } else if (d.damage() >= DAMAGE_SPIKE_THRESHOLD) {
                        keyEvents.add(new KeyBattleEvent(
                                clockOf(d.timestamp()), "DAMAGE_SPIKE",
                                "高额伤害 EID" + d.attackerEid() + " → EID" + d.victimEid()
                                        + " (" + d.damage() + ")"));
                    }
                }
                case VehicleDestroyedEvent v -> keyEvents.add(new KeyBattleEvent(
                        clockOf(v.timestamp()), "VEHICLE_DESTROYED",
                        "击毁 EID" + v.entityId()
                                + (v.killerEid() != null ? " (击毁者 EID" + v.killerEid() + ")" : "")
                                + (v.inferred() ? " [推断]" : "")));
                case BattleEndedEvent b -> keyEvents.add(new KeyBattleEvent(
                        clockOf(b.timestamp()), "BATTLE_END",
                        "战斗结束" + (b.winnerTeam() != null ? " 胜方队伍 " + b.winnerTeam() : "")));
                default -> {
                    // 其他事件不作为关键事件
                }
            }
        }

        return new BattleFeatureSet(battleId, List.copyOf(keyEvents), true);
    }

    private static String battleId(ReplayReconstruction reconstruction) {
        final String arenaId = reconstruction.metadata() != null
                ? reconstruction.metadata().arenaId() : null;
        return (arenaId != null && !arenaId.isBlank()) ? arenaId : "unknown";
    }

    /** 优先使用战斗时钟，未识别时回退到原始时钟。 */
    private static float clockOf(ReplayTimestamp ts) {
        if (ts == null) {
            return 0f;
        }
        return ts.battleClockSec() != null ? ts.battleClockSec() : ts.rawClockSec();
    }
}
