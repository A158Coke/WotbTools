package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.processing.TeamEntityMapper;
import com.wotb.core.processing.TeamEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayReconstructionService;
import com.wotb.core.replay.timeline.BattleTimeline;
import com.wotb.core.replay.timeline.BattleTimelineBuilder;
import com.wotb.core.replay.timeline.BattleTimelineResult;
import com.wotb.core.replay.timeline.TimelinePerspective;
import com.wotb.web.replay.dto.MapOverview;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Playback parity（docs/current-plan.md §54）：同一真实夹具，canonical timeline 派生的
 * BattlePlaybackAdapter 与既有 MapOverviewBuilder 的用户契约必须一致。
 * <p>时钟口径：legacy playback 历史上把 raw clock 当 battle-relative（隐含 start=0，含开战前偏移）；
 * canonical timeline 的 ESTIMATED start = BattleEnded.raw − duration（真实 battle-relative，
 * docs/current-plan.md §2.4）。parity 断言把 legacy 时间减去该偏移后对比——语义等价，
 * 数值（HP/maxHp/deathSec/事件计数/点数）必须严格一致。</p>
 */
class BattlePlaybackAdapterParityTest {

    private static Path fixture() throws Exception {
        final Path dir = Path.of(System.getProperty("user.dir"), "..", "..", "common", "fixtures", "replays")
                .normalize();
        try (Stream<Path> s = Files.list(dir)) {
            return s.filter(p -> p.getFileName().toString().contains("random-battle-example"))
                    .findFirst().orElseThrow();
        }
    }

    @Test
    void adapterPlaybackMatchesLegacyBuilderOnRealFixture() throws Exception {
        final byte[] bytes = Files.readAllBytes(fixture());
        final Battle battle = ReplayParser.parse(bytes);
        final ReplayReconstruction recon = new ReplayReconstructionService().reconstruct(bytes);
        final PlayerResult recorder = battle.recorderResult();
        assertNotNull(recorder);

        final BattleTimelineResult tl = BattleTimelineBuilder.build(
                battle, recon, TimelinePerspective.personal(
                        recorder.accountId > 0 ? recorder.accountId : null, recorder.team));
        assertTrue(tl.usable(), "真实回放必须构建 timeline: " + tl.validation().errors());
        final BattleTimeline timeline = tl.timeline();
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);

        final MapOverview overview = MapOverviewBuilder.build(battle, recon);
        final MapOverview.Playback legacy = overview == null ? null : overview.playback();
        final MapOverview.Playback adapted = BattlePlaybackAdapter.build(battle, timeline, mapping);
        assertNotNull(legacy, "legacy playback must build on fixture");
        assertNotNull(adapted, "adapter playback must build on fixture");

        // 时长契约
        assertEquals(legacy.durationSec(), adapted.durationSec(), 0.01);

        // 车辆集合一致（按 accountId）
        final Map<Long, MapOverview.PlaybackVehicle> legacyByAccount = new HashMap<>();
        for (final MapOverview.PlaybackVehicle v : legacy.vehicles()) {
            legacyByAccount.put(v.accountId(), v);
        }
        final Map<Long, MapOverview.PlaybackVehicle> adaptedByAccount = new HashMap<>();
        for (final MapOverview.PlaybackVehicle v : adapted.vehicles()) {
            adaptedByAccount.put(v.accountId(), v);
        }
        assertEquals(legacyByAccount.keySet(), adaptedByAccount.keySet(), "车辆集合必须一致");

        for (final Map.Entry<Long, MapOverview.PlaybackVehicle> e : legacyByAccount.entrySet()) {
            final MapOverview.PlaybackVehicle lv = e.getValue();
            final MapOverview.PlaybackVehicle av = adaptedByAccount.get(e.getKey());
            assertNotNull(av, "adapter 缺车 " + e.getKey());

            // deathSec 严格一致（来源同为结算）；HP 字段（baseHp/observedCapacityHp）双构建器同源一致
            assertEquals(lv.deathSec(), av.deathSec(), "deathSec 必须一致: " + e.getKey());
            assertEquals(lv.baseHp(), av.baseHp(), "baseHp 必须一致: " + e.getKey());
            assertEquals(lv.observedCapacityHp(), av.observedCapacityHp(),
                    "observedCapacityHp 必须一致: " + e.getKey());
            // observedCapacityHp = 纯回放观测（真实 Type-7 positive sample 最大值，无可信样本为 null），
            // 与各自 hpSamples 一致——绝不 max(观测, base)/fallback base
            assertEquals(MapOverview.observedCapacityHpOf(lv.hpSamples()), lv.observedCapacityHp(),
                    "legacy observedCapacityHp 必须与 hpSamples 纯观测最大值一致: " + e.getKey());
            assertEquals(MapOverview.observedCapacityHpOf(av.hpSamples()), av.observedCapacityHp(),
                    "adapter observedCapacityHp 必须与 hpSamples 纯观测最大值一致: " + e.getKey());

            // 新字段（entry HP provenance / 车辆类型 / 最终战绩）双构建器同源一致
            assertEquals(lv.tankType(), av.tankType(), "tankType 必须一致: " + e.getKey());
            assertEquals(lv.entryHpSource(), av.entryHpSource(),
                    "entryHpSource 必须一致: " + e.getKey());
            assertEquals(lv.entryHp(), av.entryHp(), "entryHp 必须一致: " + e.getKey());
            assertEquals(lv.finalStats(), av.finalStats(), "finalStats 必须一致: " + e.getKey());

            // HP 时间线：同一批事件，时间按 battle-relative 偏移对齐，值严格一致
            assertEquals(lv.hpSamples().size(), av.hpSamples().size(),
                    "HP 采样数必须一致: " + e.getKey());
            for (int i = 0; i < lv.hpSamples().size(); i++) {
                assertEquals(lv.hpSamples().get(i).hp(), av.hpSamples().get(i).hp(),
                        "HP 采样值必须一致: " + e.getKey());
                assertCloseToShifted(lv.hpSamples().get(i).timeSec(), av.hpSamples().get(i).timeSec(),
                        timeline, "HP 采样时间(battle-relative)必须一致: " + e.getKey());
            }

            // 位置上报区间：等价语义（legacy raw 时间 − battle start ≈ adapter battle-relative）
            assertEquals(lv.positionIntervals().size(), av.positionIntervals().size(),
                    "位置区间数必须一致: " + e.getKey());
            for (int i = 0; i < lv.positionIntervals().size(); i++) {
                assertCloseToShifted(lv.positionIntervals().get(i).startSec(),
                        av.positionIntervals().get(i).startSec(), timeline,
                        "位置区间 start 必须一致: " + e.getKey());
                assertCloseToShifted(lv.positionIntervals().get(i).endSec(),
                        av.positionIntervals().get(i).endSec(), timeline,
                        "位置区间 end 必须一致: " + e.getKey());
            }

            // 方向采样：语义等价（非空性一致；采样规则不同允许数量差异）
            assertEquals(lv.directionSamples().isEmpty(), av.directionSamples().isEmpty(),
                    "方向采样非空性必须一致: " + e.getKey());
        }

        // 事件契约：DAMAGE / DESTROYED / KILL 计数一致
        assertEquals(countType(legacy.events(), "DAMAGE"), countType(adapted.events(), "DAMAGE"),
                "DAMAGE 事件数必须一致");
        assertEquals(countType(legacy.events(), "DESTROYED"), countType(adapted.events(), "DESTROYED"),
                "DESTROYED 事件数必须一致");
        assertEquals(countType(legacy.events(), "KILL"), countType(adapted.events(), "KILL"),
                "KILL 事件数必须一致");
        // 争霸赛点数契约
        assertEquals(legacy.pointsSamples().size(), adapted.pointsSamples().size(),
                "点数采样数必须一致");
        for (int i = 0; i < legacy.pointsSamples().size(); i++) {
            assertEquals(legacy.pointsSamples().get(i).team(), adapted.pointsSamples().get(i).team());
            assertEquals(legacy.pointsSamples().get(i).points(), adapted.pointsSamples().get(i).points());
            assertCloseToShifted(legacy.pointsSamples().get(i).timeSec(),
                    adapted.pointsSamples().get(i).timeSec(), timeline, "点数时间必须一致");
        }

        // ---- 真实回放 QA（docs/current-plan.md §24）：新字段在真实 fixture 上可用 ----
        for (final MapOverview.PlaybackVehicle v : adapted.vehicles()) {
            assertNotNull(v.finalStats(), "finalStats 不得为 null: " + v.accountId());
            final PlayerResult player = playerOf(battle, v.accountId());
            assertNotNull(player, "fixture 车辆必须能回查到 PlayerResult: " + v.accountId());
            assertEquals(player.damageDealt, v.finalStats().damageDealt());
            assertEquals(player.damageReceived, v.finalStats().damageReceived());
            assertEquals(player.damageAssisted, v.finalStats().damageAssisted());
            assertEquals(player.kills, v.finalStats().kills());
            assertEquals(player.nShots, v.finalStats().nShots());
            assertEquals(player.nHitsDealt, v.finalStats().nHitsDealt());
            assertEquals(player.nPenetrationsDealt, v.finalStats().nPenetrationsDealt());
            assertEquals(player.damageBlocked, v.finalStats().damageBlocked());
            // entry HP provenance 契约：OBSERVED_EXACT 才有 entryHp，其余为 null
            if ("OBSERVED_EXACT".equals(v.entryHpSource())) {
                assertNotNull(v.entryHp(), "OBSERVED_EXACT 必须带 entryHp: " + v.accountId());
                assertTrue(v.entryHp() > 0);
            } else {
                assertEquals(null, v.entryHp(), "非 OBSERVED_EXACT 不得冒充进场满血: " + v.accountId());
            }
            // 阵亡车辆必须有 0 血量采样（击毁 = 权威 0，前端不得靠猜测）
            if (v.deathSec() != null) {
                assertTrue(v.hpSamples().stream().anyMatch(s -> s.hp() == 0),
                        "阵亡车辆必须有 0 采样: " + v.accountId());
            }
        }
        // KILL 广播 provenance（docs/current-plan.md §15）：KILL 的 attacker/victim 必须来自
        // 同一时刻（同炮窗口）的 DAMAGE 事件——击杀者身份只由客户端伤害通知证明，
        // 前端 kill feed 不得超出该证据范围（未证明全局广播 → 只显示受害者被击毁）。
        for (final MapOverview.PlaybackEvent kill : adapted.events()) {
            if (!"KILL".equals(kill.type())) {
                continue;
            }
            final boolean backed = adapted.events().stream().anyMatch(e ->
                    "DAMAGE".equals(e.type())
                            && Math.abs(e.timeSec() - kill.timeSec()) <= 0.25
                            && java.util.Objects.equals(e.accountId(), kill.accountId())
                            && java.util.Objects.equals(e.targetAccountId(), kill.targetAccountId()));
            assertTrue(backed, "KILL 必须由同炮 DAMAGE 支撑: " + kill.timeSec());
        }
    }

    private static PlayerResult playerOf(final Battle battle, final long accountId) {
        for (final PlayerResult p : battle.players) {
            if (p.accountId == accountId) {
                return p;
            }
        }
        return null;
    }

    /**
     * legacy raw 时间 − battle start ≈ adapter battle-relative 时间。
     * 区间边界容差 2.0s：adapter 以 1 秒 frame 粒度评估知识状态（运行段结束可能早 ~1s），
     * 属「等价语义」（docs/current-plan.md §54），事件/HP/点数用严格断言。
     */
    private static void assertCloseToShifted(
            final double legacyTime, final double adaptedTime,
            final BattleTimeline timeline, final String message) {
        final double shifted = legacyTime - timeline.battleStartRawClockSec();
        final double clamped = Math.max(0, shifted);
        assertTrue(Math.abs(clamped - adaptedTime) < 2.0,
                message + " legacy=" + legacyTime + " start=" + timeline.battleStartRawClockSec()
                        + " adapted=" + adaptedTime);
    }

    private static long countType(final List<MapOverview.PlaybackEvent> events, final String type) {
        return events.stream().filter(e -> type.equals(e.type())).count();
    }
}
