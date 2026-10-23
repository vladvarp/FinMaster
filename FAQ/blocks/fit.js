(function () {
  function theme() {
    try { return localStorage.getItem("finmaster.theme") === "dark" ? "dark" : "light"; }
    catch (err) { return "light"; }
  }

  function apply() {
    document.documentElement.dataset.theme = theme();
  }

  function post() {
    let bottom = 0;
    const kids = document.body.children;
    for (let i = 0; i < kids.length; i += 1) {
      const el = kids[i];
      if (el.tagName === "SCRIPT") continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.position === "fixed") continue;
      const rect = el.getBoundingClientRect();
      const margin = parseFloat(style.marginBottom) || 0;
      bottom = Math.max(bottom, rect.bottom + window.scrollY + margin);
    }
    const pad = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
    parent.postMessage({ type: "faq-live", h: Math.ceil(bottom + pad) }, "*");
  }

  apply();
  window.addEventListener("storage", (event) => {
    if (event.key && event.key !== "finmaster.theme") return;
    apply();
    post();
  });
  if (window.ResizeObserver) new ResizeObserver(post).observe(document.body);
  window.addEventListener("load", post);
  window.addEventListener("message", (event) => {
    if (!event.data || event.data.type !== "faq-fit") return;
    post();
  });
  post();
})();
