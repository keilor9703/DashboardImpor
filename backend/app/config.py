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

    # Credenciales de la app "daemon" que lee el Excel (client credentials)
    graph_client_id: str = ""
    graph_client_secret: str = ""
    # Ubicación del archivo en SharePoint
    sharepoint_hostname: str = ""          # ej. empresa.sharepoint.com
    sharepoint_site_path: str = ""         # ej. /sites/Operaciones
    sharepoint_file_path: str = ""         # ej. /Consolidados/Operaciones 2026.xlsx
    excel_table_name: str = ""             # Tabla de Excel (recomendado)
    excel_sheet_name: str = "Sheet1"       # Si no hay tabla, se usa la hoja
    # "download": descarga el .xlsx y lo procesa (recomendado: el archivo es grande).
    # "workbook": API de Excel de Graph (solo si la hoja está limpia o es una Tabla).
    graph_read_mode: Literal["workbook", "download"] = "download"

    local_file_path: str = ""

    # ---------- Reglas de negocio ----------
    trm_cop_usd: float = 4000.0  # TRM para convertir valores en COP a USD
    eur_usd: float = 1.08

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
