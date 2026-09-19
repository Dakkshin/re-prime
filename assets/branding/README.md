# re-prime branding

The wordmark is drawn in ASCII so it renders in a terminal, a README, a commit message, or an issue without shipping binary assets.

## tagline

> prime again, minus the bloat

Keep it attached to the mark. It carries the whole name: `re-` (do it again) + `prime`, against the zero-bloat goal.

## files

| file | use |
|---|---|
| `lockup.txt` | primary lockup — recursion mark, name, tagline |
| `banner.txt` | pure-ASCII wordmark for READMEs, terminals, slides |
| `banner-unicode.txt` | same wordmark in full blocks (`█`) where the terminal can take it |
| `mark.txt` | compact recursion mark, ASCII and Unicode variants |

## the mark

Nested boxes: a program calling itself, which is the RLM trick in one glyph. The prime tick in the middle is the only accent — the one element that gets coloured.

```
+----------+
| +------+ |
| |  '   | |
| +------+ |
+----------+
```

Unicode variant, for terminals with good font coverage:

```
╭──────────╮
│ ╭──────╮ │
│ │  ′   │ │
│ ╰──────╯ │
╰──────────╯
```

## colour

| role | hex | ANSI 256 |
|---|---|---|
| primary — mark, name | `#5EEAD4` | `38;5;51` |
| accent — prime tick | `#FBBF24` | `38;5;220` |
| muted — tagline | `#94A3B8` | `38;5;245` |

```sh
printf '\033[38;5;51mre\033[0m\033[38;5;220m′\033[0m\033[38;5;51mprime\033[0m\n'
```

rules:

- the tick always takes the accent, never the body colour
- one colour per line in a terminal; no gradients
- don't stretch or reflow the mark — it is drawn on a fixed grid
- minimum widths: banner 47 columns, mark 12
- on light backgrounds switch the primary to `#0D9488`; `#5EEAD4` on white is unreadable

## spelling

- the project name is lowercase `re-prime` in prose; capitals only inside the wordmark
- the prime is `′` (U+2032) in Unicode output and `'` in ASCII output
- the tagline is lowercase and has no full stop
