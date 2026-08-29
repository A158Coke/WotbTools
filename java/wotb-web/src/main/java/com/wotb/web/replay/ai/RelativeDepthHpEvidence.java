package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.EntryHpSource;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.evidence.TankTacticalProfile;
import com.wotb.core.replay.evidence.TankTacticalProfileRegistry;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 相对纵深/血量测量（RELATIVE_DEPTH_HP_MEASUREMENT）确定性证据，团队 + 个人双路径。
 * <p>口径（全确定性，只输出测量与几何事实，不裁决「避战/利用队友/站位是否合理」）：</p>
 * <ul>
 *   <li>阶段窗口与 {@link FormationDepthEvidence} 同口径（opening/mid/late，复用其包内工具）；</li>
 *   <li>参考成员（reference）由<b>纯几何算法</b>选择：本阶段距观测敌方最近的存活本方成员
 *       （有位置参考；无参考时不输出）。reference 不是「扛线队友」之类的战术角色，只是几何参考；</li>
 *   <li>salience 筛选（纯测量，不引用 tank profile 分类）：成员血量比率（hp/maxHp）≥ reference 血量比率 × 1.2
 *       且成员距敌 &gt; reference 距敌时才列出。该筛选只决定「哪些成员值得给 LLM 看」，不意味着
 *       「满足 ⇒ 避战/吸血」——战术含义由 LLM 综合判断；tank profile 只作为静态事实附注；</li>
 *   <li>输出约束受 <b>OBSERVED_DAMAGE_IS_PARTIAL</b> 约束：事件流观测不全时只输出
 *       observedAttackEvents + coverage=PARTIAL，禁止推断「无输出/避战」；</li>
 *   <li>附加（opening）：本队成员阶段平均位置在最靠后三分位 → 输出几何深度事实（纯几何，不判角色）；</li>
 *   <li>团队路径：遍历本队全体成员；个人路径：仅录像者自己。</li>
 * </ul>
 * <p>血量数据不足时只输出中性事实（位置关系 + observedAttackEvents + HP_RATIO_UNKNOWN）；
 * 敌方位置参考不完整时禁止输出距离测量（fail-closed）。</p>
 */
final class RelativeDepthHpEvidence {

    private RelativeDepthHpEvidence() {
    }

    /**
     * 血量比率优势倍数（默认多 20%，salience/filter heuristic；不解释为「避战/吸血」判定）。
     */
    static final double HP_ADVANTAGE_RATIO = 1.2;
    /**
     * 有输出 = 阶段内作为攻击者的伤害事件 ≥ 1（仅完整覆盖时可用作「有输出」事实）。
     */
    static final int ATTACKER_DAMAGE_MIN = 1;
    /**
     * 躲后距离差档位（米，聚合 salience 用）。
     */
    static final double DIST_BAND_M = 50.0;
    static final double DIST_BAND_FAR_M = 150.0;
    /**
     * 血量差档位（血量比率倍率，聚合 salience 用）。
     */
    static final double HP_BAND_1 = 1.5;
    static final double HP_BAND_2 = 2.0;

    /**
     * 阶段命中记录：X 满足「血量优势 + 距敌更远」筛选的测量（供跨阶段聚合次数）。
     */
    private record PhaseHit(
            long accountId,
            double bloodRatio,
            double distDiffM
    ) {
    }

    /**
     * 团队路径：本队全体成员的相对纵深/血量测量段。
     */
    static String renderTeamSection(
            final Battle battle,
            final ReplayReconstruction recon,
            final int perspectiveTeam,
            final boolean observedDamagePartial
    ) {
        return render(battle, recon, perspectiveTeam, null, observedDamagePartial);
    }

    /**
     * 个人路径：仅录像者自己；录像者不在册或非本队成员时返回空。
     */
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
        // 权威死亡边界（PlayerResult 结算）：knownDeathSec > 0 的车辆，其阵亡后的位置/攻击事件不进入证据
        final Map<Long, PlayerResult> playersByAccount = new LinkedHashMap<>();
        if (battle.players != null) {
            for (final PlayerResult p : battle.players) {
                if (p != null) {
                    playersByAccount.put(p.accountId, p);
                }
            }
        }
        // 车辆战术画像（tankId → TankTacticalProfile，静态事实；不参与几何参考选择）
        final Map<Long, TankTacticalProfile> profiles = new LinkedHashMap<>();
        final TankTacticalProfileRegistry registry = FormationDepthEvidence.profileRegistry();
        for (final PlayerResult p : battle.players) {
            if (p == null) {
                continue;
            }
            profiles.put(p.accountId, registry.profileFor(p.tankId, p.tankName,
                    ReplayDisplayNames.tankClass(p.tankId), ReplayDisplayNames.tankTier(p.tankId)));
        }


        final Map<Long, List<FormationDepthEvidence.PositionSample>> tracks = new LinkedHashMap<>();
        final Map<Long, List<double[]>> hpSamples = new LinkedHashMap<>();
        final Map<Long, List<Double>> attacks = new LinkedHashMap<>();
        final Map<Long, Integer> teamByAccount = new LinkedHashMap<>();
        for (final ReplayEvent event : recon.events()) {
            if (event instanceof PositionChangedEvent pos) {
                final TeamEntityIdentity identity = mapping.identity(pos.entityId());
                if (identity == null || !identity.usable() || identity.accountId() <= 0) {
                    continue;
                }
                // ActualCombatantSet（battle_results #301）：非 #301 实体位置不得进入战术测量
                if (!playersByAccount.containsKey(identity.accountId())) {
                    continue;
                }
                if (!Float.isFinite(pos.x()) || !Float.isFinite(pos.z())) {
                    continue;
                }
                final double t = FormationDepthEvidence.relativeSec(event, battleStart);
                if (!Double.isFinite(t) || t < 0) {
                    continue;
                }
                final Double deathSec = FormationDepthEvidence.knownDeathSec(
                        playersByAccount.get(identity.accountId()));
                if (deathSec != null && t > deathSec + 1e-6) {
                    continue; // 阵亡后的服务器位置流残留不得进入位置证据
                }
                tracks.computeIfAbsent(identity.accountId(), k -> new ArrayList<>())
                        .add(new FormationDepthEvidence.PositionSample(pos.entityId(), t, pos.x(), pos.z()));
                teamByAccount.putIfAbsent(identity.accountId(), identity.team());
            } else if (event instanceof HealthChangedEvent hp) {
                final TeamEntityIdentity identity = mapping.identity(hp.entityId());
                if (identity == null || !identity.usable() || identity.accountId() <= 0) {
                    continue;
                }
                if (hp.currentHealth() == null || (hp.currentHealth() != 0
                        && !HealthChangedEvent.isPlausibleHp(hp.currentHealth()))) {
                    continue; // null/非 plausible/sentinel（0xFFFD=65533、0xFFFF=65535 等）一律跳过，防拆箱 NPE 与污染
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
                final Double deathSec = FormationDepthEvidence.knownDeathSec(
                        playersByAccount.get(identity.accountId()));
                if (deathSec != null && t > deathSec + 1e-6) {
                    continue; // 阵亡后的攻击事件不进入 observed attack evidence
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
        // Canonical AoI authority：phase 位置参考的 CURRENT/LAST_KNOWN 判定依据（P0-1）。
        final Map<Integer, List<com.wotb.core.replay.facts.AoiObservationSegment>> aoiByEntity =
                com.wotb.core.replay.facts.ReplayAoiLifecycle.indexByEntity(
                        com.wotb.core.replay.facts.ReplayAoiLifecycle.build(
                                recon.events(), battleStart == null ? null : battleStart.doubleValue()));
        final List<PhaseHit> hits = new ArrayList<>();
        final StringBuilder sb = new StringBuilder();
        for (final FormationDepthEvidence.PhaseRange phase : phases) {
            final PhaseResult result = renderPhase(phase, tracks, hpSamples, attacks, teamByAccount,
                    playersByAccount, profiles, targets, selfAccountId != null, observedDamagePartial,
                    mapping, aoiByEntity);
            if (result.text() != null) {
                sb.append(result.text());
            }
            hits.addAll(result.hits());
        }
        if (sb.isEmpty() && hits.isEmpty()) {
            return "";
        }
        final StringBuilder out = new StringBuilder();
        out.append("\n=== RELATIVE_DEPTH_HP_MEASUREMENT（相对纵深/血量测量·确定性） ===\n");
        out.append("reference=本阶段距观测敌方最近的存活本方成员（纯几何参考，非战术角色）；"
                + "salience=成员血量比率≥reference×1.2 且距敌更远时列出\n");
        out.append(sb);
        final String aggregate = renderAggregate(hits, selfAccountId != null);
        if (!aggregate.isEmpty()) {
            out.append(aggregate);
        }
        return out.toString();
    }

    /**
     * 单阶段渲染结果：文本 + 命中记录。
     */
    private record PhaseResult(String text, List<PhaseHit> hits) {
    }

    private static PhaseResult renderPhase(
            final FormationDepthEvidence.PhaseRange phase,
            final Map<Long, List<FormationDepthEvidence.PositionSample>> tracks,
            final Map<Long, List<double[]>> hpSamples,
            final Map<Long, List<Double>> attacks,
            final Map<Long, Integer> teamByAccount,
            final Map<Long, PlayerResult> playersByAccount,
            final Map<Long, TankTacticalProfile> profiles,
            final List<Long> targets,
            final boolean playerPath,
            final boolean observedDamagePartial,
            final TeamEntityMapping mapping,
            final Map<Integer, List<com.wotb.core.replay.facts.AoiObservationSegment>> aoiByEntity
    ) {
        final List<PhaseHit> hits = new ArrayList<>();
        final int ownTeam = teamByAccount.getOrDefault(targets.get(0), 0);
        if (ownTeam <= 0) {
            return new PhaseResult(null, hits);
        }
        final int enemyTeam = 3 - ownTeam;
        // 阶段位置参考（带知识状态）：复用 FormationDepthEvidence 的 canonical 同口径解析
        // （phase end 位于 observed segment=CURRENT；位于 UNKNOWN_AOI gap / 跨 gap=LAST_KNOWN，P0-1）。
        // 相对纵深/血量呈现为确定性距离测量 → 只允许 CURRENT 参考参与 exact 距离；
        // enemy LAST_KNOWN 不得生成仿佛当前精确位置的 memberDist/referenceDist/relativeDepthM
        // （fail-closed，不 future-leak）。
        final Map<Long, FormationDepthEvidence.PhasePositionReference> refsByAccount = new LinkedHashMap<>();
        for (final Map.Entry<Long, List<FormationDepthEvidence.PositionSample>> entry : tracks.entrySet()) {
            final int team = teamByAccount.getOrDefault(entry.getKey(), 0);
            final FormationDepthEvidence.PhasePositionReference ref =
                    FormationDepthEvidence.resolvePhasePosition(
                            entry.getKey(), team, entry.getValue(),
                            phase.start(), phase.end(), playersByAccount,
                            mapping, aoiByEntity, ownTeam);
            if (ref != null) {
                refsByAccount.put(entry.getKey(), ref);
            }
        }
        if (refsByAccount.size() < 2) {
            return new PhaseResult(null, hits);
        }
        // 只消费 CURRENT 参考：own 成员（friendly CURRENT）+ 敌方 CURRENT
        final Map<Long, FormationDepthEvidence.PhasePositionReference> ownCurrent = new LinkedHashMap<>();
        final Map<Long, FormationDepthEvidence.PhasePositionReference> enemyCurrent = new LinkedHashMap<>();
        for (final Map.Entry<Long, FormationDepthEvidence.PhasePositionReference> entry : refsByAccount.entrySet()) {
            final FormationDepthEvidence.PhasePositionReference ref = entry.getValue();
            if (!ref.current()) {
                continue; // LAST_KNOWN（enemy stale / EntityLeave 中断）不参与 exact 距离
            }
            if (ref.team() == ownTeam) {
                ownCurrent.put(entry.getKey(), ref);
            } else {
                enemyCurrent.put(entry.getKey(), ref);
            }
        }
        final Map<Long, Double> distToEnemy = new LinkedHashMap<>();
        if (!enemyCurrent.isEmpty()) {
            for (final Map.Entry<Long, FormationDepthEvidence.PhasePositionReference> entry : ownCurrent.entrySet()) {
                double best = Double.POSITIVE_INFINITY;
                for (final FormationDepthEvidence.PhasePositionReference e : enemyCurrent.values()) {
                    final double dx = entry.getValue().x() - e.x();
                    final double dz = entry.getValue().z() - e.z();
                    best = Math.min(best, Math.hypot(dx, dz));
                }
                distToEnemy.put(entry.getKey(), best);
            }
        }
        if (distToEnemy.size() < 2) {
            if ("opening".equals(phase.key())) {
                final String opening = renderOpeningRearTercile(ownCurrent, enemyCurrent,
                        ownTeam, profiles, targets, playerPath);
                return new PhaseResult(opening == null ? null : opening, hits);
            }
            return new PhaseResult(null, hits);
        }
        // 敌方 CURRENT 位置参考完整性门禁：本阶段存活的敌方车辆中缺少 CURRENT 位置参考时，
        // 最近观测敌方 ≠ 真实最近敌方（enemy LAST_KNOWN 不得满足 current-position completeness），
        // 禁止输出「距敌更远/血量优势」精确距离测量（fail-closed，避免误导 LLM）
        int enemyAliveCount = 0;
        int enemyRefCount = 0;
        for (final Map.Entry<Long, PlayerResult> entry : playersByAccount.entrySet()) {
            final PlayerResult pl = entry.getValue();
            if (pl == null || pl.team != enemyTeam) {
                continue;
            }
            if (!FormationDepthEvidence.isAliveAt(playersByAccount, entry.getKey(), phase.end())) {
                continue;
            }
            enemyAliveCount++;
            if (enemyCurrent.containsKey(entry.getKey())) {
                enemyRefCount++;
            }
        }
        final boolean enemyRefComplete = enemyRefCount >= enemyAliveCount;
        if (!enemyRefComplete) {
            // 敌方 CURRENT 位置参考不完整：最近观测敌方 ≠ 真实最近敌方，不输出不可信距离测量
            return new PhaseResult(null, hits);
        }


        final StringBuilder sb = new StringBuilder();
        for (final long accountId : targets) {
            if (!FormationDepthEvidence.isAliveAt(playersByAccount, accountId, phase.end())) {
                continue; // 本阶段已阵亡：不作为测量目标
            }
            final Double distX = distToEnemy.get(accountId);
            if (distX == null) {
                continue;
            }
            long reference = -1L;
            double referenceDist = Double.POSITIVE_INFINITY;
            double referenceHpRatio = -1;
            // 纯几何 reference：本阶段距观测敌方最近的存活本方成员（不按 tank profile 分类）
            for (final Map.Entry<Long, Double> entry : distToEnemy.entrySet()) {
                if (entry.getKey() == accountId) {
                    continue;
                }
                if (teamByAccount.getOrDefault(entry.getKey(), 0) != ownTeam) {
                    continue;
                }
                if (!FormationDepthEvidence.isAliveAt(playersByAccount, entry.getKey(), phase.end())) {
                    continue; // 已阵亡车辆不得成为 reference
                }
                if (entry.getValue() < referenceDist - 1e-9) {
                    referenceDist = entry.getValue();
                    reference = entry.getKey();
                    referenceHpRatio = hpRatioAt(entry.getKey(), phase, hpSamples, playersByAccount);
                } else if (Math.abs(entry.getValue() - referenceDist) <= 1e-9) {
                    final double ratio = hpRatioAt(entry.getKey(), phase, hpSamples, playersByAccount);
                    if (ratio > referenceHpRatio) {
                        reference = entry.getKey();
                        referenceHpRatio = ratio;
                    }
                }
            }
            if (reference <= 0 || !(distX > referenceDist + 1e-9)) {
                continue;
            }
            final double hpRatioX = hpRatioAt(accountId, phase, hpSamples, playersByAccount);
            final boolean hpKnown = hpRatioX > 0 && referenceHpRatio > 0;
            final boolean hpAdvantage = hpKnown && hpRatioX >= referenceHpRatio * HP_ADVANTAGE_RATIO;
            final int observedAttackEvents = countIn(attacks.get(accountId), phase);
            final String selfLabel = playerPath ? "你" : key(accountId);
            if (hpAdvantage) {
                sb.append("- ").append(selfLabel).append(profileFacts(accountId, profiles))
                        .append(" hpRatio=").append(pct(hpRatioX))
                        .append(" vs reference ").append(key(reference)).append(profileFacts(reference, profiles))
                        .append(" hpRatio=").append(pct(referenceHpRatio))
                        .append("（hpRatio差 ").append(fmtRatio(hpRatioX / referenceHpRatio)).append("×）")
                        .append(" memberDist=").append(Math.round(distX)).append("m")
                        .append(" referenceDist=").append(Math.round(referenceDist)).append("m")
                        .append(" relativeDepthM=+").append(Math.round(distX - referenceDist))
                        .append(" ").append(outputStatus(observedAttackEvents, observedDamagePartial)).append("\n");
                // outputStatus=UNKNOWN（partial 且 0 个已观测攻击事件）时禁止进入跨阶段聚合
                if (!(observedDamagePartial && observedAttackEvents == 0)) {
                    hits.add(new PhaseHit(accountId,
                            hpRatioX / referenceHpRatio, distX - referenceDist));
                }
            } else if (!hpKnown) {
                // 血量优势未知：只输出中性事实（位置关系 + 已观察攻击事件）
                sb.append("- ").append(selfLabel).append(profileFacts(accountId, profiles))
                        .append(" hpRatio=未知 HP_RATIO_UNKNOWN vs reference ").append(key(reference))
                        .append(profileFacts(reference, profiles)).append(" hpRatio=未知")
                        .append(" memberDist=").append(Math.round(distX)).append("m")
                        .append(" referenceDist=").append(Math.round(referenceDist)).append("m")
                        .append(" relativeDepthM=+").append(Math.round(distX - referenceDist))
                        .append(" observedAttackEvents=").append(observedAttackEvents).append("\n");
            }
        }
        if ("opening".equals(phase.key())) {
            final String opening = renderOpeningRearTercile(ownCurrent, enemyCurrent,
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

    /**
     * 阶段末最后已知血量比率（hp/maxHp）；无采样或 maxHp 未知 → ≤0（不可用）。
     */
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
        // hp ratio 分母只允许已证明的进场满血（OBSERVED_EXACT）：
        // observedMaxHp 是整场观测最大 current HP，可能低于真实 entry（装备加成/已受伤），
        // 用它算 ratio 会让血量优势测量失真；BASE_FALLBACK 用 tankopedia base 同样失真。
        // 无法证明 → -1 → HP_RATIO_UNKNOWN 中性路径。
        if (p == null || p.entryHpSource != EntryHpSource.OBSERVED_EXACT
                || p.entryHp == null || p.entryHp <= 0) {
            return -1;
        }
        return lastHp / p.entryHp;
    }

    /**
     * 输出观测事实（fail-closed）：只报 observedAttackEvents 与覆盖率；
     * OBSERVED_DAMAGE_IS_PARTIAL 时 0 个已观测攻击事件 ≠ 无输出，禁止推断「无输出/避战」。
     */
    private static String outputStatus(final int observedAttackEvents, final boolean observedDamagePartial) {
        if (observedDamagePartial) {
            return "observedAttackEvents=" + observedAttackEvents
                    + " coverage=PARTIAL（事件流观测不全，0 事件 ≠ 无输出，不得推断避战）";
        }
        return "observedAttackEvents=" + observedAttackEvents + " coverage=COMPLETE";
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

    /**
     * opening 附加几何事实：本队成员阶段平均位置在最靠后三分位（纯几何，附静态 profile 事实，不判角色；
     * 只消费 CURRENT 位置参考——enemy LAST_KNOWN 不得作为当前 enemy centroid / 轴参考）。
     */
    private static String renderOpeningRearTercile(
            final Map<Long, FormationDepthEvidence.PhasePositionReference> ownCurrent,
            final Map<Long, FormationDepthEvidence.PhasePositionReference> enemyCurrent,
            final int ownTeam,
            final Map<Long, TankTacticalProfile> profiles,
            final List<Long> targets,
            final boolean playerPath
    ) {
        final List<Map.Entry<Long, double[]>> own = new ArrayList<>();
        final List<double[]> enemyMeans = new ArrayList<>();
        for (final Map.Entry<Long, FormationDepthEvidence.PhasePositionReference> entry : ownCurrent.entrySet()) {
            own.add(new java.util.AbstractMap.SimpleImmutableEntry<>(entry.getKey(),
                    new double[]{entry.getValue().x(), entry.getValue().z()}));
        }
        for (final FormationDepthEvidence.PhasePositionReference ref : enemyCurrent.values()) {
            enemyMeans.add(new double[]{ref.x(), ref.z()});
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
            final String selfLabel = playerPath ? "你" : key(accountId);
            sb.append("- ").append(selfLabel).append(profileFacts(accountId, profiles))
                    .append(" opening 阶段平均位置在本方最靠后三分位（几何深度·纯几何，不判角色）\n");
        }
        return sb.length() == 0 ? null : sb.toString();
    }

    /**
     * 跨阶段聚合：只报「该测量组合在 N 个阶段成立」的中性次数（salience），不输出战术分级。
     */
    private static String renderAggregate(final List<PhaseHit> hits, final boolean playerPath) {
        if (hits.isEmpty()) {
            return "";
        }
        final Map<Long, List<PhaseHit>> byAccount = new LinkedHashMap<>();
        for (final PhaseHit hit : hits) {
            byAccount.computeIfAbsent(hit.accountId(), k -> new ArrayList<>()).add(hit);
        }
        final StringBuilder sb = new StringBuilder();
        sb.append("跨阶段出现（salience filter·中性）:\n");
        for (final Map.Entry<Long, List<PhaseHit>> entry : byAccount.entrySet()) {
            final String selfLabel = playerPath ? "你" : key(entry.getKey());
            sb.append("- ").append(selfLabel).append(" 在 ").append(entry.getValue().size())
                    .append("/3 阶段成立（血量比 / 距敌差测量组合）\n");
        }
        return sb.toString();
    }

    /** 静态 profile 事实标注（车种/装甲；UNKNOWN 只标未知）。 */
    private static String profileFacts(final long accountId, final Map<Long, TankTacticalProfile> profiles) {
        final TankTacticalProfile profile = profiles.get(accountId);
        if (profile == null || "UNKNOWN".equals(profile.vehicleClass())) {
            return "";
        }
        return "(" + profile.vehicleClass() + ",armor=" + profile.armorReliability() + ")";
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
