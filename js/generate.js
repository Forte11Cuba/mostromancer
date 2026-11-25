// Genera los archivos de despliegue a partir del estado del wizard.
(function (root) {
  var MM = root.Mostromancer = root.Mostromancer || {};
  var T = MM.toml;

  var VERSION = "0.1.0";

  // Textos de los archivos generados (mensajes y comentarios) en el idioma
  // elegido. Conserva la sangría y los espacios de alrededor del texto.
  function L(es) {
    if (!MM.t) return es;
    var lead = es.match(/^\s*/)[0], trail = es.match(/\s*$/)[0];
    return lead + MM.t(es.trim()) + trail;
  }
  var CONTAINER_UID = 1000; // usuario mostrouser de la imagen mostrop2p/mostro
  var CONTAINER_LND_DIR = "/config/lnd";
  var RPC_TOKEN_PLACEHOLDER = "__MOSTROMANCER_RPC_TOKEN__";

  // Comillas simples de shell: todo literal, sin expansiones.
  function sq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

  // ---------- nodo Lightning instalado por Mostromancer ----------
  // Bitcoin Core (opcional; si no, neutrino) → LND → Lightning Terminal
  // (opcional, en modo remote sobre el mismo LND) → Mostro.

  var BITCOIND_RPC_USER = "lnd";
  var BITCOIND_RPCPASS_PLACEHOLDER = "__MOSTROMANCER_BITCOIND_RPCPASS__";
  var LITD_UIPASS_PLACEHOLDER = "__MOSTROMANCER_LITD_UIPASS__";
  // prune de Bitcoin Core se expresa en MiB.
  function pruneMiB(ln) {
    if (ln.prune === "full") return 0;
    var gb = ln.prune === "custom" ? ln.pruneGB : Number(ln.prune);
    return Math.max(550, Math.round(gb * 1e9 / 1048576));
  }
  var NEUTRINO_FEE_URL = "https://nodes.lightning.computer/fees/v1/btc-fee-estimates.json";

  function lndAlias(state) {
    // Una línea, como máximo 32 bytes (límite del protocolo).
    var name = (state.identity.name || "Mostro").replace(/[\r\n]+/g, " ").trim() || "Mostro";
    var enc = new TextEncoder();
    while (enc.encode(name).length > 32) name = Array.from(name).slice(0, -1).join("");
    return name;
  }

  function lndConf(state) {
    var ln = state.lightning;
    var out = [
      L("# Generado por Mostromancer ") + VERSION,
      "[Application Options]",
      "alias=" + lndAlias(state),
      "color=#92d64f",
      "listen=0.0.0.0:9735",
      "rpclisten=0.0.0.0:10009",
      "restlisten=0.0.0.0:8080",
      L("# Mostro y Lightning Terminal llegan a LND por este nombre"),
      "tlsextradomain=lnd",
      "wallet-unlock-password-file=/root/.lnd/wallet_password",
      "wallet-unlock-allow-create=true",
      "",
      "[Bitcoin]",
      "bitcoin." + ln.network + "=true",
      "bitcoin.node=" + ln.backend
    ];
    if (ln.backend === "bitcoind") {
      out.push(
        "",
        "[Bitcoind]",
        "bitcoind.rpchost=bitcoind:8332",
        "bitcoind.rpcuser=" + BITCOIND_RPC_USER,
        "bitcoind.rpcpass=" + BITCOIND_RPCPASS_PLACEHOLDER,
        "bitcoind.zmqpubrawblock=tcp://bitcoind:28332",
        "bitcoind.zmqpubrawtx=tcp://bitcoind:28333"
      );
    } else if (ln.network === "mainnet") {
      out.push("", "[fee]", L("# Obligatorio con neutrino en mainnet"), "fee.url=" + NEUTRINO_FEE_URL);
    }
    out.push(
      "",
      "[invoices]",
      L("# Fijado para que coincida con escrow_deadline_margin_blocks de Mostro (margen >= este valor + 6)"),
      "invoices.holdexpirydelta=" + MM.config.LND_HOLD_EXPIRY_DELTA
    );
    if (ln.litd) out.push("", "[rpcmiddleware]", L("# Lo usa Lightning Terminal; no es obligatorio para el resto"), "rpcmiddleware.enable=true");
    return out.join("\n") + "\n";
  }

  function litConf(state) {
    var net = state.lightning.network;
    var out = [
      L("# Generado por Mostromancer ") + VERSION,
      "lnd-mode=remote",
      "network=" + net,
      "uipassword=" + LITD_UIPASS_PLACEHOLDER,
      "httpslisten=0.0.0.0:8443",
      "remote.lnd.rpcserver=lnd:10009",
      "remote.lnd.macaroonpath=/root/.lnd/data/chain/bitcoin/" + net + "/admin.macaroon",
      "remote.lnd.tlscertpath=/root/.lnd/tls.cert",
      "taproot-assets-mode=disable",
      L("# Servicio remoto de Lightning Labs que Mostro no necesita (y no existe en signet)"),
      "autopilot.disable=true"
    ];
    if (net === "signet" || net === "regtest") out.push("loop-mode=disable", "pool-mode=disable");
    return out.join("\n") + "\n";
  }

  // Mina n bloques en regtest con recompensa para LND (comando de una línea).
  function regtestMine(state, n) {
    return "docker exec -u bitcoin mostro-bitcoind bitcoin-cli -regtest -datadir=/data generatetoaddress " + n +
      " \"$(docker exec mostro-lnd lncli --network=regtest newaddress p2tr | grep -o 'bcrt1[a-z0-9]*')\"";
  }

  function lightningServices(state) {
    var ln = state.lightning;
    var out = [];
    if (ln.backend === "bitcoind") {
      var extra = ["server=1", "listenonion=0", "rpcbind=0.0.0.0", "rpcport=8332",
        "zmqpubrawblock=tcp://0.0.0.0:28332", "zmqpubrawtx=tcp://0.0.0.0:28333"];
      // En regtest la cadena es local y diminuta: no se poda.
      if (pruneMiB(ln) && ln.network !== "regtest") extra.push("prune=" + pruneMiB(ln));
      out.push(
        "  bitcoind:",
        "    image: " + JSON.stringify(MM.config.image(state, "bitcoind")),
        "    container_name: mostro-bitcoind",
        "    restart: unless-stopped",
        "    environment:",
        "      BITCOIN_NETWORK: " + ln.network,
        L("      # La imagen genera la contraseña RPC de este usuario en bitcoin/RPCUsers/"),
        "      BITCOIN_RPCUSERS: " + BITCOIND_RPC_USER,
        "      BITCOIN_EXTRA_ARGS: |"
      );
      extra.forEach(function (l) { out.push("        " + l); });
      out.push(
        "    volumes:",
        "      - ./bitcoin:/data",
        "    logging: *logging",
        ""
      );
    }
    out.push(
      "  lnd:",
      "    image: " + JSON.stringify(MM.config.image(state, "lnd")),
      "    container_name: mostro-lnd",
      "    restart: unless-stopped"
    );
    if (ln.backend === "bitcoind") out.push("    depends_on: [bitcoind]");
    out.push(
      "    volumes:",
      "      - ./lnd:/root/.lnd",
      "    ports:",
      L("      - \"9735:9735\"            # peers de Lightning"),
      L("      - \"127.0.0.1:8080:8080\"  # REST, solo local: lo usa el instalador para crear la wallet"),
      "    logging: *logging",
      ""
    );
    if (ln.litd) {
      out.push(
        "  litd:",
        "    image: " + JSON.stringify(MM.config.image(state, "litd")),
        "    container_name: mostro-litd",
        "    restart: unless-stopped",
        "    depends_on: [lnd]",
        "    volumes:",
        "      - ./lnd:/root/.lnd:ro",
        "      - ./litd/lit:/root/.lit",
        "      - ./litd/loop:/root/.loop",
        "      - ./litd/pool:/root/.pool",
        "      - ./litd/faraday:/root/.faraday",
        "    ports:",
        L("      - \"127.0.0.1:8443:8443\"  # interfaz web: entra con un túnel SSH"),
        "    logging: *logging",
        ""
      );
    }
    return out;
  }

  function settingsToml(state) {
    var ln = state.lightning, b = state.business, id = state.identity, a = state.advanced;
    var hostNet = MM.config.usesHostNetwork(state);
    var t = MM.SETTINGS_TEMPLATE;
    function set(section, key, literal) { t = T.setKey(t, section, key, literal); }

    set("lightning", "lnd_cert_file", T.str(CONTAINER_LND_DIR + "/tls.cert"));
    set("lightning", "lnd_macaroon_file", T.str(CONTAINER_LND_DIR + "/admin.macaroon"));
    set("lightning", "lnd_grpc_host", T.str(MM.config.deploysLightning(state) ? "https://lnd:10009" : ln.grpcHost));
    ["invoice_expiration_window", "hold_invoice_cltv_delta", "hold_invoice_expiration_window",
      "payment_attempts", "payment_retries_interval", "max_final_cltv_expiry_delta",
      "escrow_deadline_margin_blocks", "max_inflight_payouts",
      "max_inflight_payouts_per_destination", "payment_cltv_limit"].forEach(function (k) {
      set("lightning", k, T.num(ln[k]));
    });

    // La clave nunca va en settings.toml: mostrod la lee de config/.env.
    set("nostr", "nsec_privkey", T.str(""));
    set("nostr", "relays", T.strArray(state.nostr.relays));

    ["name", "about", "picture", "website"].forEach(function (k) {
      if (id[k]) set("mostro", k, T.str(id[k]));
    });
    ["fee", "max_routing_fee", "max_order_amount", "min_payment_amount", "expiration_hours",
      "max_expiration_days", "expiration_seconds", "dev_fee_percentage", "pow"].forEach(function (k) {
      set("mostro", k, T.num(b[k]));
    });
    set("mostro", "fiat_currencies_accepted", T.strArray(b.fiat_currencies_accepted));
    if (a.serberoPubkey) set("mostro", "serbero_pubkey", T.str(a.serberoPubkey.trim()));

    set("rpc", "enabled", T.bool(a.rpcEnabled));
    // Con red bridge el puerto se publica solo en 127.0.0.1 del host, pero
    // dentro del contenedor mostrod tiene que escuchar en todas las interfaces.
    set("rpc", "listen_address", T.str(a.rpcEnabled && !hostNet ? "0.0.0.0" : "127.0.0.1"));
    set("rpc", "port", T.num(a.rpcPort));
    if (a.rpcEnabled && a.rpcToken) set("rpc", "auth_token", T.str(RPC_TOKEN_PLACEHOLDER));

    set("health", "enabled", T.bool(a.healthEnabled));
    set("health", "interval", T.num(a.healthInterval));
    set("health", "watchdog_pubkey", T.str(a.watchdogPubkey.trim()));

    return L("# Generado por Mostromancer ") + VERSION + " (template mostro@" + MM.SETTINGS_TEMPLATE_REV + ")\n" + t;
  }

  function composeYml(state) {
    var a = state.advanced;
    var hostNet = MM.config.usesHostNetwork(state);
    var deploy = MM.config.deploysLightning(state);
    var out = [
      L("# Generado por Mostromancer ") + VERSION,
      "x-logging: &logging",
      "  driver: json-file",
      "  options:",
      "    max-size: \"10m\"",
      "    max-file: \"5\"",
      "",
      "services:"
    ];
    if (deploy) out = out.concat(lightningServices(state));
    out.push(
      "  mostro:",
      "    image: " + JSON.stringify(state.deploy.image),
      "    container_name: mostro",
      "    restart: unless-stopped"
    );
    if (deploy) out.push("    depends_on: [lnd]");
    if (hostNet) {
      out.push(L("    # LND corre en este servidor: Mostro comparte su red para llegar a 127.0.0.1"));
      out.push("    network_mode: host");
    } else if (a.rpcEnabled) {
      out.push("    ports:");
      out.push("      - " + JSON.stringify("127.0.0.1:" + a.rpcPort + ":" + a.rpcPort));
    }
    out.push(
      "    volumes:",
      L("      # settings.toml, .env (clave nostr), lnd/ y mostro.db"),
      "      - ./config:/config",
      "    logging: *logging"
    );
    return out.join("\n") + "\n";
  }

  // Bloque del instalador que levanta Bitcoin Core / LND / Lightning Terminal,
  // crea la wallet de LND y deja listas sus credenciales para Mostro.
  function installLightningBlock(state) {
    var ln = state.lightning;
    var net = ln.network;
    var B = [
      "",
      "say \"" + L("Nodo Lightning:") + " " + (ln.backend === "bitcoind" ? "Bitcoin Core + " : "neutrino + ") + "LND" + (ln.litd ? " + Lightning Terminal" : "") + "\"",
      L("command -v curl >/dev/null 2>&1 || die \"Falta curl (apt-get install -y curl)\""),
      "LND_DIR=\"$MOSTRO_DIR/lnd\"",
      "LND_NET=" + net,
      "install -d -m 700 \"$LND_DIR\""
    ];
    if (ln.backend === "bitcoind") B.push("install -d -m 755 \"$MOSTRO_DIR/bitcoin\"");
    if (ln.litd) B.push("install -d -m 700 \"$MOSTRO_DIR/litd\" \"$MOSTRO_DIR/litd/lit\" \"$MOSTRO_DIR/litd/loop\" \"$MOSTRO_DIR/litd/pool\" \"$MOSTRO_DIR/litd/faraday\"");
    B.push(
      "write_compose",
      "cd \"$MOSTRO_DIR\""
    );
    if (ln.backend === "bitcoind") {
      B.push(
        "",
        L("echo \"  Iniciando Bitcoin Core...\""),
        "docker compose up -d bitcoind",
        "RPC_PASS_FILE=\"$MOSTRO_DIR/bitcoin/RPCUsers/" + BITCOIND_RPC_USER + "\"",
        "for _ in $(seq 1 60); do [ -s \"$RPC_PASS_FILE\" ] && break; sleep 2; done",
        L("[ -s \"$RPC_PASS_FILE\" ] || die \"Bitcoin Core no generó su contraseña RPC. Revisa: docker compose logs bitcoind\""),
        "RPC_PASS=\"$(cat \"$RPC_PASS_FILE\")\""
      );
    }
    B.push(
      "",
      "if [ ! -s \"$LND_DIR/wallet_password\" ]; then",
      "  (umask 077; od -An -N32 -tx1 /dev/urandom | tr -d ' \\n' > \"$LND_DIR/wallet_password\")",
      "fi",
      "LND_SUM=\"$(conf_sum \"$LND_DIR/lnd.conf\")\"",
      "cat > \"$LND_DIR/lnd.conf\" <<'MOSTROMANCER_LND_EOF'",
      lndConf(state).replace(/\n$/, ""),
      "MOSTROMANCER_LND_EOF"
    );
    if (ln.backend === "bitcoind") B.push("sed -i \"s/" + BITCOIND_RPCPASS_PLACEHOLDER + "/$RPC_PASS/\" \"$LND_DIR/lnd.conf\"");
    B.push(
      "chmod 600 \"$LND_DIR/lnd.conf\"",
      "if [ -n \"$LND_SUM\" ] && [ \"$LND_SUM\" != \"$(conf_sum \"$LND_DIR/lnd.conf\")\" ]; then",
      L("  echo \"  lnd.conf cambió: reiniciando LND\""),
      "  docker compose restart lnd >/dev/null 2>&1 || true",
      "fi",
      "",
      L("echo \"  Iniciando LND...\""),
      "docker compose up -d lnd",
      "lnd_rest() { curl -sS --fail --cacert \"$LND_DIR/tls.cert\" \"$@\"; }",
      "for _ in $(seq 1 90); do",
      "  [ -s \"$LND_DIR/tls.cert\" ] && lnd_rest https://localhost:8080/v1/state >/dev/null 2>&1 && break",
      "  sleep 2",
      "done",
      L("lnd_rest https://localhost:8080/v1/state >/dev/null || die \"LND no responde. Revisa: docker compose logs lnd\""),
      "",
      "WALLET_DB=\"$LND_DIR/data/chain/bitcoin/$LND_NET/wallet.db\"",
      "SEED_FILE=\"$MOSTRO_DIR/LND-SEED.txt\"",
      "if [ -f \"$WALLET_DB\" ]; then",
      L("  echo \"  La wallet de LND ya existe: se desbloquea sola con $LND_DIR/wallet_password\""),
      "else",
      L("  echo \"  Creando la wallet de LND...\""),
      "  seed_json=\"$(lnd_rest https://localhost:8080/v1/genseed)\"",
      "  words=\"$(printf '%s' \"$seed_json\" | sed -n 's/.*\"cipher_seed_mnemonic\":\\[\\([^]]*\\)\\].*/\\1/p')\"",
      L("  [ -n \"$words\" ] || die \"LND no devolvió una semilla\""),
      "  pw_b64=\"$(base64 -w0 < \"$LND_DIR/wallet_password\")\"",
      "  lnd_rest -X POST -d \"{\\\"wallet_password\\\":\\\"$pw_b64\\\",\\\"cipher_seed_mnemonic\\\":[$words]}\" https://localhost:8080/v1/initwallet >/dev/null",
      "  (umask 077; printf '%s\\n' \"$words\" | tr -d '\"' | tr ',' '\\n' | nl -w2 -s'. ' > \"$SEED_FILE\")",
      "  unset seed_json words pw_b64",
      "  SEED_NEW=1",
      "fi",
      "",
      "MACAROON=\"$LND_DIR/data/chain/bitcoin/$LND_NET/admin.macaroon\"",
      "for _ in $(seq 1 60); do [ -s \"$MACAROON\" ] && break; sleep 2; done",
      L("[ -s \"$MACAROON\" ] || die \"LND no creó admin.macaroon. Revisa: docker compose logs lnd\""),
      "LND_CERT_SRC=\"$LND_DIR/tls.cert\"",
      "LND_MACAROON_SRC=\"$MACAROON\""
    );
    if (ln.litd) {
      B.push(
        "",
        "UIPASS_FILE=\"$MOSTRO_DIR/litd/uipassword\"",
        "if [ ! -s \"$UIPASS_FILE\" ]; then",
        "  (umask 077; od -An -N16 -tx1 /dev/urandom | tr -d ' \\n' > \"$UIPASS_FILE\")",
        "fi",
        "LIT_SUM=\"$(conf_sum \"$MOSTRO_DIR/litd/lit/lit.conf\")\"",
        "cat > \"$MOSTRO_DIR/litd/lit/lit.conf\" <<'MOSTROMANCER_LIT_EOF'",
        litConf(state).replace(/\n$/, ""),
        "MOSTROMANCER_LIT_EOF",
        "sed -i \"s/" + LITD_UIPASS_PLACEHOLDER + "/$(cat \"$UIPASS_FILE\")/\" \"$MOSTRO_DIR/litd/lit/lit.conf\"",
        "chmod 600 \"$MOSTRO_DIR/litd/lit/lit.conf\"",
        "[ -n \"$LIT_SUM\" ] && [ \"$LIT_SUM\" != \"$(conf_sum \"$MOSTRO_DIR/litd/lit/lit.conf\")\" ] && RESTART=\"$RESTART litd\""
      );
    }
    return B;
  }

  function installSh(state) {
    var ln = state.lightning, n = state.nostr, a = state.advanced;
    var deploy = MM.config.deploysLightning(state);
    var settings = settingsToml(state);
    var compose = composeYml(state);
    var keyLine;
    if (n.keyMode === "server") {
      keyLine = L("  key=\"$(od -An -N32 -tx1 /dev/urandom | tr -d ' \\n')\"   # 32 bytes aleatorios del servidor");
    } else {
      var secret = n.keyMode === "browser"
        ? n.browserKey.nsec
        : MM.crypto.keypairFromSecret(MM.crypto.parseSecretKey(n.existingKey)).nsec;
      keyLine = "  key=" + sq(secret) + "   " + (n.keyMode === "browser" ? L("# clave generada en el navegador") : L("# clave provista por el operador"));
    }

    var s = [];
    s.push(
      "#!/usr/bin/env bash",
      "# Mostromancer " + VERSION + L(" — instalador de Mostro"),
      L("# Generado el ") + new Date().toISOString() + " (template mostro@" + MM.SETTINGS_TEMPLATE_REV + ")",
      "#",
      L("# Léelo antes de ejecutarlo. Uso:  sudo bash install-mostro.sh"),
      L("# Se puede volver a ejecutar: conserva la clave nostr, el token RPC y la base"),
      L("# de datos, y respalda el settings.toml anterior."),
      n.keyMode === "server" ? "#" : L("# ATENCIÓN: este archivo contiene la clave privada de tu Mostro. Bórralo después de usarlo."),
      "set -euo pipefail",
      "",
      "MOSTRO_DIR=" + sq(state.deploy.dir),
      "LND_CERT_SRC=" + sq(ln.certPath),
      "LND_MACAROON_SRC=" + sq(ln.macaroonPath),
      "CONTAINER_UID=" + CONTAINER_UID + L("   # usuario mostrouser dentro de la imagen"),
      "",
      "say()  { printf '\\n\\033[1;32m==> %s\\033[0m\\n' \"$*\"; }",
      "warn() { printf '\\033[1;33m[!] %s\\033[0m\\n' \"$*\" >&2; }",
      "die()  { printf '\\033[1;31m[x] %s\\033[0m\\n' \"$*\" >&2; exit 1; }",
      "",
      L("[ \"$(id -u)\" -eq 0 ] || die \"Ejecútalo como root: sudo bash $0\""),
      "",
      "say \"Docker\"",
      "if ! command -v docker >/dev/null 2>&1; then",
      L("  command -v curl >/dev/null 2>&1 || die \"Instala curl o Docker y vuelve a ejecutar\""),
      L("  echo \"Instalando Docker con el script oficial (get.docker.com)...\""),
      "  curl -fsSL https://get.docker.com | sh",
      "fi",
      "systemctl enable --now docker >/dev/null 2>&1 || true",
      L("docker compose version >/dev/null 2>&1 || die \"Falta el plugin 'docker compose' (paquete docker-compose-plugin)\""),
      "",
      L("say \"Carpetas en $MOSTRO_DIR\""),
      "install -d -m 755 \"$MOSTRO_DIR\"",
      "install -d -m 700 -o \"$CONTAINER_UID\" -g \"$CONTAINER_UID\" \"$MOSTRO_DIR/config\" \"$MOSTRO_DIR/config/lnd\"",
      "",
      L("# Servicios cuya configuración cambió en esta ejecución: se reinician al final."),
      "RESTART=\"\"",
      "conf_sum() { if [ -f \"$1\" ]; then md5sum \"$1\" | cut -d' ' -f1; fi; }",
      "",
      "write_compose() {",
      "cat > \"$MOSTRO_DIR/compose.yml\" <<'MOSTROMANCER_COMPOSE_EOF'",
      compose.replace(/\n$/, ""),
      "MOSTROMANCER_COMPOSE_EOF",
      "}"
    );
    if (deploy) s = s.concat(installLightningBlock(state));
    s.push(
      "",
      L("say \"Credenciales de LND para Mostro\""),
      "LND_READY=1",
      "copy_lnd() {",
      "  local src=\"$1\" dest=\"$MOSTRO_DIR/config/lnd/$2\"",
      "  if [ -r \"$src\" ]; then",
      "    install -m 600 -o \"$CONTAINER_UID\" -g \"$CONTAINER_UID\" \"$src\" \"$dest\"",
      "    echo \"  $2 <- $src\"",
      "  elif [ -s \"$dest\" ]; then",
      L("    echo \"  $2: no encuentro $src, se mantiene la copia existente\""),
      "  else",
      "    warn \"No encuentro $src\"",
      "    LND_READY=0",
      "  fi",
      "}",
      "copy_lnd \"$LND_CERT_SRC\" tls.cert",
      "copy_lnd \"$LND_MACAROON_SRC\" admin.macaroon",
      "",
      L("say \"Clave Nostr de Mostro\""),
      "ENV_FILE=\"$MOSTRO_DIR/config/.env\"",
      "if [ -s \"$ENV_FILE\" ] && grep -q '^MOSTRO_NSEC_PRIVKEY=.' \"$ENV_FILE\"; then",
      L("  echo \"  Ya hay una clave en $ENV_FILE: no se toca (es la identidad de tu Mostro).\""),
      n.keyMode === "server" ? null : L("  warn \"La clave incluida en este script NO se usó. Para reemplazar la actual, borra $ENV_FILE y vuelve a ejecutar.\""),
      "else",
      "  (",
      "  umask 077",
      keyLine,
      "  printf 'MOSTRO_NSEC_PRIVKEY=%s\\n' \"$key\" > \"$ENV_FILE\"",
      "  )",
      "  chown \"$CONTAINER_UID:$CONTAINER_UID\" \"$ENV_FILE\"",
      "  chmod 600 \"$ENV_FILE\"",
      L("  echo \"  Clave guardada en $ENV_FILE\""),
      "fi",
      "",
      "say \"settings.toml\"",
      "SETTINGS=\"$MOSTRO_DIR/config/settings.toml\"",
      "SETTINGS_SUM=\"$(conf_sum \"$SETTINGS\")\"",
      "if [ -f \"$SETTINGS\" ]; then",
      "  cp -p \"$SETTINGS\" \"$SETTINGS.bak-$(date +%Y%m%d%H%M%S)\"",
      L("  echo \"  Respaldo del anterior: $SETTINGS.bak-*\""),
      "fi",
      "cat > \"$SETTINGS\" <<'MOSTROMANCER_SETTINGS_EOF'",
      settings.replace(/\n$/, ""),
      "MOSTROMANCER_SETTINGS_EOF"
    );
    if (a.rpcEnabled && a.rpcToken) {
      s.push(
        "TOKEN_FILE=\"$MOSTRO_DIR/config/rpc_auth_token\"",
        "if [ ! -s \"$TOKEN_FILE\" ]; then",
        "  (umask 077; od -An -N32 -tx1 /dev/urandom | tr -d ' \\n' > \"$TOKEN_FILE\")",
        L("  echo \"  Nuevo token RPC en $TOKEN_FILE\""),
        "fi",
        "sed -i \"s/" + RPC_TOKEN_PLACEHOLDER + "/$(cat \"$TOKEN_FILE\")/\" \"$SETTINGS\""
      );
    }
    s.push(
      "chown \"$CONTAINER_UID:$CONTAINER_UID\" \"$SETTINGS\"",
      "chmod 600 \"$SETTINGS\"",
      "[ -n \"$SETTINGS_SUM\" ] && [ \"$SETTINGS_SUM\" != \"$(conf_sum \"$SETTINGS\")\" ] && RESTART=\"$RESTART mostro\"",
      "",
      "say \"compose.yml\"",
      "write_compose",
      "",
      "if [ \"$LND_READY\" != 1 ]; then",
      L("  warn \"Mostro quedó configurado pero NO se inició: faltan las credenciales de LND.\""),
      L("  warn \"Copia tls.cert y admin.macaroon a $MOSTRO_DIR/config/lnd/ (dueño $CONTAINER_UID, modo 600)\""),
      L("  warn \"y luego ejecuta:  cd $MOSTRO_DIR && docker compose up -d\""),
      "  exit 0",
      "fi",
      "",
      L("say \"Iniciando Mostro\""),
      "cd \"$MOSTRO_DIR\"",
      "docker compose pull",
      "docker compose up -d",
      "if [ -n \"$RESTART\" ]; then",
      L("  echo \"  Reiniciando por cambios de configuración:$RESTART\""),
      "  docker compose restart $RESTART",
      "fi",
      "",
      "line=\"\"",
      "for _ in $(seq 1 30); do",
      "  line=\"$(docker compose logs mostro 2>&1 | grep -m1 'Mostro pubkey' || true)\"",
      "  [ -n \"$line\" ] && break",
      "  sleep 2",
      "done",
      "if [ -n \"$line\" ]; then",
      L("  say \"Mostro está en marcha\""),
      "  echo \"$line\"",
      "else",
      L("  warn \"No vi la pubkey en los logs todavía. Revísalos con: cd $MOSTRO_DIR && docker compose logs -f\""),
      "fi",
      "",
      "cat <<EOF",
      "",
      L("Listo. Ten en cuenta:"),
      L("  - Respalda $ENV_FILE en un lugar seguro: es la identidad de tu Mostro."),
      "  - Logs:       cd $MOSTRO_DIR && docker compose logs -f",
      L("  - Actualizar: cd $MOSTRO_DIR && docker compose pull && docker compose up -d"),
      L("  - Si LND renueva su tls.cert o el macaroon, vuelve a ejecutar este script."),
      a.rpcEnabled && a.rpcToken ? "  - Token RPC:  $TOKEN_FILE" : null,
      "EOF"
    );
    if (deploy) {
      var lncli = "docker exec mostro-lnd lncli --network=" + ln.network;
      s.push(
        "",
        "if [ \"${SEED_NEW:-0}\" = 1 ]; then",
        L("  say \"IMPORTANTE: semilla de la wallet de LND\""),
        "  cat \"$SEED_FILE\"",
        L("  warn \"Anota estas 24 palabras en papel. Son la única forma de recuperar los fondos de LND.\""),
        L("  warn \"Están también en $SEED_FILE: cuando las hayas anotado, bórralo con: shred -u $SEED_FILE\""),
        "fi",
        "",
        "cat <<EOF",
        "",
        L("Tu nodo Lightning:"),
        ln.network === "regtest"
          ? L("  - Regtest: la cadena es tuya y no avanza sola. Para minar 101 bloques a LND:")
          : ln.backend === "bitcoind"
            ? L("  - Bitcoin Core se está sincronizando (puede tardar de horas a días). Progreso: docker compose logs -f bitcoind")
            : L("  - LND usa neutrino: sincroniza en minutos con nodos públicos."),
        // Va dentro de un heredoc sin comillas: el $( se escapa para que se muestre, no se ejecute.
        ln.network === "regtest" ? "      " + regtestMine(state, 101).replace("$(", "\\$(") : null,
        L("  - Mostro empezará a operar cuando LND termine de sincronizar."),
        L("  - Dirección para fondear LND:  ") + lncli + " newaddress p2tr",
        L("  - Saldo:                       ") + lncli + " walletbalance",
        L("  - Mostro necesita canales con liquidez de entrada y de salida para operar."),
        ln.litd ? L("  - Lightning Terminal: abre un túnel con  ssh -L 8443:127.0.0.1:8443 usuario@servidor") : null,
        ln.litd ? L("    y entra a https://localhost:8443 con la contraseña de $UIPASS_FILE") : null,
        "EOF"
      );
    }
    s.push("");
    return s.filter(function (l) { return l !== null; }).join("\n");
  }

  function cloudInit(state) {
    var script = installSh(state).replace(/\n$/, "").split("\n").map(function (l) {
      return l ? "      " + l : "";
    }).join("\n");
    return [
      "#cloud-config",
      "# Mostromancer " + VERSION + L(": pega esto en el campo \"user data\" al crear el VPS."),
      "write_files:",
      "  - path: /root/install-mostro.sh",
      "    permissions: '0700'",
      "    content: |",
      script,
      "runcmd:",
      "  - [bash, /root/install-mostro.sh]",
      ""
    ].join("\n");
  }

  MM.generate = {
    VERSION: VERSION,
    settingsToml: settingsToml,
    composeYml: composeYml,
    installSh: installSh,
    cloudInit: cloudInit,
    shellQuote: sq,
    regtestMine: regtestMine
  };
})(typeof window !== "undefined" ? window : globalThis);
