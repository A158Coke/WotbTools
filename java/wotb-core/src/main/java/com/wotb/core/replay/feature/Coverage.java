package com.wotb.core.replay.feature;

import com.wotb.core.replay.reconstruction.ReplayCoverage;

/** 覆盖率摘要。 */
public record Coverage(
        int totalPackets,
        double decodedRatio
) {
    public static Coverage from(ReplayCoverage c) {
        return new Coverage(c.totalPackets(), c.decodedPacketRatio());
    }
}
