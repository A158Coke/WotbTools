package com.wotb.web.replay.ai;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

import com.wotb.core.processing.AnalysisUnitResult;
import com.wotb.core.processing.BattleGroupingKey;
import com.wotb.core.processing.ReplayAnalysisScope;
import com.wotb.core.processing.ReplayPerspectiveGroup;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.RecorderEntityMapping;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;

/**
 * 分析单元映射与计数组装的唯一实现。
 * <p>负责把 {@link ReplayPerspectiveGroup} 映射为稳定的 {@code analysisUnitId}
 * 与不携带 AI 文本的 {@link AnalysisUnitResult}，并暴露给 Player/Team 编排复用。
 * 纯映射，不含业务判断；不发送 HTTP、不构建 Prompt。</p>
 */
public final class AnalysisUnitAssembler {

    private AnalysisUnitAssembler() {
    }

    /**
     * 构建分析单元列表（不含 AI 结果，用于 controller 响应的 units 字段）。
     */
    public static List<AnalysisUnitResult> buildAnalysisUnits(
            final List<ReplayPerspectiveGroup> groups,
            final ReplayAnalysisScope scope) {
        return groups.stream()
                .map(g -> new AnalysisUnitResult(
                        analysisUnitId(g),
                        g.battleIdentity(),
                        scope,
                        g.key().perspectiveTeam(),
                        g.representative().fileName(),
                        g.duplicates().stream().map(ReplayProcessingResult::fileName).toList(),
                        null, null
                ))
                .toList();
    }

    /**
     * 为单个 perspective group 生成稳定、permutation 无关的 {@code analysisUnitId}。
     */
    public static String analysisUnitId(final ReplayPerspectiveGroup group) {
        final BattleGroupingKey key = group.key().battleKey();
        final String battlePart = switch (key.type()) {
            case ARENA -> "arena-" + key.arenaUniqueId();
            case COMPOSITE -> {
                final String raw = key.mapCode() + "|" + key.clientVersion() + "|" + key.battleStartEpochSecond();
                yield "battle-" + sha256(raw).substring(0, 16);
            }
            case FALLBACK -> "hash-" + key.uniqueFallback().substring(0, Math.min(16, key.uniqueFallback().length()));
        };
        final int teamHash = (battlePart + "-p" + group.key().perspectiveTeam()).hashCode() & 0xffff;
        return battlePart + "-u" + Integer.toHexString(teamHash);
    }

    /**
     * 查找录像者在重建结果中的 entity 映射。
     */
    public static RecorderEntityMapping findRecorder(final ReplayProcessingResult rep) {
        if (rep.reconstruction() != null) {
            final Map<Long, Integer> entityByAccount = new java.util.HashMap<>();
            for (final var e : rep.reconstruction().events()) {
                if (e instanceof ParticipantMappingEvent pm) {
                    entityByAccount.put(pm.accountId(), pm.entityId());
                }
            }
            for (final var p : rep.reconstruction().participants()) {
                if (p.recorder()) {
                    final Integer eid = entityByAccount.get(p.accountId());
                    return new RecorderEntityMapping(p.accountId(), p.tankId(),
                            eid, p.nickname(), p.team(), p.tankId(),
                            eid != null ? DecodeConfidence.EXACT : DecodeConfidence.INFERRED);
                }
            }
        }
        if (rep.battle() != null && rep.battle().recorder != null)
            return new RecorderEntityMapping(null, null, null,
                    rep.battle().recorder, 0, 0, DecodeConfidence.INFERRED);
        return RecorderEntityMapping.unresolved();
    }

    static String sha256(final String input) {
        try {
            final var md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(input.getBytes(StandardCharsets.UTF_8)));
        } catch (final NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }
}