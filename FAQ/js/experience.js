(function () {
  const root = document.documentElement;
  const doc = document.getElementById("doc");
  const map = document.getElementById("link-map");
  const back = document.getElementById("faq-back");
  const forward = document.getElementById("faq-forward");
  const themeButton = document.getElementById("faq-theme");
  const embedded = root.dataset.faqMode === "app";
  const topics = (window.FAQ_TOC || []).flatMap((group) =>
    group.items.map((item) => ({ ...item, group: group.title }))
  );
  const topicById = new Map(topics.map((item) => [item.id, item]));
  const trail = [];
  let trailIndex = 0;
  let graphPromise = null;
  let graph = [];

  function currentRoute() {
    try { return decodeURIComponent((location.hash || "#about").slice(1)); }
    catch (err) { return (location.hash || "#about").slice(1); }
  }

  function updateHistoryButtons() {
    back.disabled = trailIndex <= 0;
    forward.disabled = trailIndex >= trail.length - 1;
    back.title = back.disabled ? "Нет предыдущего раздела" : "Назад";
    forward.title = forward.disabled ? "Нет следующего раздела" : "Вперёд";
  }

  function stampCurrentEntry() {
    const route = currentRoute();
    const state = history.state;
    if (state && state.faqNav === true && state.faqRoute === route &&
        Number.isInteger(state.faqIndex)) {
      trailIndex = Math.max(0, Math.min(trail.length - 1, state.faqIndex));
    } else {
      trail.splice(trailIndex + 1);
      trail.push(route);
      trailIndex = trail.length - 1;
      history.replaceState(
        { ...(state || {}), faqNav: true, faqRoute: route, faqIndex: trailIndex },
        "",
        location.href
      );
    }
    updateHistoryButtons();
  }

  function setTheme(next) {
    const value = next === "light" ? "light" : "dark";
    root.dataset.theme = value;
    if (!embedded) {
      try {
        if (localStorage.getItem("finmaster.faq.theme") !== value) {
          localStorage.setItem("finmaster.faq.theme", value);
        }
      } catch (err) {}
    }
    const nextLabel = value === "dark" ? "Включить светлую тему" : "Включить тёмную тему";
    themeButton.title = nextLabel;
    themeButton.setAttribute("aria-label", nextLabel);
    themeButton.setAttribute("aria-pressed", value === "dark" ? "true" : "false");
    themeButton.innerHTML = value === "dark"
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.6 8.6 0 1 0 20.5 14.2Z"/></svg>';
  }

  function routeInfo(route) {
    const [id, sub] = route.split("/");
    const topic = topicById.get(id);
    if (!topic) return null;
    const child = (topic.subs || []).find((item) => item.id === sub) ||
      (!sub ? (topic.subs || [])[0] : null);
    return {
      id,
      sub: child ? child.id : "",
      route: id + (child ? "/" + child.id : ""),
      title: child ? child.title : topic.title,
      group: topic.group,
      parent: topic.title
    };
  }

  function normalizeTarget(href) {
    if (!href || href[0] !== "#") return null;
    let route;
    try { route = decodeURIComponent(href.slice(1)); }
    catch (err) { route = href.slice(1); }
    return routeInfo(route);
  }

  async function loadGraph() {
    if (graphPromise) return graphPromise;
    graphPromise = (async () => {
      const rows = await window.FAQGetIndex();
      graph = rows.map((topic) => ({
        topic,
        links: (topic.links || []).map(({ href, label, fromSub }) => {
          const target = normalizeTarget(href);
          return target ? { target, label, fromSub } : null;
        }).filter(Boolean)
      }));
      renderMap();
      return graph;
    })();
    return graphPromise;
  }

  function makeTreeSection(title, count, entries, emptyText) {
    const section = document.createElement("details");
    section.className = "map-branch";
    section.open = true;
    const summary = document.createElement("summary");
    const name = document.createElement("span");
    name.textContent = title;
    const total = document.createElement("small");
    total.textContent = String(count);
    summary.append(name, total);
    section.appendChild(summary);

    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "map-empty";
      empty.textContent = emptyText;
      section.appendChild(empty);
      return section;
    }

    const groups = new Map();
    entries.forEach((entry) => {
      const group = entry.group || "Другие разделы";
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(entry);
    });

    const list = document.createElement("ul");
    list.className = "map-tree";
    [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "ru")).forEach(([group, items]) => {
      const branch = document.createElement("li");
      branch.className = "map-group";
      const groupLabel = document.createElement("span");
      groupLabel.className = "map-group-label";
      groupLabel.textContent = group;
      const children = document.createElement("ul");
      children.className = "map-subtree";
      items.sort((a, b) => a.title.localeCompare(b.title, "ru")).forEach((entry) => {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = "#" + entry.route;
        link.textContent = entry.title;
        const note = document.createElement("small");
        note.textContent = entry.note;
        item.append(link, note);
        children.appendChild(item);
      });
      branch.append(groupLabel, children);
      list.appendChild(branch);
    });
    section.appendChild(list);
    return section;
  }

  function renderMap() {
    if (!map || !graph.length) return;
    const current = routeInfo(currentRoute());
    if (!current) { map.hidden = true; return; }

    const outgoing = new Map();
    const incoming = new Map();
    graph.forEach(({ topic, links }) => {
      links.forEach(({ target, label, fromSub }) => {
        const targetKey = target.route;
        if (topic.id === current.id && (!fromSub || fromSub === current.sub) && targetKey !== current.route) {
          if (!outgoing.has(targetKey)) outgoing.set(targetKey, { ...target, labels: [] });
          if (label) outgoing.get(targetKey).labels.push(label);
        }
        if (targetKey === current.route && topic.id !== current.id) {
          if (!incoming.has(topic.id)) incoming.set(topic.id, { route: topic.id, title: topic.title, group: topic.group, labels: [] });
          if (label) incoming.get(topic.id).labels.push(label);
        }
      });
    });

    const outgoingEntries = [...outgoing.values()].map((item) => ({
      route: item.route,
      title: item.title,
      group: item.group,
      note: item.labels.slice(0, 3).join(" · ") || item.group
    })).sort((a, b) => a.title.localeCompare(b.title, "ru"));

    const incomingEntries = [...incoming.values()].map((item) => ({
      route: item.route,
      title: item.title,
      group: item.group,
      note: item.labels.slice(0, 3).join(" · ") || item.group
    })).sort((a, b) => a.title.localeCompare(b.title, "ru"));

    map.replaceChildren();
    const heading = document.createElement("div");
    heading.className = "map-heading";
    const title = document.createElement("strong");
    title.textContent = "Карта переходов";
    const caption = document.createElement("span");
    caption.textContent = current.parent + (current.sub ? " / " + current.title : "");
    heading.append(title, caption);
    map.appendChild(heading);
    map.appendChild(makeTreeSection("Ссылки из этого раздела", outgoingEntries.length, outgoingEntries, "В этом разделе нет ссылок на другие темы."));
    map.appendChild(makeTreeSection("Разделы, которые ведут сюда", incomingEntries.length, incomingEntries, "На этот раздел пока нет ссылок из других тем."));
    map.hidden = false;
  }

  back.addEventListener("click", () => {
    if (trailIndex > 0) history.back();
  });
  forward.addEventListener("click", () => {
    if (trailIndex < trail.length - 1) history.forward();
  });

  themeButton.addEventListener("click", () => {
    setTheme(root.dataset.theme === "dark" ? "light" : "dark");
  });

  window.addEventListener("storage", (event) => {
    if (embedded || event.key !== "finmaster.faq.theme") return;
    if (event.newValue === "light" || event.newValue === "dark") setTheme(event.newValue);
  });

  window.addEventListener("hashchange", () => {
    stampCurrentEntry();
    renderMap();
  });
  window.addEventListener("popstate", updateHistoryButtons);

  if (!embedded) setTheme(root.dataset.theme === "light" ? "light" : "dark");
  else {
    const label = root.dataset.theme === "dark" ? "Тёмная тема программы" : "Светлая тема программы";
    themeButton.title = label;
    themeButton.setAttribute("aria-label", label);
    themeButton.setAttribute("aria-pressed", root.dataset.theme === "dark" ? "true" : "false");
  }

  stampCurrentEntry();
  loadGraph();

})();
