package com.wotb.web.creator.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "creator_settings")
public class CreatorSettings {
    @Id
    public Long id;
    @Column(name = "favorite_threshold")
    public Integer favoriteThreshold;
}
