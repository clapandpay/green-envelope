# clapandpay.com: website concept

Status: proposal. Prototype: `apps/site/index.html` (open it from disk; one
file, about 87 kB raw, no requests) and the hand sticker sheet `stickers.html` next to it. Brand:
[clapandpay-brand.md](clapandpay-brand.md). The clap counter is local to the tab; the faucet
state is optional.

## The one big idea

**The site is the hub, and the hub is a clap.** Clap and Pay is the family around the Klimper
wallet, so the site is not the Green Envelope's brochure: it is an editorial page in the brand's
own look (the Klimper icon's blue, red and yellow on warm off-white, Beidwerk's Kinetic Humanism).
Two friendly hands approach, meet in a spark, and coins in the icon's three colours jingle out and
settle. The visitor can clap. The Green Envelope is a guest with its own full-width chapter in its
own green paper world, the most beautiful part of the page; Klimper is the wallet. The hub shows
only what exists today.

## Scroll narrative

| # | Section | What happens |
| --- | --- | --- |
| 1 | **Hero: "Clap. Pay."** | Editorial split: headline and promise left, the hands right. Two hands fly in and clap: squash, spark, two ticks, echo ring, up to 30 coins that settle as a pile. Idle: hands breathe, fingers wag, one beckons. Click, tap or space claps again; a second click within 0.9 s is a high five; five fast claps rain more coins and show a silly line. Letters hop, a local counter counts |
| 2 | **Two ways in** | Two doors: Green Envelope (scrolls to its chapter) and Klimper |
| 3 | **How it works: Clap. Tap. Pay.** | Three numbered steps with hand stickers, then a phone demo: a pointing hand taps, a coin drops in, the number settles |
| 4 | **Green Envelope chapter** | A change of room (dither edge, leaf-green paper, a drifting euro sign). A large tappable envelope with the opening ceremony (seal breaks, flap, letter), then the loop with a self-drawing postal route, then the 1, 2, 4, 8 envelope tree that grows branch by branch, then the button to `/hello` |
| 5 | **Klimper** | The three-coin mark bumps together with its spark and ticks; three facts; TestFlight button (placeholder `/klimper`); how to bring an opened envelope |
| 6 | **Plain words** | Why it is safe in six lines, and who is behind it (open source, AGPL, built on Sage) |
| 7 | **Footer** | A last clap with hands in cream sticker edges, then real columns: products, trust, legal (imprint and privacy placeholders), GitHub |

Scroll-driven parts (euro drift, route drawing) use CSS `animation-timeline` behind `@supports`;
without it nothing moves and the page is simply laid out.

## Art direction

See [clapandpay-brand.md](clapandpay-brand.md). In short: the icon's three colours, flat, with a
white highlight arc as the only gloss; friendly chubby ink-outlined hands in yellow with coloured
cuffs; a faint offset print under them; a 12-column editorial grid with hairline rules and
numbered mono labels; hard offset shadows, no blur; a faint static paper grain; no stock imagery,
no sound; transform and opacity only; particles capped; pause off-screen and in hidden tabs.
Dark mode follows the system with a manual toggle (stored only after a click). Reduced motion: no
animation, the clap shows a pressed pose and coins already at rest.

## Handoff to the app

| Question | Decision |
| --- | --- |
| Same origin? | No, on purpose: the hub is `clapandpay.com`, the app is `envelope.clapandpay.com`. The button is a plain `<a href="https://envelope.clapandpay.com/hello">`, so it works with no JS, in link previews, and in WhatsApp/Telegram in-app browsers |
| What is `/hello`? | A route in the green-envelope app (built: `apps/web/src/screens/hello`). It shows the big envelope, asks the faucet (`docs/faucet.md`) for a link, and hands over to the normal claim ceremony at `/g/…`; without a configured faucet it shows a stamped demo envelope |
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
| SEO and Open Graph | One `h1`, real text, `description`, canonical, `hreflang`, JSON-LD `Organization` only. OG card is a static 1200x630 PNG in the ink/ivory language (the three-coin mark and the two hands, no text smaller than 60 px). `twitter:card=summary_large_image` |
| Accessibility | Real buttons for clap, phone and language/theme; the hand SVGs are `aria-hidden`; space claps; blue 3 px focus ring; 44 to 48 px targets; AA contrast; keyboard, zoom to 200 %, and without JS the hands, the coin pile and all links are static and work |

## Robustness

| Risk | Answer |
| --- | --- |
| Faucet drained | The site never promises an amount. `/hello` shows an honest "today's envelopes are gone, back tomorrow" screen with the Klimper and "get an envelope from a friend" paths. The site reads `/stats.json`'s `faucetOpen` flag and, when false, swaps the CTA to **Come back tomorrow**; the clap and tap demos keep working |
| Faucet abuse (one person, many envelopes) | Rate limit per passkey and per coarse network at the faucet service; one envelope per new wallet; the amount is small and capped per day globally. Not a site concern, but the site must not expose a one-click automatable endpoint: only `/hello`, which needs a passkey ceremony |
| DDoS | The site is static files behind a CDN with long cache; nothing dynamic depends on origin. `/stats.json` is cached at the edge, so traffic never reaches the service |
| Offline / flaky | The page is self-contained, so it renders from cache; the ceremony works offline, the CTA then lands on the app's own offline message. Service worker: not needed |
| Fake sites | The CTA href is absolute and fixed to the app's hostname; both hostnames show the domain; no wallet or key is ever entered on the site itself |

## Hosting and CI

| Choice | Recommendation |
| --- | --- |
| Host | Two hostnames, two containers behind one Caddy: `clapandpay.com` is the hub (plus `/klimper`, `/.well-known/*`), `envelope.clapandpay.com` is the Green Envelope app. The wallet gets its own browser origin on purpose; its passkey is created for `clapandpay.com` so Klimper still gets the same key. See `deployment/README.md` |
| Deploy | The site is `apps/site`: two static files, built into the `clapandpay-web` image (nginx, non-root, amd64 and arm64) by `.github/workflows/images.yml` on a `clapandpay-web-v*` release. **No schedule.** Any periodic work (refreshing the baked counter) is a script run by hand or done by the edge at request time |
| CI cost | One runner per image, only on a published release; nothing runs on pull requests or merges |

## Open points for the owner

1. The TestFlight public link (placeholder `/klimper` in the prototype) and who sets it.
2. Whether the faucet funds in euro terms or XCH; the site avoids stating an amount until decided.
3. Imprint and privacy texts (German law requires an Impressum before launch).
4. `/hello` is built; the faucet service and its `FAUCET_URL` are the owner's.
