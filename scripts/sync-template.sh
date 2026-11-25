#!/usr/bin/env bash
# Regenerate js/template.js from Mostro's settings.tpl.toml.
# Usage: scripts/sync-template.sh [path/to/mostro]
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
mostro="${1:-$here/../mostro}"
src="$mostro/settings.tpl.toml"
[ -f "$src" ] || { echo "No se encontró $src" >&2; exit 1; }
rev="$(git -C "$mostro" rev-parse --short HEAD 2>/dev/null || echo unknown)"
node -e '
const fs = require("fs");
const [src, rev, out] = process.argv.slice(1);
const tpl = fs.readFileSync(src, "utf8");
fs.writeFileSync(out,
  "// Generado por scripts/sync-template.sh desde mostro@" + rev + ". No editar a mano.\n" +
  "(function (root) {\n" +
  "  var MM = root.Mostromancer = root.Mostromancer || {};\n" +
  "  MM.SETTINGS_TEMPLATE_REV = " + JSON.stringify(rev) + ";\n" +
  "  MM.SETTINGS_TEMPLATE = " + JSON.stringify(tpl) + ";\n" +
  "})(typeof window !== \"undefined\" ? window : globalThis);\n");
' "$src" "$rev" "$here/js/template.js"
echo "js/template.js actualizado (mostro@$rev)"
