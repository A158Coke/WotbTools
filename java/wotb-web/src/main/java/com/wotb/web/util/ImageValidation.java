package com.wotb.web.util;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageReadParam;
import javax.imageio.ImageReader;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.ImageOutputStream;
import javax.imageio.stream.MemoryCacheImageOutputStream;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.AffineTransform;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Iterator;
import java.util.Locale;

/** Byte-based validation and bounded thumbnails; no storage or API policy. */
public final class ImageValidation {
    public static final int MAX_BYTES = 10 * 1024 * 1024;

    private ImageValidation() { }

    public record Image(byte[] bytes, String hash, String contentType) { }

    public static Image read(final InputStream input) throws IOException {
        return validate(input.readNBytes(MAX_BYTES + 1));
    }

    /** Original evidence/cover path retains complete decoding and the original bytes. */
    public static Image validate(final byte[] bytes) throws IOException {
        requireBytes(bytes);
        try (final ImageInputStream stream = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            final ImageReader reader = reader(stream);
            try {
                reader.setInput(stream, true, true);
                final String format = requireDimensions(reader);
                if (reader.read(0) == null) { throw new IllegalArgumentException("Invalid image data"); }
                return new Image(bytes, sha256(bytes), format.equals("png") ? "image/png" : "image/jpeg");
            } finally { reader.dispose(); }
        }
    }

    /** Decode at most about twice the requested edge before resizing; discard source metadata. */
    public static Image thumbnail(final InputStream input, final int maxEdge, final int maxOutputBytes) throws IOException {
        if (maxEdge < 1 || maxEdge > 8192 || maxOutputBytes < 1 || maxOutputBytes > MAX_BYTES) {
            throw new IllegalArgumentException("Invalid thumbnail bounds");
        }
        final byte[] bytes = input.readNBytes(MAX_BYTES + 1);
        requireBytes(bytes);
        final BufferedImage decoded;
        final int orientation;
        final int sourceWidth;
        final int sourceHeight;
        try (final ImageInputStream stream = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            final ImageReader reader = reader(stream);
            try {
                reader.setInput(stream, true, true);
                final String format = requireDimensions(reader);
                orientation = format.equals("jpeg") ? jpegOrientation(bytes) : 1;
                sourceWidth = reader.getWidth(0);
                sourceHeight = reader.getHeight(0);
                final ImageReadParam parameters = reader.getDefaultReadParam();
                final int sample = Math.max(1, (Math.max(sourceWidth, sourceHeight) + maxEdge * 2 - 1) / (maxEdge * 2));
                parameters.setSourceSubsampling(sample, sample, 0, 0);
                decoded = reader.read(0, parameters);
                if (decoded == null) { throw new IllegalArgumentException("Invalid image data"); }
            } finally { reader.dispose(); }
        }
        final boolean transposed = orientation >= 5;
        final int width = transposed ? sourceHeight : sourceWidth;
        final int height = transposed ? sourceWidth : sourceHeight;
        final int decodedWidth = transposed ? decoded.getHeight() : decoded.getWidth();
        final int decodedHeight = transposed ? decoded.getWidth() : decoded.getHeight();
        final double scale = Math.min(1d, (double) maxEdge / Math.max(width, height));
        final boolean alpha = decoded.getColorModel().hasAlpha();
        final BufferedImage resized = new BufferedImage(Math.max(1, (int) Math.round(width * scale)),
                Math.max(1, (int) Math.round(height * scale)), alpha ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB);
        final Graphics2D graphics = resized.createGraphics();
        try {
            graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
            graphics.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
            graphics.scale((double) resized.getWidth() / decodedWidth, (double) resized.getHeight() / decodedHeight);
            graphics.transform(orientationTransform(orientation, decoded.getWidth(), decoded.getHeight()));
            graphics.drawImage(decoded, 0, 0, null);
        } finally { graphics.dispose(); }
        final String format = alpha ? "png" : "jpeg";
        final ImageWriter writer = ImageIO.getImageWritersByFormatName(format).next();
        final ByteArrayOutputStream encoded = new ByteArrayOutputStream();
        try (final ImageOutputStream output = new MemoryCacheImageOutputStream(encoded)) {
            writer.setOutput(output);
            final ImageWriteParam parameters = writer.getDefaultWriteParam();
            if (!alpha) {
                parameters.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
                parameters.setCompressionQuality(0.85f);
            }
            writer.write(null, new IIOImage(resized, null, null), parameters);
        } finally { writer.dispose(); }
        final byte[] result = encoded.toByteArray();
        if (result.length == 0 || result.length > maxOutputBytes) {
            throw new IllegalArgumentException("Thumbnail exceeds output size limit");
        }
        return new Image(result, sha256(result), alpha ? "image/png" : "image/jpeg");
    }

    public static String sha256(final byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (final NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    private static void requireBytes(final byte[] bytes) {
        if (bytes == null || bytes.length == 0 || bytes.length > MAX_BYTES) {
            throw new IllegalArgumentException("Invalid image size");
        }
    }
    private static ImageReader reader(final ImageInputStream stream) throws IOException {
        if (stream == null) { throw new IllegalArgumentException("Invalid image stream"); }
        final Iterator<ImageReader> readers = ImageIO.getImageReaders(stream);
        if (!readers.hasNext()) { throw new IllegalArgumentException("Unsupported image"); }
        return readers.next();
    }
    private static String requireDimensions(final ImageReader reader) throws IOException {
        final String format = reader.getFormatName().toLowerCase(Locale.ROOT);
        final int width = reader.getWidth(0);
        final int height = reader.getHeight(0);
        if (!(format.equals("png") || format.equals("jpeg")) || width < 16 || height < 16
                || width > 8192 || height > 8192 || (long) width * height > 20_000_000) {
            throw new IllegalArgumentException("Invalid image dimensions or format");
        }
        return format;
    }
    private static AffineTransform orientationTransform(final int orientation, final int width, final int height) {
        return switch (orientation) {
            case 2 -> new AffineTransform(-1, 0, 0, 1, width, 0);
            case 3 -> new AffineTransform(-1, 0, 0, -1, width, height);
            case 4 -> new AffineTransform(1, 0, 0, -1, 0, height);
            case 5 -> new AffineTransform(0, 1, 1, 0, 0, 0);
            case 6 -> new AffineTransform(0, 1, -1, 0, height, 0);
            case 7 -> new AffineTransform(0, -1, -1, 0, height, width);
            case 8 -> new AffineTransform(0, -1, 1, 0, 0, width);
            default -> new AffineTransform();
        };
    }

    /** Only JPEG APP1 EXIF IFD0 orientation is read; all offsets stay within that bounded segment. */
    private static int jpegOrientation(final byte[] bytes) {
        int position = 2;
        while (position + 3 < bytes.length && (bytes[position] & 0xff) == 0xff) {
            while (position < bytes.length && (bytes[position] & 0xff) == 0xff) { position++; }
            if (position >= bytes.length) { break; }
            final int marker = bytes[position++] & 0xff;
            if (marker == 0xda || marker == 0xd9) { break; }
            if (marker == 0x01 || marker >= 0xd0 && marker <= 0xd8) { continue; }
            if (position + 1 >= bytes.length) { break; }
            final int length = unsignedShort(bytes, position, false);
            if (length < 2 || length > bytes.length - position) { break; }
            final int start = position + 2;
            if (marker == 0xe1 && length >= 16 && bytes[start] == 'E' && bytes[start + 1] == 'x'
                    && bytes[start + 2] == 'i' && bytes[start + 3] == 'f' && bytes[start + 4] == 0 && bytes[start + 5] == 0) {
                final int found = exifOrientation(bytes, start + 6, position + length);
                if (found != 0) { return found; }
            }
            position += length;
        }
        return 1;
    }
    private static int exifOrientation(final byte[] bytes, final int base, final int end) {
        final boolean little = bytes[base] == 'I' && bytes[base + 1] == 'I';
        if (!(little || bytes[base] == 'M' && bytes[base + 1] == 'M') || unsignedShort(bytes, base + 2, little) != 42) { return 0; }
        final long offset = unsignedInt(bytes, base + 4, little);
        if (offset < 8 || offset > end - base - 2) { return 0; }
        final int directory = base + (int) offset;
        final int entries = unsignedShort(bytes, directory, little);
        if ((long) directory + 2 + entries * 12L > end) { return 0; }
        for (int index = 0; index < entries; index++) {
            final int entry = directory + 2 + index * 12;
            if (unsignedShort(bytes, entry, little) == 0x0112 && unsignedShort(bytes, entry + 2, little) == 3
                    && unsignedInt(bytes, entry + 4, little) == 1) {
                final int value = unsignedShort(bytes, entry + 8, little);
                return value >= 1 && value <= 8 ? value : 0;
            }
        }
        return 0;
    }
    private static int unsignedShort(final byte[] bytes, final int offset, final boolean little) {
        return little ? (bytes[offset] & 0xff) | (bytes[offset + 1] & 0xff) << 8
                : (bytes[offset] & 0xff) << 8 | (bytes[offset + 1] & 0xff);
    }
    private static long unsignedInt(final byte[] bytes, final int offset, final boolean little) {
        return little ? unsignedShort(bytes, offset, true) | (long) unsignedShort(bytes, offset + 2, true) << 16
                : (long) unsignedShort(bytes, offset, false) << 16 | unsignedShort(bytes, offset + 2, false);
    }
}
