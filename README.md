# Bonfire STACK

![Bonfire STACK running the Glass Garden demo in the DM skin, with the Strudel code docked on the right](docs/screenshot.png)

A browser modular synth rack that writes [Strudel](https://strudel.cc) code. Patch cables between
Eurorack-style modules, turn knobs, and the dock at the bottom shows the Strudel pattern being
played: the exact code. Copy it, or hit **OPEN IN STRUDEL**, and it runs unchanged on strudel.cc.

Named after *máglyarakás*, the Hungarian "bonfire stack" dessert: layers of brioche, apple and
torched meringue, a lot like layers of patterns.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # compiles every demo + module and evaluates the code with the real Strudel transpiler
npm run build      # static site in dist/ — upload anywhere, any sub-path works (base: './')
```

Handy URL switches: `#demo=acid-breakfast` opens a demo, `?skin=midnight` picks a skin,
`?nosplash` skips the welcome dialog.

## How it works

Cables carry **patterns**, not audio: a module chain compiles to a Strudel method chain.

| jack     | carries                                  | becomes                                |
|----------|------------------------------------------|----------------------------------------|
| PATTERN  | sound events                             | `s("bd ~ sd ~").lpf(800)`              |
| PITCH    | notes (also playable on their own)       | `n("0 2 4").scale("C3:minor")`         |
| RHYTHM   | structure only                           | `.struct("x ~ x x*2")`                 |
| CV       | a 0–1 signal                             | `.lpf(sine.slow(4).rangex(400, 3200))` |
| CLOCK    | step length                              | sequencer `.fast()` / `.slow()`        |

- `src/core/compile.js` walks back from OUTPUT and compiles each module once. An output that
  feeds several inputs is hoisted into a `const`. Cycles are refused when you connect.
- `src/core/engine.js` evaluates that same code with Strudel's REPL. Knob moves re-evaluate
  (debounced), and Strudel swaps patterns phase-locked, so nothing drops.
- The sample prebake mirrors strudel.cc's exactly, so every default sound name in the code exists there too.
  User packs become `samples('…')` lines. Local files are flagged in the code as not portable.
- OUTPUT's volume and mute work on the audio output, so they are deliberately **not** in the code.

## MIDI clock out (hardware sync)

Bonfire can be the master clock for a hardware synth: PLAY / STOP start and stop its sequencer or
arp, and the CLOCK knob sets its tempo (24 ticks per quarter note). Chrome / Edge only.

A tested setup, M-Vave FM-1 synth + M-Vave SMK-37 keyboard:

```
  ┌──────────────────────────────┐
  │ PC · Chrome · Bonfire STACK  │
  │ MIDI panel → Clock out       │
  │ Port: "Felucca" (the FM-1)   │
  └──────┬────────────────┬──────┘
         │ USB-C          │ USB-C (optional)
         │ clock, START,  │ knobs, pads, transport
         │ STOP, notes    │ → Bonfire MIDI learn
         ▼                ▲
  ┌──────────────┐    ┌──────────────┐
  │    FM-1      │◄───│   SMK-37     │
  │ synth, set   │3.5 │ keyboard     │
  │ to external  │ mm │ (keys play   │
  │ MIDI sync    │MIDI│  the FM-1)   │
  └──────────────┘    └──────────────┘
```

1. Plug the synth into the computer with its **own USB cable**. A keyboard's 3.5mm / DIN MIDI OUT
   only sends the keyboard's own playing: the SMK-37 does not pass computer MIDI through, so a synth
   hanging off it never sees Bonfire's clock.
2. MIDI panel → **Clock out** → pick the synth's port, press **TEST NOTE** (middle C on all 16
   channels). If the synth plays it, that's the port.
3. Set the synth to follow external / MIDI clock, press PLAY.
4. If the synth sounds ahead of or behind Bonfire, trim **Offset** (ms; positive = later).
   The port and offset are saved in this browser, not in the patch.

**Turn MIDI off in Bonfire before you plug, unplug or power-cycle MIDI gear.** Hot-plugging with
MIDI on can freeze Chrome and leave the device invisible until it is power-cycled.
Plugging in a USB synth may also make Windows switch its sound output to it (Settings → Sound).

## Writing a module

Add a definition to `src/modules/` and register it in `src/modules/index.js`:

```js
export const wobble = {
  type: 'wobble',            // id prefix: instances are wobble1, wobble2…
  name: 'WOBBLE', title: 'Wobble Thing', category: 'Shape', hp: 8,
  description: 'Shown in the module browser and the ? help.',
  params: {                  // kind: knob | rotary | fader | switch | toggle | select | sound | data
    depth: { kind: 'knob', label: 'DEPTH', min: 0, max: 1, default: 0.5 },
  },
  inputs: { in: { type: 'pattern', label: 'IN' } },
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['depth'], ['in:in', 'out:out']],   // rows; also 'widget:x', 'led:x'
  compile(ctx) {             // ctx.p = params, ctx.in(id) = upstream Expr, ctx.global.bpm
    const e = ctx.in('in');
    return { out: e && e.call('vib', ctx.p.depth) };
  },
};
```

Build code with the helpers in `src/core/expr.js` (`fn`, `mini`, `num`, `.call`, `.callIf`),
never by string concatenation. That keeps the printer's line-wrapping and hoisting working. Run
`npm test` afterwards: it evaluates every module through the real Strudel transpiler.

## Skins

Five ship in `public/skins/`. A skin is a `skin.json` plus images, and every key is optional.
The schema is in [public/skins/README.md](public/skins/README.md). Users can load their own skin from a URL or a file
(SKIN menu).

## Credits & licence

- Sound engine: [Strudel](https://codeberg.org/uzu/strudel) (AGPL-3.0). Samples are streamed from the
  strudel.cc CDN (Dirt-Samples, VCSL (CC0), tidal-drum-machines, Salamander piano (CC-BY), GM soundfonts).
- The Torched Meringue demo streams its wobble loop from Freesound: [“1 bar dubstep bass loop”](https://freesound.org/people/shitefromaheight/sounds/128254/) by shitefromaheight (CC0).
- Artwork generated with Higgsfield for this project.
- Bonfire STACK is free software under the **GNU AGPL-3.0**. See `LICENSE`.
