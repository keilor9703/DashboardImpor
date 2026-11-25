"""Validación de tokens de acceso emitidos por Microsoft Entra ID.

El frontend inicia sesión con MSAL (cuenta corporativa de Microsoft 365) y envía
el access token en el header ``Authorization: Bearer <token>``. Aquí se valida
firma (JWKS del tenant), emisor, audiencia, expiración y, opcionalmente, rol.
"""
from functools import lru_cache

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from .config import Settings, get_settings

bearer = HTTPBearer(auto_error=False)


class User(BaseModel):
    oid: str
    name: str
    email: str | None = None
    roles: list[str] = []


DEMO_USER = User(oid="demo", name="Usuario Demo", email="demo@empresa.com", roles=["Dashboard.Viewer"])


@lru_cache
def _jwks_client(tenant_id: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(
        f"https://login.microsoftonline.com/{tenant_id}/discovery/v2.0/keys",
        cache_keys=True,
        lifespan=3600,
    )


def decode_entra_token(token: str, settings: Settings) -> dict:
    signing_key = _jwks_client(settings.azure_tenant_id).get_signing_key_from_jwt(token)
    audiences = [a for a in (settings.azure_api_audience, settings.azure_api_client_id) if a]
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        audience=audiences,
        issuer=f"https://login.microsoftonline.com/{settings.azure_tenant_id}/v2.0",
        options={"require": ["exp", "iss", "aud"]},
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    settings: Settings = Depends(get_settings),
) -> User:
    if settings.auth_mode == "demo":
        return DEMO_USER

    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Falta el token de acceso")
    try:
        claims = decode_entra_token(credentials.credentials, settings)
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Token inválido: {exc}") from exc

    roles = claims.get("roles", [])
    if settings.auth_required_role and settings.auth_required_role not in roles:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No tiene permiso para ver el dashboard")

    return User(
        oid=claims.get("oid", ""),
        name=claims.get("name", "Usuario"),
        email=claims.get("preferred_username") or claims.get("email"),
        roles=roles,
    )
