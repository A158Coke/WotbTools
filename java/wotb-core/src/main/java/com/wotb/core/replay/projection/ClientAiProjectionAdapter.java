package com.wotb.core.replay.projection;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.ArenaPeriodChangedEvent;
import com.wotb.core.replay.evidence.ObservedMaxHp;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.event.AssaultBaseStateTransition;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.EntityRemovedEvent;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.HpRawState;
import com.wotb.core.replay.event.MaterializationEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.RoundFinishedEvent;
import com.wotb.core.replay.event.SupremacyBaseId;
import com.wotb.core.replay.event.SupremacyBaseStateTransition;
import com.wotb.core.replay.event.SupremacyPointsChangedEvent;
import com.wotb.core.replay.event.TurretDirectionChangedEvent;
import com.wotb.core.replay.event.UnsupportedDamageEvent;
import com.wotb.core.replay.event.VehicleHealthStateEvent;
import com.wotb.core.replay.event.VehicleHitEvent;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.BattleStateReconstructor;
import com.wotb.core.replay.reconstruction.ReconstructionResult;
import com.wotb.core.replay.reconstruction.ReplayMetadata;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayStreamDiagnostics;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

/**
 * client canonical AI projection → 内存中的 canonical {@link ReplayReconstruction}（AI 证据链的既有输入）。
 *
 * <p><b>不是 parser</b>：不读任何回放字节。投影里的每条事实都已由客户端 canonical 层确认（身份、AoI 观测段、
 * 原始 HP / 位姿 / method8 分类），这里只把它们按旧 canonical 事件的语义编码装回事件流，让下游
 * BattleTimeline / 证据 / 特征层原样运行：</p>
 * <ul>
 *   <li>AoI 观测段 → {@link MaterializationEvent}（entityTypeId=2，开段物化 HP）+ {@link EntityRemovedEvent}；</li>
 *   <li>原始位姿 → {@link PositionChangedEvent}（世界坐标，attachmentParent=0）；prop2 → {@link TurretDirectionChangedEvent}；</li>
 *   <li>prop3 → {@link HealthChangedEvent}、method1 → {@link VehicleHealthStateEvent}（{@link HpRawState} 由原始 u16 分类）；</li>
 *   <li>method8 HIT → {@link VehicleHitEvent}，其余变体 → {@link UnsupportedDamageEvent}（归属 fail-closed 证据）；</li>
 *   <li>period → {@link ArenaPeriodChangedEvent}，AFTERBATTLE → {@link RoundFinishedEvent}；目标 → 点数 / 基地迁移。</li>
 * </ul>
 * <p>同一原始时钟内按旧包流的典型顺序排序（位姿 → 炮塔 → 命中 → prop3 → method1 → 基地 → 点数 → 离场），
 * sequence 为排序后序号。</p>
 * <p>{@link #enrichBattle} 再按旧服务端处理链同一函数（{@link ObservedMaxHp#populate}）从装配后的事件流回填
 * 回放实测血量——纯事实归约，不是解析。</p>
 * <p>
 * 引擎不提供的证据（{@code unavailableEvidence}）不合成任何事件；包解码覆盖率不存在 → coverage = null。</p>
 */
public final class ClientAiProjectionAdapter {

    /** 请求结构不合法（服务端只做结构校验，不判断事实真伪）。 */
    public static final class InvalidProjectionException extends IllegalArgumentException {
        public InvalidProjectionException(final String message) {
            super(message);
        }
    }

    private static final int MAX_PARTICIPANTS = 64;
    private static final int POSITION_STRIDE = 5;
    private static final int TURRET_STRIDE = 2;
    private static final int PERIOD_AFTERBATTLE = 4;
    private static final int DAMAGE_SUB_DIRECT = 3;

    private ClientAiProjectionAdapter() {
    }

    /**
     * 回放实测血量回填（{@code players.observedMaxHp / entryHp / entryHpSource}）：旧服务端处理链在重建后对
     * Battle 调用的同一函数，输入是已装配的 canonical 事件流。
     */
    public static void enrichBattle(final Battle battle, final ReplayReconstruction reconstruction) {
        if (battle == null || reconstruction == null) {
            return;
        }
        ObservedMaxHp.populate(battle, reconstruction.events(), TeamEntityMapper.resolve(battle, reconstruction));
    }

    /** 结构校验 + 装配。 */
    public static ReplayReconstruction toReconstruction(final Battle battle, final ClientAiProjection p) {
        validate(p);
        final List<Ranked> ranked = new ArrayList<>();
        final ClientAiProjection.Clock clock = p.clock();

        // 身份映射先于一切（旧流里 ParticipantMapping 在 0.2 s 左右的 Avatar 初始化包里）
        for (final ClientAiProjection.Participant pt : p.participants()) {
            ranked.add(new Ranked(0d, 0, seq -> new ParticipantMappingEvent(seq, ts(0d), 8, DecodeConfidence.EXACT,
                    pt.entityId(), pt.accountId(), pt.nickname(), pt.team())));
        }
        for (final ClientAiProjection.Period period : p.periods()) {
            ranked.add(new Ranked(period.rawClockSec(), 1, seq -> new ArenaPeriodChangedEvent(seq, ts(period.rawClockSec()),
                    8, DecodeConfidence.EXACT, period.period(), ArenaPeriodChangedEvent.periodOf(period.period()))));
            if (period.period() == PERIOD_AFTERBATTLE) {
                final int winner = p.perspective().winnerTeam() == null ? 0 : p.perspective().winnerTeam();
                final int finishRaw = battle != null && battle.settlementFinishReasonRaw != null
                        ? battle.settlementFinishReasonRaw : 0;
                ranked.add(new Ranked(period.rawClockSec(), 1, seq -> new RoundFinishedEvent(seq, ts(period.rawClockSec()),
                        8, DecodeConfidence.EXACT, winner, finishRaw, RoundFinishedEvent.causeOf(finishRaw))));
            }
        }
        for (final ClientAiProjection.ObservationWindow w : p.observationWindows()) {
            ranked.add(new Ranked(w.fromRawClockSec(), 2, seq -> new MaterializationEvent(seq, ts(w.fromRawClockSec()),
                    5, DecodeConfidence.EXACT, w.entityId(), 2, w.materializationHp(), new byte[0], new byte[0], null)));
            if (w.toRawClockSec() != null) {
                final double to = w.toRawClockSec();
                ranked.add(new Ranked(to, 10, seq -> new EntityRemovedEvent(seq, ts(to), 4, DecodeConfidence.EXACT,
                        w.entityId())));
            }
        }
        for (final ClientAiProjection.SampleTrack track : p.positions()) {
            final double[] s = track.samples();
            for (int i = 0; i < s.length; i += POSITION_STRIDE) {
                final double t = s[i];
                final float x = (float) s[i + 1], y = (float) s[i + 2], z = (float) s[i + 3], yaw = (float) s[i + 4];
                ranked.add(new Ranked(t, 3, seq -> new PositionChangedEvent(seq, ts(t), 10, DecodeConfidence.EXACT,
                        track.entityId(), 0, 0, x, y, z, 0f, 0f, 0f, yaw, 0f, 0f, 0)));
            }
        }
        for (final ClientAiProjection.SampleTrack track : p.turrets()) {
            final double[] s = track.samples();
            for (int i = 0; i < s.length; i += TURRET_STRIDE) {
                final double t = s[i];
                final double rel = s[i + 1];
                ranked.add(new Ranked(t, 4, seq -> new TurretDirectionChangedEvent(seq, ts(t), 7, DecodeConfidence.EXACT,
                        track.entityId(), rel)));
            }
        }
        for (final ClientAiProjection.DamageNotice n : p.damageNotices()) {
            if (n.kind() == ClientAiProjection.DamageNoticeKind.HIT) {
                final int primary = n.primaryResult() == null ? DAMAGE_SUB_DIRECT : n.primaryResult();
                final int secondary = n.secondaryResult() == null ? 0 : n.secondaryResult();
                ranked.add(new Ranked(n.rawClockSec(), 5, seq -> new VehicleHitEvent(seq, ts(n.rawClockSec()), 8,
                        DecodeConfidence.EXACT, n.attackerEntityId(), n.victimEntityId(), primary, secondary, new byte[0],
                        VehicleHitEvent.penetrationFamily(primary, secondary))));
            } else {
                final String variant = n.kind() == ClientAiProjection.DamageNoticeKind.SHORT_VARIANT
                        ? "SHORT_DAMAGE_VARIANT" : "DAMAGE_METHOD_VARIANT";
                ranked.add(new Ranked(n.rawClockSec(), 5, seq -> new UnsupportedDamageEvent(seq, ts(n.rawClockSec()), 8,
                        DecodeConfidence.PARTIAL, n.attackerEntityId(), n.victimEntityId(), null, null, variant)));
            }
        }
        for (final ClientAiProjection.Prop3Health h : p.prop3Health()) {
            ranked.add(new Ranked(h.rawClockSec(), 6, seq -> prop3(seq, h)));
        }
        for (final ClientAiProjection.HealthEvent h : p.healthEvents()) {
            ranked.add(new Ranked(h.rawClockSec(), 7, seq -> new VehicleHealthStateEvent(seq, ts(h.rawClockSec()), 8,
                    DecodeConfidence.EXACT, h.entityId(), h.hpRaw(), h.sourceEntityId(), h.causeFlag(), null,
                    HpRawState.classify(h.hpRaw()))));
        }
        final ClientAiProjection.Objectives objectives = p.objectives();
        for (final ClientAiProjection.PointsSample sp : objectives.supremacyPoints()) {
            ranked.add(new Ranked(sp.rawClockSec(), 9, seq -> new SupremacyPointsChangedEvent(seq, ts(sp.rawClockSec()), 8,
                    DecodeConfidence.EXACT, sp.team(), sp.points())));
        }
        for (final ClientAiProjection.SupremacyBase b : objectives.supremacyBases()) {
            final SupremacyBaseId baseId = SupremacyBaseId.valueOf(b.baseId());
            ranked.add(new Ranked(b.rawClockSec(), 8, seq -> new SupremacyBaseStateTransition(seq, ts(b.rawClockSec()), 8,
                    DecodeConfidence.EXACT, baseId, b.ownerTeam(), b.capturingTeam(), b.captureProgress())));
        }
        for (final ClientAiProjection.AssaultBase a : objectives.assaultBases()) {
            ranked.add(new Ranked(a.rawClockSec(), 8, seq -> new AssaultBaseStateTransition(seq, ts(a.rawClockSec()), 8,
                    DecodeConfidence.EXACT, a.captureProgress())));
        }

        ranked.sort(Comparator.comparingDouble(Ranked::clock).thenComparingInt(Ranked::rank));
        final List<ReplayEvent> events = new ArrayList<>(ranked.size());
        for (int i = 0; i < ranked.size(); i++) {
            events.add(ranked.get(i).factory().apply(i + 1));
        }

        final Float battleStart = clock.estimated() ? null : (float) clock.battleStartRawClockSec();
        final ReconstructionResult reduced = new BattleStateReconstructor(battleStart, 1.0f, 500).reconstruct(events);
        final List<BattleParticipant> participants = p.participants().stream()
                .map(pt -> new BattleParticipant(pt.accountId(), pt.nickname(), pt.team(), pt.tankId(), null, pt.recorder()))
                .toList();
        final float firstClock = events.isEmpty() ? 0f : events.getFirst().timestamp().rawClockSec();
        final float lastClock = clock.streamEndRawClockSec() != null ? clock.streamEndRawClockSec().floatValue()
                : events.isEmpty() ? 0f : events.getLast().timestamp().rawClockSec();
        return new ReplayReconstruction(
                metadata(battle, clock),
                null,
                (float) clock.battleDurationSec(),
                battleStart,
                participants,
                List.copyOf(events),
                reduced.checkpoints(),
                reduced.finalSnapshot(),
                null,
                new ReplayStreamDiagnostics(0, events.size(), firstClock, lastClock, 0, Map.of()));
    }

    private static HealthChangedEvent prop3(final int seq, final ClientAiProjection.Prop3Health h) {
        final HpRawState state = HpRawState.classify(h.hpRaw());
        final Integer current = switch (state) {
            case CURRENT_HP -> (int) (short) (h.hpRaw() & 0xFFFF);
            case HP_ZERO_TERMINAL -> 0;
            default -> null;
        };
        final Boolean alive = state == HpRawState.CURRENT_HP ? Boolean.TRUE : state.terminal() ? Boolean.FALSE : null;
        final DecodeConfidence confidence = state == HpRawState.CURRENT_HP || state.terminal()
                ? DecodeConfidence.EXACT : DecodeConfidence.PARTIAL;
        return new HealthChangedEvent(seq, ts(h.rawClockSec()), 7, confidence, h.entityId(), current, null, alive,
                h.hpRaw(), state);
    }

    private static ReplayMetadata metadata(final Battle battle, final ClientAiProjection.Clock clock) {
        if (battle == null) {
            return null;
        }
        return new ReplayMetadata(battle.arenaId, battle.mapName, battle.version, battle.clientVersion,
                battle.arenaBonusType, battle.recorder, battle.recorderVehicle,
                battle.durationS != null ? battle.durationS : clock.battleDurationSec(), battle.startTime);
    }

    private static ReplayTimestamp ts(final double rawClockSec) {
        return new ReplayTimestamp((float) rawClockSec, null);
    }

    /** 排序键：原始时钟 + 同刻包序等级；同键保持插入顺序（List.sort 稳定）。 */
    private record Ranked(double clock, int rank, Function<Integer, ReplayEvent> factory) {
    }

    // ---------- 结构校验 ----------

    static void validate(final ClientAiProjection p) {
        require(p != null, "projection missing");
        require(p.clock() != null && Double.isFinite(p.clock().battleStartRawClockSec())
                && Double.isFinite(p.clock().battleDurationSec()) && p.clock().battleDurationSec() > 0, "clock invalid");
        require(p.perspective() != null && p.perspective().recorderEntityIds() != null, "perspective invalid");
        for (final Object list : new Object[]{p.participants(), p.observationWindows(), p.positions(), p.turrets(),
                p.prop3Health(), p.healthEvents(), p.damageNotices(), p.periods(), p.limitations(), p.unavailableEvidence()}) {
            require(list != null, "projection list missing");
        }
        require(p.objectives() != null && p.objectives().supremacyPoints() != null
                && p.objectives().supremacyBases() != null && p.objectives().assaultBases() != null, "objectives missing");
        require(!p.participants().isEmpty() && p.participants().size() <= MAX_PARTICIPANTS, "participants size");
        final Set<Integer> entities = new HashSet<>();
        for (final ClientAiProjection.Participant pt : p.participants()) {
            require(pt.entityId() > 0 && pt.accountId() > 0 && (pt.team() == 1 || pt.team() == 2), "participant invalid");
            require(entities.add(pt.entityId()), "duplicate participant entity");
        }
        for (final ClientAiProjection.ObservationWindow w : p.observationWindows()) {
            require(entities.contains(w.entityId()) && Double.isFinite(w.fromRawClockSec())
                    && (w.toRawClockSec() == null || w.toRawClockSec() >= w.fromRawClockSec()), "observation window invalid");
        }
        validateTracks(p.positions(), POSITION_STRIDE, entities);
        validateTracks(p.turrets(), TURRET_STRIDE, entities);
        for (final ClientAiProjection.Prop3Health h : p.prop3Health()) {
            require(entities.contains(h.entityId()) && rawHp(h.hpRaw()) && Double.isFinite(h.rawClockSec()), "prop3 invalid");
        }
        for (final ClientAiProjection.HealthEvent h : p.healthEvents()) {
            require(entities.contains(h.entityId()) && rawHp(h.hpRaw()) && Double.isFinite(h.rawClockSec()), "health event invalid");
        }
        for (final ClientAiProjection.DamageNotice n : p.damageNotices()) {
            require(n.kind() != null && Double.isFinite(n.rawClockSec()), "damage notice invalid");
        }
        for (final ClientAiProjection.SupremacyBase b : p.objectives().supremacyBases()) {
            require(List.of("A", "B", "C", "D").contains(b.baseId()), "supremacy base id");
        }
    }

    private static void validateTracks(final List<ClientAiProjection.SampleTrack> tracks, final int stride,
                                       final Set<Integer> entities) {
        for (final ClientAiProjection.SampleTrack t : tracks) {
            require(t.stride() == stride && t.samples() != null && t.samples().length % stride == 0
                    && entities.contains(t.entityId()), "sample track invalid");
            for (final double v : t.samples()) {
                require(Double.isFinite(v), "sample not finite");
            }
        }
    }

    private static boolean rawHp(final int raw) {
        return raw >= 0 && raw <= 0xFFFF;
    }

    private static void require(final boolean ok, final String message) {
        if (!ok) {
            throw new InvalidProjectionException(message);
        }
    }
}
