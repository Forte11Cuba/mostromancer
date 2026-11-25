// Primitivas mínimas para generar y mostrar claves Nostr en el navegador:
// SHA-256, bech32 (NIP-19) y la clave pública x-only de secp256k1.
// Sin dependencias, para que la página funcione abierta desde file://.
(function (root) {
  var MM = root.Mostromancer = root.Mostromancer || {};

  // ---------- bytes / hex ----------

  function bytesToHex(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return out;
  }

  function hexToBytes(hex) {
    if (!/^([0-9a-fA-F]{2})*$/.test(hex)) throw new Error("hex inválido");
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function randomBytes(n) {
    var c = root.crypto;
    if (!c || !c.getRandomValues) throw new Error("Este navegador no ofrece crypto.getRandomValues");
    var out = new Uint8Array(n);
    c.getRandomValues(out);
    return out;
  }

  // ---------- SHA-256 ----------

  var K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  function sha256(msg) {
    var len = msg.length;
    var padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
    padded.set(msg);
    padded[len] = 0x80;
    var bits = len * 8;
    var dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
    dv.setUint32(padded.length - 4, bits >>> 0);

    var h = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ]);
    var w = new Uint32Array(64);
    for (var off = 0; off < padded.length; off += 64) {
      for (var i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (i = 16; i < 64; i++) {
        var a15 = w[i - 15], a2 = w[i - 2];
        var s0 = ((a15 >>> 7) | (a15 << 25)) ^ ((a15 >>> 18) | (a15 << 14)) ^ (a15 >>> 3);
        var s1 = ((a2 >>> 17) | (a2 << 15)) ^ ((a2 >>> 19) | (a2 << 13)) ^ (a2 >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var A = h[0], B = h[1], C = h[2], D = h[3], E = h[4], F = h[5], G = h[6], H = h[7];
      for (i = 0; i < 64; i++) {
        var S1 = ((E >>> 6) | (E << 26)) ^ ((E >>> 11) | (E << 21)) ^ ((E >>> 25) | (E << 7));
        var ch = (E & F) ^ (~E & G);
        var t1 = (H + S1 + ch + K[i] + w[i]) >>> 0;
        var S0 = ((A >>> 2) | (A << 30)) ^ ((A >>> 13) | (A << 19)) ^ ((A >>> 22) | (A << 10));
        var maj = (A & B) ^ (A & C) ^ (B & C);
        var t2 = (S0 + maj) >>> 0;
        H = G; G = F; F = E; E = (D + t1) >>> 0;
        D = C; C = B; B = A; A = (t1 + t2) >>> 0;
      }
      h[0] += A; h[1] += B; h[2] += C; h[3] += D; h[4] += E; h[5] += F; h[6] += G; h[7] += H;
    }
    var out = new Uint8Array(32);
    var odv = new DataView(out.buffer);
    for (i = 0; i < 8; i++) odv.setUint32(i * 4, h[i]);
    return out;
  }

  // ---------- bech32 (BIP-173, usado por NIP-19) ----------

  var CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  var GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

  function polymod(values) {
    var chk = 1;
    for (var i = 0; i < values.length; i++) {
      var top = chk >>> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ values[i];
      for (var j = 0; j < 5; j++) if ((top >>> j) & 1) chk ^= GEN[j];
    }
    return chk >>> 0;
  }

  function hrpExpand(hrp) {
    var out = [];
    for (var i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
    out.push(0);
    for (i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
    return out;
  }

  function convertBits(data, from, to, pad) {
    var acc = 0, bits = 0, out = [], maxv = (1 << to) - 1;
    for (var i = 0; i < data.length; i++) {
      acc = (acc << from) | data[i];
      bits += from;
      while (bits >= to) { bits -= to; out.push((acc >> bits) & maxv); }
    }
    if (pad) {
      if (bits > 0) out.push((acc << (to - bits)) & maxv);
    } else if (bits >= from || ((acc << (to - bits)) & maxv)) {
      throw new Error("relleno bech32 inválido");
    }
    return out;
  }

  function bech32Encode(hrp, bytes) {
    var data = convertBits(bytes, 8, 5, true);
    var values = hrpExpand(hrp).concat(data, [0, 0, 0, 0, 0, 0]);
    var mod = polymod(values) ^ 1;
    var out = hrp + "1";
    for (var i = 0; i < data.length; i++) out += CHARSET[data[i]];
    for (i = 0; i < 6; i++) out += CHARSET[(mod >> (5 * (5 - i))) & 31];
    return out;
  }

  function bech32Decode(str) {
    if (str !== str.toLowerCase() && str !== str.toUpperCase()) throw new Error("mayúsculas mezcladas");
    str = str.toLowerCase();
    var pos = str.lastIndexOf("1");
    if (pos < 1 || pos + 7 > str.length) throw new Error("formato bech32 inválido");
    var hrp = str.slice(0, pos);
    var data = [];
    for (var i = pos + 1; i < str.length; i++) {
      var v = CHARSET.indexOf(str[i]);
      if (v < 0) throw new Error("carácter bech32 inválido");
      data.push(v);
    }
    if (polymod(hrpExpand(hrp).concat(data)) !== 1) throw new Error("checksum bech32 inválido");
    return { hrp: hrp, bytes: new Uint8Array(convertBits(data.slice(0, -6), 5, 8, false)) };
  }

  // ---------- secp256k1 (solo multiplicación escalar por G) ----------
  // No es de tiempo constante. Se usa una vez, en la máquina del propio
  // operador, para mostrar el npub de una clave recién generada.

  var P = BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f");
  var N = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
  var GX = BigInt("0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798");
  var GY = BigInt("0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8");
  var ZERO = BigInt(0), ONE = BigInt(1), TWO = BigInt(2), THREE = BigInt(3);

  function mod(a) { var r = a % P; return r >= ZERO ? r : r + P; }

  function inv(a) {
    // Exponenciación modular: a^(P-2) mod P
    var result = ONE, base = mod(a), e = P - TWO;
    while (e > ZERO) {
      if (e & ONE) result = (result * base) % P;
      base = (base * base) % P;
      e >>= ONE;
    }
    return result;
  }

  // Puntos en coordenadas jacobianas [X, Y, Z]; Z = 0 es el punto al infinito.
  function jDouble(p) {
    if (p[2] === ZERO || p[1] === ZERO) return [ZERO, ONE, ZERO];
    var X = p[0], Y = p[1], Z = p[2];
    var YY = mod(Y * Y);
    var S = mod(BigInt(4) * X * YY);
    var M = mod(THREE * X * X);
    var X3 = mod(M * M - TWO * S);
    var Y3 = mod(M * (S - X3) - BigInt(8) * YY * YY);
    var Z3 = mod(TWO * Y * Z);
    return [X3, Y3, Z3];
  }

  function jAdd(p, q) {
    if (p[2] === ZERO) return q;
    if (q[2] === ZERO) return p;
    var Z1Z1 = mod(p[2] * p[2]), Z2Z2 = mod(q[2] * q[2]);
    var U1 = mod(p[0] * Z2Z2), U2 = mod(q[0] * Z1Z1);
    var S1 = mod(p[1] * q[2] * Z2Z2), S2 = mod(q[1] * p[2] * Z1Z1);
    if (U1 === U2) return S1 === S2 ? jDouble(p) : [ZERO, ONE, ZERO];
    var H = mod(U2 - U1), R = mod(S2 - S1);
    var HH = mod(H * H), HHH = mod(H * HH), V = mod(U1 * HH);
    var X3 = mod(R * R - HHH - TWO * V);
    var Y3 = mod(R * (V - X3) - S1 * HHH);
    var Z3 = mod(H * p[2] * q[2]);
    return [X3, Y3, Z3];
  }

  function bytesToBigInt(bytes) { return BigInt("0x" + (bytesToHex(bytes) || "0")); }

  function isValidSecret(bytes) {
    if (bytes.length !== 32) return false;
    var k = bytesToBigInt(bytes);
    return k > ZERO && k < N;
  }

  // Clave pública x-only (BIP-340), 32 bytes, como la usa Nostr.
  function xOnlyPublicKey(secret) {
    if (!isValidSecret(secret)) throw new Error("clave secreta fuera de rango");
    var k = bytesToBigInt(secret);
    var acc = [ZERO, ONE, ZERO];
    var add = [GX, GY, ONE];
    while (k > ZERO) {
      if (k & ONE) acc = jAdd(acc, add);
      add = jDouble(add);
      k >>= ONE;
    }
    var zInv = inv(acc[2]);
    var x = mod(acc[0] * zInv * zInv);
    return hexToBytes(x.toString(16).padStart(64, "0"));
  }

  // ---------- Nostr ----------

  // Mezcla la entropía extra (p. ej. movimiento del mouse) con 32 bytes del
  // CSPRNG del navegador. El resultado nunca es más débil que el CSPRNG solo.
  function generateSecret(extraEntropy) {
    for (;;) {
      var base = randomBytes(32);
      var secret = base;
      if (extraEntropy && extraEntropy.length) {
        var buf = new Uint8Array(base.length + extraEntropy.length);
        buf.set(base);
        buf.set(extraEntropy, base.length);
        secret = sha256(buf);
      }
      if (isValidSecret(secret)) return secret;
    }
  }

  function keypairFromSecret(secret) {
    var pub = xOnlyPublicKey(secret);
    return {
      secretHex: bytesToHex(secret),
      nsec: bech32Encode("nsec", secret),
      pubkeyHex: bytesToHex(pub),
      npub: bech32Encode("npub", pub)
    };
  }

  // Acepta nsec o hex de 64 caracteres, como Keys::parse de nostr-sdk.
  function parseSecretKey(input) {
    var s = (input || "").trim();
    var bytes;
    if (/^[0-9a-fA-F]{64}$/.test(s)) {
      bytes = hexToBytes(s);
    } else {
      var dec = bech32Decode(s);
      if (dec.hrp !== "nsec") throw new Error("se esperaba una nsec");
      bytes = dec.bytes;
    }
    if (!isValidSecret(bytes)) throw new Error("clave secreta fuera de rango");
    return bytes;
  }

  // Acepta npub o hex de 64 caracteres, como PublicKey::parse de nostr-sdk.
  function isValidPublicKey(input) {
    var s = (input || "").trim();
    if (/^[0-9a-fA-F]{64}$/.test(s)) return true;
    try {
      var dec = bech32Decode(s);
      return dec.hrp === "npub" && dec.bytes.length === 32;
    } catch (e) {
      return false;
    }
  }

  MM.crypto = {
    bytesToHex: bytesToHex,
    hexToBytes: hexToBytes,
    randomBytes: randomBytes,
    sha256: sha256,
    bech32Encode: bech32Encode,
    bech32Decode: bech32Decode,
    xOnlyPublicKey: xOnlyPublicKey,
    generateSecret: generateSecret,
    keypairFromSecret: keypairFromSecret,
    parseSecretKey: parseSecretKey,
    isValidPublicKey: isValidPublicKey
  };
})(typeof window !== "undefined" ? window : globalThis);
