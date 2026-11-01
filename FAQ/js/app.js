(function () {
  const toc = window.FAQ_TOC || [];
  const nav = document.getElementById("nav");
  const doc = document.getElementById("doc");
  const search = document.getElementById("search");
  const shell = document.querySelector(".shell");
  const menuBtn = document.getElementById("menu");
  const here = document.getElementById("here");
  const trail = document.getElementById("trail");
  const themeToggle = document.getElementById("theme-toggle");
  const backButton = document.getElementById("nav-back");
  const forwardButton = document.getElementById("nav-forward");
  const flat = toc.flatMap((group) => group.items.map((item) => ({ ...item, group: group.title })));
  let indexPromise = null;
  let pending = null;
  let loadToken = 0;
  let loadedId = "";
  let routeHistory = [];
  let routeCursor = -1;
  let lastRoute = "";

  function programTheme() {
    const web = document.documentElement.dataset.faqMode === "web";
    try { return localStorage.getItem("finmaster.theme") || (web ? "dark" : "light"); }
    catch (err) { return web ? "dark" : "light"; }
  }

  function paintThemeControl() {
    const dark = document.documentElement.dataset.theme === "dark";
    const icon = themeToggle?.querySelector(".theme-icon");
    const label = themeToggle?.querySelector(".theme-label");
    if (icon) icon.textContent = dark ? "☼" : "☾";
    if (label) label.textContent = dark ? "Светлая тема" : "Тёмная тема";
    themeToggle?.setAttribute("aria-pressed", dark ? "true" : "false");
    themeToggle?.setAttribute("title", dark ? "Переключить на светлую тему" : "Переключить на тёмную тему");
  }

  function applyTheme(value) {
    const next = value === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("finmaster.theme", next);
    } catch (err) { /* тема действует до закрытия страницы */ }
    paintThemeControl();
    if (window.FAQLive) window.FAQLive.mount(doc);
  }

  document.documentElement.dataset.theme = programTheme();
  paintThemeControl();
  themeToggle?.addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  window.addEventListener("storage", (event) => {
    if (event.key && event.key !== "finmaster.theme") return;
    document.documentElement.dataset.theme = programTheme();
    paintThemeControl();
    if (window.FAQLive) window.FAQLive.mount(doc);
  });

  function updateRouteButtons() {
    if (backButton) backButton.disabled = routeCursor <= 0;
    if (forwardButton) forwardButton.disabled = routeCursor < 0 || routeCursor >= routeHistory.length - 1;
  }

  function trackRoute() {
    const route = location.hash || "#about";
    if (route === lastRoute) return;
    if (routeCursor > 0 && routeHistory[routeCursor - 1] === route) routeCursor -= 1;
    else if (routeCursor < routeHistory.length - 1 && routeHistory[routeCursor + 1] === route) routeCursor += 1;
    else {
      routeHistory = routeHistory.slice(0, routeCursor + 1);
      routeHistory.push(route);
      routeCursor = routeHistory.length - 1;
    }
    lastRoute = route;
    updateRouteButtons();
  }

  backButton?.addEventListener("click", () => {
    if (routeCursor > 0) location.hash = routeHistory[routeCursor - 1];
  });
  forwardButton?.addEventListener("click", () => {
    if (routeCursor < routeHistory.length - 1) location.hash = routeHistory[routeCursor + 1];
  });

  menuBtn.addEventListener("click", () => {
    if (window.matchMedia("(min-width: 861px)").matches) {
      setSideCollapsed(false);
      return;
    }
    shell.classList.toggle("nav-open");
  });
  document.getElementById("side-collapse").addEventListener("click", () => setSideCollapsed(true));

  function setSideCollapsed(collapsed) {
    try { localStorage.setItem("finmaster.faq.side", collapsed ? "0" : "1"); }
    catch (err) { /* окно без хранилища просто сворачивает панель до перезагрузки */ }
    applySide();
  }

  function applySide() {
    const wide = window.matchMedia("(min-width: 861px)").matches;
    let collapsed = false;
    try { collapsed = localStorage.getItem("finmaster.faq.side") === "0"; }
    catch (err) { collapsed = false; }
    shell.classList.toggle("side-collapsed", wide && collapsed);
    if (!wide) shell.classList.remove("side-collapsed");
    const open = !wide || !collapsed;
    menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    document.getElementById("side-collapse").setAttribute("aria-expanded", open ? "true" : "false");
  }

  applySide();
  window.addEventListener("resize", applySide);

  function warm() {
    if (indexPromise) return indexPromise;
    indexPromise = Promise.all(flat.map(async (item) => {
      const res = await fetch("topics/" + item.id + ".html");
      if (!res.ok) return { ...item, headings: [], text: "" };
      const html = await res.text();
      const parsed = new DOMParser().parseFromString(html, "text/html");
      const headings = [...parsed.querySelectorAll("h2, h3")].map((head) => ({
        text: head.textContent.trim(),
        sub: head.closest("[data-sub]")?.getAttribute("data-sub") || "",
      }));
      const text = (parsed.body.textContent || "").replace(/\s+/g, " ").trim();
      return { ...item, headings, text };
    }));
    return indexPromise;
  }

  function parseQuery(raw) {
    const phrases = [];
    const rest = String(raw || "").replace(/"([^"]+)"/g, (_, phrase) => {
      phrases.push(phrase.trim().toLowerCase());
      return " ";
    });
    const words = [];
    const exclude = [];
    rest.split(/\s+/).filter(Boolean).forEach((part) => {
      const low = part.toLowerCase();
      if (low.startsWith("-") && low.length > 1) exclude.push(low.slice(1));
      else words.push(low);
    });
    return { words, phrases, exclude };
  }

  function covers(hay, words, phrases) {
    const text = hay.toLowerCase();
    return words.every((word) => text.includes(word)) && phrases.every((phrase) => text.includes(phrase));
  }

  function plural(n, one, few, many) {
    const n10 = n % 10;
    const n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return one;
    if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
    return many;
  }

  function snippet(text, needles) {
    const low = text.toLowerCase();
    let at = -1;
    needles.forEach((needle) => {
      const i = low.indexOf(needle);
      if (i >= 0 && (at < 0 || i < at)) at = i;
    });
    if (at < 0) return text.slice(0, 110);
    const start = Math.max(0, at - 36);
    const end = Math.min(text.length, at + 90);
    return (start ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
  }

  function hashParts() {
    const raw = decodeURIComponent((location.hash || "#about").slice(1));
    const [id, sub] = raw.split("/");
    return { id: flat.some((item) => item.id === id) ? id : "about", sub: sub || "" };
  }

  function currentId() {
    return hashParts().id;
  }

  function currentSub() {
    const { id, sub } = hashParts();
    const item = flat.find((row) => row.id === id);
    const subs = item?.subs || [];
    if (subs.some((row) => row.id === sub)) return sub;
    return subs[0]?.id || "";
  }

  function renderNav(active) {
    const sub = currentSub();
    nav.innerHTML = "";
    toc.forEach((group) => {
      const box = document.createElement("section");
      box.className = "group";
      const title = document.createElement("h2");
      title.textContent = group.title;
      box.appendChild(title);
      group.items.forEach((item) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "nav-btn" + (item.id === active ? " active" : "");
        btn.textContent = item.title;
        btn.addEventListener("click", () => {
          const first = item.subs?.[0]?.id;
          location.hash = first ? item.id + "/" + first : item.id;
          shell.classList.remove("nav-open");
        });
        box.appendChild(btn);
        (item.subs || []).forEach((child) => {
          const childBtn = document.createElement("button");
          childBtn.type = "button";
          childBtn.className = "nav-sub" + (item.id === active && child.id === sub ? " active" : "");
          childBtn.textContent = child.title;
          childBtn.addEventListener("click", () => {
            location.hash = item.id + "/" + child.id;
            shell.classList.remove("nav-open");
          });
          box.appendChild(childBtn);
        });
      });
      nav.appendChild(box);
    });
  }

  function markText(node, re) {
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    const value = node.nodeValue;
    value.replace(re, (found, index) => {
      frag.appendChild(document.createTextNode(value.slice(last, index)));
      const mark = document.createElement("mark");
      mark.className = "hit";
      mark.textContent = found;
      frag.appendChild(mark);
      last = index + found.length;
      return found;
    });
    frag.appendChild(document.createTextNode(value.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }

  function highlight(root, needles) {
    const list = needles.filter((item) => item && item.length > 1);
    if (!list.length) return;
    const re = new RegExp(list.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || parent.closest("iframe, script, style, .live, mark")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      re.lastIndex = 0;
      if (re.test(node.nodeValue)) markText(node, re);
    });
  }

  async function showHits(parsed) {
    const rows = await warm();
    if ((search.value || "").trim() !== search.dataset.q) return;
    const needles = parsed.words.concat(parsed.phrases);
    const hits = rows.map((item) => {
      const hay = item.title + " " + item.group + " " + (item.keys || "") + " " + item.headings.map((head) => head.text).join(" ") + " " + item.text;
      if (parsed.exclude.some((word) => hay.toLowerCase().includes(word))) return null;
      if (!covers(hay, parsed.words, parsed.phrases)) return null;
      let score = 1;
      parsed.words.forEach((word) => { if (item.title.toLowerCase().includes(word)) score += 40; });
      parsed.phrases.forEach((phrase) => { if (item.title.toLowerCase().includes(phrase)) score += 50; });
      const found = item.headings.find((head) => covers(head.text, parsed.words, parsed.phrases)) || null;
      if (found) score += 25;
      if (covers(item.keys || "", parsed.words, parsed.phrases)) score += 10;
      return { item, score, heading: found?.text || "", sub: found?.sub || "", snippet: snippet(item.text, needles) };
    }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 24);

    nav.innerHTML = "";
    const count = document.createElement("p");
    count.className = "hit-count";
    count.textContent = hits.length
      ? hits.length + " " + plural(hits.length, "совпадение", "совпадения", "совпадений")
      : "Ничего не нашлось. Несколько слов ищутся вместе, фраза — в кавычках, -слово исключает.";
    nav.appendChild(count);
    hits.forEach((hit, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hit-btn";
      const title = document.createElement("b");
      title.textContent = hit.item.title;
      const group = document.createElement("small");
      group.textContent = hit.item.group + (hit.heading ? " · " + hit.heading : "");
      const text = document.createElement("p");
      text.textContent = hit.snippet;
      btn.append(title, group, text);
      btn.addEventListener("click", () => {
        const target = hit.item.id + (hit.sub ? "/" + hit.sub : "");
        pending = { id: hit.item.id, sub: hit.sub || "", words: parsed.words, phrases: parsed.phrases, heading: hit.heading };
        shell.classList.remove("nav-open");
        if ((location.hash || "").slice(1) === target) load(hit.item.id);
        else location.hash = target;
      });
      btn.addEventListener("keydown", (event) => moveHit(event, index));
      nav.appendChild(btn);
    });
  }

  function moveHit(event, index) {
    const buttons = [...nav.querySelectorAll(".hit-btn")];
    if (event.key === "ArrowDown") {
      event.preventDefault();
      buttons[Math.min(buttons.length - 1, index + 1)]?.focus();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (index === 0) search.focus();
      else buttons[index - 1]?.focus();
    }
  }

  function showSub() {
    const sections = [...doc.querySelectorAll("[data-sub]")];
    if (!sections.length) return;
    const sub = currentSub();
    sections.forEach((el) => { el.hidden = el.dataset.sub !== sub; });
  }

  function visibleRoot() {
    const open = [...doc.querySelectorAll("[data-sub]")].find((el) => !el.hidden);
    return open || doc;
  }

  function fillTrail() {
    if (!trail) return;
    trail.innerHTML = "";
    const route = hashParts();
    const item = flat.find((entry) => entry.id === route.id);
    const activeSub = currentSub();
    const sub = item?.subs?.find((entry) => entry.id === activeSub);
    const add = (label, href, current) => {
      if (trail.childNodes.length) {
        const sep = document.createElement("span");
        sep.className = "trail-sep";
        sep.textContent = "›";
        trail.appendChild(sep);
      }
      if (current || !href) {
        const span = document.createElement("span");
        span.className = current ? "trail-current" : "trail-group";
        span.textContent = label;
        trail.appendChild(span);
      } else {
        const link = document.createElement("a");
        link.href = href;
        link.textContent = label;
        trail.appendChild(link);
      }
    };
    add("Справка", "#about", route.id === "about" && !sub);
    if (item) {
      add(item.group, null, false);
      if (sub) {
        add(item.title, "#" + item.id, false);
        add(sub.title, "", true);
      } else add(item.title, "", true);
    }
  }

  function fillLinkMap() {
    const root = visibleRoot();
    root.querySelector(".link-map")?.remove();
    const targets = new Map();
    root.querySelectorAll('a[href^="#"]').forEach((link) => {
      const raw = decodeURIComponent(link.getAttribute("href").slice(1));
      const [id, subId] = raw.split("/");
      const item = flat.find((entry) => entry.id === id);
      if (!item) return;
      const sub = item.subs?.find((entry) => entry.id === subId);
      const target = id + (sub ? "/" + sub.id : "");
      if (!targets.has(target)) targets.set(target, { item, sub, target });
    });
    if (!targets.size) return;
    const details = document.createElement("details");
    details.className = "link-map";
    const summary = document.createElement("summary");
    summary.textContent = "Карта переходов по связанным разделам";
    details.appendChild(summary);
    const body = document.createElement("div");
    body.className = "link-map-body";
    const groups = new Map();
    [...targets.values()].forEach((entry) => {
      if (!groups.has(entry.item.group)) groups.set(entry.item.group, []);
      groups.get(entry.item.group).push(entry);
    });
    groups.forEach((entries, groupName) => {
      const section = document.createElement("section");
      section.className = "link-map-group";
      const heading = document.createElement("strong");
      heading.textContent = groupName;
      const links = document.createElement("div");
      links.className = "link-map-links";
      entries.forEach((entry) => {
        const link = document.createElement("a");
        link.href = "#" + entry.target;
        link.textContent = entry.sub ? entry.item.title + " · " + entry.sub.title : entry.item.title;
        links.appendChild(link);
      });
      section.append(heading, links);
      body.appendChild(section);
    });
    details.appendChild(body);
    root.appendChild(details);
  }

  function fillHere() {
    const heads = [...visibleRoot().querySelectorAll("h2, h3")];
    if (!heads.length) {
      here.hidden = true;
      fillTrail();
      fillLinkMap();
      return;
    }
    here.hidden = false;
    here.innerHTML = "<strong>В этом подразделе</strong>";
    const stamp = currentId() + (currentSub() ? "/" + currentSub() : "");
    heads.forEach((head, index) => {
      if (!head.id) head.id = "s" + index;
      const link = document.createElement("a");
      link.href = "#" + stamp;
      link.textContent = head.textContent;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        head.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      here.appendChild(link);
    });
    fillTrail();
    fillLinkMap();
  }

  async function load(id) {
    const token = ++loadToken;
    if (!(search.value || "").trim()) renderNav(id);
    doc.innerHTML = "<p class=\"lead\">Открываю раздел…</p>";
    here.hidden = true;
    try {
      const res = await fetch("topics/" + id + ".html");
      if (!res.ok) throw new Error(String(res.status));
      if (token !== loadToken) return;
      const html = await res.text();
      if (document.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const transition = document.startViewTransition(() => { doc.innerHTML = html; });
        await transition.finished.catch(() => {});
      } else doc.innerHTML = html;
      document.title = (doc.querySelector("h1")?.textContent || "Справка") + " — FinMaster";
      loadedId = id;
      showSub();
      if (window.FAQLive) await window.FAQLive.mount(visibleRoot());
      if (token !== loadToken) return;
      const jump = pending && pending.id === id ? pending : null;
      pending = null;
      if (jump) highlight(doc, jump.words.concat(jump.phrases));
      fillHere();
      if (!(search.value || "").trim()) renderNav(id);
      const root = visibleRoot();
      if (jump && jump.heading) {
        const head = [...root.querySelectorAll("h2, h3")].find((item) => item.textContent.trim() === jump.heading);
        (head || doc.querySelector("mark.hit"))?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (jump) {
        doc.querySelector("mark.hit")?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else window.scrollTo(0, 0);
    } catch (err) {
      if (token !== loadToken) return;
      doc.innerHTML = "<h1>Раздел не открылся</h1><p>Проверьте, что рядом с этой страницей лежит папка <code>topics</code>. Справка рассчитана на обычные ссылки: и из окна программы, и с сайта репозитория.</p>";
    }
  }

  function onSearch() {
    const raw = (search.value || "").trim();
    search.dataset.q = raw;
    if (!raw) {
      renderNav(currentId());
      return;
    }
    const parsed = parseQuery(raw);
    if (!parsed.words.length && !parsed.phrases.length) {
      renderNav(currentId());
      return;
    }
    nav.innerHTML = "";
    const wait = document.createElement("p");
    wait.className = "hit-count";
    wait.textContent = "Ищу по тексту разделов…";
    nav.appendChild(wait);
    showHits(parsed);
  }

  search.addEventListener("input", onSearch);
  search.addEventListener("keydown", (event) => {
    const buttons = [...nav.querySelectorAll(".hit-btn")];
    if (event.key === "ArrowDown" && buttons.length) {
      event.preventDefault();
      buttons[0].focus();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (buttons.length) buttons[0].click();
    }
    if (event.key === "Escape") {
      search.value = "";
      onSearch();
    }
  });

  window.addEventListener("hashchange", () => {
    trackRoute();
    const id = currentId();
    if (loadedId === id && doc.querySelector("[data-sub]")) {
      const updateSub = () => { showSub(); fillHere(); };
      if (document.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        document.startViewTransition(updateSub);
      } else updateSub();
      if (!(search.value || "").trim()) renderNav(id);
      const root = visibleRoot();
      if (window.FAQLive && [...root.querySelectorAll(".live")].some((host) => !host.querySelector("iframe"))) {
        window.FAQLive.mount(root);
      }
      window.scrollTo(0, 0);
      return;
    }
    load(id);
  });
  if (!location.hash) history.replaceState(null, "", "#about");
  trackRoute();
  warm();
  load(currentId());
})();
