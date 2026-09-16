# Upstream provenance

This module vendors the QQ provider from [Trashblazer/keycloak-social-provider-china](https://github.com/trashblazer/keycloak-social-provider-china), commit `45ffa0ec47f6dbdfc43c6c0b87856943256ff43c` (2026-03-04), under Apache-2.0. The upstream license is retained in [LICENSE](LICENSE).

The vendored source is deliberately minimal: the QQ provider Java classes and Keycloak service registration only. It is built against Keycloak `26.6.4` (upstream declared `26.5.4`).

WotBTools changes to the upstream source:

- removes remote-response and nested-exception details from broker failures, preventing OAuth/QQ response data from becoming diagnostics;
- preserves WotBTools CN profile behavior by setting `displayName` and `region=CN` in the brokered identity context.

The module must remain vendored and pinned. Do not add build-time or runtime downloads of the upstream repository or provider JAR.
