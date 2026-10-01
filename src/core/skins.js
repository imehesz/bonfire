// Skin loader. A skin is skins/<id>/skin.json plus its images; every key is
// optional and falls back to the built-in look. Applying a skin only rewrites
// CSS custom properties + one <style> block — no DOM rebuild.
// Schema: public/skins/README.md
import { setCablePalette } from './store.js';

const KEY = 'bonfire.skin';
let current = null;
const listeners = new Set();
export const onSkin = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const currentSkin = () => current;

const COLOR_VARS = {
  background: '--bg', rack: '--rack', rail: '--rail', railShadow: '--rail-shadow', panel: '--panel', panelEdge: '--panel-edge',
  panelText: '--panel-text', panelTextDim: '--panel-dim', accent: '--accent', led: '--led', ledOff: '--led-off',
  knob: '--knob', knobRing: '--knob-ring', knobPointer: '--knob-pointer', jackNut: '--jack-nut', jackHole: '--jack-hole',
  display: '--display', displayText: '--display-text', button: '--button', buttonText: '--button-text',
  ui: '--ui', uiRaised: '--ui-raised', uiText: '--ui-text', uiDim: '--ui-dim', uiBorder: '--ui-border',
  code: '--code', codeText: '--code-text', codeString: '--code-string', codeNumber: '--code-number',
  codeMethod: '--code-method', codeComment: '--code-comment', scope: '--scope', scopeLine: '--scope-line',
};

export async function fetchSkinIndex() {
  return (await fetch('skins/index.json')).json();
}

// Always absolute: a relative url() inside a CSS variable resolves against the
// stylesheet that USES the variable (assets/*.css in a build), not the page.
const resolveUrl = (base, path) => {
  if (!path) return null;
  if (/^(data:|blob:)/.test(path)) return path;
  return new URL(path, new URL(base || './', document.baseURI)).href;
};

function loadFonts(google = []) {
  document.getElementById('skin-fonts')?.remove();
  if (!google.length) return;
  const link = document.createElement('link');
  link.id = 'skin-fonts';
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${google.map((f) => `family=${f.replace(/ /g, '+')}`).join('&')}&display=swap`;
  document.head.appendChild(link);
}

export function applySkin(skin, base = '') {
  const c = skin.colors ?? {};
  const img = skin.images ?? {};
  const f = skin.fonts ?? {};
  const panel = skin.panel ?? {};
  const cables = skin.cables ?? {};
  const vars = [];
  for (const [k, v] of Object.entries(COLOR_VARS)) if (c[k]) vars.push(`${v}:${c[k]}`);
  for (const [t, v] of Object.entries(c.jack ?? {})) vars.push(`--jack-${t}:${v}`);
  const url = (p) => (p ? `url("${resolveUrl(base, p)}")` : 'none');
  vars.push(`--img-backdrop:${url(img.backdrop)}`, `--img-panel:${url(img.panel)}`, `--img-knob:${url(img.knob)}`,
    `--img-rail:${url(img.rail)}`, `--img-screw:${url(img.screw)}`);
  if (img.panel) vars.push(`--panel-texture-opacity:${panel.textureOpacity ?? 0.5}`);
  if (panel.textureSize) vars.push(`--panel-texture-size:${panel.textureSize}`);
  if (panel.radius != null) vars.push(`--panel-radius:${panel.radius}px`);
  if (panel.blend) vars.push(`--panel-blend:${panel.blend}`);
  if (img.knob) vars.push('--knob-vector:0');
  if (f.panel) vars.push(`--font-panel:${f.panel}`);
  if (f.display) vars.push(`--font-display:${f.display}`);
  if (f.ui) vars.push(`--font-ui:${f.ui}`);
  if (f.code) vars.push(`--font-code:${f.code}`);
  if (cables.thickness) vars.push(`--cable-width:${cables.thickness}px`);
  if (cables.opacity) vars.push(`--cable-opacity:${cables.opacity}`);
  if (skin.backdropDim != null) vars.push(`--backdrop-dim:${skin.backdropDim}`);

  let css = `:root{${vars.join(';')}}`;
  for (const [type, o] of Object.entries(skin.modules ?? {})) {
    const mv = Object.entries(o).filter(([k]) => COLOR_VARS[k]).map(([k, v]) => `${COLOR_VARS[k]}:${v}`);
    if (o.image) mv.push(`--img-panel:${url(o.image)}`);
    css += `.module[data-type="${type}"]{${mv.join(';')}}`;
  }
  if (skin.css) css += skin.css; // free-form escape hatch for power users

  let style = document.getElementById('skin-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'skin-style';
    document.head.appendChild(style);
  }
  style.textContent = css;
  loadFonts(f.google);
  document.documentElement.dataset.skin = skin.id ?? 'custom';
  setCablePalette(cables.colors);
  current = { ...skin, base };
  cableSag = cables.sag ?? 1;
  listeners.forEach((fn) => fn(current));
}

let cableSag = 1;
export const skinCableSag = () => cableSag;

export async function loadSkinFromUrl(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`skin not found (${r.status})`);
  const skin = await r.json();
  applySkin(skin, url.slice(0, url.lastIndexOf('/') + 1));
  return skin;
}

export async function useSkin(id) {
  const skin = await loadSkinFromUrl(`skins/${id}/skin.json`);
  try {
    localStorage.setItem(KEY, JSON.stringify({ id }));
  } catch { /* ignore */ }
  return skin;
}

export async function useCustomSkin(source) {
  let skin;
  if (typeof source === 'string') skin = await loadSkinFromUrl(source);
  else {
    skin = JSON.parse(await source.text());
    applySkin(skin, '');
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(typeof source === 'string' ? { url: source } : { inline: skin }));
  } catch { /* ignore */ }
  return skin;
}

export async function restoreSkin(fallback = 'bonfire') {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY));
  } catch { /* ignore */ }
  try {
    if (saved?.url) return await loadSkinFromUrl(saved.url);
    if (saved?.inline) return applySkin(saved.inline, '');
    return await useSkin(saved?.id ?? fallback);
  } catch {
    return useSkin(fallback);
  }
}
