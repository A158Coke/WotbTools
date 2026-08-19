package com.wotb.web.boost.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;

/** 需求-打手分配记录（历史表）。与 Flyway V3 逐列对齐。 */
@Entity
@Table(name = "boost_request_assignment")
public class BoostRequestAssignment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "request_id", nullable = false)
    private Long requestId;

    @Column(name = "booster_id", nullable = false)
    private Long boosterId;

    @Column(name = "status", nullable = false, length = 32)
    private String status;

    @Column(name = "assigned_at", nullable = false)
    private OffsetDateTime assignedAt;

    @Column(name = "unassigned_at")
    private OffsetDateTime unassignedAt;

    @Column(name = "note", columnDefinition = "text")
    private String note;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    public BoostRequestAssignment() {
        // JPA
    }

    public Long getId() { return id; }
    public void setId(final Long id) { this.id = id; }

    public Long getRequestId() { return requestId; }
    public void setRequestId(final Long requestId) { this.requestId = requestId; }

    public Long getBoosterId() { return boosterId; }
    public void setBoosterId(final Long boosterId) { this.boosterId = boosterId; }

    public String getStatus() { return status; }
    public void setStatus(final String status) { this.status = status; }

    public OffsetDateTime getAssignedAt() { return assignedAt; }
    public void setAssignedAt(final OffsetDateTime assignedAt) { this.assignedAt = assignedAt; }

    public OffsetDateTime getUnassignedAt() { return unassignedAt; }
    public void setUnassignedAt(final OffsetDateTime unassignedAt) { this.unassignedAt = unassignedAt; }

    public String getNote() { return note; }
    public void setNote(final String note) { this.note = note; }

    public OffsetDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(final OffsetDateTime createdAt) { this.createdAt = createdAt; }

    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(final OffsetDateTime updatedAt) { this.updatedAt = updatedAt; }
}
