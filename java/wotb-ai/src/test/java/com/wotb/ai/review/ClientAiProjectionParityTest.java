package com.wotb.ai.review;

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

class ClientAiProjectionParityTest {

    private static final Pattern EVENT_COUNT = Pattern.compile("位置时间线: 可用（\\d+ 个领域事件");
    private static final Pattern DECODE_RATIO = Pattern.compile("decodedPacketRatio=[^,\\]]+");
    private static final Pattern BASE_EVENT_TIME = Pattern.compile("^\\[\\d+分\\d+秒\\] (BASE [A-D] )");
    private static final Map<String, List<String>> PINNED_BASE_CAPTURE_JAVA_ONLY = Map.of(
            "tournament-14-14-example", List.of(
                    "[t] BASE B owner=NONE capturing=ENEMY captureProgress=30",
                    "[t] BASE B owner=NONE capturing=FRIENDLY captureProgress=42"));
    private static final Map<String, List<String>> PINNED_BASE_CAPTURE_CLIENT_ONLY = Map.of(
            "tournament-14-14-example", List.of(
                    "[t] BASE B owner=NONE capturing=NONE captureProgress=UNKNOWN",
                    "[t] BASE B owner=NONE capturing=NONE captureProgress=UNKNOWN"));
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

    @ParameterizedTest
    @ValueSource(strings = {"random-battle-example", "cw-training-15-14-example", "tournament-14-14-example"})
    void renderedPromptsMatchJavaCanonical(final String name) {
        final Inputs in = inputs(name);
        final String javaTeam = dropPinnedCaptureDeltas(name, normalizePrompt(teamPrompt(in.javaBattle(), in.javaRecon())),
                PINNED_BASE_CAPTURE_JAVA_ONLY.getOrDefault(name, List.of()));
        final String clientTeam = dropPinnedCaptureDeltas(name, normalizePrompt(teamPrompt(in.clientBattle(), in.newRecon())),
                PINNED_BASE_CAPTURE_CLIENT_ONLY.getOrDefault(name, List.of()));
        assertEquals(List.of(), lineDiff(javaTeam, clientTeam), "team prompt");
        assertEquals(List.of(), lineDiff(normalizePrompt(personalPrompt(in.javaBattle(), in.javaRecon())),
                normalizePrompt(personalPrompt(in.clientBattle(), in.newRecon()))), "personal prompt");
    }

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
