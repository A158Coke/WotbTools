package com.wotb.web.tournament.repository;
import com.wotb.web.tournament.entity.TournamentAudit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import java.util.List;
import java.util.Optional;

public interface TournamentAuditRepository extends JpaRepository<TournamentAudit, Long> {
    @Query("select new com.wotb.web.tournament.entity.TournamentAudit$Metadata(a.id, a.action, a.actor, a.reason, a.roundNumber, a.dayNumber, a.createdAt) from TournamentAudit a where a.eventId = :eventId order by a.id desc")
    List<TournamentAudit.Metadata> findMetadataByEventId(long eventId);
    @Query(value = """
            select distinct reference.value #>> '{}'
            from tournament_audit audit
            cross join lateral jsonb_path_query(
                case when audit.action = 'CSV_IMPORTED'
                     then coalesce(audit.before_state -> 'publishedDays', '[]'::jsonb)
                     else jsonb_build_array(audit.before_state, audit.after_state) end,
                '$.**.evidenceId ? (@.type() == "string")'
            ) as reference(value)
            where audit.event_id = :eventId
            """, nativeQuery = true)
    List<String> findEvidenceIdsByEventId(long eventId);
    @Query(value = "select * from tournament_audit where event_id = :eventId and action = 'CSV_IMPORTED' and after_state ->> 'idempotencyKey' = :key order by id desc limit 1", nativeQuery = true)
    Optional<TournamentAudit> findCsvImport(long eventId, String key);
    void deleteByEventId(long eventId);
}
