# Running Green Envelope yourself

Cloudflare Workers stays the documented deployment ([`../apps/edge/README.md`](../apps/edge/README.md)).
The image is the alternative, and it is the same handler either way: `apps/edge` is written to
web-standard `Request`/`Response` precisely so the runtime is a choice.

```sh
docker run -p 8787:8787 \
  -e NETWORK=mainnet \
  -e PUBLIC_ORIGIN=https://envelope.clapandpay.com \
  ghcr.io/clapandpay/green-envelope/green-envelope:latest
```

The chain node is chosen at runtime, never built into the image: `PUBLIC_CHAIN_ENDPOINTS` and
`PUBLIC_CHAIN_API_KEY` for the node the browser calls (mainnet: `https://api.nodexch.com` with
its public, origin-restricted key), `CHAIN_ENDPOINTS` and `CHAIN_API_KEY` for the server's own
reads. Without them, the public Coinset node of the network is used.

The testnet site (`testnet.envelope.clapandpay.com`) is the same image built for testnet11:
the tag with `-testnet` (`:latest-testnet`), run with `NETWORK=testnet11` and
`PUBLIC_ORIGIN=https://testnet.envelope.clapandpay.com`. Both sites use the same passkey (its
domain is `clapandpay.com`); each network has its own vault, and each site its own browser
storage. `VITE_MAINNET_URL` and `VITE_TESTNET_URL` name the two sites if yours differ.

It runs as a non-root user and writes no files; `CHAIN_ENDPOINTS`, `PORT` (default: 80 and 8787) and the optional
`TYPESAFE_API_KEY` are the other variables. Images are published for `linux/amd64` and `linux/arm64` by
`.github/workflows/green-envelope.yml` on a `green-envelope-v*` release; a prerelease does not move
`:latest`.

### With ONCE

The image is ONCE-compatible (once.com): it serves HTTP on port 80, answers the health check
at `/up`, and keeps no data, so `/storage` stays empty. Install it with the image name above and
nothing else: it starts on mainnet with the public Coinset node, and takes its address from the
`BASE_URL` ONCE passes. Every variable can be set later in ONCE; [`.env.example`](.env.example)
lists them all with what to put in each; without `PORT` the server
also listens on 8787, the port this image used before.

To build one locally, from the repository root:

```sh
docker build -f deployment/Dockerfile --build-arg GIT_COMMIT="$(git rev-parse HEAD)" -t green-envelope .
```

## Running it on clapandpay.com

The production launch (this image next to the clapandpay.com website image, behind Caddy) lives
with the website, in its `deploy/` folder: it only pulls published images.
