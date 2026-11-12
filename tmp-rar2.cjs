const fs = require("fs");
const unrar = require("node-unrar-js");
(async () => {
  const path = "misc/modpackExamples/Dioxine_XPiratez_o2.1.rar";
  const wasm = fs.readFileSync("src/unrar.wasm");
  const data = fs.readFileSync(path);
  const ex = await unrar.createExtractorFromData({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset+wasm.byteLength), data: data.buffer.slice(data.byteOffset, data.byteOffset+data.byteLength) });
  const names = [...ex.getFileList().fileHeaders].map(f => f.name);
  console.log("entries:", names.length);
  const pngs = names.filter(n => /\.png$/i.test(n));
  console.log("pngs:", pngs.length);
  console.log("PIR_22:", pngs.filter(n => /pir_22/i.test(n)));
  console.log("sprites dir sample:", pngs.filter(n => /Resources\\Sprites\\/i.test(n) || /Resources\/Sprites\//i.test(n)).slice(0, 6));
  const dirs = {};
  for (const n of pngs) { const k = n.split(/[\\/]/).slice(0,5).join("/"); dirs[k]=(dirs[k]||0)+1; }
  console.log("top png dirs:", Object.entries(dirs).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>k+"="+v).join(" | "));
})();
