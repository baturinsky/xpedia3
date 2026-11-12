const fs = require("fs"), path = require("path");
const root = "C:/1/xpedia3/src";
const files = [];
(function walk(d){ for (const e of fs.readdirSync(d,{withFileTypes:true})) { const p = path.join(d,e.name); if (e.isDirectory()) { if (e.name==="builtinMods") continue; walk(p); } else if (/\.(ts|tsx)$/.test(e.name)) files.push(p); } })(root);
const graph = new Map();
for (const f of files) {
  const src = fs.readFileSync(f,"utf8");
  const deps = [];
  const re = /(?:^|\n)\s*(?:import|export)[^;\n]*?from\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[1];
    if (!spec.startsWith(".")) continue;
    let base = path.resolve(path.dirname(f), spec);
    const cands = [base+".ts", base+".tsx", path.join(base,"index.ts"), path.join(base,"index.tsx")];
    const hit = cands.find(c => fs.existsSync(c));
    if (hit) deps.push(hit);
  }
  graph.set(f, deps);
}
const cycles = [];
const state = new Map();
const stack = [];
function dfs(n){
  state.set(n,1); stack.push(n);
  for (const d of graph.get(n) ?? []) {
    if (state.get(d)===1) {
      const i = stack.indexOf(d);
      cycles.push(stack.slice(i).map(x=>path.relative(root,x).replace(/\\/g,"/")));
    } else if (!state.get(d)) dfs(d);
  }
  stack.pop(); state.set(n,2);
}
for (const f of files) if (!state.get(f)) dfs(f);
console.log("modules:", files.length);
console.log("cycles found:", cycles.length);
for (const c of cycles) console.log("  " + c.join(" -> ") + " -> " + c[0]);
