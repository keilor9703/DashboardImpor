# SIACOMEX · Torre de control logística

Producto de **SIACOMEX** (Agencia de Aduanas Nivel 1) para **Kimberly-Clark**, desarrollado por **Techstack Colombia S.A.S.**
La marca (nombres y logos) se configura en `frontend/src/components/Brand.tsx` y `frontend/public/brand/`.

Dashboard web que lee el Excel de seguimiento logístico alojado en **SharePoint
(Microsoft 365)** y lo convierte en indicadores, gráficos y alertas para la
gerencia. El acceso se hace con la **cuenta corporativa de Microsoft**.

## Qué muestra (fase 2, con el Excel real `Insumos/Insumo1.xlsx`)

- **KPIs:** embarques, valor movilizado (USD), contenedores, lead time total (PDT),
  cumplimiento de PDT y tiempo de nacionalización. Cada uno con su variación
  frente al período anterior y su tendencia mensual.
- **Torre de control:** embarques abiertos por estado (pendiente de recogida →
  pendiente de zarpe → tránsito internacional → en nacionalización → pendiente
  de entrega → ingresado a SAP).
- **Lead time por etapa vs. meta**, por ruta: gestión de la orden, transporte a
  puerto, tránsito internacional, nacionalización, transporte local e ingreso a SAP.
  Replica la hoja «In Transit PDT».
- **Desempeño por ruta**, **próximos arribos**, **embarques fuera de meta**,
  tránsito por naviera, valor por franquicia y canal aduanero.
- **Embarques:** tabla con búsqueda (embarque, PO, contenedor, SKU, producto) y
  panel de detalle con hitos, etapas vs. meta, datos logísticos y productos.
- **Calidad de datos:** hallazgos del Excel que afectan los indicadores.

### Modelo de datos

| Concepto | Regla |
|---|---|
| Línea | Una fila de «Sheet1» (SKU / línea de PO). Se ignoran las filas sin «Status». |
| Embarque | «Export Number»; si no hay, «Shipment Reference»; si no, la PO |
| Unidad PDT | Embarque + PO (igual que la hoja «In Transit PDT») |
| Valor USD | Factura impo (USD) → valor PO → factura expo (COP ÷ TRM) |
| Fecha del período | ATD → Pick Up → First ETD → Expo Month → fecha de la PO |
| PDT | SAP Entry Date − PO Generation Date |
| Metas | `backend/app/data/targets.py` (oficiales de «In Transit PDT»; referenciales para rutas sin meta) |

Los encabezados del Excel se mapean en `backend/app/data/schema.py` (`COLUMN_MAP`).

```
Excel en SharePoint ──Microsoft Graph (solo lectura)──▶ Backend FastAPI + pandas ──API REST + token──▶ Frontend React + Apache ECharts
                                                         (caché, KPIs, validación)                     (login Microsoft, dashboard)
```

## Estructura

```
backend/            API en Python (FastAPI)
  app/config.py       Configuración por variables de entorno
  app/auth.py         Validación de tokens de Microsoft Entra ID
  app/data/schema.py  Mapeo de columnas del Excel, limpieza y campos derivados
  app/data/targets.py Metas de lead time por ruta y etapa
  app/data/sources.py Fuentes: mock | file (.xlsx local) | graph (SharePoint); lectura en streaming de bajo consumo
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

Por defecto, `.env.example` usa el Excel de `Insumos/Insumo1.xlsx` (`DATA_SOURCE=file`).
Si ya tenía un `.env` de la fase 1, agregue `DATA_SOURCE=file` y
`LOCAL_FILE_PATH=../Insumos/Insumo1.xlsx`, e instale de nuevo las dependencias
(`pip install -r requirements.txt`).

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

**En Windows (PowerShell)**, use estos comandos en el backend (PowerShell 5 no acepta `&&`):

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1          # si lo bloquea: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload --port 8000
```

Con Docker: `cp backend/.env.example backend/.env && docker compose up --build` → http://localhost:8080

Pruebas del backend: `cd backend && pytest`

## Publicación: frontend en Vercel + backend en Render

```
Navegador ──▶ Vercel (frontend React)  ──HTTPS──▶  Render (FastAPI)  ──lee──▶  Insumos/Insumo1.xlsx (en el repo)
```

### 1. Backend en Render
1. En render.com: **New + → Blueprint** y seleccione este repositorio. Render lee `render.yaml`.
2. Complete las variables marcadas como `sync: false`:
   - `AUTH_USERS`: usuarios con su contraseña cifrada, `usuario:hash;usuario2:hash`. El hash se genera en su PC con
     `cd backend` y `python -m app.passwords`.
   - `CORS_ORIGINS`: la URL del frontend en Vercel, ej. `https://comex-dashboard.vercel.app`.
3. Al terminar, la API queda en `https://comex-dashboard-api.onrender.com`. Verifíquela en `/api/health`.

El plan **free** se duerme tras 15 minutos sin uso; la primera visita después tarda ~1 minuto.
Para uso diario de la gerencia se recomienda el plan **Starter** (siempre activo).

### 2. Frontend en Vercel
1. En vercel.com: **Add New → Project**, importe el repositorio y en **Root Directory** elija `frontend`.
2. Variables de entorno:
   - `VITE_API_BASE_URL` = URL del backend en Render (sin `/` al final)
   - `VITE_AUTH_MODE` = `password`
3. Deploy. Copie la URL final en `CORS_ORIGINS` de Render.

### 3. Actualizar los datos
Reemplace `Insumos/Insumo1.xlsx` en el repositorio (mismo nombre) y haga push: Render vuelve a desplegar
solo. Cuando se configure SharePoint, cambie `DATA_SOURCE=graph` y el tablero leerá el Excel en vivo.

### Seguridad
- El backend **no arranca** en producción con `AUTH_MODE=demo`.
- Las contraseñas se guardan cifradas (PBKDF2); las sesiones duran 12 horas (`AUTH_SESSION_HOURS`).
- El Excel contiene datos reales de la empresa: **mantenga el repositorio privado**.
- Cuando la empresa configure Microsoft Entra ID, cambie a `AUTH_MODE=entra` (backend) y
  `VITE_AUTH_MODE=entra` + variables `VITE_AZURE_*` (frontend).

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Estado del servicio |
| GET | `/api/me` | Usuario autenticado |
| GET | `/api/dashboard` | KPIs, series y alertas. Filtros: `desde`, `hasta`, `modo`, `origen`, `destino`, `franquicia`, `forwarder` |
| GET | `/api/filtros` | Valores disponibles para los filtros |
| GET | `/api/embarques` | Tabla paginada de embarques (`q`, `estado`, `orden`, `desc`, `pagina`, `tamano`) |
| GET | `/api/embarques/{id}` | Detalle: hitos, etapas vs. meta, contenedores y líneas |
| GET | `/api/datos/estado` | Estado de la fuente de datos y de la última sincronización |
| GET | `/api/datos/calidad` | Hallazgos de calidad de datos del Excel |
| GET | `/api/pdt` | Hoja «In Transit PDT» tal cual: 6 procesos + total con sus columnas |
| POST | `/api/auth/login` | Login con usuario y contraseña (`AUTH_MODE=password`) |
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

## Integración con Microsoft 365 (login y Excel en SharePoint)

La guía completa para TI de SIACOMEX, con los pasos en Entra ID y SharePoint, la configuración de
Render y Vercel y la solución de problemas, está en **[`docs/INTEGRACION_MICROSOFT.md`](docs/INTEGRACION_MICROSOFT.md)**.

En resumen:
- **Una sola aplicación** en Entra ID para el login de los usuarios y para que el backend lea el Excel.
- **Usuarios de Kimberly-Clark como invitados (B2B)**; el acceso se controla con el rol `Dashboard.Viewer`.
- **Excel:** permiso `Sites.Selected` (solo lectura del sitio del archivo). Basta con `SHAREPOINT_FILE_URL`
  (la URL de «Copiar ruta de acceso»). El backend consulta la versión del archivo y solo lo descarga si cambió.
- **Diagnóstico:** `python -m app.check_microsoft` revisa la configuración y la conexión paso a paso.

El archivo se lee en streaming y se detiene donde terminan los datos, así que tolera filas vacías con formato
(menos de 1 s y ~100 MB de RAM, aunque la hoja declare un millón de filas). Para probar con una copia local,
use `DATA_SOURCE=file` y `LOCAL_FILE_PATH`.

## Actualización de los datos

- El backend guarda el Excel en caché durante `CACHE_TTL_SECONDS` (300 s en Render).
  Al vencer, sigue respondiendo con los datos actuales mientras relee el archivo en segundo plano.
- El frontend se refresca solo cada 2 minutos. El botón ⟳ fuerza la sincronización.
- Si una lectura falla, se siguen mostrando los últimos datos válidos y se indica el error.
- Fase 5: suscripción a notificaciones de cambio de Microsoft Graph (webhook) para actualizar en cuanto se guarde el Excel.

## Hoja de ruta

1. ✅ Base del proyecto, login Microsoft, dashboard con datos simulados
2. ✅ Modelo de datos del Excel real, torre de control logística, PDT vs. meta, calidad de datos
3. ⏳ Conexión a SharePoint y login con Microsoft: código listo y probado; falta la configuración de TI (docs/INTEGRACION_MICROSOFT.md)
4. ⏳ Vistas Aduanas y Reportes, exportación a PDF/Excel e histórico de PDT
5. ⏳ Webhooks de Graph, histórico de KPIs (PostgreSQL), despliegue en Azure
