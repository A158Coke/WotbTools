package com.wotb.ai.review.converter;

import com.wotb.ai.review.AiCancellationRegistry;
import com.wotb.ai.review.AiReviewRequest;
import com.wotb.ai.review.AllowedLanguage;
import com.wotb.core.model.Battle;
import com.wotb.core.replay.facts.ReplayFactsCodec;
import com.wotb.core.replay.projection.ClientAiProjection;
import com.wotb.core.replay.projection.ClientAiProjectionAdapter;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.List;
import java.util.zip.GZIPInputStream;
import java.util.zip.ZipException;

@Component
public class AiReviewRequestConverter {
    private static final int MAX_REQUEST_BYTES = 16 * 1024 * 1024;

    public AiReviewRequest convert(final HttpServletRequest request) {
        if (request.getContentLengthLong() > MAX_REQUEST_BYTES) {
            throw tooLarge();
        }
        final JsonNode body;
        try {
            body = JsonMapper.builder().build().readTree(readBody(request));
        } catch (final IOException | tools.jackson.core.JacksonException error) {
            throw invalidRequest();
        }
        if (body == null || !body.isObject()) {
            throw invalidRequest();
        }
        final AllowedLanguage language = languageOf(body.path("locale").asString(""));
        final String correlationId = body.path("correlationId").asString("");
        if (!AiCancellationRegistry.isValidCorrelationId(correlationId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_CORRELATION_ID");
        }
        try {
            final Battle battle = ReplayFactsCodec.battleFromJson(body.path("battle"));
            final ClientAiProjection projection = ReplayFactsCodec.projectionFromJson(body.path("projection"));
            final ReplayReconstruction reconstruction = ClientAiProjectionAdapter.toReconstruction(battle, projection);
            ClientAiProjectionAdapter.enrichBattle(battle, reconstruction);
            return new AiReviewRequest(language, correlationId, battle, reconstruction,
                    List.copyOf(projection.limitations()));
        } catch (final IOException | tools.jackson.core.JacksonException | IllegalArgumentException
                       | NullPointerException error) {
            throw invalidRequest();
        }
    }

    static byte[] readBody(final HttpServletRequest request) throws IOException {
        final byte[] raw = request.getInputStream().readNBytes(MAX_REQUEST_BYTES + 1);
        if (raw.length > MAX_REQUEST_BYTES) {
            throw tooLarge();
        }
        final String encoding = request.getHeader("Content-Encoding");
        if (encoding == null || encoding.isBlank() || "identity".equalsIgnoreCase(encoding.trim())) {
            return raw;
        }
        if (!"gzip".equalsIgnoreCase(encoding.trim())) {
            throw new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_CONTENT_ENCODING");
        }
        try (GZIPInputStream input = new GZIPInputStream(new ByteArrayInputStream(raw))) {
            final byte[] inflated = input.readNBytes(MAX_REQUEST_BYTES + 1);
            if (inflated.length > MAX_REQUEST_BYTES) {
                throw tooLarge();
            }
            return inflated;
        } catch (final ZipException error) {
            throw new IOException("gzip body corrupt", error);
        }
    }

    private static AllowedLanguage languageOf(final String locale) {
        return switch (locale) {
            case "zh-CN" -> AllowedLanguage.ZH;
            case "en-US" -> AllowedLanguage.EN;
            case "ru-RU" -> AllowedLanguage.RU;
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "UNKNOWN_LOCALE");
        };
    }

    private static ResponseStatusException tooLarge() {
        return new ResponseStatusException(HttpStatus.CONTENT_TOO_LARGE, "AI_REQUEST_TOO_LARGE");
    }

    private static ResponseStatusException invalidRequest() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_AI_REQUEST");
    }
}
