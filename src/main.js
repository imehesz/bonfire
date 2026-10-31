// Picks the shell: the phone layout (src/mobile/) or the desktop rack (desktop.js).
// ?mobile / ?desktop force one; otherwise a narrow touch screen gets the phone layout.
const q = new URLSearchParams(location.search);
const phone = q.has('mobile') || (!q.has('desktop') && matchMedia('(max-width: 820px) and (pointer: coarse)').matches);

if (phone) import('./mobile/app.js');
else import('./desktop.js');
