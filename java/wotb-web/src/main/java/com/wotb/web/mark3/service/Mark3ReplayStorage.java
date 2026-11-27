package com.wotb.web.mark3.service;

import com.wotb.web.replayfile.HallOfFameReplayStorage;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.nio.file.Path;
import java.util.Optional;

@Service
public class Mark3ReplayStorage {

    private final HallOfFameReplayStorage delegate;

    public Mark3ReplayStorage(
            @Value("${wotb.hof.replay-dir:data/replays}") final String replayDir,
            @Value("${wotb.hof.replay-min-free-bytes:536870912}") final long minFreeBytes) {
        final String mark3ReplayDir = Path.of(replayDir).resolve("mark3").toString();
        this.delegate = new HallOfFameReplayStorage(mark3ReplayDir, minFreeBytes);
    }

    public HallOfFameReplayStorage.StoreResult store(final byte[] data, final String sha256) {
        return delegate.store(data, sha256);
    }

    public Optional<Path> load(final String sha256) {
        return delegate.load(sha256);
    }

    public boolean delete(final String sha256) {
        return delegate.delete(sha256);
    }
}
