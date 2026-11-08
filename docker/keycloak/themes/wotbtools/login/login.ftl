<#--
  WotbTools 登录卡（4.0「账户与登录」稿）。基于 Keycloak 26.6.4 base/login/login.ftl 改写：

  · 普通用户只用 Wargaming（亚服 / 欧服 / 北美服）和 QQ 登录，没有注册；
    Wargaming 三个服务器是主按钮，「或」分隔后 QQ 是次按钮。IdP 按 alias 归类：
    `wargaming-*` → 主按钮，`idp-qq` → 次按钮，其余 IdP（若以后新增）按次按钮兜底，不会消失。
  · 用户名密码表单是运维后门：默认收在卡片底部低对比的「运维登录」<details> 里，
    无 JS 也能展开；登录失败或带回用户名时默认展开，错误信息不被藏起来。
    没有「记住我」「忘记密码」（realm 本身也未开启）。
  · 表单字段名、action、credentialId 隐藏域、passkeys 条件 UI 与 base 保持一致，不改认证流程。
-->
<#import "template.ftl" as layout>
<#import "passkeys.ftl" as passkeys>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password') displayInfo=false; section>
    <#if section = "header">
        ${msg("wbtbLoginTitle")}
    <#elseif section = "form">
        <#assign wgProviders = []>
        <#assign otherProviders = []>
        <#if social?? && social.providers?has_content>
            <#list social.providers as p>
                <#if p.alias?starts_with("wargaming-")>
                    <#assign wgProviders = wgProviders + [p]>
                <#else>
                    <#assign otherProviders = otherProviders + [p]>
                </#if>
            </#list>
        </#if>

        <div id="kc-social-providers" class="wbtb-idp-section">
            <#if wgProviders?has_content>
                <p class="wbtb-idp-hint">${msg("wbtbWargamingHint")}</p>
                <ul class="wbtb-idp-grid wbtb-idp-grid--primary">
                    <#list wgProviders as p>
                        <li>
                            <a data-once-link data-disabled-class="is-disabled" id="social-${p.alias}"
                               class="wbtb-idp-btn wbtb-idp-btn--primary" href="${p.loginUrl}">
                                <span class="wbtb-idp-btn__label"><#if ["wargaming-asia", "wargaming-eu", "wargaming-na"]?seq_contains(p.alias)>${msg("wbtbIdp_" + p.alias?replace("-", "_"))}<#else>${p.displayName!}</#if></span>
                            </a>
                        </li>
                    </#list>
                </ul>
            </#if>
            <#if otherProviders?has_content>
                <#if wgProviders?has_content><p class="wbtb-or"><span>${msg("wbtbOr")}</span></p></#if>
                <ul class="wbtb-idp-grid">
                    <#list otherProviders as p>
                        <li>
                            <a data-once-link data-disabled-class="is-disabled" id="social-${p.alias}"
                               class="wbtb-idp-btn" href="${p.loginUrl}">
                                <#if p.iconClasses?has_content><i class="${p.iconClasses!}" aria-hidden="true"></i></#if>
                                <span class="wbtb-idp-btn__label">${p.displayName!}</span>
                            </a>
                        </li>
                    </#list>
                </ul>
            </#if>
            <p class="wbtb-idp-note">${msg("wbtbNoRegistration")}</p>
        </div>

        <#if realm.password>
            <details class="wbtb-ops" <#if messagesPerField.existsError('username','password') || (login.username!'')?has_content || usernameHidden??>open</#if>>
                <summary class="wbtb-ops__summary">${msg("wbtbOpsLogin")}</summary>
                <div id="kc-form">
                  <div id="kc-form-wrapper">
                    <form id="kc-form-login" onsubmit="login.disabled = true; return true;" action="${url.loginAction}" method="post">
                        <#if !usernameHidden??>
                            <div class="${properties.kcFormGroupClass!}">
                                <label for="username" class="${properties.kcLabelClass!}"><#if !realm.loginWithEmailAllowed>${msg("username")}<#elseif !realm.registrationEmailAsUsername>${msg("usernameOrEmail")}<#else>${msg("email")}</#if></label>
                                <input id="username" class="${properties.kcInputClass!}" name="username" value="${(login.username!'')}" type="text"
                                       autocomplete="${(enableWebAuthnConditionalUI?has_content)?then('username webauthn', 'username')}"
                                       aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"
                                       dir="ltr"
                                />
                                <#if messagesPerField.existsError('username','password')>
                                    <span id="input-error" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                                        ${kcSanitize(messagesPerField.getFirstError('username','password'))?no_esc}
                                    </span>
                                </#if>
                            </div>
                        </#if>

                        <div class="${properties.kcFormGroupClass!}">
                            <label for="password" class="${properties.kcLabelClass!}">${msg("password")}</label>
                            <div class="${properties.kcInputGroup!}" dir="ltr">
                                <input id="password" class="${properties.kcInputClass!}" name="password" type="password" autocomplete="current-password"
                                       aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"
                                />
                                <button class="${properties.kcFormPasswordVisibilityButtonClass!}" type="button" aria-label="${msg("showPassword")}"
                                        aria-controls="password" data-password-toggle
                                        data-icon-show="${properties.kcFormPasswordVisibilityIconShow!}" data-icon-hide="${properties.kcFormPasswordVisibilityIconHide!}"
                                        data-label-show="${msg('showPassword')}" data-label-hide="${msg('hidePassword')}">
                                    <i class="${properties.kcFormPasswordVisibilityIconShow!}" aria-hidden="true"></i>
                                </button>
                            </div>
                            <#if usernameHidden?? && messagesPerField.existsError('username','password')>
                                <span id="input-error" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                                    ${kcSanitize(messagesPerField.getFirstError('username','password'))?no_esc}
                                </span>
                            </#if>
                        </div>

                        <div id="kc-form-buttons" class="${properties.kcFormGroupClass!}">
                            <input type="hidden" id="id-hidden-input" name="credentialId" <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if>/>
                            <input class="${properties.kcButtonClass!} ${properties.kcButtonDefaultClass!} ${properties.kcButtonBlockClass!}" name="login" id="kc-login" type="submit" value="${msg("doLogIn")}"/>
                        </div>
                    </form>
                  </div>
                </div>
            </details>
        </#if>
        <@passkeys.conditionalUIData />
        <script type="module" src="${url.resourcesPath}/js/passwordVisibility.js"></script>
    </#if>
</@layout.registrationLayout>
