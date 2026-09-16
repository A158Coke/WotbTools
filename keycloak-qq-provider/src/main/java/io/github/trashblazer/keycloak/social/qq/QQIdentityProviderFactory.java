/*
 * Copyright 2026 Trashblazer
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package io.github.trashblazer.keycloak.social.qq;

import org.keycloak.broker.provider.AbstractIdentityProviderFactory;
import org.keycloak.broker.social.SocialIdentityProviderFactory;
import org.keycloak.models.IdentityProviderModel;
import org.keycloak.models.KeycloakSession;

public class QQIdentityProviderFactory extends AbstractIdentityProviderFactory<QQIdentityProvider>
        implements SocialIdentityProviderFactory<QQIdentityProvider> {

    public static final String PROVIDER_ID = "qq";

    @Override
    public String getName() {
        return "QQ";
    }

    @Override
    public String getId() {
        return PROVIDER_ID;
    }

    @Override
    public QQIdentityProvider create(KeycloakSession session, IdentityProviderModel model) {
        return new QQIdentityProvider(session, new QQIdentityProviderConfig(model));
    }

    @Override
    public QQIdentityProviderConfig createConfig() {
        return new QQIdentityProviderConfig();
    }
}