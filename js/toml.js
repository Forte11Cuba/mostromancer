// Edición quirúrgica de settings.tpl.toml: cambia valores en su sitio y
// conserva todos los comentarios del template de Mostro.
(function (root) {
  var MM = root.Mostromancer = root.Mostromancer || {};

  function str(value) {
    var out = '"';
    for (var i = 0; i < value.length; i++) {
      var ch = value[i], code = value.charCodeAt(i);
      if (ch === '"') out += '\\"';
      else if (ch === "\\") out += "\\\\";
      else if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else if (code < 0x20 || code === 0x7f) out += "\\u" + code.toString(16).padStart(4, "0");
      else out += ch;
    }
    return out + '"';
  }

  function num(value) {
    if (typeof value !== "number" || !isFinite(value)) throw new Error("número inválido: " + value);
    return String(value);
  }

  function bool(value) { return value ? "true" : "false"; }

  function strArray(values) { return "[" + values.map(str).join(", ") + "]"; }

  var HEADER = /^\s*\[([^\]]+)\]\s*$/;

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // Fija `key = literal` dentro de `[section]`. Usa la línea activa si
  // existe; si no, descomenta la primera `# key = ...` de la sección; si
  // tampoco existe, la agrega justo debajo del encabezado (y crea la
  // sección al final si hace falta).
  function setKey(text, section, key, literal) {
    var lines = text.split("\n");
    var active = new RegExp("^\\s*" + escapeRe(key) + "\\s*=");
    var commented = new RegExp("^#\\s?" + escapeRe(key) + "\\s*=");
    var current = null, headerIdx = -1, activeIdx = -1, commentedIdx = -1;

    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(HEADER);
      if (m) {
        current = m[1].trim();
        if (current === section) headerIdx = i;
        continue;
      }
      if (current !== section) continue;
      if (activeIdx < 0 && active.test(lines[i])) activeIdx = i;
      else if (commentedIdx < 0 && commented.test(lines[i])) commentedIdx = i;
    }

    var line = key + " = " + literal;
    if (activeIdx >= 0) lines[activeIdx] = line;
    else if (commentedIdx >= 0) lines[commentedIdx] = line;
    else if (headerIdx >= 0) lines.splice(headerIdx + 1, 0, line);
    else lines.push("", "[" + section + "]", line);
    return lines.join("\n");
  }

  MM.toml = { str: str, num: num, bool: bool, strArray: strArray, setKey: setKey };
})(typeof window !== "undefined" ? window : globalThis);
