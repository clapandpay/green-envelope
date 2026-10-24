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

The testnet site (`testnet.envelope.clapandpay.com`) is the same image built for testnet11:
the tag with `-testnet` (`:latest-testnet`), run with `NETWORK=testnet11` and
`PUBLIC_ORIGIN=https://testnet.envelope.clapandpay.com`. Both sites use the same passkey (its
domain is `clapandpay.com`); each network has its own vault, and each site its own browser
storage. `VITE_MAINNET_URL` and `VITE_TESTNET_URL` name the two sites if yours differ.

It runs as a non-root user and writes no files; `CHAIN_ENDPOINTS`, `PORT` and the optional
`TYPESAFE_API_KEY` are the other variables. Images are published for `linux/amd64` and `linux/arm64` by
`.github/workflows/green-envelope.yml` on a `green-envelope-v*` release; a prerelease does not move
`:latest`.

To build one locally, from the repository root:

```sh
docker build -f deployment/Dockerfile --build-arg GIT_COMMIT="$(git rev-parse HEAD)" -t green-envelope .
```

## Running it on clapandpay.com

The production launch (this image next to the clapandpay.com website image, behind Caddy) lives
with the website, in its `deploy/` folder: it only pulls published images.
