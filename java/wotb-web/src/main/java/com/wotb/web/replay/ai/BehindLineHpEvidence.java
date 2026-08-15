package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.TeamEntityIdentity;
import com.wotb.core.processing.TeamEntityMapper;
import com.wotb.core.processing.TeamEntityMapping;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.evidence.TankTacticalProfile;
import com.wotb.core.replay.evidence.TankTacticalProfileRegistry;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 身后输出/血量优势（吸血/避战候选）确定性证据，团队 + 个人双路径。
 * <p>口径（全确定性，只描述事实，不裁决「吸血」）：</p>
 * <ul>
 *   <li>阶段窗口与 {@link FormationDepthEvidence} 同口径（opening/mid/late，复用其包内工具）；</li>
 *   <li>判据（阶段粒度）：X 具备扛线能力（TankTacticalProfile：HEAVY 或 armorReliability=HIGH）、
 *       扛线队友 = 本队内<b>可扛线</b>（isFrontlineCapable）且距敌最近的成员（无合格 carrier 不判定）、
 *       X 与扛线队友均有可用血量与位置、
 *       X 血量比率（hp/maxHp）≥ 扛线队友血量比率 × 1.2、X 距敌 &gt; 扛线队友距敌；
 *       输出分类受 <b>OBSERVED_DAMAGE_IS_PARTIAL</b> 约束：事件流观测不全时 0 个已观测攻击事件 ≠ 无输出，
 *       只输出 observedAttackEvents + outputStatus=UNKNOWN，禁止推断「无输出（避战）」；</li>
 *   <li>附加（opening）：可扛线账号阶段平均位置在本方后排分位 →「前线型车辆未上前线」；</li>
 *   <li>团队路径：遍历本队全体成员，措辞负面由 prompt 规则给出；个人路径：仅录像者自己，中性措辞。</li>
 * </ul>
 * <p>血量数据不足时只输出中性事实（位置关系 + observedAttackEvents + HP_ADVANTAGE_UNKNOWN），不判定吸血/避战；
 * 无前排阵容（全队不可扛线）不纳入任何成员。</p>
 */
final class BehindLineHpEvidence {

    private BehindLineHpEvidence() {
    }

    /** 血量优势倍数（默认多 20%，Step 6 真实样本标定后调）。 */
    static final double HP_ADVANTAGE_RATIO = 1.2;
    /** 有输出 = 阶段内作为攻击者的伤害事件 ≥ 1。 */
    static final int ATTACKER_DAMAGE_MIN = 1;
    /** 躲后距离差档位（米）。 */
    static final double DIST_BAND_M = 50.0;
    static final double DIST_BAND_FAR_M = 150.0;
    /** 血量差档位（血量比率倍率）。 */
    static final double HP_BAND_1 = 1.5;
    static final double HP_BAND_2 = 2.0;

    /** 阶段命中记录：X 满足「血量优势 + 距敌更远 + 可扛线」的事实（供跨阶段聚合程度）。 */
    private record PhaseHit(
            long accountId,
            double bloodRatio,
            double distDiffM
    ) {
    }

    /** 团队路径：本队全体成员的身后输出/血量优势事实段。 */
    static String renderTeamSection(
            final Battle battle,
            final ReplayReconstruction recon,
            final int perspectiveTeam,
            final boolean observedDamagePartial
    ) {
        return render(battle, recon, perspectiveTeam, null, observedDamagePartial);
    }

    /** 个人路径：仅录像者自己（中性措辞）；录像者不在册或非本队成员时返回空。 */
    static String renderPlayerSection(
            final Battle battle,
            final ReplayReconstruction recon,
            final long recorderAccountId,
            final boolean observedDamagePartial
    ) {
        return render(battle, recon, null, recorderAccountId, observedDamagePartial);
    }

    private static String render(
            final Battle battle,
            final ReplayReconstruction recon,
            final Integer perspectiveTeam,
            final Long selfAccountId,
            final boolean observedDamagePartial
    ) {
        if (battle == null || recon == null || recon.events() == null || battle.players == null) {
            return "";
        }
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);
        if (mapping.entitiesById().isEmpty()) {
            return "";
        }
        final Float battleStart = recon.battleStartRawClockSec();
        final Map<Long, List<double[]>> tracks = new LinkedHashMap<>();
        final Map<Long, List<double[]>> hpSamples = new LinkedHashMap<>();
        final Map<Long, List<Double>> attacks = new LinkedHashMap<>();
        final Map<Long, Integer> teamByAccount = new LinkedHashMap<>();
        for (final ReplayEvent event : recon.events()) {
            if (event instanceof PositionChangedEvent pos) {
                final TeamEntityIdentity identity = mapping.identity(pos.entityId());
                if (identity == null || !identity.usable() || identity.accountId() <= 0) {
                    continue;
                }
                if (!Float.isFinite(pos.x()) || !Float.isFinite(pos.z())) {
                    continue;
                }
                final double t = FormationDepthEvidence.relativeSec(event, battleStart);
                if (!Double.isFinite(t) || t < 0) {
                    continue;
                }
                tracks.computeIfAbsent(identity.accountId(), k -> new ArrayList<>())
                        .add(new double[]{t, pos.x(), pos.z()});
                teamByAccount.putIfAbsent(identity.accountId(), identity.team());
            } else if (event instanceof HealthChangedEvent hp) {
                final TeamEntityIdentity identity = mapping.identity(hp.entityId());
                if (identity == null || !identity.usable() || identity.accountId() <= 0) {
                    continue;
                }
                if (hp.currentHealth() == null || !HealthChangedEvent.isPlausibleHp(hp.currentHealth())) {
                    continue;
                }
                final double t = FormationDepthEvidence.relativeSec(event, battleStart);
                if (!Double.isFinite(t) || t < 0) {
                    continue;
                }
                hpSamples.computeIfAbsent(identity.accountId(), k -> new ArrayList<>())
                        .add(new double[]{t, hp.currentHealth()});
                teamByAccount.putIfAbsent(identity.accountId(), identity.team());
            } else if (event instanceof DamageEvent dmg) {
                final TeamEntityIdentity identity = mapping.identity(dmg.attackerEid());
                if (identity == null || !identity.usable() || identity.accountId() <= 0) {
                    continue;
                }
                final double t = FormationDepthEvidence.relativeSec(event, battleStart);
                if (!Double.isFinite(t) || t < 0) {
                    continue;
                }
                attacks.computeIfAbsent(identity.accountId(), k -> new ArrayList<>()).add(t);
                teamByAccount.putIfAbsent(identity.accountId(), identity.team());
            }
        }
        if (tracks.isEmpty()) {
            return "";
        }
        final double battleEnd = battle.durationS != null && battle.durationS > 0
                ? battle.durationS : FormationDepthEvidence.lastSampleTime(tracks);
        if (battleEnd <= 0) {
            return "";
        }
        final List<FormationDepthEvidence.PhaseRange> phases = FormationDepthEvidence.buildPhases(
                FormationDepthEvidence.firstDamageTime(recon.events(), battleStart), battleEnd);
        final Map<Long, PlayerResult> playersByAccount = new LinkedHashMap<>();
        final Map<Long, TankTacticalProfile> profiles = new LinkedHashMap<>();
        final TankTacticalProfileRegistry registry = FormationDepthEvidence.profileRegistry();
        for (final PlayerResult p : battle.players) {
            if (p == null) {
                continue;
            }
            playersByAccount.put(p.accountId, p);
            profiles.put(p.accountId, registry.profileFor(p.tankId, p.tankName,
                    ReplayDisplayNames.tankClass(p.tankId), ReplayDisplayNames.tankTier(p.tankId)));
        }
        // 目标账号：个人路径仅录像者自己（且须在册）；团队路径为本队全体
        final List<Long> targets = new ArrayList<>();
        if (selfAccountId != null) {
            if (teamByAccount.getOrDefault(selfAccountId, 0) <= 0) {
                return "";
            }
            targets.add(selfAccountId);
        } else {
            for (final Map.Entry<Long, Integer> entry : teamByAccount.entrySet()) {
                if (entry.getValue() == perspectiveTeam) {
                    targets.add(entry.getKey());
                }
            }
        }
        if (targets.isEmpty()) {
            return "";
        }
        final List<PhaseHit> hits = new ArrayList<>();
        final StringBuilder sb = new StringBuilder();
        for (final FormationDepthEvidence.PhaseRange phase : phases) {
            final PhaseResult result = renderPhase(phase, tracks, hpSamples, attacks, teamByAccount,
                    playersByAccount, profiles, targets, selfAccountId != null, observedDamagePartial);
            if (result.text() != null) {
                sb.append(result.text());
            }
            hits.addAll(result.hits());
        }
        if (sb.isEmpty() && hits.isEmpty()) {
            return "";
        }
        final StringBuilder out = new StringBuilder();
        out.append("\n=== BEHIND_LINE_HP_ADVANTAGE（身后输出/血量优势·确定性） ===\n");
        out.append(sb);
        final String aggregate = renderAggregate(hits, selfAccountId != null);
        if (!aggregate.isEmpty()) {
            out.append(aggregate);
        }
        return out.toString();
    }

    /** 单阶段渲染结果：文本 + 命中记录。 */
    private record PhaseResult(String text, List<PhaseHit> hits) {
    }

    private static PhaseResult renderPhase(
            final FormationDepthEvidence.PhaseRange phase,
            final Map<Long, List<double[]>> tracks,
            final Map<Long, List<double[]>> hpSamples,
            final Map<Long, List<Double>> attacks,
            final Map<Long, Integer> teamByAccount,
            final Map<Long, PlayerResult> playersByAccount,
            final Map<Long, TankTacticalProfile> profiles,
            final List<Long> targets,
            final boolean playerPath,
            final boolean observedDamagePartial
    ) {
        final List<PhaseHit> hits = new ArrayList<>();
        final Map<Long, double[]> meanByAccount = new LinkedHashMap<>();
        for (final Map.Entry<Long, List<double[]>> entry : tracks.entrySet()) {
            double sx = 0, sz = 0;
            int n = 0;
            for (final double[] sample : entry.getValue()) {
                if (sample[0] < phase.start() || sample[0] > phase.end()) {
                    continue;
                }
                sx += sample[1];
                sz += sample[2];
                n++;
            }
            if (n > 0) {
                meanByAccount.put(entry.getKey(), new double[]{sx / n, sz / n});
            }
        }
        if (meanByAccount.size() < 2) {
            return new PhaseResult(null, hits);
        }
        final int ownTeam = teamByAccount.getOrDefault(targets.get(0), 0);
        final boolean ownTeamValid = ownTeam > 0;
        final Map<Long, Double> distToEnemy = new LinkedHashMap<>();
        if (ownTeamValid) {
            final List<double[]> enemyMeans = new ArrayList<>();
            final List<Map.Entry<Long, double[]>> ownMeans = new ArrayList<>();
            for (final Map.Entry<Long, double[]> entry : meanByAccount.entrySet()) {
                if (teamByAccount.getOrDefault(entry.getKey(), 0) == ownTeam) {
                    ownMeans.add(entry);
                } else {
                    enemyMeans.add(entry.getValue());
                }
            }
            if (!enemyMeans.isEmpty()) {
                for (final Map.Entry<Long, double[]> entry : ownMeans) {
                    double best = Double.POSITIVE_INFINITY;
                    for (final double[] e : enemyMeans) {
                        final double dx = entry.getValue()[0] - e[0];
                        final double dz = entry.getValue()[1] - e[1];
                        best = Math.min(best, Math.hypot(dx, dz));
                    }
                    distToEnemy.put(entry.getKey(), best);
                }
            }
        }
        if (distToEnemy.size() < 2) {
            if ("opening".equals(phase.key())) {
                final String opening = renderOpeningBackline(meanByAccount, teamByAccount,
                        ownTeam, profiles, targets, playerPath);
                return new PhaseResult(opening == null ? null : opening, hits);
            }
            return new PhaseResult(null, hits);
        }
        final StringBuilder sb = new StringBuilder();
        for (final long accountId : targets) {
            final TankTacticalProfile profile = profiles.get(accountId);
            if (!FormationDepthEvidence.isFrontlineCapable(profile)) {
                continue;
            }
            final Double distX = distToEnemy.get(accountId);
            if (distX == null) {
                continue;
            }
            long teammate = -1L;
            double teammateDist = Double.POSITIVE_INFINITY;
            double teammateHpRatio = -1;
            for (final Map.Entry<Long, Double> entry : distToEnemy.entrySet()) {
                if (entry.getKey() == accountId) {
                    continue;
                }
                if (teamByAccount.getOrDefault(entry.getKey(), 0) != ownTeam) {
                    continue;
                }
                if (!FormationDepthEvidence.isFrontlineCapable(profiles.get(entry.getKey()))) {
                    continue;
                }
                if (entry.getValue() < teammateDist - 1e-9) {
                    teammateDist = entry.getValue();
                    teammate = entry.getKey();
                    teammateHpRatio = hpRatioAt(entry.getKey(), phase, hpSamples, playersByAccount);
                } else if (Math.abs(entry.getValue() - teammateDist) <= 1e-9) {
                    final double ratio = hpRatioAt(entry.getKey(), phase, hpSamples, playersByAccount);
                    if (ratio > teammateHpRatio) {
                        teammate = entry.getKey();
                        teammateHpRatio = ratio;
                    }
                }
            }
            if (teammate <= 0 || !(distX > teammateDist + 1e-9)) {
                continue;
            }
            final double hpRatioX = hpRatioAt(accountId, phase, hpSamples, playersByAccount);
            final boolean hpKnown = hpRatioX > 0 && teammateHpRatio > 0;
            final boolean hpAdvantage = hpKnown && hpRatioX >= teammateHpRatio * HP_ADVANTAGE_RATIO;
            final int observedAttackEvents = countIn(attacks.get(accountId), phase);
            final String selfLabel = playerPath ? "你" : key(accountId);
            if (hpAdvantage) {
                sb.append("- ").append(selfLabel).append(" hp=").append(pct(hpRatioX))
                        .append(" vs 扛线队友 ").append(key(teammate)).append(" hp=").append(pct(teammateHpRatio))
                        .append("（血量比 ").append(fmtRatio(hpRatioX / teammateHpRatio)).append("×）")
                        .append(" 距敌+").append(Math.round(distX - teammateDist)).append("m")
                        .append(" ").append(outputStatus(observedAttackEvents, observedDamagePartial)).append("\n");
                hits.add(new PhaseHit(accountId,
                        hpRatioX / teammateHpRatio, distX - teammateDist));
            } else if (!hpKnown) {
                // HP 优势未知：只输出中性事实（位置关系 + 已观察攻击事件），不判定吸血/避战
                sb.append("- ").append(selfLabel).append(" hp=未知 HP_ADVANTAGE_UNKNOWN vs 扛线队友 ")
                        .append(key(teammate)).append(" hp=未知 距敌+")
                        .append(Math.round(distX - teammateDist)).append("m")
                        .append(" observedAttackEvents=").append(observedAttackEvents).append("\n");
            }
        }
        if ("opening".equals(phase.key())) {
            final String opening = renderOpeningBackline(meanByAccount, teamByAccount,
                    ownTeam, profiles, targets, playerPath);
            if (opening != null) {
                sb.append(opening);
            }
        }
        final StringBuilder out = new StringBuilder();
        out.append("phase=").append(phase.key()).append(" [")
                .append(FormationDepthEvidence.fmt(phase.start())).append("-")
                .append(FormationDepthEvidence.fmt(phase.end())).append("s]\n");
        out.append(sb);
        if (sb.length() == 0) {
            return new PhaseResult(null, hits);
        }
        return new PhaseResult(out.toString(), hits);
    }

    /** 阶段末最后已知血量比率（hp/maxHp）；无采样或 maxHp 未知 → ≤0（不可用）。 */
    private static double hpRatioAt(final long accountId,
                                    final FormationDepthEvidence.PhaseRange phase,
                                    final Map<Long, List<double[]>> hpSamples,
                                    final Map<Long, PlayerResult> playersByAccount) {
        final List<double[]> samples = hpSamples.get(accountId);
        if (samples == null || samples.isEmpty()) {
            return -1;
        }
        double lastHp = -1;
        for (final double[] s : samples) {
            if (s[0] <= phase.end()) {
                lastHp = s[1];
            }
        }
        if (lastHp < 0) {
            return -1;
        }
        final PlayerResult p = playersByAccount.get(accountId);
        final Integer maxHp = p == null ? null : p.observedMaxHp;
        if (maxHp == null || maxHp <= 0) {
            return -1;
        }
        return lastHp / maxHp;
    }

    /**
     * 输出分类（fail-closed）：OBSERVED_DAMAGE_IS_PARTIAL 时 0 个已观测攻击事件 ≠ 无输出，
     * 只输出 observedAttackEvents + outputStatus=UNKNOWN；完整覆盖时才可给「有输出/无输出」结论。
     */
    private static String outputStatus(final int observedAttackEvents, final boolean observedDamagePartial) {
        if (observedAttackEvents >= ATTACKER_DAMAGE_MIN) {
            if (observedDamagePartial) {
                return "observedAttackEvents=" + observedAttackEvents + "（事件流观测不全，不得推断无输出）";
            }
            return "有输出（利用队友输出）";
        }
        if (observedDamagePartial) {
            return "observedAttackEvents=0 outputStatus=UNKNOWN（事件流观测不全，不得推断无输出/避战）";
        }
        return "无输出（避战）";
    }

    private static int countIn(final List<Double> times, final FormationDepthEvidence.PhaseRange phase) {
        if (times == null || times.isEmpty()) {
            return 0;
        }
        int n = 0;
        for (final double t : times) {
            if (t >= phase.start() && t <= phase.end()) {
                n++;
            }
        }
        return n;
    }

    /** opening 附加事实：可扛线账号阶段平均位置在本方后排分位 → 前线型车辆未上前线。 */
    private static String renderOpeningBackline(
            final Map<Long, double[]> meanByAccount,
            final Map<Long, Integer> teamByAccount,
            final int ownTeam,
            final Map<Long, TankTacticalProfile> profiles,
            final List<Long> targets,
            final boolean playerPath
    ) {
        final List<Map.Entry<Long, double[]>> own = new ArrayList<>();
        final List<double[]> enemyMeans = new ArrayList<>();
        for (final Map.Entry<Long, double[]> entry : meanByAccount.entrySet()) {
            if (teamByAccount.getOrDefault(entry.getKey(), 0) == ownTeam) {
                own.add(entry);
            } else {
                enemyMeans.add(entry.getValue());
            }
        }
        if (own.size() < 2 || enemyMeans.isEmpty()) {
            return null;
        }
        final double[] ownCentroid = FormationDepthEvidence.centroid(
                own.stream().map(Map.Entry::getValue).toList());
        final double[] enemyCentroid = FormationDepthEvidence.centroid(enemyMeans);
        final double ax = enemyCentroid[0] - ownCentroid[0];
        final double az = enemyCentroid[1] - ownCentroid[1];
        final double len = Math.hypot(ax, az);
        if (len <= 1e-6) {
            return null;
        }
        final double ux = ax / len, uz = az / len;
        final List<double[]> depths = new ArrayList<>();
        for (final Map.Entry<Long, double[]> member : own) {
            final double d = (member.getValue()[0] - ownCentroid[0]) * ux
                    + (member.getValue()[1] - ownCentroid[1]) * uz;
            depths.add(new double[]{d, member.getKey()});
        }
        depths.sort(Comparator.comparingDouble(a -> -a[0]));
        final double minD = depths.get(depths.size() - 1)[0];
        final double maxD = depths.get(0)[0];
        final double span = maxD - minD;
        final double backThreshold = span > 1e-6 ? minD + span / 3.0 : maxD;
        final StringBuilder sb = new StringBuilder();
        for (final double[] d : depths) {
            if (d[0] > backThreshold + 1e-9) {
                continue;
            }
            final long accountId = Math.round(d[1]);
            if (!targets.contains(accountId)) {
                continue;
            }
            final TankTacticalProfile profile = profiles.get(accountId);
            if (!FormationDepthEvidence.isFrontlineCapable(profile)) {
                continue;
            }
            final String selfLabel = playerPath ? "你" : key(accountId);
            sb.append("- ").append(selfLabel).append(" 前线型车辆未上前线（opening 平均位置在本方后排分位）\n");
        }
        return sb.length() == 0 ? null : sb.toString();
    }

    /** 跨阶段聚合：三因子（血量差幅度 + 持续阶段数 + 躲后距离差）→ 轻/中/重。 */
    private static String renderAggregate(final List<PhaseHit> hits, final boolean playerPath) {
        if (hits.isEmpty()) {
            return "";
        }
        final Map<Long, List<PhaseHit>> byAccount = new LinkedHashMap<>();
        for (final PhaseHit hit : hits) {
            byAccount.computeIfAbsent(hit.accountId(), k -> new ArrayList<>()).add(hit);
        }
        final StringBuilder sb = new StringBuilder();
        sb.append("degree（跨阶段聚合·三因子）:\n");
        for (final Map.Entry<Long, List<PhaseHit>> entry : byAccount.entrySet()) {
            final List<PhaseHit> list = entry.getValue();
            double rMax = 0;
            double dMax = 0;
            for (final PhaseHit hit : list) {
                rMax = Math.max(rMax, hit.bloodRatio());
                dMax = Math.max(dMax, hit.distDiffM());
            }
            final int bloodScore = rMax < HP_BAND_1 ? 1 : rMax < HP_BAND_2 ? 2 : 3;
            final int durationScore = Math.min(3, list.size());
            final int distScore = dMax < DIST_BAND_M ? 1 : dMax < DIST_BAND_FAR_M ? 2 : 3;
            final int total = bloodScore + durationScore + distScore;
            final String degree = total <= 4 ? "轻度" : total <= 6 ? "中度" : "重度";
            final String selfLabel = playerPath ? "你" : key(entry.getKey());
            sb.append("- ").append(selfLabel).append(" → ").append(degree)
                    .append("(blood=").append(bloodScore).append(",duration=").append(durationScore)
                    .append(",distance=").append(distScore).append(")\n");
        }
        return sb.toString();
    }

    private static String key(final long accountId) {
        return "account:" + accountId;
    }

    private static String pct(final double ratio) {
        return Math.round(ratio * 100) + "%";
    }

    private static String fmtRatio(final double ratio) {
        return String.valueOf(Math.round(ratio * 100.0) / 100.0);
    }
}
