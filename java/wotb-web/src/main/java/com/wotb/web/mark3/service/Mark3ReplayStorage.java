package com.wotb.web.mark3.service;

import com.wotb.web.hof.storage.HallOfFameReplayStorage;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.nio.file.Path;
import java.util.Optional;

/**
 * 三环回放的内容寻址存储命名空间。
 *
 * <p>复用名人堂已有的原子写入、磁盘 reserve 与路径防穿越实现，但固定放在
 * {@code ${wotb.hof.replay-dir}/mark3}。这样继续使用同一已挂载 volume/配置，同时与单场 HoF
 * 和百场的 hash 引用计数隔离，任一领域终态清理都不会删除另一领域仍在引用的文件。</p>
 */
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
