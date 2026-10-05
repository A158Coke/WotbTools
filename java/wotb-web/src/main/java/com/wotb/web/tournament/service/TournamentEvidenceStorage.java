package com.wotb.web.tournament.service;

import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** Image-only namespace, isolated from replay-specific file formats and retention. */
@Service
public class TournamentEvidenceStorage {
    private final Path root;
    private final long reserve;
    public TournamentEvidenceStorage(@Value("${wotb.tournament.evidence-dir:data/replays/tournament}") final String path,
                                     @Value("${wotb.tournament.min-free-bytes:536870912}") final long reserve) {
        this.root = Path.of(path).toAbsolutePath().normalize();
        this.reserve = reserve;
    }
    public record Image(byte[] bytes, String imageHash, String contentType) { }
    public Image validate(final MultipartFile file) {
        if (file == null || file.isEmpty() || file.getSize() > 10L * 1024 * 1024) {
            throw new ApiException(ApiErrorCode.TOURNAMENT_EVIDENCE_INVALID);
        }
        try {
            final byte[] bytes;
            try (final InputStream input = file.getInputStream()) { bytes = input.readNBytes(10 * 1024 * 1024 + 1); }
            if (bytes.length > 10 * 1024 * 1024) {
                throw new ApiException(ApiErrorCode.TOURNAMENT_EVIDENCE_INVALID);
            }
            try (final ImageInputStream stream = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
                if (stream == null) { throw new ApiException(ApiErrorCode.TOURNAMENT_EVIDENCE_INVALID); }
                final Iterator<ImageReader> readers = ImageIO.getImageReaders(stream);
                if (!readers.hasNext()) { throw new ApiException(ApiErrorCode.TOURNAMENT_EVIDENCE_INVALID); }
                final ImageReader reader = readers.next();
                try {
                    reader.setInput(stream, true, true);
                    final String format = reader.getFormatName().toLowerCase(java.util.Locale.ROOT);
                    final int width = reader.getWidth(0);
                    final int height = reader.getHeight(0);
                    if (!(format.equals("png") || format.equals("jpeg")) || width < 16 || height < 16
                            || width > 8192 || height > 8192 || (long) width * height > 20_000_000) {
                        throw new ApiException(ApiErrorCode.TOURNAMENT_EVIDENCE_INVALID);
                    }
                    // Decode validates that a plausible header does not hide truncated/corrupt image data.
                    if (reader.read(0) == null) { throw new ApiException(ApiErrorCode.TOURNAMENT_EVIDENCE_INVALID); }
                    final String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
                    return new Image(bytes, hash, format.equals("png") ? "image/png" : "image/jpeg");
                } finally { reader.dispose(); }
            }
        } catch (final IOException e) {
            throw new ApiException(ApiErrorCode.TOURNAMENT_EVIDENCE_INVALID);
        } catch (final NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    public void store(final long eventId, final Image image) {
        final Path dir = directory(eventId);
        final Path target = dir.resolve(image.imageHash() + ".image");
        Path temporary = null;
        try {
            Files.createDirectories(dir);
            if (Files.isRegularFile(target)) { return; }
            if (Files.getFileStore(dir).getUsableSpace() - image.bytes().length < reserve) {
                throw new ApiException(ApiErrorCode.TOURNAMENT_STORAGE_FULL);
            }
            temporary = dir.resolve("." + UUID.randomUUID() + ".tmp");
            Files.write(temporary, image.bytes());
            Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE);
        } catch (final IOException e) { throw new ApiException(ApiErrorCode.TOURNAMENT_STORAGE_ERROR); }
        finally {
            if (temporary != null) {
                try { Files.deleteIfExists(temporary); } catch (final IOException ignored) { /* 24h orphan cleanup */ }
            }
        }
    }
    public byte[] load(final long eventId, final String hash) {
        if (hash == null || !hash.matches("[a-f0-9]{64}")) { throw new ApiException(ApiErrorCode.TOURNAMENT_EVIDENCE_INVALID); }
        try {
            final Path target = directory(eventId).resolve(hash + ".image");
            if (!Files.isRegularFile(target)) { throw new ApiException(ApiErrorCode.RESOURCE_NOT_FOUND); }
            return Files.readAllBytes(target);
        } catch (final IOException e) { throw new ApiException(ApiErrorCode.TOURNAMENT_STORAGE_ERROR); }
    }
    public void cleanup(final long eventId, final Set<String> referencedHashes, final Instant cutoff) {
        final Path dir = directory(eventId);
        if (!Files.isDirectory(dir)) { return; }
        try (final var files = Files.list(dir)) {
            for (final Path path : files.toList()) {
                final String name = path.getFileName().toString();
                final String hash = name.endsWith(".image") ? name.substring(0, name.length() - 6) : null;
                if ((hash == null || !referencedHashes.contains(hash))
                        && Files.getLastModifiedTime(path).toInstant().isBefore(cutoff)) {
                    Files.deleteIfExists(path);
                }
            }
        } catch (final IOException e) { throw new ApiException(ApiErrorCode.TOURNAMENT_STORAGE_ERROR); }
    }
    public void deleteEvent(final long eventId) {
        final Path dir = directory(eventId);
        if (!Files.isDirectory(dir)) { return; }
        try (final var paths = Files.walk(dir)) {
            for (final Path path : paths.sorted(Comparator.reverseOrder()).toList()) { Files.deleteIfExists(path); }
        } catch (final IOException e) { throw new ApiException(ApiErrorCode.TOURNAMENT_STORAGE_ERROR); }
    }
    public List<Long> eventDirectories() {
        if (!Files.isDirectory(root)) { return List.of(); }
        try (final var paths = Files.list(root)) {
            return paths.filter(Files::isDirectory).map(path -> path.getFileName().toString())
                    .filter(name -> name.matches("[1-9][0-9]{0,17}"))
                    .map(Long::valueOf).toList();
        } catch (final IOException e) { throw new ApiException(ApiErrorCode.TOURNAMENT_STORAGE_ERROR); }
    }
    public void deleteOldOrphanEvent(final long eventId, final Instant cutoff) {
        final Path dir = directory(eventId);
        if (!Files.isDirectory(dir)) { return; }
        try (final var paths = Files.walk(dir)) {
            for (final Path path : paths.toList()) {
                if (!Files.getLastModifiedTime(path).toInstant().isBefore(cutoff)) { return; }
            }
        } catch (final IOException e) { throw new ApiException(ApiErrorCode.TOURNAMENT_STORAGE_ERROR); }
        deleteEvent(eventId);
    }
    private Path directory(final long eventId) {
        if (eventId <= 0) { throw new ApiException(ApiErrorCode.INVALID_ARGUMENT); }
        final Path path = root.resolve(Long.toString(eventId)).normalize();
        if (!path.startsWith(root)) { throw new IllegalStateException("Tournament evidence path escaped root"); }
        return path;
    }
}
