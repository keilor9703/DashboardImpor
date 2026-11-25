# ComEx Analytics: tablero directivo de comercio exterior

Dashboard web que lee en tiempo real la hoja consolidada de un Excel alojado en
**SharePoint (Microsoft 365)** y la convierte en indicadores, gráficos y alertas
para la gerencia. El acceso se hace con la **cuenta corporativa de Microsoft**.

```
Excel en SharePoint ──Microsoft Graph (solo lectura)──▶ Backend FastAPI + pandas ──API REST + token──▶ Frontend React + Apache ECharts
                                                         (caché, KPIs, validación)                     (login Microsoft, dashboard)
```

## Estructura

```
backend/            API en Python (FastAPI)
  app/config.py       Configuración por variables de entorno
  app/auth.py         Validación de tokens de Microsoft Entra ID
  app/data/schema.py  Mapeo de columnas del Excel → modelo interno  ← ajustar con el Excel real
  app/data/sources.py Fuentes: mock | file (.xlsx local) | graph (SharePoint)
  app/data/mock.py    Generador de datos simulados
  app/services/       Caché (repository) y cálculo de KPIs (analytics)
  app/routers/        Endpoints /api/*
  tests/
frontend/           React + TypeScript + Vite + Apache ECharts
  src/auth/           Login Microsoft (MSAL) con modo demo
  src/charts/         Gráficos ECharts
  src/pages/          Resumen ejecutivo, Operaciones, Fuente de datos, Login
  src/styles/app.css  Sistema de diseño (tokens, tema claro/oscuro)
docker-compose.yml
```

## Ejecutar en local (modo demo, sin Microsoft)

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000      # docs: http://localhost:8000/api/docs

# Frontend (otra terminal)
cd frontend
npm install
npm run dev                                    # http://localhost:5173
```

Con Docker: `cp backend/.env.example backend/.env && docker compose up --build` → http://localhost:8080

Pruebas del backend: `cd backend && pytest`

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Estado del servicio |
| GET | `/api/me` | Usuario autenticado |
| GET | `/api/dashboard` | KPIs, series y alertas. Filtros: `desde`, `hasta`, `tipo`, `cliente`, `aduana`, `modalidad` |
| GET | `/api/filtros` | Valores disponibles para los filtros |
| GET | `/api/operaciones` | Tabla paginada (`q`, `estado`, `orden`, `desc`, `pagina`, `tamano`) |
| GET | `/api/datos/estado` | Estado de la fuente de datos y de la última sincronización |
| POST | `/api/datos/refrescar` | Fuerza la relectura del Excel |

## Configurar Microsoft Entra ID (login)

Lo hace el administrador de Microsoft 365 de la empresa en **portal.azure.com → Microsoft Entra ID → Registros de aplicaciones**.

1. **App de la API** (`ComEx Dashboard API`)
   - *Exponer una API*: URI `api://<client-id>` y un scope `Dashboard.Read`.
   - *Manifiesto*: `"accessTokenAcceptedVersion": 2`.
   - Opcional: *Roles de aplicación*, con el rol `Dashboard.Viewer` asignado a los directivos en *Aplicaciones empresariales → Usuarios y grupos*.
2. **App del frontend** (`ComEx Dashboard Web`)
   - Plataforma **Aplicación de página única (SPA)** con el URI de redirección `https://<dominio>` (y `http://localhost:5173` para desarrollo).
   - *Permisos de API*: agregar `api://<client-id-api>/Dashboard.Read`.
3. Variables:
   - Frontend: `VITE_AZURE_CLIENT_ID` (app web), `VITE_AZURE_TENANT_ID`, `VITE_API_SCOPE=api://<client-id-api>/Dashboard.Read`
   - Backend: `AUTH_MODE=entra`, `AZURE_TENANT_ID`, `AZURE_API_CLIENT_ID`, `AZURE_API_AUDIENCE=api://<client-id-api>`, `AUTH_REQUIRED_ROLE=Dashboard.Viewer`

Si `VITE_AZURE_CLIENT_ID` está vacío, el frontend funciona en **modo demo**.

## Conectar el Excel de SharePoint (Microsoft Graph)

1. Registrar la app **`ComEx Excel Reader`** con un *secreto de cliente* y el permiso de aplicación **`Sites.Selected`** (requiere consentimiento del administrador).
2. Darle permiso de **lectura** solo sobre el sitio del archivo:
   `POST https://graph.microsoft.com/v1.0/sites/{site-id}/permissions` con `{"roles":["read"],"grantedToIdentities":[{"application":{"id":"<client-id>","displayName":"ComEx Excel Reader"}}]}`
3. Recomendado: convertir la hoja consolidada en una **Tabla de Excel** (Insertar → Tabla) y poner su nombre en `EXCEL_TABLE_NAME`.
4. Configurar en `backend/.env`: `DATA_SOURCE=graph`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `SHAREPOINT_HOSTNAME`, `SHAREPOINT_SITE_PATH`, `SHAREPOINT_FILE_PATH`.
5. Ajustar `COLUMN_MAP` en `backend/app/data/schema.py` para que coincida con los encabezados reales del Excel.

Si el archivo es muy pesado para la API de Excel, use `GRAPH_READ_MODE=download`: descarga el `.xlsx` y lo procesa con pandas.
Para probar con una copia local del archivo, use `DATA_SOURCE=file` y `LOCAL_FILE_PATH`.

## Actualización de los datos

- El backend guarda el Excel en caché durante `CACHE_TTL_SECONDS` (120 s por defecto).
- El frontend se refresca solo cada 2 minutos. El botón ⟳ fuerza la sincronización.
- Si una lectura falla, se siguen mostrando los últimos datos válidos y se indica el error.
- Fase 5: suscripción a notificaciones de cambio de Microsoft Graph (webhook) para actualizar en cuanto se guarde el Excel.

## Hoja de ruta

1. ✅ Base del proyecto, login Microsoft, dashboard con datos simulados
2. ⏳ Conexión a SharePoint vía Graph (código listo; faltan credenciales de la empresa)
3. ⏳ Mapeo de columnas reales y KPIs acordados con la gerencia
4. ⏳ Vistas Clientes, Aduanas y Reportes, y exportación a PDF/Excel
5. ⏳ Webhooks de Graph, histórico de KPIs (PostgreSQL), despliegue en Azure
