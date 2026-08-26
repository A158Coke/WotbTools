package com.wotb.web.replayfile;

import com.wotb.web.replayfile.HallOfFameStorageException;
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

/**
 * SHA-256 内容寻址的回放文件存储（baseDir/{sha256}.wotbreplay）。
 *
 * <p>一致性设计：文件不可变、同 hash 可安全复用 → {@link #store} 幂等
 * （目标已存在直接返回 created=false，绝不覆盖）；并发同 hash 上传通过
 * {@code ATOMIC_MOVE} + {@link FileAlreadyExistsException} 处理，无 race、无半文件。
 * DB 更新失败时<b>不删除</b>已入存储的文件——保留为安全 orphan（单文件 ≤20MiB，且受
 * 磁盘 reserve 保护），由未来 maintenance job 按「DB 无引用 + age grace」清理。</p>
 *
 * <p>原子发布契约：临时文件写 {@code baseDir/.tmp/}（与 final 同 filesystem），随后以
 * {@link StandardCopyOption#ATOMIC_MOVE} 原子移入 final path——任何观察到的 final 文件
 * 都是完整文件，绝不暴露半写状态。Java 规范中 {@code ATOMIC_MOVE} 对「target 已存在」
 * 的行为是 provider-specific（可能抛 {@link FileAlreadyExistsException} 或替换）；因 target
 * 名是 SHA-256（同 hash = 同内容，cryptographic invariant），替换只可能以相同内容进行，
 * 逻辑上无害。文件系统不支持 ATOMIC_MOVE 时明确失败（{@code AtomicMoveNotSupportedException}
 * → REPLAY_STORAGE_ERROR 500），<b>不 fallback</b> 到无原子保证的普通 move。</p>
 *
 * <p>磁盘保护：reserve 判断计入本次写入大小（usable - data.length &lt; minFreeBytes
 * → REPLAY_STORAGE_FULL 507，减法比较防溢出）。</p>
 */
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

    /** 存储结果：created=false 表示目标已存在（幂等复用，未写新文件）。 */
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
            // 减法比较避免 minFreeBytes + data.length 溢出；等价 usable < minFreeBytes + incoming
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
                // 并发同 hash 竞态：胜者已原子发布，复用并清理自身临时文件。
                Files.deleteIfExists(tmp);
                return new StoreResult(false, target);
            } catch (final AtomicMoveNotSupportedException e) {
                Files.deleteIfExists(tmp);
                throw new HallOfFameStorageException(
                        "REPLAY_STORAGE_ERROR", HttpStatus.INTERNAL_SERVER_ERROR,
                        "Atomic move is not supported for replay storage", e);
            } catch (final IOException e) {
                // 部分平台并发竞态表现为普通 IOException（如 Windows AccessDeniedException）：
                // 目标已被其他请求原子发布时视为复用，绝不覆盖已有文件。
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

    /**
     * 原子发布（package-private 便于测试注入 {@link AtomicMoveNotSupportedException}）：
     * 同一 filesystem 上的 ATOMIC_MOVE；不支持时抛 {@link AtomicMoveNotSupportedException}。
     */
    void moveAtomically(final Path tmp, final Path target) throws IOException {
        Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE);
    }

    /** 按 hash 定位文件；不存在返回 empty。路径由服务端 hash 拼成并校验仍位于 baseDir。 */
    public Optional<Path> load(final String sha256) {
        final Path target = resolveTarget(sha256);
        if (!Files.exists(target)) {
            return Optional.empty();
        }
        return Optional.of(target);
    }

    /** Best-effort 删除（admin delete 最后引用清理；失败抛异常由调用方 WARN 处理，保留 orphan）。 */
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
