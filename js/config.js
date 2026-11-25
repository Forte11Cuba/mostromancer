// Estado del wizard: valores por defecto y validación.
// Los valores por defecto replican settings.tpl.toml de Mostro; las reglas
// replican las que hacen que mostrod se niegue a arrancar
// (src/config/util.rs: validate_mostro_settings y compañía).
(function (root) {
  var MM = root.Mostromancer = root.Mostromancer || {};

  var MIN_DEV_FEE_PERCENTAGE = 0.10;
  var MAX_DEV_FEE_PERCENTAGE = 1.0;
  var MIN_ESCROW_DEADLINE_MARGIN_BLOCKS = 18; // holdexpirydelta por defecto (12) + 6
  var PAYMENT_CLTV_ROUTE_ROOM = 576;
  var U32_MAX = 4294967295;
  // holdexpirydelta por defecto de LND 0.21 (DefaultIncomingBroadcastDelta 16 + 2).
  // Es el valor que fijamos al instalar LND; mostrod solo asume 12 (#1058).
  var LND_HOLD_EXPIRY_DELTA = 18;
  var ESCROW_HEADROOM_BLOCKS = 6;
  var INSTALL_NETWORKS = ["mainnet", "testnet", "signet", "regtest"];
  var IMAGE_RE = /^[a-z0-9][a-z0-9._\/-]*(:[A-Za-z0-9._-]+)?(@sha256:[a-f0-9]{64})?$/;

  // Traduce (si js/i18n.js está cargado) e interpola {variables}.
  function T(s, vars) {
    if (MM.t) return MM.t(s, vars);
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return k in vars ? vars[k] : m; }) : s;
  }

  function macaroonPath(network) {
    return "/root/.lnd/data/chain/bitcoin/" + network + "/admin.macaroon";
  }

  function defaults() {
    return {
      deploy: {
        dir: "/opt/mostro",
        image: "mostrop2p/mostro:latest"
      },
      lightning: {
        // existing: conectar a un LND propio · install: instalar el stack · cashu: (aún no)
        mode: "existing",
        // "neutrino" (por defecto: sin Bitcoin Core) | "bitcoind"
        backend: "neutrino",
        // "10" | "50" | "custom" (pruneGB) | "full"
        prune: "50",
        pruneGB: 100,
        litd: false,
        // "latest" (la más nueva de js/versions.js) | una etiqueta | "other" (…VersionOther)
        bitcoindVersion: "latest",
        bitcoindVersionOther: "",
        lndVersion: "latest",
        lndVersionOther: "",
        litdVersion: "latest",
        litdVersionOther: "",
        location: "local",
        network: "mainnet",
        grpcHost: "https://127.0.0.1:10009",
        certPath: "/root/.lnd/tls.cert",
        macaroonPath: macaroonPath("mainnet"),
        invoice_expiration_window: 3600,
        hold_invoice_cltv_delta: 144,
        hold_invoice_expiration_window: 300,
        payment_attempts: 3,
        payment_retries_interval: 60,
        max_final_cltv_expiry_delta: 144,
        escrow_deadline_margin_blocks: 24,
        max_inflight_payouts: 100,
        max_inflight_payouts_per_destination: 10,
        payment_cltv_limit: 1008
      },
      nostr: {
        relays: [
          "wss://relay.mostro.network",
          "wss://mostro-p2p.tech",
          "wss://relay.shadowbip.com",
          "wss://nos.lol",
          "wss://relay.damus.io"
        ],
        keyMode: "server",
        existingKey: "",
        browserKey: null
      },
      identity: { name: "", about: "", picture: "", website: "" },
      business: {
        fee: 0,
        max_routing_fee: 0.002,
        max_order_amount: 1000000,
        min_payment_amount: 100,
        expiration_hours: 24,
        max_expiration_days: 15,
        expiration_seconds: 900,
        fiat_currencies_accepted: ["USD", "EUR", "ARS", "CUP"],
        dev_fee_percentage: 0.30,
        pow: 0
      },
      advanced: {
        rpcEnabled: false,
        rpcPort: 50051,
        rpcToken: true,
        healthEnabled: true,
        healthInterval: 60,
        watchdogPubkey: "",
        serberoPubkey: ""
      },
      // Preferencias de la interfaz; no afectan a los archivos generados.
      ui: {
        feeUnit: "pct",
        routingUnit: "ppm",
        showAdvanced: false,
        nodePiece: "bitcoind"
      }
    };
  }

  // Mostro usa host network cuando LND corre en el mismo servidor: así
  // 127.0.0.1:10009 y el certificado de LND (emitido para localhost) valen
  // también dentro del contenedor.
  function usesHostNetwork(state) {
    return state.lightning.mode === "existing" && state.lightning.location === "local";
  }

  function isInt(v) { return typeof v === "number" && Number.isInteger(v); }

  function isHttpUrl(s) {
    try {
      var u = new URL(s);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch (e) { return false; }
  }

  function validate(state) {
    var issues = [];
    // path: el data-bind del campo, cuando no es step + "." + field (los
    // parámetros de pagos y escrow viven en state.lightning pero se editan en Avanzado).
    // msg es una plantilla en español: T() la traduce e interpola vars.
    function err(step, field, msg, path, vars) { issues.push({ level: "error", step: step, field: field, msg: T(msg, vars), path: path }); }
    function warn(step, field, msg, path, vars) { issues.push({ level: "warn", step: step, field: field, msg: T(msg, vars), path: path }); }
    function intRange(step, field, v, min, max, label, path) {
      if (!isInt(v) || v < min || v > max) {
        err(step, field, "{label} debe ser un entero entre {min} y {max}.", path, { label: T(label), min: min, max: max });
        return false;
      }
      return true;
    }
    // Parámetros de pagos y escrow de Mostro: se editan en el paso Avanzado.
    function payErr(field, msg, vars) { err("advanced", field, msg, "lightning." + field, vars); }
    function payWarn(field, msg, vars) { warn("advanced", field, msg, "lightning." + field, vars); }
    function payRange(field, v, min, max) { return intRange("advanced", field, v, min, max, field, "lightning." + field); }

    // --- Destino ---
    var d = state.deploy;
    if (!/^\/[A-Za-z0-9._\/-]*[A-Za-z0-9._-]$/.test(d.dir) || d.dir === "/")
      err("deploy", "dir", "La carpeta de instalación debe ser una ruta absoluta sin espacios (p. ej. /opt/mostro).");
    if (!IMAGE_RE.test(d.image))
      err("deploy", "image", "La imagen Docker no tiene un formato válido.");
    else if (/:latest$/.test(d.image) || !/[:@]/.test(d.image))
      warn("deploy", "image", "Con :latest cada `docker compose pull` puede saltar de versión. En producción conviene fijar una versión (p. ej. mostrop2p/mostro:vX.Y.Z).");

    // --- Lightning ---
    var ln = state.lightning;
    if (ln.mode === "cashu") err("lightning", "mode", "Cashu todavía no está disponible en Mostro.");
    if (ln.mode === "existing") {
      if (!/^https:\/\/[^\s/'"]+:\d{1,5}$/.test(ln.grpcHost))
        err("lightning", "grpcHost", "El host gRPC de LND debe tener la forma https://host:puerto.");
      else if (ln.location === "remote" && /^https:\/\/(127\.0\.0\.1|localhost)[:/]/.test(ln.grpcHost))
        err("lightning", "grpcHost", "Elegiste un LND remoto pero el host apunta a esta máquina.");
      ["certPath", "macaroonPath"].forEach(function (f) {
        if (!/^\/[^\n\r\0]+$/.test(ln[f])) err("lightning", f, "La ruta debe ser absoluta.");
      });
      if (ln.location === "remote")
        warn("lightning", "grpcHost", "El certificado TLS de LND debe incluir ese host (opciones tlsextradomain / tlsextraip de LND), o la conexión fallará.");
      if (isInt(ln.escrow_deadline_margin_blocks) && ln.escrow_deadline_margin_blocks >= MIN_ESCROW_DEADLINE_MARGIN_BLOCKS &&
          ln.escrow_deadline_margin_blocks < LND_HOLD_EXPIRY_DELTA + ESCROW_HEADROOM_BLOCKS)
        payWarn("escrow_deadline_margin_blocks", "LND 0.21 usa invoices.holdexpirydelta = {d} por defecto (no 12). Si tu LND es reciente, usa un margen de al menos {min}.",
          { d: LND_HOLD_EXPIRY_DELTA, min: LND_HOLD_EXPIRY_DELTA + ESCROW_HEADROOM_BLOCKS });
    }
    if (ln.mode === "install") {
      if (INSTALL_NETWORKS.indexOf(ln.network) < 0)
        err("lightning", "network", "Para instalar el nodo elige mainnet, testnet, signet o regtest.");
      if (ln.network === "regtest" && ln.backend !== "bitcoind")
        err("lightning", "backend", "En regtest no hay nodos públicos: neutrino no funciona, hace falta Bitcoin Core.");
      if (isInt(ln.escrow_deadline_margin_blocks) && ln.escrow_deadline_margin_blocks < LND_HOLD_EXPIRY_DELTA + ESCROW_HEADROOM_BLOCKS)
        payErr("escrow_deadline_margin_blocks", "El LND que se instala usa invoices.holdexpirydelta = {d}: escrow_deadline_margin_blocks debe ser al menos {min}.",
          { d: LND_HOLD_EXPIRY_DELTA, min: LND_HOLD_EXPIRY_DELTA + ESCROW_HEADROOM_BLOCKS });
      if (ln.backend === "neutrino" && ln.network === "mainnet")
        warn("lightning", "backend", "Con neutrino LND depende de nodos públicos para ver la cadena. Para un Mostro en producción es más robusto Bitcoin Core.");
      if (ln.litd && (ln.network === "signet" || ln.network === "regtest"))
        warn("lightning", "litd", "En {net} Lightning Terminal funciona sin Loop ni Pool.", null, { net: ln.network });
      if (ln.backend === "bitcoind" && ln.prune === "custom" && ln.network !== "regtest" && !(isInt(ln.pruneGB) && ln.pruneGB >= 1))
        err("lightning", "pruneGB", "El tamaño de Bitcoin Core debe ser un número entero de GB (mínimo 1).");
      [["bitcoind", "Bitcoin Core"], ["lnd", "LND"], ["litd", "Lightning Terminal"]].forEach(function (p) {
        if (ln[p[0] + "Version"] === "other" && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(ln[p[0] + "VersionOther"]))
          err("lightning", p[0] + "VersionOther", "Escribe la versión de {name} tal como aparece en Docker Hub (p. ej. {example}).", null,
            { name: p[1], example: MM.VERSIONS[p[0]].tags[0] });
      });
    }

    payRange("invoice_expiration_window", ln.invoice_expiration_window, 1, U32_MAX);
    payRange("hold_invoice_expiration_window", ln.hold_invoice_expiration_window, 1, U32_MAX);
    payRange("payment_attempts", ln.payment_attempts, 0, U32_MAX);
    payRange("payment_retries_interval", ln.payment_retries_interval, 0, U32_MAX);
    payRange("max_inflight_payouts", ln.max_inflight_payouts, 0, U32_MAX);
    payRange("max_inflight_payouts_per_destination", ln.max_inflight_payouts_per_destination, 0, U32_MAX);
    var cltvOk = payRange("hold_invoice_cltv_delta", ln.hold_invoice_cltv_delta, 1, U32_MAX);
    var marginOk = payRange("escrow_deadline_margin_blocks", ln.escrow_deadline_margin_blocks, 0, U32_MAX);
    if (marginOk && ln.escrow_deadline_margin_blocks < MIN_ESCROW_DEADLINE_MARGIN_BLOCKS)
      payErr("escrow_deadline_margin_blocks", "escrow_deadline_margin_blocks debe ser al menos {min} (holdexpirydelta de LND, 12, más 6 de margen). Si subiste holdexpirydelta en LND, debe superarlo en 6.",
        { min: MIN_ESCROW_DEADLINE_MARGIN_BLOCKS });
    if (marginOk && cltvOk && ln.escrow_deadline_margin_blocks >= ln.hold_invoice_cltv_delta)
      payErr("escrow_deadline_margin_blocks", "escrow_deadline_margin_blocks debe ser menor que hold_invoice_cltv_delta ({cltv}).", { cltv: ln.hold_invoice_cltv_delta });
    var finalOk = payRange("max_final_cltv_expiry_delta", ln.max_final_cltv_expiry_delta, 1, U32_MAX);
    if (payRange("payment_cltv_limit", ln.payment_cltv_limit, 0, U32_MAX) && finalOk &&
        ln.payment_cltv_limit !== 0 && ln.payment_cltv_limit < ln.max_final_cltv_expiry_delta + PAYMENT_CLTV_ROUTE_ROOM)
      payErr("payment_cltv_limit", "payment_cltv_limit debe ser 0 o al menos max_final_cltv_expiry_delta + {room} ({min}); si no, no queda margen para la ruta.",
        { room: PAYMENT_CLTV_ROUTE_ROOM, min: ln.max_final_cltv_expiry_delta + PAYMENT_CLTV_ROUTE_ROOM });

    // --- Nostr ---
    var n = state.nostr;
    if (!n.relays.length) err("nostr", "relays", "Agrega al menos un relay.");
    n.relays.forEach(function (r) {
      var u;
      try { u = new URL(r); } catch (e) { u = null; }
      if (!u || (u.protocol !== "wss:" && u.protocol !== "ws:"))
        err("nostr", "relays", "Relay inválido: {relay} (debe empezar con wss://).", null, { relay: r });
      else if (u.protocol === "ws:" && !/^(localhost|127\.0\.0\.1)$/.test(u.hostname))
        warn("nostr", "relays", "{relay} no usa TLS (ws://). En producción usa wss://.", null, { relay: r });
    });
    if (n.keyMode === "existing") {
      try { MM.crypto.parseSecretKey(n.existingKey); }
      catch (e) { err("nostr", "existingKey", "La clave no es una nsec ni un hex de 64 caracteres válido ({reason}).", null, { reason: T(e.message) }); }
    } else if (n.keyMode === "browser" && !n.browserKey) {
      err("nostr", "browserKey", "Todavía no generaste la clave en el navegador.");
    }

    // --- Identidad ---
    var id = state.identity;
    if (id.picture && !isHttpUrl(id.picture)) err("identity", "picture", "La imagen debe ser una URL http(s).");
    if (id.website && !isHttpUrl(id.website)) err("identity", "website", "El sitio web debe ser una URL http(s).");
    if (!id.name) warn("identity", "name", "Sin nombre, los clientes mostrarán tu Mostro solo por su pubkey.");

    // --- Negocio ---
    var b = state.business;
    if (!(b.fee >= 0 && b.fee < 1)) err("business", "fee", "La comisión debe estar entre 0 y 100 %.");
    else if (b.fee > 0.05) warn("business", "fee", "Una comisión mayor al 5% es inusualmente alta.");
    if (!(b.max_routing_fee >= 0 && b.max_routing_fee < 1)) err("business", "max_routing_fee", "La comisión máxima de ruteo debe estar entre 0 y 100 %.");
    var minOk = intRange("business", "min_payment_amount", b.min_payment_amount, 1, U32_MAX, "El monto mínimo");
    var maxOk = intRange("business", "max_order_amount", b.max_order_amount, 1, U32_MAX, "El monto máximo");
    if (minOk && maxOk && b.min_payment_amount > b.max_order_amount)
      err("business", "max_order_amount", "El monto máximo no puede ser menor que el mínimo.");
    intRange("business", "expiration_hours", b.expiration_hours, 1, U32_MAX, "expiration_hours");
    intRange("business", "max_expiration_days", b.max_expiration_days, 1, U32_MAX, "max_expiration_days");
    intRange("business", "expiration_seconds", b.expiration_seconds, 1, U32_MAX, "expiration_seconds");
    intRange("business", "pow", b.pow, 0, 255, "pow");
    b.fiat_currencies_accepted.forEach(function (c) {
      if (!/^[A-Z]{3,5}$/.test(c)) err("business", "fiat_currencies_accepted", "Código de moneda inválido: {code} (usa códigos como USD, EUR, USDT).", null, { code: c });
    });
    if (!(b.dev_fee_percentage >= MIN_DEV_FEE_PERCENTAGE && b.dev_fee_percentage <= MAX_DEV_FEE_PERCENTAGE))
      err("business", "dev_fee_percentage", "El aporte al desarrollo debe estar entre {min} % y {max} % de tu comisión.", null,
        { min: MIN_DEV_FEE_PERCENTAGE * 100, max: MAX_DEV_FEE_PERCENTAGE * 100 });

    // --- Avanzado ---
    var a = state.advanced;
    if (a.rpcEnabled) {
      intRange("advanced", "rpcPort", a.rpcPort, 1, 65535, "El puerto RPC");
      if (!a.rpcToken)
        warn("advanced", "rpcToken", "Sin auth_token, cualquiera que llegue al puerto RPC puede cancelar o liquidar órdenes.");
    }
    if (a.healthEnabled) intRange("advanced", "healthInterval", a.healthInterval, 30, 3600, "El intervalo de health");
    if (a.watchdogPubkey && !MM.crypto.isValidPublicKey(a.watchdogPubkey))
      err("advanced", "watchdogPubkey", "watchdog_pubkey debe ser una npub o un hex de 64 caracteres.");
    if (a.serberoPubkey && !MM.crypto.isValidPublicKey(a.serberoPubkey))
      err("advanced", "serberoPubkey", "serbero_pubkey debe ser una npub o un hex de 64 caracteres.");

    return issues;
  }

  MM.config = {
    defaults: defaults,
    validate: validate,
    usesHostNetwork: usesHostNetwork,
    LND_HOLD_EXPIRY_DELTA: LND_HOLD_EXPIRY_DELTA,
    deploysLightning: function (state) { return state.lightning.mode === "install"; },
    // Imagen Docker de cada pieza del nodo: repo:etiqueta según la versión elegida.
    image: function (state, piece) {
      var ln = state.lightning, v = MM.VERSIONS[piece];
      var choice = ln[piece + "Version"];
      var tag = choice === "other" ? ln[piece + "VersionOther"] : (choice === "latest" || !choice ? v.tags[0] : choice);
      return v.repo + ":" + tag;
    },
    macaroonPath: macaroonPath
  };
})(typeof window !== "undefined" ? window : globalThis);
