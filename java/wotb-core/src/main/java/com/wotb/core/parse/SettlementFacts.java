package com.wotb.core.parse;

import java.util.List;
import java.util.Map;

/**
 * battle_results.dat 的 <b>canonical settlement facts</b> —— 同一层协议的 <b>唯一 production decoding
 * authority</b>。
 * <p>
 * 结构为 {@code pickle( (arenaId, protobufBytes) )}；protobuf 根消息按字段号解码为
 * {@code Map<Integer, List<Object>>}，其中 {@code #301} 为逐玩家结算消息、{@code #201} 为名册消息。
 * </p>
 *
 * <p><b>设计意图</b>：{@link ReplayParser} 与
 * {@code com.wotb.core.replay.reconstruction.ReplayReconstructionService} 都经 {@link #decode(byte[])}
 * 消费 battle_results.dat，二者不再各自 {@code PickleReader.loads + Protobuf.decode}。顶层结算是唯一
 * 解码权威；逐玩家结算事实（lifeTime / killer / deathReason / resultId 映射）由 {@link ReplayParser}
 * 从 {@link #root()} 一次性解释，流入 {@code Battle/PlayerResult} 供 reconstruction 通过 context 复用。
 * </p>
 *
 * @param arenaId                  pickle tuple 第 0 项（arena 唯一 id，原始类型）
 * @param battleStartTimestampSec  root2：战斗 Unix 时间戳（秒/毫秒原始值）；缺失 → null
 * @param finishReasonRaw          root4：战斗结束原因原始值；缺失 → null
 * @param settlementDurationSec    root5：结算战斗时长（秒）；缺失 → null
 * @param root                     已解码的 protobuf 根消息（唯一解码输出）
 */
public record SettlementFacts(
        Object arenaId,
        Long battleStartTimestampSec,
        Integer finishReasonRaw,
        Double settlementDurationSec,
        Map<Integer, List<Object>> root
) {

    /** 当前 canonical 已验证家族（PR147 11.19 corpus authority）。 */
    public static final String CURRENT_VERIFIED_FAMILY = "11.19.0_china";
    /** 明确 legacy 验证的家族（repository fixtures/research 独立证明其 settlement 数值语义）。 */
    public static final String LEGACY_VERIFIED_FAMILY = "11.18.0_china";

    /**
     * PR162/P1-2：settlement schema 是否已验证的唯一权威（单一版本家族定义，供 {@link ReplayParser}
     * 与 {@code com.wotb.core.replay.decoder.ReplayProtocolProfile} 共享，避免 parse-local copy）。
     * 只有当前 canonical 家族 + 有独立 evidence 的 legacy 家族为真；未知/未来版本 fail-closed。
     */
    public static boolean isAffirmedFamily(final String clientVersion) {
        final String v = clientVersion == null ? "" : clientVersion.trim().toLowerCase(java.util.Locale.ROOT);
        return v.startsWith(CURRENT_VERIFIED_FAMILY) || v.startsWith(LEGACY_VERIFIED_FAMILY);
    }

    /**
     * 从 battle_results.dat 字节数组解码结算事实。<b>这是该协议层的唯一 production 解码入口。</b>
     * tuple 结构非法 → {@link IllegalArgumentException}；protobuf 非法由 {@link Protobuf#decode}
     * 在其内部抛出（同样为 {@link IllegalArgumentException}）。
     *
     * @param dat battle_results.dat 的完整字节内容
     * @return 解码后的 settlement facts
     */
    public static SettlementFacts decode(final byte[] dat) {
        final Object pickle = PickleReader.loads(dat);
        if (!(pickle instanceof Object[] tuple) || tuple.length != 2
                || !(tuple[1] instanceof byte[] pb)) {
            throw new IllegalArgumentException(
                    "Invalid battle_results.dat: expected (arenaId, protobufBytes)");
        }
        final Object arenaId = tuple[0];
        final Map<Integer, List<Object>> root = Protobuf.decode(pb);
        final Object start = Protobuf.first(root, 2);
        final Object finish = Protobuf.first(root, 4);
        final Object dur = Protobuf.first(root, 5);
        return new SettlementFacts(
                arenaId,
                start instanceof Number n ? n.longValue() : null,
                finish instanceof Number n ? n.intValue() : null,
                dur instanceof Number n ? n.doubleValue() : null,
                root
        );
    }
}
