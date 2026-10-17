package com.wotb.web.util;

import org.junit.jupiter.api.Test;
import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.zip.CRC32;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ImageValidationTest {
    private static final int MAX_OUTPUT = 512 * 1024;

    @Test void originalCoverAndEvidenceValidationKeepsOriginalBytesAndResolution() throws Exception {
        final byte[] original = png(new BufferedImage(512, 256, BufferedImage.TYPE_INT_RGB));
        final ImageValidation.Image validated = ImageValidation.read(new ByteArrayInputStream(original));
        assertArrayEquals(original, validated.bytes());
        assertEquals("image/png", validated.contentType());
        assertEquals(512, ImageIO.read(new ByteArrayInputStream(validated.bytes())).getWidth());
        assertEquals(ImageValidation.sha256(original), validated.hash());
    }

    @Test void largeOpaqueInputProducesSmallJpegWithoutChangingItsAspectRatio() throws Exception {
        final byte[] original = png(new BufferedImage(4096, 2048, BufferedImage.TYPE_INT_RGB));
        final ImageValidation.Image image = thumbnail(original);
        final BufferedImage result = ImageIO.read(new ByteArrayInputStream(image.bytes()));
        assertEquals("image/jpeg", image.contentType());
        assertEquals(256, result.getWidth());
        assertEquals(128, result.getHeight());
        assertTrue(image.bytes().length <= MAX_OUTPUT);
        assertEquals(ImageValidation.sha256(image.bytes()), image.hash());
        final BufferedImage rounded = ImageIO.read(new ByteArrayInputStream(thumbnail(
                png(new BufferedImage(1023, 777, BufferedImage.TYPE_INT_RGB))).bytes()));
        assertEquals(256, rounded.getWidth());
        assertEquals(194, rounded.getHeight(), "Use original aspect ratio across subsampling rounding");
    }

    @Test void transparentPngRetainsTransparencyAndSmallImagesAreNotEnlarged() throws Exception {
        final BufferedImage source = new BufferedImage(512, 256, BufferedImage.TYPE_INT_ARGB);
        final Graphics2D graphics = source.createGraphics();
        try {
            graphics.setColor(new Color(10, 100, 220, 90));
            graphics.fillRect(128, 64, 256, 128);
        } finally { graphics.dispose(); }
        final ImageValidation.Image image = thumbnail(png(source));
        final BufferedImage result = ImageIO.read(new ByteArrayInputStream(image.bytes()));
        assertEquals("image/png", image.contentType());
        assertEquals(256, result.getWidth());
        assertEquals(128, result.getHeight());
        assertEquals(0, result.getRGB(0, 0) >>> 24);
        assertEquals(90, result.getRGB(128, 64) >>> 24);
        final BufferedImage small = ImageIO.read(new ByteArrayInputStream(thumbnail(
                png(new BufferedImage(32, 16, BufferedImage.TYPE_INT_RGB))).bytes()));
        assertEquals(32, small.getWidth());
        assertEquals(16, small.getHeight());
    }

    @Test void allEightExifDirectionsAreAppliedAndSourceMetadataIsDiscarded() throws Exception {
        final BufferedImage source = new BufferedImage(64, 32, BufferedImage.TYPE_INT_RGB);
        final Color[] colors = {Color.RED, Color.GREEN, Color.BLUE, Color.YELLOW};
        final Graphics2D graphics = source.createGraphics();
        try {
            for (int index = 0; index < colors.length; index++) {
                graphics.setColor(colors[index]);
                graphics.fillRect(index % 2 * 32, index / 2 * 16, 32, 16);
            }
        } finally { graphics.dispose(); }
        final int[][] expected = {{0,1,2,3}, {1,0,3,2}, {3,2,1,0}, {2,3,0,1},
                {0,2,1,3}, {2,0,3,1}, {3,1,2,0}, {1,3,0,2}};
        for (int direction = 1; direction <= 8; direction++) {
            final ImageValidation.Image image = thumbnail(withExif(source, direction, direction % 2 == 0, false));
            final BufferedImage result = ImageIO.read(new ByteArrayInputStream(image.bytes()));
            assertEquals(direction >= 5 ? 32 : 64, result.getWidth(), "direction " + direction);
            assertEquals(direction >= 5 ? 64 : 32, result.getHeight(), "direction " + direction);
            for (int corner = 0; corner < 4; corner++) {
                final Color actual = new Color(result.getRGB(result.getWidth() * (corner % 2 == 0 ? 1 : 3) / 4,
                        result.getHeight() * (corner / 2 == 0 ? 1 : 3) / 4));
                final Color wanted = colors[expected[direction - 1][corner]];
                assertTrue(Math.abs(actual.getRed() - wanted.getRed()) < 45
                        && Math.abs(actual.getGreen() - wanted.getGreen()) < 45
                        && Math.abs(actual.getBlue() - wanted.getBlue()) < 45, "direction " + direction + " corner " + corner);
            }
            assertFalse(new String(image.bytes(), StandardCharsets.ISO_8859_1).contains("Exif"));
        }
    }

    @Test void malformedExifOffsetsAreIgnoredWithoutReadingOutsideTheSegment() throws Exception {
        final byte[] source = withExif(new BufferedImage(64, 32, BufferedImage.TYPE_INT_RGB), 6, true, true);
        final BufferedImage result = ImageIO.read(new ByteArrayInputStream(thumbnail(source).bytes()));
        assertEquals(64, result.getWidth());
        assertEquals(32, result.getHeight());
    }

    @Test void unsupportedTruncatedOversizedAndExtremeDimensionInputsAreRejected() throws Exception {
        assertThrows(IllegalArgumentException.class, () -> thumbnail(new byte[] {1,2,3}));
        assertThrows(IllegalArgumentException.class, () -> thumbnail(new byte[ImageValidation.MAX_BYTES + 1]));
        final ByteArrayOutputStream gif = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(32, 32, BufferedImage.TYPE_INT_RGB), "gif", gif);
        assertThrows(IllegalArgumentException.class, () -> thumbnail(gif.toByteArray()));
        final byte[] valid = png(new BufferedImage(32, 32, BufferedImage.TYPE_INT_RGB));
        assertThrows(IllegalArgumentException.class, () -> thumbnail(withPngDimensions(valid, 8193, 32)));
        assertThrows(IllegalArgumentException.class, () -> thumbnail(withPngDimensions(valid, 5000, 5000)));
        assertThrows(IllegalArgumentException.class, () -> thumbnail(withPngDimensions(valid, 15, 32)));
        assertThrows(IOException.class, () -> thumbnail(java.util.Arrays.copyOf(valid, 36)));
        assertThrows(IllegalArgumentException.class,
                () -> ImageValidation.thumbnail(new ByteArrayInputStream(valid), 256, 1));
    }

    private static ImageValidation.Image thumbnail(final byte[] bytes) throws Exception {
        return ImageValidation.thumbnail(new ByteArrayInputStream(bytes), 256, MAX_OUTPUT);
    }
    private static byte[] png(final BufferedImage image) throws Exception {
        final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        ImageIO.write(image, "png", bytes);
        return bytes.toByteArray();
    }
    private static byte[] withPngDimensions(final byte[] original, final int width, final int height) {
        final byte[] bytes = original.clone();
        ByteBuffer.wrap(bytes).putInt(16, width).putInt(20, height);
        final CRC32 crc = new CRC32(); crc.update(bytes, 12, 17);
        ByteBuffer.wrap(bytes).putInt(29, (int) crc.getValue());
        return bytes;
    }
    private static byte[] withExif(final BufferedImage source, final int orientation, final boolean bigEndian,
                                   final boolean invalidOffset) throws Exception {
        final ByteArrayOutputStream jpeg = new ByteArrayOutputStream();
        ImageIO.write(source, "jpeg", jpeg);
        final ByteBuffer tiff = ByteBuffer.allocate(26).order(bigEndian ? ByteOrder.BIG_ENDIAN : ByteOrder.LITTLE_ENDIAN);
        tiff.put((byte) (bigEndian ? 'M' : 'I')).put((byte) (bigEndian ? 'M' : 'I')).putShort((short) 42)
                .putInt(invalidOffset ? -1 : 8).putShort((short) 1).putShort((short) 0x0112).putShort((short) 3)
                .putInt(1).putShort((short) orientation).putShort((short) 0).putInt(0);
        final ByteArrayOutputStream result = new ByteArrayOutputStream();
        result.write(new byte[] {(byte) 0xff, (byte) 0xd8, (byte) 0xff, (byte) 0xe1, 0, 34});
        result.write(new byte[] {'E','x','i','f',0,0});
        result.write(tiff.array());
        result.write(jpeg.toByteArray(), 2, jpeg.size() - 2);
        return result.toByteArray();
    }
}
