# Luak UI Style Source: Symposium Design Language

This document captures the Symposium-aligned design tokens and conventions
used by Luak's UI. All operator-facing projects should converge on
these values for a consistent visual language.

## Colors

| Token           | Value      | Usage                        |
|-----------------|-----------|------------------------------|
| `--bg-0`        | `#0f1117` | Page background              |
| `--bg-1`        | `#151822` | Elevated surface             |
| `--bg-2`        | `#1c2030` | Card background              |
| `--bg-card`     | `rgba(28,32,48,.72)` | Glass card fill   |
| `--orange`      | `#f59e0b` | Primary accent (amber/gold)  |
| `--teal`        | `#34d399` | Success / positive signal    |
| `--red`         | `#f87171` | Failure / danger             |
| `--cyan`        | `#67e8f9` | Info / secondary accent      |
| `--violet`      | `#a78bfa` | Neutral highlight            |
| `--ink`         | `#e2e8f0` | Primary text                 |
| `--ink-dim`     | `#94a3b8` | Secondary text               |
| `--border-subtle`| `rgba(255,255,255,.08)` | Default border  |
| `--border-medium`| `rgba(255,255,255,.12)` | Emphasized border|

## Card Style

- Background: `var(--bg-card)` with `backdrop-filter: blur(12px)`
- Border: `1px solid var(--border-subtle)`
- Border-radius: `16px` (large), `12px` (medium), `8px` (small)
- Shadow: `0 8px 32px rgba(0,0,0,.3), 0 0 0 1px var(--border-subtle)`
- No gradient overlays, no animated effects on cards
- Hover: `var(--bg-card-hover)` with `var(--border-bright)`

## Heading Scale

| Level     | Size  | Weight | Letter-spacing |
|-----------|-------|--------|----------------|
| Page title| 28-40px | 800  | -0.01em       |
| Section   | 16px  | 700    | 0.01em        |
| Label     | 13px  | 600    | 0.02em        |
| Body      | 14px  | 400    | normal        |
| Caption   | 11px  | 500    | 0.03em        |

## Pill / Badge Rules

- **Chips**: `border-radius: 999px`, `padding: 6px 14px`, `font-size: 11px`
- **Tags**: `border-radius: 999px`, `padding: 4px 10px`, `font-size: 11px`
- **Badges**: `border-radius: 999px`, `padding: 5px 12px`, `font-size: 11px`
- Color variants: `.teal`, `.orange`, `.red`, `.cyan`, `.violet`, `.dim`
- Background uses 8% opacity of the accent color
- Border uses 30% opacity of the accent color

## Spacing Rules

- Page padding: `16px`
- Card internal padding: `16-18px`
- Section gap: `16px`
- Component gap: `12px`
- Element gap: `8px`

## Mobile Rules

- Touch targets: minimum `44px` effective height
- Tab pills: `12px 18px` padding, `13px` font
- Breakpoints: `1240px` (tablet), `720px` (phone), `420px` (narrow)
- Single-column layout below `720px`
- Chips/tags allow wrapping on narrow viewports

## Do / Don't

### Do
- Use warm charcoal backgrounds
- Keep text readable at 13-14px base size
- Use status pills for scannable states
- Group related info in clear card sections
- Show essential data by default, advanced on expand
- Use 3px left-border accents for status on rows

### Don't
- Use animated background effects (underwater, particles)
- Use extreme letter-spacing (> 0.1em) for body text
- Show all metadata in the default view
- Use neon glow effects on text
- Make art/mascot compete with data
- Use ALL-CAPS for longer labels
