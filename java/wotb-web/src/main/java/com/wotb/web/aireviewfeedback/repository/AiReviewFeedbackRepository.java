package com.wotb.web.aireviewfeedback.repository;

import com.wotb.web.aireviewfeedback.dto.FeedbackCreated;
import com.wotb.web.aireviewfeedback.dto.FeedbackListItem;
import com.wotb.web.aireviewfeedback.dto.FeedbackPage;
import com.wotb.web.aireviewfeedback.dto.FeedbackReason;
import com.wotb.web.aireviewfeedback.dto.FeedbackRecord;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.json.JsonMapper;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Repository
public class AiReviewFeedbackRepository {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private final JdbcTemplate jdbc;

    public AiReviewFeedbackRepository(final JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public FeedbackCreated insert(final List<FeedbackReason> reasons, final String feedback,
            final String response, final String model) {
        return jdbc.queryForObject("""
                INSERT INTO ai_review_feedback (reason_codes, feedback_text, ai_response_text, model)
                VALUES (CAST(? AS jsonb), ?, ?, ?) RETURNING id, created_at
                """, (rs, row) -> new FeedbackCreated(Long.toString(rs.getLong("id")),
                rs.getObject("created_at", OffsetDateTime.class).toInstant()),
                JSON.writeValueAsString(reasons), feedback, response, model);
    }

    public FeedbackPage list(final int page, final int size, final FeedbackReason reason) {
        final String filter = reason == null ? "" : " WHERE reason_codes @> CAST(? AS jsonb)";
        final Object[] args = reason == null ? new Object[0] : new Object[]{JSON.writeValueAsString(List.of(reason))};
        final Long count = jdbc.queryForObject("SELECT count(*) FROM ai_review_feedback" + filter, Long.class, args);
        final var queryArgs = new ArrayList<>(List.of(args));
        queryArgs.add(size);
        queryArgs.add((long) page * size);
        final List<FeedbackListItem> items = jdbc.query("SELECT id, reason_codes, feedback_text, model, created_at "
                + "FROM ai_review_feedback" + filter + " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
                (rs, row) -> new FeedbackListItem(Long.toString(rs.getLong("id")), reasons(rs),
                        rs.getString("feedback_text"), rs.getString("model"),
                        rs.getObject("created_at", OffsetDateTime.class).toInstant()), queryArgs.toArray());
        final long total = count == null ? 0 : count;
        return new FeedbackPage(items, page, size, total, (total + size - 1) / size);
    }

    public Optional<FeedbackRecord> find(final long id) {
        return jdbc.query("SELECT * FROM ai_review_feedback WHERE id = ?", (rs, row) -> new FeedbackRecord(
                Long.toString(rs.getLong("id")), reasons(rs), rs.getString("feedback_text"),
                rs.getString("ai_response_text"), rs.getString("model"),
                rs.getObject("created_at", OffsetDateTime.class).toInstant()), id).stream().findFirst();
    }

    public boolean delete(final long id) {
        return jdbc.update("DELETE FROM ai_review_feedback WHERE id = ?", id) != 0;
    }

    private static List<FeedbackReason> reasons(final ResultSet rs) throws SQLException {
        final var node = JSON.readTree(rs.getString("reason_codes"));
        final var result = new ArrayList<FeedbackReason>();
        node.forEach(item -> result.add(FeedbackReason.valueOf(item.asString())));
        return List.copyOf(result);
    }
}
