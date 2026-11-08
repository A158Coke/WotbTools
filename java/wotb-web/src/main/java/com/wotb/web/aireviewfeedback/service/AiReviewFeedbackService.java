package com.wotb.web.aireviewfeedback.service;

import com.wotb.web.aireviewfeedback.dto.FeedbackCreated;
import com.wotb.web.aireviewfeedback.dto.FeedbackPage;
import com.wotb.web.aireviewfeedback.dto.FeedbackReason;
import com.wotb.web.aireviewfeedback.dto.FeedbackRecord;
import com.wotb.web.aireviewfeedback.dto.FeedbackStatus;
import com.wotb.web.aireviewfeedback.repository.AiReviewFeedbackRepository;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import com.wotb.web.util.text.UserText;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;

@Service
public class AiReviewFeedbackService {
    private static final Set<String> FIELDS = Set.of("reasonCodes", "feedbackText", "aiResponseText", "model");
    private static final int MAX_REQUEST_BYTES = 3 * 1024 * 1024;
    private static final JsonMapper JSON = JsonMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .enable(DeserializationFeature.FAIL_ON_READING_DUP_TREE_KEY).build();
    private final AiReviewFeedbackRepository repository;

    public AiReviewFeedbackService(final AiReviewFeedbackRepository repository) { this.repository = repository; }

    public FeedbackCreated createFromStream(final InputStream input) {
        final JsonNode body;
        try {
            final byte[] bytes = input.readNBytes(MAX_REQUEST_BYTES + 1);
            require(bytes.length <= MAX_REQUEST_BYTES);
            body = JSON.readTree(bytes);
        } catch (final IOException | tools.jackson.core.JacksonException ex) {
            throw invalid();
        }
        return create(body);
    }

    public FeedbackCreated create(final JsonNode body) {
        require(body != null && body.isObject());
        body.propertyNames().forEach(name -> require(FIELDS.contains(name)));
        final var codes = body.get("reasonCodes");
        require(codes != null && codes.isArray() && codes.size() <= 8);
        final var reasons = new ArrayList<FeedbackReason>();
        for (final var value : codes) {
            require(value.isString());
            try { reasons.add(FeedbackReason.valueOf(value.asString())); }
            catch (final IllegalArgumentException ex) { throw invalid(); }
        }
        require(new HashSet<>(reasons).size() == reasons.size());
        final String feedback = text(body.get("feedbackText"), 4000, false);
        final String response = text(body.get("aiResponseText"), 200000, true);
        final String model = text(body.get("model"), 128, false);
        require(!reasons.isEmpty() || UserText.hasText(feedback));
        require(UserText.hasText(response));
        try { return repository.insert(reasons, UserText.hasText(feedback) ? feedback : null, response, model); }
        catch (final RuntimeException ex) { throw new ApiException(ApiErrorCode.INTERNAL_ERROR); }
    }

    public void updateStatus(final String rawId, final InputStream input) {
        final long id = id(rawId);
        final JsonNode body;
        try {
            final byte[] bytes = input.readNBytes(MAX_REQUEST_BYTES + 1);
            require(bytes.length <= MAX_REQUEST_BYTES);
            body = JSON.readTree(bytes);
        } catch (final IOException | tools.jackson.core.JacksonException ex) {
            throw invalid();
        }
        require(body != null && body.isObject());
        body.propertyNames().forEach(name -> require("status".equals(name)));
        final var value = body.get("status");
        require(value != null && value.isString());
        final FeedbackStatus status;
        try { status = FeedbackStatus.from(value.asString()); }
        catch (final IllegalArgumentException ex) { throw invalid(); }
        try { if (!repository.updateStatus(id, status)) { throw new ApiException(ApiErrorCode.RESOURCE_NOT_FOUND); } }
        catch (final ApiException ex) { throw ex; }
        catch (final RuntimeException ex) { throw new ApiException(ApiErrorCode.INTERNAL_ERROR); }
    }

    public FeedbackPage list(final int page, final int size, final String rawReason) {
        require(page >= 0 && size >= 1 && size <= 100);
        FeedbackReason reason = null;
        if (rawReason != null) {
            try { reason = FeedbackReason.valueOf(rawReason); }
            catch (final IllegalArgumentException ex) { throw invalid(); }
        }
        try { return repository.list(page, size, reason); }
        catch (final RuntimeException ex) { throw new ApiException(ApiErrorCode.INTERNAL_ERROR); }
    }

    public FeedbackRecord get(final String rawId) {
        final long id = id(rawId);
        try { return repository.find(id).orElseThrow(() -> new ApiException(ApiErrorCode.RESOURCE_NOT_FOUND)); }
        catch (final ApiException ex) { throw ex; }
        catch (final RuntimeException ex) { throw new ApiException(ApiErrorCode.INTERNAL_ERROR); }
    }

    public void delete(final String rawId) {
        final long id = id(rawId);
        try { if (!repository.delete(id)) { throw new ApiException(ApiErrorCode.RESOURCE_NOT_FOUND); } }
        catch (final ApiException ex) { throw ex; }
        catch (final RuntimeException ex) { throw new ApiException(ApiErrorCode.INTERNAL_ERROR); }
    }

    private static long id(final String value) {
        require(value != null && value.matches("[1-9][0-9]*"));
        try { return Long.parseLong(value); }
        catch (final NumberFormatException ex) { throw invalid(); }
    }

    private static String text(final JsonNode node, final int max, final boolean required) {
        if (node == null || node.isNull()) { require(!required); return null; }
        require(node.isString());
        final String value = node.asString();
        require(UserText.isStorable(value, max));
        return value;
    }

    private static void require(final boolean valid) { if (!valid) { throw invalid(); } }
    private static ApiException invalid() { return new ApiException(ApiErrorCode.INVALID_REQUEST); }
}
