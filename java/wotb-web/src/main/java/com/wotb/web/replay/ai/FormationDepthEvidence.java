package com.wotb.web.replay.ai;

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
import com.wotb.core.replay.feature.MapCoordinateProfile;
import com.wotb.core.replay.feature.MapCoordinateResolution;
import com.wotb.core.replay.feature.MapRegionResolver;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.timeline.PositionKnowledge;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.Comparator;
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
        // 区域 presence：基于 resolved 车辆位置 state（每辆 CURRENT 车辆 +1），不是位置包数量。
        // 移动更频繁的车不会因包更多而人为增加 presence（coverageCompleteness=7/7 时 presence/coverage 同源）。
        final Map<Integer, Integer> ownRegionCount = new LinkedHashMap<>();
        final Map<Integer, Integer> enemyRegionCount = new LinkedHashMap<>();
        for (final Map.Entry<Long, PhasePositionReference> entry : ownCurrent.entrySet()) {
            final int region = regionOf(entry.getValue(), mapCode);
            if (region > 0) {
                ownRegionCount.merge(region, 1, Integer::sum);
            }
        }
        for (final Map.Entry<Long, PhasePositionReference> entry : enemyCurrent.entrySet()) {
            final int region = regionOf(entry.getValue(), mapCode);
            if (region > 0) {
                enemyRegionCount.merge(region, 1, Integer::sum);
            }
        }
        // 位置参考完整性（fail-closed 门禁）：本阶段存活的双方成员中拥有 CURRENT 位置参考的计数
        // （enemy LAST_KNOWN 不得满足 current-position completeness）
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

        // 控制权：车辆 CURRENT 位置 → canonical（九宫格距离加权火力覆盖基准；LAST_KNOWN 不得作为当前坐标）
        final Map<Long, double[]> ownCanonical = new LinkedHashMap<>();
        final Map<Long, double[]> enemyCanonical = new LinkedHashMap<>();
        for (final Map.Entry<Long, PhasePositionReference> entry : ownCurrent.entrySet()) {
            final double[] canonical = canonicalOf(entry.getValue(), mapCode);
            if (canonical != null) {
                ownCanonical.put(entry.getKey(), canonical);
            }
        }
        for (final Map.Entry<Long, PhasePositionReference> entry : enemyCurrent.entrySet()) {
            final double[] canonical = canonicalOf(entry.getValue(), mapCode);
            if (canonical != null) {
                enemyCanonical.put(entry.getKey(), canonical);
            }
        }
        final StringBuilder sb = new StringBuilder();
        final String header = "phase=" + phase.key()
                + " [" + fmt(phase.start()) + "-" + fmt(phase.end()) + "s]\n";

        // 几何纵深：本队成员沿本队质心→敌方质心轴投影，按深度三分位（纯几何，只消费 CURRENT 位置；
        // enemy LAST_KNOWN 不得作为当前 enemy centroid / 轴参考）。
        // fail-close gate（PR #103）：任何依赖双方 current geometry 的 exact 计算
        // （enemy centroid / GEOMETRIC_* / 距离加权覆盖分 / ratio）必须在 completeness gate 之前判定，
        // 且只有 ownRefComplete && enemyRefComplete 才允许输出——enemyRef=1/2 时用 1 辆敌方 CURRENT
        // 建立 whole-team enemy centroid 会与覆盖段 POSITION_COVERAGE_INSUFFICIENT 自相矛盾；
        // partial CURRENT 只允许 INSUFFICIENT + CURRENT presence + coverage counts + LAST_KNOWN 独立信息。
        final boolean ownRefComplete = ownRefCount >= ownAliveCount;
        final boolean enemyRefComplete = enemyRefCount >= enemyAliveCount;
        final List<Map.Entry<Long, double[]>> own = new ArrayList<>();
        final List<double[]> enemyMeans = new ArrayList<>();
        for (final Map.Entry<Long, PhasePositionReference> entry : ownCurrent.entrySet()) {
            own.add(new java.util.AbstractMap.SimpleImmutableEntry<>(entry.getKey(),
                    new double[]{entry.getValue().x(), entry.getValue().z()}));
        }
        for (final Map.Entry<Long, PhasePositionReference> entry : enemyCurrent.entrySet()) {
            enemyMeans.add(new double[]{entry.getValue().x(), entry.getValue().z()});
        }
        if (ownRefComplete && enemyRefComplete && own.size() >= 2 && !enemyMeans.isEmpty()) {
            final double[] ownCentroid = centroid(own.stream().map(Map.Entry::getValue).toList());
            final double[] enemyCentroid = centroid(enemyMeans);
            final double ax = enemyCentroid[0] - ownCentroid[0];
            final double az = enemyCentroid[1] - ownCentroid[1];
            final double len = Math.hypot(ax, az);
            if (len > 1e-6) {
                final double ux = ax / len, uz = az / len;
                final List<double[]> depths = new ArrayList<>();
                for (final Map.Entry<Long, double[]> member : own) {
                    final double d = (member.getValue()[0] - ownCentroid[0]) * ux
                            + (member.getValue()[1] - ownCentroid[1]) * uz;
                    depths.add(new double[]{d, member.getKey()});
                }
                depths.sort(Comparator.comparingDouble(a -> -a[0]));
                // 纯几何深度三分位：不引用 tank profile 分类，任何车种都按几何位置归入三分位
                final double minD = depths.get(depths.size() - 1)[0];
                final double maxD = depths.get(0)[0];
                final double span = maxD - minD;
                final double frontThreshold = span > 1e-6 ? minD + span * 2.0 / 3.0 : maxD;
                final double backThreshold = span > 1e-6 ? minD + span / 3.0 : maxD;
                final List<String> geometricForward = new ArrayList<>();
                final List<String> geometricMiddle = new ArrayList<>();
                final List<String> geometricRear = new ArrayList<>();
                for (final double[] d : depths) {
                    final String key = annotate(Math.round(d[1]), profiles);
                    if (d[0] >= frontThreshold - 1e-9) {
                        geometricForward.add(key);
                    } else if (d[0] <= backThreshold + 1e-9) {
                        geometricRear.add(key);
                    } else {
                        geometricMiddle.add(key);
                    }
                }
                sb.append(header)
                        .append("GEOMETRIC_FORWARD=").append(String.join(",", geometricForward)).append("\n")
                        .append("GEOMETRIC_MIDDLE=").append(String.join(",", geometricMiddle)).append("\n")
                        .append("GEOMETRIC_REAR=").append(String.join(",", geometricRear)).append("\n");
                return sb.toString() + renderCoverage(ownRegionCount, enemyRegionCount,
                        ownCanonical, enemyCanonical, profiles, mapCode,
                        ownRefCount, enemyRefCount, ownAliveCount, enemyAliveCount,
                        enemyLastKnown);
            }
        }
        sb.append(header);
        return sb.toString() + renderCoverage(ownRegionCount, enemyRegionCount,
                ownCanonical, enemyCanonical, profiles, mapCode,
                ownRefCount, enemyRefCount, ownAliveCount, enemyAliveCount,
                enemyLastKnown);
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
        // 存活门禁：phase 末已阵亡 → 位置 state 终止 → null（不参与当前几何）
        if (!isAliveAt(battle, playersByAccount, accountId, phaseEnd)) {
            return null;
        }
        // Canonical AoI authority：先定位 phaseEnd 所属 observed segment——该 segment 的实体即「目标实体」。
        // Item P1：CURRENT / carry-forward 只与目标实体的样本相交；同一账号多实体生命周期（re-entry）
        // 时不得把另一实体的坐标并入同一 CURRENT（fail-closed）。
        final AoiObservationSegment seg = observedSegmentAt(aoiByEntity, mapping, accountId, phaseEnd);
        // phaseEnd ∈ UNKNOWN_AOI gap（seg==null）时退化为「phaseEnd 前最后有样本的实体」，以保持单实体来源。
        final int targetEntity = seg != null ? seg.entityId() : lastObservedEntityId(samples, phaseEnd);
        // 同实体样本过滤（fail-closed）：目标实体无任何样本 → 无同源位置可消费，不产出 CURRENT。
        final List<PositionSample> entitySamples = sameEntitySamples(samples, targetEntity);
        if (entitySamples.isEmpty()) {
            return null;
        }
        double sx = 0, sz = 0;
        int n = 0;
        double lastInWindow = -1;
        if (seg != null) {
            final double segStart = Math.max(phaseStart, seg.observedFromSec());
            final double segEnd = seg.absentFromSec() != null
                    ? Math.min(phaseEnd, seg.absentFromSec()) : phaseEnd;
            for (final PositionSample sample : entitySamples) {
                if (sample.t() < segStart || sample.t() > segEnd) {
                    continue;
                }
                sx += sample.x();
                sz += sample.z();
                n++;
                lastInWindow = Math.max(lastInWindow, sample.t());
            }
        }
        final double x;
        final double z;
        final double observedAt;
        final PositionKnowledge knowledge;
        if (n > 0) {
            // 样本全部来自 phaseEnd 的 observed segment ∩ phase 的同一实体 → CURRENT（exact 几何可消费）
            x = sx / n;
            z = sz / n;
            observedAt = lastInWindow;
            knowledge = PositionKnowledge.CURRENT;
        } else {
            // 当前 segment 内无同实体样本（或 phaseEnd ∈ UNKNOWN_AOI gap）：carry-forward last-known；
            // 仅当 last-known 位于 phaseEnd 的 observed segment（不跨 gap）才 CURRENT，否则 LAST_KNOWN。
            final double[] carry = carriedForwardReference(entitySamples, phaseEnd);
            if (carry == null) {
                return null;
            }
            x = carry[1];
            z = carry[2];
            observedAt = carry[0];
            knowledge = (seg != null && observedAt >= seg.observedFromSec() - 1e-9
                    && (seg.absentFromSec() == null || observedAt < seg.absentFromSec() - 1e-9))
                    ? PositionKnowledge.CURRENT : PositionKnowledge.LAST_KNOWN;
        }
        return new PhasePositionReference(
                accountId, team, x, z, knowledge, observedAt, phaseEnd - observedAt);
    }

    /** 该账号任一实体在 phaseEnd 所处的 observed segment（∈ UNKNOWN_AOI gap / 未观测 → null）。 */
    private static AoiObservationSegment observedSegmentAt(
            final Map<Integer, List<AoiObservationSegment>> aoiByEntity,
            final TeamEntityMapping mapping,
            final long accountId,
            final double phaseEnd) {
        if (mapping == null || aoiByEntity == null) {
            return null;
        }
        for (final int eid : mapping.entityIds(accountId)) {
            final AoiObservationSegment seg = ReplayAoiLifecycle.segmentAt(aoiByEntity, eid, phaseEnd);
            if (seg != null) {
                return seg;
            }
        }
        return null;
    }

    /** 参考位置所属九宫格 region（0 = 不可用）。 */
    private static int regionOf(final PhasePositionReference ref, final String mapCode) {
        final MapCoordinateResolution res = MapRegionResolver.resolve(
                (float) ref.x(), (float) ref.z(), mapCode);
        if (res == null || !res.usable()) {
            return 0;
        }
        return res.region();
    }

    /** 参考位置 → canonical 坐标（null = 不可用；供距离加权火力覆盖计算）。 */
    private static double[] canonicalOf(final PhasePositionReference ref, final String mapCode) {
        final MapCoordinateResolution res = MapRegionResolver.resolve(
                (float) ref.x(), (float) ref.z(), mapCode);
        if (res == null || !res.usable() || res.position() == null) {
            return null;
        }
        return new double[]{res.position().x(), res.position().z()};
    }

    /**
     * 该账号在 phaseEnd 时刻的 carry-forward 位置参考：取 ≤ phaseEnd 的最后<b>同实体</b>位置样本；
     * 从未有样本 → null。
     * <p>P0-1：即使该实体已 EntityLeave（Type4，位置 state 终止），最后已知位置仍作为
     * LAST_KNOWN 参考保留（不得静默丢弃）——CURRENT vs LAST_KNOWN 由
     * {@link #resolvePhasePosition} 的 canonical segment 判定；LAST_KNOWN 不进 exact geometry（fail-closed）。</p>
     */
    static double[] carriedForwardReference(
            final List<PositionSample> samples,
            final double phaseEnd) {
        double[] carry = null;
        for (final PositionSample s : samples) {
            if (s.t() <= phaseEnd + 1e-6) {
                carry = new double[]{s.t(), s.x(), s.z()};
            } else {
                break;
            }
        }
        return carry;
    }

    /** 过滤出属于指定实体的样本（Item P1：保持 entity provenance，禁止跨实体合并坐标）。 */
    private static List<PositionSample> sameEntitySamples(
            final List<PositionSample> samples, final int entityId) {
        if (samples == null || entityId <= 0) {
            return List.of();
        }
        final List<PositionSample> out = new ArrayList<>();
        for (final PositionSample s : samples) {
            if (s.entityId() == entityId) {
                out.add(s);
            }
        }
        return out;
    }

    /** phaseEnd 前最后有位置样本的实体（确定性：t 最大，同 t 取 entityId 小）；无样本 → -1。 */
    private static int lastObservedEntityId(
            final List<PositionSample> samples, final double phaseEnd) {
        double bestT = -Double.MAX_VALUE;
        int bestEntity = -1;
        for (final PositionSample s : samples) {
            if (s.t() > phaseEnd + 1e-6) {
                continue;
            }
            if (bestEntity < 0 || s.t() > bestT + 1e-9
                    || (Math.abs(s.t() - bestT) <= 1e-9 && s.entityId() < bestEntity)) {
                bestT = s.t();
                bestEntity = s.entityId();
            }
        }
        return bestEntity;
    }

    /** 账号展示 key：附 tank profile 标注（如 account:1234(HEAVY,armor=HIGH)）；UNKNOWN 只标未知。 */
    private static String annotate(final long accountId, final Map<Long, TankTacticalProfile> profiles) {
        final TankTacticalProfile profile = profiles.get(accountId);
        if (profile == null || "UNKNOWN".equals(profile.vehicleClass())) {
            return "account:" + accountId + "(UNKNOWN)";
        }
        return "account:" + accountId + "(" + profile.vehicleClass() + ",armor=" + profile.armorReliability() + ")";
    }

    /** 坦克静态属性事实（车种/装甲）：只作成员标注，不参与几何三分位判定（Backend Evidence Boundary）。 */

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
        final double sec = PlayerResultFormat.deathSec(battle, p);
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



    /** 区域覆盖测量：九宫格每区输出 own/enemy 位置存在数 + 双方距离加权火力覆盖分（F=Σ fireWeight/(1+d/100)）与 ratio。
     * 只输出确定性测量（位置几何 + 火力权重近似），不输出 own/contested/enemy 权威控制权标签——
     * 哪方「实际控制/压制/放弃某区」由 LLM 综合交火、点数压力等自行判断（Backend Evidence Boundary）。
     */
    private static String renderCoverage(
            final Map<Integer, Integer> own,
            final Map<Integer, Integer> enemy,
            final Map<Long, double[]> ownCanonical,
            final Map<Long, double[]> enemyCanonical,
            final Map<Long, TankTacticalProfile> profiles,
            final String mapCode,
            final int ownRefCount,
            final int enemyRefCount,
            final int ownAliveCount,
            final int enemyAliveCount,
            final Map<Long, PhasePositionReference> enemyLastKnown
    ) {
        final boolean ownRefComplete = ownRefCount >= ownAliveCount;
        final boolean enemyRefComplete = enemyRefCount >= enemyAliveCount;
        if (!ownRefComplete || !enemyRefComplete) {
            // 位置参考完整性门禁：任一方存活车辆缺少 CURRENT 位置参考时，禁止输出分数对比
            // （缺失/LAST_KNOWN 的敌方车辆 ≠ 不存在）；只输出 CURRENT 位置存在纯事实 + coverage completeness
            // + 敌方 LAST_KNOWN 独立信息（不得伪装成 current，不得 future-leak）。
            final StringBuilder fail = new StringBuilder();
            final List<String> presence = new ArrayList<>(own.keySet().stream()
                    .sorted().map(r -> "GRID_REGION_" + r).toList());
            fail.append("REGION_COVERAGE_MEASUREMENTS（POSITION_COVERAGE_INSUFFICIENT：")
                    .append("ownRef=").append(ownRefCount).append("/").append(ownAliveCount)
                    .append(" enemyRef=").append(enemyRefCount).append("/").append(enemyAliveCount).append("）\n");
            if (!presence.isEmpty()) {
                fail.append("ownPositionPresence=").append(String.join(",", presence)).append("\n");
            }
            if (!enemyLastKnown.isEmpty()) {
                fail.append("ENEMY_LAST_KNOWN_POSITION_REFERENCES（独立信息，不得当作当前精确位置）:\n");
                final List<Map.Entry<Long, PhasePositionReference>> lastKnown =
                        new ArrayList<>(enemyLastKnown.entrySet());
                lastKnown.sort(java.util.Comparator.comparingLong(Map.Entry::getKey));
                for (final Map.Entry<Long, PhasePositionReference> entry : lastKnown) {
                    final PhasePositionReference ref = entry.getValue();
                    final int region = regionOf(ref, mapCode);
                    fail.append("  account:").append(entry.getKey())
                            .append(" region=").append(region > 0 ? "GRID_REGION_" + region : "UNKNOWN")
                            .append(" observedAtSec=").append(fmt(ref.observedAtSec()))
                            .append(" ageSec=").append(fmt(ref.ageSec()))
                            .append(" knowledge=LAST_KNOWN\n");
                }
            }
            return fail.toString();
        }
        final java.util.Set<Integer> regions = new java.util.LinkedHashSet<>();
        regions.addAll(own.keySet());
        regions.addAll(enemy.keySet());
        final StringBuilder sb = new StringBuilder();
        sb.append("REGION_COVERAGE_MEASUREMENTS（区域覆盖测量·确定性；LLM 自行判断含义）:\n");
        for (final int region : regions) {
            final double fOwn = fireCoverage(region, ownCanonical, profiles);
            final double fEnemy = fireCoverage(region, enemyCanonical, profiles);
            final int ownPresence = own.getOrDefault(region, 0);
            final int enemyPresence = enemy.getOrDefault(region, 0);
            sb.append("  GRID_REGION_").append(region)
                    .append(" ownPositionPresence=").append(ownPresence)
                    .append(" enemyPositionPresence=").append(enemyPresence)
                    .append(" ownWeightedCoverageScore=").append(fmt(fOwn))
                    .append(" enemyWeightedCoverageScore=").append(fmt(fEnemy))
                    .append(" ratio=").append(fmt(ratioOf(fOwn, fEnemy)))
                    .append(" coverageCompleteness=ownRef=").append(ownRefCount).append("/").append(ownAliveCount)
                    .append(" enemyRef=").append(enemyRefCount).append("/").append(enemyAliveCount)
                    .append("\n");
        }
        return sb.toString();
    }

    /** 双方分数比：一方为 0 时给 0（无对比意义）；两者皆 0 给 1（无信号）。 */
    private static double ratioOf(final double own, final double enemy) {
        if (own <= 0 && enemy <= 0) {
            return 1.0;
        }
        if (own <= 0 || enemy <= 0) {
            return 0.0;
        }
        return own / enemy;
    }

    /** 火力覆盖距离归一化（米，初值可标定）。 */
    static final double FIRE_DISTANCE_NORM_M = 100.0;

    /** 距离加权火力覆盖分：Σ fireWeight(v) / (1 + d/100)，d = 区域中心到车辆 canonical 位置距离。 */
    private static double fireCoverage(final int region, final Map<Long, double[]> positions,
                                       final Map<Long, TankTacticalProfile> profiles) {
        final double[] center = regionCenter(region);
        double f = 0;
        for (final Map.Entry<Long, double[]> entry : positions.entrySet()) {
            final double d = Math.hypot(entry.getValue()[0] - center[0], entry.getValue()[1] - center[1]);
            f += fireWeight(entry.getKey(), profiles) / (1.0 + d / FIRE_DISTANCE_NORM_M);
        }
        return f;
    }

    /** 火力权重（初值，纯静态 profile 事实）：HEAVY/TD=2、MEDIUM=1.5、LIGHT=1；burst/sustained=HIGH 各 +0.5。
     * 不按任何战术角色调整权重（Backend Evidence Boundary：车种/火力属性只是静态事实，不是战术判定）。 */
    private static double fireWeight(final long accountId, final Map<Long, TankTacticalProfile> profiles) {
        final TankTacticalProfile profile = profiles.get(accountId);
        final String cls = profile == null ? "" : profile.vehicleClass();
        double w = switch (cls) {
            case "HEAVY", "TANK_DESTROYER" -> 2.0;
            case "MEDIUM" -> 1.5;
            case "LIGHT" -> 1.0;
            default -> 1.0;
        };
        if (profile != null) {
            if ("HIGH".equals(profile.burstPotential())) {
                w += 0.5;
            }
            if ("HIGH".equals(profile.sustainedDpm())) {
                w += 0.5;
            }
        }
        return w;
    }

    /** 九宫格区域 canonical 几何中心（与 MapRegionResolver.resolveRegion 同网格）。 */
    private static double[] regionCenter(final int region) {
        final float third = MapCoordinateProfile.MAP_SIZE / 3f;
        final int row = (region - 1) / 3;
        final int col = (region - 1) % 3;
        return new double[]{(col + 0.5) * third, MapCoordinateProfile.MAP_SIZE - (row + 0.5) * third};
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
        double sx = 0, sz = 0;
        for (final double[] p : points) {
            sx += p[0];
            sz += p[1];
        }
        return new double[]{sx / points.size(), sz / points.size()};
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
        return String.valueOf(Math.round(sec * 10.0) / 10.0);
    }
}

