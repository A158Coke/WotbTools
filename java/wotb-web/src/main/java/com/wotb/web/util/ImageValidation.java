package com.wotb.web.util;

import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Iterator;
import java.util.Locale;

/** Byte-based validation shared by evidence and broadcast covers; no storage or API policy. */
public final class ImageValidation {
    public static final int MAX_BYTES = 10 * 1024 * 1024;

    private ImageValidation() { }

    public record Image(byte[] bytes, String hash, String contentType) { }

    public static Image read(final InputStream input) throws IOException {
        return validate(input.readNBytes(MAX_BYTES + 1));
    }

    public static Image validate(final byte[] bytes) throws IOException {
        if (bytes == null || bytes.length == 0 || bytes.length > MAX_BYTES) {
            throw new IllegalArgumentException("Invalid image size");
        }
        try (final ImageInputStream stream = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            if (stream == null) { throw new IllegalArgumentException("Invalid image stream"); }
            final Iterator<ImageReader> readers = ImageIO.getImageReaders(stream);
            if (!readers.hasNext()) { throw new IllegalArgumentException("Unsupported image"); }
            final ImageReader reader = readers.next();
            try {
                reader.setInput(stream, true, true);
                final String format = reader.getFormatName().toLowerCase(Locale.ROOT);
                final int width = reader.getWidth(0);
                final int height = reader.getHeight(0);
                if (!(format.equals("png") || format.equals("jpeg")) || width < 16 || height < 16
                        || width > 8192 || height > 8192 || (long) width * height > 20_000_000) {
                    throw new IllegalArgumentException("Invalid image dimensions or format");
                }
                // A plausible header is insufficient: decode the image to reject truncated data.
                if (reader.read(0) == null) { throw new IllegalArgumentException("Invalid image data"); }
                final String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
                return new Image(bytes, hash, format.equals("png") ? "image/png" : "image/jpeg");
            } catch (final NoSuchAlgorithmException e) {
                throw new IllegalStateException(e);
            } finally { reader.dispose(); }
        }
    }
}
