"""Configuración central de la aplicación (variables de entorno / archivo .env)."""
from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Dashboard Comercio Exterior"
    environment: Literal["development", "production"] = "development"
    cors_origins: str = "http://localhost:5173"

    # ---------- Autenticación (Microsoft Entra ID) ----------
    # "demo": sin validación (solo desarrollo). "entra": cuenta de Microsoft.
    # "password": usuario y contraseña propios (mientras se configura Entra ID).
    auth_mode: Literal["demo", "entra", "password"] = "demo"
    # Modo password: usuarios "usuario:hash;usuario2:hash" (hash con: python -m app.passwords)
    auth_users: str = ""
    auth_secret: str = ""          # clave para firmar las sesiones (larga y aleatoria)
    auth_session_hours: int = 12
    azure_tenant_id: str = ""
    # Client ID de la app registrada para la API (backend)
    azure_api_client_id: str = ""
    # Audiencia esperada en el token, normalmente api://<client-id-api>
    azure_api_audience: str = ""
    # Rol de aplicación requerido (App Role). Vacío = cualquier usuario del tenant.
    auth_required_role: str = ""

    # ---------- Fuente de datos ----------
    # "mock": datos simulados. "graph": Excel en SharePoint vía Microsoft Graph.
    # "file": archivo .xlsx local (útil para pruebas con una copia del Excel real).
    data_source: Literal["mock", "graph", "file"] = "mock"
    cache_ttl_seconds: int = 120

    # App de Entra ID que lee el Excel (client credentials). Si se usa la misma app del
    # login, GRAPH_CLIENT_ID puede quedar vacío y se toma AZURE_API_CLIENT_ID.
    graph_client_id: str = ""
    graph_client_secret: str = ""
    # URL del archivo en SharePoint (la de «Copiar ruta de acceso» o la del navegador)
    sharepoint_file_url: str = ""
    # Configuración anterior por partes (se mantiene por compatibilidad)
    sharepoint_hostname: str = ""
    sharepoint_site_path: str = ""
    sharepoint_file_path: str = ""
    excel_sheet_name: str = "Sheet1"

    local_file_path: str = ""

    # ---------- Carga manual del Excel (solo con DATA_SOURCE=file) ----------
    # Quién puede cargar: AUTH_MODE=password → usuarios de esta lista (vacía = todos los usuarios);
    # AUTH_MODE=entra → quienes tengan este rol de aplicación (vacío = todos los autorizados).
    upload_users: str = ""
    upload_role: str = ""
    upload_max_mb: int = 30
    # Para que el archivo cargado NO se pierda cuando Render reinicia el servicio, se guarda como un commit
    # en GitHub. Token fino con permiso «Contents: Read and write» solo sobre este repositorio.
    github_token: str = ""
    github_repo: str = ""                   # owner/nombre, ej. keilor9703/DashboardImpor
    github_branch: str = "main"
    github_file_path: str = "Insumos/Insumo1.xlsx"

    # ---------- Reglas de negocio ----------
    trm_cop_usd: float = 4000.0  # TRM para convertir valores en COP a USD
    eur_usd: float = 1.08

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
