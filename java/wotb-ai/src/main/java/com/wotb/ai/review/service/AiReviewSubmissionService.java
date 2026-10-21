package com.wotb.ai.review.service;

import com.wotb.ai.gateway.AiCancellationToken;
import com.wotb.ai.review.AiCancellationRegistry;
import com.wotb.ai.review.AiReviewDonePayload;
import com.wotb.ai.review.AiReviewRequest;
import com.wotb.ai.review.AiReviewWorkerExecutor;
import com.wotb.core.replay.processing.BattleCategoryUtils;
import com.wotb.core.replay.processing.ReplayAnalysisScope;
import com.wotb.core.replay.processing.UnsupportedBattleCategoryException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import java.util.concurrent.RejectedExecutionException;

@Service
public class AiReviewSubmissionService {
    private static final long SSE_TIMEOUT_MS = 1_120_000L;
    private final AiReviewWorkerExecutor workerExecutor;
    private final AiCancellationRegistry cancellations;
    private final AiReviewExecutionService executionService;

    public AiReviewSubmissionService(final AiReviewWorkerExecutor workerExecutor,
                                     final AiCancellationRegistry cancellations,
                                     final AiReviewExecutionService executionService) {
        this.workerExecutor = workerExecutor;
        this.cancellations = cancellations;
        this.executionService = executionService;
    }

    public SseEmitter submit(final AiReviewRequest request) {
        if (request.battle() == null || request.battle().players == null || request.reconstruction() == null
                || request.reconstruction().participants() == null || request.reconstruction().events() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_AI_REQUEST");
        }
        if (!AiCancellationRegistry.isValidCorrelationId(request.correlationId())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_CORRELATION_ID");
        }
        final ReplayAnalysisScope scope;
        try {
            scope = BattleCategoryUtils.resolveScope(
                    BattleCategoryUtils.fromArenaBonusType(request.battle().arenaBonusType));
        } catch (final UnsupportedBattleCategoryException error) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT, "UNSUPPORTED_BATTLE_CATEGORY");
        }
        final AiReviewDonePayload.Capability capability = request.reconstruction().battleStartRawClockSec() == null
                || !request.limitations().isEmpty()
                ? AiReviewDonePayload.Capability.AVAILABLE_WITH_LIMITED_TIMELINE
                : AiReviewDonePayload.Capability.AVAILABLE;
        final AiCancellationToken cancellation = cancellations.register(request.correlationId());
        if (cancellation == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "DUPLICATE_CORRELATION_ID");
        }
        final PreparedAiReview prepared = new PreparedAiReview(request, scope, capability, cancellation);
        final SseEmitter emitter = new SseEmitter(SSE_TIMEOUT_MS);
        emitter.onTimeout(() -> cancellations.cancel(request.correlationId()));
        emitter.onError(error -> cancellations.cancel(request.correlationId()));
        try {
            workerExecutor.execute(() -> executionService.execute(prepared, emitter));
        } catch (final RejectedExecutionException error) {
            cancellations.unregister(request.correlationId(), cancellation);
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "AI_REVIEW_BUSY");
        }
        return emitter;
    }
}
