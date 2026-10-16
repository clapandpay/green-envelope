# Green Envelope: colour and logo

The palette and the logo of the page. The tokens live in `apps/web/src/styles/tokens.css`; every
screen uses the role names there (`--paper`, `--ink`, `--green`, `--sun`, …), never a hex value.

## Palette

| Role                | Colour          | Hex       | Token              |
| ------------------- | --------------- | --------- | ------------------ |
| Canvas / paper      | Beidwerk paper  | `#F4F0E8` | `--ivory`          |
| Primary ink         | Beidwerk ink    | `#1C1B19` | `--near-black`     |
| Main brand green    | Copper-green    | `#20422F` | `--forest`         |
| Secondary green     | Verdigris       | `#4F9A86` | `--verdigris`      |
| Fresh accent        | Light verdigris | `#7DBBA8` | `--leaf`           |
| Warm counter-accent | Gold            | `#C69C66` | `--ochre`          |
| Structural neutral  | Stone           | `#8A877F` | `--stone`          |
| Dark surface        | Beidwerk stage  | `#0E130C` | `--charcoal-green` |

How the roles use it:

| Role                       | Light                 | Dark                   |
| -------------------------- | --------------------- | ---------------------- |
| `--paper`                  | Warm Ivory            | Charcoal Green         |
| `--ink`                    | Near Black            | Warm Ivory             |
| `--ink-soft` (quiet text)  | `#5F5C55`, stone dark | `#ABA79D`, stone light |
| `--green` (buttons, marks) | Copper-green          | Verdigris, ink text    |
| `--green-soft` (tints)     | `#D8E6DF`, verdigris  | `#1A2E27`              |
| `--sun` (the one accent)   | Ochre, ink text on it | Ochre                  |
| `--line-colour`            | Stone                 | `#5C5A54`              |

Stone itself is 3.2:1 on ivory, too faint for text, so quiet text uses a darker stone (5.9:1) and
Stone is kept for lines. Every text pairing above reaches WCAG AA: ivory on copper-green 9.8:1, ink
on gold 6.8:1, ink on verdigris 5.2:1 (ivory on it is 2.9:1, so dark buttons take ink text), ivory
on the stage 15.7:1. Since TASK-136 the colours are the Beidwerk family's (copper-green, verdigris,
gold on Beidwerk paper and stage), so the envelope matches Clap and Pay and Klimper. The alert red stays: it is
functional, not brand.

## Logo

The mark is a green envelope with a leaf. The originals (1254px, about 2 MB each) are not in the
repository; the page uses downscaled copies in `apps/web/public/`, served as static files so they
do not count against the claim route's JavaScript budget:

| File                   | Size  | Use                                               |
| ---------------------- | ----- | ------------------------------------------------- |
| `logo-light.png`       | 96px  | top bar, light mode (shown at 32px), rounded tile |
| `logo-dark.png`        | 96px  | top bar, dark mode, the black version             |
| `favicon.png`          | 64px  | browser tab                                       |
| `apple-touch-icon.png` | 180px | home screen on iPhone, full bleed (iOS rounds it) |

The mark cannot be cut out of its background (the leaf and the envelope's V are the paper
colour), so it is always shown as a tile on its own paper. To regenerate from a new original,
square-crop it around the mark with about 9% margin on its own background colour and scale with
ImageMagick; the commands are in the commit that added these files.

## Illustration

The page belongs to the Beidwerk family: printed paper, not clean SaaS green. The animated
envelope (`apps/web/src/components/Envelope.tsx`, styled in `styles/claim.css`) is drawn in the
logo's language, and new illustration should be too:

- **Paper texture:** printed grain (an SVG noise filter) over coloured fields, a lighter grain on
  paper; shadows are dither, never blur; no gradients.
- **Dark green geometric fields:** the envelope is split down the middle, forest and black on one
  side, black with leaf-green and verdigris arcs on the other, the way the logo is.
- **Leaf and envelope intersections:** the ivory V where flap and pocket meet, and leaves that
  grow out of the envelope and rise with the letter.
- **Circular postal motifs:** the seal is a perforated ochre stamp whose four leaves fly apart when
  it breaks; an ochre postmark with wavy cancellation lines sits behind the envelope; the letter
  carries a perforated stamp and a postmark ring.
- **Black-and-white documentary imagery:** photographs appear as halftone prints (the small
  picture on the letter, the inside of the flap).
- **Ochre is occasional:** seal, postmark, stamp edge. Never a large surface.

## The envelope as showpiece: motion rules

The envelope and the claim moment are the piece of art; these rules keep them one family.

- **Depth, not decoration:** layers sit at fixed depths (`.env__px--sun`, `--cast`, `--slip`,
  `--leaves`, `--seal`). `useTilt` writes only `--tx`/`--ty` (-1..1) from the pointer or the
  phone's gyroscope; CSS slides each layer by its depth and leans the whole piece in perspective.
  Far layers move against the lean, near ones with it. Wrapper groups carry the parallax, so the
  parts inside keep their own transforms.
- **Transform and opacity only.** No blur, no gradients, no layout work. The one script loop is
  the tilt easing, with passive listeners, stopped when settled and on unmount.
- **Alive when sealed:** a slow float, the seal beating twice like a pulse, then a rock. Held
  under a thumb the seal gives, the crest draws in and the paper trembles, then it cracks.
- **Springs for paper:** `--spring` is a `linear()` spring (bezier fallback). Flap, letter and
  the letter's leaves overshoot once and settle; machine motion (raster bars) stays stepped.
- **Confetti is cut paper:** leaf, sliver, triangle, half-moon and parallelogram shards in ochre,
  leaf, forest, ink and ivory, each two-faced (a different colour on the back) so they flip as
  they fall. Positions are a deterministic golden-angle fan: no randomness.
- **Haptics, no sound:** `navigator.vibrate` briefly on opening and on the open; never audio.
- **Reduced motion:** no lean, no breathing, no springs, no confetti; the open state simply is.
- **Colours from tokens only**, so dark mode follows. `Envelope` takes an optional `interactive`
  (default on) for places that want it still.
