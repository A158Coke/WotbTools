# WotBTools 后端测试框架建议

## 目标

为 WotBTools 后端建立一套稳定、通用、适合 Spring Boot / Java 项目的测试框架。

当前项目主语言是 Java，因此测试主线不使用 Spock/Groovy，而是采用 Java 生态最通用的组合：

```text
JUnit 5
Mockito
AssertJ
Spring Boot Test
MockMvc
Testcontainers PostgreSQL
```

目标不是一次写完所有测试，而是先建立清晰结构，后续功能都按这个模式补测试。

---

## 推荐测试技术栈

### 1. JUnit 5

作为主测试框架。

用于：

```text
普通单元测试
Service 测试
Controller 测试
Repository 测试
集成测试
```

常用注解：

```java
@Test
@BeforeEach
@AfterEach
@Nested
@DisplayName
@ParameterizedTest
@ValueSource
@CsvSource
@ExtendWith(MockitoExtension.class)
```

---

### 2. AssertJ

作为断言库。

不要优先使用 JUnit 自带的 `assertEquals` / `assertTrue`。

推荐：

```java
assertThat(result.status()).isEqualTo("NEW");
assertThat(result.id()).isNotNull();
assertThatThrownBy(() -> service.create(request))
    .isInstanceOf(IllegalArgumentException.class)
    .hasMessageContaining("当前仅支持国服");
```

AssertJ 可读性更好，适合复杂对象、集合、异常断言。

---

### 3. Mockito

用于 mock service 层依赖。

适合：

```text
Service 单元测试
KeycloakAdminUserService mock
Repository mock
外部 API mock
```

常用写法：

```java
@ExtendWith(MockitoExtension.class)
class BoosterServiceTest {

    @Mock
    BoosterProfileRepository boosterRepository;

    @Mock
    KeycloakAdminUserService keycloakAdminUserService;

    @InjectMocks
    BoosterService boosterService;

    @Test
    void shouldDeactivateBoosterWhenKeycloakRoleRemoved() {
        // given

        // when

        // then
    }
}
```

常用 API：

```java
when(...).thenReturn(...);
doThrow(...).when(mock).method(...);
verify(mock).method(...);
verify(mock, never()).method(...);
verifyNoMoreInteractions(mock);
```

---

### 4. Spring Boot Test

用于加载 Spring 上下文的测试。

使用场景：

```text
Controller API 测试
Security 测试
Spring bean wiring 测试
完整应用集成测试
```

常用注解：

```java
@WebMvcTest
@SpringBootTest
@AutoConfigureMockMvc
@DataJpaTest
@ActiveProfiles("test")
```

---

### 5. MockMvc

用于测试 HTTP API。

适合测试：

```text
Controller endpoint
request body validation
HTTP status
JSON response
权限 401 / 403
```

示例：

```java
mockMvc.perform(post("/api/boost/requests")
        .contentType(MediaType.APPLICATION_JSON)
        .content(json))
    .andExpect(status().isCreated())
    .andExpect(jsonPath("$.status").value("NEW"));
```

---

### 6. Testcontainers PostgreSQL

用于真实 PostgreSQL 集成测试。

必须用于测试这些内容：

```text
Flyway migration
JPA mapping
PostgreSQL-only feature
partial unique index
数据库约束
事务行为
```

特别是这个约束必须用 PostgreSQL 测：

```sql
create unique index uq_boost_request_active_assignment
on boost_request_assignment(request_id)
where unassigned_at is null;
```

H2 不可靠，不要用 H2 替代 PostgreSQL 测核心数据库行为。

---

## Maven 依赖建议

检查 `java/wotb-web/pom.xml` 或父 pom 是否已有以下 test dependencies。

如果缺少，补充：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-test</artifactId>
    <scope>test</scope>
</dependency>

<dependency>
    <groupId>org.mockito</groupId>
    <artifactId>mockito-junit-jupiter</artifactId>
    <scope>test</scope>
</dependency>

<dependency>
    <groupId>org.assertj</groupId>
    <artifactId>assertj-core</artifactId>
    <scope>test</scope>
</dependency>

<dependency>
    <groupId>org.testcontainers</groupId>
    <artifactId>junit-jupiter</artifactId>
    <scope>test</scope>
</dependency>

<dependency>
    <groupId>org.testcontainers</groupId>
    <artifactId>postgresql</artifactId>
    <scope>test</scope>
</dependency>
```

如果 `spring-boot-starter-test` 已经包含 JUnit 5 / Mockito / AssertJ，则不要重复添加不必要版本。

优先遵循 Spring Boot dependency management，不要手动乱指定版本。

---

## 测试目录结构

标准 Maven 目录：

```text
java/wotb-web/src/test/java
java/wotb-web/src/test/resources
```

建议按功能包组织：

```text
java/wotb-web/src/test/java/com/wotb/web/boost
java/wotb-web/src/test/java/com/wotb/web/leaderboard
java/wotb-web/src/test/java/com/wotb/web/replay
java/wotb-web/src/test/java/com/wotb/web/security
```

Boost 模块建议：

```text
com.wotb.web.boost.service
  BoostRequestServiceTest
  BoosterServiceTest
  BoostAssignmentServiceTest

com.wotb.web.boost.controller
  BoostRequestControllerTest
  AdminBoostRequestControllerTest
  AdminBoosterControllerTest

com.wotb.web.boost.repository
  BoostRequestRepositoryTest
  BoostAssignmentRepositoryTest

com.wotb.web.boost.integration
  BoostDatabaseIntegrationTest
```

---

## 测试分层策略

### 1. Service 单元测试

使用：

```text
JUnit 5 + Mockito + AssertJ
```

不启动 Spring。

特点：

```text
快
稳定
适合业务逻辑
适合 mock Keycloak
适合验证事务前后的行为意图
```

示例：

```java
@ExtendWith(MockitoExtension.class)
class BoostRequestServiceTest {

    @Mock
    BoostRequestRepository boostRequestRepository;

    @InjectMocks
    BoostRequestService boostRequestService;

    @Test
    void shouldCreateRequestWithNewStatus() {
        // given
        var request = new CreateBoostRequestRequest(
            123456789L,
            "Coke_158",
            "CN",
            "COACHING",
            "想找人指导中坦走位和残局处理。",
            "可商量",
            "QQ",
            "123456789",
            "中国时间晚上 20:00-23:00",
            null
        );

        when(boostRequestRepository.save(any()))
            .thenAnswer(invocation -> invocation.getArgument(0));

        // when
        var result = boostRequestService.create(request);

        // then
        assertThat(result.status()).isEqualTo("NEW");
        verify(boostRequestRepository).save(any());
    }
}
```

---

### 2. Controller 测试

使用：

```text
@WebMvcTest
MockMvc
Mockito mocked service
```

适合测试：

```text
HTTP method/path 是否正确
JSON request/response
validation error
401 / 403
controller 层权限
```

示例：

```java
@WebMvcTest(BoostRequestController.class)
class BoostRequestControllerTest {

    @Autowired
    MockMvc mockMvc;

    @MockBean
    BoostRequestService boostRequestService;

    @Test
    void shouldCreateBoostRequest() throws Exception {
        var json = """
            {
              "playerAccountId": 123456789,
              "playerNickname": "Coke_158",
              "region": "CN",
              "requestType": "COACHING",
              "targetDescription": "想找人指导中坦走位和残局处理。",
              "contactType": "QQ",
              "contactValue": "123456789"
            }
            """;

        when(boostRequestService.create(any()))
            .thenReturn(new CreateBoostRequestResponse(
                42L,
                "NEW",
                "需求已提交，管理员会人工审核并联系你。",
                OffsetDateTime.now()
            ));

        mockMvc.perform(post("/api/boost/requests")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value(42))
            .andExpect(jsonPath("$.status").value("NEW"));
    }
}
```

如果 security 配置导致测试复杂，可以先针对 service 写足测试，再补 controller/security 测试。

---

### 3. Repository / DB 测试

使用：

```text
@DataJpaTest
Testcontainers PostgreSQL
Flyway
```

适合测试：

```text
表结构
JPA mapping
Repository query
unique index
foreign key
partial unique index
```

推荐不要用 H2。

示例目标：

```text
同一个 boost_request 不能有两个 active assignment
unassigned_at 不为空后可以重新 assign
```

测试逻辑：

```java
@Test
void shouldRejectTwoActiveAssignmentsForSameRequest() {
    // given
    // insert boost_request
    // insert booster_profile
    // insert active assignment

    // when / then
    assertThatThrownBy(() -> insertSecondActiveAssignment())
        .isInstanceOf(DataIntegrityViolationException.class);
}
```

---

### 4. Full integration 测试

使用：

```text
@SpringBootTest
@AutoConfigureMockMvc
Testcontainers PostgreSQL
```

只给关键流程写，不要滥用。

适合测试：

```text
真实 Spring context
真实 DB
真实 Flyway migration
真实 Controller -> Service -> Repository
mock Keycloak 外部调用
```

比如：

```text
POST /api/boost/requests -> DB 里有 NEW request
admin assign booster -> DB 里有 assignment，request.status = MATCHED
```

---

## Boost 模块测试清单

### BoostRequestServiceTest

需要覆盖：

```text
创建 boost request 时 status = NEW
region 为 null 时默认 CN
region 不是 CN 时拒绝
requestType 非法时拒绝
contactType 非 QQ/WECHAT 时拒绝
targetDescription 为空时拒绝
包含“密码/验证码/password”时拒绝
不会接受前端传来的 status/adminNote/requesterUserId
```

---

### BoostRequestControllerTest

需要覆盖：

```text
GET /api/boost/options 可公开访问
POST /api/boost/requests 未登录返回 401
POST /api/boost/requests 登录后可创建
GET /api/boost/requests/my 未登录返回 401
GET /api/boost/requests/my/{id} 只能看自己的
PATCH /api/boost/requests/my/{id}/cancel 只能取消自己的
```

---

### BoosterServiceTest

需要覆盖：

```text
创建 booster 时保存 keycloakUserId
创建 booster 时调用 KeycloakAdminUserService.addRealmRole(keycloakUserId, "booster")
Keycloak user 不存在时创建失败
booster role 不存在时创建失败
同一个 keycloakUserId 重复创建 booster 失败
删除 booster 不物理删除 DB 行
删除 booster 会调用 removeRealmRole(keycloakUserId, "booster")
删除成功后 status = INACTIVE
删除成功后 available = false
Keycloak remove role 失败时，不更新 DB 状态
```

---

### AdminBoosterControllerTest

需要覆盖：

```text
非 admin 不能访问 /api/admin/boost/boosters
admin 可以创建 booster
admin 可以更新 booster
admin 可以设置 availability
admin 可以 delete/deactivate booster
非法 level/status 返回 400
Keycloak 权限不足时返回明确错误，不要 Unhandled exception
```

---

### BoostAssignmentServiceTest

需要覆盖：

```text
admin 可以给 request 分配 active + available booster
不能分配 INACTIVE/BANNED booster
不能分配 available=false booster
同一个 request 不能有两个 active assignment
unassign 会设置 unassignedAt
unassign 会把 assignment.status 改为 CANCELLED
如果 request.status = MATCHED，unassign 后 request.status = REVIEWING
没有 active assignment 时 unassign 返回 NO_ACTIVE_ASSIGNMENT
```

---

### BoostRepositoryIntegrationTest

使用真实 PostgreSQL + Testcontainers。

需要覆盖：

```text
Flyway migration 可以成功执行
booster_profile 表存在
boost_request 表存在
boost_request_assignment 表存在
uq_boost_request_active_assignment 生效
foreign key 生效
同一个 request 可以有多个历史 assignment
同一个 request 同时只能有一个 active assignment
```

---

## Keycloak 相关测试策略

不要在普通单元测试里启动真实 Keycloak。

Keycloak Admin API 应该通过接口封装：

```java
KeycloakAdminUserService
```

业务 service 测试中 mock 它。

例如：

```java
doThrow(new KeycloakAdminException("KEYCLOAK_ADMIN_FORBIDDEN"))
    .when(keycloakAdminUserService)
    .removeRealmRole("kc-user-id", "booster");
```

然后断言：

```text
delete booster 失败
booster_profile 没有被更新为 INACTIVE
repository.save 没有被调用
返回明确错误码
```

真实 Keycloak 集成测试后续再考虑，不作为 MVP 必需。

---

## 命名规范

测试类命名：

```text
XxxServiceTest
XxxControllerTest
XxxRepositoryTest
XxxIntegrationTest
```

测试方法命名建议使用自然语言风格：

```java
void shouldCreateBoostRequestWithNewStatus()

void shouldRejectInvalidRegion()

void shouldNotDeactivateBoosterWhenKeycloakRoleRemovalFails()

void shouldRejectSecondActiveAssignmentForSameRequest()
```

如果团队喜欢 given/when/then，也可以：

```java
void givenInvalidRegion_whenCreateRequest_thenThrowsValidationException()
```

但不要混用太多风格。

---

## Given / When / Then 注释规范

推荐所有复杂测试按三段写：

```java
@Test
void shouldRejectInvalidRegion() {
    // given
    var request = validRequestWithRegion("EU");

    // when / then
    assertThatThrownBy(() -> service.create(request))
        .isInstanceOf(ValidationException.class)
        .hasMessageContaining("当前仅支持国服");
}
```

简单测试可以不强制写注释。

---

## 测试数据工厂

为了减少重复，建议给测试创建 factory/helper。

例如：

```java
final class BoostTestData {

    static CreateBoostRequestRequest validCreateBoostRequest() {
        return new CreateBoostRequestRequest(
            123456789L,
            "Coke_158",
            "CN",
            "COACHING",
            "想找人指导中坦走位和残局处理。",
            "可商量",
            "QQ",
            "123456789",
            "中国时间晚上 20:00-23:00",
            null
        );
    }

    static BoosterProfile activeBooster() {
        var booster = new BoosterProfile();
        booster.setId(1L);
        booster.setKeycloakUserId("kc-user-id");
        booster.setNickname("TestBooster");
        booster.setLevel("ELITE");
        booster.setAvailable(true);
        booster.setStatus("ACTIVE");
        return booster;
    }
}
```

可以先放在对应 test package 里，不需要过度设计。

---

## Spring Security 测试建议

如果项目使用 JWT Resource Server，Controller 测试需要模拟认证用户。

优先使用项目已有测试方式。

如果还没有，可以建立测试 helper：

```java
static RequestPostProcessor jwtWithUser(String subject) {
    return jwt().jwt(jwt -> jwt
        .subject(subject)
        .claim("preferred_username", "test-user")
    );
}
```

管理员测试需要模拟 admin role：

```java
static RequestPostProcessor adminJwt() {
    return jwt().jwt(jwt -> jwt
        .subject("admin-user")
        .claim("realm_access", Map.of(
            "roles", List.of("wotbtools-admin")
        ))
    );
}
```

注意：具体 claim 结构要匹配项目里的 `KeycloakRoleConverter` 或现有 Security 配置。

---

## Testcontainers PostgreSQL 建议配置

可以建立一个抽象基类：

```java
@Testcontainers
@SpringBootTest
@AutoConfigureMockMvc
abstract class AbstractPostgresIntegrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
        .withDatabaseName("wotb")
        .withUsername("wotb")
        .withPassword("wotb");

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "validate");
        registry.add("spring.flyway.enabled", () -> "true");
    }
}
```

根据项目实际 Spring Boot / Testcontainers 版本调整。

---

## 不要做的事情

```text
不要为了测试引入 Spock/Groovy
不要用 H2 测 PostgreSQL-specific 约束
不要在 service 单元测试里启动 Spring 全上下文
不要在所有测试里都用 @SpringBootTest
不要 mock 被测对象本身
不要测试 private method
不要为了覆盖率写无意义测试
不要在测试里依赖生产 Keycloak
不要在测试里使用真实生产数据库
不要让测试依赖执行顺序
```

---

## 推荐实施顺序

第一批先做：

```text
1. 检查/补齐 Maven test dependencies
2. 建立 BoostTestData helper
3. 写 BoostRequestServiceTest
4. 写 BoosterServiceTest，重点覆盖 Keycloak role 失败不更新 DB
5. 写 BoostAssignmentServiceTest
6. 写 BoostRepositoryIntegrationTest，验证 partial unique index
7. 再补 Controller/MockMvc 测试
```

不要一开始写太多 `@SpringBootTest`。

先让 service 单元测试跑起来。

---

## 常用命令

只编译测试：

```bash
cd java
mvn -s settings.xml -DskipTests -pl wotb-web -am test-compile
```

运行 wotb-web 测试：

```bash
cd java
mvn -s settings.xml -pl wotb-web -am test
```

只运行某个测试类：

```bash
cd java
mvn -s settings.xml -pl wotb-web -Dtest=BoostRequestServiceTest test
```

只运行某个测试方法：

```bash
cd java
mvn -s settings.xml -pl wotb-web -Dtest=BoostRequestServiceTest#shouldRejectInvalidRegion test
```

跳过集成测试可以后续通过 profile 或 naming convention 处理。

---

## 验收标准

```text
项目使用 JUnit 5 作为主测试框架
断言优先使用 AssertJ
Service 测试使用 Mockito，不启动 Spring 上下文
Controller 测试使用 MockMvc
数据库约束测试使用 Testcontainers PostgreSQL
BoostRequestServiceTest 覆盖基础 validation
BoosterServiceTest 覆盖 Keycloak role add/remove 行为
BoostAssignmentServiceTest 覆盖 active assignment 规则
Repository integration test 覆盖 partial unique index
测试不依赖真实生产 Keycloak
测试不依赖真实生产数据库
mvn test-compile 通过
关键测试 mvn test 通过
```
