package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.evidence.TankTacticalProfile;
import com.wotb.core.replay.evidence.TankTacticalProfileRegistry;
import com.wotb.core.replay.facts.AoiObservationSegment;
import com.wotb.core.replay.facts.ReplayAoiLifecycle;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.timeline.PositionKnowledge;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 阵型纵深（纯几何深度三分位）与区域覆盖测量（REGION_COVERAGE_MEASUREMENTS）确定性证据，仅供团队复盘（Team 路径）。
 * <p>口径（全确定性，只描述几何/测量事实，不裁决）：</p>
 * <ul>
 *   <li>阶段窗口按首次交火（首个 DamageEvent）与战斗时长切分 opening/mid/late
 *       （残局 = 战斗末 15s 窗口，与地图鸟瞰同口径）；</li>
 *   <li><b>几何纵深（纯几何，不引用 tank profile）</b>：某阶段内本队成员平均位置沿「本队质心 → 敌方质心」轴投影，
 *       按深度三分位输出 GEOMETRIC_FORWARD / GEOMETRIC_MIDDLE / GEOMETRIC_REAR（仅双方均有可用位置时输出）。
 *       三分位只是几何分类，不是「前排抗线/后排支援」等战术角色；tank profile（车种/装甲等）作为成员静态事实附注，
 *       该车处于这个纵深是否合理由 LLM 综合地图、阵容与战局判断。</li>
 *   <li><b>区域覆盖测量（REGION_COVERAGE_MEASUREMENTS）</b>：九宫格每区输出双方位置存在数
 *       （ownPositionPresence/enemyPositionPresence，基于 resolved 车辆位置 state，每辆 CURRENT 车辆 +1，
 *       不是位置包数量）与双方距离加权火力覆盖分
 *       （F=Σ 火力权重/(1+d/100)，ownWeightedCoverageScore/enemyWeightedCoverageScore）及 ratio；
 *       exact 数学只消费 CURRENT 位置参考（knowledge 契约：friendly carry-forward=CURRENT；
 *       enemy：phase end 位于 observed segment（canonical AoI）=CURRENT，位于 UNKNOWN_AOI gap / 跨 gap
 *       =LAST_KNOWN）；CURRENT 不完整时 fail-closed
 *       只输出 presence + coverage completeness + ENEMY_LAST_KNOWN_POSITION_REFERENCES（独立信息，
 *       LAST_KNOWN 不得当作当前精确位置）；只给确定性测量，不输出 own/contested/enemy 权威控制权标签——
 *       哪方「实际控制/压制某区」由 LLM 判断。</li>
 * </ul>
 * <p>成员用 {@code account:<accountId>}（与 FORMATION_PHASES 簇成员一致）供 AI 交叉引用。</p>
 */
final class FormationDepthEvidence {

    static final double FIRE_DISTANCE_NORM_M = FormationDepthPhaseRenderer.FIRE_DISTANCE_NORM_M;

    private FormationDepthEvidence() {
    }

    /** 阶段窗口（battle-relative 秒）。 */
    record PhaseRange(String key, double start, double end) {
    }

    /**
     * 单条位置样本：携带实体 provenance（entityId），供阶段窗口 / 观测段窗口与<b>同实体</b>样本相交
     * （Item P1：跨实体生命周期时绝不把另一实体坐标并入同一 CURRENT）。 */
    record PositionSample(int entityId, double t, double x, double z) {
    }

    static String renderSection(
            final Battle battle,
            final ReplayReconstruction recon,
            final int perspectiveTeam,
            final String mapCode
    ) {
        if (battle == null || recon == null || recon.events() == null || battle.players == null) {
            return "";
        }
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);
        if (mapping.entitiesById().isEmpty()) {
            return "";
        }
        final Float battleStart = recon.battleStartRawClockSec();
        // 权威死亡边界（Battle live observation / settlement fallback）：knownDeathSec > 0 的车辆，
        // t 超过该时刻的位置样本不进入阵型/控制权
        final Map<Long, PlayerResult> playersByAccount = new LinkedHashMap<>();
        if (battle.players != null) {
            for (final PlayerResult p : battle.players) {
                if (p != null) {
                    playersByAccount.put(p.accountId, p);
                }
            }
        }

        // 每账号位置样本（双方）+ 队伍；{entityId, t, x, z}（保留实体 provenance，Item P1）
        final Map<Long, List<PositionSample>> tracks = new LinkedHashMap<>();
        final Map<Long, Integer> teamByAccount = new LinkedHashMap<>();
        for (final ReplayEvent event : recon.events()) {
            if (!(event instanceof PositionChangedEvent pos)) {
                continue;
            }
            final TeamEntityIdentity identity = mapping.identity(pos.entityId());
            if (identity == null || !identity.usable() || identity.accountId() <= 0) {
                continue;
            }
            // ActualCombatantSet（battle_results #301）：spectator/observer/camera/静态实体等非 #301
            // 位置不得进入战术位置覆盖（Actual Combatant/Spectator 边界契约）。
            if (!playersByAccount.containsKey(identity.accountId())) {
                continue;
            }
            if (!Float.isFinite(pos.x()) || !Float.isFinite(pos.z())) {
                continue;
            }
            final double t = relativeSec(event, battleStart);
            if (!Double.isFinite(t) || t < 0) {
                continue;
            }
            final PlayerResult player = playersByAccount.get(identity.accountId());
            final Double deathSec = player == null ? null : knownDeathSec(battle, player);
            if (deathSec != null && t > deathSec + 1e-6) {
                continue; // 阵亡后的服务器位置流残留不得进入阵型/控制权
            }
            tracks.computeIfAbsent(identity.accountId(), k -> new ArrayList<>())
                    .add(new PositionSample(pos.entityId(), t, pos.x(), pos.z()));
            teamByAccount.putIfAbsent(identity.accountId(), identity.team());
        }
        if (tracks.isEmpty()) {
            return "";
        }
        final double battleEnd = battle.durationS != null && battle.durationS > 0
                ? battle.durationS : lastSampleTime(tracks);
        if (battleEnd <= 0) {
            return "";
        }
        // 本队/敌方车辆战术画像（tankId → TankTacticalProfile，语义为主 + tankopedia 数值兜底佐证）
        final Map<Long, TankTacticalProfile> accountProfiles = new LinkedHashMap<>();
        if (battle.players != null) {
            final TankTacticalProfileRegistry registry = profileRegistry();
            for (final PlayerResult p : battle.players) {
                if (p == null) {
                    continue;
                }
                accountProfiles.put(p.accountId, registry.profileFor(p.tankId, p.tankName,
                        ReplayDisplayNames.tankClass(p.tankId), ReplayDisplayNames.tankTier(p.tankId)));
            }
        }

        final List<PhaseRange> phases = buildPhases(firstDamageTime(recon.events(), battleStart), battleEnd);

        // Canonical AoI authority：AoI observed segment 索引（Type4 收段 / Type33+Type5 重入；段间 UNKNOWN_AOI）。
        final Map<Integer, List<AoiObservationSegment>> aoiByEntity =
                ReplayAoiLifecycle.indexByEntity(ReplayAoiLifecycle.build(
                        recon.events(), battleStart == null ? null : battleStart.doubleValue()));

        final StringBuilder sb = new StringBuilder();
        for (final PhaseRange phase : phases) {
            sb.append(renderPhase(battle, phase, tracks, teamByAccount, perspectiveTeam, mapCode,
                    playersByAccount, accountProfiles, mapping, aoiByEntity));
        }
        return sb.isEmpty() ? "" : "\n=== FORMATION_DEPTH（阵型深度·确定性） ===\n" + sb;
    }

    /** 单阶段：前后排（深度三分位）+ 控制区域（九宫格计数优势）。 */
    private static String renderPhase(
            final Battle battle,
            final PhaseRange phase,
            final Map<Long, List<PositionSample>> tracks,
            final Map<Long, Integer> teamByAccount,
            final int perspectiveTeam,
            final String mapCode,
            final Map<Long, PlayerResult> playersByAccount,
            final Map<Long, TankTacticalProfile> profiles,
            final TeamEntityMapping mapping,
            final Map<Integer, List<AoiObservationSegment>> aoiByEntity
    ) {
        // 阶段位置参考（带知识状态）：每个 eligible 车辆解析 phase 位置 + CURRENT/LAST_KNOWN。
        // canonical AoI authority：phase end 位于 observed segment 且位置参考来自本段 → CURRENT；
        // 位于 UNKNOWN_AOI gap / 位置参考跨 gap → LAST_KNOWN（不再按 age>5s 推断，P0-1）。
        // LAST_KNOWN 永不进入 exact 阵型/覆盖数学（fail-closed），只作为独立信息输出（不 future-leak）。
        final Map<Long, PhasePositionReference> refsByAccount = new LinkedHashMap<>();
        for (final Map.Entry<Long, List<PositionSample>> entry : tracks.entrySet()) {
            final int team = teamByAccount.getOrDefault(entry.getKey(), 0);
            final PhasePositionReference ref = resolvePhasePosition(
                    battle, entry.getKey(), team, entry.getValue(),
                    phase.start(), phase.end(), playersByAccount,
                    mapping, aoiByEntity, perspectiveTeam);
            if (ref != null) {
                refsByAccount.put(entry.getKey(), ref);
            }
        }
        final int ownTeam = perspectiveTeam;
        final int enemyTeam = 3 - ownTeam;
        // CURRENT / LAST_KNOWN 分流：exact 阵型/覆盖测量只消费 CURRENT；enemy LAST_KNOWN 独立列出
        final Map<Long, PhasePositionReference> ownCurrent = new LinkedHashMap<>();
        final Map<Long, PhasePositionReference> enemyCurrent = new LinkedHashMap<>();
        final Map<Long, PhasePositionReference> enemyLastKnown = new LinkedHashMap<>();
        for (final Map.Entry<Long, PhasePositionReference> entry : refsByAccount.entrySet()) {
            final PhasePositionReference ref = entry.getValue();
            if (!ref.current()) {
                if (ref.team() == enemyTeam) {
                    enemyLastKnown.put(entry.getKey(), ref);
                }
                continue;
            }
            if (ref.team() == ownTeam) {
                ownCurrent.put(entry.getKey(), ref);
            } else {
                enemyCurrent.put(entry.getKey(), ref);
            }
        }
        // 阶段完整性：统计存活车辆与 CURRENT 位置参考；缺少参考或 enemy LAST_KNOWN 都不满足 completeness。
        int ownRefCount = 0;
        int enemyRefCount = 0;
        int ownAliveCount = 0;
        int enemyAliveCount = 0;
        for (final Map.Entry<Long, PlayerResult> entry : playersByAccount.entrySet()) {
            final PlayerResult pl = entry.getValue();
            if (pl == null || (pl.team != ownTeam && pl.team != enemyTeam)) {
                continue;
            }
            if (!isAliveAt(battle, playersByAccount, entry.getKey(), phase.end())) {
                continue; // 本阶段已阵亡：不要求位置参考，也不计入 alive
            }
            final boolean hasCurrent = pl.team == ownTeam
                    ? ownCurrent.containsKey(entry.getKey())
                    : enemyCurrent.containsKey(entry.getKey());
            if (pl.team == ownTeam) {
                ownAliveCount++;
                if (hasCurrent) {
                    ownRefCount++;
                }
            } else {
                enemyAliveCount++;
                if (hasCurrent) {
                    enemyRefCount++;
                }
            }
        }

        return FormationDepthPhaseRenderer.renderPhase(
                phase.key(), phase.start(), phase.end(),
                renderReferences(ownCurrent), renderReferences(enemyCurrent), renderReferences(enemyLastKnown),
                profiles, mapCode, ownRefCount, enemyRefCount, ownAliveCount, enemyAliveCount);
    }

    /**
     * Keep every field the renderer consumes. Account identity stays in the map key, and caller-owned map
     * partitions retain team/current-vs-last-known state; the DTO carries coordinates and observation timing.
     */
    private static Map<Long, FormationDepthPhaseRenderer.PositionReference> renderReferences(
            final Map<Long, PhasePositionReference> references) {
        final Map<Long, FormationDepthPhaseRenderer.PositionReference> result = new LinkedHashMap<>();
        for (final Map.Entry<Long, PhasePositionReference> entry : references.entrySet()) {
            final PhasePositionReference ref = entry.getValue();
            result.put(entry.getKey(), new FormationDepthPhaseRenderer.PositionReference(
                    ref.x(), ref.z(), ref.observedAtSec(), ref.ageSec()));
        }
        return result;
    }

    /**
     * 阶段位置参考：带知识状态（CURRENT / LAST_KNOWN）与观测时间。
     * <p>LAST_KNOWN 永不进入 exact 阵型/覆盖数学（fail-closed），只作为独立信息输出；
     * 杜绝「LAST_KNOWN 被数学层重新升级为 CURRENT exact geometry」。</p>
     */
    record PhasePositionReference(
            long accountId,
            int team,
            double x,
            double z,
            PositionKnowledge knowledge,
            double observedAtSec,
            double ageSec
    ) {
        /** 是否为 CURRENT 位置参考（exact 数学只允许消费 CURRENT）。 */
        boolean current() {
            return knowledge == PositionKnowledge.CURRENT;
        }
    }

    /**
     * 解析某账号在 [phaseStart, phaseEnd] 的阶段位置参考（canonical knowledge 同口径）。
     * <p><b>P0-1 禁止跨 UNKNOWN_AOI gap 混坐标</b>：先定位 phaseEnd 所属 canonical AoI
     * observed segment（该 segment 的 entityId 即<b>目标实体</b>），再<b>只</b>允许该
     * segment ∩ phase 的<b>同实体</b> position samples 进入 CURRENT 参考；
     * 若 phaseEnd ∈ UNKNOWN_AOI gap（或当前 segment 内无样本且 last-known 跨 gap）→
     * LAST_KNOWN / 不产出 CURRENT exact geometry。绝不把 gap 两边互相独立的 observed segments
     * 混成一个 exact 坐标。</p>
     * <p><b>Item P1 禁止跨实体混坐标</b>：位置样本必须保留 entity provenance（{@link PositionSample}），
     * CURRENT / carry-forward 参考<b>只与该 segment 所属的同一实体</b>相交——同账号因 re-entry /
     * 多生命周期出现的另一实体坐标绝不并入；目标实体无同源样本时 fail-closed 不产出 CURRENT。</p>
     * <ul>
     *   <li>存活门禁：phase 末已阵亡 → null（不参与当前几何）；</li>
     *   <li>segment ∩ phase 内有同实体样本 → 该窗口均值（CURRENT），observedAt=窗口内最后样本时刻；</li>
     *   <li>segment ∩ phase 无同实体样本 → carry-forward 该实体最后位置；仅当其位于 phaseEnd 的
     *       observed segment 内（不跨 gap）才 CURRENT，否则 LAST_KNOWN。</li>
     * </ul>
     */
    static PhasePositionReference resolvePhasePosition(
            final long accountId,
            final int team,
            final List<PositionSample> samples,
            final double phaseStart,
            final double phaseEnd,
            final Map<Long, PlayerResult> playersByAccount,
            final TeamEntityMapping mapping,
            final Map<Integer, List<AoiObservationSegment>> aoiByEntity,
            final int perspectiveTeam) {
        return resolvePhasePosition(null, accountId, team, samples, phaseStart, phaseEnd,
                playersByAccount, mapping, aoiByEntity, perspectiveTeam);
    }

    static PhasePositionReference resolvePhasePosition(
            final Battle battle,
            final long accountId,
            final int team,
            final List<PositionSample> samples,
            final double phaseStart,
            final double phaseEnd,
            final Map<Long, PlayerResult> playersByAccount,
            final TeamEntityMapping mapping,
            final Map<Integer, List<AoiObservationSegment>> aoiByEntity,
            final int perspectiveTeam) {
        final FormationDepthPositionResolver.PhasePositionReference resolved =
                FormationDepthPositionResolver.resolvePhasePosition(
                        isAliveAt(battle, playersByAccount, accountId, phaseEnd),
                        accountId, team, toResolverSamples(samples), phaseStart, phaseEnd,
                        mapping, aoiByEntity);
        return resolved == null ? null : new PhasePositionReference(
                resolved.accountId(), resolved.team(), resolved.x(), resolved.z(),
                resolved.knowledge(), resolved.observedAtSec(), resolved.ageSec());
    }

    private static List<FormationDepthPositionResolver.PositionSample> toResolverSamples(
            final List<PositionSample> samples) {
        if (samples == null || samples.isEmpty()) {
            return List.of();
        }
        final List<FormationDepthPositionResolver.PositionSample> converted = new ArrayList<>();
        for (final PositionSample sample : samples) {
            converted.add(new FormationDepthPositionResolver.PositionSample(
                    sample.entityId(), sample.t(), sample.x(), sample.z()));
        }
        return converted;
    }

    /** Carry-forward compatibility API used by package tests and RelativeDepth evidence. */
    static double[] carriedForwardReference(final List<PositionSample> samples, final double phaseEnd) {
        return FormationDepthPositionResolver.carriedForwardReference(toResolverSamples(samples), phaseEnd);
    }


    /** TankTacticalProfileRegistry 惰性加载（classpath json，与 PreBattleStrategicService 同源）。 */
    private static volatile TankTacticalProfileRegistry profileRegistryInstance;

    static TankTacticalProfileRegistry profileRegistry() {
        TankTacticalProfileRegistry local = profileRegistryInstance;
        if (local == null) {
            synchronized (FormationDepthEvidence.class) {
                local = profileRegistryInstance;
                if (local == null) {
                    local = TankTacticalProfileRegistry.load();
                    profileRegistryInstance = local;
                }

            }
        }
        return local;
    }

    /** 权威死亡边界（秒）：结算存活或死亡时刻未知 → null（不猜）。复用 PlayerResultFormat 口径。 */
    static Double knownDeathSec(final Battle battle, final PlayerResult p) {
        if (p == null || p.survived) {
            return null;
        }
        final double sec = PlayerResultFormat.deathSec(p);
        return sec > 0 ? sec : null;
    }

    /** 该账号在 t 时刻是否存活：死亡边界未知时视为存活（不猜）；已知且 t 超过边界 → 已阵亡。 */
    static boolean isAliveAt(final Battle battle, final Map<Long, PlayerResult> playersByAccount,
                             final long accountId, final double t) {
        final PlayerResult p = playersByAccount == null ? null : playersByAccount.get(accountId);
        if (p == null) {
            return true;
        }
        final Double deathSec = knownDeathSec(battle, p);
        return deathSec == null || t <= deathSec + 1e-6;
    }



    /** 阶段：opening = [0, 首次交火+15s（无交火则整场）]；late = 末 15s；mid = 中间。 */
    static List<PhaseRange> buildPhases(final double firstContact, final double battleEnd) {
        final List<PhaseRange> phases = new ArrayList<>();
        final double openingEnd = firstContact >= 0
                ? Math.min(battleEnd, firstContact + 15.0) : battleEnd;
        final double lateStart = Math.max(openingEnd, battleEnd - 15.0);
        phases.add(new PhaseRange("opening", 0.0, openingEnd));
        if (lateStart > openingEnd + 1e-3) {
            phases.add(new PhaseRange("mid", openingEnd, lateStart));
        }
        if (battleEnd - lateStart > 1e-3) {
            phases.add(new PhaseRange("late", lateStart, battleEnd));
        }
        return phases;
    }

    static double firstDamageTime(final List<ReplayEvent> events, final Float battleStart) {
        double first = -1;
        if (events == null) {
            return first;
        }
        for (final ReplayEvent event : events) {
            if (!(event instanceof DamageEvent damage)) {
                continue;
            }
            final double t = relativeSec(damage, battleStart);
            if (Double.isFinite(t) && t >= 0 && (first < 0 || t < first)) {
                first = t;
            }
        }
        return first;
    }

    static double lastSampleTime(final Map<Long, List<PositionSample>> tracks) {
        double last = 0;
        for (final List<PositionSample> list : tracks.values()) {
            for (final PositionSample s : list) {
                last = Math.max(last, s.t());
            }
        }
        return last;
    }

    static double[] centroid(final List<double[]> points) {
        return FormationDepthMath.centroid(points);
    }

    static double relativeSec(final ReplayEvent event, final Float battleStartRawClockSec) {
        if (event.timestamp() == null) {
            return 0;
        }
        final Float battle = event.timestamp().battleClockSec();
        if (battle != null) {
            return battle;
        }
        if (battleStartRawClockSec != null && Float.isFinite(battleStartRawClockSec)) {
            return event.timestamp().rawClockSec() - battleStartRawClockSec;
        }
        return event.timestamp().rawClockSec();
    }

    static String fmt(final double sec) {
        return FormationDepthMath.fmt(sec);
    }
}
