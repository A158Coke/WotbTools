package com.wotb.ai.review.service;

import com.wotb.ai.gateway.AiCancellationToken;
import com.wotb.ai.review.AiReviewDonePayload;
import com.wotb.ai.review.AiReviewRequest;
import com.wotb.core.replay.processing.ReplayAnalysisScope;

record PreparedAiReview(AiReviewRequest request, ReplayAnalysisScope scope,
                        AiReviewDonePayload.Capability capability, AiCancellationToken cancellation) {
}
