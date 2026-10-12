// Shared setup helpers (setup only; each composition's single paused timeline drives everything).
// 1) split each .split .row into per-word masks, keeping <i> as italic words.
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
document.querySelectorAll(".split .row").forEach((row) => {
  const out = [];
  row.childNodes.forEach((n) => {
    const cls = n.nodeType === 1 ? (n.tagName === "I" ? "it" : n.className) : "";
    n.textContent.split(/(\s+)/).forEach((w) => {
      if (!w) return;
      out.push(/^\s+$/.test(w) ? " " : `<span class="mask" style="display:inline-block"><span class="${cls}">${esc(w)}</span></span>`);
    });
  });
  row.innerHTML = out.join("").trim();
  row.style.display = "block";
});
// 2) build browser windows around REAL full-page captures. The app's top bar is sticky, so it is pinned
//    (with the data-source chip) while the page scrolls underneath, exactly as in the running app.
//    <div class="app" data-src="a.png,b.png" data-s="0.84" data-x0="0" data-w="1280" data-h="600" [data-dpr="2"] [data-tbh="56"]>
document.querySelectorAll(".app").forEach((app) => {
  const d = app.dataset, s = +d.s, x0 = +(d.x0 ?? 0), w = +(d.w ?? 1280), h = +d.h, tbh = +(d.tbh ?? 56), pw = +(d.pw ?? 1280);
  app.style.width = `${w * s}px`; app.style.height = `${h * s}px`;
  app.innerHTML = d.src.split(",").map((src, i) => `
    <div class="layer L${i}" style="position:absolute;inset:0;${i ? "visibility:hidden;opacity:0" : ""}">
      <div class="vp" style="top:${tbh * s}px;width:${w * s}px;height:${(h - tbh) * s}px"><img class="pg" src="${src}" alt="" style="width:${pw * s}px;left:${-x0 * s}px;top:${-tbh * s}px" /></div>
      <div class="tb" style="top:0;width:${w * s}px;height:${tbh * s}px"><img src="${src}" alt="" style="width:${pw * s}px;left:${-x0 * s}px;top:0" /></div>
    </div>`).join("");
});
