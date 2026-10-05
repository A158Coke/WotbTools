package com.wotb.ai.tournament;

import com.wotb.ai.tournament.TournamentGroupRecognitionParser.Recognition;
import com.wotb.core.replay.processing.AiNotConfiguredException;
import com.wotb.web.replay.ai.AiPromptLibrary;
import com.wotb.web.replay.ai.gateway.AiChatGateway;
import com.wotb.web.replay.ai.gateway.AiChatRequest;
import com.wotb.web.replay.ai.gateway.AiResponseFormat;
import com.wotb.web.replay.ai.gateway.AiUpstreamException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import javax.crypto.spec.SecretKeySpec;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.Iterator;
import java.util.UUID;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

/** Stateless recognition boundary with bounded provider admission, independent of Business DB. */
@Service
public class TournamentGroupRecognizer {
    public static final int MAX_IMAGE_BYTES = 10 * 1024 * 1024;
    private static final byte[] PNG_MAGIC = {(byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a};

    private final AiChatGateway gateway;
    private final String model;
    private final NimbusJwtDecoder permitDecoder;
    private final Semaphore active;
    private final int callsPerMinute;
    private final TournamentGroupRecognitionParser parser = new TournamentGroupRecognitionParser();
    private long windowStarted = System.nanoTime();
    private int callsInWindow;

    public TournamentGroupRecognizer(final AiChatGateway gateway,
            @Value("${wotb.ai.tournament-recognition.signing-key:}") final String signingKey,
            @Value("${wotb.ai.tournament-recognition.model:deepseek-flash}") final String model,
            @Value("${wotb.ai.tournament-recognition.max-concurrent:2}") final int maxConcurrent,
            @Value("${wotb.ai.tournament-recognition.calls-per-minute:60}") final int callsPerMinute) {
        this.gateway = gateway;
        this.model = model;
        if (!StringUtils.hasText(model) || maxConcurrent < 1 || callsPerMinute < 1) {
            throw new IllegalArgumentException("Invalid tournament recognition configuration");
        }
        this.active = new Semaphore(maxConcurrent);
        this.callsPerMinute = callsPerMinute;
        final byte[] keyBytes = signingKey == null ? new byte[0] : signingKey.getBytes(StandardCharsets.UTF_8);
        if (keyBytes.length >= 32) {
            this.permitDecoder = NimbusJwtDecoder.withSecretKey(new SecretKeySpec(keyBytes, "HmacSHA256"))
                    .macAlgorithm(MacAlgorithm.HS256).build();
            this.permitDecoder.setJwtValidator(new JwtTimestampValidator(Duration.ZERO));
        } else {
            this.permitDecoder = null;
        }
    }

    public Recognition recognize(final MultipartFile image, final String permit, final String callerId) {
        if (permitDecoder == null) throw rejected(HttpStatus.SERVICE_UNAVAILABLE, "TOURNAMENT_RECOGNITION_NOT_CONFIGURED");
        // Admission precedes image allocation. Invalid input releases the slot without consuming provider budget.
        if (!active.tryAcquire()) throw rejected(HttpStatus.SERVICE_UNAVAILABLE, "TOURNAMENT_RECOGNITION_BUSY");
        try {
            final byte[] bytes = readImage(image);
            final String hash = imageHash(bytes);
            verifyPermit(permit, callerId, hash);
            final String contentType = validateImage(bytes);
            if (!gateway.isConfigured()) throw rejected(HttpStatus.SERVICE_UNAVAILABLE, "AI_NOT_CONFIGURED");
            takeProviderBudget();
            final AiChatRequest request = new AiChatRequest(AiPromptLibrary.zh("tournament/recognize"),
                    "Extract one complete tournament group from the attached image. Return JSON observations only.",
                    model, null, 2048, false, null, UUID.randomUUID().toString(),
                    "TOURNAMENT_GROUP_RECOGNITION", 90, AiResponseFormat.JSON_OBJECT).withImage(contentType, bytes);
            return parser.parse(gateway.chat(request).completionText(), hash);
        } catch (final AiNotConfiguredException error) {
            throw rejected(HttpStatus.SERVICE_UNAVAILABLE, "AI_NOT_CONFIGURED");
        } catch (final AiUpstreamException error) {
            throw rejected("AI_TIMEOUT".equals(error.code()) ? HttpStatus.GATEWAY_TIMEOUT : HttpStatus.BAD_GATEWAY,
                    error.code());
        } finally {
            active.release();
        }
    }

    private void verifyPermit(final String permit, final String callerId, final String hash) {
        if (!StringUtils.hasText(permit) || permit.length() > 4096 || !StringUtils.hasText(callerId)) {
            throw rejected(HttpStatus.FORBIDDEN, "INVALID_RECOGNITION_PERMIT");
        }
        try {
            final Jwt jwt = permitDecoder.decode(permit);
            final Instant now = Instant.now();
            if (!"wotbtools-tournament".equals(jwt.getClaimAsString("iss"))
                    || jwt.getAudience() == null || !jwt.getAudience().contains("tournament-recognition")
                    || !callerId.equals(jwt.getSubject()) || jwt.getIssuedAt() == null || jwt.getExpiresAt() == null
                    || jwt.getIssuedAt().isAfter(now) || !jwt.getExpiresAt().isAfter(now)
                    || !jwt.getExpiresAt().isAfter(jwt.getIssuedAt())
                    || Duration.between(jwt.getIssuedAt(), jwt.getExpiresAt()).compareTo(Duration.ofMinutes(5)) > 0
                    || !positiveClaim(jwt, "event_id", Long.MAX_VALUE)
                    || !positiveClaim(jwt, "round_number", 5)
                    || !positiveClaim(jwt, "day_number", 3)
                    || !positiveClaim(jwt, "rules_version", Long.MAX_VALUE)
                    || !hash.equals(jwt.getClaimAsString("image_hash"))) {
                throw rejected(HttpStatus.FORBIDDEN, "INVALID_RECOGNITION_PERMIT");
            }
        } catch (final JwtException | IllegalArgumentException | ClassCastException error) {
            throw rejected(HttpStatus.FORBIDDEN, "INVALID_RECOGNITION_PERMIT");
        }
    }

    private static boolean positiveClaim(final Jwt jwt, final String name, final long maximum) {
        final Object value = jwt.getClaim(name);
        return value instanceof Number number && (value instanceof Long || value instanceof Integer)
                && number.longValue() > 0 && number.longValue() <= maximum;
    }

    private static byte[] readImage(final MultipartFile image) {
        if (image == null || image.isEmpty()) throw rejected(HttpStatus.BAD_REQUEST, "INVALID_TOURNAMENT_IMAGE");
        if (image.getSize() > MAX_IMAGE_BYTES) throw rejected(HttpStatus.CONTENT_TOO_LARGE, "TOURNAMENT_IMAGE_TOO_LARGE");
        try (final var input = image.getInputStream()) {
            final byte[] bytes = input.readNBytes(MAX_IMAGE_BYTES + 1);
            if (bytes.length > MAX_IMAGE_BYTES) throw rejected(HttpStatus.CONTENT_TOO_LARGE, "TOURNAMENT_IMAGE_TOO_LARGE");
            return bytes;
        } catch (final IOException error) {
            throw rejected(HttpStatus.BAD_REQUEST, "INVALID_TOURNAMENT_IMAGE");
        }
    }

    private static String validateImage(final byte[] bytes) {
        final String type;
        if (bytes.length >= PNG_MAGIC.length && Arrays.equals(PNG_MAGIC, Arrays.copyOf(bytes, PNG_MAGIC.length))) {
            type = "image/png";
        } else if (bytes.length >= 3 && (bytes[0] & 0xff) == 0xff
                && (bytes[1] & 0xff) == 0xd8 && (bytes[2] & 0xff) == 0xff) {
            type = "image/jpeg";
        } else {
            throw rejected(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_TOURNAMENT_IMAGE");
        }
        try (final ImageInputStream input = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            if (input == null) throw rejected(HttpStatus.BAD_REQUEST, "INVALID_TOURNAMENT_IMAGE");
            final Iterator<ImageReader> readers = ImageIO.getImageReaders(input);
            if (!readers.hasNext()) throw rejected(HttpStatus.BAD_REQUEST, "INVALID_TOURNAMENT_IMAGE");
            final ImageReader reader = readers.next();
            try {
                reader.setInput(input, true, true);
                final int width = reader.getWidth(0);
                final int height = reader.getHeight(0);
                if (width < 16 || height < 16 || width > 8192 || height > 8192
                        || (long) width * height > 20_000_000L) {
                    throw rejected(HttpStatus.BAD_REQUEST, "INVALID_TOURNAMENT_IMAGE_DIMENSIONS");
                }
                // Validate actual pixel decoding only after rejecting oversized image headers.
                if (reader.read(0) == null) throw rejected(HttpStatus.BAD_REQUEST, "INVALID_TOURNAMENT_IMAGE");
            } finally {
                reader.dispose();
            }
            return type;
        } catch (final IOException error) {
            throw rejected(HttpStatus.BAD_REQUEST, "INVALID_TOURNAMENT_IMAGE");
        }
    }

    static String imageHash(final byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (final NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is required by the JVM", error);
        }
    }

    private synchronized void takeProviderBudget() {
        final long now = System.nanoTime();
        if (now - windowStarted >= TimeUnit.MINUTES.toNanos(1)) {
            windowStarted = now;
            callsInWindow = 0;
        }
        if (callsInWindow >= callsPerMinute) throw rejected(HttpStatus.TOO_MANY_REQUESTS, "TOURNAMENT_RECOGNITION_RATE_LIMITED");
        callsInWindow++;
    }

    private static ResponseStatusException rejected(final HttpStatus status, final String code) {
        return new ResponseStatusException(status, code);
    }
}
