// Idiomas: español (el texto original, que hace de clave) e inglés
// (js/i18n-en.js). Un texto sin traducción se muestra en español.
(function (root) {
  var MM = root.Mostromancer = root.Mostromancer || {};
  var STORAGE_KEY = "mostromancer:lang";
  var LANGS = ["es", "en"];

  function norm(s) { return String(s).replace(/\s+/g, " ").trim(); }

  function detect() {
    try {
      var saved = root.localStorage && root.localStorage.getItem(STORAGE_KEY);
      if (LANGS.indexOf(saved) >= 0) return saved;
    } catch (e) { /* sin almacenamiento */ }
    var nav = (root.navigator && root.navigator.language || "es").toLowerCase();
    return nav.indexOf("es") === 0 ? "es" : "en";
  }

  var lang = root.document ? detect() : "es";

  // t("Texto con {x}", { x: 1 }): traduce y luego interpola.
  function t(es, vars) {
    var s = es;
    if (lang === "en") {
      var en = (MM.I18N_EN || {})[norm(es)];
      // Conserva los espacios de alrededor: "Siguiente: " + "LND".
      if (en != null) s = es.match(/^\s*/)[0] + en + es.match(/\s*$/)[0];
    }
    if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return k in vars ? vars[k] : m; });
    return s;
  }

  // ---------- textos estáticos del HTML ----------
  // snapshot() guarda los originales (español) de los nodos de texto y de los
  // atributos traducibles que existen al cargar. Lo que JavaScript dibuja
  // después no entra aquí: se traduce con t() al dibujarse.

  var ATTRS = ["placeholder", "aria-label", "title"];
  var textNodes = [];
  var attrNodes = [];
  var htmlNodes = [];

  function skipped(el) {
    for (var p = el; p; p = p.parentElement) {
      if (p.hasAttribute("data-i18n-html")) return true;
      var tag = p.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "CODE" || tag === "PRE") return true;
    }
    return false;
  }

  function snapshot() {
    var doc = root.document;
    var walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
    for (var n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeValue.trim() && !skipped(n.parentElement)) textNodes.push({ node: n, es: n.nodeValue });
    }
    doc.querySelectorAll("[data-i18n-html]").forEach(function (el) { htmlNodes.push({ el: el, es: el.innerHTML }); });
    doc.querySelectorAll(ATTRS.map(function (a) { return "[" + a + "]"; }).join(",")).forEach(function (el) {
      ATTRS.forEach(function (a) { if (el.hasAttribute(a)) attrNodes.push({ el: el, attr: a, es: el.getAttribute(a) }); });
    });
  }

  function applyStatic() {
    var doc = root.document;
    doc.documentElement.lang = lang;
    textNodes.forEach(function (x) {
      // Conserva los espacios de alrededor: solo cambia el texto.
      var lead = x.es.match(/^\s*/)[0], trail = x.es.match(/\s*$/)[0];
      x.node.nodeValue = lead + t(norm(x.es)) + trail;
    });
    htmlNodes.forEach(function (x) { x.el.innerHTML = lang === "en" ? t(x.es) : x.es; });
    attrNodes.forEach(function (x) { x.el.setAttribute(x.attr, t(x.es)); });
  }

  function setLang(next) {
    if (LANGS.indexOf(next) < 0) return;
    lang = next;
    try { root.localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* ignorado */ }
    if (root.document) applyStatic();
  }

  // Textos del HTML que se traducen (para mantener el diccionario al día).
  function keys() {
    return textNodes.map(function (x) { return norm(x.es); })
      .concat(htmlNodes.map(function (x) { return norm(x.es); }))
      .concat(attrNodes.map(function (x) { return norm(x.es); }));
  }

  MM.i18n = {
    keys: keys,
    t: t,
    lang: function () { return lang; },
    setLang: setLang,
    snapshot: snapshot,
    applyStatic: applyStatic
  };
  MM.t = t;
})(typeof window !== "undefined" ? window : globalThis);
