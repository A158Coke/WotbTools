package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.event.ShotResultEvent;
import com.wotb.core.replay.facts.ShotFact;
import com.wotb.core.replay.facts.ShotResolution;
import com.wotb.core.replay.facts.TargetingShotPair;
import com.wotb.core.replay.feature.EngagementSummary;
import com.wotb.core.replay.feature.KeyBattleEvent;
import com.wotb.core.replay.feature.MapCoordinateResolution;
import com.wotb.core.replay.feature.MapRegionResolver;
import com.wotb.core.replay.feature.MovementSegment;
import com.wotb.core.replay.feature.SinglePlayerBattleAnalysisContext;
import com.wotb.core.util.PlayerResultFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

final class PlayerReplayEventFormatter {
    private PlayerReplayEventFormatter() {
    }

    private static String regionLabel(final float rawX, final float rawZ, final String mapCode) {
        final MapCoordinateResolution res = MapRegionResolver.resolve(rawX, rawZ, mapCode);
        if (!res.usable()) return "未知区域";
        return res.region() + "区";
    }

    static void appendEventStreamEvidence(final StringBuilder sb,
                                          final SinglePlayerBattleAnalysisContext ctx,
                                          final Battle battle) {
        final var features = ctx.features();

        sb.append("\n=== 重建补充 ===\n");
        if (ctx.recorder() != null && ctx.recorder().resolved()) {
            sb.append("你的 entity 已映射, 特征集可用\n");
            sb.append("你: 账号 ").append(ctx.recorder().accountId())
                    .append(" | 车辆: ").append(PlayerResultFormat.quoteForPrompt(ReplayDisplayNames.tankName(ctx.recorder().tankId(), null)))
                    .append(" | 车种: ").append(ReplayDisplayNames.tankClass(ctx.recorder().tankId() != null ? ctx.recorder().tankId() : 0L))
                    .append('\n');
        } else {
            sb.append("位置流存在, 但你的实体无法可靠映射\n");
        }

        appendRecorderMovementEvidence(sb, features.movements(),
                battle == null ? null : battle.mapName);
        appendRecorderShotEvidence(sb, features.shots(), features.targetingPairs());

        if (features.keyEvents() != null && !features.keyEvents().isEmpty()) {
            sb.append("\n=== KEY_EVENTS_BACKEND_COMPUTED（关键事件·后端计算） ===\n");
            String lastEventKey = null;
            for (final KeyBattleEvent ke : features.keyEvents()) {
                final String eventKey = ke.clockSec() + "|" + ke.type();
                if (eventKey.equals(lastEventKey)) continue;
                lastEventKey = eventKey;
                sb.append(PlayerAnalysisTerms.battleClock(ke.clockSec())).append(" | ")
                        .append(PlayerAnalysisTerms.keyEventLabel(ke.type()));
                if (ke.label() != null && !ke.label().isEmpty()) {
                    sb.append(" | ").append(PlayerResultFormat.quoteForPrompt(ke.label()));
                }
                sb.append(" | 置信度=").append(PlayerAnalysisTerms.confidenceLabel(ke.confidence()));
                sb.append('\n');
            }
        }

        int observedDealt = 0;
        int observedReceived = 0;
        if (!features.engagements().isEmpty()) {
            for (final EngagementSummary e : features.engagements()) {
                observedDealt += e.damageDealt();
                observedReceived += e.damageReceived();
            }
            final int finalAuthDealt = battle.recorderResult() != null ? battle.recorderResult().damageDealt : 0;
            final int finalAuthRecv = battle.recorderResult() != null ? battle.recorderResult().damageReceived : 0;
            sb.append("\n=== 交火段（事件流观测子集） ===\n");
            final boolean observedPartial = features.limitations() != null
                    && features.limitations().contains("OBSERVED_DAMAGE_IS_PARTIAL");
            if (observedPartial) {
                sb.append("权威结算总输出: ").append(finalAuthDealt)
                        .append(" | 事件流观测子集覆盖不全（OBSERVED_DAMAGE_IS_PARTIAL），")
                        .append("观测数字已抑制；以权威结算为唯一可信口径，不得引用事件流观测数字。\n");
            } else {
                sb.append("权威结算总输出: ").append(finalAuthDealt)
                        .append(" | 事件流观测输出子集: ").append(observedDealt)
                        .append(" (").append(String.format("%.0f%%", finalAuthDealt > 0 ? 100.0 * observedDealt / finalAuthDealt : 0))
                        .append(")\n");
                sb.append("权威结算总损失血量: ").append(finalAuthRecv)
                        .append(" | 事件流观测损失血量子集: ").append(observedReceived)
                        .append(" (").append(String.format("%.0f%%", finalAuthRecv > 0 ? 100.0 * observedReceived / finalAuthRecv : 0))
                        .append(")\n");
                sb.append("注意: 事件流数值仅为观测子集, 不是整场权威总伤害.\n");
            }
            if (!observedPartial) {
                for (final EngagementSummary e : features.engagements()) {
                    sb.append("  #" + " ")
                            .append(PlayerAnalysisTerms.battleRange(e.startTime(), e.endTime()))
                            .append(" 事件流输出: ").append(e.damageDealt())
                            .append(" 事件流损失血量: ").append(e.damageReceived())
                            .append(" 置信度: ").append(PlayerAnalysisTerms.confidenceLabel(e.confidence()))
                            .append('\n');
                }
            }
        }

        final String phaseSection = BattlePhaseTimelineSection.renderPlayerSection(features.phases());
        if (!phaseSection.isEmpty()) {
            sb.append("\n").append(phaseSection);
        }

        sb.append("\n覆盖: ").append(ctx.coverage() != null ? ctx.coverage().decodedPacketRatio() : "N/A").append('\n');

        if (!ctx.limitations().isEmpty()) {
            sb.append("\n=== 数据限制 ===\n");
            for (final String limitation : ctx.limitations()) {
                sb.append("- ").append(limitation).append('\n');
            }
        }
    }

    static void appendRecorderMovementEvidence(final StringBuilder sb,
                                               final List<MovementSegment> movements,
                                               final String mapCode) {
        if (movements == null || movements.isEmpty()) {
            return;
        }
        sb.append("\n=== RECORDER_REGION_TIMELINE_BACKEND_COMPUTED（你的区域时间线·后端计算） ===\n");
        final java.util.ArrayList<String> orderedRegions = new java.util.ArrayList<>();
        String lastRegion = null;
        for (final MovementSegment seg : movements) {
            final int startRegion = seg.rawStartPosition() != null
                    ? MapRegionResolver.resolveRegionFromRaw(
                            seg.rawStartPosition().x(), seg.rawStartPosition().z(), mapCode) : 0;
            final int endRegion = seg.rawEndPosition() != null
                    ? MapRegionResolver.resolveRegionFromRaw(
                            seg.rawEndPosition().x(), seg.rawEndPosition().z(), mapCode) : 0;
            final String startStr = startRegion > 0 ? startRegion + "区" : "未知区域";
            final String endStr = endRegion > 0 ? endRegion + "区" : "未知区域";
            if (!startStr.equals(lastRegion)) {
                sb.append(PlayerAnalysisTerms.battleClock(seg.startTime())).append("：").append(startStr).append('\n');
                if (startRegion > 0) orderedRegions.add(String.valueOf(startRegion));
                lastRegion = startStr;
            }
            if (!endStr.equals(lastRegion)) {
                sb.append(PlayerAnalysisTerms.battleClock(seg.endTime())).append("：").append(endStr).append('\n');
                if (endRegion > 0) orderedRegions.add(String.valueOf(endRegion));
                lastRegion = endStr;
            }
        }
        if (!orderedRegions.isEmpty()) {
            sb.append("压缩区域序列：").append(String.join("→", orderedRegions)).append('\n');
            sb.append("最终区域：").append(orderedRegions.getLast()).append("区\n");
        }
        sb.append("\n=== 移动段（压缩） ===\n");
        for (final MovementSegment seg : movements) {
            sb.append("  ").append(PlayerAnalysisTerms.battleRange(seg.startTime(), seg.endTime())).append(" ")
                    .append(PlayerAnalysisTerms.movementLabel(seg.type())).append(" | 距离 ")
                    .append(String.format("%.1f", seg.distance()))
                    .append("m 速度 ").append(String.format("%.1f", seg.averageSpeed())).append("m/s");
            if (seg.rawStartPosition() != null) {
                sb.append(" 从").append(regionLabel(
                        seg.rawStartPosition().x(), seg.rawStartPosition().z(), mapCode));
            }
            if (seg.rawEndPosition() != null) {
                sb.append(" 到").append(regionLabel(
                        seg.rawEndPosition().x(), seg.rawEndPosition().z(), mapCode));
            }
            sb.append('\n');
        }
    }

    static void appendRecorderShotEvidence(final StringBuilder sb,
                                           final List<ShotFact> shots,
                                           final List<TargetingShotPair> targetingPairs) {
        if (shots == null || shots.isEmpty()) {
            return;
        }
        final java.util.Map<Integer, TargetingShotPair> pairs = new java.util.HashMap<>();
        if (targetingPairs != null) {
            for (final TargetingShotPair p : targetingPairs) {
                pairs.put(p.shotId(), p);
            }
        }
        final StringBuilder section = new StringBuilder();
        section.append("\n=== RECORDER_COMBAT_FACTS_BACKEND_COMPUTED（你的射击/命中事实·后端计算） ===\n");
        section.append("说明: 回放协议已证明的射击/命中观测; 未知项标注 UNKNOWN, 不得补全为 0 或「无事件」.\n");
        int shown = 0;
        for (final ShotFact shot : shots) {
            if (!shot.recorderShot()) {
                continue;
            }
            shown++;
            section.append("  ").append(PlayerAnalysisTerms.battleClock((float) shot.launchTimeSec()))
                    .append(" 发射");
            if (shot.ammoSelection() != null) {
                section.append(" | 弹药选择=").append(shot.ammoSelection());
            } else {
                section.append(" | 弹药选择=UNKNOWN");
            }
            if (shot.ammoDescriptorRaw() != null) {
                section.append(" | 弹种描述符=0x")
                        .append(Integer.toHexString(shot.ammoDescriptorRaw()).toUpperCase(Locale.ROOT));
            }
            final TargetingShotPair pair = pairs.get(shot.shotId());
            if (pair != null) {
                section.append(" | 开火前散布=").append(pair.dispersionBloomBefore() == null
                        ? "UNKNOWN" : String.format(Locale.ROOT, "%.4f", pair.dispersionBloomBefore()));
                if (pair.bloomIncreaseAfterShot() != null) {
                    section.append(" 开火后散布增量=+")
                            .append(String.format(Locale.ROOT, "%.4f", pair.bloomIncreaseAfterShot()));
                }
                if (pair.turretYawBeforeShotRad() != null) {
                    section.append(" 开火前炮塔相对偏航=")
                            .append(String.format(Locale.ROOT, "%.3f", pair.turretYawBeforeShotRad()));
                }
                if (pair.gunPitchBeforeShotRad() != null) {
                    section.append(" 开火前炮管俯仰=")
                            .append(String.format(Locale.ROOT, "%.3f", pair.gunPitchBeforeShotRad()));
                }
            }
            if (shot.terminalPosition() != null) {
                section.append(" | 命中终点");
            }
            if (shot.resolution() != null) {
                section.append(" | 命中结果: ").append(shotResultLabel(shot.resolution()));
            } else {
                section.append(" | 命中结果=UNKNOWN");
            }
            section.append('\n');
        }
        if (shown > 0) {
            sb.append(section);
        }
    }

    private static String shotResultLabel(final ShotResolution r) {
        final java.util.ArrayList<String> parts = new java.util.ArrayList<>();
        if (r.directKill()) parts.add("直接击杀");
        if (r.targetAlreadyDead()) parts.add("目标已阵亡");
        if (r.fireStarted()) parts.add("起火");
        if (r.ricochet()) parts.add("跳弹");
        if (r.projectileMaterialPierced()) parts.add("弹体击穿");
        if (r.projectileMaterialStopped()) parts.add("弹体未击穿");
        if (r.projectileZeroDfArmorPierced()) parts.add("间隙装甲击穿");
        if (r.projectileZeroDfArmorNotPierced()) parts.add("间隙装甲未击穿");
        if (r.projectileComponentInvolvement()) parts.add("组件波及");
        if (r.projectileTrackChassisDamage()) parts.add("履带受损");
        if (r.projectileGunDamage()) parts.add("炮管受损");
        if (r.explosionMaterialPositiveDf()) parts.add("爆炸-材料分支");
        if (r.explosionZeroDfArmor()) parts.add("爆炸-间隙装甲分支");
        if (r.explosionComponentInvolvement()) parts.add("爆炸-组件波及");
        if (r.explosionComponentDamage()) parts.add("爆炸-组件损坏");
        if (!r.modifierIds().isEmpty()) {
            final java.util.ArrayList<String> mods = new java.util.ArrayList<>();
            for (final Integer m : r.modifierIds()) {
                mods.add(m == 1 ? "精准射击" : m == 2 ? "钨芯弹" : "modifier#" + m);
            }
            parts.add("特殊弹药: " + String.join("+", mods));
        }
        for (final ShotResultEvent.ComponentResult c : r.components()) {
            final String kind = ShotResultEvent.ComponentKind.of(c.token()) == ShotResultEvent.ComponentKind.UNKNOWN
                    ? "组件#" + c.token() : ShotResultEvent.ComponentKind.of(c.token()).name().toLowerCase(Locale.ROOT);
            final String state = c.state() == 2 ? "瘫痪" : c.state() == 1 ? "损坏" : "波及";
            parts.add(kind + ":" + state);
        }
        return parts.isEmpty() ? "无解析事实(原始flags=0x" + Integer.toHexString(r.rawFlags16()) + ")"
                : String.join("、", parts);
    }
}
