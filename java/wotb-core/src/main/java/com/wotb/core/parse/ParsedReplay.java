package com.wotb.core.parse;

import java.io.IOException;
import java.util.Map;

/**
 * 单个 .wotbreplay 的 <b>canonical parse context</b> —— 归档解压、clientVersion、以及
 * {@code battle_results.dat} 的 <b>一次解码</b> 结果在此一次完成，供 {@link ReplayParser}
 * 与 {@code com.wotb.core.replay.reconstruction.ReplayReconstructionService} 共享消费。
 *
 * <p>PR162/P0-2「协议只解析一次」：raw archive 在这里只解压一次、settlement 只
 * {@link SettlementFacts#decode} 一次；消费者不再各自 unzip / PickleReader.loads + Protobuf.decode。
 * 缺失/损坏的 settlement 这里不抛（fail-closed 记录在 {@link #settlementError()}），由
 * {@link ReplayParser}（要求结算，缺失即抛）与 reconstruction（容忍缺失）各自裁决。
 * </p>
 *
 * @param entries        解压后的归档条目（entry 名 → 字节）
 * @param clientVersion  data.wotreplay 头部的权威客户端版本（缺失/非法 → ""）
 * @param settlementFacts battle_results.dat 的解码事实；缺失/损坏 → null
 * @param settlementError settlement 缺失/损坏的原因（settlementFacts != null 时为 null）
 * @param streamHeader     data.wotreplay 的 <b>一次解析</b> 头部（consumers 复用，不再二次 parse）；缺失/非法 → null
 */
public record ParsedReplay(
        Map<String, byte[]> entries,
        String clientVersion,
        SettlementFacts settlementFacts,
        String settlementError,
        ReplayStreamHeader streamHeader
) {

    /**
     * 从 .wotbreplay 字节一次性读取归档 + 头部版本 + settlement facts。
     * 归档/zip 结构非法抛 {@link IOException}；settlement 缺失/损坏不抛，记录在
     * {@link #settlementError()}。
     */
    public static ParsedReplay read(final byte[] replayBytes) throws IOException {
        final Map<String, byte[]> entries = ReplayArchiveReader.read(replayBytes);
        // PR162/P1-2：header 只在此解析一次；ReplayPacketStreamReader 消费同一 header，不再二次 parse。
        ReplayStreamHeader streamHeader = null;
        final byte[] eventData = entries.get("data.wotreplay");
        if (eventData != null) {
            try {
                streamHeader = ReplayStreamHeader.parse(eventData);
            } catch (final RuntimeException e) {
                streamHeader = null;
            }
        }
        final String clientVersion = streamHeader != null ? streamHeader.clientVersion() : "";
        SettlementFacts facts = null;
        String error = null;
        final byte[] dat = entries.get("battle_results.dat");
        if (dat == null) {
            error = "Replay is missing battle_results.dat";
        } else {
            try {
                facts = SettlementFacts.decode(dat);
            } catch (final RuntimeException e) {
                error = e.getMessage();
            }
        }
        return new ParsedReplay(entries, clientVersion, facts, error, streamHeader);
    }

    /** data.wotreplay 原始字节；缺失 → null。 */
    public byte[] dataWotreplay() {
        return entries.get("data.wotreplay");
    }

    /** battle_results.dat 原始字节；缺失 → null。 */
    public byte[] battleResultsDat() {
        return entries.get("battle_results.dat");
    }
}
