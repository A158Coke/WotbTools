package com.wotb.web.sitefeedback.repository;

import com.wotb.web.sitefeedback.dto.SiteFeedbackCreated;
import com.wotb.web.sitefeedback.dto.SiteFeedbackListItem;
import com.wotb.web.sitefeedback.dto.SiteFeedbackPage;
import com.wotb.web.sitefeedback.dto.SiteFeedbackReason;
import com.wotb.web.sitefeedback.dto.SiteFeedbackRecord;
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
public class SiteFeedbackRepository {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private final JdbcTemplate jdbc;

    public SiteFeedbackRepository(final JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public SiteFeedbackCreated insert(final List<SiteFeedbackReason> reasons, final String feedback, final String pageView) {
        return jdbc.queryForObject("""
                INSERT INTO site_feedback (reason_codes, feedback_text, page_view)
                VALUES (CAST(? AS jsonb), ?, ?) RETURNING id, created_at
                """, (rs, row) -> new SiteFeedbackCreated(Long.toString(rs.getLong("id")),
                rs.getObject("created_at", OffsetDateTime.class).toInstant()),
                JSON.writeValueAsString(reasons), feedback, pageView);
    }

    public SiteFeedbackPage list(final int page, final int size, final SiteFeedbackReason reason) {
        final String filter = reason == null ? "" : " WHERE reason_codes @> CAST(? AS jsonb)";
        final Object[] args = reason == null ? new Object[0] : new Object[]{JSON.writeValueAsString(List.of(reason))};
        final Long count = jdbc.queryForObject("SELECT count(*) FROM site_feedback" + filter, Long.class, args);
        final var queryArgs = new ArrayList<>(List.of(args));
        queryArgs.add(size);
        queryArgs.add((long) page * size);
        final List<SiteFeedbackListItem> items = jdbc.query("SELECT id, reason_codes, feedback_text, page_view, created_at "
                + "FROM site_feedback" + filter + " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
                (rs, row) -> new SiteFeedbackListItem(Long.toString(rs.getLong("id")), reasons(rs),
                        rs.getString("feedback_text"), rs.getString("page_view"),
                        rs.getObject("created_at", OffsetDateTime.class).toInstant()), queryArgs.toArray());
        final long total = count == null ? 0 : count;
        return new SiteFeedbackPage(items, page, size, total, (total + size - 1) / size);
    }

    public Optional<SiteFeedbackRecord> find(final long id) {
        return jdbc.query("SELECT * FROM site_feedback WHERE id = ?", (rs, row) -> new SiteFeedbackRecord(
                Long.toString(rs.getLong("id")), reasons(rs), rs.getString("feedback_text"),
                rs.getString("page_view"), rs.getObject("created_at", OffsetDateTime.class).toInstant()),
                id).stream().findFirst();
    }

    public boolean delete(final long id) {
        return jdbc.update("DELETE FROM site_feedback WHERE id = ?", id) != 0;
    }

    private static List<SiteFeedbackReason> reasons(final ResultSet rs) throws SQLException {
        final var node = JSON.readTree(rs.getString("reason_codes"));
        final var result = new ArrayList<SiteFeedbackReason>();
        node.forEach(item -> result.add(SiteFeedbackReason.valueOf(item.asString())));
        return List.copyOf(result);
    }
}
