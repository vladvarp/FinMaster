  /* ==== Командная палитра ==== */
  const palette = { items: [], index: 0 };

  function paletteCommands() {
    const items = [
      { group: "Разделы", ico: "⌂", title: "Дашборд", sub: "KPI, инсайты и графики", run: () => setView("dashboard") },
      { group: "Разделы", ico: "☰", title: "Заказы", sub: "таблицы заказов и позиций", run: () => setView("orders") },
      { group: "Разделы", ico: "◷", title: "Аналитика", sub: "фильтры, сравнение периодов", run: () => setView("analytics") },
      { group: "Разделы", ico: "₽", title: "Касса", sub: "платёжный календарь и дебиторка", run: () => setView("cashflow") },
      { group: "Разделы", ico: "▦", title: "Календарь", sub: "старт, финиш и что идёт сейчас", run: () => setView("calendar") },
      { group: "Разделы", ico: "∑", title: "Калькулятор", sub: "схемы из заказов, операторов и формул", run: () => setView("calculator") },
      { group: "Разделы", ico: "▣", title: "Презентация", sub: "инфографика из блоков и схем", run: () => setView("presentation") },
      { group: "Разделы", ico: "✣", title: "Облако заказов", sub: "живая карта заказов и позиций", run: () => setView("cloud") },
      { group: "Разделы", ico: "◈", title: "Хранилище", sub: "личный учёт денег и копилки", run: () => setView("vault") },
      { group: "Разделы", ico: "◉", title: "Заказчики", sub: "контакты и рейтинг", run: () => setView("customers") },
      { group: "Разделы", ico: "⚙", title: "Справочники", sub: "статусы, единицы, продукты", run: () => setView("catalogs") },

      {
        group: "Действия",
        ico: "+",
        title: "Новый заказ",
        sub: "добавить пустой заказ",
        run: () => {
          state.doc.orders.push(emptyOrder());
          markDirty();
          state.orderFilter = "all";
          setView("orders");
          const last = state.doc.orders[state.doc.orders.length - 1];
          requestAnimationFrame(() => flashOrder(last.id));
        },
      },
      { group: "Действия", ico: "⤓", title: "Сохранить отчёт", right: "Ctrl+S", run: () => save() },
      {
        group: "Действия",
        ico: "▯",
        title: remote.enabled ? "Телефон: показать QR-код" : "Управление с телефона",
        sub: "работать с отчётом со смартфона",
        run: () => $("btn-remote")?.click(),
      },
      {
        group: "Действия",
        ico: ">_",
        title: netConsoleOpen() ? "Скрыть консоль сети" : "Консоль сети",
        sub: "подключения, синхронизация, Telegram и ngrok",
        right: "Ctrl+Ё",
        run: () => toggleNetConsole(),
      },
      { group: "Действия", ico: "⤓", title: "Сохранить как…", right: "Ctrl+Shift+S", run: () => save({ as: true }) },
      { group: "Действия", ico: "⌸", title: "Открыть отчёт", right: "Ctrl+O", run: () => maybeOpen(openFromDialog) },
      { group: "Действия", ico: "✧", title: "Создать новый отчёт", right: "Ctrl+N", run: onNew },
      { group: "Действия", ico: "⛶", title: state.appFullscreen ? "Выйти из полного экрана" : "Полный экран", right: "F11", run: () => toggleAppFullscreen() },
      { group: "Действия", ico: "⎘", title: "Экспорт в CSV", sub: "все позиции отчёта", run: exportCsv },
      { group: "Действия", ico: "▣", title: "Снимок заказов", sub: "красивая картинка для заказчика", run: () => openShare(null) },
      { group: "Действия", ico: "↶", title: "Отменить действие", right: "Ctrl+Z", run: undo },
      { group: "Действия", ico: "↷", title: "Повторить действие", right: "Ctrl+Y", run: redo },
      {
        group: "Действия",
        ico: "◐",
        title: currentTheme() === "dark" ? "Включить светлую тему" : "Включить тёмную тему",
        run: () => applyTheme(currentTheme() === "dark" ? "light" : "dark", true),
      },
      {
        group: "Действия",
        ico: "⊏",
        title: ensureUi().sidebar_collapsed ? "Развернуть боковую панель" : "Свернуть боковую панель",
        run: () => {
          ensureUi().sidebar_collapsed = !ensureUi().sidebar_collapsed;
          applySidebar();
          markDirty();
        },
      },
      { group: "Действия", ico: "?", title: "Горячие клавиши", right: "F1", run: openHelp },

      {
        group: "Фильтры",
        ico: "!",
        title: "Заказы с долгом",
        sub: "оставить только неоплаченные",
        run: () => {
          state.orderFilter = "debt";
          setView("orders");
        },
      },
      {
        group: "Фильтры",
        ico: "✓",
        title: "Полностью оплаченные заказы",
        run: () => {
          state.orderFilter = "paid";
          setView("orders");
        },
      },
      {
        group: "Фильтры",
        ico: "◷",
        title: "Заказы этого месяца",
        run: () => {
          state.orderFilter = "month";
          setView("orders");
        },
      },
      {
        group: "Фильтры",
        ico: "▦",
        title: "Календарь: идёт сейчас",
        sub: "заказы в работе сегодня",
        run: () => {
          calendarState().filter = "now";
          persistCalendar();
          setView("calendar");
        },
      },
      {
        group: "Фильтры",
        ico: "!",
        title: "Касса: просроченные долги",
        run: () => {
          cashResetFilters();
          cashState().filter = "overdue";
          setView("cashflow");
        },
      },
      {
        group: "Фильтры",
        ico: "₽",
        title: "Касса: скопировать сводку",
        run: () => {
          if (!state.doc) return;
          cashCopy(cashSummaryText(cashData()), "Сводка по кассе скопирована");
        },
      },
      {
        group: "Фильтры",
        ico: "∑",
        title: "Аналитика: только долги",
        run: () => {
          setView("analytics");
          $("f-unpaid").checked = true;
          renderAnalytics();
        },
      },
      {
        group: "Облако",
        ico: "➤",
        title: "Облако: автотур по долгам",
        sub: "пролететь по самым крупным очагам",
        run: () => {
          setView("cloud");
          requestAnimationFrame(() => {
            if (!orderCloud?.startTour()) toast("Для автотура нужны заказы или долги");
          });
        },
      },
      {
        group: "Облако",
        ico: "♨",
        title: "Облако: тепловая карта долга",
        run: () => {
          cloudState().heat = true;
          persistCloudPrefs();
          setView("cloud");
          $("cloud-heat")?.setAttribute("aria-pressed", "true");
          $("cloud-heat")?.classList.add("active");
          syncCloudHeatScale();
        },
      },
      {
        group: "Облако",
        ico: "3D",
        title: "Облако: объёмное пространство",
        sub: "переключить карту в 3D",
        run: () => {
          cloudState().space3d = true;
          persistCloudPrefs();
          setView("cloud");
          $("cloud-3d")?.setAttribute("aria-pressed", "true");
          $("cloud-3d")?.classList.add("active");
          orderCloud?.setOptions({ space3d: true });
        },
      },
      {
        group: "Облако",
        ico: "✦",
        title: "Облако: созвездия работ",
        run: () => {
          cloudState().layout = "constellation";
          persistCloudPrefs();
          setView("cloud");
          if ($("cloud-layout")) $("cloud-layout").value = "constellation";
        },
      },
    ];
    return items;
  }

  function paletteDataItems() {
    const items = [];
    (state.doc.orders || []).forEach((order) => {
      const t = orderTotals(order);
      items.push({
        group: "Заказы",
        ico: "№",
        title: `${order.number || "—"} · ${order.name || "без названия"}`,
        sub: order.customer || "без заказчика",
        right: money(t.after),
        run: () => gotoOrder(order.id),
      });
    });
    (state.doc.customers || []).forEach((c) => {
      items.push({
        group: "Заказчики",
        ico: "◉",
        title: c.name || "без имени",
        sub: [c.organization, c.phone].filter(Boolean).join(" · "),
        right: `${(state.doc.orders || []).filter((o) => o.customer === c.name).length} зак.`,
        run: () => gotoCustomer(c.id),
      });
    });
    (state.doc.products || []).forEach((p) => {
      const entry = productEntry(p);
      const kindLabel = entry.kind === "tax" ? "налог" : entry.kind === "cost" ? "затрата" : "заказ";
      items.push({
        group: "Продукты",
        ico: "✦",
        title: entry.name,
        sub: `${kindLabel} · ед. ${entry.unit}${entry.kind === "tax" && entry.tax_percent ? ` · ${entry.tax_percent}%` : ""}`,
        run: () => {
          setView("catalogs");
          state.productCatalogTab = entry.kind;
          renderCatalogs();
        },
      });
    });
    return items;
  }

  function paletteMatch(item, tokens) {
    if (!tokens.length) return true;
    const hay = `${item.title} ${item.sub || ""} ${item.group}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  }

  function renderPaletteList(query) {
    const tokens = String(query || "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const all = [...paletteCommands(), ...paletteDataItems()];
    const limit = tokens.length ? 8 : 5;
    const counts = {};
    const items = [];
    all.forEach((item) => {
      if (!paletteMatch(item, tokens)) return;
      counts[item.group] = (counts[item.group] || 0) + 1;
      if (counts[item.group] <= limit) items.push(item);
    });
    palette.items = items.slice(0, 40);
    palette.index = 0;
    drawPalette();
  }

  function drawPalette() {
    const list = $("palette-list");
    if (!palette.items.length) {
      list.innerHTML = `<div class="palette-empty">Ничего не найдено. Попробуйте другое слово.</div>`;
      return;
    }
    let group = null;
    list.innerHTML = palette.items
      .map((item, i) => {
        let head = "";
        if (item.group !== group) {
          group = item.group;
          head = `<div class="palette-group">${esc(group)}</div>`;
        }
        return `${head}<button type="button" class="palette-item ${i === palette.index ? "active" : ""}" data-pi="${i}">
          <span class="pi-ico">${esc(item.ico || "•")}</span>
          <span><span class="pi-title">${esc(item.title)}</span>${item.sub ? `<span class="pi-sub"> — ${esc(item.sub)}</span>` : ""}</span>
          ${item.right ? `<span class="pi-right">${esc(item.right)}</span>` : ""}
        </button>`;
      })
      .join("");
    list.querySelector(".palette-item.active")?.scrollIntoView({ block: "nearest" });
  }

  function paletteMove(dir) {
    if (!palette.items.length) return;
    palette.index = (palette.index + dir + palette.items.length) % palette.items.length;
    drawPalette();
  }

  function paletteRun(index) {
    const item = palette.items[index];
    if (!item) return;
    closePalette();
    try {
      item.run();
    } catch (err) {
      toast(String(err.message || err));
    }
  }

  function openPalette() {
    if (!state.doc || $("app-shell").hidden) return;
    $("palette").classList.add("open");
    const input = $("palette-input");
    input.value = "";
    syncSearchClear(input);
    renderPaletteList("");
    setTimeout(() => input.focus(), 10);
  }

  function closePalette() {
    $("palette").classList.remove("open");
  }

  function paletteIsOpen() {
    return $("palette").classList.contains("open");
  }

  function pageFullscreenOn() {
    const el = document.fullscreenElement || document.webkitFullscreenElement;
    return el === document.documentElement;
  }

  function syncAppFullscreen(on) {
    state.appFullscreen = !!on;
    const btn = $("btn-fullscreen");
    if (!btn) return;
    btn.classList.toggle("on", !!on);
    btn.textContent = on ? "↙" : "⛶";
    btn.setAttribute("title", on ? "Выйти из полного экрана (F11)" : "Полный экран (F11)");
    btn.setAttribute("aria-label", on ? "Выйти из полного экрана" : "Полный экран");
  }

  async function toggleAppFullscreen(force) {
    const want = force == null ? !state.appFullscreen : !!force;
    if (state.desktop) {
      try {
        const res = await apiPost("/api/window/fullscreen", { on: want });
        if (res.ok) {
          syncAppFullscreen(!!res.fullscreen);
          return;
        }
      } catch {
        /* окно в браузере — ниже обычный полный экран страницы */
      }
    }
    try {
      if (!want && (pageFullscreenOn() || document.fullscreenElement || document.webkitFullscreenElement)) {
        if (cloudFullscreenOn()) {
          await toggleCloudFullscreen(false);
          return;
        }
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) await exit.call(document);
      } else if (want && !pageFullscreenOn()) {
        const el = document.documentElement;
        const enter = el.requestFullscreen || el.webkitRequestFullscreen;
        if (enter) await enter.call(el);
      }
    } catch {
      toast("Полноэкранный режим недоступен");
    }
    syncAppFullscreen(pageFullscreenOn());
  }

  function openHelp() {
    $("help-modal").classList.add("open");
  }

  function closeLineMenu() {
    const menu = $("line-menu");
    if (menu) menu.hidden = true;
  }

  function onLineContextMenu(e) {
    const grip = e.target.closest(".line-drag");
    if (!grip) return;
    const tr = grip.closest("tr[data-line]");
    const card = tr?.closest("[data-order]");
    const order = findOrder(card?.dataset.order);
    const line = order?.lines?.find((item) => item.id === tr.dataset.line);
    const menu = $("line-menu");
    const btn = $("line-menu-freeze");
    if (!line || !menu || !btn) return;
    e.preventDefault();
    e.stopPropagation();
    menu.dataset.order = order.id;
    menu.dataset.line = line.id;
    btn.textContent = isFrozenLine(line) ? "Вернуть в заказ" : "Заморозить позицию";
    menu.hidden = false;
    const x = Math.min(e.clientX, window.innerWidth - 250);
    const y = Math.min(e.clientY, window.innerHeight - 60);
    menu.style.left = `${Math.max(8, x)}px`;
    menu.style.top = `${Math.max(8, y)}px`;
  }

  function toggleLineFrozen() {
    const menu = $("line-menu");
    const order = findOrder(menu?.dataset.order);
    const line = order?.lines?.find((item) => item.id === menu?.dataset.line);
    closeLineMenu();
    if (!line) return;
    historyCommit();
    line.frozen = !isFrozenLine(line);
    markDirty();
    renderOrders();
    toast(line.frozen ? "Позиция заморожена" : "Позиция снова в заказе");
  }

  function onOrderClick(e) {
    const act = e.target.dataset.act || e.target.closest("button")?.dataset.act;
    if (!act) return;
    const card = e.target.closest("[data-order]");
    if (!card) return;
    const order = findOrder(card.dataset.order);
    if (!order) return;
    if (act === "toggle-frozen") {
      const open = openFrozenOrders.has(order.id);
      if (open) openFrozenOrders.delete(order.id);
      else openFrozenOrders.add(order.id);
      card.querySelector(".order-frozen")?.classList.toggle("collapsed", open);
      e.target.closest("[data-act='toggle-frozen']")?.setAttribute("aria-expanded", open ? "false" : "true");
      return;
    }
    if (act === "linenotes") {
      const tr = e.target.closest("[data-line]");
      const id = tr?.dataset.line;
      if (!id) return;
      const open = openLineNotes.has(id);
      if (open) openLineNotes.delete(id);
      else openLineNotes.add(id);
      const noteRow = card.querySelector(`tr.line-note-row[data-line="${cssEscape(id)}"]`);
      tr.querySelector(".note-btn")?.classList.toggle("open", !open);
      noteRow?.classList.toggle("open", !open);
      if (!open) requestAnimationFrame(() => noteRow?.querySelector("textarea")?.focus());
      return;
    }
    if (act === "notes") {
      const panel = card.querySelector(".order-notes");
      const btn = card.querySelector(".note-btn");
      const open = !panel.classList.contains("open");
      panel.classList.toggle("open", open);
      btn.classList.toggle("open", open);
      if (open) requestAnimationFrame(() => panel.querySelector("textarea")?.focus());
      return;
    }
    if (act === "work-start-today" || act === "work-end-today") {
      setWorkToday(order, act === "work-start-today" ? "start" : "end");
      markDirty();
      renderOrders();
      return;
    }
    if (act === "share") {
      openShare(order);
      return;
    }
    if (act === "payall") {
      (order.lines || []).forEach((line) => {
        if (isFrozenLine(line) || isExpenseLine(line)) return;
        const after = lineTotals(line).after;
        line.paid = after;
        line.paid_expr = String(after);
        applyPaidIfCovered(line);
      });
      markDirty();
      renderOrders();
      return;
    }
    if (act === "del") {
      historyCommit();
      window.FinCalc?.pruneOrderLinks?.(order.id);
      state.doc.orders = state.doc.orders.filter((o) => o.id !== order.id);
      markDirty();
      renderOrders();
      undoToast(`Заказ ${order.number || ""} удалён`.trim());
      return;
    }
    if (act === "dupline") {
      const tr = e.target.closest("[data-line]");
      const idx = order.lines.findIndex((l) => l.id === tr?.dataset.line);
      if (idx < 0) return;
      const copy = JSON.parse(JSON.stringify(order.lines[idx]));
      copy.id = uid();
      copy.frozen = false;
      order.lines.splice(idx + 1, 0, copy);
      markDirty();
      renderOrders();
      requestAnimationFrame(() => focusLineCell(copy.id, 2));
      return;
    }
    if (act === "dup") {
      const copy = JSON.parse(JSON.stringify(order));
      copy.id = uid();
      copy.number = `${order.number}-копия`;
      copy.lines.forEach((l) => (l.id = uid()));
      state.doc.orders.push(copy);
      markDirty();
      renderOrders();
      return;
    }
    if (act === "addline") {
      addOrderLine(order);
      return;
    }
    if (act === "addcost") {
      addExpenseLine(order);
      return;
    }
    if (act === "delline") {
      const id = e.target.closest("[data-line]")?.dataset.line;
      if (!id) return;
      if (order.lines.length <= 1) {
        toast("У заказа должна остаться хотя бы одна позиция. Удалите заказ целиком, если он не нужен.");
        return;
      }
      historyCommit();
      window.FinCalc?.pruneOrderLinks?.(order.id, id);
      order.lines = order.lines.filter((l) => l.id !== id);
      markDirty();
      renderOrders();
      undoToast("Строка удалена");
    }
  }

