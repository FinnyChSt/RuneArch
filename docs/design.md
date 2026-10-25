# Frontend design

RuneArch uses a dark, low-glare canvas with cool blue-gray surfaces. Muted surfaces and borders
separate panels and controls; brighter colors identify system layers, HTTP methods, flows and
validation states. Keep color purposeful and readable against the dark background.

## Color palette

These values are defined centrally in [`tokens.css`](../apps/web/src/theme/tokens.css). Use the
existing CSS variables or their Tailwind utilities instead of adding duplicate color literals.

| Token              | Color     | Use                                 |
| ------------------ | --------- | ----------------------------------- |
| `--bg-canvas`      | `#1B2635` | App and canvas background           |
| `--grid-dot`       | `#2A3A50` | Canvas grid                         |
| `--surface`        | `#243347` | Panels and controls                 |
| `--surface-raised` | `#2C3E55` | Raised or emphasized surfaces       |
| `--border`         | `#3A4D66` | Dividers and outlines               |
| `--accent`         | `#7FA7D9` | Primary accent, selection and focus |
| `--text`           | `#E6EDF5` | Primary text                        |
| `--text-muted`     | `#9AABC0` | Supporting text                     |

### Canvas object colors

| Token           | Color     | Use                         |
| --------------- | --------- | --------------------------- |
| `--node-fe`     | `#6FC3B8` | Frontend nodes              |
| `--node-be`     | `#A79BE0` | Backend nodes               |
| `--node-db`     | `#E0B46F` | Database nodes              |
| `--node-sketch` | `#D9CFB8` | Sketch and annotation nodes |

### Semantic colors

| Meaning                 | Color     |
| ----------------------- | --------- |
| GET / success           | `#6FCF97` |
| POST / primary action   | `#7FA7D9` |
| PUT and PATCH / caution | `#E0B46F` |
| DELETE / error          | `#E07A7A` |
| Warning                 | `#E0B46F` |
| Danger                  | `#E07A7A` |
| Connections             | `#6B7F99` |

Flows use a distinct soft palette: teal `#6FC3B8`, violet `#A79BE0`, amber `#E0B46F`,
blue `#7FA7D9`, rose `#E08BA8`, green `#8FCB7F`, orange `#E6956A` and sky `#72C6E6`.
Wireframes are intentionally monochrome: paper `#1F2D3F`, fill `#2E4058`, line `#4E6482`,
ink `#A9B8CA` and strong ink `#D3DDE8`.

## Typography and implementation

- UI text uses Inter, with system sans-serif fallbacks.
- Code and technical values use JetBrains Mono, with system monospace fallbacks.
- `tokens.css` is the source of truth for colors and font stacks. `global.css` exposes the tokens
  as Tailwind utilities and applies them to the app and React Flow canvas.
- Preserve semantic meaning when using color; pair important state changes with a label, shape or
  other visual cue rather than relying on color alone.
