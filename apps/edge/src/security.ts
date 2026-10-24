// SPDX-License-Identifier: AGPL-3.0-or-later

/** Header names and values set on every HTML response. */
export type SecurityHeaders = ReadonlyArray<readonly [name: string, value: string]>;

/** The content security policy of the app: a static bundle that talks to itself and to the chain endpoints. */
export function contentSecurityPolicy(chainEndpoints: readonly string[]): string {
  const origins = [...new Set(chainEndpoints.map((endpoint) => new URL(endpoint).origin))];
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    ["connect-src 'self'", ...origins].join(' '),
    "manifest-src 'self'",
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Builds the security headers once per deployment. */
export function securityHeaders(chainEndpoints: readonly string[]): SecurityHeaders {
  return [
    ['content-security-policy', contentSecurityPolicy(chainEndpoints)],
    // Keeps the envelope path, which holds the public key, out of every referrer.
    ['referrer-policy', 'no-referrer'],
    ['x-content-type-options', 'nosniff'],
    ['permissions-policy', 'publickey-credentials-get=(self), publickey-credentials-create=(self)'],
    // HTTPS only from the first visit on, so nobody on the network can serve the wallet's script.
    // Browsers ignore it over plain http, so localhost keeps working.
    ['strict-transport-security', 'max-age=31536000'],
  ];
}

/** True when the response is an HTML document. */
export function isHtml(response: Response): boolean {
  return response.headers.get('content-type')?.toLowerCase().startsWith('text/html') ?? false;
}

/** A copy of the response with the headers added; needed because asset responses can be immutable. */
export function withHeaders(response: Response, headers: SecurityHeaders): Response {
  const merged = new Headers(response.headers);
  for (const [name, value] of headers) merged.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}
