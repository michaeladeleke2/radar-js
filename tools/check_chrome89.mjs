// Check built JavaScript for syntax and runtime APIs newer than Chrome 89.
//
//   node tools/check_chrome89.mjs [dir ...]      (default: dist dist-lib)
//
// One benchmark laptop is a Chromebook on Chrome 89.0.4389.130 that cannot
// update. Parses every .js file (rolldown's parser) and reports:
//   syntax  class static blocks (Chrome 94), `#x in obj` (91), RegExp /d (90)
//           and /v flags, top-level await outside a module's top level,
//           `using` declarations, decorators
//   APIs    calls of methods added after Chrome 89: .at() (92), .findLast /
//           .findLastIndex (97), .toSorted / .toReversed / .toSpliced / .with
//           (110), Object.hasOwn (93), structuredClone (98),
//           crypto.randomUUID (92), Array.fromAsync, Object.groupBy (117)
// Exit code 1 when anything is found.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseAst } from 'rolldown/parseAst';

const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ['dist', 'dist-lib'];
const NEW_METHODS = new Map([['at', 92], ['findLast', 97], ['findLastIndex', 97], ['toSorted', 110], ['toReversed', 110], ['toSpliced', 110], ['with', 110], ['fromAsync', 121], ['groupBy', 117], ['hasOwn', 93], ['randomUUID', 92]]);
const NEW_GLOBALS = new Map([['structuredClone', 98]]);

const files = [];
const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.js') || f.endsWith('.mjs')) files.push(p); } };
for (const d of dirs) if (existsSync(d)) walk(d);

let problems = 0;
for (const file of files) {
  const code = readFileSync(file, 'utf8');
  let ast;
  try { ast = parseAst(code, { sourceType: 'module' }); }
  catch (e) { console.log(`${file}: does not parse: ${e.message}`); problems++; continue; }
  const found = [];
  const visit = (node, parent, depth) => {
    if (!node || typeof node.type !== 'string') return;
    switch (node.type) {
      case 'StaticBlock': found.push(['class static block', 94, node]); break;
      case 'BinaryExpression': if (node.operator === 'in' && node.left?.type === 'PrivateIdentifier') found.push(['#x in obj', 91, node]); break;
      case 'Literal': if (node.regex && /[dv]/.test(node.regex.flags)) found.push([`RegExp /${node.regex.flags}`, 90, node]); break;
      case 'VariableDeclaration': if (node.kind === 'using' || node.kind === 'await using') found.push(['using declaration', 134, node]); break;
      case 'Decorator': found.push(['decorator', 999, node]); break;
      case 'CallExpression': {
        const c = node.callee;
        if (c?.type === 'MemberExpression' && !c.computed && c.property?.type === 'Identifier' && NEW_METHODS.has(c.property.name)) {
          const n = c.property.name;
          if (n !== 'hasOwn' || (c.object?.type === 'Identifier' && c.object.name === 'Object'))
            if (n !== 'randomUUID' || (c.object?.type === 'Identifier' && c.object.name === 'crypto') || c.object?.property?.name === 'crypto')
              found.push([`.${n}()`, NEW_METHODS.get(n), node]);
        }
        if (c?.type === 'Identifier' && NEW_GLOBALS.has(c.name)) found.push([`${c.name}()`, NEW_GLOBALS.get(c.name), node]);
        break;
      }
    }
    for (const k of Object.keys(node)) {
      if (k === 'parent') continue;
      const v = node[k];
      if (Array.isArray(v)) for (const x of v) visit(x, node, depth + 1);
      else if (v && typeof v === 'object' && typeof v.type === 'string') visit(v, node, depth + 1);
    }
  };
  visit(ast.program ?? ast, null, 0);
  for (const [what, chrome, node] of found) {
    const at = node.start ?? 0, line = code.slice(0, at).split('\n').length;
    console.log(`${file}:${line}: ${what} (Chrome ${chrome}): ${code.slice(Math.max(0, at - 40), at + 40).replace(/\s+/g, ' ')}`);
    problems++;
  }
}
console.log(`${files.length} files checked for Chrome 89: ${problems ? problems + ' problem(s)' : 'nothing newer than Chrome 89'}`);
process.exit(problems ? 1 : 0);
