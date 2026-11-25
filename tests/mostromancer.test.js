// Tests sin dependencias:  node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Node 18 no expone crypto.getRandomValues como global.
if (!globalThis.crypto) globalThis.crypto = require("node:crypto").webcrypto;

for (const f of ["template", "versions", "crypto", "i18n", "i18n-en", "toml", "config", "generate"]) {
  require(path.join(__dirname, "..", "js", f + ".js"));
}
const MM = globalThis.Mostromancer;
const C = MM.crypto;

test("sha256 coincide con node:crypto", () => {
  const nodeCrypto = require("node:crypto");
  for (const len of [0, 1, 55, 56, 63, 64, 65, 1000]) {
    const msg = nodeCrypto.randomBytes(len);
    assert.equal(C.bytesToHex(C.sha256(new Uint8Array(msg))),
      nodeCrypto.createHash("sha256").update(msg).digest("hex"));
  }
});

test("pubkeys x-only de los vectores de BIP-340", () => {
  const vectors = [
    ["0000000000000000000000000000000000000000000000000000000000000003",
      "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9"],
    ["b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef",
      "dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659"],
    ["c90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b14e5c9",
      "dd308afec5777e13121fa72b9cc1b7cc0139715309b086c960e18fd969774eb8"],
  ];
  for (const [sk, pk] of vectors) {
    assert.equal(C.bytesToHex(C.xOnlyPublicKey(C.hexToBytes(sk))), pk);
  }
});

test("bech32 con los ejemplos de NIP-19", () => {
  const nsec = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";
  const skHex = "67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa";
  assert.equal(C.bech32Encode("nsec", C.hexToBytes(skHex)), nsec);
  assert.equal(C.bytesToHex(C.parseSecretKey(nsec)), skHex);
  assert.equal(C.bech32Encode("npub",
    C.hexToBytes("7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e")),
    "npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg");
  assert.ok(C.isValidPublicKey("npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg"));
  assert.ok(!C.isValidPublicKey(nsec));
  assert.throws(() => C.parseSecretKey(nsec.slice(0, -1) + "q"));
  assert.throws(() => C.parseSecretKey("0".repeat(64)));
});

test("generateSecret mezcla entropía extra y siempre da una clave válida", () => {
  const a = C.keypairFromSecret(C.generateSecret(new Uint8Array([1, 2, 3])));
  const b = C.keypairFromSecret(C.generateSecret());
  assert.notEqual(a.nsec, b.nsec);
  assert.match(a.npub, /^npub1[02-9ac-hj-np-z]{58}$/);
});

test("setKey cambia, descomenta o agrega claves dentro de su sección", () => {
  const src = "[a]\nx = 1\n# y = 2\n[b]\nx = 3\n";
  let out = MM.toml.setKey(src, "b", "x", "9");
  assert.equal(out, "[a]\nx = 1\n# y = 2\n[b]\nx = 9\n");
  out = MM.toml.setKey(src, "a", "y", "5");
  assert.equal(out, "[a]\nx = 1\ny = 5\n[b]\nx = 3\n");
  out = MM.toml.setKey(src, "b", "z", "7");
  assert.equal(out, "[a]\nx = 1\n# y = 2\n[b]\nz = 7\nx = 3\n");
  out = MM.toml.setKey(src, "c", "w", "1");
  assert.ok(out.endsWith("\n[c]\nw = 1"));
  assert.equal(MM.toml.str('a"b\\c\nd'), '"a\\"b\\\\c\\nd"');
});

test("los valores por defecto validan sin errores", () => {
  const issues = MM.config.validate(MM.config.defaults());
  assert.deepEqual(issues.filter((i) => i.level === "error"), []);
});

test("la validación replica las reglas de arranque de mostrod", () => {
  const errorsFor = (mutate) => {
    const s = MM.config.defaults();
    mutate(s);
    return MM.config.validate(s).filter((i) => i.level === "error").map((i) => i.field);
  };
  assert.ok(errorsFor((s) => (s.lightning.escrow_deadline_margin_blocks = 17)).includes("escrow_deadline_margin_blocks"));
  assert.ok(errorsFor((s) => (s.lightning.escrow_deadline_margin_blocks = 144)).includes("escrow_deadline_margin_blocks"));
  assert.ok(errorsFor((s) => (s.lightning.max_final_cltv_expiry_delta = 0)).includes("max_final_cltv_expiry_delta"));
  assert.ok(errorsFor((s) => (s.lightning.payment_cltv_limit = 700)).includes("payment_cltv_limit"));
  assert.deepEqual(errorsFor((s) => (s.lightning.payment_cltv_limit = 0)), []);
  assert.ok(errorsFor((s) => (s.business.dev_fee_percentage = 0.05)).includes("dev_fee_percentage"));
  assert.ok(errorsFor((s) => (s.advanced.serberoPubkey = "npub1nope")).includes("serberoPubkey"));
  assert.ok(errorsFor((s) => (s.nostr.relays = ["https://x"])).includes("relays"));
  assert.ok(errorsFor((s) => { s.nostr.keyMode = "existing"; s.nostr.existingKey = "abc"; }).includes("existingKey"));
});

function sampleState() {
  const s = MM.config.defaults();
  s.identity.name = 'Mostro "de prueba"';
  s.identity.about = "Línea 1\nLínea 2 con 'comillas'";
  s.advanced.rpcEnabled = true;
  s.advanced.serberoPubkey = "npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg";
  return s;
}

test("settings.toml generado aplica los valores y no contiene la clave", () => {
  const toml = MM.generate.settingsToml(sampleState());
  assert.match(toml, /^lnd_cert_file = "\/config\/lnd\/tls.cert"$/m);
  assert.match(toml, /^nsec_privkey = ""$/m);
  assert.match(toml, /^name = "Mostro \\"de prueba\\""$/m);
  assert.match(toml, /^serbero_pubkey = "npub1/m);
  assert.match(toml, /^auth_token = "__MOSTROMANCER_RPC_TOKEN__"$/m);
  assert.match(toml, /^listen_address = "127.0.0.1"$/m); // LND local => host network
  assert.doesNotMatch(toml, /nsec1vl0/);
});

test("compose usa host network con LND local y publica RPC solo en loopback con LND remoto", () => {
  const s = sampleState();
  assert.match(MM.generate.composeYml(s), /network_mode: host/);
  s.lightning.location = "remote";
  s.lightning.grpcHost = "https://lnd.example.com:10009";
  const yml = MM.generate.composeYml(s);
  assert.doesNotMatch(yml, /network_mode/);
  assert.match(yml, /"127.0.0.1:50051:50051"/);
  assert.match(MM.generate.settingsToml(s), /^listen_address = "0.0.0.0"$/m);
});

test("install.sh es bash válido en los tres modos de clave", () => {
  for (const mode of ["server", "browser", "existing"]) {
    const s = sampleState();
    s.nostr.keyMode = mode;
    s.nostr.browserKey = C.keypairFromSecret(C.generateSecret());
    s.nostr.existingKey = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";
    s.lightning.certPath = "/root/it's here/tls.cert";
    const sh = MM.generate.installSh(s);
    execFileSync("bash", ["-n"], { input: sh });
    assert.equal(sh.includes("nsec1"), mode !== "server");
  }
});

test("cloud-init contiene el script indentado", () => {
  const ci = MM.generate.cloudInit(sampleState());
  assert.ok(ci.startsWith("#cloud-config\n"));
  assert.match(ci, /^      set -euo pipefail$/m);
});

// ---------- instalar el nodo: Bitcoin Core / LND / Lightning Terminal ----------

function nodeState(lightning) {
  const s = MM.config.defaults();
  Object.assign(s.lightning, { mode: "install" }, lightning);
  return s;
}

function errorsOf(s) {
  return MM.config.validate(s).filter((i) => i.level === "error").map((i) => i.field);
}

test("neutrino: LND sin Bitcoin Core, alineado con Mostro", () => {
  const s = nodeState({ backend: "neutrino", network: "mainnet" });
  assert.deepEqual(errorsOf(s), []);
  const sh = MM.generate.installSh(s);
  const yml = MM.generate.composeYml(s);
  execFileSync("bash", ["-n"], { input: sh });
  assert.match(sh, /^bitcoin\.mainnet=true$/m);
  assert.match(sh, /^bitcoin\.node=neutrino$/m);
  assert.match(sh, /^fee\.url=https:\/\//m); // obligatorio con neutrino en mainnet
  assert.match(sh, /^invoices\.holdexpirydelta=18$/m);
  assert.match(sh, /^tlsextradomain=lnd$/m);
  assert.match(sh, /\/v1\/initwallet/);
  assert.match(yml, /^  lnd:$/m);
  assert.doesNotMatch(yml, /^  bitcoind:$/m);
  assert.doesNotMatch(yml, /^  litd:$/m);
  assert.match(yml, /"127\.0\.0\.1:8080:8080"/);
  assert.match(MM.generate.settingsToml(s), /^lnd_grpc_host = "https:\/\/lnd:10009"$/m);
});

test("Bitcoin Core: tamaño a medida en MiB, contraseña RPC y versión elegida", () => {
  const s = nodeState({ backend: "bitcoind", prune: "custom", pruneGB: 120, bitcoindVersion: "31.1" });
  const yml = MM.generate.composeYml(s);
  const sh = MM.generate.installSh(s);
  execFileSync("bash", ["-n"], { input: sh });
  assert.match(yml, /image: "btcpayserver\/bitcoin:31\.1"/);
  assert.match(yml, /^        prune=114441$/m); // 120 GB = 120e9 bytes
  assert.match(yml, /BITCOIN_RPCUSERS: lnd/);
  assert.match(sh, /^bitcoind\.rpchost=bitcoind:8332$/m);
  assert.match(sh, /sed -i "s\/__MOSTROMANCER_BITCOIND_RPCPASS__\//);
  s.lightning.prune = "full";
  assert.doesNotMatch(MM.generate.composeYml(s), /prune=/);
});

test("Lightning Terminal: modo remote sobre el mismo LND", () => {
  const s = nodeState({ litd: true, lndVersion: "other", lndVersionOther: "v0.21.7-beta" });
  const sh = MM.generate.installSh(s);
  const yml = MM.generate.composeYml(s);
  execFileSync("bash", ["-n"], { input: sh });
  assert.match(sh, /^lnd-mode=remote$/m);
  assert.match(sh, /^remote\.lnd\.rpcserver=lnd:10009$/m);
  assert.match(sh, /^autopilot\.disable=true$/m);
  assert.match(sh, /^taproot-assets-mode=disable$/m);
  assert.match(sh, /^rpcmiddleware\.enable=true$/m);
  assert.match(yml, /image: "lightninglabs\/lnd:v0\.21\.7-beta"/);
  assert.match(yml, /image: "lightninglabs\/lightning-terminal:/);
  assert.match(yml, /"127\.0\.0\.1:8443:8443"/);
  assert.match(yml, /\.\/lnd:\/root\/\.lnd:ro/);
});

test("regtest exige Bitcoin Core, no poda y desactiva Loop y Pool", () => {
  assert.ok(errorsOf(nodeState({ network: "regtest", backend: "neutrino" })).includes("backend"));
  const s = nodeState({ network: "regtest", backend: "bitcoind", litd: true });
  assert.deepEqual(errorsOf(s), []);
  const sh = MM.generate.installSh(s);
  assert.doesNotMatch(MM.generate.composeYml(s), /prune=/);
  assert.match(sh, /^loop-mode=disable$/m);
  assert.match(sh, /generatetoaddress 101/);
});

test("al instalar LND el margen de escrow debe ser al menos 24", () => {
  const s = nodeState({ escrow_deadline_margin_blocks: 20 });
  assert.ok(errorsOf(s).includes("escrow_deadline_margin_blocks"));
  s.lightning.escrow_deadline_margin_blocks = 24;
  assert.deepEqual(errorsOf(s), []);
});

test("los archivos generados salen en el idioma elegido", () => {
  const s = nodeState({ backend: "bitcoind", litd: true });
  try {
    MM.i18n.setLang("en");
    // Sin el bloque de settings.toml: sus comentarios son los del template de Mostro.
    const parts = MM.generate.installSh(s).split("MOSTROMANCER_SETTINGS_EOF");
    const sh = parts[0] + parts[2];
    const yml = MM.generate.composeYml(s);
    assert.match(sh, /say "Starting Mostro"/);
    assert.match(sh, /IMPORTANT: LND wallet seed/);
    assert.match(yml, /# Lightning peers/);
    assert.doesNotMatch(sh + yml, /[áéíóúñ¿¡]/i);
    execFileSync("bash", ["-n"], { input: MM.generate.installSh(s) });
    assert.match(MM.config.validate(nodeState({ network: "regtest", backend: "neutrino" }))
      .find((i) => i.field === "backend").msg, /Bitcoin Core is required/);
  } finally {
    MM.i18n.setLang("es");
  }
  assert.match(MM.generate.installSh(s), /say "Iniciando Mostro"/);
});

// Prueba de punta a punta opcional: arranca el mostrod compilado con la
// configuración generada y comprueba que la acepta (llega a loguear su
// pubkey). Falla después al conectar con LND, lo que es esperable.
const mostrod = process.env.MOSTROD || path.join(__dirname, "..", "..", "mostro", "target", "debug", "mostrod");
test("mostrod acepta el settings.toml y el .env generados", { skip: !fs.existsSync(mostrod) && "no hay binario mostrod" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mostromancer-"));
  const s = sampleState();
  // Con RPC y token, como lo deja install.sh tras reemplazar el marcador.
  const toml = MM.generate.settingsToml(s).replace("__MOSTROMANCER_RPC_TOKEN__", "ab".repeat(32));
  fs.writeFileSync(path.join(dir, "settings.toml"), toml);
  const skHex = "67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa";
  fs.writeFileSync(path.join(dir, ".env"), "MOSTRO_NSEC_PRIVKEY=" + skHex + "\n", { mode: 0o600 });
  let out = "";
  try {
    out = execFileSync(mostrod, ["-d", dir], { timeout: 15000, stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH, RUST_LOG: "info" } }).toString();
  } catch (e) {
    out = String(e.stdout || "") + String(e.stderr || "");
  }
  const expectedNpub = C.keypairFromSecret(C.hexToBytes(skHex)).npub;
  assert.ok(out.includes("Mostro pubkey: " + expectedNpub), "salida de mostrod:\n" + out.slice(0, 3000));
  fs.rmSync(dir, { recursive: true, force: true });
});
