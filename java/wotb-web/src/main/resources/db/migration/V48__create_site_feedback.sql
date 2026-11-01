CREATE TABLE site_feedback (
    id BIGSERIAL PRIMARY KEY,
    reason_codes JSONB NOT NULL,
    feedback_text TEXT,
    page_view VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX site_feedback_created_idx ON site_feedback (created_at DESC, id DESC);
