package com.wotb.web.boost.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;

/** 打手档案。与 Flyway V3 逐列对齐。 */
@Entity
@Table(name = "booster_profile")
public class BoosterProfile {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "nickname", nullable = false, length = 100)
    private String nickname;

    @Column(name = "level", nullable = false, length = 32)
    private String level;

    @Column(name = "available", nullable = false)
    private Boolean available;

    @Column(name = "status", nullable = false, length = 32)
    private String status;

    @Column(name = "contact_type", length = 32)
    private String contactType;

    @Column(name = "contact_value", length = 255)
    private String contactValue;

    @Column(name = "specialties", columnDefinition = "text")
    private String specialties;

    @Column(name = "description", columnDefinition = "text")
    private String description;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    public BoosterProfile() {
        // JPA
    }

    public Long getId() { return id; }
    public void setId(final Long id) { this.id = id; }

    public String getNickname() { return nickname; }
    public void setNickname(final String nickname) { this.nickname = nickname; }

    public String getLevel() { return level; }
    public void setLevel(final String level) { this.level = level; }

    public Boolean getAvailable() { return available; }
    public void setAvailable(final Boolean available) { this.available = available; }

    public String getStatus() { return status; }
    public void setStatus(final String status) { this.status = status; }

    public String getContactType() { return contactType; }
    public void setContactType(final String contactType) { this.contactType = contactType; }

    public String getContactValue() { return contactValue; }
    public void setContactValue(final String contactValue) { this.contactValue = contactValue; }

    public String getSpecialties() { return specialties; }
    public void setSpecialties(final String specialties) { this.specialties = specialties; }

    public String getDescription() { return description; }
    public void setDescription(final String description) { this.description = description; }

    public OffsetDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(final OffsetDateTime createdAt) { this.createdAt = createdAt; }

    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(final OffsetDateTime updatedAt) { this.updatedAt = updatedAt; }
}
