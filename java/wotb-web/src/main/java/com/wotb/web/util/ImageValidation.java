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
        return validate(bytes, false);
    }

    /** News preserves GIF animations and small inline illustrations; evidence rules stay unchanged. */
    public static Image validateNews(final byte[] bytes) throws IOException {
        return validate(bytes, true);
    }

    private static Image validate(final byte[] bytes, final boolean news) throws IOException {
        if (bytes == null || bytes.length == 0 || bytes.length > MAX_BYTES) {
            throw new IllegalArgumentException("Invalid image size");
        }
        try (final ImageInputStream stream = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            if (stream == null) { throw new IllegalArgumentException("Invalid image stream"); }
            final Iterator<ImageReader> readers = ImageIO.getImageReaders(stream);
            if (!readers.hasNext()) { throw new IllegalArgumentException("Unsupported image"); }
            final ImageReader reader = readers.next();
            try {
                reader.setInput(stream, !news, true);
                final String format = reader.getFormatName().toLowerCase(Locale.ROOT);
                final int width = reader.getWidth(0);
                final int height = reader.getHeight(0);
                if (!(format.equals("png") || format.equals("jpeg") || (news && format.equals("gif")))
                        || width < (news ? 1 : 16) || height < (news ? 1 : 16)
                        || width > 8192 || height > 8192 || (long) width * height > 20_000_000) {
                    throw new IllegalArgumentException("Invalid image dimensions or format");
                }
                // A plausible header is insufficient: decode the image to reject truncated data.
                if (reader.read(0) == null) { throw new IllegalArgumentException("Invalid image data"); }
                if (format.equals("gif")) {
                    final var metadata = reader.getStreamMetadata().getAsTree("javax_imageio_gif_stream_1.0");
                    for (var node = metadata.getFirstChild(); node != null; node = node.getNextSibling()) {
                        if ("LogicalScreenDescriptor".equals(node.getNodeName())) {
                            final int canvasWidth = Integer.parseInt(node.getAttributes().getNamedItem("logicalScreenWidth").getNodeValue());
                            final int canvasHeight = Integer.parseInt(node.getAttributes().getNamedItem("logicalScreenHeight").getNodeValue());
                            if (canvasWidth < 1 || canvasHeight < 1 || canvasWidth > 8192 || canvasHeight > 8192
                                    || (long) canvasWidth * canvasHeight > 20_000_000) {
                                throw new IllegalArgumentException("Invalid animation canvas");
                            }
                        }
                    }
                    final int frames = reader.getNumImages(true);
                    if (frames < 1 || frames > 100) { throw new IllegalArgumentException("Invalid animation size"); }
                    long pixels = (long) width * height;
                    for (int frame = 1; frame < frames; frame++) {
                        final int frameWidth = reader.getWidth(frame);
                        final int frameHeight = reader.getHeight(frame);
                        pixels += (long) frameWidth * frameHeight;
                        if (pixels > 40_000_000 || frameWidth > 8192 || frameHeight > 8192
                                || reader.read(frame) == null) { throw new IllegalArgumentException("Invalid animation data"); }
                    }
                }
                final String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
                return new Image(bytes, hash, "image/" + format);
            } catch (final NoSuchAlgorithmException e) {
                throw new IllegalStateException(e);
            } finally { reader.dispose(); }
        }
    }
}
