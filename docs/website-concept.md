# clapandpay.com: website concept

Status: proposal. Prototype: `docs/design/website-prototype/index.html` (open it from disk; one
file, about 41 kB raw and 13 kB gzipped, no requests). Brand: [clapandpay-brand.md](clapandpay-brand.md).
The clap counter is local to the tab; the faucet state is optional.

## The one big idea

**The site is the hub, and the hub is a clap.** Clap and Pay is also the family around the
Klimper wallet, so the site is not the Green Envelope's brochure: it is an art piece in the
brand's own look (Klimper's palette and coin, with motion, in Beidwerk's Kinetic Humanism). Two big
hands approach, meet, and coins jingle out and settle. The visitor can clap. Below that, a tap
and a loop explain the product in gestures, then three doors lead into the family. Green Envelope
is a guest in its own forest green; Klimper is the wallet; Play is coming soon.

## Scroll narrative

| # | Section | What happens |
| --- | --- | --- |
| 1 | **Hero: "Clap. Pay."** | Two hands fly in and clap: squash, flash, echo ring, a shower of up to 26 coins that settle as a pile. Click, tap or space claps again, the headline letters hop, a local counter counts. Idle breathing. Primary button to `/hello` |
| 2 | **Tap** | A phone cut-out; a finger approaches, a ripple, a coin drops in, the number settles. Tap the phone to repeat |
| 3 | **Loop: Clap, Tap, Pay** | Three calm looping cards |
| 4 | **The family** | Doors: Green Envelope (live mini envelope opens on hover, focus or when in view, links to `/hello`), Klimper (`/klimper`, placeholder for TestFlight, "Use Clap and Pay money"), Play (preview chips: who pays tonight) |
| 5 | **Plain words** | Money stays yours, a link is cash, no account or password, technology out of sight, no cookies, early software |
| 6 | **Footer** | The hands drifted apart on scroll and meet again for a last clap; DE/EN, imprint, privacy, GitHub |

Scroll-driven part: hands drift apart as you leave the hero and re-meet at the footer, CSS
`animation-timeline` behind `@supports`; without it nothing moves and the page is simply laid out.

## Art direction

See [clapandpay-brand.md](clapandpay-brand.md). In short: Klimper tokens only, sun gradient only on
the primary action and coins, ink on sun, system rounded type, no stock imagery, no sound,
animate transform and opacity only, particles capped, pause off-screen and in hidden tabs.
Dark mode follows the system with a manual toggle (stored only after a click). Reduced motion:
no animation, the clap shows a pressed pose and coins already at rest.

## Handoff to the app

| Question | Decision |
| --- | --- |
| Same origin? | Yes: clapandpay.com serves both site and app. The button is a plain `<a href="/hello">` so it works with no JS, in link previews, and in WhatsApp/Telegram in-app browsers |
| What is `/hello`? | A new route in the green-envelope app (not yet built; today it knows `/`, `/new`, `/connect`, `/g/:id`). It runs the faucet: creates the passkey wallet if needed, requests one envelope from the faucet service, then replaces itself with `/g/<id>#<secret>` so the normal claim screen takes over. The secret never leaves the fragment |
| Which assets does `/hello` share with the site? | Nothing at build time. The site has its own CSS (it is not allowed to pull the app's bundle: 100 kB route budget) |
| Deep links | `?net=` and other sticky params pass through; the site adds none. Shared envelope links `/g/...` bypass the site entirely |

## Where the code lives

| Option | For | Against |
| --- | --- | --- |
| A. Third product folder `site/` | Clean separation | Breaks the "two products" table in AGENTS.md, needs its own lockfile and CI paths, for what is one HTML file |
| B. `green-envelope/apps/site` | Same toolchain and CI job, same tokens, `/hello` and site deploy together so the faucet link can never break | Slightly blurs "web = app" |
| C. Inside `apps/web` as a route | One deploy | The claim route must stay under 100 kB gzipped and any marketing weight threatens it; also the hero would load the wallet bundle |

**Recommendation: B, `green-envelope/apps/site`.** The site is the first release's front door,
not a third product. It is a static folder (hand-written `index.html`, `de/index.html`, CSS inline,
a build step of zero or a 20-line copy script that stamps the TestFlight URL and the baked
counter), and it is checked by the same `pnpm check` (HTML size budget test in the existing test
runner). The prototype file is the starting point. Klimper's own page stays inside this same
site as Section 3; no `klimper/` change is needed.

## Performance, privacy, SEO

| Topic | Decision |
| --- | --- |
| Budget | HTML under 80 kB raw, about 15 kB gzipped; zero images, zero web fonts, zero third-party requests; the only JS is inline. LCP is the headline text and the SVG, both in the first response: well below 1.5 s on 4G. CI gate: a test that fails above 80 kB or if the file contains `http` other than the GitHub and TestFlight links |
| Cookies, tracking | None. No consent banner needed. Language choice in `localStorage` only after the person clicks DE/EN |
| Analytics | **None third-party.** The counter is the product's own aggregate (envelopes opened, mean hops) from the envelope service, never per-visitor. If funnel numbers are wanted later, count `GET /hello` server-side in the edge logs without IPs; still no cookie |
| Languages | Separate static documents: `/` (English) and `/de/` with `hreflang` both ways. Default by `Accept-Language` is a hint link, not a redirect, so crawlers and link previews stay stable. The prototype toggles in place to show both |
| SEO and Open Graph | One `h1`, real text, `description`, canonical, `hreflang`, JSON-LD `Organization` only. OG card is a static 1200x630 PNG in the ink/ivory language (the two hands and the coin, no text smaller than 60 px). `twitter:card=summary_large_image` |
| Accessibility | Real buttons for clap, phone and language/theme; the hand SVGs are `aria-hidden`; space claps; teal 3 px focus ring; 44 to 48 px targets; AA contrast (ink on sun); keyboard, zoom to 200 %, and without JS the hands, the coin pile and all links are static and work |

## Robustness

| Risk | Answer |
| --- | --- |
| Faucet drained | The site never promises an amount. `/hello` shows an honest "today's envelopes are gone, back tomorrow" screen with the Klimper and "get an envelope from a friend" paths. The site reads `/stats.json`'s `faucetOpen` flag and, when false, swaps the CTA to **Come back tomorrow**; the clap and tap demos keep working |
| Faucet abuse (one person, many envelopes) | Rate limit per passkey and per coarse network at the faucet service; one envelope per new wallet; the amount is small and capped per day globally. Not a site concern, but the site must not expose a one-click automatable endpoint: only `/hello`, which needs a passkey ceremony |
| DDoS | The site is static files behind a CDN with long cache; nothing dynamic depends on origin. `/stats.json` is cached at the edge, so traffic never reaches the service |
| Offline / flaky | The page is self-contained, so it renders from cache; the ceremony works offline, the CTA then lands on the app's own offline message. Service worker: not needed |
| Fake sites | The CTA href is same-origin and relative; the footer shows the domain; no wallet or key is ever entered on the site itself |

## Hosting and CI

| Choice | Recommendation |
| --- | --- |
| Host | Same place as the app (static origin + CDN), with `/hello`, `/g/*`, `/connect`, `/new` falling through to the app's `index.html` and `/`, `/de/` to the site. The routing table is one config file |
| Deploy | Piggyback on the existing `ci.yml`/`release.yml` (the build step of `green-envelope/`); the site folder is just more files in the same artifact. **No new workflow, no schedule.** Any periodic work (refreshing the baked counter) is a script run by hand or done by the edge at request time |
| CI cost | Nothing added: `apps/site` falls under the existing `green-envelope/**` path filter; the size test runs inside `pnpm check` on pull requests only |

## Open points for the owner

1. The TestFlight public link (placeholder `/klimper` in the prototype) and who sets it.
2. Whether the faucet funds in euro terms or XCH; the site avoids stating an amount until decided.
3. Imprint and privacy texts (German law requires an Impressum before launch).
4. Build `/hello` in the app (separate task; this concept only fixes the contract above).
