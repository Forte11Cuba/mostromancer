<p align="center">
  <img src="assets/logo.webp" width="128" alt="Mostromancer">
</p>

# Mostromancer

A web wizard to configure and deploy your own [Mostro](https://github.com/MostroP2P/mostro) node, inspired by the [BTCPay Server Configurator](https://github.com/btcpayserver/btcpayserver-configurator).

Answer six questions and Mostromancer generates an `install-mostro.sh` (or a cloud-init) that, on a Linux server:

1. installs Docker if needed;
2. connects Mostro to your LND, **or installs the whole node**: Bitcoin Core (optional), LND and Lightning Terminal (optional);
3. generates Mostro's Nostr key **on the server** (or uses the one you provide);
4. writes `settings.toml` and `compose.yml`;
5. starts everything and shows your Mostro's pubkey.

The interface is available in **English and Spanish** (ES / EN switch, top right). The generated files follow the chosen language: installer messages and comments in the installer, `compose.yml`, `lnd.conf` and `lit.conf`.

## Usage

There is nothing to build or install: it is plain HTML, CSS and JS with no dependencies.

```bash
git clone https://github.com/Forte11Cuba/mostromancer.git && cd mostromancer
xdg-open index.html        # or just double-click it
```

It can also be served as a static site (`python3 -m http.server`, GitHub Pages, etc.).

**Nothing leaves your browser.** The page makes no network requests; its Content-Security-Policy enforces it (`connect-src 'none'`). The only exception is the profile image URL you type, which is loaded for the preview. The configuration is remembered in `localStorage`, but keys never are.

## The steps

| Step | What you decide |
|---|---|
| Destination | Install folder and Mostro image. |
| Lightning | Network (mainnet, testnet, signet or regtest), and whether to connect to your LND or install the node. |
| Nostr | Relays and how Mostro's key is created. |
| Profile | Name, description, image and website (NIP-01, kind 0). |
| Market | Fee (in % or ppm), amounts and accepted currencies. |
| Advanced | Optional: payments and escrow, admin RPC, health, Serbero. |
| Abracadabra | Summary ("Does this look right?"), then the files and the steps to install them. |

Profile, Market and the summary show how users will see your node on the app's "Choose node" screen.

## The Lightning node

In the Lightning step you choose between:

- **I already have an LND node**: on this server (Mostro uses `network_mode: host`) or on another machine. The installer copies `tls.cert` and `admin.macaroon` into `config/lnd/` with 600 permissions; if it can't find them, it sets everything up without starting.
- **Install my node**: three pieces, each with its own version ("Latest", a recent one, or any other Docker Hub tag):

  | Piece | | Image |
  |---|---|---|
  | 1. Bitcoin Core | Optional (off by default). Pruned to 10 GB, 50 GB, a custom size, or full. Without it, LND uses **neutrino**. | `btcpayserver/bitcoin` |
  | 2. LND | Always. | `lightninglabs/lnd` |
  | 3. Lightning Terminal | Optional, in `remote` mode on top of the same LND: web interface, Loop and Pool. | `lightninglabs/lightning-terminal` |

- **Cashu only**: will be available once Mostro supports it.

When it installs the node, the installer:

- lets the Bitcoin Core image generate the RPC password (`bitcoin/RPCUsers/lnd`) and passes it to `lnd.conf`;
- creates the LND wallet through its REST API (bound to `127.0.0.1:8080` only) and shows the **24-word seed**, which it also saves to `LND-SEED.txt` so you can write it down and delete it;
- stores the wallet password in `lnd/wallet_password`, so LND unlocks itself on restart;
- pins `invoices.holdexpirydelta=18` (LND 0.21's default) and requires Mostro's `escrow_deadline_margin_blocks` to be at least 24;
- exposes Lightning Terminal only on `127.0.0.1:8443` (reach it through an SSH tunnel), with a password generated on the server, and disables its autopilot and Taproot Assets, which Mostro doesn't need;
- on **regtest**, requires Bitcoin Core (there are no public nodes for neutrino) and explains how to mine blocks.

It can be run again: it keeps the wallet, keys and passwords, and restarts only the services whose configuration changed.

## Keys

| Mode | Where the nsec is born | Inside the script? |
|---|---|---|
| **Generate it on the server** (recommended) | The server's `/dev/urandom` | No |
| Generate it here | The browser's `crypto.getRandomValues()`, mixed with your mouse movement via SHA-256 | Yes |
| I already have one | You paste it (nsec or hex) | Yes |

Mouse movement **does not replace** the browser's generator: it is only mixed on top, so it never weakens the key.

The key is stored in `config/.env` as `MOSTRO_NSEC_PRIVKEY`, which mostrod reads at startup. It never goes into `settings.toml`. Running the script again **does not replace it**.

## Validation

Before generating anything, the wizard checks the rules that make mostrod refuse to start (or end up misconfigured silently):

- `escrow_deadline_margin_blocks` ≥ 18 and lower than `hold_invoice_cltv_delta`; at least 24 with a recent LND (see below);
- `max_final_cltv_expiry_delta` > 0;
- `payment_cltv_limit` = 0 or ≥ `max_final_cltv_expiry_delta` + 576;
- `dev_fee_percentage` between 10 % and 100 %;
- `wss://` relays, valid Serbero and watchdog pubkeys, consistent amounts, well-formed versions, etc.

**Heads-up about LND 0.21:** its default `invoices.holdexpirydelta` is 18 (`DefaultIncomingBroadcastDelta` 16 + 2), not 12 as mostrod assumes. mostrod accepts a margin from 18, but with a recent LND the safe minimum is 24. Mostro's default (24) is enough.

## Layout

```
index.html                 the wizard
css/style.css
assets/                    logo (logo-source.png is the original), favicon and the Bitcoin Core, LND and Lightning Terminal logos
fonts/                     Outfit, Manrope and NotoFlags, copied from MostroP2P/app (OFL)
js/template.js             Mostro's settings.tpl.toml (generated)
js/versions.js             Bitcoin Core, LND and Lightning Terminal versions (generated)
js/currencies.js           Yadio's currencies, with flags from MostroP2P/app (generated)
js/i18n.js                 language handling (Spanish text is the key)
js/i18n-en.js              English dictionary
js/crypto.js               SHA-256, bech32 (NIP-19), secp256k1 pubkey
js/icons.js                stroke SVG icons
js/toml.js                 edits the template while keeping its comments
js/config.js               defaults and validation
js/generate.js             settings.toml, compose.yml, lnd.conf, lit.conf, install.sh, cloud-init
js/app.js                  the interface
scripts/sync-template.sh   refreshes js/template.js from ../mostro
scripts/sync-versions.sh   refreshes js/versions.js from Docker Hub
scripts/sync-currencies.sh refreshes js/currencies.js from api.yadio.io/currencies
scripts/make-icons.py      builds assets/logo.webp and favicon.png from assets/logo-source.png
tests/                     node --test tests/
```

`settings.toml` is generated by **patching Mostro's real `settings.tpl.toml`** rather than rewriting it, so it keeps its comments and any new option.

To refresh the generated data:

```bash
scripts/sync-template.sh ../mostro   # when Mostro changes its template
scripts/sync-versions.sh             # new image versions
scripts/sync-currencies.sh           # changes in Yadio's currencies
node --test tests/
```

### Translations

The Spanish text in the code is the translation key: `tr("Texto")` in the interface and `L("Texto")` in the generated files. `js/i18n-en.js` maps each Spanish text (whitespace-normalized) to English; anything missing falls back to Spanish. Templates take variables: `tr("Quitar {code}", { code: "USD" })`.

## Design

It uses the design system of the [Mostro app](https://github.com/MostroP2P/app): the tokens from `lib/core/app_theme.dart` and `lib/core/order_book_palette.dart` (dark and light mode) and its fonts.

## Tests

```bash
node --test tests/
```

They include BIP-340 and NIP-19 test vectors, validation, `bash -n` of the installer in the three key modes and, if it finds `../mostro/target/debug/mostrod` (or `MOSTROD=/path`), an end-to-end test: it starts mostrod with the generated configuration and checks that it accepts it and announces the expected pubkey.

Installing the node was tested by hand in isolated Docker (docker-in-docker) with the real images:

- **signet with neutrino + Lightning Terminal:** LND synced, Mostro connected and Lightning Terminal came up with all its services;
- **regtest with Bitcoin Core + LND + Lightning Terminal:** the install finished and everything started;
- **second run:** it kept the wallet and keys, and restarted only what changed.

## Roadmap

- [x] Static generator: existing LND, keys, profile, market.
- [x] Install the node: Bitcoin Core (optional) + LND + Lightning Terminal (optional).
- [x] English and Spanish.
- [ ] Logo as SVG.
- [ ] Light/dark theme switch.
- [ ] Cashu only, once Mostro supports it.
- [ ] Deploy over SSH and reverse connection (Rust backend), generating every secret on the server.

## License

GPL-3.0-or-later, like [Mostro](https://github.com/MostroP2P/mostro). See [LICENSE](LICENSE).
