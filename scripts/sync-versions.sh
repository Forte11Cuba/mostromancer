#!/usr/bin/env bash
# Regenera js/versions.js con las versiones estables publicadas en Docker Hub
# de Bitcoin Core (imagen de BTCPay), LND y Lightning Terminal.
# Uso: scripts/sync-versions.sh
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
for r in btcpayserver/bitcoin lightninglabs/lnd lightninglabs/lightning-terminal; do
  curl -fsS --max-time 30 "https://hub.docker.com/v2/repositories/$r/tags?page_size=100&ordering=last_updated" \
    -o "$tmp/$(basename "$r").json"
done
node -e '
const fs = require("fs");
const dir = process.argv[1], out = process.argv[2];
function stable(file, re) {
  const names = JSON.parse(fs.readFileSync(dir + "/" + file, "utf8")).results.map((t) => t.name).filter((n) => re.test(n));
  const key = (n) => n.replace(/^v/, "").split(/[.-]/).slice(0, 3).map((x) => Number(x) || 0);
  names.sort((a, b) => { const x = key(a), y = key(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; });
  return names.slice(0, 6);
}
const v = {
  bitcoind: { repo: "btcpayserver/bitcoin", tags: stable("bitcoin.json", /^\d+\.\d+(\.\d+)?$/) },
  lnd: { repo: "lightninglabs/lnd", tags: stable("lnd.json", /^v\d+\.\d+\.\d+-beta$/) },
  litd: { repo: "lightninglabs/lightning-terminal", tags: stable("lightning-terminal.json", /^v\d+\.\d+\.\d+(-alpha)?$/) }
};
fs.writeFileSync(out,
  "// Generado por scripts/sync-versions.sh desde Docker Hub (" + new Date().toISOString().slice(0, 10) + "). No editar a mano.\n" +
  "// La primera de cada lista es la más nueva: la que el wizard ofrece como «última».\n" +
  "(function (root) {\n" +
  "  var MM = root.Mostromancer = root.Mostromancer || {};\n" +
  "  MM.VERSIONS = " + JSON.stringify(v, null, 2).replace(/\n/g, "\n  ") + ";\n" +
  "})(typeof window !== \"undefined\" ? window : globalThis);\n");
for (const k of Object.keys(v)) console.log(k + ": " + v[k].tags.join(" "));
' "$tmp" "$here/js/versions.js"
