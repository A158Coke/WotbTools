ALTER TABLE site_feedback
    ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
        CONSTRAINT site_feedback_status_check CHECK (status IN ('PENDING', 'FIXED'));

ALTER TABLE ai_review_feedback
    ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
        CONSTRAINT ai_review_feedback_status_check CHECK (status IN ('PENDING', 'FIXED'));
