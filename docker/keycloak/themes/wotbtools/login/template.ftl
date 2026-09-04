<#import "footer.ftl" as loginFooter>
<#macro registrationLayout bodyClass="" displayInfo=false displayMessage=true displayRequiredFields=false>
<!DOCTYPE html>
<html class="${properties.kcHtmlClass!}" data-theme="dark" lang="${lang}"<#if realm.internationalizationEnabled> dir="${(locale.rtl)?then('rtl','ltr')}"</#if>>
<head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <#if properties.meta?has_content>
        <#list properties.meta?split(' ') as meta>
            <meta name="${meta?split('==')[0]}" content="${meta?split('==')[1]}"/>
        </#list>
    </#if>
    <title>${title!}</title>
    <link rel="icon" href="${url.resourcesPath}/img/login-favicon.svg" />
    <#if properties.stylesCommon?has_content>
        <#list properties.stylesCommon?split(' ') as style>
            <link href="${url.resourcesCommonPath}/${style}" rel="stylesheet" />
        </#list>
    </#if>
    <#if properties.styles?has_content>
        <#list properties.styles?split(' ') as style>
            <link href="${url.resourcesPath}/${style}" rel="stylesheet" />
        </#list>
    </#if>
    <#-- 背景轮换：在样式表之后注入 :root 自定义属性，CSS 侧保留硬编码兜底。 -->
    <#include "background-rotation.ftl">
    <#if properties.scripts?has_content>
        <#list properties.scripts?split(' ') as script>
            <script src="${url.resourcesPath}/${script}" type="text/javascript"></script>
        </#list>
    </#if>
    <script type="importmap">
        {
            "imports": {
                "rfc4648": "${url.resourcesCommonPath}/vendor/rfc4648/rfc4648.js"
            }
        }
    </script>
    <script src="${url.resourcesPath}/js/menu-button-links.js" type="module"></script>
    <#if scripts??>
        <#list scripts as script>
            <script src="${script}" type="text/javascript"></script>
        </#list>
    </#if>
    <script type="module">
        <#outputformat "JavaScript">
        import { startSessionPolling } from ${(url.resourcesPath + "/js/authChecker.js")?c};

        startSessionPolling(
            ${url.ssoLoginInOtherTabsUrl?c}
        );
        </#outputformat>
    </script>
    <script type="text/javascript">
        // Inline theme bootstrap to avoid a flash of the wrong theme.
        (function () {
            var d = document.documentElement;
            var theme = 'dark';
            try { var t = window.localStorage.getItem('wotbtools-theme'); if (t === 'light') { theme = 'light'; } } catch (e) { }
            d.setAttribute('data-theme', theme);
        })();
    </script>
    <script type="module">
        document.addEventListener("click", (event) => {
            const link = event.target.closest("a[data-once-link]");
            if (!link) { return; }
            if (link.getAttribute("aria-disabled") === "true") { event.preventDefault(); return; }
            const { disabledClass } = link.dataset;
            if (disabledClass) { link.classList.add(...disabledClass.trim().split(/\s+/)); }
            link.setAttribute("role", "link");
            link.setAttribute("aria-disabled", "true");
        });
    </script>
    <#if authenticationSession??>
        <script type="module">
            <#outputformat "JavaScript">
            import { checkAuthSession } from ${(url.resourcesPath + "/js/authChecker.js")?c};

            checkAuthSession(
                ${authenticationSession.authSessionIdHash?c}
            );
            </#outputformat>
        </script>
    </#if>
</head>
<body class="${properties.kcBodyClass!}" data-page-id="login-${pageId}">
<div class="${properties.kcLoginClass!}">
    <div class="wbtb-shell__bg" aria-hidden="true"></div>

    <div class="wbtb-shell__topbar">
        <a class="wbtb-shell__brand" href="${url.loginUrl}" aria-label="WotBTools">
            <img class="wbtb-shell__brand-logo" src="${url.resourcesPath}/img/wotbtoolslogo.png" alt="WotBTools">
        </a>
        <div class="wbtb-shell__topbar-actions">
            <button tabindex="0" id="wbtb-theme-toggle" class="wbtb-theme-toggle" type="button" data-label-to-light="切换到浅色主题" data-label-to-dark="切换到深色 Battlefield 主题" aria-label="切换到浅色主题" title="切换到浅色主题">
                <span class="wbtb-theme-toggle__sun" aria-hidden="true"></span>
                <span class="wbtb-theme-toggle__moon" aria-hidden="true"></span>
            </button>
        </div>
    </div>

    <div class="wbtb-shell__main">
        <section class="wbtb-shell__hero" aria-hidden="false">
            <p class="wbtb-hero__eyebrow">Battle Intelligence Platform</p>
            <h1 class="wbtb-hero__title">See the battle differently.</h1>
            <p class="wbtb-hero__desc">Replay analysis, AI-assisted review and tactical reconstruction &mdash; one workspace built for understanding every fight.</p>
            <ul class="wbtb-hero__chips">
                <li>Replay Analysis</li>
                <li>AI Review</li>
                <li>Battle Reconstruction</li>
                <li>League Rating</li>
            </ul>
        </section>

        <section class="wbtb-shell__auth">
            <div class="${properties.kcFormCardClass!}">
                <header class="${properties.kcFormHeaderClass!}">
                  <#if !(auth?has_content && auth.showUsername() && !auth.showResetCredentials())>
                      <#if displayRequiredFields>
                          <div class="${properties.kcContentWrapperClass!}">
                              <div class="${properties.kcLabelWrapperClass!} subtitle">
                                  <span class="subtitle"><span class="required">*</span> ${msg("requiredFields")}</span>
                              </div>
                              <div class="col-md-10">
                                  <h1 id="kc-page-title"><#nested "header"></h1>
                              </div>
                          </div>
                      <#else>
                          <h1 id="kc-page-title"><#nested "header"></h1>
                      </#if>
                  <#else>
                      <#if displayRequiredFields>
                          <div class="${properties.kcContentWrapperClass!}">
                              <div class="${properties.kcLabelWrapperClass!} subtitle">
                                  <span class="subtitle"><span class="required">*</span> ${msg("requiredFields")}</span>
                              </div>
                              <div class="col-md-10">
                                  <#nested "show-username">
                                  <div id="kc-username" class="${properties.kcFormGroupClass!}">
                                      <label id="kc-attempted-username">${auth.attemptedUsername}</label>
                                      <a id="reset-login" href="${url.loginRestartFlowUrl}" aria-label="${msg("restartLoginTooltip")}">
                                          <i class="${properties.kcResetFlowIcon!}"></i>
                                          <span class="kc-tooltip-text">${msg("restartLoginTooltip")}</span>
                                      </a>
                                  </div>
                              </div>
                          </div>
                      <#else>
                          <#nested "show-username">
                          <div id="kc-username" class="${properties.kcFormGroupClass!}">
                              <label id="kc-attempted-username">${auth.attemptedUsername}</label>
                              <a id="reset-login" href="${url.loginRestartFlowUrl}" aria-label="${msg("restartLoginTooltip")}">
                                  <i class="${properties.kcResetFlowIcon!}"></i>
                                  <span class="kc-tooltip-text">${msg("restartLoginTooltip")}</span>
                              </a>
                          </div>
                      </#if>
                  </#if>
                </header>
                <div id="kc-content">
                  <div id="kc-content-wrapper">
                    <#if displayMessage && message?has_content && (message.type != 'warning' || !isAppInitiatedAction??)>
                      <div class="alert-${message.type} ${properties.kcAlertClass!} pf-m-<#if message.type = 'error'>danger<#else>${message.type}</#if>" role="alert">
                          <div class="pf-c-alert__icon">
                              <#if message.type = 'success'><span class="${properties.kcFeedbackSuccessIcon!}"></span></#if>
                              <#if message.type = 'warning'><span class="${properties.kcFeedbackWarningIcon!}"></span></#if>
                              <#if message.type = 'error'><span class="${properties.kcFeedbackErrorIcon!}"></span></#if>
                              <#if message.type = 'info'><span class="${properties.kcFeedbackInfoIcon!}"></span></#if>
                          </div>
                          <span class="${properties.kcAlertTitleClass!}">${kcSanitize(message.summary)?no_esc}</span>
                      </div>
                    </#if>
                    <#nested "form">
                    <#if auth?has_content && auth.showTryAnotherWayLink()>
                        <form id="kc-select-try-another-way-form" action="${url.loginAction}" method="post">
                            <div class="${properties.kcFormGroupClass!}">
                                <input type="hidden" name="tryAnotherWay" value="on"/>
                                <a href="#" id="try-another-way" onclick="document.forms['kc-select-try-another-way-form'].requestSubmit();return false;">${msg("doTryAnotherWay")}</a>
                            </div>
                        </form>
                    </#if>
                    <#nested "socialProviders">
                    <#if displayInfo>
                        <div id="kc-info" class="${properties.kcSignUpClass!}">
                            <div id="kc-info-wrapper" class="${properties.kcInfoAreaWrapperClass!}">
                                <#nested "info">
                            </div>
                        </div>
                    </#if>
                  </div>
                </div>
                <@loginFooter.content/>
            </div>
        </section>
    </div>

    <div class="wbtb-shell__footer">
        <span>WotBTools &mdash; Blitz replay analysis</span>
        <span class="wbtb-shell__footer-domain">auth.wotbtools.com</span>
    </div>
</div>
</body>
</html>
</#macro>
