(async function () {
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const spec = await (await fetch('spec.json')).json();
const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

// ---------- Datos ----------
const ops = [];
for (const [p, item] of Object.entries(spec.paths))
  for (const [m, op] of Object.entries(item)) if (op?.responses) ops.push({ ...op, method: m, path: p, kind: 'op' });
for (const [name, item] of Object.entries(spec.webhooks))
  for (const [m, op] of Object.entries(item)) ops.push({ ...op, method: m, path: name, kind: 'wh', operationId: op.operationId || name });
const byId = Object.fromEntries(ops.map((o) => [o.operationId, o]));
const tagDesc = Object.fromEntries(spec.tags.map((t) => [t.name, t.description]));
const opsOf = (tag) => ops.filter((o) => o.tags?.[0] === tag);

// ---------- Utilidades ----------
function md(s = '') {
  const inline = (t) => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  let html = '', list = false;
  for (const line of String(s).split('\n')) {
    const li = line.match(/^\s*[-*]\s+(.*)/);
    if (li) { if (!list) { html += '<ul>'; list = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    if (list) { html += '</ul>'; list = false; }
    const h = line.match(/^#{1,4}\s+(.*)/);
    if (h) html += `<h4>${inline(h[1])}</h4>`; else if (line.trim()) html += `<p>${inline(line)}</p>`;
  }
  return html + (list ? '</ul>' : '');
}
const typeOf = (s) => {
  if (!s) return 'any';
  if (s['x-circular']) return s['x-circular'];
  let t = Array.isArray(s.type) ? s.type.filter((x) => x !== 'null').join(' | ') : s.type;
  if (s.oneOf || s.anyOf) t = 'oneOf';
  if (s.type === 'array' || (Array.isArray(s.type) && s.type.includes('array'))) t = `array<${typeOf(s.items)}>`;
  if (!t && s.properties) t = 'object';
  if (s.format) t += ` (${s.format})`;
  return t || 'any';
};
function sample(s, d = 0) {
  if (!s || d > 6) return null;
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;
  if (s.enum) return s.enum[0];
  if (s.allOf) return Object.assign({}, ...s.allOf.map((x) => sample(x, d + 1)));
  if (s.oneOf || s.anyOf) return sample((s.oneOf || s.anyOf)[0], d + 1);
  const t = Array.isArray(s.type) ? s.type.find((x) => x !== 'null') : s.type;
  if (t === 'object' || s.properties) return Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, sample(v, d + 1)]));
  if (t === 'array') return [sample(s.items, d + 1)];
  if (t === 'integer' || t === 'number') return 0;
  if (t === 'boolean') return true;
  return 'string';
}
const jsonContent = (x) => x?.content?.['application/json'];
function exampleOf(x) {
  const c = jsonContent(x); if (!c) return undefined;
  if (c.example !== undefined) return c.example;
  if (c.examples) { const f = Object.values(c.examples)[0]; if (f) return f.value; }
  return sample(c.schema);
}
const pretty = (o) => JSON.stringify(o, null, 2);
function hl(json) {
  return String(json).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+\.?\d*)/g, (m, str, colon, b, n) =>
    str ? (colon ? `<span class="tk-k">${str}</span>${colon}` : `<span class="tk-s">${str}</span>`) : b ? `<span class="tk-b">${b}</span>` : `<span class="tk-n">${n}</span>`);
}
const baseUrl = () => $('#server').value.replace(/\/$/, '');
const token = () => $('#token').value || 'mock-token';

// ---------- Esquemas ----------
function fields(schema, requiredList = [], depth = 0) {
  if (!schema) return '';
  if (schema.allOf) schema = { ...schema, properties: Object.assign({}, ...schema.allOf.map((x) => x.properties || {}), schema.properties), required: [].concat(...schema.allOf.map((x) => x.required || []), schema.required || []) };
  if (schema.type === 'array' && schema.items) return `<div class="desc">Arreglo de <code>${esc(typeOf(schema.items))}</code></div>` + fields(schema.items, [], depth);
  const props = schema.properties || {};
  const alt = schema.oneOf || schema.anyOf;
  let html = Object.entries(props).map(([name, s]) => field(name, s, (schema.required || []).includes(name), depth)).join('');
  if (alt) html += alt.map((a, i) => `<details class="sub"><summary>Variante ${i + 1}${a['x-ref-name'] ? ` · ${esc(a['x-ref-name'])}` : ''}</summary><div class="kids">${fields(a, [], depth + 1)}</div></details>`).join('');
  return html || '<div class="desc">Sin propiedades.</div>';
}
function field(name, s, required, depth, loc) {
  const inner = s.type === 'array' ? s.items : s;
  const hasKids = inner && (inner.properties || inner.allOf || inner.oneOf) && !inner['x-circular'];
  const en = (s.enum || inner?.enum);
  return `<div class="fld"><div class="h"><span class="n">${esc(name)}</span><span class="t">${esc(typeOf(s))}</span>${loc ? `<span class="loc">${loc}</span>` : ''}${required ? '<span class="req">requerido</span>' : ''}</div>
  ${s.description ? `<div class="desc">${md(s.description)}</div>` : ''}
  ${en ? `<div class="enum">${en.map((e) => `<span>${esc(e)}</span>`).join('')}</div>` : ''}
  ${s.example !== undefined && typeof s.example !== 'object' ? `<div class="desc">Ej: <code>${esc(s.example)}</code></div>` : ''}
  ${hasKids ? `<details class="sub" ${depth < 0 ? 'open' : ''}><summary>${esc(inner['x-ref-name'] || 'Ver propiedades')}</summary><div class="kids">${fields(inner, [], depth + 1)}</div></details>` : ''}</div>`;
}

// ---------- Snippets ----------
function reqParts(op) {
  const headers = { Authorization: `Bearer ${token()}` };
  let url = baseUrl() + (op.path);
  const query = [];
  for (const p of op.parameters || []) {
    const v = p.example ?? p.schema?.example ?? p.schema?.default ?? (p.schema?.enum ? p.schema.enum[0] : undefined);
    if (p.in === 'path') url = url.replace(`{${p.name}}`, encodeURIComponent(v ?? `{${p.name}}`));
    else if (p.in === 'header' && p.required) headers[p.name] = String(v ?? 'mock-' + p.name.toLowerCase());
    else if (p.in === 'query' && p.required) query.push(`${p.name}=${encodeURIComponent(v ?? '')}`);
  }
  if (query.length) url += '?' + query.join('&');
  const body = op.requestBody ? exampleOf(op.requestBody) : undefined;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return { url, headers, body, method: op.method.toUpperCase() };
}
const SNIPS = {
  curl: ({ url, headers, body, method }) => `curl -X ${method} '${url}' \\\n` + Object.entries(headers).map(([k, v]) => `  -H '${k}: ${v}'`).join(' \\\n') + (body !== undefined ? ` \\\n  -d '${JSON.stringify(body)}'` : ''),
  javascript: ({ url, headers, body, method }) => `const res = await fetch('${url}', {\n  method: '${method}',\n  headers: ${JSON.stringify(headers, null, 4).replace(/\n}/, '\n  }')}${body !== undefined ? `,\n  body: JSON.stringify(${JSON.stringify(body, null, 2).replace(/\n/g, '\n  ')})` : ''}\n});\nconst data = await res.json();`,
  python: ({ url, headers, body, method }) => `import requests\n\nres = requests.request(\n    "${method}", "${url}",\n    headers=${JSON.stringify(headers, null, 4).replace(/\n}/, '\n    }')}${body !== undefined ? `,\n    json=${JSON.stringify(body, null, 4).replace(/\n/g, '\n    ').replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False').replace(/\bnull\b/g, 'None')}` : ''}\n)\nprint(res.json())`,
};
let snipLang = store.get('lang', 'curl');

// ---------- Vistas ----------
function nav() {
  let h = '<a class="home" href="#/" data-r="/">🏠 Introducción</a>';
  for (const g of spec.tagGroups) {
    h += `<h6>${esc(g.name)}</h6>`;
    for (const t of g.tags) {
      h += `<div class="tag">${esc(t)}</div>`;
      h += opsOf(t).map((o) => `<a class="it" href="#/${o.kind === 'wh' ? 'wh' : 'op'}/${o.operationId}" data-r="/${o.kind === 'wh' ? 'wh' : 'op'}/${o.operationId}"><span class="m ${o.kind === 'wh' ? 'wh' : o.method}">${o.kind === 'wh' ? 'EVENT' : o.method.toUpperCase()}</span>${esc(o.summary)}</a>`).join('');
    }
  }
  $('#nav').innerHTML = h;
}
function home() {
  const info = spec.info;
  const intro = info.description.split('###')[0].split('Cambios v0.3.0')[0];
  return `<section class="hero"><span class="pill">v${esc(info.version)}</span><h1>Construye pagos instantáneos con <span>PAC as a Service</span></h1>
  <p>${esc(info.summary)}</p><a class="btn pri" href="#/op/${ops[0].operationId}">Explorar la API</a> <a class="btn" href="openapi.yml" download>Descargar OpenAPI</a>
  <div class="stats"><div><b>${ops.filter((o) => o.kind === 'op').length}</b><span>Endpoints</span></div><div><b>${ops.filter((o) => o.kind === 'wh').length}</b><span>Webhooks</span></div><div><b>${spec.tagGroups.length}</b><span>Dominios</span></div><div><b>JWS</b><span>Firma de operaciones</span></div></div></section>
  <div class="wrap"><h2>Dominios de la API</h2><div class="grid">${spec.tagGroups.map((g) => {
    const first = opsOf(g.tags[0])[0]; const count = g.tags.reduce((a, t) => a + opsOf(t).length, 0);
    return `<a class="card" href="#/${first.kind === 'wh' ? 'wh' : 'op'}/${first.operationId}"><h3>${esc(g.name)}</h3><p>${esc(g.tags.join(' · '))}</p><div class="cnt">${count} operaciones →</div></a>`;
  }).join('')}</div>
  <h2>Primeros pasos</h2><ol class="steps">
   <li><b>Autenticación.</b> Todas las llamadas usan <code>Authorization: Bearer &lt;token&gt;</code>. En el mock sirve cualquier valor no vacío (ej. <code>mock-token</code>).</li>
   <li><b>Elige un servidor.</b> Usa el selector superior para apuntar a Mock, Sandbox o Producción.</li>
   <li><b>Prueba un endpoint.</b> Abre cualquier operación y pulsa <i>Probar</i> en el panel derecho para ejecutarla en vivo.</li>
   <li><b>Simula errores.</b> Añade <code>?__status=422</code> o el header <code>X-Mock-Status: 422</code> para recibir la respuesta de error documentada.</li>
   <li><b>Recibe eventos.</b> Registra tu webhook y procesa los eventos firmados con JWS de forma idempotente.</li></ol>
  <h2>Principios del contrato</h2><div class="md card" style="box-shadow:none">${md(intro.replace(/^Especificación[^\n]*\n/, ''))}</div></div>`;
}
function opView(op) {
  const isWh = op.kind === 'wh';
  const params = (op.parameters || []);
  const grp = (loc) => params.filter((p) => p.in === loc);
  const sect = (title, loc, label) => grp(loc).length ? `<h2>${title}</h2>${grp(loc).map((p) => field(p.name, { ...p.schema, description: p.description, example: p.example ?? p.schema?.example }, p.required, 0, label)).join('')}` : '';
  const bodySchema = jsonContent(op.requestBody)?.schema;
  const scopes = op['x-required-scopes'] || [];
  const codes = Object.keys(op.responses || {});
  const sel = codes.find((c) => /^2/.test(c)) || codes[0];
  return `<div class="op"><article><div class="crumb">${esc(op.tags?.[0] || '')}</div><h1>${esc(op.summary)}</h1>
  <div class="badges"><span class="badge mono">${esc(op.operationId)}</span>${scopes.map((s) => `<span class="badge sc mono">🔑 ${esc(s)}</span>`).join('')}${op['x-origin'] ? `<span class="badge">${esc(op['x-origin'])}</span>` : ''}</div>
  <div class="endpoint"><span class="m ${isWh ? 'wh' : op.method}">${isWh ? 'EVENT' : op.method.toUpperCase()}</span><span>${esc(isWh ? 'POST → URL de tu webhook (' + op.path + ')' : op.path)}</span></div>
  <div class="md">${md(op.description || '')}</div>
  ${op['x-tapp-mapping'] ? `<p class="note">Mapeo TAPP: ${op['x-tapp-mapping'].map((x) => `<code>${esc(x)}</code>`).join(' ')}</p>` : ''}
  ${sect('Path parameters', 'path', 'path')}${sect('Query parameters', 'query', 'query')}${sect('Headers', 'header', 'header')}
  ${bodySchema ? `<h2>Request body</h2>${fields(bodySchema)}` : ''}
  <h2>Respuestas</h2><div class="resp-tabs" id="rtabs">${codes.map((c) => `<button class="sc-pill s${c[0]} ${c === sel ? 'on' : ''}" data-c="${c}">${c}</button>`).join('')}</div>
  <div id="rdesc"></div></article>
  <aside class="side">
   ${isWh ? '' : `<div class="panel"><div class="bar"><span class="ttl">Request</span>${Object.keys(SNIPS).map((l) => `<button class="tabbtn ${l === snipLang ? 'on' : ''}" data-l="${l}">${l}</button>`).join('')}<button class="copy" id="copy1">Copiar</button></div><pre class="code" id="snip"></pre>
   <div class="try" id="try"></div></div>`}
   ${isWh ? `<div class="panel"><div class="bar"><span class="ttl">Payload del evento</span><button class="copy" id="copy1">Copiar</button></div><pre class="code" id="snip">${hl(pretty(exampleOf(op.requestBody)))}</pre></div>` : ''}
   <div class="panel"><div class="bar"><span class="ttl">Response</span><span id="rbadge" class="mono" style="color:#94a3b8;font-size:12px"></span></div><pre class="code" id="rex"></pre></div>
  </aside></div>`;
}
function bindOp(op) {
  const showResp = (c) => {
    const r = op.responses[c];
    $('#rdesc').innerHTML = `<div class="md">${md(r?.description || '')}</div>` + (jsonContent(r)?.schema ? fields(jsonContent(r).schema) : '');
    const ex = exampleOf(r);
    $('#rex').innerHTML = ex !== undefined ? hl(pretty(ex)) : '<span style="color:#64748b">Sin cuerpo</span>';
    $('#rbadge').textContent = c;
    document.querySelectorAll('#rtabs .sc-pill').forEach((b) => b.classList.toggle('on', b.dataset.c === c));
  };
  const first = Object.keys(op.responses).find((c) => /^2/.test(c)) || Object.keys(op.responses)[0];
  showResp(first);
  $('#rtabs').onclick = (e) => e.target.dataset.c && showResp(e.target.dataset.c);
  if (op.kind === 'wh') { $('#copy1').onclick = () => navigator.clipboard?.writeText(pretty(exampleOf(op.requestBody))); return; }
  const render = () => {
    const parts = reqParts(op); const txt = SNIPS[snipLang](parts);
    $('#snip').textContent = txt; $('#copy1').onclick = (e) => { navigator.clipboard?.writeText(txt); e.target.textContent = '¡Copiado!'; setTimeout(() => (e.target.textContent = 'Copiar'), 1200); };
  };
  render();
  document.querySelectorAll('.tabbtn').forEach((b) => (b.onclick = () => { snipLang = b.dataset.l; store.set('lang', snipLang); document.querySelectorAll('.tabbtn').forEach((x) => x.classList.toggle('on', x === b)); render(); }));
  window.__rerender = render;
  // Try it
  const parts = reqParts(op);
  const hdrs = Object.entries(parts.headers).filter(([k]) => k !== 'Authorization' && k !== 'Content-Type');
  $('#try').innerHTML = `<button class="send" id="tryBtn">▶ Probar en ${esc($('#server').selectedOptions[0]?.text.split(' – ')[0] || 'servidor')}</button><div id="tryForm" hidden>
    <label>URL</label><input id="t-url" value="${esc(parts.url)}">
    ${hdrs.length ? '<label>Headers</label>' + hdrs.map(([k, v]) => `<input class="t-h" data-k="${esc(k)}" value="${esc(v)}" title="${esc(k)}" placeholder="${esc(k)}">`).join('<div style="height:4px"></div>') : ''}
    ${parts.body !== undefined ? `<label>Body (JSON)</label><textarea id="t-body" spellcheck="false">${esc(pretty(parts.body))}</textarea>` : ''}
    <label>Forzar respuesta (mock)</label><input id="t-force" placeholder="ej. 422, 409, 202 — opcional">
    <button class="send" id="go">Enviar solicitud</button><div id="out"></div></div>`;
  $('#tryBtn').onclick = () => { $('#tryForm').hidden = !$('#tryForm').hidden; };
  $('#go').onclick = async () => {
    const h = { Authorization: `Bearer ${token()}` };
    if (parts.body !== undefined) h['Content-Type'] = 'application/json';
    document.querySelectorAll('.t-h').forEach((i) => (h[i.dataset.k] = i.value));
    const f = $('#t-force').value.trim(); if (f) h['X-Mock-Status'] = f;
    const t0 = performance.now(); $('#out').innerHTML = '<div class="res-head">Enviando…</div>';
    try {
      const r = await fetch($('#t-url').value, { method: parts.method, headers: h, body: parts.body !== undefined ? $('#t-body').value : undefined });
      const txt = await r.text(); let shown = txt; try { shown = pretty(JSON.parse(txt)); } catch {}
      $('#out').innerHTML = `<div class="res-head"><span class="st ${r.ok ? 'ok' : 'bad'}">${r.status} ${esc(r.statusText)}</span><span>${Math.round(performance.now() - t0)} ms</span></div><pre class="code" style="padding:10px 0;max-height:260px">${hl(shown)}</pre>`;
    } catch (e) { $('#out').innerHTML = `<div class="res-head"><span class="st bad">Error de red</span></div><div style="margin-top:6px">${esc(e.message)} — verifica el servidor seleccionado y CORS.</div>`; }
  };
}

// ---------- Router ----------
function route() {
  const [, kind, id] = location.hash.slice(1).split('/');
  const main = $('#main');
  let html;
  if ((kind === 'op' || kind === 'wh') && byId[id]) { html = opView(byId[id]); main.innerHTML = html; bindOp(byId[id]); document.title = `${byId[id].summary} · PAC Developers`; }
  else { main.innerHTML = home(); document.title = 'PAC as a Service · Developer Portal'; }
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === `/${kind || ''}${id ? '/' + id : ''}` || (!kind && a.dataset.r === '/')));
  $('#nav').classList.remove('open'); window.scrollTo(0, 0);
  document.querySelector('#nav a.on')?.scrollIntoView({ block: 'nearest' });
}

// ---------- Shell ----------
$('#server').innerHTML = [{ url: location.origin, description: 'Mock integrado (este servidor)' }, ...spec.servers.filter((s) => !/localhost/.test(s.url))]
  .map((s) => `<option value="${esc(s.url)}">${esc(s.description)} – ${esc(s.url)}</option>`).join('');
$('#server').value = store.get('server', location.origin); if (!$('#server').value) $('#server').selectedIndex = 0;
$('#token').value = store.get('token', 'mock-token');
$('#server').onchange = () => { store.set('server', $('#server').value); route(); };
$('#token').oninput = () => { store.set('token', $('#token').value); window.__rerender?.(); };
const setTheme = (t) => { document.documentElement.dataset.theme = t; store.set('theme', t); };
setTheme(store.get('theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
$('#theme').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
$('#menu').onclick = () => $('#nav').classList.toggle('open');
// Paleta de búsqueda
const pal = $('#palette'), pin = $('#pal-input');
function palList() {
  const q = pin.value.toLowerCase();
  $('#pal-list').innerHTML = ops.filter((o) => !q || `${o.summary} ${o.path} ${o.operationId} ${o.tags}`.toLowerCase().includes(q)).slice(0, 40)
    .map((o) => `<a href="#/${o.kind === 'wh' ? 'wh' : 'op'}/${o.operationId}"><span class="m ${o.kind === 'wh' ? 'wh' : o.method}">${o.kind === 'wh' ? 'EVENT' : o.method.toUpperCase()}</span>${esc(o.summary)}<small>${esc(o.path)}</small></a>`).join('') || '<a>Sin resultados</a>';
}
const openPal = () => { pal.hidden = false; pin.value = ''; palList(); pin.focus(); };
$('#search-btn').onclick = openPal; pin.oninput = palList;
pal.onclick = (e) => { if (e.target === pal || e.target.closest('a')) pal.hidden = true; };
pin.onkeydown = (e) => { if (e.key === 'Enter') $('#pal-list a')?.click(); };
addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openPal(); } if (e.key === 'Escape') pal.hidden = true; });
addEventListener('hashchange', route);
nav(); route();
})();
