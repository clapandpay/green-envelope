# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright 2026 the Clap and Pay authors
#
# clapandpay.com, the hub, as one deployable image: static files behind nginx, as a non-root user.
# Built context is green-envelope/apps/site. Published by .github/workflows/images.yml.
#
# The site is plain HTML with its CSS, SVG and script inline: there is nothing to build, so the
# image is the files and a server config, and the two domain files Apple and Android read. It makes no outgoing requests and sets no cookies.
FROM nginxinc/nginx-unprivileged:1.29-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/security-headers.conf
COPY index.html stickers.html /usr/share/nginx/html/
COPY .well-known /usr/share/nginx/html/.well-known

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
