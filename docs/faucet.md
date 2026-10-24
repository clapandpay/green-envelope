# The faucet and the front door (`/hello`)

`/hello` is the page the marketing site links to: one envelope, one button, "Get your envelope".
The button asks a **faucet** (an endpoint the owner runs) for a fresh, funded envelope link and
opens it in the ordinary claim route, so the usual ceremony and "Send it on" follow. This file is
the contract between the page and the faucet. The page-side client is
`apps/web/src/lib/faucet.ts`.

## Configuration (build time)

| Variable | Meaning |
| --- | --- |
| `VITE_FAUCET_URL` | The endpoint. `https:` only (`http:` on localhost for development), no credentials in the URL. Unset or invalid: there is no envelope to give, so `/hello` goes straight to the app's start (`/`), replacing itself in the history. |
| `VITE_FAUCET_ORIGINS` | Optional, comma-separated extra origins a returned link may name (for example `https://clapandpay.com` when the app lives on another host). The page's own origin is always allowed. |

If the faucet is on another origin than the app, the edge service's content security policy
(`connect-src`) must allow it, and the faucet must answer CORS for `GET` with the app's origin.
Simplest: serve it on the app's own origin (`/api/faucet`), which needs neither.

## Request

`GET {VITE_FAUCET_URL}`, `Accept: application/json`, no cookies, no `Referer`, redirects are an
error, 8 s timeout. After a **network failure** (offline, refused, timeout) the page retries once;
it never retries after an HTTP answer. The page sends nothing that identifies the visitor, so
**one share per visitor is the faucet's job** (IP, rate limit, proof of work, whatever the owner
chooses); the page's honeypot and the remembered envelope are courtesy, not security.

## Responses

| Answer | Body | The page shows |
| --- | --- | --- |
| `200` | `{ "link": "https://<origin>/g/<id>?n=1&from=...#<secret>" }` | goes to the claim route for that link |
| `200` | `{ "status": "empty" }` | "All envelopes are in flight", check again, make your own |
| `429`, optional `Retry-After` (seconds or HTTP date) | anything, ignored | friendly countdown, then the button comes back. Default 30 s when absent or unreadable, clamped to 1 s to 1 h |
| any other status, timeout twice, bad JSON | | "That did not work" / "No connection", retry |

`{ "status": "empty", "link": ... }`, any other `status`, extra shapes (arrays, nested objects),
bodies over 4 kB and links over 2 kB are all treated as an error.

### What a link must be

Checked by `acceptFaucetLink`, and the result is **rebuilt** from what the codec in `@ge/envelope`
understood, so unknown parameters are dropped:

- `https:` (or `http:` on localhost), origin is the page's own or in `VITE_FAUCET_ORIGINS`;
  no userinfo, no spaces, control characters or backslashes.
- path exactly `/g/<base64url public key, 48 bytes>`, fragment `#<base64url secret, 16 bytes>`.
- `n`, `from`, `m` optional, as in [contracts.md](contracts.md).

The page navigates **inside the app** to the rebuilt path. Whatever the faucet says, it can never
send the visitor to another site, a `javascript:` URL or a download.

## What the device remembers

Key `ge.faucet` in `localStorage` (always wrapped in try/catch): the in-app path of the envelope
this device was given. The path contains the envelope's secret, the same kind of secret the
wallet in this browser already keeps, and it is what makes the **back button, a reload and a
closed tab safe**: the visitor sees "You already have one" with "Open my envelope" (the claim
page then shows the truth: sealed, or "you opened this one already") and "Go to my money". It is
re-validated like a fresh answer on every read. Cleared storage means a new request, and the
faucet's own limit decides.

Suggested faucet shape: one share per envelope (`n=1`), `from=Clap and Pay`, a short `m`, and a
sweep-back so unopened ones return to the faucet after the usual 7 days.

## States on `/hello`

Ready, fetching (double-click safe), already got one, empty,
rate limited (countdown), offline, broken. Each has English and German copy in
`apps/web/src/i18n/` (`hello`) and each ends in an action. Without a faucet there is no state: `/hello` goes to `/`.

## Link previews

`apps/edge` serves `/hello` with its own Open Graph / Twitter tags (title "Get your green
envelope", the standard 1200x630 envelope image, canonical `/hello`), English or German by
`Accept-Language`. `index.html` and the edge `APP_ROUTES` list both know the route. The
marketing site should link to `https://<app>/hello`; if the app is served by something other
than the edge service, that server needs the same single-page fallback and tags for `/hello`.
