# Integración con Microsoft 365 — Guía para TI de SIACOMEX

**Torre de control logística SIACOMEX** · Desarrollado por Techstack Colombia S.A.S.

Esta guía configura dos cosas en el Microsoft 365 de **SIACOMEX**:

1. **Inicio de sesión con cuenta de Microsoft** para usuarios de SIACOMEX y de Kimberly-Clark (como invitados).
2. **Lectura del Excel de seguimiento directamente desde SharePoint**, en solo lectura y solo sobre el sitio del archivo.

**Tiempo estimado:** 45–60 minutos · **Se necesita:** una cuenta con rol **Administrador de aplicaciones en la nube**
(o Administrador global) en Entra ID, y **Administrador de SharePoint** (o Administrador global) para el paso 8.

> Se crea **una sola aplicación** en Entra ID. La aplicación **no** tiene acceso al resto de SharePoint,
> al correo ni a OneDrive: solo puede **leer** el sitio donde está el Excel.

---

## Paso 0 · Datos que se necesitan

| Dato | Cómo obtenerlo |
|---|---|
| **URL del Excel** | Abra el archivo en Excel de escritorio → **Archivo → Información → Copiar ruta de acceso**. Ej.: `https://siacomex.sharepoint.com/sites/Operaciones/Shared Documents/Kimberly/Seguimiento.xlsx` |
| **URL del tablero** | `https://dashboardimpor.vercel.app` |

---

## Paso 1 · Registrar la aplicación

[Centro de administración de Entra](https://entra.microsoft.com) → **Aplicaciones → Registros de aplicaciones → Nuevo registro**

- **Nombre:** `SIACOMEX Torre de Control`
- **Tipos de cuenta compatibles:** *Solo las cuentas de este directorio organizativo (inquilino único)*
- **URI de redirección:** plataforma **Aplicación de página única (SPA)** → `https://dashboardimpor.vercel.app`
- **Registrar**

En **Información general**, anote:
- **Id. de aplicación (cliente)** → `CLIENT_ID`
- **Id. de directorio (inquilino)** → `TENANT_ID`

Opcional (pruebas locales de Techstack): en **Autenticación → SPA**, agregue también `http://localhost:5173`.

## Paso 2 · Exponer la API (para el inicio de sesión)

En la aplicación → **Exponer una API**:
1. **URI de id. de aplicación → Agregar** → acepte `api://<CLIENT_ID>` → Guardar.
2. **Agregar un ámbito:**
   - Nombre del ámbito: `Dashboard.Read`
   - Quién puede dar el consentimiento: *Administradores y usuarios*
   - Nombre para mostrar: `Ver la torre de control` · Descripción: `Permite ver el tablero de SIACOMEX`
   - Estado: Habilitado → **Agregar ámbito**

## Paso 3 · Tokens versión 2

En la aplicación → **Manifiesto**, busque y ajuste (según el editor que muestre el portal):
- Editor nuevo: `"api": { "requestedAccessTokenVersion": 2 }`
- Editor clásico: `"accessTokenAcceptedVersion": 2`

**Guardar.**

## Paso 4 · Rol de acceso

En la aplicación → **Roles de aplicación → Crear rol de aplicación**:
- Nombre para mostrar: `Lector del tablero`
- Tipos de miembros permitidos: **Usuarios o grupos**
- Valor: `Dashboard.Viewer`  ← *exactamente así*
- Descripción: `Puede ver la torre de control` · Habilitado → **Aplicar**

## Paso 5 · Permisos de API

En la aplicación → **Permisos de API → Agregar un permiso**:
1. **Mis API** → `SIACOMEX Torre de Control` → **Permisos delegados** → `Dashboard.Read` → Agregar.
2. **Microsoft Graph** → **Permisos de aplicación** → `Sites.Selected` → Agregar.
3. Pulse **Conceder consentimiento de administrador para SIACOMEX** → Sí.

Ambos permisos deben quedar con estado **Concedido** (marca verde).

## Paso 6 · Secreto de la aplicación

En la aplicación → **Certificados y secretos → Nuevo secreto de cliente**:
- Descripción: `Backend Render` · Expira: **24 meses** → Agregar.
- Copie el **Valor** (no el «Id. de secreto»). Solo se muestra una vez → `CLIENT_SECRET`.
- 📅 Cree un recordatorio para renovarlo antes de que expire; al vencer, el tablero deja de leer el Excel.

## Paso 7 · Quién puede entrar

[Entra](https://entra.microsoft.com) → **Aplicaciones → Aplicaciones empresariales** → `SIACOMEX Torre de Control`:
1. **Propiedades → ¿Se requiere asignación?** = **Sí** → Guardar.
   *(Sin esto, cualquier usuario del directorio podría iniciar sesión).*
2. Recomendado: cree un grupo de seguridad, p. ej. `Torre de control - Lectores`.
3. **Usuarios y grupos → Agregar usuario o grupo** → seleccione el grupo (o usuarios) → rol **Lector del tablero** → Asignar.

### Usuarios de Kimberly-Clark (invitados)

**Usuarios → Todos los usuarios → Nuevo usuario → Invitar a un usuario externo** → correo corporativo de la persona
de Kimberly-Clark → Invitar. Luego agréguela al grupo del punto 2.

La persona recibe un correo de invitación y, al aceptarla, entra al tablero con **su propia cuenta de Kimberly-Clark**.
Si la invitación no se puede aceptar, es probable que TI de Kimberly-Clark deba permitir el acceso B2B saliente hacia
el tenant de SIACOMEX (*Configuración de acceso entre inquilinos*).

## Paso 8 · Permiso de lectura sobre el sitio del Excel (`Sites.Selected`)

Con `Sites.Selected`, la aplicación no ve **ningún** sitio hasta que se le otorgue uno explícitamente.
Lo hace un **Administrador de SharePoint o global**. Elija una opción:

### Opción A — Graph Explorer (navegador)
1. Abra [Graph Explorer](https://developer.microsoft.com/graph/graph-explorer) e inicie sesión con la cuenta administradora.
   Si lo solicita, dé consentimiento a `Sites.FullControl.All` en **Modificar permisos**.
2. Obtenga el id del sitio (reemplace `Operaciones` por el sitio real):
   ```
   GET https://graph.microsoft.com/v1.0/sites/siacomex.sharepoint.com:/sites/Operaciones
   ```
   Copie el campo `id` de la respuesta → `SITE_ID`.
3. Otorgue lectura a la aplicación:
   ```
   POST https://graph.microsoft.com/v1.0/sites/{SITE_ID}/permissions
   {
     "roles": ["read"],
     "grantedToIdentities": [
       { "application": { "id": "<CLIENT_ID>", "displayName": "SIACOMEX Torre de Control" } }
     ]
   }
   ```
4. Verifique: `GET https://graph.microsoft.com/v1.0/sites/{SITE_ID}/permissions` debe listar la aplicación con rol `read`.

### Opción B — PowerShell (PnP)
```powershell
Connect-PnPOnline -Url https://siacomex-admin.sharepoint.com -Interactive -ClientId <ID_DE_SU_APP_PNP>
Grant-PnPAzureADAppSitePermission -AppId <CLIENT_ID> -DisplayName "SIACOMEX Torre de Control" `
  -Site https://siacomex.sharepoint.com/sites/Operaciones -Permissions Read
```

---

## Paso 9 · Entregar los datos a Techstack

| Dato | Valor |
|---|---|
| `TENANT_ID` | Paso 1 |
| `CLIENT_ID` | Paso 1 |
| `CLIENT_SECRET` | Paso 6 — **por un canal seguro** (gestor de contraseñas o directamente en Render). **No por correo ni chat.** |
| URL del Excel | Paso 0 |

---

## Anexo técnico · Configuración del tablero (Techstack)

Se recomienda activarlo en **dos fases**, para aislar cualquier problema:

### Fase A — Excel desde SharePoint (el login sigue con usuario y contraseña)

**Render** → servicio `comex-dashboard-api` → **Environment**:

| Variable | Valor |
|---|---|
| `DATA_SOURCE` | `graph` |
| `AZURE_TENANT_ID` | `TENANT_ID` |
| `AZURE_API_CLIENT_ID` | `CLIENT_ID` |
| `GRAPH_CLIENT_SECRET` | `CLIENT_SECRET` |
| `SHAREPOINT_FILE_URL` | URL del Excel |
| `EXCEL_SHEET_NAME` | `Sheet1` |

Verificación:
- En el tablero → **Fuente y calidad**: debe decir *Excel en SharePoint* con el nombre del archivo, quién lo modificó y cuándo.
- O en un equipo con el backend: definir las mismas variables y ejecutar `python -m app.check_microsoft`
  (revisa credenciales, permiso sobre el sitio y lectura de ambas hojas, y explica qué corregir).

El backend consulta la versión del archivo cada `CACHE_TTL_SECONDS` (300 s) y **solo lo descarga si cambió**.

### Fase B — Inicio de sesión con Microsoft

**Render** (además de lo anterior):

| Variable | Valor |
|---|---|
| `AUTH_MODE` | `entra` |
| `AZURE_API_AUDIENCE` | `api://<CLIENT_ID>` |
| `AUTH_REQUIRED_ROLE` | `Dashboard.Viewer` |

**Vercel** → proyecto → **Settings → Environment Variables** → luego **Redeploy**:

| Variable | Valor |
|---|---|
| `VITE_AUTH_MODE` | `entra` |
| `VITE_AZURE_CLIENT_ID` | `CLIENT_ID` |
| `VITE_AZURE_TENANT_ID` | `TENANT_ID` |
| `VITE_API_SCOPE` | `api://<CLIENT_ID>/Dashboard.Read` |

`AUTH_USERS` y `AUTH_SECRET` dejan de usarse (se pueden conservar para volver atrás).

### Volver atrás
- Excel: `DATA_SOURCE=file` (usa `Insumos/Insumo1.xlsx` del repositorio).
- Login: `AUTH_MODE=password` (Render) y `VITE_AUTH_MODE=password` (Vercel + Redeploy).

### Solución de problemas

| Síntoma / código | Causa probable | Solución |
|---|---|---|
| `AADSTS50011` (redirect URI) | La URL del tablero no está en la app | Paso 1: agregar la URL exacta como **SPA** |
| `AADSTS65001` (consentimiento) | Falta consentimiento del ámbito | Paso 5: **Conceder consentimiento de administrador** |
| `AADSTS50020` (usuario de otro inquilino) | La persona de Kimberly-Clark no fue invitada | Paso 7: invitarla como usuario externo |
| `AADSTS50105` (no asignado) | Usuario sin asignación y «Se requiere asignación» = Sí | Paso 7: asignarlo al grupo / rol |
| Pantalla «Su cuenta no tiene acceso al tablero» | Entró, pero sin el rol `Lector del tablero` | Paso 7: asignar el rol |
| «Sin permiso para el sitio de SharePoint» | Falta el permiso del paso 8 o el consentimiento de `Sites.Selected` | Pasos 5 y 8 |
| «El secreto … es incorrecto / venció» | Se copió el Id. del secreto o expiró | Paso 6: crear uno nuevo y actualizar Render |
| «No se encontró el archivo» | URL incorrecta o el archivo se movió/renombró | Actualizar `SHAREPOINT_FILE_URL` |
