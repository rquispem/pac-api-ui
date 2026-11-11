// Servidor único: sirve el portal (public/) y un Mock Server basado en spec.json (contrato + ejemplos).
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 3001;
const PUB = path.join(__dirname, 'public');
const spec = JSON.parse(fs.readFileSync(path.join(PUB, 'spec.json'), 'utf8'));

// ---- Tabla de rutas del mock ----
const routes = [];
for (const [p, item] of Object.entries(spec.paths))
  for (const [method, op] of Object.entries(item)) {
    if (!op || typeof op !== 'object' || !op.responses) continue;
    routes.push({ method: method.toUpperCase(), op, re: new RegExp('^' + p.replace(/\{[^}]+\}/g, '[^/]+') + '/?$'), p });
  }
routes.sort((a, b) => a.p.replace(/\{[^}]+\}/g, '').length < b.p.replace(/\{[^}]+\}/g, '').length ? 1 : -1);

// ---- Generación de ejemplo desde esquema (fallback) ----
function fromSchema(s, d = 0) {
  if (!s || d > 6) return null;
  if (s.example !== undefined) return s.example;
  if (s.examples?.length) return s.examples[0];
  if (s.default !== undefined) return s.default;
  if (s.const !== undefined) return s.const;
  if (s.enum) return s.enum[0];
  if (s.allOf) return Object.assign({}, ...s.allOf.map((x) => fromSchema(x, d + 1)));
  const alt = s.oneOf || s.anyOf; if (alt) return fromSchema(alt[0], d + 1);
  const t = Array.isArray(s.type) ? s.type.find((x) => x !== 'null') : s.type;
  if (t === 'object' || s.properties) return Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, fromSchema(v, d + 1)]));
  if (t === 'array') return [fromSchema(s.items, d + 1)];
  if (t === 'integer' || t === 'number') return s.minimum ?? 1;
  if (t === 'boolean') return true;
  if (s.format === 'date-time') return new Date().toISOString();
  if (s.format === 'date') return new Date().toISOString().slice(0, 10);
  if (s.format === 'uuid') return '8ee17213-cbaa-4f35-bae2-7a1e4c2ed8d1';
  return 'string';
}
function exampleOf(resp) {
  const c = resp?.content?.['application/json'];
  if (!c) return undefined;
  if (c.example !== undefined) return c.example;
  if (c.examples) { const f = Object.values(c.examples)[0]; if (f) return f.value; }
  return fromSchema(c.schema);
}

function send(res, status, body, extra = {}) {
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', ...extra };
  res.writeHead(status, h);
  res.end(body === undefined ? '' : JSON.stringify(body, null, 2));
}
function error(res, op, status, fallbackCode, msg) {
  const ex = exampleOf(op?.responses?.[status]) || { status: 'ERROR', code: fallbackCode, message: msg, retryable: false };
  send(res, status, { ...ex, message: msg || ex.message }, { 'X-Request-ID': ex.requestId || 'mock-request-id', 'X-Mock': 'true' });
}

function handleMock(req, res, url, body) {
  const route = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
  if (!route) {
    const known = routes.some((r) => r.re.test(url.pathname));
    return send(res, known ? 405 : 404, { status: 'ERROR', code: known ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND', message: 'Ruta no definida en el contrato OpenAPI.' });
  }
  const { op } = route;
  // 1. Autenticación (Bearer no vacío)
  const needsAuth = op.security === undefined || op.security.length > 0;
  const auth = req.headers.authorization || '';
  if (needsAuth && !/^Bearer\s+\S+/i.test(auth)) return error(res, op, 401, 'UNAUTHORIZED', 'Credenciales ausentes o token inválido. Usa Authorization: Bearer mock-token');
  // 2. Forzar respuesta (útil para demostrar errores)
  const forced = url.searchParams.get('__status') || req.headers['x-mock-status'];
  if (forced && op.responses[forced]) {
    const st = Number(forced);
    return send(res, st, exampleOf(op.responses[forced]), { 'X-Request-ID': 'mock-request-id', 'X-Mock': 'true' });
  }
  // 3. Validación mínima: headers requeridos y campos requeridos del body
  const missingH = (op.parameters || []).filter((p) => p.in === 'header' && p.required && !req.headers[p.name.toLowerCase()]).map((p) => p.name);
  if (missingH.length) return error(res, op, 400, 'INVALID_REQUEST', `Falta header requerido: ${missingH.join(', ')}`);
  const schema = op.requestBody?.content?.['application/json']?.schema;
  if (schema?.required?.length) {
    let json = {}; try { json = JSON.parse(body || '{}'); } catch { return error(res, op, 400, 'INVALID_REQUEST', 'JSON inválido en el body.'); }
    const missing = schema.required.filter((k) => json[k] === undefined);
    if (missing.length) return error(res, op, 400, 'INVALID_REQUEST', `Campos requeridos ausentes: ${missing.join(', ')}`);
  }
  // 4. Respuesta de éxito (la 2xx más baja)
  const ok = Object.keys(op.responses).filter((c) => /^2/.test(c)).sort()[0] || '200';
  const hdr = { 'X-Request-ID': req.headers['x-request-id'] || 'mock-request-id', 'X-Mock': 'true' };
  const ex = exampleOf(op.responses[ok]);
  if (ok === '204' || ex === undefined) { res.writeHead(Number(ok), { 'Access-Control-Allow-Origin': '*', ...hdr }); return res.end(); }
  setTimeout(() => send(res, Number(ok), ex, hdr), 150); // latencia simulada
}

// ---- Estáticos ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.yml': 'text/yaml', '.ico': 'image/x-icon' };
function serveStatic(req, res, url) {
  let f = path.normalize(path.join(PUB, url.pathname === '/' ? 'index.html' : url.pathname));
  if (url.pathname === '/openapi.yml') f = path.join(__dirname, 'openapi.yml');
  else if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(data);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': '*' });
    return res.end();
  }
  if (url.pathname === '/health') return send(res, 200, { ok: true });
  const isApi = routes.some((r) => r.re.test(url.pathname));
  if (isApi) {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => handleMock(req, res, url, body));
  } else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url);
  else handleMock(req, res, url, '');
}).listen(PORT, () => console.log(`\n  Portal + Mock listos en http://localhost:${PORT}\n`));
