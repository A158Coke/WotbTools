package com.wotb.web.util;

public interface Mapper<E, D> {
    D toDto(E entity);
}
