(function () {
  const STYLE = { app: "/styles.css", mobile: "/mobile.css" };
  let appDoc = null;
  let mobileDoc = null;
  let themeIcons = null;
  let failed = false;
  let job = 0;

  function theme() {
    try { return localStorage.getItem("finmaster.theme") === "dark" ? "dark" : "light"; }
    catch (err) { return "light"; }
  }

  function extractIcons(js) {
    const fn = js.match(/function themeIcon\(theme\)\s*\{([\s\S]*?)\n {2}\}/);
    if (!fn) return null;
    const parts = [...fn[1].matchAll(/return `([\s\S]*?)`;/g)].map((item) => item[1].trim());
    if (parts.length < 2) return null;
    return { dark: parts[0], light: parts[1] };
  }

  async function loadDoc(url) {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(String(res.status));
    return new DOMParser().parseFromString(await res.text(), "text/html");
  }

  function paintTheme(node) {
    const svg = themeIcons && themeIcons[theme()];
    if (!svg) return;
    const buttons = [];
    if (node.classList && node.classList.contains("js-theme-toggle")) buttons.push(node);
    if (node.querySelectorAll) node.querySelectorAll(".js-theme-toggle").forEach((btn) => buttons.push(btn));
    const title = theme() === "dark" ? "Включить светлую тему" : "Включить тёмную тему";
    buttons.forEach((btn) => {
      btn.innerHTML = svg;
      btn.title = title;
      btn.setAttribute("aria-label", title);
      btn.setAttribute("aria-pressed", theme() === "dark" ? "true" : "false");
    });
  }

  function clean(node) {
    [node, ...node.querySelectorAll("*")].forEach((el) => {
      [...el.attributes].forEach((attr) => {
        if (attr.name.toLowerCase().startsWith("on")) el.removeAttribute(attr.name);
      });
    });
    node.querySelectorAll("script, iframe").forEach((el) => el.remove());
    if (node.hasAttribute("hidden")) node.removeAttribute("hidden");
    paintTheme(node);
    return node;
  }

  function present(el) {
    const clone = clean(el.cloneNode(true));
    const parent = el.parentElement;
    if (parent && parent.classList.contains("nav") && !clone.classList.contains("nav")) {
      const wrap = document.createElement("div");
      wrap.className = "nav";
      wrap.appendChild(clone);
      return wrap;
    }
    if (el.classList.contains("start-hero") || el.classList.contains("start-inner")) {
      const wrap = document.createElement("div");
      wrap.className = "start";
      wrap.appendChild(clone);
      return wrap;
    }
    return clone;
  }

  const FRAME_JS = `
    function post() {
      var h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      parent.postMessage({ type: "faq-live", h: h }, "*");
    }
    document.addEventListener("click", function (event) {
      var el = event.target.closest && event.target.closest("button, a");
      if (el) event.preventDefault();
    }, true);
    if (window.ResizeObserver) new ResizeObserver(post).observe(document.body);
    window.addEventListener("load", post);
    post();
  `;

  function srcdoc(nodes, css, row) {
    const doc = document.implementation.createHTMLDocument("");
    doc.documentElement.lang = "ru";
    doc.documentElement.dataset.theme = theme();
    const appCss = doc.createElement("link");
    appCss.rel = "stylesheet";
    appCss.href = css;
    const frameCss = doc.createElement("link");
    frameCss.rel = "stylesheet";
    frameCss.href = "/faq/blocks/stage.css";
    doc.head.append(appCss, frameCss);
    const stage = doc.createElement("div");
    stage.className = row ? "stage is-row" : "stage";
    nodes.forEach((node) => stage.appendChild(doc.importNode(node, true)));
    doc.body.appendChild(stage);
    const script = doc.createElement("script");
    script.textContent = FRAME_JS;
    doc.body.appendChild(script);
    return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
  }

  function bind(frame) {
    const fit = (h) => { frame.style.height = Math.max(44, Math.ceil(h)) + "px"; };
    frame.addEventListener("load", () => {
      try { fit(frame.contentDocument.documentElement.scrollHeight); } catch (err) { /* высота придёт сообщением */ }
    });
  }

  window.addEventListener("message", (event) => {
    if (!event.data || event.data.type !== "faq-live") return;
    const frame = [...document.querySelectorAll("iframe.live-frame")].find((item) => item.contentWindow === event.source);
    if (frame) frame.style.height = Math.max(44, Math.ceil(event.data.h)) + "px";
  });

  function offline(host) {
    host.innerHTML = "<p class=\"live-off\">Рисунок появится, когда справка открыта из программы: блок берётся из окна FinMaster и меняется вместе со стилем.</p>";
  }

  async function ensure() {
    if (failed) return false;
    if (appDoc) return true;
    try {
      appDoc = await loadDoc("/");
      try {
        const js = await (await fetch("/app.js", { credentials: "same-origin" })).text();
        themeIcons = extractIcons(js);
      } catch (err) { themeIcons = null; }
      return true;
    } catch (err) {
      failed = true;
      return false;
    }
  }

  async function mount(root, selectorsOnly) {
    if (!root) return;
    const hosts = [...root.querySelectorAll(selectorsOnly ? "[data-sel]" : "[data-sel], [data-block]")];
    if (!hosts.length) return;
    const token = ++job;
    const ok = await ensure();
    if (token !== job) return;
    if (!ok) {
      hosts.forEach(offline);
      return;
    }
    if (hosts.some((host) => host.dataset.doc === "mobile") && !mobileDoc) {
      try { mobileDoc = await loadDoc("/mobile.html"); }
      catch (err) { mobileDoc = null; }
    }
    if (token !== job) return;
    hosts.forEach((host) => {
      const frame = document.createElement("iframe");
      frame.className = "live-frame";
      frame.title = host.getAttribute("aria-label") || "Элемент FinMaster";
      if (host.dataset.width) frame.style.maxWidth = host.dataset.width + "px";
      if (host.dataset.block) {
        frame.src = "blocks/" + encodeURIComponent(host.dataset.block) + ".html";
        host.textContent = "";
        host.appendChild(frame);
        bind(frame);
        return;
      }
      const source = host.dataset.doc === "mobile" ? mobileDoc : appDoc;
      if (!source) { offline(host); return; }
      let found = [];
      try { found = [...source.querySelectorAll(host.dataset.sel)]; }
      catch (err) { found = []; }
      if (!found.length) {
        host.innerHTML = "<p class=\"live-off\">Элемент не найден в окне программы.</p>";
        return;
      }
      frame.srcdoc = srcdoc(found.map(present), host.dataset.doc === "mobile" ? STYLE.mobile : STYLE.app, host.dataset.flow === "row");
      host.textContent = "";
      host.appendChild(frame);
      bind(frame);
    });
  }

  window.FAQLive = { mount };
})();
