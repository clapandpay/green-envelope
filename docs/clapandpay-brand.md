# Clap and Pay: brand

Status: proposal, with the hub prototype (`design/website-prototype/index.html`) as the
reference. The method is Beidwerk's Kinetic Humanism; the colours and shapes are Klimper's
(`klimper/docs/design-guide.md`). Where this file and the Klimper guide disagree on a token, the
Klimper guide wins.

## The idea

**Klimper is the coin colliding. Clap and Pay is the same coin with a pair of hands around it:
two hands meet, a finger lands, it settles into a coin.**

| Product | What moves | One word |
| --- | --- | --- |
| Klimper | a coin hits a coin, coins jingle | *klimpern* |
| Clap and Pay | hands clap, a finger taps, a coin settles | *clap* |

The brand is the gesture. Everything on the hub is a pair that meets and leaves something small
behind.

## The clap grammar (Beidwerk's five questions)

| Question | Clap | Tap | Pay |
| --- | --- | --- | --- |
| What are the two things? | left hand, right hand | finger, screen | hand, pocket |
| How do they approach? | drift in, slightly off-axis, anticipation pull-back | a finger glides in at an angle | a coin falls from above |
| What changes on contact? | both hands squash, a flash and a ring burst | a ripple spreads from the touch | the coin shrinks into the slot |
| What trace remains? | an echo of the hand, a dotted ring, coins that jingle outward | a fading ripple | a number that pops once |
| How does it settle? | hands rest apart, coins lie in a small pile | the finger leaves, the screen is calm | one coin, one number, still |

Unresolved states are many (echoes, flying coins); the resolved state is one (a pile, a number).
Human deviation: hands are never mirror-perfect (5 degrees off, one beckons now and then), and
coins land where they land.

## The tap gesture

A finger is a rounded capsule at about 25 degrees. It approaches from the lower right, presses
for 80 ms (a 5 percent squash), leaves. Contact is always a ripple in sun orange. A tap makes a
coin; a clap makes coins (a shower). Tap is the quiet gesture, clap the loud one.

## Mark system

| Part | Rule |
| --- | --- |
| Mark | Two rounded palms (sun orange left, teal right) tilted toward each other, a sun-yellow coin with an ink rim in the gap above them: the clap at the moment of contact. Works in 2 colours and 1 colour (ink or cream) |
| Relation to Klimper | Klimper has a bird flying out of a sun, with coins in its trail. We keep its palette, its coin and its roundness, and do not draw the bird, the sun disc or the streaks. Side by side they read as siblings: his coin is in a flight, ours in a clap |
| Hands in illustration | Large, geometric, human: a flat palm, four thick rounded fingers, a thumb, a dark cuff; a yellow offset shadow gives depth. No outlines, no skin tones, no faces |
| Wordmark | Lowercase `clap` + a sun coin + `pay`, in the rounded display face at 800 weight, `pay` in teal. The coin replaces the space and is the only gradient. Never stretch, outline or add a tagline inside the lockup. In running text: "Clap and Pay" |
| Small size | Below 24 px drop the fingers: two rounded capsules and one coin (the favicon). Below 16 px only the coin |
| Clear space | One coin diameter on every side |

## Palette

All values come from Klimper's tokens. Add none.

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| Canvas | `#FFF7EC` | `#0F1014` | page |
| Surface | `#FFFFFF` | `#1A1C22` | cards |
| Ink | `#111217` | `#FFF4E6` | text, cuffs, rims |
| Muted | `#5C606B` | `#A8ACB5` | secondary text (5.9:1 and 8.4:1) |
| Sun | `#FF3B1F` to `#FF9A1F` | same | primary action and coins only |
| Left hand | `#FF7A1F` | same | the orange palm |
| Right hand | `#0F7C87` | `#3FC1CC` | the teal palm, secondary action, focus ring |
| Rim | `#FFC21A` | same | coin rim, hand shadow, flash |
| Link | `#C73515` | `#FF6A3D` | text links |

Rules: text on the sun is **ink, never white** (5.3:1 at the red end, 8.8:1 at the orange end);
the sun is never a page or card background; no neon, glass, purple or startup blue; no other
gradient anywhere. Colour is dusty and warm, not primary: it should feel like lacquer and
screen light (Beidwerk's ClapAndPay material world). Green Envelope keeps its own forest green,
inside its own card only.

## Type

| Role | Stack | Rule |
| --- | --- | --- |
| Display | `ui-rounded, "SF Pro Rounded", Nunito, "Arial Rounded MT Bold", system-ui` | 800, tracking -0.04em, line-height about 0.95; letters may hop on the clap |
| Body | `system-ui, -apple-system, "Segoe UI", Inter, Roboto` | 400, sentence case |
| Label | `ui-monospace, "SF Mono", Menlo, Consolas` | 600, small, uppercase, tracked |

No webfonts, no requests. Numbers are tabular. Kinetic type is allowed when it shows contact:
the headline hops once when the hands meet, then rests.

## Motion principles

Every sequence is state A, transition, contact, resolved state.

| Principle | Value |
| --- | --- |
| Approach | 300 to 500 ms, ease-in with a small anticipation pull-back |
| Contact | 60 to 120 ms squash (scaleX 0.93 to 0.95), flash and ring 550 to 1000 ms ease-out |
| Settle | 400 to 800 ms, one overshoot at most, then stillness |
| Idle | slow breathing, 4 to 5 s, a few degrees, nothing faster; one beckon every 9 s |
| Particles | at most 40, transform and opacity only, paused off-screen and in hidden tabs |
| Scroll | CSS scroll-driven animation behind `@supports`, never scroll-jacking: hands drift apart going down, meet again at the footer |
| Reduced motion | no animation and no transitions; a clap shows the pressed pose for 220 ms and drops the coins already resting. Everything works and reads the same |
| Sound | none, ever. The jingle is only drawn |

## Voice

Warm, playful, short. Verbs before nouns, one idea per line, never a lecture, never "blockchain".

| Instead of | Say (EN / DE) |
| --- | --- |
| Receive funds | Tap. It lands. / Tipp. Es landet. |
| Split the bill | Clap. Pay. / Klatsch. Zahl. |
| Terms and conditions | Plain words. / Klare Worte. |
| Error: faucet empty | Come back tomorrow. / Komm morgen wieder. |

German is "du", always; both languages are written, not translated.

## Do and don't

| Do | Don't |
| --- | --- |
| Make two things meet, and show what stays | Animate for decoration |
| Let the hands be a little off | Mirror-perfect, corporate clip-art hands |
| Keep the sun for the one action and the coins | Gradient backgrounds, glow, glass |
| Ink on sun, always | White on sun |
| Write plainly: money stays yours, link is cash | Crypto words, urgency, fake numbers |
| Make it work with no JS and reduced motion | Require motion to understand anything |

## Family

| Door | Role | Look |
| --- | --- | --- |
| Clap and Pay (hub) | the brand and the front door | this document |
| Klimper | the wallet, "Use Clap and Pay money" | Klimper's own guide, the coin collision, black card on the hub |
| Green Envelope | first release, money as a link | a guest: its own forest green, paper and hard shadow, in its card only; live mini envelope that links to `/hello` |
| Play | who pays tonight, coming soon | dashed teal card, a preview only |

One grammar (pair, contact, trace, stillness), three characters. Clap and Pay never recolours
a guest, and a guest never recolours the hub.
