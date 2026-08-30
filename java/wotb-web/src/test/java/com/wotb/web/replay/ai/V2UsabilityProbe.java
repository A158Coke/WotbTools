package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayReconstructionService;
import com.wotb.core.replay.timeline.BattleTimelineBuilder;
import com.wotb.core.replay.timeline.BattleTimelineResult;
import com.wotb.core.replay.timeline.TimelineError;
import com.wotb.core.replay.timeline.TimelinePerspective;
import com.wotb.web.replay.dto.BattlePlaybackDataset;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

/**
 * 生产 smoke 探针：真实 34 场冠军赛回放沿完整链路逐场定性 V2 为何 null。
 *
 * <p>链路：ReplayParser → ReplayReconstructionService.reconstruct → BattleTimelineBuilder.build
 * → BattlePlaybackProjector.project。逐场输出：sourceId（文件序号）、battleStartRawClockSec、
 * tl.usable()、validation errors、durationSec、recorder 是否 null、projected tracks.size()、
 * limitations、最终 V2 是否 null。纯诊断，不做 V2 断言（读输出定位根因）。</p>
 */
/** 手动诊断探针（非默认 CI 用例：类名不含 Test 后缀，surefire 默认不跑；需要时 -Dtest=V2UsabilityProbe）。 */
class V2UsabilityProbe {

    @Test
    void probe34ChampionshipReplaysV2Usability() throws Exception {
        final Path dir = Path.of(System.getProperty("user.dir"), "..", "..", "common", "data", "34冠军赛回放")
                .normalize();
        final List<Path> files;
        try (Stream<Path> s = Files.walk(dir)) {
            files = s.filter(p -> p.getFileName().toString().toLowerCase().endsWith(".wotbreplay"))
                    .sorted().toList();
        }
        System.out.println("== V2 usability probe: " + dir + " => " + files.size() + " files ==");
        if (files.isEmpty()) {
            System.out.println("NO FILES FOUND");
            return;
        }

        int usable = 0;
        int notUsable = 0;
        int v2Null = 0;
        int v2Ok = 0;
        for (int i = 0; i < files.size(); i++) {
            final Path f = files.get(i);
            final String sourceId = "r" + i;
            final Row row = probe(f, sourceId);
            System.out.println(row.render());
            if (row.usable) usable++;
            else notUsable++;
            if (row.v2Null) v2Null++;
            else v2Ok++;
        }
        System.out.println("== SUMMARY: usable=" + usable + " notUsable=" + notUsable
                + " v2Null=" + v2Null + " v2Ok=" + v2Ok + " ==");
    }

    private static Row probe(final Path file, final String sourceId) {
        final Row row = new Row(sourceId, file.getFileName().toString());
        try {
            final byte[] bytes = Files.readAllBytes(file);
            final Battle battle = ReplayParser.parse(bytes);
            final ReplayReconstruction recon = new ReplayReconstructionService().reconstruct(bytes);
            row.battleStartRawClockSec = recon.battleStartRawClockSec();
            final PlayerResult recorder = battle.recorderResult();
            row.recorderNull = recorder == null;
            row.usable = battle != null && recon != null && recorder != null;
            if (battle == null || recon == null || recorder == null) {
                row.v2Null = true;
                row.reason = recorder == null ? "recorder==null" : "battle/recon==null";
                return row;
            }
            final BattleTimelineResult tl = BattleTimelineBuilder.build(
                    battle, recon, TimelinePerspective.personal(
                            recorder.accountId > 0 ? recorder.accountId : null, recorder.team));
            row.tlUsable = tl.usable();
            row.durationSec = tl.timeline() == null ? null : (double) tl.timeline().durationSec();
            row.limitations = tl.timeline() == null ? List.of() : tl.timeline().limitations();
            row.errors = tl.validation().errors();
            if (!tl.usable()) {
                row.v2Null = true;
                row.reason = "tl unusable: " + tl.validation().errors();
                return row;
            }
            final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);
            final BattlePlaybackDataset ds = BattlePlaybackProjector.project(
                    battle, tl.timeline(), mapping, recorder.accountId > 0 ? recorder.accountId : null);
            row.v2Null = ds == null;
            row.tracks = ds == null ? null : ds.vehicles().size();
            row.capability = ds == null ? null : String.valueOf(ds.capability());
            row.reason = ds == null ? "projector returned null (tracks empty / duration<=0)"
                    : "ok capability=" + ds.capability();
            return row;
        } catch (final Exception e) {
            row.v2Null = true;
            row.reason = "EXCEPTION: " + e.getClass().getSimpleName() + ": " + e.getMessage()
                    + " @ " + firstProjectorFrame(e);
            return row;
        }
    }

    /** 定位异常的 projector 内部帧（便于锁定 NPE 行）。 */
    private static String firstProjectorFrame(final Throwable e) {
        for (final StackTraceElement st : e.getStackTrace()) {
            if (st.getClassName().contains("BattlePlaybackProjector")
                    || st.getClassName().contains("BattlePlaybackDataset")) {
                return st.getClassName() + "#" + st.getMethodName() + ":" + st.getLineNumber();
            }
        }
        return "no-projector-frame"; // 转其它类
    }

    /** 单场探针行。 */
    private static final class Row {
        final String sourceId;
        final String fileName;
        Float battleStartRawClockSec;
        boolean recorderNull;
        boolean usable;
        boolean tlUsable;
        Double durationSec;
        List<String> limitations = new ArrayList<>();
        List<TimelineError> errors = new ArrayList<>();
        Integer tracks;
        String capability;
        boolean v2Null = true;
        String reason = "";

        Row(final String sourceId, final String fileName) {
            this.sourceId = sourceId;
            this.fileName = fileName;
        }

        String render() {
            return String.format("%-4s  usable=%-5s  startClock=%-8s  dur=%s  recorderNull=%-5s  tracks=%s  cap=%s  lim=%s  v2Null=%-5s  %s",
                    sourceId, tlUsable,
                    battleStartRawClockSec == null ? "null" : battleStartRawClockSec,
                    durationSec == null ? "-" : String.format("%.1f", durationSec),
                    recorderNull,
                    tracks == null ? "-" : String.valueOf(tracks),
                    capability == null ? "-" : capability,
                    limitations.isEmpty() ? "-" : limitations,
                    v2Null, reason);
        }
    }
}
