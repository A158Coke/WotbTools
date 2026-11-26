package com.wotb.web.replayfile;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Optional;
import java.util.UUID;

@Service
public class HallOfFameReplayStorage {

    private final Path baseDir;
    private final long minFreeBytes;

    public HallOfFameReplayStorage(
            @Value("${wotb.hof.replay-dir:data/replays}") final String replayDir,
            @Value("${wotb.hof.replay-min-free-bytes:536870912}") final long minFreeBytes) {
        this.baseDir = Path.of(replayDir).toAbsolutePath().normalize();
        this.minFreeBytes = minFreeBytes;
    }

    public record StoreResult(boolean created, Path path) {
    }

    /**
     * 幂等写入一个 content-addressed 回放文件。
     *
     * @param data   原始回放字节
     * @param sha256 十六进制 SHA-256（文件名组成部分，服务端生成，不接收用户路径）
     */
    public StoreResult store(final byte[] data, final String sha256) {
        final Path target = resolveTarget(sha256);
        try {
            Files.createDirectories(baseDir);
            Files.createDirectories(tmpDir());
            if (Files.exists(target)) {
                return new StoreResult(false, target);
            }
            final long usable = Files.getFileStore(baseDir).getUsableSpace();
            if (usable - data.length < minFreeBytes) {
                throw new HallOfFameStorageException(
                        "REPLAY_STORAGE_FULL", HttpStatus.INSUFFICIENT_STORAGE,
                        "Not enough free space to store replay: usable=" + usable
                                + ", required=" + (minFreeBytes + data.length));
            }
            final Path tmp = tmpDir().resolve("." + sha256 + "." + UUID.randomUUID() + ".tmp");
            Files.write(tmp, data);
            try {
                moveAtomically(tmp, target);
                return new StoreResult(true, target);
            } catch (final FileAlreadyExistsException e) {
                Files.deleteIfExists(tmp);
                return new StoreResult(false, target);
            } catch (final AtomicMoveNotSupportedException e) {
                Files.deleteIfExists(tmp);
                throw new HallOfFameStorageException(
                        "REPLAY_STORAGE_ERROR", HttpStatus.INTERNAL_SERVER_ERROR,
                        "Atomic move is not supported for replay storage", e);
            } catch (final IOException e) {
                Files.deleteIfExists(tmp);
                if (Files.exists(target)) {
                    return new StoreResult(false, target);
                }
                throw new HallOfFameStorageException(
                        "REPLAY_STORAGE_ERROR", HttpStatus.INTERNAL_SERVER_ERROR,
                        "Failed to move replay file into place", e);
            }
        } catch (final IOException e) {
            throw new HallOfFameStorageException(
                    "REPLAY_STORAGE_ERROR", HttpStatus.INTERNAL_SERVER_ERROR,
                    "Failed to store replay file", e);
        }
    }

    void moveAtomically(final Path tmp, final Path target) throws IOException {
        Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE);
    }

    public Optional<Path> load(final String sha256) {
        final Path target = resolveTarget(sha256);
        if (!Files.exists(target)) {
            return Optional.empty();
        }
        return Optional.of(target);
    }

    public boolean delete(final String sha256) {
        try {
            return Files.deleteIfExists(resolveTarget(sha256));
        } catch (final IOException e) {
            throw new HallOfFameStorageException(
                    "REPLAY_STORAGE_ERROR", HttpStatus.INTERNAL_SERVER_ERROR,
                    "Failed to delete replay file: " + sha256, e);
        }
    }

    private Path tmpDir() {
        return baseDir.resolve(".tmp");
    }

    private Path resolveTarget(final String sha256) {
        final Path target = baseDir.resolve(sha256 + ".wotbreplay").normalize();
        if (!target.startsWith(baseDir)) {
            throw new HallOfFameStorageException(
                    "REPLAY_STORAGE_ERROR", HttpStatus.INTERNAL_SERVER_ERROR,
                    "Replay storage path escaped base directory");
        }
        return target;
    }
}
