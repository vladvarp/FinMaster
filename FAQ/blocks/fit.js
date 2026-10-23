(function () {
  function theme() {
    try { return localStorage.getItem("finmaster.theme") === "dark" ? "dark" : "light"; }
    catch (err) { return "light"; }
  }

  function apply() {
    document.documentElement.dataset.theme = theme();
  }

  function post() {
    const h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    parent.postMessage({ type: "faq-live", h: h }, "*");
  }

  apply();
  window.addEventListener("storage", (event) => {
    if (event.key && event.key !== "finmaster.theme") return;
    apply();
    post();
  });
  if (window.ResizeObserver) new ResizeObserver(post).observe(document.body);
  window.addEventListener("load", post);
  post();
})();
