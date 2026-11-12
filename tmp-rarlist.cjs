const fs = require("fs");
const unrar = require("node-unrar-js");
(async () => {
  const wasm = fs.readFileSync("src/unrar.wasm");
  const data = fs.readFileSync("misc/modpackExamples/Dioxine_XPiratez_small.rar");
  const extractor = await unrar.createExtractorFromData({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength), data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) });
  const list = extractor.getFileList();
  const names = [...list.fileHeaders].map(f => f.name);
  console.log("entries:", names.length);
  const pngs = names.filter(n => /\.png$/i.test(n));
  console.log("png entries:", pngs.length);
  const pir = names.filter(n => /pir_22/i.test(n));
  console.log("PIR_22 matches:", pir);
  console.log("sample pngs:", pngs.slice(0, 8));
  const dirs = {};
  for (const n of pngs) { const k = n.split("/").slice(0, 4).join("/"); dirs[k] = (dirs[k]||0)+1; }
  console.log("png dirs:", Object.entries(dirs).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>k+"="+v).join(" | "));
})();
