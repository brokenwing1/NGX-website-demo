// Launch screen shared by the per-studio shells (build/tenant-shells.ts) and the single-file demo.
// Sequence: the logo square appears → a soft violet neon line runs once around its outline →
// the studio name fades in under it → the whole screen fades away and the app is there.
// Pure HTML/CSS (no JS animation), removed from the DOM afterwards; reduced motion gets a short fade.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface SplashOptions {
  /** URL of the square logo (an image or a data: URI). */
  logo: string;
  /** Text shown under the logo, e.g. "NGX Detailing". */
  name: string;
  background?: string;
}

export const SPLASH_TOTAL_MS = 3300;

export function splashHtml({ logo, name, background = '#050608' }: SplashOptions): string {
  const css = `
#launch{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;background:${background};font-family:Onest,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;animation:launchOut .5s ease 2.75s forwards}
#launch .l-mark{position:relative;width:96px;height:96px}
#launch .l-mark img{display:block;width:96px;height:96px;border-radius:28px;box-shadow:0 0 50px rgba(74,102,255,.28);opacity:0;transform:scale(.9);animation:launchIn .6s cubic-bezier(.2,.8,.2,1) .1s forwards}
#launch .l-mark svg{position:absolute;inset:-7px;width:110px;height:110px;overflow:visible}
#launch .l-trace{fill:none;stroke:#a26bff;stroke-width:2.5;stroke-linecap:round;stroke-dasharray:90 376;stroke-dashoffset:0;opacity:0;filter:drop-shadow(0 0 4px #9b5cff) drop-shadow(0 0 10px rgba(155,92,255,.7));animation:launchTrace 1.45s cubic-bezier(.45,0,.25,1) .55s forwards}
#launch .l-ring{fill:none;stroke:rgba(162,107,255,.16);stroke-width:1;opacity:0;animation:launchRing 1.4s ease .55s forwards}
#launch .l-name{color:#f4f5f7;font-size:22px;font-weight:650;letter-spacing:-.02em;opacity:0;transform:translateY(8px);animation:launchName .55s cubic-bezier(.2,.8,.2,1) 1.9s forwards}
@keyframes launchIn{to{opacity:1;transform:none}}
@keyframes launchTrace{0%{opacity:0;stroke-dashoffset:0}12%{opacity:.85}88%{opacity:.85}100%{opacity:0;stroke-dashoffset:-466}}
@keyframes launchRing{0%{opacity:0}40%{opacity:1}100%{opacity:.35}}
@keyframes launchName{to{opacity:1;transform:none}}
@keyframes launchOut{to{opacity:0;visibility:hidden}}
@media (prefers-reduced-motion:reduce){#launch{animation:launchOut .3s ease .9s forwards}#launch .l-mark img,#launch .l-name{animation:launchIn .2s ease forwards}#launch .l-trace,#launch .l-ring{display:none}}`;
  // rounded square path a bit outside the logo; its length ≈ 466 (matches the dash maths above)
  const svg =
    '<svg viewBox="0 0 110 110" aria-hidden="true"><rect class="l-ring" x="3" y="3" width="104" height="104" rx="31" pathLength="466"/>' +
    '<rect class="l-trace" x="3" y="3" width="104" height="104" rx="31" pathLength="466"/></svg>';
  return `<style>${css.trim()}</style>
    <div id="launch" aria-hidden="true"><div class="l-mark"><img src="${esc(logo)}" alt="" />${svg}</div><div class="l-name">${esc(name)}</div></div>
    <script>setTimeout(function(){var l=document.getElementById('launch');if(l)l.remove()},${SPLASH_TOTAL_MS})</script>`;
}
