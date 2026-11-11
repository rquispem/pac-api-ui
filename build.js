// Convierte openapi.yml -> public/spec.json con todos los $ref resueltos.
const fs = require('fs'), path = require('path'), YAML = require('yaml');
const root = path.join(__dirname, '..');
const doc = YAML.parse(fs.readFileSync(path.join(root, 'openapi.yml'), 'utf8'));

const lookup = (ref) => ref.replace(/^#\//, '').split('/').reduce((o, k) => o && o[k.replace(/~1/g, '/').replace(/~0/g, '~')], doc);

function deref(node, stack = []) {
  if (Array.isArray(node)) return node.map((n) => deref(n, stack));
  if (!node || typeof node !== 'object') return node;
  if (node.$ref) {
    const name = node.$ref.split('/').pop();
    if (stack.includes(node.$ref)) return { type: 'object', 'x-circular': name };
    const target = deref(lookup(node.$ref), [...stack, node.$ref]);
    return typeof target === 'object' && !Array.isArray(target) ? { ...target, 'x-ref-name': name } : target;
  }
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = deref(v, stack);
  return out;
}

const spec = {
  info: doc.info, servers: doc.servers, tags: doc.tags, tagGroups: doc['x-tagGroups'],
  securitySchemes: doc.components.securitySchemes,
  paths: deref(doc.paths), webhooks: deref(doc.webhooks || {}),
};
fs.writeFileSync(path.join(root, 'public', 'spec.json'), JSON.stringify(spec));
const n = Object.values(spec.paths).reduce((a, p) => a + Object.keys(p).filter((m) => m !== 'parameters').length, 0);
console.log(`spec.json generado: ${n} operaciones, ${Object.keys(spec.webhooks).length} webhooks`);
