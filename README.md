# PAC Developer Portal + Mock Server

Portal de documentación de la API **CCE PAC as a Service** (generado desde OpenAPI v0.4.1) con un mock server integrado. Un solo proceso Node sirve ambos.

## Estructura

| Ruta | Descripción |
|---|---|
| `openapi.yml` | Fuente de verdad (especificación OpenAPI). Todo se genera desde aquí. |
| `scripts/build.js` | Convierte `openapi.yml` en `public/spec.json` (con `$ref` resueltos). |
| `server.js` | Sirve el portal (`/`) y el mock (rutas de la API) en el mismo puerto. |
| `public/` | UI del portal (`index.html`, `app.js`, `styles.css`). |
| `Dockerfile`, `render.yaml` | Archivos de despliegue. |

## Ejecutar en local

Requisitos: Node.js 18 o superior.

```bash
cd portal
npm install
npm start
```

Abre http://localhost:3001. `npm start` regenera `spec.json` y levanta el servidor.

Variable opcional: `PORT` (por defecto `3001`), por ejemplo `PORT=8080 npm start`.

### Probar el mock

```bash
curl -H "Authorization: Bearer mock-token" http://localhost:3001/api/v1/payments/pay_1
```

Comportamiento del mock:
- Requiere un `Authorization: Bearer <token>` no vacío (si no, 401).
- Responde con el ejemplo de la respuesta 2xx del contrato (o uno generado desde el esquema).
- Valida headers y campos requeridos del body (400 con el ejemplo de error del contrato).
- Forzar otra respuesta: `?__status=422` o header `X-Mock-Status: 422`.
- `GET /health` devuelve `{"ok":true}`.

### Actualizar la API

1. Reemplaza `openapi.yml` por la nueva versión.
2. Reinicia con `npm start` (o ejecuta `npm run build`).

## Desplegar en la nube

### Opción recomendada: Render.com

1. Inicializa y sube el código a GitHub:
   ```bash
   cd portal
   git init && git add . && git commit -m "PAC developer portal"
   git remote add origin <URL_DE_TU_REPO> && git push -u origin main
   ```
2. En https://render.com crea una cuenta y conecta GitHub.
3. **New → Blueprint** y selecciona el repo (usa `render.yaml`). Alternativa manual: **New → Web Service** con
   Build Command `npm ci && npm run build`, Start Command `node server.js`, Health Check Path `/health`.
4. Elige el plan: *Free* (se duerme tras 15 min inactivo; el primer acceso tarda ~30 s) o *Starter* (~7 USD/mes, siempre activo).
5. Al terminar tendrás una URL pública `https://<nombre>.onrender.com`. Opcional: **Settings → Custom Domains**.

### Alternativa: Docker en cualquier host (Fly.io, Railway, VPS)

```bash
docker build -t pac-portal .
docker run -d -p 80:3001 --restart unless-stopped pac-portal
```

En un VPS, añade HTTPS con Caddy delante (`caddy reverse-proxy --from tu-dominio.com --to localhost:3001`).

## Notas

- El portal y el mock son públicos y sin login; solo contienen los ejemplos del contrato.
- Las URLs de Sandbox/Producción del selector salen de `servers` en `openapi.yml`; actualízalas cuando existan las reales.
