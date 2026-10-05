package com.wotb.ai.tournament;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.wotb.web.replay.ai.gateway.AiChatGateway;
import com.wotb.web.replay.ai.gateway.AiChatRequest;
import com.wotb.web.replay.ai.gateway.AiChatResponse;
import com.wotb.web.replay.ai.gateway.AiResponseFormat;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.server.ResponseStatusException;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TournamentGroupRecognizerTest {
    // Synthetic fixture only; never a runtime secret.
    static final String SIGNING_KEY = "synthetic-tournament-fixture-key-32-bytes";
    static final String ADMIN_ID = "test-admin";
    private AiChatGateway gateway;
    private TournamentGroupRecognizer recognizer;
    private byte[] png;

    @BeforeEach
    void setUp() throws IOException {
        gateway = mock(AiChatGateway.class);
        when(gateway.isConfigured()).thenReturn(true);
        when(gateway.chat(any())).thenReturn(response());
        recognizer = new TournamentGroupRecognizer(gateway, SIGNING_KEY, "deepseek-flash", 2, 60);
        png = image("png", 32, 32);
    }

    @Test
    void validatesPermitAndReusesGatewayWithMediaJsonAndSeparateModel() {
        final var result = recognize(png, permit(png, claims -> { }));
        assertTrue(result.complete());
        assertEquals(TournamentGroupRecognizer.imageHash(png), result.imageHash());
        final ArgumentCaptor<AiChatRequest> capture = ArgumentCaptor.forClass(AiChatRequest.class);
        verify(gateway).chat(capture.capture());
        final AiChatRequest request = capture.getValue();
        assertEquals("deepseek-flash", request.model());
        assertEquals(90, request.callTimeoutSec());
        assertEquals(AiResponseFormat.JSON_OBJECT, request.responseFormat());
        assertFalse(request.thinkingEnabled());
        assertEquals(1, request.media().size());
        assertArrayEquals(png, request.media().getFirst().getDataAsByteArray());
        assertTrue(request.systemPrompt().contains("未可信输入"));
    }

    @Test
    void rejectsExpiredWrongHashWrongCallerIssuerAudienceAndInvalidClaimsBeforeProvider() {
        final Instant now = Instant.now();
        final List<Consumer<JWTClaimsSet.Builder>> alterations = List.of(
                claims -> claims.issueTime(Date.from(now.minusSeconds(120))).expirationTime(Date.from(now.minusSeconds(1))),
                claims -> claims.claim("image_hash", "0".repeat(64)),
                claims -> claims.subject("other-admin"),
                claims -> claims.issuer("other-issuer"),
                claims -> claims.audience("other-audience"),
                claims -> claims.audience((String) null),
                claims -> claims.issueTime(null),
                claims -> claims.expirationTime(null),
                claims -> claims.issueTime(Date.from(now.plusSeconds(30))),
                claims -> claims.expirationTime(Date.from(now.plusSeconds(400))),
                claims -> claims.claim("event_id", "1"),
                claims -> claims.claim("round_number", 6),
                claims -> claims.claim("day_number", 4),
                claims -> claims.claim("rules_version", 0));
        for (final Consumer<JWTClaimsSet.Builder> alteration : alterations) {
            assertEquals("INVALID_RECOGNITION_PERMIT", assertThrows(ResponseStatusException.class,
                    () -> recognize(png, permit(png, alteration))).getReason());
        }
        verify(gateway, never()).chat(any());
    }

    @Test
    void rejectsInvalidSignatureAndMissingPermit() {
        assertEquals("INVALID_RECOGNITION_PERMIT", assertThrows(ResponseStatusException.class,
                () -> recognize(png, "broken-token")).getReason());
        assertEquals("INVALID_RECOGNITION_PERMIT", assertThrows(ResponseStatusException.class,
                () -> recognize(png, "")).getReason());
        final String valid = permit(png, claims -> { });
        final String invalid = valid.substring(0, valid.lastIndexOf('.') + 1) + "X".repeat(43);
        assertEquals("INVALID_RECOGNITION_PERMIT", assertThrows(ResponseStatusException.class,
                () -> recognize(png, invalid)).getReason());
        verify(gateway, never()).chat(any());
    }

    @Test
    void absentOrShortSigningKeyDisablesOnlyRecognition() {
        for (final String key : List.of("", "short")) {
            final var disabled = new TournamentGroupRecognizer(gateway, key, "deepseek-flash", 2, 60);
            assertEquals("TOURNAMENT_RECOGNITION_NOT_CONFIGURED", assertThrows(ResponseStatusException.class,
                    () -> disabled.recognize(file(png), permit(png, claims -> { }), ADMIN_ID)).getReason());
        }
        verify(gateway, never()).chat(any());
    }

    @Test
    void validatesMagicPixelsAndByteLimitBeforeProvider() throws IOException {
        final byte[] garbage = "not a PNG even with a PNG filename".getBytes(StandardCharsets.UTF_8);
        assertEquals("UNSUPPORTED_TOURNAMENT_IMAGE", assertThrows(ResponseStatusException.class,
                () -> recognize(garbage, permit(garbage, claims -> { }))).getReason());
        final byte[] huge = new byte[TournamentGroupRecognizer.MAX_IMAGE_BYTES + 1];
        assertEquals("TOURNAMENT_IMAGE_TOO_LARGE", assertThrows(ResponseStatusException.class,
                () -> recognize(huge, permit(huge, claims -> { }))).getReason());
        final byte[] tiny = image("png", 1, 1);
        assertEquals("INVALID_TOURNAMENT_IMAGE_DIMENSIONS", assertThrows(ResponseStatusException.class,
                () -> recognize(tiny, permit(tiny, claims -> { }))).getReason());
        verify(gateway, never()).chat(any());
    }

    @Test
    void acceptsJpegByMagicDespiteUntrustedMultipartContentType() throws IOException {
        final byte[] jpeg = image("jpg", 32, 32);
        assertTrue(recognize(jpeg, permit(jpeg, claims -> { })).complete());
        final ArgumentCaptor<AiChatRequest> capture = ArgumentCaptor.forClass(AiChatRequest.class);
        verify(gateway).chat(capture.capture());
        assertEquals("image/jpeg", capture.getValue().media().getFirst().getMimeType().toString());
    }

    @Test
    void rejectsRateBudgetWithoutAnotherProviderCall() {
        recognizer = new TournamentGroupRecognizer(gateway, SIGNING_KEY, "deepseek-flash", 1, 1);
        final String permit = permit(png, claims -> { });
        recognize(png, permit);
        assertEquals("TOURNAMENT_RECOGNITION_RATE_LIMITED", assertThrows(ResponseStatusException.class,
                () -> recognize(png, permit)).getReason());
        verify(gateway, times(1)).chat(any());
    }

    @Test
    void rejectsConcurrentOverflowAndReleasesSlotAfterFailure() throws Exception {
        recognizer = new TournamentGroupRecognizer(gateway, SIGNING_KEY, "deepseek-flash", 1, 60);
        final CountDownLatch entered = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        when(gateway.chat(any())).thenAnswer(invocation -> {
            entered.countDown();
            assertTrue(release.await(5, TimeUnit.SECONDS));
            return response();
        });
        final String permit = permit(png, claims -> { });
        try (final var executor = Executors.newSingleThreadExecutor()) {
            final var first = executor.submit(() -> recognize(png, permit));
            try {
                assertTrue(entered.await(5, TimeUnit.SECONDS));
                assertEquals("TOURNAMENT_RECOGNITION_BUSY", assertThrows(ResponseStatusException.class,
                        () -> recognize(png, permit)).getReason());
            } finally {
                release.countDown();
            }
            assertTrue(first.get(5, TimeUnit.SECONDS).complete());
        }
        assertTrue(recognize(png, permit).complete());
    }

    private TournamentGroupRecognitionParser.Recognition recognize(final byte[] bytes, final String permit) {
        return recognizer.recognize(file(bytes), permit, ADMIN_ID);
    }

    static MockMultipartFile file(final byte[] bytes) {
        return new MockMultipartFile("image", "untrusted-name.png", "application/octet-stream", bytes);
    }

    static String permit(final byte[] bytes, final Consumer<JWTClaimsSet.Builder> alter) {
        final Instant now = Instant.now().minusSeconds(1);
        final JWTClaimsSet.Builder claims = new JWTClaimsSet.Builder().issuer("wotbtools-tournament")
                .audience("tournament-recognition").subject(ADMIN_ID)
                .issueTime(Date.from(now)).expirationTime(Date.from(now.plusSeconds(300)))
                .claim("event_id", 1L).claim("round_number", 1).claim("day_number", 2)
                .claim("rules_version", 1L).claim("image_hash", TournamentGroupRecognizer.imageHash(bytes));
        alter.accept(claims);
        try {
            final SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims.build());
            jwt.sign(new MACSigner(SIGNING_KEY.getBytes(StandardCharsets.UTF_8)));
            return jwt.serialize();
        } catch (final JOSEException error) {
            throw new IllegalStateException(error);
        }
    }

    static byte[] image(final String type, final int width, final int height) throws IOException {
        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB), type, out);
        return out.toByteArray();
    }

    static AiChatResponse response() {
        return new AiChatResponse(TournamentGroupRecognitionParserTest.group("1", "2", "3", "3-4"),
                "DeepSeek", "deepseek-flash", 1, 2, 3, 0, 0, 0, "stop");
    }
}
