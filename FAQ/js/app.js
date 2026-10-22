(function () {
  const toc = window.FAQ_TOC || [];
  const nav = document.getElementById("nav");
  const doc = document.getElementById("doc");
  const search = document.getElementById("search");
  const shell = document.querySelector(".shell");
  const themeBtn = document.getElementById("theme");
  const menuBtn = document.getElementById("menu");
  const here = document.getElementById("here");
  const flat = toc.flatMap((group) => group.items.map((item) => ({ ...item, group: group.title })));

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    themeBtn.textContent = theme === "dark" ? "Светлая" : "Тёмная";
    try { localStorage.setItem("faq-theme", theme); } catch (err) { /* справка живёт и без хранилища */ }
  }

  try {
    const saved = localStorage.getItem("faq-theme");
    if (saved === "dark" || saved === "light") applyTheme(saved);
  } catch (err) { /* нет доступа к localStorage */ }

  themeBtn.addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });

  menuBtn.addEventListener("click", () => shell.classList.toggle("nav-open"));

  function query() {
    return (search.value || "").trim().toLowerCase();
  }

  function matches(item, text) {
    if (!text) return true;
    return (item.title + " " + item.group + " " + (item.keys || "")).toLowerCase().includes(text);
  }

  function renderNav(active) {
    const text = query();
    nav.innerHTML = "";
    let shown = 0;
    toc.forEach((group) => {
      const items = group.items.filter((item) => matches({ ...item, group: group.title }, text));
      if (!items.length) return;
      shown += items.length;
      const box = document.createElement("section");
      box.className = "group";
      const title = document.createElement("h2");
      title.textContent = group.title;
      box.appendChild(title);
      items.forEach((item) => {
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
    if (!shown) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "Ничего не нашлось. Попробуйте другое слово: заказ, календарь, телефон.";
      nav.appendChild(empty);
    }
  }

  function currentId() {
    const id = (location.hash || "#start").slice(1);
    return flat.some((item) => item.id === id) ? id : "start";
  }

  function fillHere() {
    const heads = [...doc.querySelectorAll("h2")];
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
    renderNav(id);
    doc.innerHTML = "<p class=\"lead\">Открываю раздел…</p>";
    here.hidden = true;
    try {
      const res = await fetch("topics/" + id + ".html");
      if (!res.ok) throw new Error(String(res.status));
      doc.innerHTML = await res.text();
      document.title = (doc.querySelector("h1")?.textContent || "Справка") + " — FinMaster";
      fillHere();
      window.scrollTo(0, 0);
    } catch (err) {
      doc.innerHTML = "<h1>Раздел не открылся</h1><p>Проверьте, что рядом с этой страницей лежит папка <code>topics</code>. Справка рассчитана на обычные ссылки: и из окна программы, и с сайта репозитория.</p>";
    }
  }

  search.addEventListener("input", () => renderNav(currentId()));
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const text = query();
    const hit = flat.find((item) => matches(item, text));
    if (hit) location.hash = hit.id;
  });

  window.addEventListener("hashchange", () => load(currentId()));
  if (!location.hash) history.replaceState(null, "", "#start");
  load(currentId());
})();
