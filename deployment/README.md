# Running Green Envelope yourself

Cloudflare Workers stays the documented deployment ([`../apps/edge/README.md`](../apps/edge/README.md)).
The image is the alternative, and it is the same handler either way: `apps/edge` is written to
web-standard `Request`/`Response` precisely so the runtime is a choice.

```sh
docker run -p 8787:8787 \
  -e NETWORK=mainnet \
  -e PUBLIC_ORIGIN=https://envelope.clapandpay.com \
  ghcr.io/maximedogawa/clapandpay/green-envelope:latest
```

It runs as a non-root user and writes no files; `CHAIN_ENDPOINTS`, `PORT` and the optional
`TYPESAFE_API_KEY` are the other variables. Images are published for `linux/amd64` and `linux/arm64` by
`.github/workflows/images.yml` on a `green-envelope-v*` release; a prerelease does not move
`:latest`.

To build one locally, from `green-envelope/`:

```sh
docker build -f deployment/Dockerfile --build-arg GIT_COMMIT="$(git rev-parse HEAD)" -t green-envelope .
```

## The website image

clapandpay.com, the hub, is a second image from the same pipeline: `green-envelope/apps/site`
(two static files behind nginx, non-root, port 8080, `/healthz`), published as
`ghcr.io/maximedogawa/clapandpay/clapandpay-web` for `linux/amd64` and `linux/arm64` on a
`clapandpay-web-v*` release.

```sh
docker run -p 8080:8080 ghcr.io/maximedogawa/clapandpay/clapandpay-web:latest
```

The two images are two hostnames, not two paths. See the launch below.

To build it locally: `docker build -t clapandpay-web apps/site`.

## Launching it on clapandpay.com

Three hostnames, one machine, two containers, and Caddy in front (`compose.yaml`, `Caddyfile`):

| Hostname | Container | Serves |
| --- | --- | --- |
| `clapandpay.com` (`www` redirects to it) | `clapandpay-web` | the hub, `/klimper` (redirect to the download), `/.well-known/apple-app-site-association` and `assetlinks.json` |
| `envelope.clapandpay.com` | `green-envelope` | `/hello`, `/g/*`, `/new`, `/connect`, `/api/*`, `/og/*` |

Klimper has no hostname of its own: it is an installed app, and its download page is
`clapandpay.com/klimper`.

Why not paths on one host: the wallet gets its own browser origin, so a flaw on the marketing site
cannot read what the wallet keeps in the browser (a device wallet's seed, sent-envelope state).
That is all the separation buys, and it is not the whole story: a passkey belongs to a
*domain*, not to a page. The web wallet creates it for **`clapandpay.com`** on every subdomain of
it (`src/lib/relying-party.ts`), which is what Klimper's own relying party is, so the same key
comes back in the app. The consequence is that any page on `clapandpay.com` or a subdomain of it
(the hub included) could ask for that passkey, and a person who approved the Face ID prompt would
hand over the wallet key. So the hub must stay static and without third-party code (it is: no
requests, no cookies, strict CSP), no untrusted site may ever be served from a subdomain, and the
DNS and hosting accounts are part of the wallet's security. The choice cannot be undone after
people have made wallets; localhost and self-hosted installs keep using their own host.

Steps:

1. **DNS.** A (and AAAA) records for `clapandpay.com`, `www` and `envelope` to the machine. Open
   ports 80 and 443.
2. **Machine.** Docker with Compose. The images are multi-arch, so ARM or x86 both work.
   Copy `compose.yaml`, `Caddyfile` and `launch.env.example` (as `.env`) to it.
3. **Images.** Publish a release tagged `green-envelope-v<version>` (it must match
   `package.json`) and one tagged `clapandpay-web-v<version>`. `images.yml` builds both.
4. **Android.** The Apple file already carries the team id. Put the release signing fingerprint
   into `apps/site/.well-known/assetlinks.json` before releasing the site; the workflow warns
   while a placeholder is left. Without the right ids the passkey handoff and universal links do
   not work.
5. **Faucet.** Set the repository variable `FAUCET_URL` (Settings, Variables), for example
   `https://envelope.clapandpay.com/api/faucet`, and release the app image again: it is a build
   setting. Until then `/hello` shows the demo envelope. See `docs/faucet.md`.
6. **Klimper link.** When the TestFlight public link exists, put it in `apps/site/nginx.conf`
   (`location = /klimper`) and release the site again.
7. `docker compose pull && docker compose up -d`, then open `https://envelope.clapandpay.com/hello`.

Known gaps: the Xchonnect universal links (`clapandpay.com/pair`, `/req`) have no page on the
site yet, so someone without the app who opens one gets a 404; and the Klimper handoff stays off
in release builds (`VITE_DISABLE_CLAPANDPAY_CONNECT` in `klimper/.env.production`) until
`envelope.clapandpay.com/connect` is live.
