package com.wotb.web.replay.ai;

import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.replay.evidence.EvidenceSkillContext;
import com.wotb.core.replay.evidence.EvidenceSkillEngine;
import com.wotb.core.replay.evidence.EvidenceSkillResult;
import com.wotb.core.replay.evidence.TeamGroundingFacts;
import com.wotb.core.replay.facts.ReplayFactsCodec;
import com.wotb.core.replay.feature.DefaultPlayerBattleFeatureExtractor;
import com.wotb.core.replay.feature.PlaybackCombatReconstruction;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.processing.RecorderEntityMapping;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.projection.ClientAiProjection;
import com.wotb.core.replay.projection.ClientAiProjectionAdapter;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.timeline.BattleFrame;
import com.wotb.core.replay.timeline.BattleTimeline;
import com.wotb.core.replay.timeline.BattleTimelineBuilder;
import com.wotb.core.replay.timeline.BattleTimelineResult;
import com.wotb.core.replay.timeline.FrameVehicle;
import com.wotb.core.replay.timeline.TimelinePerspective;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * AI 复盘输入的 semantic parity（永久）：同一场 fixture 回放，
 * <ul>
 *   <li><b>Java canonical</b>：服务端 parser 删除前冻结的 {@code ReplayReconstruction}（{@code common/fixtures/replay-facts}）；</li>
 *   <li><b>新链路</b>：锁定版本上游 WASM → 客户端 canonical facts → client canonical AI projection
 *       （{@code common/fixtures/ai-projection}，前端测试保证与现场 WASM 输出逐字段一致）→ {@link ClientAiProjectionAdapter}。</li>
 * </ul>
 * 两条输入走同一套下游，逐层比较：实体映射 → 掉血 / 归属 / 击毁 → BattleTimeline 每秒每车
 * （位置 knowledge、位置、生命、血量、血量 knowledge、地图区域）→ grounding facts → 团队 / 个人 prompt 全文。
 * 放行的差异只有 {@link #normalizePrompt} 里三条（内部事件条数 / 解码覆盖率 / 基地迁移分秒与时序），
 * 外加 {@link #PINNED_BASE_CAPTURE_JAVA_ONLY} 与 {@link #PINNED_BASE_CAPTURE_CLIENT_ONLY} 逐条冻结的
 * v0.3.11「占领中断归零」差异（按 fixture 限定、条数冻结，不做字段通配）。
 */
class ClientAiProjectionParityTest {

    /** 内部事件条数：新链路只装配下游实际消费的事件类型（Java 流还含大量 Unknown / AimRay 等未消费事件）。 */
    private static final Pattern EVENT_COUNT = Pattern.compile("位置时间线: 可用（\\d+ 个领域事件");
    /** 包解码覆盖率：新引擎不提供（unavailableEvidence = PACKET_DECODE_COVERAGE），渲染为 UNAVAILABLE。 */
    private static final Pattern DECODE_RATIO = Pattern.compile("decodedPacketRatio=[^,\\]]+");
    /** 基地迁移的分秒：上游 PlaybackData 目标时钟舍入到 0.01 s，跨整秒边界时 mm:ss 可差 1 s（时刻差 ≤ 0.01 s）。 */
    private static final Pattern BASE_EVENT_TIME = Pattern.compile("^\\[\\d+分\\d+秒\\] (BASE [A-D] )");
    /**
     * v0.3.11「占领中断归零」在**已知 fixture** 上产生的**逐条**差异（Java 冻结基线独有行）。
     *
     * <p>语义：占领中止（车辆出圈 / 被击毁）后，上游 v0.3.11 把进度与占领方一起清零，而冻结于
     * parser 删除前的 Java canonical 仍按旧语义保留最后一条进度（并在随后的广播里重复它）。
     * 这里**不通配字段**：每条差异行逐字列出，且必须在归一化时被精确消耗 pinned 次数——
     * 数量漂移（多一条 / 少一条）、行内容变化（时刻 / owner / 进度任一不同）都会失败，
     * 因此任何**其它** capture 回归仍由逐行比较抓住。
     *
     * <p>同一次契约补正的另一侧看守在前端 {@code playback.golden.test.ts} 的
     * {@code PINNED_BASE_ABORT_CLEARS} / {@code PINNED_ASSAULT_RESET_ROWS}。
     */
    private static final Map<String, List<String>> PINNED_BASE_CAPTURE_JAVA_ONLY = Map.of(
            "tournament-14-14-example", List.of(
                    // 中断前的最后一条敌方进度：新版不再保留（该时刻两边都以 6 起步）
                    "[t] BASE B owner=NONE capturing=ENEMY captureProgress=30",
                    // 旧语义把最后进度挂到行尾的重复行：新版以 NONE/UNKNOWN 取代
                    "[t] BASE B owner=NONE capturing=FRIENDLY captureProgress=42"));
    /**
     * 同一次补正在客户端（新链路）侧独有的行：占领中断后的清零状态。
     * 键与 {@link #PINNED_BASE_CAPTURE_JAVA_ONLY} 对应；只对团队 prompt 生效
     * （该段由 {@code TeamAiContextCompiler#renderObjectiveStateSection} 渲染，个人 prompt 不含）。
     */
    private static final Map<String, List<String>> PINNED_BASE_CAPTURE_CLIENT_ONLY = Map.of(
            "tournament-14-14-example", List.of(
                    "[t] BASE B owner=NONE capturing=NONE captureProgress=UNKNOWN",
                    "[t] BASE B owner=NONE capturing=NONE captureProgress=UNKNOWN"));
    /**
     * 只比较集合、不比较相对顺序的连续行段：
     * <ul>
     *   <li>时间线事件行（{@code [mm:ss] ...} / {@code [t] ...}）：同一 tick 内争霸点数与基地迁移的包序不可恢复
     *       （上游两类事件分列两个数组、时钟舍入 0.01 s），Java 按包序交错输出；</li>
     *   <li>{@code GRID_REGION_*} 区域行：排序键并列时的先后随事件顺序变化。</li>
     * </ul>
     * 行内容（事实与数值）必须逐字一致。
     */
    private static final Pattern ORDER_FREE_LINE = Pattern.compile("^(\\[(\\d+分\\d+秒|t)\\] |  GRID_REGION_\\d+ )");

    record Inputs(Battle javaBattle, ReplayReconstruction javaRecon, Battle clientBattle, ReplayReconstruction newRecon) {
    }

    private static Inputs inputs(final String name) {
        final ReplayFactsFixtures.Facts frozen = ReplayFactsFixtures.load(name);
        final Path file = Path.of(System.getProperty("user.dir"), "..", "..", "common", "fixtures", "ai-projection",
                name + ".json.gz").normalize();
        try (InputStream in = new GZIPInputStream(Files.newInputStream(file))) {
            final JsonNode root = JsonMapper.builder().build().readTree(in);
            final Battle clientBattle = ReplayFactsCodec.battleFromJson(root.get("battle"));
            final ClientAiProjection projection = ReplayFactsCodec.projectionFromJson(root.get("projection"));
            final ReplayReconstruction newRecon = ClientAiProjectionAdapter.toReconstruction(clientBattle, projection);
            ClientAiProjectionAdapter.enrichBattle(clientBattle, newRecon);
            return new Inputs(frozen.battle(), frozen.reconstruction(), clientBattle, newRecon);
        } catch (final IOException error) {
            throw new UncheckedIOException(error);
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"random-battle-example", "cw-training-15-14-example", "tournament-14-14-example"})
    void identityClockAndCombatAreIdentical(final String name) {
        final Inputs in = inputs(name);
        assertEquals(in.javaRecon().battleStartRawClockSec(), in.newRecon().battleStartRawClockSec(), 1e-3);
        assertEquals(in.javaRecon().battleDurationSec(), in.newRecon().battleDurationSec(), 1e-6);

        final TeamEntityMapping mj = TeamEntityMapper.resolve(in.javaBattle(), in.javaRecon());
        final TeamEntityMapping mn = TeamEntityMapper.resolve(in.javaBattle(), in.newRecon());
        assertEquals(identities(mj), identities(mn), "entity → account / team mapping");
        assertEquals(mj.limitations(), mn.limitations());

        final var cj = PlaybackCombatReconstruction.derive(in.javaRecon().events(), mj,
                in.javaRecon().battleStartRawClockSec(), in.javaRecon().battleDurationSec(), in.javaBattle());
        final var cn = PlaybackCombatReconstruction.derive(in.newRecon().events(), mn,
                in.newRecon().battleStartRawClockSec(), in.newRecon().battleDurationSec(), in.javaBattle());
        assertEquals(losses(cj), losses(cn), "HP loss / attacker / reliability / evidence count");
        assertEquals(cj.destroyed().size(), cn.destroyed().size());
        for (int i = 0; i < cj.destroyed().size(); i++) {
            final var a = cj.destroyed().get(i);
            final var b = cn.destroyed().get(i);
            assertEquals(a.victimAccountId(), b.victimAccountId());
            assertEquals(a.killerAccountId(), b.killerAccountId(), "killer (fail-closed unique attacker)");
            assertEquals(a.timeSec(), b.timeSec(), 0.01);
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"random-battle-example", "cw-training-15-14-example", "tournament-14-14-example"})
    void battleTimelineFramesAreIdentical(final String name) {
        final Inputs in = inputs(name);
        final int team = in.javaBattle().recorderResult().team;
        final BattleTimeline a = usable(BattleTimelineBuilder.build(in.javaBattle(), in.javaRecon(), TimelinePerspective.team(team)));
        final BattleTimeline b = usable(BattleTimelineBuilder.build(in.javaBattle(), in.newRecon(), TimelinePerspective.team(team)));
        assertEquals(a.frames().size(), b.frames().size());
        assertEquals(a.limitations(), b.limitations());
        int compared = 0;
        for (int s = 0; s < a.frames().size(); s++) {
            final BattleFrame fa = a.frames().get(s);
            final Map<Integer, FrameVehicle> byId = new HashMap<>();
            for (final FrameVehicle v : b.frames().get(s).vehicles()) {
                byId.put(v.entityId(), v);
            }
            assertEquals(fa.vehicles().size(), byId.size(), "frame " + s + " vehicle set");
            for (final FrameVehicle va : fa.vehicles()) {
                final FrameVehicle vb = byId.get(va.entityId());
                assertNotNull(vb, "frame " + s + " entity " + va.entityId());
                final String at = "frame " + s + " entity " + va.entityId();
                assertEquals(va.position().knowledge(), vb.position().knowledge(), at + " position knowledge");
                assertEquals(va.knowledgeState(), vb.knowledgeState(), at + " vehicle knowledge");
                assertEquals(va.orientation().knowledge(), vb.orientation().knowledge(), at + " orientation knowledge");
                assertEquals(va.lifeState(), vb.lifeState(), at + " life");
                assertEquals(va.destroyedKnownAtSec() == null, vb.destroyedKnownAtSec() == null, at + " destroyed");
                assertEquals(va.health().currentHp(), vb.health().currentHp(), at + " hp");
                assertEquals(va.health().knowledge(), vb.health().knowledge(), at + " hp knowledge");
                assertEquals(va.health().displayCapacityHp(), vb.health().displayCapacityHp(), at + " hp capacity");
                assertEquals(va.mapState(), vb.mapState(), at + " map region");
                if (va.position().position() != null) {
                    assertEquals(va.position().position().x(), vb.position().position().x(), 1e-3, at + " x");
                    assertEquals(va.position().position().z(), vb.position().position().z(), 1e-3, at + " z");
                }
                compared++;
            }
        }
        assertTrue(compared > 1000, "compared frame-vehicles: " + compared);

        final var gj = TeamGroundingFacts.build(in.javaBattle(), a, team);
        final var gn = TeamGroundingFacts.build(in.javaBattle(), b, team);
        assertEquals(groundingKeys(gj), groundingKeys(gn), "grounding facts");
    }

    /** 生产路径：客户端结算事实 + 投影 → 团队 / 个人 prompt 与 Java canonical 输入的 prompt 一致（仅 normalizePrompt 三条 + 已冻结的占领中断归零表）。 */
    @ParameterizedTest
    @ValueSource(strings = {"random-battle-example", "cw-training-15-14-example", "tournament-14-14-example"})
    void renderedPromptsMatchJavaCanonical(final String name) {
        final Inputs in = inputs(name);
        final String javaTeam = dropPinnedCaptureDeltas(name, normalizePrompt(teamPrompt(in.javaBattle(), in.javaRecon())),
                PINNED_BASE_CAPTURE_JAVA_ONLY.getOrDefault(name, List.of()));
        final String clientTeam = dropPinnedCaptureDeltas(name, normalizePrompt(teamPrompt(in.clientBattle(), in.newRecon())),
                PINNED_BASE_CAPTURE_CLIENT_ONLY.getOrDefault(name, List.of()));
        assertEquals(List.of(), lineDiff(javaTeam, clientTeam), "team prompt");
        // 个人 prompt 不含 OBJECTIVE_STATE_TIMELINE（基地状态段只由团队 prompt 渲染），
        // 因此不参与该定向表；若将来它开始渲染基地行，未列入冻结表即失败。
        assertEquals(List.of(), lineDiff(normalizePrompt(personalPrompt(in.javaBattle(), in.javaRecon())),
                normalizePrompt(personalPrompt(in.clientBattle(), in.newRecon()))), "personal prompt");
    }

    /**
     * 从已归一化的 prompt 中精确移除 pinned 的差异行（每条消耗一次出现），
     * 并要求每条都**恰好出现 pinned 次数**：少一条（producer 不再发该行）或多一条
     * （新差异）都会失败。移除只发生在逐条列出的文本上——不做任何字段级通配。
     */
    static String dropPinnedCaptureDeltas(final String fixture, final String prompt, final List<String> pinned) {
        if (pinned.isEmpty()) {
            return prompt;
        }
        final List<String> remaining = new ArrayList<>(pinned);
        final List<String> out = new ArrayList<>();
        for (final String line : prompt.split("\n", -1)) {
            final int at = remaining.indexOf(line);
            if (at >= 0) {
                remaining.remove(at);
                continue;
            }
            out.add(line);
        }
        assertEquals(List.of(), remaining, fixture + " 冻结的占领中断归零差异行未按 pinned 次数出现（数量漂移即失败）");
        return String.join("\n", out);
    }

    // ---------- helpers ----------

    /** 逐行差异（Java 侧行前缀 "-"、新链路 "+"，按出现顺序；空 = 全文一致） */
    static List<String> lineDiff(final String java, final String local) {
        final String[] a = java.split("\n");
        final String[] b = local.split("\n");
        final List<String> out = new ArrayList<>();
        for (int i = 0; i < Math.max(a.length, b.length); i++) {
            final String x = i < a.length ? a[i] : null;
            final String y = i < b.length ? b[i] : null;
            if (!Objects.equals(x, y)) {
                out.add("-" + x);
                out.add("+" + y);
            }
        }
        return out;
    }

    static String normalizePrompt(final String prompt) {
        final List<String> out = new ArrayList<>();
        final List<String> run = new ArrayList<>();
        for (final String line : prompt.split("\n")) {
            String l = EVENT_COUNT.matcher(line).replaceAll("位置时间线: 可用（N 个领域事件");
            l = DECODE_RATIO.matcher(l).replaceAll("decodedPacketRatio=*");
            l = BASE_EVENT_TIME.matcher(l).replaceAll("[t] $1");
            if (ORDER_FREE_LINE.matcher(l).find()) {
                run.add(l);
                continue;
            }
            run.sort(String::compareTo);
            out.addAll(run);
            run.clear();
            out.add(l);
        }
        run.sort(String::compareTo);
        out.addAll(run);
        return String.join("\n", out);
    }

    private static String teamPrompt(final Battle battle, final ReplayReconstruction recon) {
        final SingleTeamBattleAnalysisContext ctx = TeamContextBuilder.buildSingleTeamContext(battle, recon);
        final BattleTimeline timeline = usable(BattleTimelineBuilder.build(ctx.battle(), ctx.reconstruction(),
                TimelinePerspective.team(ctx.perspectiveTeam())));
        return TeamAiPromptBuilder.single(ctx, List.of(), null, null, Integer.MAX_VALUE, timeline).content();
    }

    private static String personalPrompt(final Battle battle, final ReplayReconstruction recon) {
        final RecorderEntityMapping recorder = AnalysisUnitAssembler.findRecorder(battle, recon);
        final PlayerBattleFeatureSet features = new DefaultPlayerBattleFeatureExtractor().extract(recon, recorder, battle);
        final EvidenceSkillResult evidence = new EvidenceSkillEngine().run(
                new EvidenceSkillContext(battle, recon, features, recorder));
        final BattleTimeline timeline = usable(BattleTimelineBuilder.build(battle, recon,
                TimelinePerspective.personal(recorder.accountId(), recorder.team())));
        return TacticalReviewPromptBuilder.prepare(null, evidence, battle, recon, timeline, features, recorder,
                new ConservativeDeepSeekTokenEstimator(), 1_000_000, 1_000_000, 32_768, 0).userContent();
    }

    private static BattleTimeline usable(final BattleTimelineResult result) {
        assertTrue(result.usable(), "timeline unusable: " + result.validation().errors());
        return result.timeline();
    }

    private static Map<Integer, String> identities(final TeamEntityMapping mapping) {
        final Map<Integer, String> out = new HashMap<>();
        for (final Map.Entry<Integer, TeamEntityIdentity> e : mapping.entitiesById().entrySet()) {
            out.put(e.getKey(), e.getValue().accountId() + "/" + e.getValue().team());
        }
        return out;
    }

    private static List<String> losses(final PlaybackCombatReconstruction.Result combat) {
        final List<String> out = new ArrayList<>();
        combat.lossesByVictim().forEach((victim, list) -> list.forEach(l -> out.add(victim + "|" + l.fromHp() + "|"
                + l.toHp() + "|" + l.hpLoss() + "|" + l.attackerAccountId() + "|" + l.attackerReliable() + "|"
                + l.damageEventCount() + "|" + Math.round(l.fromSec() * 100) + "|" + Math.round(l.toSec() * 100))));
        out.sort(String::compareTo);
        return out;
    }

    private static List<String> groundingKeys(final TeamGroundingFacts.GroundingFacts facts) {
        return facts.facts().stream()
                .map(f -> f.type() + "|" + f.side() + "|" + f.accountId() + "|" + Math.round(f.startSec()) + "|"
                        + Math.round(f.endSec()) + "|" + Objects.toString(f.attrs()))
                .sorted()
                .toList();
    }
}
