"""Diagnóstico de la integración con Microsoft (login y Excel en SharePoint).

Uso (con las variables de entorno o el .env configurados):
    python -m app.check_microsoft

Revisa paso a paso la configuración y la conexión, y explica qué corregir si algo falla.
"""
import io
import sys

import httpx

from .config import get_settings
from .data.graph import GraphError, GraphExcelSource, referencia
from .data.schema import normalize
from .data.sources import PDT_SHEET, read_rows

OK, MAL, INFO = "  ✓", "  ✗", "  ·"


def paso(titulo):
    print(f"\n{titulo}")


def main() -> int:
    s = get_settings()
    errores = 0

    paso("1. Configuración")
    req = {
        "AZURE_TENANT_ID": s.azure_tenant_id,
        "AZURE_API_CLIENT_ID (o GRAPH_CLIENT_ID)": s.graph_client_id or s.azure_api_client_id,
        "GRAPH_CLIENT_SECRET": s.graph_client_secret,
        "SHAREPOINT_FILE_URL": s.sharepoint_file_url or (s.sharepoint_hostname and s.sharepoint_file_path),
    }
    for k, v in req.items():
        print(f"{OK if v else MAL} {k}{'' if v else ' — falta'}")
        errores += not v
    print(f"{INFO} DATA_SOURCE={s.data_source}  AUTH_MODE={s.auth_mode}  hoja={s.excel_sheet_name}")
    if errores:
        print("\nComplete la configuración y vuelva a ejecutar.")
        return 1
    try:
        ref = referencia(s)
        print(f"{OK} Archivo: {ref.hostname}{ref.file_path}  (sitio: {ref.site_path or '/'})")
    except GraphError as e:
        print(f"{MAL} {e}")
        return 1

    src = GraphExcelSource(s)
    paso("2. Credenciales de la aplicación (Entra ID)")
    try:
        src._archivo().client.token()
        print(f"{OK} Token obtenido")
    except GraphError as e:
        print(f"{MAL} {e}")
        return 1

    paso("3. Acceso al archivo en SharePoint (permiso Sites.Selected)")
    try:
        info = src._archivo().info()
        print(f"{OK} {info.nombre} · {info.tamano / 1e6:.1f} MB · modificado {info.modificado} por {info.modificado_por or '—'}")
    except GraphError as e:
        print(f"{MAL} {e}")
        return 1

    paso("4. Lectura del Excel")
    try:
        df = normalize(src.fetch(), s.trm_cop_usd, s.eur_usd)
        print(f"{OK} Hoja «{s.excel_sheet_name}»: {len(df):,} líneas · {df['embarque'].nunique()} embarques "
              f"(el archivo declara {src.raw_rows:,} filas)")
        if src.raw_rows > 50 * max(len(df), 1):
            print(f"{INFO} El archivo tiene muchas filas vacías con formato; conviene limpiarlas (se lee igual).")
        header, rows, _ = read_rows(io.BytesIO(src._content), PDT_SHEET, max_empty=20)
        print(f"{OK} Hoja «{PDT_SHEET}»: {len(rows)} registros")
    except Exception as e:  # noqa: BLE001
        print(f"{MAL} {e}")
        errores += 1

    paso("5. Login con Microsoft (validación de tokens)")
    if s.auth_mode != "entra":
        print(f"{INFO} AUTH_MODE={s.auth_mode}: el login con Microsoft aún no está activo (es normal durante la configuración).")
    else:
        for k, v in {"AZURE_API_AUDIENCE": s.azure_api_audience, "AUTH_REQUIRED_ROLE": s.auth_required_role}.items():
            print(f"{OK if v else INFO} {k}={v or '(vacío)'}")
        try:
            r = httpx.get(f"https://login.microsoftonline.com/{s.azure_tenant_id}/discovery/v2.0/keys", timeout=20)
            r.raise_for_status()
            print(f"{OK} Claves públicas del tenant disponibles ({len(r.json().get('keys', []))})")
        except Exception as e:  # noqa: BLE001
            print(f"{MAL} No se pudieron obtener las claves del tenant: {e}")
            errores += 1

    print("\n" + ("Todo en orden ✓" if not errores else f"Se encontraron {errores} problema(s)."))
    return 1 if errores else 0


if __name__ == "__main__":
    sys.exit(main())
