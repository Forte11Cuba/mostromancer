// Interfaz del wizard: enlaza el formulario con el estado, navega entre
// pasos, recoge la entropía del movimiento y muestra los archivos generados.
(function () {
  "use strict";
  var MM = window.Mostromancer;
  var tr = MM.t;
  var STORAGE_KEY = "mostromancer:v1";

  // ---------- estado ----------

  function load() {
    var state = MM.config.defaults();
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved) {
        Object.keys(state).forEach(function (section) {
          if (saved[section]) Object.assign(state[section], saved[section]);
        });
      }
    } catch (e) { /* sin almacenamiento: se empieza con los valores por defecto */ }
    // Los secretos nunca se guardan.
    state.nostr.browserKey = null;
    state.nostr.existingKey = "";
    return state;
  }

  function save() {
    try {
      var copy = JSON.parse(JSON.stringify(state));
      copy.nostr.browserKey = null;
      copy.nostr.existingKey = "";
      localStorage.setItem(STORAGE_KEY, JSON.stringify(copy));
    } catch (e) { /* ignorado */ }
  }

  function get(path) {
    return path.split(".").reduce(function (o, k) { return o == null ? undefined : o[k]; }, state);
  }

  function set(path, value) {
    var keys = path.split(".");
    var last = keys.pop();
    keys.reduce(function (o, k) { return o[k]; }, state)[last] = value;
  }

  var state = load();

  // ---------- enlace formulario <-> estado ----------

  var form = document.getElementById("wizard");

  // Textos originales del HTML (en español) antes de que JS toque el DOM.
  MM.i18n.snapshot();
  if (MM.i18n.lang() !== "es") MM.i18n.applyStatic();

  // Selectores de versión: «Última», las versiones guardadas en js/versions.js y «Otra».
  function fillVersionOptions() {
    document.querySelectorAll("select[data-versions]").forEach(function (sel) {
      var v = MM.VERSIONS[sel.getAttribute("data-versions")];
      var value = sel.value;
      sel.textContent = "";
      function add(val, label) {
        var o = document.createElement("option");
        o.value = val;
        o.textContent = label;
        sel.appendChild(o);
      }
      add("latest", tr("Última ({tag})", { tag: v.tags[0] }));
      v.tags.forEach(function (t) { add(t, t); });
      add("other", tr("Otra versión…"));
      if (value) sel.value = value;
    });
  }
  fillVersionOptions();
  var bound = Array.prototype.slice.call(form.querySelectorAll("[data-bind]"));
  var touched = {};

  // Campos que se muestran en otra escala que la de settings.toml:
  // data-scale fija (aporte al desarrollo en %), o data-unit con la unidad
  // elegida por el usuario (% o ppm) para las comisiones.
  var UNIT_SCALE = { pct: 100, ppm: 1e6 };

  function scaleOf(el) {
    if (el.hasAttribute("data-scale")) return Number(el.getAttribute("data-scale"));
    if (el.hasAttribute("data-unit")) return UNIT_SCALE[get(el.getAttribute("data-unit"))] || 1;
    return 1;
  }

  // Quita el ruido de coma flotante (0.006 * 100 = 0.6000000000000001).
  function clean(n) { return Number(n.toPrecision(12)); }

  function readInput(el) {
    var list = el.getAttribute("data-list");
    if (list === "lines") return el.value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
    if (list === "csv") return el.value.split(/[\s,;]+/).map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean);
    if (el.type === "checkbox" && el.hasAttribute("data-on")) return el.getAttribute(el.checked ? "data-on" : "data-off");
    if (el.type === "checkbox") return el.checked;
    if (el.type === "number") return el.value === "" ? NaN : clean(Number(el.value) / scaleOf(el));
    return el.value.trim();
  }

  function writeInput(el) {
    var v = get(el.getAttribute("data-bind"));
    var list = el.getAttribute("data-list");
    if (el.type === "radio") el.checked = el.value === v;
    else if (el.type === "checkbox" && el.hasAttribute("data-on")) el.checked = v === el.getAttribute("data-on");
    else if (el.type === "checkbox") el.checked = !!v;
    else if (list === "lines") el.value = v.join("\n");
    else if (list === "csv") el.value = v.join(", ");
    else if (typeof v === "number") el.value = isNaN(v) ? "" : clean(v * scaleOf(el));
    else el.value = v;
  }

  function onInput(e) {
    var el = e.target;
    var path = el.getAttribute("data-bind");
    if (!path) return;
    if (el.type === "radio" && !el.checked) return;
    var before = get(path);
    set(path, el.type === "radio" ? el.value : readInput(el));
    touched[path] = true;
    sideEffects(path, before);
    save();
    refresh();
  }

  // Ajustes que acompañan a ciertos cambios, sin pisar lo que escribió el usuario.
  function sideEffects(path, before) {
    if (/^ui\.\w+Unit$/.test(path)) {
      bound.forEach(function (el) { if (el.getAttribute("data-unit") === path) writeInput(el); });
    }
    var ln = state.lightning;
    if (path === "lightning.network" && ln.macaroonPath === MM.config.macaroonPath(before)) {
      ln.macaroonPath = MM.config.macaroonPath(ln.network);
      writeBound("lightning.macaroonPath");
    }
    // Al instalar el nodo solo valen mainnet, testnet y signet.
    if (path === "lightning.mode" && ln.mode === "install" && ["mainnet", "testnet", "signet", "regtest"].indexOf(ln.network) < 0) {
      ln.network = "signet";
      writeBound("lightning.network");
    }
    // Regtest no tiene nodos públicos: sin Bitcoin Core no hay cadena.
    if (ln.mode === "install" && ln.network === "regtest" && ln.backend !== "bitcoind" &&
        (path === "lightning.network" || path === "lightning.backend" || path === "lightning.mode")) {
      ln.backend = "bitcoind";
      writeBound("lightning.backend");
    }
    if (path === "lightning.location") {
      var localHost = /^https:\/\/(127\.0\.0\.1|localhost):/.test(ln.grpcHost);
      if (ln.location === "local" && !localHost) ln.grpcHost = "https://127.0.0.1:10009";
      if (ln.location === "remote" && localHost) ln.grpcHost = "";
      writeBound("lightning.grpcHost");
    }
  }

  function writeBound(path) {
    bound.forEach(function (el) { if (el.getAttribute("data-bind") === path) writeInput(el); });
  }

  form.addEventListener("input", onInput);
  form.addEventListener("change", onInput);
  form.addEventListener("submit", function (e) { e.preventDefault(); });

  // ---------- pasos ----------

  var sections = Array.prototype.slice.call(document.querySelectorAll(".step"));
  var stepIds = sections.map(function (s) { return s.getAttribute("data-step"); });
  var current = 0;
  var visited = {};
  var stepper = document.getElementById("stepper");

  // Pantallas sin número (la bienvenida): no van al menú ni a la barra de progreso.
  var INTRO = sections.filter(function (s) { return s.hasAttribute("data-intro"); }).length;

  sections.forEach(function (s, i) {
    if (i < INTRO) return;
    var li = document.createElement("li");
    li.setAttribute("data-index", i);
    var b = document.createElement("button");
    b.type = "button";
    b.innerHTML = '<span class="tile" aria-hidden="true"></span><span class="label"></span><span class="state"></span>';
    b.querySelector(".tile").innerHTML = MM.icon(stepIds[i]);
    b.querySelector(".label").textContent = tr(s.getAttribute("data-title"));
    b.addEventListener("click", function () { go(i); });
    li.appendChild(b);
    stepper.appendChild(li);
  });

  function go(i) {
    visited[stepIds[current]] = true;
    generated = false;
    current = Math.max(0, Math.min(sections.length - 1, i));
    try { history.replaceState(null, "", "#" + stepIds[current]); } catch (e) { /* file:// en algunos navegadores */ }
    refresh();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  var segments = document.getElementById("progress-segments");
  for (var k = INTRO; k < sections.length; k++) segments.appendChild(document.createElement("span"));

  // Al instalar el nodo, el paso Lightning tiene tres subpasos: sus piezas.
  var PIECES = ["bitcoind", "lnd", "litd"];
  function inNodeBuilder() { return stepIds[current] === "lightning" && state.lightning.mode === "install"; }
  function setPiece(piece) {
    state.ui.nodePiece = piece;
    save();
    refresh();
  }
  document.querySelectorAll(".piece").forEach(function (b) {
    b.addEventListener("click", function () { setPiece(b.getAttribute("data-piece")); });
  });

  document.getElementById("prev").addEventListener("click", function () {
    var i = PIECES.indexOf(state.ui.nodePiece);
    if (inNodeBuilder() && i > 0) { setPiece(PIECES[i - 1]); return; }
    go(current - 1);
  });
  document.getElementById("next").addEventListener("click", function () {
    var i = PIECES.indexOf(state.ui.nodePiece);
    if (inNodeBuilder() && i < PIECES.length - 1) { setPiece(PIECES[i + 1]); return; }
    go(current + 1);
  });

  // ---------- render ----------

  function refresh() {
    var issues = MM.config.validate(state);
    var errorSteps = {};
    var errorFields = {};
    issues.forEach(function (i) {
      if (i.level !== "error") return;
      errorSteps[i.step] = true;
      errorFields[i.path || i.step + "." + i.field] = true;
    });

    sections.forEach(function (s, i) { s.classList.toggle("active", i === current); });
    Array.prototype.forEach.call(stepper.children, function (li) {
      var i = Number(li.getAttribute("data-index"));
      var id = stepIds[i];
      li.classList.toggle("active", i === current);
      var bad = !!errorSteps[id] && (visited[id] || stepIds[current] === "summary");
      var done = !!visited[id] && !errorSteps[id] && id !== "summary";
      li.classList.toggle("has-error", bad);
      li.classList.toggle("done", done);
      li.querySelector(".state").textContent = bad ? "revisar" : done ? "✓" : "";
    });
    Array.prototype.forEach.call(segments.children, function (seg, i) { seg.classList.toggle("on", i + INTRO <= current); });
    document.getElementById("progress-count").textContent = (current - INTRO + 1) + " / " + (sections.length - INTRO);
    var intro = current < INTRO;
    document.getElementById("progress").hidden = intro;
    document.getElementById("progress-count").parentNode.hidden = intro;
    document.getElementById("next").textContent = intro ? tr("Comenzar") : tr("Siguiente");

    // Un error en Avanzado abre sus opciones, para que el campo se vea.
    if (errorSteps.advanced && !state.ui.showAdvanced) state.ui.showAdvanced = true;

    var showAll = stepIds[current] === "summary";
    bound.forEach(function (el) {
      var path = el.getAttribute("data-bind");
      var section = el.closest(".step");
      var owner = section ? section.getAttribute("data-step") : "";
      el.classList.toggle("invalid", !!errorFields[path] && (touched[path] || showAll || visited[owner]));
    });

    document.querySelectorAll("[data-show-when]").forEach(function (el) {
      var parts = el.getAttribute("data-show-when").split("=");
      el.hidden = String(get(parts[0])) !== parts[1];
    });

    var step = stepIds[current];
    document.getElementById("prev").hidden = current === 0;
    // El paso Avanzado y el resumen tienen su propio botón principal.
    document.getElementById("next").hidden = step === "summary" || (step === "advanced" && !state.ui.showAdvanced);

    renderEquivalences();
    renderLightningSummary(errorFields);
    renderRequirements();
    renderPieces();
    renderCurrencyPicker();
    document.querySelectorAll("details.more").forEach(function (d) {
      if (d.querySelector(".invalid")) d.open = true;
    });

    document.getElementById("key-generate").disabled = !!state.nostr.browserKey;
    renderExistingKey();
    renderPreviews();
    if (stepIds[current] === "summary") renderSummary(issues);
  }

  function renderExistingKey() {
    var out = document.getElementById("existing-npub");
    if (state.nostr.keyMode !== "existing" || !state.nostr.existingKey) { out.textContent = ""; return; }
    try {
      out.textContent = "npub: " + MM.crypto.keypairFromSecret(MM.crypto.parseSecretKey(state.nostr.existingKey)).npub;
    } catch (e) {
      out.textContent = "";
    }
  }

  // ---------- vista previa: la tarjeta de «Elegir nodo» de la app ----------

  // 1000 -> "1k", 2100000 -> "2,1M", como los rangos de la app.
  function compact(n) {
    if (!isFinite(n)) return "?";
    function trim(v) { return (Math.round(v * 10) / 10).toString().replace(".", ","); }
    if (n >= 1e6) return trim(n / 1e6) + "M";
    if (n >= 1e3) return trim(n / 1e3) + "k";
    return String(n);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function previewPubkey() {
    var n = state.nostr;
    try {
      var hex = n.keyMode === "browser" && n.browserKey ? n.browserKey.pubkeyHex
        : n.keyMode === "existing" ? MM.crypto.keypairFromSecret(MM.crypto.parseSecretKey(n.existingKey)).pubkeyHex
        : null;
      if (hex) return hex.slice(0, 8) + "…" + hex.slice(-8);
    } catch (e) { /* clave aún inválida */ }
    return tr("pubkey al instalar");
  }

  function buildPreview() {
    var id = state.identity, b = state.business;
    var card = el("div", "node-card");

    var head = el("div", "node-head");
    var avatar = el("div", "node-avatar", (id.name || "M").trim().charAt(0).toUpperCase() || "M");
    if (/^https?:\/\//.test(id.picture)) {
      var img = new Image();
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.onload = function () { avatar.textContent = ""; avatar.appendChild(img); };
      img.src = id.picture;
    }
    head.appendChild(avatar);
    var who = el("div");
    var name = el("div", "node-name", id.name || tr("Tu Mostro"));
    who.appendChild(name);
    who.appendChild(el("div", "node-pk", previewPubkey()));
    who.appendChild(el("div", "node-status", tr("En línea · 0 órdenes")));
    head.appendChild(who);
    head.appendChild(el("div", "node-radio"));
    card.appendChild(head);

    if (id.about) card.appendChild(el("p", "node-about", id.about));

    var chips = el("div", "node-chips");
    var codes = b.fiat_currencies_accepted.length ? b.fiat_currencies_accepted : [tr("Todas las monedas")];
    codes.forEach(function (c) {
      var chip = el("span");
      var info = CURRENCY[c];
      chip.appendChild(currencyMark(info));
      chip.appendChild(document.createTextNode(c));
      chips.appendChild(chip);
    });
    card.appendChild(chips);

    var stats = el("div", "node-stats");
    function stat(value, unit, label, cls) {
      var d = el("div");
      var v = el("b", cls, value);
      if (unit) v.appendChild(el("small", null, unit));
      d.appendChild(v);
      d.appendChild(el("span", null, label));
      stats.appendChild(d);
    }
    stat("0", null, tr("órdenes ahora"), "lime");
    var fee = isFinite(b.fee) ? (Math.round(b.fee * 10000) / 100).toString().replace(".", ",") : "?";
    stat(fee, "%", tr("comisión"));
    stat(compact(b.min_payment_amount) + "–" + compact(b.max_order_amount), "sats", tr("por operación"));
    card.appendChild(stats);

    var foot = el("div", "node-foot");
    foot.appendChild(el("span", null, tr("⛉ Custodia Lightning")));
    foot.appendChild(el("span", null, tr("Sin depósito")));
    card.appendChild(foot);
    return card;
  }

  function renderPreviews() {
    var step = stepIds[current];
    if (step !== "identity" && step !== "business" && step !== "summary") return;
    document.querySelectorAll("[data-preview]").forEach(function (box) {
      if (!box.closest(".step.active")) return;
      box.textContent = "";
      box.appendChild(buildPreview());
    });
  }

  // ---------- comisiones: % o ppm ----------

  function fmtNum(n, decimals) {
    return n.toLocaleString("es", { maximumFractionDigits: decimals });
  }
  function fmtPct(frac) { return fmtNum(clean(frac * 100), 4) + " %"; }
  function fmtPpm(frac) { return fmtNum(Math.round(frac * 1e6), 0) + " ppm"; }

  function renderEquivalences() {
    document.querySelectorAll("[data-equiv]").forEach(function (span) {
      var v = get(span.getAttribute("data-equiv"));
      var unit = get(span.getAttribute("data-equiv-unit"));
      span.textContent = isFinite(v) ? "= " + (unit === "pct" ? fmtPpm(v) : fmtPct(v)) + "." : "";
    });
  }

  // ---------- Lightning: host y rutas plegados ----------

  function renderLightningSummary(errorFields) {
    var ln = state.lightning;
    var details = document.getElementById("ln-more");
    document.getElementById("ln-more-value").textContent = ln.grpcHost || tr("falta el host");
    var needsAttention = (ln.location === "remote" && !ln.grpcHost) ||
      ["grpcHost", "certPath", "macaroonPath"].some(function (f) { return errorFields["lightning." + f]; });
    if (needsAttention) details.open = true;
  }

  // ---------- requisitos del nodo a instalar ----------

  function renderRequirements() {
    var ln = state.lightning;
    var out = document.getElementById("ln-requirements");
    if (ln.mode !== "install") { out.textContent = ""; return; }
    var regtest = ln.network === "regtest";
    document.querySelectorAll(".size-block").forEach(function (x) { x.classList.toggle("off", regtest); });
    var full = ln.backend === "bitcoind" && ln.prune === "full" && !regtest;
    var gb = regtest ? 2 : ln.backend === "neutrino" ? 5 : ln.prune === "custom" ? (ln.pruneGB || 0) + 5 : Number(ln.prune) + 5;
    var sync = regtest ? tr("inmediata: en regtest tú minas los bloques")
      : ln.backend === "neutrino" ? tr("minutos")
      : ln.network === "mainnet" ? tr("de 1 a 3 días (descarga toda la cadena, aunque esté podado)") : tr("algunas horas");
    out.textContent = "";
    out.appendChild(el("b", null, tr("Necesitarás: ")));
    out.appendChild(document.createTextNode((full ? tr("disco para la blockchain completa") : "~" + gb + tr(" GB de disco")) + ", " + (ln.backend === "bitcoind" ? tr("4 GB de RAM") : tr("2 GB de RAM")) +
      ". " + tr("Primera sincronización: {sync}.", { sync: sync })));
  }

  // ---------- piezas del nodo ----------

  function versionLabel(piece) {
    return MM.config.image(state, piece).split(":").pop();
  }

  function renderPieces() {
    var ln = state.lightning;
    var active = state.ui.nodePiece;
    document.querySelectorAll(".piece").forEach(function (b) {
      var piece = b.getAttribute("data-piece");
      var on = piece === "lnd" || (piece === "bitcoind" ? ln.backend === "bitcoind" : ln.litd);
      b.classList.toggle("active", piece === active);
      b.classList.toggle("off", !on);
      b.setAttribute("aria-selected", String(piece === active));
    });
    var size = ln.network === "regtest" ? "regtest" : ln.prune === "full" ? tr("completo") : (ln.prune === "custom" ? ln.pruneGB : ln.prune) + " GB";
    document.getElementById("piece-status-bitcoind").textContent = ln.backend === "bitcoind" ? size + " · " + versionLabel("bitcoind") : tr("No · usará neutrino");
    document.getElementById("piece-status-lnd").textContent = versionLabel("lnd");
    document.getElementById("piece-status-litd").textContent = ln.litd ? versionLabel("litd") : "No";
    // En el último subpaso, «Siguiente» ya lleva al paso siguiente del wizard.
    if (inNodeBuilder()) document.getElementById("next").textContent =
      active === "litd" ? tr("Siguiente") : tr("Siguiente: ") + (active === "bitcoind" ? "LND" : "Lightning Terminal");
  }

  // ---------- selector de monedas: lista desplegable con casillas ----------
  // La lista es la de Yadio (js/currencies.js), el proveedor de precios por
  // defecto de Mostro; los nombres se muestran en español con Intl.

  var POPULAR = ["USD", "EUR", "ARS", "VES", "CUP", "BRL", "COP", "MXN"];
  var CURRENCY = {};
  MM.CURRENCIES.forEach(function (c) { CURRENCY[c.code] = c; });

  // Nombre de cada moneda en el idioma de la página (Intl), o el de Yadio.
  function labelCurrencies() {
    var names = null;
    try { names = new Intl.DisplayNames([MM.i18n.lang()], { type: "currency" }); } catch (e) { names = null; }
    MM.CURRENCIES.forEach(function (c) {
      var name = null;
      try { name = names && names.of(c.code); } catch (e) { name = null; }
      c.label = name && name !== c.code ? name.charAt(0).toUpperCase() + name.slice(1) : c.name;
    });
  }

  var picker = document.getElementById("currency-picker");
  picker.innerHTML =
    '<div class="dropdown" id="cur-dd">' +
    '  <button type="button" class="dropdown-toggle" id="cur-toggle" aria-expanded="false" aria-haspopup="listbox">' +
    '    <span id="cur-label"></span>' +
    '    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' +
    '  </button>' +
    '  <div class="dropdown-panel" id="cur-panel" hidden>' +
    '    <input type="search" id="cur-search" spellcheck="false">' +
    '    <label class="dd-option dd-all"><input type="checkbox" id="cur-all"><span class="dd-text"><b id="cur-all-label"></b><small id="cur-all-sub"></small></span></label>' +
    '    <div class="dd-list" id="cur-list"></div>' +
    '  </div>' +
    '</div>' +
    '<div class="cur-chips" id="cur-chips"></div>';

  var curList = document.getElementById("cur-list");
  var curPanel = document.getElementById("cur-panel");
  var curToggle = document.getElementById("cur-toggle");
  var curSearch = document.getElementById("cur-search");

  function currencyMark(info) {
    return el("span", info && info.flag ? "flag" : "sym", (info && info.flag) || "¤");
  }

  function optionFor(c) {
    var label = el("label", "dd-option");
    label.setAttribute("data-code", c.code);
    label.setAttribute("data-search", (c.code + " " + c.label + " " + c.name).toLowerCase());
    var box = document.createElement("input");
    box.type = "checkbox";
    box.value = c.code;
    label.appendChild(box);
    label.appendChild(currencyMark(c));
    var text = el("span", "dd-text");
    text.appendChild(el("b", null, c.code));
    text.appendChild(el("small", null, c.label));
    label.appendChild(text);
    return label;
  }

  function buildCurrencyList() {
    labelCurrencies();
    curSearch.placeholder = tr("Buscar por código o nombre…");
    document.getElementById("cur-all-label").textContent = tr("Todas las monedas");
    document.getElementById("cur-all-sub").textContent = tr("Sin restricción");
    curList.textContent = "";
    curList.appendChild(el("div", "dd-group", tr("Más usadas")));
    POPULAR.forEach(function (code) { if (CURRENCY[code]) curList.appendChild(optionFor(CURRENCY[code])); });
    curList.appendChild(el("div", "dd-group", tr("Todas (A–Z)")));
    MM.CURRENCIES.forEach(function (c) { if (POPULAR.indexOf(c.code) < 0) curList.appendChild(optionFor(c)); });
  }
  buildCurrencyList();

  function setCurrencies(list) {
    state.business.fiat_currencies_accepted = list;
    touched["business.fiat_currencies_accepted"] = true;
    save();
    refresh();
  }

  function openPanel(open) {
    curPanel.hidden = !open;
    curToggle.setAttribute("aria-expanded", String(open));
    if (open) { curSearch.value = ""; filterList(""); curSearch.focus(); }
  }

  function filterList(q) {
    q = q.trim().toLowerCase();
    Array.prototype.forEach.call(curList.children, function (row) {
      if (row.classList.contains("dd-group")) { row.hidden = !!q; return; }
      row.hidden = !!q && row.getAttribute("data-search").indexOf(q) < 0;
    });
  }

  curToggle.addEventListener("click", function () { openPanel(curPanel.hidden); });
  curSearch.addEventListener("input", function (e) { e.stopPropagation(); filterList(e.target.value); });
  curSearch.addEventListener("keydown", function (e) { if (e.key === "Escape") { openPanel(false); curToggle.focus(); } });
  document.addEventListener("click", function (e) {
    if (!curPanel.hidden && !document.getElementById("cur-dd").contains(e.target)) openPanel(false);
  });

  curPanel.addEventListener("change", function (e) {
    e.stopPropagation();
    var box = e.target;
    if (box.id === "cur-all") {
      if (box.checked) setCurrencies([]);
      else setCurrencies(POPULAR.slice(0, 4));
      return;
    }
    var cur = state.business.fiat_currencies_accepted.slice();
    var i = cur.indexOf(box.value);
    if (box.checked && i < 0) cur.push(box.value);
    if (!box.checked && i >= 0) cur.splice(i, 1);
    setCurrencies(cur);
  });

  function renderCurrencyPicker() {
    var selected = state.business.fiat_currencies_accepted;
    var all = selected.length === 0;
    document.getElementById("cur-label").textContent = all ? tr("Todas las monedas")
      : selected.length <= 4 ? selected.join(", ")
      : tr("{list} y {n} más", { list: selected.slice(0, 3).join(", "), n: selected.length - 3 });
    document.getElementById("cur-all").checked = all;
    curList.querySelectorAll("input[type=checkbox]").forEach(function (box) {
      box.checked = selected.indexOf(box.value) >= 0;
    });

    var chips = document.getElementById("cur-chips");
    chips.textContent = "";
    selected.forEach(function (code) {
      var chip = el("span", "cur-chip");
      chip.appendChild(currencyMark(CURRENCY[code]));
      chip.appendChild(document.createTextNode(code));
      var x = el("button", "chip-x", "×");
      x.type = "button";
      x.setAttribute("aria-label", tr("Quitar {code}", { code: code }));
      x.addEventListener("click", function () {
        setCurrencies(state.business.fiat_currencies_accepted.filter(function (c) { return c !== code; }));
      });
      chip.appendChild(x);
      chips.appendChild(chip);
    });
  }

  // ---------- Avanzado: opcional, como «Geeky settings?» ----------

  var PAYMENT_FIELDS = ["invoice_expiration_window", "hold_invoice_cltv_delta", "hold_invoice_expiration_window",
    "payment_attempts", "payment_retries_interval", "max_final_cltv_expiry_delta", "escrow_deadline_margin_blocks",
    "max_inflight_payouts", "max_inflight_payouts_per_destination", "payment_cltv_limit"];

  (function () {
    var defaults = MM.config.defaults();
    var d = defaults.advanced;
    var changed = Object.keys(d).some(function (k) { return state.advanced[k] !== d[k]; }) ||
      PAYMENT_FIELDS.some(function (k) { return state.lightning[k] !== defaults.lightning[k]; });
    if (changed) state.ui.showAdvanced = true;
  })();

  document.getElementById("advanced-skip").addEventListener("click", function () { go(current + 1); });
  document.getElementById("advanced-show").addEventListener("click", function () {
    state.ui.showAdvanced = true;
    save();
    refresh();
  });

  // ---------- resumen legible ----------

  function reviewData() {
    var d = state.deploy, ln = state.lightning, n = state.nostr, id = state.identity, b = state.business, a = state.advanced;
    var npub = null;
    try {
      npub = n.keyMode === "browser" && n.browserKey ? n.browserKey.npub
        : n.keyMode === "existing" ? MM.crypto.keypairFromSecret(MM.crypto.parseSecretKey(n.existingKey)).npub : null;
    } catch (e) { npub = null; }
    function short(s) { return s.length > 24 ? s.slice(0, 14) + "…" + s.slice(-8) : s; }
    var dash = "—";
    return [
      ["deploy", [
        [tr("Instalación"), tr("Script de instalación o cloud-init")],
        [tr("Carpeta"), d.dir],
        [tr("Imagen"), d.image]
      ]],
      ["lightning", ln.mode === "install" ? [
        ["Bitcoin Core", ln.backend === "bitcoind"
          ? versionLabel("bitcoind") + (ln.network === "regtest" || ln.prune === "full" ? tr(", completo") : tr(", podado a ") + (ln.prune === "custom" ? ln.pruneGB : ln.prune) + " GB")
          : tr("No (LND usa neutrino)")],
        ["LND", versionLabel("lnd")],
        ["Lightning Terminal", ln.litd ? versionLabel("litd") : "No"],
        [tr("Red"), ln.network]
      ] : [
        [tr("Conexión"), tr("LND existente, ") + (ln.location === "local" ? tr("en este mismo servidor") : tr("en otra máquina"))],
        [tr("Host"), ln.grpcHost || dash],
        [tr("Red"), ln.network]
      ]],
      ["nostr", [
        [tr("Relays"), n.relays.join(", ") || dash],
        [tr("Clave"), n.keyMode === "server" ? tr("Se genera en el servidor")
          : (n.keyMode === "browser" ? tr("Generada aquí") : tr("La tuya")) + (npub ? " · " + short(npub) : "")]
      ]],
      ["identity", [
        [tr("Nombre"), id.name || dash],
        [tr("Descripción"), id.about || dash],
        [tr("Imagen"), id.picture || dash],
        [tr("Sitio web"), id.website || dash]
      ]],
      ["business", [
        [tr("Comisión"), isFinite(b.fee) ? fmtPct(b.fee) + " (" + fmtPpm(b.fee) + ")" : dash],
        [tr("Montos"), fmtNum(b.min_payment_amount, 0) + " – " + fmtNum(b.max_order_amount, 0) + " sats"],
        [tr("Monedas"), b.fiat_currencies_accepted.length ? b.fiat_currencies_accepted.join(", ") : tr("Todas")],
        [tr("Aporte al desarrollo"), fmtPct(b.dev_fee_percentage) + tr(" de tu comisión")]
      ]],
      ["advanced", [
        [tr("Pagos y escrow"), PAYMENT_FIELDS.some(function (k) { return ln[k] !== MM.config.defaults().lightning[k]; }) ? tr("Personalizados") : tr("Los de Mostro")],
        ["RPC", a.rpcEnabled ? tr("Activo en 127.0.0.1:") + a.rpcPort + (a.rpcToken ? tr(", con token") : tr(", sin token")) : tr("Desactivado")],
        [tr("Salud"), a.healthEnabled ? tr("Publica cada ") + a.healthInterval + " s" : tr("Desactivada")],
        [tr("Serbero"), a.serberoPubkey ? short(a.serberoPubkey) : dash]
      ]]
    ];
  }

  function renderReview() {
    var box = document.getElementById("review-table");
    box.textContent = "";
    reviewData().forEach(function (sec) {
      var idx = stepIds.indexOf(sec[0]);
      var block = el("div", "review-block");
      var head = el("div", "review-head");
      var title = el("span", "review-title");
      title.innerHTML = MM.icon(sec[0], 16);
      title.appendChild(document.createTextNode(tr(sections[idx].getAttribute("data-title"))));
      head.appendChild(title);
      var edit = el("button", "linkish", tr("Editar"));
      edit.type = "button";
      edit.addEventListener("click", function () { go(idx); });
      head.appendChild(edit);
      block.appendChild(head);
      sec[1].forEach(function (row) {
        var r = el("div", "review-row");
        r.appendChild(el("span", null, row[0]));
        r.appendChild(el("span", null, row[1]));
        block.appendChild(r);
      });
      box.appendChild(block);
    });
  }

  var generated = false;
  document.getElementById("generate").addEventListener("click", function () {
    generated = true;
    refresh();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  document.getElementById("back-review").addEventListener("click", function () {
    generated = false;
    refresh();
  });

  // ---------- resumen y archivos ----------

  // Cada paso: [texto, comando opcional]. El comando se puede copiar con un clic.
  var OUTPUTS = {
    install: {
      file: "install-mostro.sh", type: "text/x-shellscript",
      steps: function () {
        var dir = state.deploy.dir;
        return [
          [tr("Descarga el instalador con el botón «Descargar».")],
          [tr("Cópialo a tu servidor:"), tr("scp install-mostro.sh usuario@tu-servidor:")],
          [tr("Conéctate al servidor:"), tr("ssh usuario@tu-servidor")],
          [tr("Revisa lo que hace (opcional, pero recomendado):"), "less install-mostro.sh"],
          [tr("Ejecútalo:"), "sudo bash install-mostro.sh"],
          [tr("Al terminar verás la pubkey de tu Mostro. Respalda su clave en un lugar seguro:"), "sudo cat " + dir + "/config/.env"],
          [tr("Sigue los logs cuando quieras:"), "cd " + dir + " && sudo docker compose logs -f"]
        ].concat(nodeSteps());
      },
      get note() { return tr("Puedes volver a ejecutarlo para cambiar la configuración: conserva la clave, el token RPC y la base de datos."); },
      make: function () { return MM.generate.installSh(state); }
    },
    cloudinit: {
      file: "cloud-init.yml", type: "text/yaml",
      steps: function () {
        var dir = state.deploy.dir;
        return [
          [tr("Copia o descarga el cloud-init.")],
          [tr("Al crear el VPS, pégalo en el campo «User data» (o «cloud-init») de tu proveedor.")],
          [tr("Cuando el VPS arranque, copia las credenciales de LND al servidor:"), tr("scp tls.cert admin.macaroon usuario@tu-servidor:") + dir + "/config/lnd/"],
          [tr("Conéctate y arranca Mostro:"), "cd " + dir + " && sudo docker compose up -d"],
          [tr("Comprueba que funciona y anota su pubkey:"), "cd " + dir + " && sudo docker compose logs mostro | grep pubkey"]
        ].filter(function (st, i) { return state.lightning.mode !== "install" || i < 2 || i === 4; })
         .concat(state.lightning.mode === "install"
           ? [[tr("La semilla de LND queda en el servidor. Léela y bórrala:"), "sudo cat " + dir + "/LND-SEED.txt"]].concat(nodeSteps().slice(1))
           : []);
      },
      get note() {
        return state.lightning.mode === "install"
          ? tr("Con el nodo instalado por Mostromancer todo arranca solo: no hay que copiar credenciales.")
          : tr("Si las credenciales de LND ya estaban en las rutas que indicaste, Mostro arranca solo y puedes saltarte los pasos 3 y 4.");
      },
      make: function () { return MM.generate.cloudInit(state); }
    },
    settings: {
      file: "settings.toml", type: "application/toml",
      steps: function () {
        var dir = state.deploy.dir;
        return [
          [tr("Para una instalación manual, guárdalo en la carpeta de configuración:"), dir + "/config/settings.toml"],
          [tr("Guarda la clave aparte, en config/.env (nunca en settings.toml):"), "echo 'MOSTRO_NSEC_PRIVKEY=nsec1…' > " + dir + "/config/.env && chmod 600 " + dir + "/config/.env"],
          [tr("Copia también compose.yml a {dir} y arranca:", { dir: dir }), "cd " + dir + " && sudo docker compose up -d"]
        ];
      },
      get note() { return tr("Lo más simple es usar install-mostro.sh, que hace todo esto por ti."); },
      make: function () { return MM.generate.settingsToml(state); }
    },
    compose: {
      file: "compose.yml", type: "text/yaml",
      steps: function () {
        var dir = state.deploy.dir;
        return [
          [tr("Guárdalo junto a la carpeta config/:"), dir + "/compose.yml"],
          ["Arranca Mostro:", "cd " + dir + " && sudo docker compose up -d"],
          [tr("Para actualizar a una versión nueva:"), "cd " + dir + " && sudo docker compose pull && sudo docker compose up -d"]
        ];
      },
      get note() { return tr("Lo más simple es usar install-mostro.sh, que hace todo esto por ti."); },
      make: function () { return MM.generate.composeYml(state); }
    }
  };

  // Pasos extra cuando el instalador monta el nodo Lightning.
  function nodeSteps() {
    var ln = state.lightning, dir = state.deploy.dir;
    if (ln.mode !== "install") return [];
    var lncli = "sudo docker exec mostro-lnd lncli --network=" + ln.network;
    var steps = [
      [tr("El instalador muestra las 24 palabras de la semilla de LND. Anótalas en papel y borra la copia del servidor:"), "sudo shred -u " + dir + "/LND-SEED.txt"],
      ln.network === "regtest"
        ? [tr("Mina 101 bloques con la recompensa para LND (en regtest la cadena no avanza sola):"), "sudo " + MM.generate.regtestMine(state, 101).replace("$(docker", "$(sudo docker")]
        : [tr("Fondea LND con bitcoin on-chain. Genera una dirección:"), lncli + " newaddress p2tr"],
      [tr("Abre canales con liquidez de entrada y de salida: Mostro los necesita para cobrar y pagar.")]
    ];
    if (ln.backend === "bitcoind" && ln.network !== "regtest") steps.splice(1, 0, [tr("Espera a que Bitcoin Core sincronice. Puedes seguir el progreso:"), "cd " + dir + " && sudo docker compose logs -f bitcoind"]);
    if (ln.litd) steps.push(
      [tr("Para entrar a Lightning Terminal, abre un túnel desde tu computadora:"), tr("ssh -L 8443:127.0.0.1:8443 usuario@tu-servidor")],
      [tr("Entra a https://localhost:8443 con la contraseña que está en:"), "sudo cat " + dir + "/litd/uipassword"]
    );
    return steps;
  }

  function renderSteps(box) {
    var o = OUTPUTS[currentOut];
    box.textContent = "";
    var ol = el("ol", "howto");
    o.steps().forEach(function (st) {
      var li = el("li");
      li.appendChild(el("span", null, st[0]));
      if (st[1]) {
        var cmd = el("button", "cmd");
        cmd.type = "button";
        cmd.title = tr("Copiar");
        cmd.appendChild(el("code", null, st[1]));
        cmd.appendChild(el("span", "cmd-copy", tr("Copiar")));
        cmd.addEventListener("click", function () {
          copyText(st[1], function (ok) { cmd.querySelector(".cmd-copy").textContent = ok ? tr("Copiado") : tr("Selecciónalo"); });
        });
        li.appendChild(cmd);
      }
      ol.appendChild(li);
    });
    box.appendChild(ol);
    var note = o.note;
    if (state.nostr.keyMode !== "server" && (currentOut === "install" || currentOut === "cloudinit"))
      note += tr(" Este archivo contiene la clave privada de tu Mostro: no lo compartas y bórralo después de usarlo.");
    box.appendChild(el("p", "hint", note));
  }

  function copyText(text, done) {
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      ta.remove();
      done(ok);
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    else fallback();
  }

  var currentOut = "install";
  var outText = document.getElementById("out-text");
  var outStatus = document.getElementById("out-status");

  function renderSummary(issues) {
    var box = document.getElementById("issues");
    box.textContent = "";
    var errors = issues.filter(function (i) { return i.level === "error"; });
    if (!issues.length) {
      var ok = document.createElement("p");
      ok.className = "all-good";
      ok.textContent = tr("Todo en orden: mostrod aceptará esta configuración.");
      box.appendChild(ok);
    } else {
      var ul = document.createElement("ul");
      ul.className = "issue-list";
      issues.forEach(function (i) {
        var li = document.createElement("li");
        li.className = i.level;
        var where = document.createElement("button");
        where.type = "button";
        where.className = "where linkish";
        where.textContent = tr(sections[stepIds.indexOf(i.step)].getAttribute("data-title"));
        where.addEventListener("click", function () { go(stepIds.indexOf(i.step)); });
        li.appendChild(where);
        li.appendChild(document.createTextNode(i.msg));
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }

    var blocked = errors.length > 0;
    if (blocked) generated = false;
    document.getElementById("review").hidden = generated;
    document.getElementById("outputs").hidden = !generated;
    document.getElementById("generate").disabled = blocked;
    document.getElementById("generate").textContent = blocked ? tr("Corrige los errores para continuar") : tr("Generar instalador");
    if (!generated) { renderReview(); return; }
    document.querySelectorAll(".tabs button").forEach(function (b) {
      b.setAttribute("aria-selected", String(b.getAttribute("data-out") === currentOut));
    });

    renderSteps(document.getElementById("out-help"));
    outText.textContent = blocked ? "" : OUTPUTS[currentOut].make();
    outStatus.textContent = "";
  }

  document.querySelectorAll(".tabs button").forEach(function (b) {
    b.addEventListener("click", function () { currentOut = b.getAttribute("data-out"); refresh(); });
  });

  document.getElementById("out-download").addEventListener("click", function () {
    var o = OUTPUTS[currentOut];
    var url = URL.createObjectURL(new Blob([outText.textContent], { type: o.type }));
    var a = document.createElement("a");
    a.href = url;
    a.download = o.file;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    outStatus.textContent = tr("Descargado {file}", { file: o.file });
  });

  document.getElementById("out-copy").addEventListener("click", function () {
    copyText(outText.textContent, function (ok) {
      outStatus.textContent = ok ? tr("Copiado") : tr("No se pudo copiar: selecciónalo a mano");
    });
  });

  // ---------- entropía del movimiento ----------

  var TARGET_SAMPLES = 256;
  var pad = document.getElementById("entropy-pad");
  var canvas = document.getElementById("entropy-canvas");
  var ctx = canvas.getContext("2d");
  var fill = document.getElementById("entropy-fill");
  var pool = [];
  var lastX = null, lastY = null;
  var sparks = [];

  function resizeCanvas() {
    var r = pad.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(r.height * devicePixelRatio));
  }

  function addSample(x, y, t) {
    if (state.nostr.browserKey) return;
    pool.push(x, y, t);
    var samples = pool.length / 3;
    fill.style.width = Math.min(100, (samples / TARGET_SAMPLES) * 100) + "%";
    if (samples >= TARGET_SAMPLES) makeKey();
  }

  function onPointer(e) {
    var r = pad.getBoundingClientRect();
    var x = e.clientX - r.left, y = e.clientY - r.top;
    if (x === lastX && y === lastY) return;
    lastX = x; lastY = y;
    addSample(x, y, performance.now() + e.timeStamp);
    sparks.push({ x: x * devicePixelRatio, y: y * devicePixelRatio, life: 1 });
    if (sparks.length === 1) requestAnimationFrame(drawSparks);
  }

  function drawSparks() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    sparks.forEach(function (s) {
      ctx.globalAlpha = s.life;
      ctx.fillStyle = s.life > 0.6 ? "#92d64f" : "#f2d14b";
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3 * devicePixelRatio * s.life + 1, 0, Math.PI * 2);
      ctx.fill();
      s.life -= 0.03;
    });
    ctx.globalAlpha = 1;
    sparks = sparks.filter(function (s) { return s.life > 0; });
    if (sparks.length) requestAnimationFrame(drawSparks);
  }

  pad.addEventListener("pointermove", onPointer);
  pad.addEventListener("pointerdown", onPointer);
  pad.addEventListener("keydown", function (e) { addSample(e.keyCode || 0, e.key.length, performance.now()); });
  window.addEventListener("resize", resizeCanvas);

  function makeKey() {
    var extra = new Uint8Array(new Float64Array(pool).buffer);
    state.nostr.browserKey = MM.crypto.keypairFromSecret(MM.crypto.generateSecret(extra));
    pool = [];
    pad.classList.add("complete");
    fill.style.width = "100%";
    document.getElementById("key-npub").value = state.nostr.browserKey.npub;
    var nsec = document.getElementById("key-nsec");
    nsec.value = state.nostr.browserKey.nsec;
    nsec.type = "password";
    document.getElementById("key-reveal").textContent = tr("Ver");
    document.getElementById("key-result").hidden = false;
    refresh();
  }

  document.getElementById("key-generate").addEventListener("click", function () {
    if (!state.nostr.browserKey) makeKey();
  });

  document.getElementById("key-clear").addEventListener("click", function () {
    state.nostr.browserKey = null;
    pool = [];
    pad.classList.remove("complete");
    fill.style.width = "0";
    document.getElementById("key-npub").value = "";
    document.getElementById("key-nsec").value = "";
    document.getElementById("key-result").hidden = true;
    refresh();
  });

  document.getElementById("key-reveal").addEventListener("click", function (e) {
    var nsec = document.getElementById("key-nsec");
    var show = nsec.type === "password";
    nsec.type = show ? "text" : "password";
    e.target.textContent = show ? tr("Ocultar") : tr("Ver");
  });

  document.getElementById("reset").addEventListener("click", function () {
    if (!confirm(tr("¿Borrar todo lo configurado y empezar de cero?"))) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignorado */ }
    location.hash = "";
    location.reload();
  });

  // ---------- idioma ----------

  function renderLangSwitch() {
    document.querySelectorAll(".lang-switch button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-lang") === MM.i18n.lang()));
    });
  }

  document.querySelectorAll(".lang-switch button").forEach(function (b) {
    b.addEventListener("click", function () {
      MM.i18n.setLang(b.getAttribute("data-lang"));
      // Lo que JS dibujó una sola vez se vuelve a dibujar en el nuevo idioma.
      Array.prototype.forEach.call(stepper.children, function (li) {
        li.querySelector(".label").textContent = tr(sections[Number(li.getAttribute("data-index"))].getAttribute("data-title"));
      });
      fillVersionOptions();
      bound.forEach(function (el) { if (el.tagName === "SELECT") writeInput(el); });
      buildCurrencyList();
      if (state.nostr.browserKey) document.getElementById("key-reveal").textContent =
        document.getElementById("key-nsec").type === "password" ? tr("Ver") : tr("Ocultar");
      renderLangSwitch();
      refresh();
    });
  });
  renderLangSwitch();

  // ---------- inicio ----------

  document.querySelectorAll(".card[data-icon]").forEach(function (card) {
    var icon = el("span", "card-icon");
    icon.innerHTML = MM.icon(card.getAttribute("data-icon"), 22);
    card.insertBefore(icon, card.firstChild);
  });
  document.querySelectorAll("[data-tile]").forEach(function (t) { t.innerHTML = MM.icon(t.getAttribute("data-tile")); });

  bound.forEach(writeInput);
  var fromHash = stepIds.indexOf(location.hash.slice(1));
  current = fromHash >= 0 ? fromHash : 0;
  resizeCanvas();
  refresh();
  // El canvas está oculto hasta que se elige "Generar aquí"; se mide al mostrarse.
  form.addEventListener("change", function () { requestAnimationFrame(resizeCanvas); });
})();
