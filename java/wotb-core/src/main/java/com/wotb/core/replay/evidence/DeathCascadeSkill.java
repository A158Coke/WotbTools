package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 阵亡连锁 Skill：同一方在短时间窗口内连续阵亡产生证据。
 * <p>时间统一消费 {@link PlayerResultFormat#deathSec(Battle, PlayerResult)} 的 canonical death authority；
 * UNKNOWN（deathSec<=0）不得进入聚类，避免伪造“0 秒阵亡”。Skill 只描述发生了什么，
 * 不判断是否犯错。</p>
 */
public final class DeathCascadeSkill {

    public static final float CASCADE_GAP_SEC = 12f;
    public static final int MIN_CASCADE_SIZE = 2;
    public static final int MAX_CASCADES = 4;

    /**
     * @param recorderTeam 录像者所在队伍（可为 null，此时用 TEAM_1/TEAM_2 标记）
     */
    public List<AiEvidence> detect(final Battle battle, final Integer recorderTeam) {
        if (battle == null || battle.players == null) {
            return List.of();
        }
        final List<Death> deaths = battle.players.stream()
                .filter(p -> !p.survived)
                .map(p -> new Death(
                        (float) PlayerResultFormat.deathSec(battle, p),
                        p.team,
                        p.accountId,
                        p.tankId,
                        ReplayDisplayNames.tankName(p.tankId, p.tankName)))
                .filter(d -> d.sec() > 0f && Float.isFinite(d.sec()))
                .sorted(Comparator.comparingDouble(Death::sec))
                .toList();
        if (deaths.isEmpty()) {
            return List.of();
        }

        // 按队伍分别聚类，避免异队阵亡插入打断同队连锁
        final Map<Integer, List<Death>> byTeam = new LinkedHashMap<>();
        for (final Death d : deaths) {
            byTeam.computeIfAbsent(d.team(), ignored -> new ArrayList<>()).add(d);
        }
        final List<Cascade> cascades = new ArrayList<>();
        for (final List<Death> teamDeaths : byTeam.values()) {
            List<Death> current = new ArrayList<>();
            for (final Death d : teamDeaths) {
                if (current.isEmpty()) {
                    current.add(d);
                    continue;
                }
                if (d.sec() - current.getLast().sec() <= CASCADE_GAP_SEC) {
                    current.add(d);
                } else {
                    if (current.size() >= MIN_CASCADE_SIZE) {
                        cascades.add(new Cascade(current));
                    }
                    current = new ArrayList<>();
                    current.add(d);
                }
            }
            if (current.size() >= MIN_CASCADE_SIZE) {
                cascades.add(new Cascade(current));
            }
        }
        cascades.sort(Comparator.comparingDouble(Cascade::firstSec));

        final List<AiEvidence> result = new ArrayList<>();
        int index = 0;
        for (final Cascade cascade : cascades) {
            if (index >= MAX_CASCADES) {
                break;
            }
            index++;
            final int friendlyDeaths = cascade.teamDeaths(recorderTeam);
            final int enemyDeaths = cascade.teamDeaths(opposite(recorderTeam));
            final Map<String, Double> numbers = new HashMap<>();
            numbers.put("friendlyDeaths", (double) friendlyDeaths);
            numbers.put("enemyDeaths", (double) enemyDeaths);
            numbers.put("totalDeaths", (double) cascade.size());
            final List<EntityRef> entities = cascade.deaths().stream()
                    .map(d -> new EntityRef(null,
                            d.accountId() > 0 ? d.accountId() : null,
                            d.team(),
                            d.tankId() > 0 ? (int) d.tankId() : null,
                            d.tankName()))
                    .toList();
            final String teamLabel = recorderTeam != null && cascade.team() == recorderTeam
                    ? "FRIENDLY" : "TEAM_" + cascade.team();
            final String summary = String.format(
                    "%s %d 辆阵亡（%.1fs–%.1fs 连锁）", teamLabel, cascade.size(),
                    cascade.firstSec(), cascade.lastSec());
            result.add(new AiEvidence(
                    String.format("DC_%02d", index),
                    EvidenceType.DEATH_CASCADE,
                    cascade.firstSec(),
                    cascade.lastSec(),
                    entities,
                    numbers,
                    Map.of("team", teamLabel),
                    DecodeConfidence.EXACT,
                    cascade.size() >= 3 ? EvidencePriority.CRITICAL : EvidencePriority.IMPORTANT,
                    EvidenceProvenance.BACKEND_SKILL,
                    summary));
        }
        return result;
    }

    private record Death(float sec, int team, long accountId, long tankId, String tankName) {
    }

    private record Cascade(List<Death> deaths) {
        int team() {
            return deaths.getFirst().team();
        }

        int size() {
            return deaths.size();
        }

        float firstSec() {
            return deaths.getFirst().sec();
        }

        float lastSec() {
            return deaths.getLast().sec();
        }

        int teamDeaths(final Integer team) {
            if (team == null) {
                return 0;
            }
            return (int) deaths.stream().filter(d -> d.team() == team).count();
        }
    }

    private static Integer opposite(final Integer team) {
        return team == null ? null : (team == 1 ? 2 : 1);
    }
}
