package com.wotb.core.replay.projection;

import java.util.List;

/**
 * WotbTools client canonical AI projection（wire：{@code contracts/http/openapi.yaml#ClientAiReviewProjection}，
 * 生产者：{@code frontend/src/replay-local/ai}）。
 *
 * <p>服务器没有 replay parser：客户端用锁定版本的上游 Agent WASM 解析回放，经 WotbTools canonical replay facts
 * 投影成本结构；服务端只做结构校验，再由 {@link ClientAiProjectionAdapter} 装配成内存中的 canonical 事件流。
 * 所有时钟为原始回放时钟（秒）。只含参战实体。</p>
 *
 * <p>读取边界容错（.agents/AGENTS.md §5a「旧 artifact 兼容只放读取边界」）：客户端投影的
 * **additive 新字段**（如 `hpState`）在较旧的客户端/服务组合上只应被忽略，不得让整个请求 400——
 * 策略落点 = `ReplayFactsCodec.PROJECTION_MAPPER`（覆盖嵌套 record）；已知字段仍逐项显式校验
 * （`ClientAiProjectionAdapter` 的 require 与显式 enum 映射）。</p>
 */
public record ClientAiProjection(
        Engine engine,
        Clock clock,
        Perspective perspective,
        List<Participant> participants,
        List<ObservationWindow> observationWindows,
        List<SampleTrack> positions,
        List<SampleTrack> turrets,
        List<Prop3Health> prop3Health,
        List<HealthEvent> healthEvents,
        List<DamageNotice> damageNotices,
        List<Period> periods,
        Objectives objectives,
        List<String> limitations,
        List<String> unavailableEvidence
) {
    public record Engine(String agentRelease, String agentCommit) {
    }

    public record Clock(double battleStartRawClockSec, double battleDurationSec, boolean estimated,
                        Double battleEndRawClockSec, Double streamEndRawClockSec) {
    }

    public record Perspective(Long recorderAccountId, Integer perspectiveTeam,
                              List<Integer> recorderEntityIds, Integer winnerTeam) {
    }

    public record Participant(int entityId, long accountId, String nickname, int team, int tankId,
                              boolean recorder) {
    }

    /** AoI 观测段 [from, to)；to = null = 战斗结束仍在观测。materializationHp = 开段物化快照的可信血量。 */
    public record ObservationWindow(int entityId, double fromRawClockSec, Double toRawClockSec,
                                    Integer materializationHp) {
    }

    /** 原始观测，列式 flat：positions stride 5 = [t, x, y, z, hullYawRad]；turrets stride 2 = [t, relYawDeg]。 */
    public record SampleTrack(int entityId, int stride, double[] samples) {
    }

    /** hpState = canonical 权威分类（HpRawState 名；缺省 = 旧载荷，服务端按 hpRaw 现算）。 */
    public record Prop3Health(int entityId, double rawClockSec, int hpRaw, String hpState) {
    }

    /** hpState 同 Prop3Health：canonical 权威分类；缺省 = 旧载荷（按 hpRaw 现算）。 */
    public record HealthEvent(int entityId, double rawClockSec, int hpRaw, int sourceEntityId, int causeFlag, String hpState) {
    }

    public enum DamageNoticeKind { HIT, UNDECODED_VARIANT, SHORT_VARIANT }

    public record DamageNotice(double rawClockSec, DamageNoticeKind kind, int envelopeEntityId,
                               int attackerEntityId, int victimEntityId,
                               Integer primaryResult, Integer secondaryResult) {
    }

    public record Period(double rawClockSec, int period) {
    }

    public record Objectives(List<PointsSample> supremacyPoints, List<SupremacyBase> supremacyBases,
                             boolean assaultObjectivePresent, List<AssaultBase> assaultBases) {
    }

    public record PointsSample(double rawClockSec, int team, int points) {
    }

    public record SupremacyBase(double rawClockSec, String baseId, Integer ownerTeam, Integer capturingTeam,
                                Integer captureProgress) {
    }

    public record AssaultBase(double rawClockSec, int captureProgress) {
    }
}
