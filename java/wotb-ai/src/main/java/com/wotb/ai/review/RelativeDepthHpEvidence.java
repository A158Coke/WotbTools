package com.wotb.ai.review;

import com.wotb.core.model.Battle;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

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
    static final double HP_ADVANTAGE_RATIO = RelativeDepthHpPhaseRenderer.HP_ADVANTAGE_RATIO;
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
                final Double deathSec = FormationDepthEvidence.knownDeathSec(battle,
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
                final Double deathSec = FormationDepthEvidence.knownDeathSec(battle,
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
                if (Objects.equals(entry.getValue(), perspectiveTeam)) {
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
        return RelativeDepthHpPhaseRenderer.render(
                battle, phases, tracks, hpSamples, attacks, teamByAccount, playersByAccount,
                profiles, targets, selfAccountId, observedDamagePartial, mapping, aoiByEntity);
    }
}
