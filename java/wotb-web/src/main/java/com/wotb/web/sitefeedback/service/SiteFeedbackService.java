package com.wotb.web.sitefeedback.service;

import com.wotb.web.sitefeedback.dto.SiteFeedbackCreated;
import com.wotb.web.sitefeedback.dto.SiteFeedbackPage;
import com.wotb.web.sitefeedback.dto.SiteFeedbackReason;
import com.wotb.web.sitefeedback.dto.SiteFeedbackRecord;
import com.wotb.web.sitefeedback.repository.SiteFeedbackRepository;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import com.wotb.web.util.text.UserText;
import org.springframework.stereotype.Service;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;

@Service
public class SiteFeedbackService {
    private static final Set<String> FIELDS = Set.of("reasonCodes", "feedbackText", "pageView");
    private static final Pattern PAGE_VIEW = Pattern.compile("[a-z0-9-]{1,64}");
    private static final int MAX_REQUEST_BYTES = 64 * 1024;
    private static final JsonMapper JSON = JsonMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .enable(DeserializationFeature.FAIL_ON_READING_DUP_TREE_KEY).build();
    private final SiteFeedbackRepository repository;

    public SiteFeedbackService(final SiteFeedbackRepository repository) { this.repository = repository; }

    public SiteFeedbackCreated createFromStream(final InputStream input) {
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

    public SiteFeedbackCreated create(final JsonNode body) {
        require(body != null && body.isObject());
        body.propertyNames().forEach(name -> require(FIELDS.contains(name)));
        final var codes = body.get("reasonCodes");
        require(codes != null && codes.isArray() && codes.size() <= SiteFeedbackReason.values().length);
        final var reasons = new ArrayList<SiteFeedbackReason>();
        for (final var value : codes) {
            require(value.isString());
            try { reasons.add(SiteFeedbackReason.valueOf(value.asString())); }
            catch (final IllegalArgumentException ex) { throw invalid(); }
        }
        require(new HashSet<>(reasons).size() == reasons.size());
        final String feedback = text(body.get("feedbackText"));
        final String pageView = pageView(body.get("pageView"));
        require(!reasons.isEmpty() || UserText.hasText(feedback));
        try { return repository.insert(reasons, UserText.hasText(feedback) ? feedback : null, pageView); }
        catch (final RuntimeException ex) { throw new ApiException(ApiErrorCode.INTERNAL_ERROR); }
    }

    public SiteFeedbackPage list(final int page, final int size, final String rawReason) {
        require(page >= 0 && size >= 1 && size <= 100);
        SiteFeedbackReason reason = null;
        if (rawReason != null) {
            try { reason = SiteFeedbackReason.valueOf(rawReason); }
            catch (final IllegalArgumentException ex) { throw invalid(); }
        }
        try { return repository.list(page, size, reason); }
        catch (final RuntimeException ex) { throw new ApiException(ApiErrorCode.INTERNAL_ERROR); }
    }

    public SiteFeedbackRecord get(final String rawId) {
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

    private static String text(final JsonNode node) {
        if (node == null || node.isNull()) { return null; }
        require(node.isString());
        final String value = node.asString();
        require(UserText.isStorable(value, 4000));
        return value;
    }

    private static String pageView(final JsonNode node) {
        if (node == null || node.isNull()) { return null; }
        require(node.isString() && PAGE_VIEW.matcher(node.asString()).matches());
        return node.asString();
    }

    private static void require(final boolean valid) { if (!valid) { throw invalid(); } }
    private static ApiException invalid() { return new ApiException(ApiErrorCode.INVALID_REQUEST); }
}
