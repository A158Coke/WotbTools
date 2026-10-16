package com.wotb.web.creator.entity;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** One durable lock anchor, including when all editable dictionaries are empty. */
@Entity
@Table(name = "creator_catalog_lock")
public class CreatorCatalogLock {
    @Id
    public Long id;
}
