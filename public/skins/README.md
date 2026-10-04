# Bonfire STACK skin format

A skin is one folder: `skin.json` plus any images it points to. Image paths are relative to
the `skin.json`, unless they are full `https://` or `data:` URLs. **Every key is optional.**
Anything you leave out falls back to the built-in look, so a skin can be three lines long.

Load your own from the **SKIN ▾** menu, either by URL (images load relative to that URL) or by local file
(use absolute or `data:` image URLs then). To ship one with the app, add a folder here and an
entry to `index.json`.

```jsonc
{
  "id": "my-skin",
  "name": "My Skin",
  "author": "you",
  "version": 1,
  "description": "One line for humans.",

  "fonts": {
    "panel": "'Rajdhani', sans-serif",       // module labels / names
    "display": "'Share Tech Mono', monospace", // LCDs, readouts
    "ui": "'Barlow', sans-serif",             // menus, drawers
    "code": "'JetBrains Mono', monospace",     // code dock
    "google": ["Rajdhani:wght@500;700"]       // Google Fonts families to load
  },

  "colors": {
    "background": "#120c08", "rack": "#1d140e", "rail": "#9b8b76", "railShadow": "rgba(0,0,0,.5)",
    "panel": "#efe3cc", "panelEdge": "rgba(0,0,0,.35)", "panelText": "#4a2a14", "panelTextDim": "#8a6a4a",
    "accent": "#f28c28", "led": "#ff6a1a", "ledOff": "#3a2414",
    "knob": "#7a4a22", "knobRing": "#c9a35a", "knobPointer": "#fff3d6",
    "jackNut": "#cfc6b6", "jackHole": "#0c0806",
    "display": "#1a0f08", "displayText": "#ffb347",
    "ui": "#1b120c", "uiRaised": "#261a12", "uiText": "#f5e6cc", "uiDim": "#a08a6c", "uiBorder": "#3d2b1d",
    "code": "#120b07", "codeText": "#f1e2c8", "codeString": "#ffb347", "codeNumber": "#7fd1c7",
    "codeMethod": "#f28c28", "codeComment": "#7a6650",
    "scope": "#140a05", "scopeLine": "#ffb347",
    "jack": { "pattern": "#f28c28", "rhythm": "#e8483b", "pitch": "#5bc864", "cv": "#2ec4d6", "clock": "#f2c230" }
  },

  "images": {
    "backdrop": "backdrop.jpg",  // behind the rack (cover)
    "panel": "panel.jpg",        // faceplate texture, tiled — make it seamless
    "knob": "knob.png",          // knob cap seen from above, transparent corners; it rotates
    "rail": "rail.png",          // rack rail strip, repeats horizontally
    "screw": "screw.png"         // panel screw head
  },

  "panel": {
    "textureOpacity": 0.4,       // how strongly the texture shows through the panel colour
    "textureSize": "320px",      // tile size
    "blend": "multiply",         // any CSS mix-blend-mode
    "radius": 2                  // corner radius in px
  },

  "cables": {
    "colors": ["#2ec4d6", "#e8483b", "#f2c230"], // cycled per new cable
    "thickness": 5, "sag": 1.0, "opacity": 0.94   // sag: 0 = taut, 1.5 = droopy
  },

  "backdropDim": 0.25,           // darken the backdrop (0–1)

  // Per-module overrides, keyed by module type (clock, seq, beats, euclid, melody, arp, voice,
  // sampler, vandal, filter, fx, lfo, mixer, output). Any colour key above, plus "image".
  "modules": {
    "output": { "panel": "#f3e6c8", "panelText": "#9e1b1b", "image": "output-panel.jpg" }
  },

  // Escape hatch: raw CSS appended after everything else.
  "css": ".cable .c-main { filter: drop-shadow(0 0 4px var(--c)); }"
}
```

Tips

- Knob images: a square PNG with the cap filling it edge to edge and transparent corners. It
  rotates, so leave out any pointer line, because the app draws one in `knobPointer`.
- Panel textures: tile them. If the source isn't seamless, mirror it 2×2 first.
- Keep images small: 512 px textures and 256 px knobs are plenty.
