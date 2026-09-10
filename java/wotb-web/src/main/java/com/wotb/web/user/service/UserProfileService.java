package com.wotb.web.user.service;

import com.wotb.web.user.dto.UserProfileDto;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.repository.UserProfileRepository;
import com.wotb.web.util.ConstraintViolations;
import com.wotb.web.util.JwtUtil;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/** 用户资料服务。创建/查询分离，username 和 displayName 来自 Keycloak 不可修改。 */
@Service
public class UserProfileService {

    /** WG Provider 支持的区服（与 Keycloak {@code WargamingRegion} 枚举一致）。 */
    private static final Set<String> WG_REGIONS = Set.of("ASIA", "EU", "NA");

    /** {@code (wotb_server, wotb_account_id)} 唯一约束：该 WotB 账号已属于其他用户。 */
    private static final String UK_WOTB_ACCOUNT = "uk_user_profile_wotb_account";

    private final UserProfileRepository repository;
    private final UserProfileMapper mapper;

    public UserProfileService(final UserProfileRepository repository, final UserProfileMapper mapper) {
        this.repository = repository;
        this.mapper = mapper;
    }

    /** 查询用户资料，不存在则返回 empty。 */
    @Transactional(readOnly = true)
    public Optional<UserProfileDto> findByKeycloakUserId(final String keycloakUserId) {
        return repository.findByKeycloakUserId(keycloakUserId).map(mapper::toDto);
    }

    /**
     * 当前登录用户绑定的 canonical WotB 业务身份 {@code (区服, 账号)}；
     * profile 不存在或未绑定账号 → empty。
     *
     * <p>这是 HoF 等业务域解析 ownership 的唯一入口，避免各域各写一份「解析当前绑定账号」的规则。</p>
     */
    @Transactional(readOnly = true)
    public Optional<WotbAccountIdentity> currentWotbIdentity(final String keycloakUserId) {
        return repository.findByKeycloakUserId(keycloakUserId)
                .map(profile -> profile.getWotbAccountId() == null || profile.getWotbAccountId() <= 0
                        ? null
                        : new WotbAccountIdentity(profile.getWotbServer(), profile.getWotbAccountId()));
    }

    /** 供其他业务域编排使用的内部实体查询。 */
    @Transactional(readOnly = true)
    public Optional<UserProfile> findEntityByKeycloakUserId(final String keycloakUserId) {
        return repository.findByKeycloakUserId(keycloakUserId);
    }

    /** 当前 JWT 是否为可用于 WG 资料同步的可信 ASIA/EU/NA 身份。 */
    public boolean hasTrustedWargamingIdentity() {
        return trustedWgRegionOrNull() != null;
    }

    /** 供跨域写操作串行化用户删除、打手创建与换绑。 */
    @Transactional
    public Optional<UserProfile> findEntityByKeycloakUserIdForUpdate(final String keycloakUserId) {
        return repository.findByKeycloakUserIdForUpdate(keycloakUserId);
    }

    /**
     * 管理端用户分页检索，Repository 保持封装在 user 域内。
     * 返回 {@link Page} 以便调用方拿到权威 totalElements/totalPages，不做内存伪造分页。
     */
    @Transactional(readOnly = true)
    public Page<UserProfile> searchForAdministration(final String query, final Pageable pageable) {
        return StringUtils.hasText(query)
                ? repository.searchAdminUsers(query.trim(), pageable)
                : repository.findAll(pageable);
    }

    /** 按 Keycloak sub 批量取本地资料；跨域编排（admin）用，禁止逐用户查询。 */
    @Transactional(readOnly = true)
    public List<UserProfile> findByKeycloakUserIdIn(final Collection<String> keycloakUserIds) {
        if (keycloakUserIds == null || keycloakUserIds.isEmpty()) {
            return List.of();
        }
        return repository.findByKeycloakUserIdIn(keycloakUserIds);
    }

    /** 管理端删除入口；flush 让约束异常在调用方补偿范围内暴露。 */
    @Transactional
    public void deleteForAdministration(final UserProfile profile) {
        repository.delete(profile);
        repository.flush();
    }

    /**
     * 幂等的「确保当前用户存在业务资料」（account bootstrap 的唯一入口）。
     *
     * <p>语义是 <em>ensure</em>，不是 create：</p>
     * <ul>
     *   <li>已有 profile → 原样返回，<strong>不修改任何业务绑定</strong>
     *       （{@code wotb_server} / {@code wotb_account_id} / {@code wotb_nickname} /
     *       {@code wotb_account_source} / {@code wotb_account_verified_at} 全部保持）。</li>
     *   <li>没有 profile → 按 {@link #newProfile} 的 canonical provisioning 语义创建
     *       （可信 WG claims → 对应区服 + {@code WARGAMING}；否则 → {@code CN} + {@code MANUAL}）。</li>
     * </ul>
     *
     * <p><strong>刻意不加外层 {@code @Transactional}</strong>：两个并发 ensure 的败者会在
     * {@code keycloak_user_id} 唯一约束上失败，而 PostgreSQL 会把该事务标记为 aborted
     * （后续任何语句都报 25P02）。只有让「插入」与「冲突后重读」落在各自独立的短事务里
     * （{@code saveAndFlush} 与派生查询各自持有自己的事务），败者才能读到胜者已提交的 profile
     * 并幂等成功——这正是「1 个 KC sub 恰好 1 条 profile，两个调用方都成功」的实现方式。
     * 若在这里加上 {@code @Transactional}，冲突会污染唯一的事务，败者将无法完成重读。</p>
     */
    public UserProfileDto ensureCurrentProfile(final String keycloakUserId,
                                               final String username,
                                               final String displayName) {
        final Optional<UserProfile> existing = repository.findByKeycloakUserId(keycloakUserId);
        return existing.isPresent()
                ? mapper.toDto(existing.get())
                : provision(keycloakUserId, username, displayName);
    }

    /**
     * canonical profile creation：唯一的「首次创建业务资料」实现，ensure 与
     * {@link #syncFromLogin} 共用，禁止各自再写一份 CN 默认 / 可信 WG 判定。
     */
    private static UserProfile newProfile(final String keycloakUserId,
                                          final String username,
                                          final String displayName) {
        final UserProfile profile = new UserProfile();
        profile.setKeycloakUserId(keycloakUserId);
        profile.setUsername(username);
        profile.setDisplayName(displayName);
        final String trustedRegion = trustedWgRegionOrNull();
        if (trustedRegion != null) {
            // WG 用户（ASIA/EU/NA）：首次创建即写入官方资料，来源 WARGAMING、验证时间=首次可信同步时间。
            profile.setWotbServer(trustedRegion);
            profile.setWotbAccountId(JwtUtil.currentWotbAccountId());
            profile.setWotbNickname(JwtUtil.currentWotbNickname());
            profile.setWotbAccountSource("WARGAMING");
            profile.setWotbAccountVerifiedAt(OffsetDateTime.now());
        } else {
            profile.setWotbServer("CN");
            profile.setWotbAccountSource("MANUAL");
        }
        profile.setUpdatedAt(OffsetDateTime.now());
        return profile;
    }

    /**
     * 插入 canonical profile，冲突时按<strong>重读优先</strong>判别成因。
     *
     * <p>「不要把真实身份冲突吞成幂等成功」的落点，判定顺序刻意是先看事实、再看约束名：</p>
     * <ol>
     *   <li><strong>重读优先</strong>：该 sub 已经有 profile ⇒ 这次冲突只可能是「同一 Keycloak sub
     *       被并发创建」的败者路径，直接幂等返回胜者。这条判定只看数据库事实，**不依赖** PostgreSQL
     *       自动生成的约束名字符串，因此即使约束名与预期不同也不会把并发收敛误报成业务冲突。</li>
     *   <li>该 sub 仍然不存在 ⇒ 不是并发收敛路径，此时才按约束名判定：
     *       {@code (wotb_server, wotb_account_id)} 冲突 = 该 WotB 账号已属于别人 →
     *       保持 canonical {@code WOTB_ACCOUNT_ALREADY_USED}，绝不返回他人的 profile，
     *       也绝不写入被抢走的绑定。</li>
     *   <li>其余完整性冲突（CHECK / NOT NULL / 值超长 / 将来的新约束）不得伪装成业务冲突，
     *       按服务端不变量问题上报 {@code PROFILE_BOOTSTRAP_FAILED}。</li>
     * </ol>
     */
    private UserProfileDto provision(final String keycloakUserId,
                                     final String username,
                                     final String displayName) {
        final UserProfile profile = newProfile(keycloakUserId, username, displayName);
        try {
            // saveAndFlush：让约束冲突在本方法内、该语句自己的事务回滚之后暴露，而不是拖到外层提交点。
            return mapper.toDto(repository.saveAndFlush(profile));
        } catch (final DataIntegrityViolationException e) {
            // 1) 重读优先：读到胜者即收敛，不需要也不依赖约束名。
            final Optional<UserProfile> concurrent = repository.findByKeycloakUserId(keycloakUserId);
            if (concurrent.isPresent()) {
                return mapper.toDto(concurrent.get());
            }
            // 2) 该 sub 仍不存在：只有确实是 WotB 账号占用才是业务冲突。
            if (ConstraintViolations.causedByConstraint(e, UK_WOTB_ACCOUNT)) {
                throw new IllegalArgumentException("WOTB_ACCOUNT_ALREADY_USED", e);
            }
            // 3) 其余完整性冲突是服务端问题，不得伪装成 409 业务冲突。
            throw new IllegalStateException("PROFILE_BOOTSTRAP_FAILED", e);
        }
    }

    /**
     * 幂等同步接口：仅 WG 可信 claims（ASIA/EU/NA）可调用。
     * Profile 不存在时创建 WARGAMING Profile；空 Profile（未绑定任何账号）升级为
     * WARGAMING；已绑定同 (region, account_id) 时幂等刷新官方昵称（不刷新 verified_at）；
     * 已绑定其他账号（MANUAL 或跨区服/跨账号）返回 409；账号被他人占用返回 409。
     */
    @Transactional
    public UserProfileDto syncFromLogin(final String keycloakUserId) {
        final String trustedRegion = trustedWgRegionOrNull();
        if (trustedRegion == null) {
            throw new IllegalArgumentException("WOTB_CLAIMS_INVALID");
        }
        final Long accountId = JwtUtil.currentWotbAccountId();
        final String nickname = JwtUtil.currentWotbNickname();

        final boolean duplicate = repository.existsByWotbServerAndWotbAccountIdAndKeycloakUserIdNot(
                trustedRegion, accountId, keycloakUserId);
        if (duplicate) {
            throw new IllegalArgumentException("WOTB_ACCOUNT_ALREADY_USED");
        }

        try {
            final UserProfile profile = repository.findByKeycloakUserId(keycloakUserId)
                    .orElse(null);
            if (profile == null) {
                // Profile 不存在：原子创建 WARGAMING Profile（与 ensure 共用同一 canonical 语义）。
                final UserProfile created = newProfile(
                        keycloakUserId, JwtUtil.currentUsername(), JwtUtil.currentDisplayName());
                return mapper.toDto(repository.save(created));
            }
            if (profile.getWotbAccountId() == null) {
                // 空 Profile（尚未绑定任何账号）：升级为 WARGAMING。
                profile.setWotbServer(trustedRegion);
                profile.setWotbAccountId(accountId);
                profile.setWotbNickname(nickname);
                profile.setWotbAccountSource("WARGAMING");
                profile.setWotbAccountVerifiedAt(OffsetDateTime.now());
            } else {
                // 已绑定账号：必须同 source/region/account_id，否则明确冲突。
                if (!"WARGAMING".equals(profile.getWotbAccountSource())
                        || !trustedRegion.equals(profile.getWotbServer())) {
                    throw new IllegalArgumentException("PROFILE_REGION_MISMATCH");
                }
                if (!accountId.equals(profile.getWotbAccountId())) {
                    throw new IllegalArgumentException("WOTB_ACCOUNT_MISMATCH");
                }
                if (!nickname.equals(profile.getWotbNickname())) {
                    profile.setWotbNickname(nickname);
                    // 决策 D8：昵称刷新不更新 verified_at。
                }
            }
            profile.setUpdatedAt(OffsetDateTime.now());
            return mapper.toDto(repository.save(profile));
        } catch (final DataIntegrityViolationException e) {
            // 并发窗口内 (region, account_id) 被其他用户占用：与手动绑定同一错误码。
            throw new IllegalArgumentException("WOTB_ACCOUNT_ALREADY_USED");
        }
    }

    /** 更新坦克世界账号绑定。 */
    @Transactional
    public UserProfileDto updateWotbAccount(final String keycloakUserId,
                                            final Long wotbAccountId,
                                            final String wotbNickname,
                                            final String wotbServer) {
        final UserProfile profile = repository.findByKeycloakUserId(keycloakUserId)
                .orElseThrow(() -> new IllegalArgumentException("PROFILE_NOT_FOUND"));

        // 最终保护：JWT 明确是 WG 身份时（即使 DB 同步异常仍为空/MANUAL）也禁止 MANUAL 绑定。
        if (trustedWgRegionOrNull() != null
                || "WARGAMING".equals(profile.getWotbAccountSource())) {
            throw new IllegalArgumentException(readOnlyErrorCode(profile.getWotbServer()));
        }
        if (wotbAccountId == null || wotbAccountId <= 0) {
            throw new IllegalArgumentException("INVALID_WOTB_ACCOUNT_ID");
        }
        final String server = wotbServer != null ? wotbServer.toUpperCase() : "CN";
        if (!"CN".equals(server)) {
            throw new IllegalArgumentException("UNSUPPORTED_WOTB_SERVER");
        }
        if (wotbNickname != null && wotbNickname.length() > 64) {
            throw new IllegalArgumentException("INVALID_WOTB_ACCOUNT_ID");
        }

        final boolean duplicate = repository.existsByWotbServerAndWotbAccountIdAndKeycloakUserIdNot(
                server, wotbAccountId, keycloakUserId);
        if (duplicate) {
            throw new IllegalArgumentException("WOTB_ACCOUNT_ALREADY_USED");
        }

        profile.setWotbAccountId(wotbAccountId);
        profile.setWotbNickname(wotbNickname);
        profile.setWotbServer(server);
        profile.setUpdatedAt(OffsetDateTime.now());

        try {
            return mapper.toDto(repository.save(profile));
        } catch (final DataIntegrityViolationException e) {
            throw new IllegalArgumentException("WOTB_ACCOUNT_ALREADY_USED");
        }
    }

    /** 清空坦克世界账号绑定。 */
    @Transactional
    public UserProfileDto deleteWotbAccount(final String keycloakUserId) {
        final UserProfile profile = repository.findByKeycloakUserId(keycloakUserId)
                .orElseThrow(() -> new IllegalArgumentException("PROFILE_NOT_FOUND"));

        // 最终保护：JWT 明确是 WG 身份时禁止解绑（与手动绑定同一规则）。
        if (trustedWgRegionOrNull() != null
                || "WARGAMING".equals(profile.getWotbAccountSource())) {
            throw new IllegalArgumentException(readOnlyErrorCode(profile.getWotbServer()));
        }
        profile.setWotbAccountId(null);
        profile.setWotbNickname(null);
        profile.setWotbServer("CN");
        profile.setUpdatedAt(OffsetDateTime.now());
        return mapper.toDto(repository.save(profile));
    }

    /** 可信 WG claims：verified == true && region ∈ {ASIA, EU, NA} && accountId 有效 && 昵称非空。 */
    private static String trustedWgRegionOrNull() {
        final String region = JwtUtil.currentWotbRegion();
        final Long accountId = JwtUtil.currentWotbAccountId();
        final String nickname = JwtUtil.currentWotbNickname();
        if (!JwtUtil.currentWotbVerified() || region == null || !WG_REGIONS.contains(region)) {
            return null;
        }
        return accountId != null && StringUtils.hasText(nickname) ? region : null;
    }

    /** ASIA 沿用既有错误码（前端已消费）；EU/NA 使用泛化错误码。 */
    private static String readOnlyErrorCode(final String server) {
        return "ASIA".equals(server) ? "ASIA_PROFILE_READONLY" : "WARGAMING_PROFILE_READONLY";
    }

}
