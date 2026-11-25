// Íconos de trazo (24×24, currentColor), en el estilo de los íconos de la app.
(function (root) {
  var MM = root.Mostromancer = root.Mostromancer || {};

  var P = {
    // Pasos
    deploy: '<rect x="3" y="3.5" width="18" height="7" rx="2"/><rect x="3" y="13.5" width="18" height="7" rx="2"/><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6"/>',
    lightning: '<path d="M13 2.5 4.5 13.5h6.5l-1 8 8.5-11h-6.5l1-8z"/>',
    nostr: '<circle cx="8" cy="15" r="4.5"/><path d="m11.2 11.8 8.3-8.3M16.5 6.5l2.5 2.5M14 9l2 2"/>',
    identity: '<circle cx="12" cy="9" r="3.6"/><path d="M5.5 19.5c1.2-3 3.7-4.6 6.5-4.6s5.3 1.6 6.5 4.6"/><circle cx="12" cy="12" r="9.5"/>',
    business: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
    advanced: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    summary: '<path d="m4 20 10-10M14 10l1.8-1.8a1.3 1.3 0 0 0-1.8-1.8L12.2 8.2"/><path d="M17 3v2.5M15.8 4.2h2.5M20.5 8.5v2M19.5 9.5h2M10 3.5v1.5M9.2 4.2h1.6"/>',
    // Tarjetas y bienvenida
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="m7 9.5 3 2.5-3 2.5M12.5 15h4"/>',
    plug: '<path d="M9 3v4M15 3v4M7 7h10v3.5a5 5 0 0 1-10 0z"/><path d="M12 15.5V21"/>',
    reverse: '<path d="M7 4 3.5 7.5 7 11M3.5 7.5H15a5.5 5.5 0 0 1 0 11h-4"/>',
    box: '<path d="m12 3 8.5 4.5v9L12 21l-8.5-4.5v-9z"/><path d="m3.5 7.5 8.5 4.5 8.5-4.5M12 12v9"/>',
    gauge: '<path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path d="m12 13.5 4-4.5"/><circle cx="12" cy="14" r="1.2"/>',
    coins: '<ellipse cx="9" cy="7" rx="5.5" ry="2.5"/><path d="M3.5 7v4c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V7"/><path d="M9.5 16.3c.9.1 1.8.2 2.5.2 3 0 5.5-1.1 5.5-2.5"/><ellipse cx="15" cy="13" rx="5.5" ry="2.5"/><path d="M9.5 13v4c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5v-4"/>',
    pointer: '<path d="m5 3 14 7-6 1.8L10.2 18z"/><path d="M15 15.5 19.5 20"/>',
    key: '<circle cx="8" cy="15" r="4.5"/><path d="m11.2 11.8 8.3-8.3M16.5 6.5l2.5 2.5"/>',
    shield: '<path d="M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.2 2.8 2.8L16.2 9.5"/>'
  };

  MM.icon = function (name, size) {
    var s = size || 18;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || "") + "</svg>";
  };
})(typeof window !== "undefined" ? window : globalThis);
