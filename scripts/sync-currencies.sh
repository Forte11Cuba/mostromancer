#!/usr/bin/env bash
# Regenera js/currencies.js desde la lista de monedas de Yadio (el proveedor
# de precios por defecto de Mostro), con las banderas de MostroP2P/app.
# Uso: scripts/sync-currencies.sh [path/to/app]
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
app="${1:-$here/../app}"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
curl -fsS --max-time 30 https://api.yadio.io/currencies -o "$tmp"
node -e '
const fs = require("fs");
const [yadioFile, fiatFile, out] = process.argv.slice(1);
const yadio = JSON.parse(fs.readFileSync(yadioFile, "utf8"));
const flags = {};
try { for (const c of JSON.parse(fs.readFileSync(fiatFile, "utf8"))) flags[c.code] = c.flag; } catch (e) {}
const list = Object.keys(yadio).filter((code) => code !== "BTC").sort()
  .map((code) => (flags[code] ? { code, name: yadio[code], flag: flags[code] } : { code, name: yadio[code] }));
fs.writeFileSync(out,
  "// Generado por scripts/sync-currencies.sh desde https://api.yadio.io/currencies\n" +
  "// (" + new Date().toISOString().slice(0, 10) + "). No editar a mano.\n" +
  "(function (root) {\n" +
  "  var MM = root.Mostromancer = root.Mostromancer || {};\n" +
  "  MM.CURRENCIES = " + JSON.stringify(list) + ";\n" +
  "})(typeof window !== \"undefined\" ? window : globalThis);\n");
console.log("js/currencies.js: " + list.length + " monedas, " + list.filter((c) => c.flag).length + " con bandera");
' "$tmp" "$app/assets/data/fiat.json" "$here/js/currencies.js"
