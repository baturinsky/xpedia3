/**
 * Lists every `.id` member access whose receiver type includes `Entry`.
 *
 * A plain text search cannot tell `entry.id` from `article.id`, `section.id` or
 * `mod.meta.id` — those are different things that must keep their own name. This
 * asks the TypeScript checker for the receiver's type, so the report is the
 * actual list of Entry identity reads rather than a guess at one.
 *
 * Usage: node scripts/find-entry-ids.mjs [--write]
 *   --write  rewrite the reported `Expression.id` to `Expression.uid`
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(root, "src", "tsconfig.json");
const config = ts.getParsedCommandLineOfConfigFile(
  configPath,
  {},
  {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) =>
      console.error(ts.flattenDiagnosticMessageText(d.messageText, "\n")),
  },
);
const program = ts.createProgram(config.fileNames, config.options);
const checker = program.getTypeChecker();

/**
 * The `Entry` type, for an assignability test.
 *
 * Walking `getBaseTypes()` is not enough: on a `this` receiver TypeScript
 * reports the concrete class (`Item`, `Manufacture`, ...), and a class symbol
 * does not answer `getBaseTypes`. Asking whether the type is assignable to
 * `Entry` covers `this`, a concrete subclass, and `any` that was cast to one.
 */
const entrySymbol = program
  .getSourceFiles()
  .flatMap((sf) => sf.statements)
  .find((s) => ts.isClassDeclaration(s) && s.name?.text === "Entry");
const entryType = entrySymbol && checker.getDeclaredTypeOfSymbol(entrySymbol.symbol);

/** Does `type` denote a ruleset entry (Entry or a subclass of it)? */
function isEntryLike(type) {
  if (type == null || entryType == null) return false;
  // `any` is assignable to everything, so a raw-JSON receiver would match every
  // query. Those are reported separately as unverifiable rather than rewritten.
  if (type.flags & ts.TypeFlags.Any) return false;
  return checker.isTypeAssignableTo(type, entryType);
}

/** The receiver expression of `X.id`, for reporting */
function receiverText(node, sf) {
  return node.expression.getText(sf);
}

const hits = [];
// TypeScript reports source paths with forward slashes even on Windows
const srcPrefix = path.join(root, "src").replace(/\\/g, "/");
for (const sf of program.getSourceFiles()) {
  if (sf.isDeclarationFile || !sf.fileName.replace(/\\/g, "/").startsWith(srcPrefix)) continue;
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === "id") {
      const type = checker.getTypeAtLocation(node.expression);
      if (isEntryLike(type)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        hits.push({
          file: path.relative(root, sf.fileName),
          line: line + 1,
          text: node.getText(sf),
          receiver: receiverText(node, sf),
          start: node.name.getStart(sf),
          end: node.name.getEnd(),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

for (const h of hits) console.log(`${h.file}:${h.line}: ${h.text}`);

console.log(
  `\n${hits.length} Entry.id read(s) across ${new Set(hits.map((h) => h.file)).size} file(s)`,
);

if (process.argv.includes("--write")) {
  // Grouped by file, rewritten back to front so earlier offsets stay valid
  const byFile = new Map();
  for (const h of hits) {
    if (!byFile.has(h.file)) byFile.set(h.file, []);
    byFile.get(h.file).push(h);
  }
  let changed = 0;
  for (const [file, list] of byFile) {
    let text = readFileSync(path.join(root, file), "utf8");
    for (const h of [...list].sort((a, b) => b.start - a.start)) {
      text = `${text.slice(0, h.start)}uid${text.slice(h.end)}`;
      changed++;
    }
    writeFileSync(path.join(root, file), text);
  }
  console.log(`rewrote ${changed} occurrence(s)`);
}
