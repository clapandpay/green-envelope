# Clap and Pay: brand

Status: proposal, with the hub prototype (`../apps/site/index.html`) and the hand
sticker sheet (`../apps/site/stickers.html`) as the reference. The method is
Beidwerk's Kinetic Humanism; the mark and the colours are the Klimper app icon's
(`klimper/src/icon-light.png`, `icon-dark.png`).

**The guide and the icon disagree.** `klimper/docs/design-guide.md` describes a bird, a sun and a
teal accent. The icon that actually ships is three glossy flat coins (blue, red, yellow) bumping
into each other, a cream four-point spark at the contact point and two thick ink ticks above the
gap, on warm off-white. For Clap and Pay the icon wins: the sun and teal palette of the guide is
not used here, and the guide should be brought in line with the icon (a task for Klimper, not for
this file).

## The idea

**Klimper is the coin colliding. Clap and Pay is the same collision with a pair of hands around
it: two hands meet, a finger lands, it settles into a coin.**

| Product | What moves | One word |
| --- | --- | --- |
| Klimper | a coin hits a coin, a spark, two ticks | *klimpern* |
| Clap and Pay | hands clap, a finger taps, a coin settles | *clap* |

The brand is the gesture. The spark and the two ticks from the icon are the contact motif: they
appear at the moment the hands meet, exactly as they sit between the coins in the mark.

## The clap grammar (Beidwerk: Pair, Joint, Trace, Contact)

| Question | Clap | Tap | Pay |
| --- | --- | --- | --- |
| Pair: what are the two things? | left hand, right hand | finger, screen | hand, coin |
| How do they approach? | drift in, slightly off-axis, anticipation pull-back | a finger glides in at an angle | a coin falls from above |
| Contact: what changes? | both hands squash; spark, two ticks and a ring burst | a ripple spreads from the touch | the coin lands in the number |
| Trace: what remains? | a dotted echo ring, coins in the three colours jingle out | a fading ripple | a number that pops once |
| Settle: how does it end? | hands rest apart, coins lie in a small pile | the finger leaves, the screen is calm | one coin, one number, still |

Unresolved states are many (echoes, flying coins); the resolved state is one (a pile, a number).
Human deviation: hands are never mirror-perfect, and coins land where they land.

## Mark system

| Part | Rule |
| --- | --- |
| Mark | The three-coin icon redrawn as inline SVG (symbol `#mk`): blue, red and yellow coins with a darker rim, a white highlight arc each, a cream spark at the contact point, two ink ticks above the blue and red coins. Flat, no gradients. On dark the ticks turn cream, as in `icon-dark.png` |
| Coins | The same three coins are the coins of the site: the shower, the pile, the one that drops into the phone |
| Hands | See below. A friendly cartoon hand, not a diagram |
| Wordmark | `Clap and Pay` in the rounded display face at 800 weight, ink, next to the mark. No taglines inside the lockup |
| Small size | Below 24 px the mark loses the ticks (favicon: three coins). Below 16 px only the blue coin |
| Clear space | One coin diameter on every side |

## Hands

The hands are the playful part of the brand and the most important drawing. They follow the
friendly emoji tradition (open hands, clapping, pointing), not a geometric diagram.

- One construction: a chubby rounded palm, four clearly separate rounded fingers of different
  lengths, a thick thumb, a cuff, a thick ink outline (13 units on a 150-unit palm), a warm yellow
  flat fill (the yellow coin), one orange shade shape, one small highlight per finger. No gradient.
- A cream **sticker edge** around the whole silhouette on dark and in the sticker sheet, and a
  faint hard-edged **offset print** (misregistration) in blue or red under it. No blur.
- Cuff bands carry the other two coin colours: blue on the left hand, red on the right.
- Poses are transforms of the one construction: **clap** (two open hands tilted toward each
  other, mirrored, 12 degrees), **open** (palm to the viewer, waving or beckoning), **tap**
  (index finger up, three folded fingers, thumb across), **pay** (open hand holding a coin),
  **thumbs up**. The hero hand is inline so each finger wiggles on its own when idle; every other
  use is an SVG `use` of the same symbols.
- Memeable means: a silhouette that works as a sticker at 40 px and at 600 px, expression through
  pose and squash-and-stretch, not detail. Hands in the three coin colours were tried and
  rejected: the yellow hand reads as a hand, the tinted ones read as gloves.

## Palette

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| Canvas | `#FFFCF6` | `#0C0C10` | page (warm off-white, as in the icon) |
| Sunk | `#F6EFE0` | `#14141A` | panels, the disc behind the hands |
| Ink | `#14141A` | `#FFF6E8` | text, outlines, hard shadows |
| Muted | `#5E5A55` | `#A9A6A0` | secondary text |
| Blue | `#0A5CFF`, rim `#0039C8` | `#4A8BFF` | primary action, the second word of the headline |
| Red | `#FF4747`, rim `#C21F26` | same | coin, right cuff, one accent |
| Yellow | `#FFC31F`, rim `#F09A10` | same | coin, hand fill, marker, Klimper action |
| Spark | `#FFF6D8` | same | the contact spark |

Rules: ink text on yellow, white text on blue (5.6:1; on dark the button is light blue with dark
text); colour is flat, with a white highlight arc as the only "gloss"; no gradients anywhere; no
glow, glass or purple. Paper grain is a faint static noise tile over the page (7 percent light,
5 percent dark). Green Envelope keeps its own forest green, ivory, leaf and ochre, inside its
own chapter only, which is a deliberate change of room.

## Type

| Role | Stack | Rule |
| --- | --- | --- |
| Display | `ui-rounded, "SF Pro Rounded", Nunito, "Arial Rounded MT Bold", system-ui` | 800, tracking -0.045em, line-height about 0.9; letters hop once when the hands meet |
| Body | `system-ui, -apple-system, "Segoe UI", Inter, Roboto` | 400, sentence case |
| Label | `ui-monospace, "SF Mono", Menlo, Consolas` | 600, small, uppercase, tracked, numbered sections (`02`, `03`) |
| Green Envelope | `Helvetica Neue, Helvetica, Arial` | 900, tracking -0.065em: its own grotesque, in its own chapter |

No webfonts, no requests. Numbers are tabular.

## Layout

An editorial 12-column grid, hairline and 2 px ink rules over every numbered section, one strong
anchor per screen (the hands, the doors, the steps, the envelope, the coins, the plain words).
Hard offset shadows (4 to 8 px, ink) on buttons and cards, never blur. The playfulness lives in
the hands and the coins; everything around them is calm.

## Motion principles

Every sequence is state A, transition, contact, resolved state.

| Principle | Value |
| --- | --- |
| Approach | 300 to 500 ms, ease-in with an anticipation pull-back |
| Contact | 60 to 120 ms squash (scaleX 0.93 to 0.96), spark, ticks and ring 550 to 1000 ms ease-out |
| Settle | 400 to 800 ms, one overshoot at most, then stillness |
| Idle | slow breathing, 4 to 5 s; fingers wag a few degrees, staggered; one beckon every 9 s |
| Second click | within 0.9 s the hands rise for a high five |
| Combo | five fast claps rain more coins; a short, silly line appears (and is announced politely) |
| Particles | at most 30 on the hero, 12 in the footer; transform and opacity only; paused off-screen and in hidden tabs |
| Reduced motion | no animation and no transitions; a clap shows the pressed pose for 220 ms and drops the coins already resting |
| Sound | none, ever. The jingle is only drawn |

## Voice

Warm, plain, short. Verbs before nouns, one idea per line, never a lecture, never "blockchain".
The site says only what exists today: Green Envelope and Klimper. Nothing is announced.

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
| Draw hands as friendly, chubby, outlined cartoon hands | Geometric or mirror-perfect corporate clip-art hands |
| Keep the icon's three colours and flat highlights | Add the guide's sun and teal, gradients, glow, glass |
| Write plainly: money stays yours, a link is cash | Crypto words, urgency, fake numbers |
| Put playfulness in hands and coins | Sprinkle effects everywhere |
| Make it work with no JS and reduced motion | Require motion to understand anything |

## Family

| Door | Role | Look |
| --- | --- | --- |
| Clap and Pay (hub) | the brand and the front door | this document |
| Green Envelope | first release, money as a link; a full chapter on the hub | a guest: its own forest green, ivory, leaf and ochre, paper print, dither shadow; a large tappable envelope with its opening ceremony, the loop with its postal route, and the 1, 2, 4, 8 envelope tree; links to `/hello` |
| Klimper | the wallet, "Use Clap and Pay money" | the three-coin mark, animated, in the hub's own look |

One grammar (pair, contact, trace, stillness), two characters. Clap and Pay never recolours a
guest, and a guest never recolours the hub.
