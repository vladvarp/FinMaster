(function () {
  const toc = window.FAQ_TOC || [];
  const nav = document.getElementById("nav");
  const doc = document.getElementById("doc");
  const search = document.getElementById("search");
  const shell = document.querySelector(".shell");
  const menuBtn = document.getElementById("menu");
  const here = document.getElementById("here");
  const flat = toc.flatMap((group) => group.items.map((item) => ({ ...item, group: group.title })));
  let indexPromise = null;
  let pending = null;
  let loadToken = 0;

  function programTheme() {
    try { return localStorage.getItem("finmaster.theme") === "dark" ? "dark" : "light"; }
    catch (err) { return "light"; }
  }

  document.documentElement.dataset.theme = programTheme();
  window.addEventListener("storage", (event) => {
    if (event.key && event.key !== "finmaster.theme") return;
    document.documentElement.dataset.theme = programTheme();
    if (window.FAQLive) window.FAQLive.mount(doc, true);
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
      const headings = [...parsed.querySelectorAll("h2, h3")].map((head) => head.textContent.trim());
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

  function currentId() {
    const id = decodeURIComponent((location.hash || "#about").slice(1)).split("/")[0];
    return flat.some((item) => item.id === id) ? id : "about";
  }

  function renderNav(active) {
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
          location.hash = item.id;
          shell.classList.remove("nav-open");
        });
        box.appendChild(btn);
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
      const hay = item.title + " " + item.group + " " + (item.keys || "") + " " + item.headings.join(" ") + " " + item.text;
      if (parsed.exclude.some((word) => hay.toLowerCase().includes(word))) return null;
      if (!covers(hay, parsed.words, parsed.phrases)) return null;
      let score = 1;
      parsed.words.forEach((word) => { if (item.title.toLowerCase().includes(word)) score += 40; });
      parsed.phrases.forEach((phrase) => { if (item.title.toLowerCase().includes(phrase)) score += 50; });
      const heading = item.headings.find((head) => covers(head, parsed.words, parsed.phrases)) || "";
      if (heading) score += 25;
      if (covers(item.keys || "", parsed.words, parsed.phrases)) score += 10;
      return { item, score, heading, snippet: snippet(item.text, needles) };
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
        pending = { id: hit.item.id, words: parsed.words, phrases: parsed.phrases, heading: hit.heading };
        shell.classList.remove("nav-open");
        if (currentId() === hit.item.id) load(hit.item.id);
        else location.hash = hit.item.id;
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

  function fillHere() {
    const heads = [...doc.querySelectorAll("h2, h3")];
    if (!heads.length) {
      here.hidden = true;
      return;
    }
    here.hidden = false;
    here.innerHTML = "<strong>На этой странице</strong>";
    heads.forEach((head, index) => {
      if (!head.id) head.id = "s" + index;
      const link = document.createElement("a");
      link.href = "#" + currentId();
      link.textContent = head.textContent;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        head.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      here.appendChild(link);
    });
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
      doc.innerHTML = await res.text();
      document.title = (doc.querySelector("h1")?.textContent || "Справка") + " — FinMaster";
      if (window.FAQLive) await window.FAQLive.mount(doc);
      if (token !== loadToken) return;
      const jump = pending && pending.id === id ? pending : null;
      pending = null;
      if (jump) highlight(doc, jump.words.concat(jump.phrases));
      fillHere();
      if (jump && jump.heading) {
        const head = [...doc.querySelectorAll("h2, h3")].find((item) => item.textContent.trim() === jump.heading);
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

  window.addEventListener("hashchange", () => load(currentId()));
  if (!location.hash) history.replaceState(null, "", "#about");
  warm();
  load(currentId());
})();
