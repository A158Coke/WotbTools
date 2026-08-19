package com.wotb.core.replay.reconstruction;

/**
 * 战场中一辆车的状态。
 * <p>
 * 所有可空字段表示未知或未更新的值。
 * </p>
 */
public final class VehicleState {

    private final int entityId;

    private Long accountId;
    private Integer vehicleId;
    private Integer tankId;
    private Integer team;

    private Vector3 position;
    private Rotation rotation;
    private Vector3 positionError;

    private Integer currentHealth;
    private Integer maxHealth;

    private LifeState lifeState;
    private ObservationState observationState;

    private float firstObservedAt;
    private float lastObservedAt;
    private Float lastPositionAt;
    private Float removedAt;
    private Float destroyedAt;

    private int damageDealt;
    private int damageReceived;

    public VehicleState(int entityId, float firstObservedAt) {
        this.entityId = entityId;
        this.lifeState = LifeState.UNKNOWN;
        this.observationState = ObservationState.UNKNOWN;
        this.firstObservedAt = firstObservedAt;
        this.lastObservedAt = firstObservedAt;
    }

    // ---- Getters ----

    public int entityId() { return entityId; }
    public Long accountId() { return accountId; }
    public Integer vehicleId() { return vehicleId; }
    public Integer tankId() { return tankId; }
    public Integer team() { return team; }
    public Vector3 position() { return position; }
    public Rotation rotation() { return rotation; }
    public Vector3 positionError() { return positionError; }
    public Integer currentHealth() { return currentHealth; }
    public Integer maxHealth() { return maxHealth; }
    public LifeState lifeState() { return lifeState; }
    public ObservationState observationState() { return observationState; }
    public float firstObservedAt() { return firstObservedAt; }
    public float lastObservedAt() { return lastObservedAt; }
    public Float lastPositionAt() { return lastPositionAt; }
    public Float removedAt() { return removedAt; }
    public Float destroyedAt() { return destroyedAt; }
    public int damageDealt() { return damageDealt; }
    public int damageReceived() { return damageReceived; }

    // ---- Setters (package-private for reconstructor) ----

    public void setAccountId(Long accountId) { this.accountId = accountId; }
    public void setVehicleId(Integer vehicleId) { this.vehicleId = vehicleId; }
    public void setTankId(Integer tankId) { this.tankId = tankId; }
    public void setTeam(Integer team) { this.team = team; }

    public void setPosition(Vector3 position) {
        this.position = position;
        this.lastPositionAt = lastObservedAt;
    }

    public void setRotation(Rotation rotation) { this.rotation = rotation; }
    public void setPositionError(Vector3 positionError) { this.positionError = positionError; }

    public void setCurrentHealth(Integer currentHealth) {
        this.currentHealth = currentHealth;
        if (currentHealth != null && currentHealth > 0 && lifeState == LifeState.UNKNOWN) {
            this.lifeState = LifeState.ALIVE;
        }
    }

    public void setMaxHealth(Integer maxHealth) { this.maxHealth = maxHealth; }

    public void setLifeState(LifeState lifeState) {
        this.lifeState = lifeState;
        if (lifeState == LifeState.DESTROYED) {
            this.destroyedAt = lastObservedAt;
        }
    }

    public void setObservationState(ObservationState observationState) {
        this.observationState = observationState;
    }

    public void setLastObservedAt(float lastObservedAt) {
        this.lastObservedAt = lastObservedAt;
    }

    public void setRemovedAt(Float removedAt) {
        this.removedAt = removedAt;
        this.observationState = ObservationState.REMOVED;
    }

    public void addDamageDealt(int damage) { this.damageDealt += damage; }
    public void addDamageReceived(int damage) { this.damageReceived += damage; }

    /**
     * 创建此状态的深度拷贝。
     */
    public VehicleState copy() {
        final VehicleState copy = new VehicleState(entityId, firstObservedAt);
        copy.accountId = this.accountId;
        copy.vehicleId = this.vehicleId;
        copy.tankId = this.tankId;
        copy.team = this.team;
        copy.position = this.position;
        copy.rotation = this.rotation;
        copy.positionError = this.positionError;
        copy.currentHealth = this.currentHealth;
        copy.maxHealth = this.maxHealth;
        copy.lifeState = this.lifeState;
        copy.observationState = this.observationState;
        copy.firstObservedAt = this.firstObservedAt;
        copy.lastObservedAt = this.lastObservedAt;
        copy.lastPositionAt = this.lastPositionAt;
        copy.removedAt = this.removedAt;
        copy.destroyedAt = this.destroyedAt;
        copy.damageDealt = this.damageDealt;
        copy.damageReceived = this.damageReceived;
        return copy;
    }
}
