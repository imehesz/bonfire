// Saving and sharing patches: localStorage autosave, JSON files, URL-hash links.
const KEY = 'bonfire.patch.v1';

export function saveLocal(patch) {
  try {
    localStorage.setItem(KEY, JSON.stringify(patch));
  } catch { /* storage full or blocked — autosave is best effort */ }
}

export function loadLocal() {
  try {
    const s = localStorage.getItem(KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export function downloadPatch(patch) {
  const blob = new Blob([JSON.stringify(patch, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(patch.name || 'patch').replace(/[^\w-]+/g, '-').toLowerCase()}.bonfire.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function pickPatchFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      try {
        resolve(JSON.parse(await input.files[0].text()));
      } catch (e) {
        reject(e);
      }
    };
    input.click();
  });
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

export async function shareUrl(patch) {
  const bytes = await pipe(new TextEncoder().encode(JSON.stringify(patch)), new CompressionStream('deflate-raw'));
  return `${location.origin}${location.pathname}#p=${b64url(bytes)}`;
}

export async function patchFromHash() {
  const m = /#p=([\w-]+)/.exec(location.hash);
  if (!m) return null;
  try {
    const bytes = await pipe(unb64url(m[1]), new DecompressionStream('deflate-raw'));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export async function fetchDemo(id) {
  const r = await fetch(`demos/${id}.json`);
  if (!r.ok) throw new Error(`demo ${id} not found`);
  return r.json();
}

export async function fetchDemoIndex() {
  return (await fetch('demos/index.json')).json();
}
