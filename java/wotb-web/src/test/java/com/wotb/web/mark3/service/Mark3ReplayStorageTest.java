package com.wotb.web.mark3.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

/** 防回归：三环证据不与 hundred / 单场 HoF 共享同一物理 hash 路径。 */
class Mark3ReplayStorageTest {

    @TempDir
    Path replayRoot;

    @Test
    void storesInsideDedicatedMark3Subdirectory() {
        final String hash = "a".repeat(64);
        final Mark3ReplayStorage storage = new Mark3ReplayStorage(replayRoot.toString(), 0L);

        storage.store(new byte[]{1, 2, 3}, hash);

        assertThat(Files.exists(replayRoot.resolve("mark3").resolve(hash + ".wotbreplay"))).isTrue();
        assertThat(Files.exists(replayRoot.resolve(hash + ".wotbreplay"))).isFalse();
    }
}
