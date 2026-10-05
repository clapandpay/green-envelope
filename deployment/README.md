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

Both images belong on one domain. Put a reverse proxy in front: `/hello`, `/new`, `/connect`,
`/g/*`, `/og/*` and `/api/*` go to the `green-envelope` image (port 8787), everything else to
`clapandpay-web`. Link previews and the faucet link need the
`green-envelope` side to see the original `Host`.

To build it locally: `docker build -t clapandpay-web apps/site`.
