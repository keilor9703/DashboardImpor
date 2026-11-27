"""Validación de tokens de acceso emitidos por Microsoft Entra ID.

El frontend inicia sesión con MSAL (cuenta corporativa de Microsoft 365) y envía
el access token en el header ``Authorization: Bearer <token>``. Aquí se valida
firma (JWKS del tenant), emisor, audiencia, expiración y, opcionalmente, rol.
"""
import time
from functools import lru_cache

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from .config import Settings, get_settings
from .passwords import parse_users, verify_password

bearer = HTTPBearer(auto_error=False)


class User(BaseModel):
    oid: str
    name: str
    email: str | None = None
    roles: list[str] = []
    can_upload: bool = False


DEMO_USER = User(oid="demo", name="Usuario Demo", email="demo@empresa.com", roles=["Dashboard.Viewer"], can_upload=True)


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


def _secret(settings: Settings) -> str:
    if len(settings.auth_secret) < 32:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "AUTH_SECRET no configurado (mínimo 32 caracteres)")
    return settings.auth_secret


def login_password(username: str, password: str, settings: Settings) -> dict:
    users = parse_users(settings.auth_users)
    stored = users.get(username.strip().lower())
    if not stored or not verify_password(password, stored):
        time.sleep(0.5)  # frena intentos de fuerza bruta
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario o contraseña incorrectos")
    now = int(time.time())
    name = username.strip()
    token = jwt.encode(
        {"sub": name.lower(), "name": name, "iat": now, "exp": now + settings.auth_session_hours * 3600, "iss": "comex-dashboard"},
        _secret(settings), algorithm="HS256",
    )
    return {"access_token": token, "name": name, "expires_in": settings.auth_session_hours * 3600}


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    settings: Settings = Depends(get_settings),
) -> User:
    if settings.auth_mode == "demo":
        return DEMO_USER

    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Falta el token de acceso")

    if settings.auth_mode == "password":
        try:
            claims = jwt.decode(credentials.credentials, _secret(settings), algorithms=["HS256"], issuer="comex-dashboard")
        except jwt.PyJWTError as exc:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesión vencida o inválida") from exc
        if claims["sub"] not in parse_users(settings.auth_users):  # usuario eliminado
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario sin acceso")
        permitidos = {u.strip().lower() for u in settings.upload_users.split(",") if u.strip()}
        return User(oid=claims["sub"], name=claims["name"], roles=["Dashboard.Viewer"],
                    can_upload=not permitidos or claims["sub"] in permitidos)

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
        can_upload=not settings.upload_role or settings.upload_role in roles,
    )


def require_uploader(user: User = Depends(get_current_user)) -> User:
    if not user.can_upload:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Su usuario no tiene permiso para cargar el Excel")
    return user
