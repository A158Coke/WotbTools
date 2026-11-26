package com.wotb.web.hof.repository;

import com.wotb.web.hof.entity.HallOfFameRecord;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

public interface HallOfFameRecordRepository extends JpaRepository<HallOfFameRecord, Long> {

    Optional<HallOfFameRecord> findByArenaIdAndAccountId(String arenaId, long accountId);

    @Modifying
    @Transactional
    @Query("""
            update HallOfFameRecord r
            set r.replayHash = :hash,
                r.replayFileName = :fileName,
                r.replaySize = :size,
                r.replayUploadedBy = :uploadedBy
            where r.id = :id and r.replayHash is null
            """)
    int attachReplayMetadata(@Param("id") long id,
                             @Param("hash") String hash,
                             @Param("fileName") String fileName,
                             @Param("size") long size,
                             @Param("uploadedBy") String uploadedBy);

    @Query("""
            select r from HallOfFameRecord r
            where (:battleType is null or r.battleType = :battleType)
              and (:tankId is null or r.tankId = :tankId)
              and (:nickname is null or lower(r.nickname) like :nickname)
            order by r.damageDealt desc,
                     case r.battleType when 'RATING' then 0 else 1 end asc,
                     r.battleTime asc nulls last,
                     r.createdAt asc,
                     r.id asc
            """)
    Page<HallOfFameRecord> search(@Param("battleType") String battleType,
                                  @Param("tankId") Long tankId,
                                  @Param("nickname") String nicknamePattern,
                                  Pageable pageable);

    @Query("""
            select r from HallOfFameRecord r
            where (:battleType is null or r.battleType = :battleType)
              and (:tankId is null or r.tankId = :tankId)
              and r.tankId in :vehicleIds
              and (:nickname is null or lower(r.nickname) like :nickname)
            order by r.damageDealt desc,
                     case r.battleType when 'RATING' then 0 else 1 end asc,
                     r.battleTime asc nulls last,
                     r.createdAt asc,
                     r.id asc
            """)
    Page<HallOfFameRecord> searchByVehicleIds(@Param("battleType") String battleType,
                                              @Param("tankId") Long tankId,
                                              @Param("vehicleIds") List<Long> vehicleIds,
                                              @Param("nickname") String nicknamePattern,
                                              Pageable pageable);

    @Query("""
            select r from HallOfFameRecord r
            where (:nickname is null or lower(r.nickname) like :nickname)
              and (:accountId is null or r.accountId = :accountId)
              and (:uploadedBy is null or r.replayUploadedBy = :uploadedBy)
              and (:battleType is null or r.battleType = :battleType)
              and (:tankId is null or r.tankId = :tankId)
              and (:replayAvailable is null
                   or (:replayAvailable = true and r.replayHash is not null)
                   or (:replayAvailable = false and r.replayHash is null))
            """)
    Page<HallOfFameRecord> adminSearch(@Param("nickname") String nickname,
                                       @Param("accountId") Long accountId,
                                       @Param("uploadedBy") String uploadedBy,
                                       @Param("battleType") String battleType,
                                       @Param("tankId") Long tankId,
                                       @Param("replayAvailable") Boolean replayAvailable,
                                       Pageable pageable);

    @Query("""
            select r from HallOfFameRecord r
            where (:nickname is null or lower(r.nickname) like :nickname)
              and (:accountId is null or r.accountId = :accountId)
              and (:uploadedBy is null or r.replayUploadedBy = :uploadedBy)
              and (:battleType is null or r.battleType = :battleType)
              and (:tankId is null or r.tankId = :tankId)
              and r.tankId in :vehicleIds
              and (:replayAvailable is null
                   or (:replayAvailable = true and r.replayHash is not null)
                   or (:replayAvailable = false and r.replayHash is null))
            """)
    Page<HallOfFameRecord> adminSearchByVehicleIds(@Param("nickname") String nickname,
                                                   @Param("accountId") Long accountId,
                                                   @Param("uploadedBy") String uploadedBy,
                                                   @Param("battleType") String battleType,
                                                   @Param("tankId") Long tankId,
                                                   @Param("vehicleIds") List<Long> vehicleIds,
                                                   @Param("replayAvailable") Boolean replayAvailable,
                                                   Pageable pageable);

    @Query("""
            select r.tankId as tankId, min(r.tankName) as tankName
            from HallOfFameRecord r
            group by r.tankId
            order by min(r.tankName), r.tankId
            """)
    List<HofVehicleProjection> findVehicleOptions();

    long countByReplayHash(String replayHash);

    List<HallOfFameRecord> findByAccountIdOrderByDamageDealtDesc(long accountId, Pageable pageable);
}
