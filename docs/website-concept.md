# clapandpay.com: website concept

Status: proposal. Prototype: `docs/design/website-prototype/index.html` (open it from disk; one file,
about 33 kB raw, no requests). The sample numbers in its counter are fake.

## The one big idea

**The site is the envelope.** There is no brochure and no hero image: the first thing you see is a
sealed green envelope you can tap, and tapping it is the product demo, the faucet and the
sign-up in one gesture. Everything below it is the answer to "what did I just do?". Klimper is
not a second product pitch but the next room: the envelope brings you in, the phone is where
you stay. Receiving money is the sign-up, so the landing page makes you receive.

## Scroll narrative

| # | Section | What happens | Static / dynamic |
| --- | --- | --- | --- |
| 1 | **Hero: "Tap. It's yours."** | Oversized type, a big tilted envelope that wobbles in steps like a machine. Tap: seal bursts into four leaves, flap lifts, letter rises, then the button **Get your envelope** appears (`/hello`). A small "skip the ceremony" link sits below for people in a hurry. A ghost euro sign drifts as you scroll | Static HTML + SVG + 40 lines of JS |
| 1b | **Quiet counter** | One mono line under the hero: "N envelopes opened, passed on 2.3x on average". No map, no names, no regions | One same-origin `GET /stats.json` (cached 60 s at the edge); the page works without it and shows the baked-in number |
| 2 | **The loop: Tap. Yours. Pass on.** | Three giant outlined numerals, staggered on desktop. A dotted ochre postal route draws itself as you scroll. Then a small card: 1 envelope becomes 2, 4, 8 (rows appear with scroll) | Static; scroll animation is progressive enhancement |
| 3 | **Klimper: "Stay."** | Full-bleed forest field behind a dithered edge. A paper-cut phone (drawn, no screenshot) rises and straightens as you arrive, a tiny envelope slipping into it. Copy: hold it, pass it on, spend it; splits, pots and games next. Primary button **Get Klimper on TestFlight**. Below, a dashed box "Opened an envelope already?" with three steps for **Use my Clap and Pay money** (tap it in Klimper, compare six digits on the page, paste) | Static; TestFlight link is a config value |
| 4 | **Small print, in big print** | Five items: your money is yours (no custodian), the link is cash, no account or password, no cookies or trackers, early software so be careful | Static |
| 5 | **Footer** | Huge "Clap&Pay" wordmark, DE/EN switch, Imprint (legally required in Germany), Privacy, GitHub | Static |

The phone shows the real first screen (balance, **Send it on**, **Keep it**), the same two buttons
the claim page ends on, so the demo and the app read as one thing.

## Art direction

| Topic | Rule |
| --- | --- |
| Language | Exactly `tokens.css` and `design.md`: ivory paper, near-black ink, forest, verdigris, leaf, ochre. Copy the tokens, never invent a hex. No gradients (a hard-edged checker "dither" is the only shading), no blur shadows (hard offset only), no blue, no stock imagery, no photos or screenshots |
| Ochre | Occasional: the word "yours" (as a stamped block with ink text), the seal, postmarks, the postal route, the TestFlight button. Never a large field |
| Type | System stacks only. Display is Helvetica Neue/system at weight 900 with -0.06em tracking, line-height 0.84, sizes up to about 170 px; mono for small labels. Oversize is the voice. Outlined numerals and a ghost euro for depth; text is always solid when it carries meaning |
| Composition | Asymmetric on a 12-column grid. Envelope bleeds off its column, rotated 3 degrees; the loop staggers down a diagonal; the phone overlaps the section above it |
| Motion | Paper moves eased, the machine moves in steps (idle wobble, blinking counter dot). One ceremony, about 1.3 s. Scroll-driven bits use CSS `animation-timeline` only, behind `@supports`; without it the page is simply laid out. No scroll-jacking, no JS scroll listeners |
| Sound | None. Ever |
| Dark mode | `prefers-color-scheme` swaps the same role tokens as the app (paper charcoal green, ink ivory, green becomes verdigris). Klimper section stays forest in both. No manual toggle |
| Reduced motion | All animation and transitions off, the envelope still opens (instantly), scroll effects removed, `scroll-behavior` auto |

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
| Budget | HTML under 40 kB raw, about 12 kB gzipped; zero images, zero web fonts, zero third-party requests; the only JS is inline. LCP is the headline text and the SVG, both in the first response: well below 1.5 s on 4G. CI gate: a test that fails above 60 kB or if the file contains `http` other than the GitHub and TestFlight links |
| Cookies, tracking | None. No consent banner needed. Language choice in `localStorage` only after the person clicks DE/EN |
| Analytics | **None third-party.** The counter is the product's own aggregate (envelopes opened, mean hops) from the envelope service, never per-visitor. If funnel numbers are wanted later, count `GET /hello` server-side in the edge logs without IPs; still no cookie |
| Languages | Separate static documents: `/` (English) and `/de/` with `hreflang` both ways. Default by `Accept-Language` is a hint link, not a redirect, so crawlers and link previews stay stable. The prototype toggles in place to show both |
| SEO and Open Graph | One `h1`, real text, `description`, canonical, `hreflang`, JSON-LD `Organization` only. OG card is a static 1200x630 PNG in the ink/ivory language (the envelope drawing, no text smaller than 60 px). `twitter:card=summary_large_image` |
| Accessibility | Real `<button aria-expanded>` for the envelope with a visible label; the SVG is `aria-hidden`; the CTA takes focus when the ceremony ends (announced via `role=status`); focus ring 3 px ochre plus ink; 48 px touch targets; AA contrast (ochre only behind ink text); works with keyboard, zoom to 200 %, no JS (the skip link and a `noscript` button go to `/hello`) |

## Robustness

| Risk | Answer |
| --- | --- |
| Faucet drained | The site never promises an amount. `/hello` shows an honest "today's envelopes are gone, back tomorrow" screen with the Klimper and "get an envelope from a friend" paths. The site reads `/stats.json`'s `faucetOpen` flag and, when false, swaps the CTA to **Come back tomorrow**; the envelope still opens (it is a demo) |
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
