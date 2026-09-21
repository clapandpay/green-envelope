# Running Green Envelope yourself

Cloudflare Workers stays the documented deployment ([`../apps/edge/README.md`](../apps/edge/README.md)).
The image is the alternative, and it is the same handler either way: `apps/edge` is written to
web-standard `Request`/`Response` precisely so the runtime is a choice.

```sh
docker run -p 8787:8787 \
  -e NETWORK=mainnet \
  -e PUBLIC_ORIGIN=https://clapandpay.com \
  ghcr.io/maximedogawa/clapandpay/green-envelope:latest
```

It runs as a non-root user, holds no secrets and writes no files; `CHAIN_ENDPOINTS` and `PORT`
are the other variables. Images are published for `linux/amd64` and `linux/arm64` by
`.github/workflows/release.yml` on a `green-envelope-v*` release; a prerelease does not move
`:latest`.

To build one locally, from `green-envelope/`:

```sh
docker build -f deployment/Dockerfile --build-arg GIT_COMMIT="$(git rev-parse HEAD)" -t green-envelope .
```
