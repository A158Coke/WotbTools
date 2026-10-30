CREATE TABLE ai_review_feedback (
    id BIGSERIAL PRIMARY KEY,
    reason_codes JSONB NOT NULL,
    feedback_text TEXT,
    ai_response_text TEXT NOT NULL,
    model VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ai_review_feedback_created_idx ON ai_review_feedback (created_at DESC, id DESC);
