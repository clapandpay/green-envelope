# Green Envelope: colour and logo

The palette and the logo of the page. The tokens live in `apps/web/src/styles/tokens.css`; every
screen uses the role names there (`--paper`, `--ink`, `--green`, `--sun`, …), never a hex value.

## Palette

| Role                | Colour         | Hex       | Token              |
| ------------------- | -------------- | --------- | ------------------ |
| Canvas / paper      | Warm Ivory     | `#F4F0E6` | `--ivory`          |
| Primary ink         | Near Black     | `#171918` | `--near-black`     |
| Main brand green    | Deep Forest    | `#0F5A3A` | `--forest`         |
| Secondary green     | Verdigris      | `#2B7A62` | `--verdigris`      |
| Fresh accent        | Leaf Green     | `#79A83B` | `--leaf`           |
| Warm counter-accent | Ochre          | `#C59A3A` | `--ochre`          |
| Structural neutral  | Stone          | `#8A877F` | `--stone`          |
| Dark surface        | Charcoal Green | `#12201A` | `--charcoal-green` |

How the roles use it:

| Role                       | Light                  | Dark                   |
| -------------------------- | ---------------------- | ---------------------- |
| `--paper`                  | Warm Ivory             | Charcoal Green         |
| `--ink`                    | Near Black             | Warm Ivory             |
| `--ink-soft` (quiet text)  | `#5F5C55`, stone dark  | `#ABA79D`, stone light |
| `--green` (buttons, marks) | Deep Forest            | Verdigris              |
| `--green-soft` (tints)     | `#D2DCB6`, leaf tint   | `#1A3B30`              |
| `--sun` (the one accent)   | Ochre, ink text on it  | Ochre                  |
| `--line-colour`            | Stone                  | `#5C5A54`              |

Stone itself is 3.2:1 on ivory, too faint for text, so quiet text uses a darker stone (5.9:1) and
Stone is kept for lines. Every text pairing above reaches WCAG AA: ivory on forest 7.3:1, ink on
ochre 6.8:1, ivory on verdigris 4.5:1, ivory on charcoal green 14.8:1. The alert red stays: it is
functional, not brand.

## Logo

The mark is a green envelope with a leaf. The originals (1254px, about 2 MB each) are not in the
repository; the page uses downscaled copies in `apps/web/public/`, served as static files so they
do not count against the claim route's JavaScript budget:

| File                   | Size  | Use                                                   |
| ---------------------- | ----- | ----------------------------------------------------- |
| `logo-light.png`       | 96px  | top bar, light mode (shown at 32px), rounded tile     |
| `logo-dark.png`        | 96px  | top bar, dark mode, the black version                 |
| `favicon.png`          | 64px  | browser tab                                           |
| `apple-touch-icon.png` | 180px | home screen on iPhone, full bleed (iOS rounds it)     |

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
