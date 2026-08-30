package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayReconstructionService;
import com.wotb.core.replay.event.ArenaPeriodChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.RoundFinishedEvent;
import com.wotb.core.replay.decoder.ReplayVersionGate;
import com.wotb.core.replay.stream.ReplayPacketStreamReader;
import com.wotb.core.replay.stream.RawReplayPacket;
import com.wotb.core.parse.ParsedReplay;
import com.wotb.core.replay.decoder.ProtobufDecoder;
import java.util.Map;
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
        final Path dir = Path.of(System.getProperty("user.dir"), "..", "..", "common", "data", "34冠军赛回放-无重复")
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
            row.arenaPeriods = arenaPeriodSummary(recon.events());
            row.roundFinishedCount = countRoundFinished(recon.events());
            row.clientVersion = recon.streamHeader() != null
                    ? reconcileVersion(recon.streamHeader().clientVersion())
                    : (recon.metadata() == null ? "?" : reconcileVersion(recon.metadata().clientVersion()));
            row.methodSemanticsAllowed = ReplayVersionGate.methodSemanticsAllowed(row.clientVersion);
            row.method4Signature = method4Signature(bytes);
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

    private static String arenaPeriodSummary(final List<ReplayEvent> events) {
        if (events == null) return "none";
        final StringBuilder sb = new StringBuilder();
        for (final ReplayEvent e : events) {
            if (e instanceof ArenaPeriodChangedEvent ap) {
                if (sb.length() > 0) sb.append('|');
                sb.append(ap.period()).append('@').append(String.format("%.2f", ap.timestamp().rawClockSec()));
                sb.append("(raw=").append(ap.periodRaw()).append(')');
            }
        }
        return sb.length() == 0 ? "NO_ARENA_PERIOD" : sb.toString();
    }

    private static int countRoundFinished(final List<ReplayEvent> events) {
        if (events == null) return 0;
        int n = 0;
        for (final ReplayEvent e : events) {
            if (e instanceof RoundFinishedEvent rf) {
                n++;
            }
        }
        return n;
    }

    private static String reconcileVersion(final String v) {
        // 不同 meta 字段可能叫 gameVersion / clientVersion；此处归一化便于肉眼对比。
        return v == null ? "?" : v;
    }

    /** 原始 method4/subtype48 包签名：type8 subtype4 (round-finished) 的 argLen/envelope/entityId 序列 + subtype48 wrapper3。 */
    private static String method4Signature(final byte[] bytes) {
        final StringBuilder sb = new StringBuilder();
        try {
            final byte[] streamBytes = ParsedReplay.read(bytes).dataWotreplay();
            if (streamBytes == null) return "NO_DATA_WOTREPLAY";
            final ReplayPacketStreamReader.ReplayStreamResult stream = ReplayPacketStreamReader.read(streamBytes);
            int roundSubtype4 = 0;
            for (final RawReplayPacket p : stream.packets()) {
                if (p.type() != 8) continue;
                final byte[] payload = p.payload();
                if (payload.length < 12) continue;
                final int subType = readU32LE(payload, 4);
                final int argLen = readU32LE(payload, 8);
                final int entityId = (int) readU32LE(payload, 0);
                final boolean envelopeValid = payload.length == 12 + argLen;
                if (subType == 4) {
                    roundSubtype4++;
                    if (sb.length() > 0) sb.append('|');
                    sb.append("rf4(eid=").append(entityId).append(",argLen=").append(argLen)
                            .append(",env=").append(envelopeValid)
                            .append(",plen=").append(payload.length).append(')');
                }
                if (subType == 48) {
                    final long wrapper = com.wotb.core.replay.decoder.EntityMethodDecoder.readWrapperFieldNumber(payload);
                    if (wrapper == 3L) {
                        if (sb.length() > 0) sb.append('|');
                        sb.append("arena48(seq=").append(p.sequence()).append(",clock=")
                                .append(String.format("%.2f", p.rawClockSec())).append(",w3,root=")
                                .append(arenaPeriodRoot(payload)).append(')');
                    }
                }
            }
            if (sb.length() == 0) sb.append("NO_ANCHOR_PACKET");
            return sb.toString();
        } catch (final Exception e) {
            return "ERR:" + e.getMessage();
        }
    }

    private static int readU32LE(final byte[] b, final int off) {
        return (b[off] & 0xFF) | ((b[off + 1] & 0xFF) << 8) | ((b[off + 2] & 0xFF) << 16) | ((b[off + 3] & 0xFF) << 24);
    }

    private static String arenaPeriodRoot(final byte[] payload) {
        try {
            final byte[] body = new byte[payload.length - 8];
            System.arraycopy(payload, 8, body, 0, body.length);
            int off = 4;
            if (off >= body.length) return "trunc";
            final long[] v = readVarint(body, off);
            off = (int) v[1];
            if (off >= body.length) return "trunc2";
            final int first = body[off] & 0xFF;
            int msgLen;
            if (first == 0xFF) {
                if (off + 2 > body.length) return "trunc3";
                msgLen = (body[off + 1] & 0xFF) | ((body[off + 2] & 0xFF) << 8);
                off += 4;
            } else {
                msgLen = first; off += 1;
            }
            if (off + msgLen > body.length) return "trunc4";
            final byte[] proto = new byte[msgLen];
            System.arraycopy(body, off, proto, 0, msgLen);
            final Map<Integer, List<Object>> root = ProtobufDecoder.decode(proto);
            final List<Object> f3 = root.get(3);
            if (f3 == null || f3.isEmpty()) {
                return "f3=none|allowed=" + root.keySet();
            }
            final Object val = f3.getFirst();
            if (val instanceof byte[] inner) {
                final Map<Integer, List<Object>> innerRoot = ProtobufDecoder.decode(inner);
                return "f3=nested(" + innerRoot + ")";
            }
            return "f3=" + val + "(class=" + val.getClass().getSimpleName() + ")";
        } catch (final Exception e) {
            return "ERR:" + e.getMessage();
        }
    }

    private static long[] readVarint(final byte[] b, final int off) {
        long result = 0; int shift = 0; int i = off;
        while (i < b.length) {
            final int x = b[i++] & 0xFF;
            result |= (long) (x & 0x7F) << shift;
            if ((x & 0x80) == 0) return new long[]{ result, i };
            shift += 7;
            if (shift > 63) break;
        }
        return new long[]{ result, i };
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
        String arenaPeriods = "";
        int roundFinishedCount;
        String clientVersion = "";
        boolean methodSemanticsAllowed;
        String method4Signature = "";
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
            return String.format("%-4s  ver=%-22s  usable=%-5s  startClock=%-8s  rf=%d  arena=%s  m4=%s  tracks=%s  cap=%s  v2Null=%-5s  %s",
                    sourceId, clientVersion, tlUsable,
                    battleStartRawClockSec == null ? "null" : battleStartRawClockSec,
                    roundFinishedCount, arenaPeriods, method4Signature,
                    tracks == null ? "-" : String.valueOf(tracks),
                    capability == null ? "-" : capability, v2Null, reason);
        }
    }
}
