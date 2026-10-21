  /* ==== Командная палитра ==== */
  const palette = { items: [], index: 0, drag: null };
  const ASSISTANT_KEY = "finmaster.assistant";
  const ASSISTANT_MIN_W = 320;
  const ASSISTANT_MIN_H = 280;

  function paletteCommands() {
    const items = [
      { group: "Разделы", ico: "⌂", title: "Дашборд", sub: "KPI, инсайты и графики", run: () => setView("dashboard") },
      { group: "Разделы", ico: "☰", title: "Заказы", sub: "таблицы заказов и позиций", run: () => setView("orders") },
      { group: "Разделы", ico: "◷", title: "Аналитика", sub: "фильтры, сравнение периодов", run: () => setView("analytics") },
      { group: "Разделы", ico: "₽", title: "Касса", sub: "долги, сроки оплат и дебиторка", keys: "касса платежи просрочка", run: () => setView("cashflow") },
      { group: "Разделы", ico: "↗", title: "Прогнозирование", sub: "выручка и прибыль на месяцы и годы", run: () => setView("forecast") },
      { group: "Разделы", ico: "▦", title: "Календарь", sub: "без фильтра", keys: "календарь работ", run: () => openCalendarView("", "all") },
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
        ico: "₽",
        title: "Касса: скопировать сводку",
        keys: "касса сводка",
        run: () => {
          if (!state.doc) return;
          cashCopy(cashSummaryText(cashData()), "Сводка по кассе скопирована");
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
    return items.concat(paletteSmartItems());
  }

  function openCalendarView(mode, filter) {
    const cal = calendarState();
    if (mode) cal.mode = mode;
    cal.filter = filter || "all";
    persistCalendar();
    markDirty();
    setView("calendar");
  }

  function openCashView(filter) {
    cashResetFilters();
    cashState().filter = filter || "all";
    setView("cashflow");
  }

  function openForecastView(metric, horizon) {
    const metricEl = $("forecast-metric");
    const horizonEl = $("forecast-horizon");
    if (metricEl && metric) {
      metricEl.value = metric;
      metricEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (horizonEl && horizon) {
      horizonEl.value = String(horizon);
      horizonEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
    setView("forecast");
  }

  function openAnalyticsView({ unpaid, group } = {}) {
    setView("analytics");
    if (unpaid != null && $("f-unpaid")) $("f-unpaid").checked = !!unpaid;
    if (group && $("f-group")) $("f-group").value = group;
    renderAnalytics();
  }

  function openCloudView(patch) {
    Object.assign(cloudState(), patch);
    persistCloudPrefs();
    setView("cloud");
    syncCloudControls();
    orderCloud?.setOptions?.(patch);
  }

  function paletteSmartItems() {
    const items = [];
    const push = (item) => items.push(item);

    ORDER_FILTERS.forEach(([id, name]) => {
      push({
        group: "Фильтры",
        ico: "☰",
        title: id === "all" ? "Заказы · без фильтра" : `Заказы · ${name}`,
        sub: "список заказов",
        keys: `заказы ${name}`,
        run: () => {
          state.orderFilter = id;
          setView("orders");
        },
      });
    });

    const calModes = [
      ["timeline", "Таймлайн", "таймлайн гант диаграмма"],
      ["classic", "Месяц", "месяц классический сетка"],
      ["extended", "Неделя", "неделя старты финиш"],
    ];
    const calFilters = CALENDAR_FILTERS.filter(([id]) => id !== "all");
    calModes.forEach(([mode, name, keys]) => {
      push({
        group: "Календарь",
        ico: "▦",
        title: `Календарь · ${name}`,
        sub: "вид без фильтра",
        keys: `календарь ${keys}`,
        run: () => openCalendarView(mode, "all"),
      });
    });
    calFilters.forEach(([id, name]) => {
      push({
        group: "Календарь",
        ico: "▦",
        title: `Календарь · ${name}`,
        sub: "фильтр",
        keys: `календарь ${name}`,
        run: () => openCalendarView("", id),
      });
    });
    calModes.forEach(([mode, modeName, modeKeys]) => {
      calFilters.forEach(([id, filterName]) => {
        push({
          group: "Календарь",
          ico: "▦",
          title: `Календарь · ${modeName} · ${filterName}`,
          sub: "вид и фильтр",
          keys: `календарь ${modeKeys} ${filterName}`,
          rankBias: 28,
          run: () => openCalendarView(mode, id),
        });
      });
    });

    [
      ["all", "без фильтра", "все"],
      ["overdue", "Просрочено", "просрочка долги"],
      ["week", "Срок до 7 дней", "неделя срок"],
      ["nodate", "Без срока", "без даты"],
    ].forEach(([id, name, keys]) => {
      push({
        group: "Фильтры",
        ico: "₽",
        title: id === "all" ? "Касса · без фильтра" : `Касса · ${name}`,
        sub: "платежи и долги",
        keys: `касса ${keys}`,
        run: () => openCashView(id),
      });
    });

    push({
      group: "Фильтры",
      ico: "∑",
      title: "Аналитика · только долги",
      sub: "фильтр",
      keys: "аналитика долг неоплаченные",
      run: () => openAnalyticsView({ unpaid: true }),
    });
    push({
      group: "Фильтры",
      ico: "∑",
      title: "Аналитика · без фильтра",
      sub: "все позиции",
      keys: "аналитика все",
      run: () => openAnalyticsView({ unpaid: false }),
    });
    [
      ["day", "по дням"],
      ["week", "по неделям"],
      ["month", "по месяцам"],
    ].forEach(([id, name]) => {
      push({
        group: "Фильтры",
        ico: "∑",
        title: `Аналитика · ${name}`,
        sub: "группировка",
        keys: `аналитика ${name}`,
        run: () => openAnalyticsView({ group: id }),
      });
    });

    [
      ["revenue", "Выручка"],
      ["paid", "Оплаты"],
      ["cost", "Затраты"],
      ["net", "Чистыми"],
    ].forEach(([id, name]) => {
      push({
        group: "Прогноз",
        ico: "↗",
        title: `Прогноз · ${name}`,
        sub: "показатель",
        keys: `прогноз прогнозирование ${name}`,
        run: () => openForecastView(id, 0),
      });
    });
    [
      [6, "6 месяцев"],
      [12, "год"],
      [24, "2 года"],
      [36, "3 года"],
      [60, "5 лет"],
    ].forEach(([horizon, name]) => {
      push({
        group: "Прогноз",
        ico: "↗",
        title: `Прогноз · ${name}`,
        sub: "горизонт",
        keys: `прогноз горизонт ${name}`,
        run: () => openForecastView("", horizon),
      });
    });

    [
      ["galaxy", "Звёздные системы"],
      ["orbit", "Орбитальное кольцо"],
      ["timeline", "Финансовая ось"],
      ["constellation", "Созвездия работ"],
    ].forEach(([id, name]) => {
      push({
        group: "Облако",
        ico: "✣",
        title: `Облако · ${name}`,
        sub: "геометрия",
        keys: `облако ${name}`,
        run: () => openCloudView({ layout: id }),
      });
    });
    [
      ["status", "по статусу"],
      ["customer", "по заказчику"],
      ["debt", "по оплате"],
      ["type", "по типу"],
    ].forEach(([id, name]) => {
      push({
        group: "Облако",
        ico: "✣",
        title: `Облако · цвет ${name}`,
        sub: "раскраска",
        keys: `облако цвет ${name}`,
        run: () => openCloudView({ color: id }),
      });
    });
    [
      ["amount", "по сумме"],
      ["debt", "по долгу"],
      ["quantity", "по количеству"],
      ["equal", "одинаковый"],
    ].forEach(([id, name]) => {
      push({
        group: "Облако",
        ico: "✣",
        title: `Облако · размер ${name}`,
        sub: "размер точек",
        keys: `облако размер ${name}`,
        run: () => openCloudView({ size: id }),
      });
    });
    push({
      group: "Облако",
      ico: "✣",
      title: "Облако · только долги",
      sub: "фильтр",
      keys: "облако долг",
      run: () => openCloudView({ debtOnly: true }),
    });
    push({
      group: "Облако",
      ico: "✣",
      title: "Облако · без фильтра",
      sub: "все заказы",
      keys: "облако все",
      run: () => openCloudView({ debtOnly: false }),
    });
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

  function paletteWords(text) {
    return String(text || "")
      .toLowerCase()
      .split(/[^a-zа-яё0-9]+/i)
      .filter(Boolean);
  }

  function paletteTokenHit(token, word) {
    if (!token || !word) return 0;
    if (word === token) return 140;
    if (word.startsWith(token)) return 116;
    if (token.startsWith(word) && word.length >= 4) return 100;
    let shared = 0;
    const n = Math.min(token.length, word.length);
    while (shared < n && token[shared] === word[shared]) shared += 1;
    if (shared >= 4) return 92;
    if (word.includes(token)) return 36;
    return 0;
  }

  function paletteScore(item, tokens) {
    if (!tokens.length) return 0;
    const titleWords = paletteWords(`${item.title || ""} ${item.keys || ""}`);
    const groupWords = paletteWords(item.group);
    const subWords = paletteWords(item.sub);
    let total = 0;
    for (const token of tokens) {
      let best = 0;
      titleWords.forEach((word) => {
        best = Math.max(best, paletteTokenHit(token, word));
      });
      groupWords.forEach((word) => {
        best = Math.max(best, Math.round(paletteTokenHit(token, word) * 0.5));
      });
      subWords.forEach((word) => {
        best = Math.max(best, Math.round(paletteTokenHit(token, word) * 0.2));
      });
      if (!best) return 0;
      total += best;
    }
    return total - (item.rankBias || 0);
  }

  function renderPaletteList(query, keepIndex) {
    const tokens = String(query || "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const all = [...paletteCommands(), ...paletteDataItems()];
    const limit = tokens.length ? 16 : 5;
    let ranked = all.map((item, index) => ({ item, index, score: paletteScore(item, tokens) }));
    if (tokens.length) {
      ranked = ranked.filter((row) => row.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
    }
    const counts = {};
    const items = [];
    ranked.forEach((row) => {
      counts[row.item.group] = (counts[row.item.group] || 0) + 1;
      if (counts[row.item.group] <= limit) items.push(row.item);
    });
    palette.items = items.slice(0, 40);
    palette.index = keepIndex ? Math.min(palette.index, Math.max(0, palette.items.length - 1)) : 0;
    drawPalette();
  }

  function refreshAssistant() {
    if (palette.hold || !paletteIsOpen() || $("palette")?.classList.contains("is-min")) return;
    renderPaletteList($("palette-input")?.value || "", true);
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
    const list = $("palette-list");
    const input = $("palette-input");
    const scroll = list?.scrollTop || 0;
    const value = input?.value ?? "";
    palette.hold = true;
    const finish = () => {
      palette.hold = false;
      const inside = $("palette")?.contains(document.activeElement);
      if (input && inside && !document.querySelector(".modal.open")) input.focus({ preventScroll: true });
      if (input && input.value !== value) input.value = value;
      if (list) list.scrollTop = scroll;
    };
    try {
      const result = item.run();
      if (result && typeof result.then === "function") {
        result.finally(() => requestAnimationFrame(finish));
        return;
      }
    } catch (err) {
      toast(String(err.message || err));
    }
    requestAnimationFrame(finish);
  }

  function assistantSaved() {
    try {
      return JSON.parse(localStorage.getItem(ASSISTANT_KEY) || "null");
    } catch {
      return null;
    }
  }

  function clampAssistantSize(w, h) {
    const maxW = Math.max(ASSISTANT_MIN_W, window.innerWidth - 16);
    const maxH = Math.max(ASSISTANT_MIN_H, window.innerHeight - 16);
    return {
      w: Math.min(maxW, Math.max(ASSISTANT_MIN_W, Math.round(w))),
      h: Math.min(maxH, Math.max(ASSISTANT_MIN_H, Math.round(h))),
    };
  }

  const ASSISTANT_ORB = 68;

  function syncAssistantMinButton() {
    const box = $("palette");
    const btn = $("palette-min");
    if (!box || !btn) return;
    const min = box.classList.contains("is-min");
    btn.textContent = "—";
    btn.title = "Свернуть";
    btn.setAttribute("aria-label", btn.title);
    box.removeAttribute("title");
    const orb = min && !box.classList.contains("is-morph-in") && !box.classList.contains("is-morph-out");
    if (orb) {
      box.removeAttribute("data-no-tip");
      box.setAttribute("data-tip", "Открыть ассистента");
    } else {
      box.removeAttribute("data-tip");
      box.setAttribute("data-no-tip", "1");
    }
  }

  function orbPoint() {
    return {
      x: 22,
      y: Math.max(8, window.innerHeight - 22 - ASSISTANT_ORB),
      w: ASSISTANT_ORB,
      h: ASSISTANT_ORB,
      radius: ASSISTANT_ORB / 2,
    };
  }

  function windowPoint() {
    const saved = assistantSaved() || {};
    const size = clampAssistantSize(saved.w || 440, saved.h || 520);
    const orb = orbPoint();
    let x = orb.x;
    let y = orb.y + ASSISTANT_ORB - size.h;
    if (saved.placed && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      x = saved.x;
      y = saved.y;
    }
    x = Math.max(8, Math.min(Math.max(8, window.innerWidth - size.w - 8), x));
    y = Math.max(8, Math.min(Math.max(8, window.innerHeight - size.h - 8), y));
    return { x, y, w: size.w, h: size.h, radius: 16 };
  }

  function assistantInputFocused() {
    return document.activeElement === $("palette-input");
  }

  function placeAssistant(frame) {
    const box = $("palette");
    if (!box || !frame) return;
    box.style.left = `${Math.round(frame.x)}px`;
    box.style.top = `${Math.round(frame.y)}px`;
    box.style.right = "auto";
    box.style.bottom = "auto";
    box.style.width = `${Math.round(frame.w)}px`;
    box.style.height = `${Math.round(frame.h)}px`;
    box.style.borderRadius = `${frame.radius}px`;
  }

  function cancelAssistantIdle() {
    clearTimeout(palette.idle);
    palette.idle = 0;
    $("palette")?.classList.remove("is-idle");
  }

  function finishAssistantIdle() {
    palette.idle = 0;
    const box = $("palette");
    if (!box?.classList.contains("open") || !box.classList.contains("is-idle") || box.classList.contains("is-min") || palette.pointerInside) return;
    if (assistantInputFocused()) return;
    setAssistantMin(true);
  }

  function beginAssistantIdle() {
    const box = $("palette");
    if (!box?.classList.contains("open") || box.classList.contains("is-min") || box.classList.contains("is-idle") || palette.drag) return;
    box.classList.add("is-idle");
    clearTimeout(palette.idle);
    palette.idle = setTimeout(finishAssistantIdle, 5000);
  }

  function wakeAssistant() {
    const box = $("palette");
    if (!box?.classList.contains("open") || box.classList.contains("is-min")) return;
    cancelAssistantIdle();
    if (!box.contains(document.activeElement)) $("palette-input")?.focus({ preventScroll: true });
  }

  function assistantContainsPoint(x, y) {
    const box = $("palette");
    if (!box) return false;
    const rect = box.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return false;
    const hit = document.elementFromPoint(x, y);
    return !hit || hit === box || box.contains(hit);
  }

  function persistAssistantFrame(frame) {
    const box = $("palette");
    if (!box) return;
    const prev = assistantSaved() || {};
    const min = box.classList.contains("is-min");
    const rect = box.getBoundingClientRect();
    const size = frame
      ? { w: frame.w, h: frame.h }
      : min
        ? clampAssistantSize(prev.w || 440, prev.h || 520)
        : clampAssistantSize(rect.width, rect.height);
    const x = frame ? frame.x : min && Number.isFinite(prev.x) ? prev.x : rect.left;
    const y = frame ? frame.y : min && Number.isFinite(prev.y) ? prev.y : rect.top;
    const placed = !!(frame?.placed || prev.placed);
    try {
      localStorage.setItem(
        ASSISTANT_KEY,
        JSON.stringify({ x, y, w: size.w, h: size.h, min, placed })
      );
    } catch {
      /* ignore */
    }
  }

  function setAssistantMin(min) {
    const box = $("palette");
    if (!box) return;
    const want = !!min;
    if (want && (box.classList.contains("is-min") || palette.morphTo === "min")) return;
    if (!want && box.classList.contains("open") && !box.classList.contains("is-min") && palette.morphTo !== "min") {
      $("palette-input")?.focus({ preventScroll: true });
      return;
    }
    cancelAssistantIdle();
    if (want && !box.classList.contains("is-min")) persistAssistantFrame();
    if (want && box.contains(document.activeElement)) document.activeElement.blur();
    const token = (palette.morphToken || 0) + 1;
    palette.morphToken = token;
    palette.morphTo = want ? "min" : "open";
    box.classList.add("open");
    box.classList.remove("is-morph-in", "is-morph-out");
    if (want) box.classList.add("is-morph-in");
    else box.classList.remove("is-min");
    if (!want) box.classList.add("is-morph-out");
    placeAssistant(want ? orbPoint() : windowPoint());
    if (!want && !$("palette-list")?.childElementCount) renderPaletteList($("palette-input")?.value || "");
    syncAssistantMinButton();
    let settled = false;
    const finish = (e) => {
      if (settled || palette.morphToken !== token) return;
      if (e && (e.target !== box || e.propertyName !== "width")) return;
      settled = true;
      palette.morphTo = "";
      box.removeEventListener("transitionend", finish);
      box.classList.remove("is-morph-in", "is-morph-out");
      if (want) box.classList.add("is-min");
      syncAssistantMinButton();
      if (!want) {
        persistAssistantFrame(windowPoint());
        $("palette-input")?.focus({ preventScroll: true });
      }
    };
    box.addEventListener("transitionend", finish);
    setTimeout(finish, 700);
  }

  function showAssistantOrb() {
    if (!state.doc || $("app-shell").hidden) return;
    const box = $("palette");
    if (!box || (box.classList.contains("open") && box.classList.contains("is-min"))) return;
    cancelAssistantIdle();
    box.classList.add("is-drag");
    placeAssistant(orbPoint());
    box.classList.add("open", "is-min");
    requestAnimationFrame(() => box.classList.remove("is-drag"));
    syncAssistantMinButton();
  }

  function ensureAssistant() {
    if (!state.doc || $("app-shell").hidden) return;
    if (!$("palette")?.classList.contains("open")) showAssistantOrb();
  }

  function bindAssistantWindow() {
    const box = $("palette");
    const head = $("palette-head");
    const grip = $("palette-resize");
    if (!box || !head || box.dataset.bound) return;
    box.dataset.bound = "1";
    $("palette-min")?.addEventListener("click", (e) => {
      e.stopPropagation();
      setAssistantMin(true);
    });
    box.addEventListener("click", (e) => {
      if (!box.classList.contains("is-min") || e.target.closest("button")) return;
      setAssistantMin(false);
    });
    box.addEventListener("pointerdown", () => wakeAssistant());
    box.addEventListener("focusin", () => {
      if (palette.pointerInside) cancelAssistantIdle();
    });
    box.addEventListener("focusout", () => {
      setTimeout(() => {
        if (palette.pointerInside) wakeAssistant();
        else if (assistantInputFocused()) return;
        else if (box.classList.contains("is-idle")) {
          clearTimeout(palette.idle);
          palette.idle = setTimeout(finishAssistantIdle, 2000);
        } else if (!box.contains(document.activeElement)) beginAssistantIdle();
      }, 0);
    });
    $("palette-input")?.addEventListener("input", (e) => {
      const input = $("palette-input");
      const removed = String(e.inputType || "").startsWith("delete");
      if (removed || !input?.value) return;
      cancelAssistantIdle();
    });
    document.addEventListener("pointerdown", (e) => {
      if (!box.classList.contains("open") || box.classList.contains("is-min") || palette.drag) return;
      if (assistantContainsPoint(e.clientX, e.clientY)) {
        palette.pointerInside = true;
        wakeAssistant();
        return;
      }
      palette.pointerInside = false;
      beginAssistantIdle();
    }, true);
    document.addEventListener("pointermove", (e) => {
      if (!box.classList.contains("open") || box.classList.contains("is-min")) {
        palette.pointerInside = false;
        return;
      }
      if (palette.drag || box.classList.contains("is-drag")) {
        palette.pointerInside = true;
        return;
      }
      const inside = assistantContainsPoint(e.clientX, e.clientY);
      if (inside) {
        const entered = !palette.pointerInside;
        palette.pointerInside = true;
        if (entered || box.classList.contains("is-idle") || !box.contains(document.activeElement)) wakeAssistant();
      } else if (palette.pointerInside) {
        palette.pointerInside = false;
        beginAssistantIdle();
      }
    });
    head.addEventListener("dblclick", (e) => {
      if (e.target.closest("button")) return;
      setAssistantMin(!box.classList.contains("is-min"));
    });
    head.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button")) return;
      e.preventDefault();
      const rect = box.getBoundingClientRect();
      palette.drag = { kind: "move", dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      box.classList.add("is-drag");
      head.setPointerCapture(e.pointerId);
    });
    grip?.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || box.classList.contains("is-min")) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = box.getBoundingClientRect();
      palette.drag = { kind: "resize", x: e.clientX, y: e.clientY, w: rect.width, h: rect.height };
      box.classList.add("is-drag");
      grip.setPointerCapture(e.pointerId);
    });
    const onMove = (e) => {
      const drag = palette.drag;
      if (!drag) return;
      if (drag.kind === "move") {
        const x = Math.max(8, Math.min(window.innerWidth - 80, e.clientX - drag.dx));
        const y = Math.max(8, Math.min(window.innerHeight - 40, e.clientY - drag.dy));
        box.style.left = `${x}px`;
        box.style.top = `${y}px`;
        box.style.right = "auto";
      } else {
        const next = clampAssistantSize(drag.w + e.clientX - drag.x, drag.h + e.clientY - drag.y);
        box.style.width = `${next.w}px`;
        box.style.height = `${next.h}px`;
      }
    };
    const onUp = (e) => {
      const kind = palette.drag?.kind;
      if (palette.drag) {
        const rect = box.getBoundingClientRect();
        persistAssistantFrame(
          kind === "move"
            ? { x: rect.left, y: rect.top, w: rect.width, h: rect.height, placed: true }
            : undefined
        );
      }
      palette.drag = null;
      box.classList.remove("is-drag");
      if (!wasDrag || !box.classList.contains("open") || box.classList.contains("is-min")) return;
      if (assistantContainsPoint(e.clientX, e.clientY)) {
        palette.pointerInside = true;
        wakeAssistant();
      } else {
        palette.pointerInside = false;
        beginAssistantIdle();
      }
    };
    window.addEventListener("resize", () => {
      if (box.classList.contains("open") && box.classList.contains("is-min") && !palette.drag) placeAssistant(orbPoint());
    });
    head.addEventListener("pointermove", onMove);
    head.addEventListener("pointerup", onUp);
    head.addEventListener("pointercancel", onUp);
    grip?.addEventListener("pointermove", onMove);
    grip?.addEventListener("pointerup", onUp);
    grip?.addEventListener("pointercancel", onUp);
  }

  function summonAssistant() {
    if (!state.doc || $("app-shell").hidden) return;
    const box = $("palette");
    if (!box.classList.contains("open")) showAssistantOrb();
    setAssistantMin(!box.classList.contains("is-min"));
  }

  function openPalette() {
    summonAssistant();
  }

  function closePalette() {
    cancelAssistantIdle();
    const box = $("palette");
    if (!box) return;
    box.classList.remove("open", "is-min", "is-idle", "is-drag");
  }

  function paletteIsOpen() {
    return $("palette").classList.contains("open");
  }

  function assistantCapturesUndo() {
    const box = $("palette");
    return !!box && box.classList.contains("open") && !box.classList.contains("is-min") && box.contains(document.activeElement);
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
    normalizeWorkDates(order);
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
    if (act === "line-done-all") {
      const lines = masterLines(order);
      if (!lines.length) return;
      setAllLinesCalendarDone(order, !lines.every((line) => lineCalendarDone(order, line)), lineFilterActive() ? new Set(lines.map((line) => line.id)) : null);
      markDirty();
      renderOrders();
      return;
    }
    if (act === "line-done") {
      const tr = e.target.closest("[data-line]");
      const line = order.lines.find((item) => item.id === tr?.dataset.line);
      if (!line || isExpenseLine(line)) return;
      toggleLineCalendarDone(order, line);
      markDirty();
      renderOrders();
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
      if (act === "work-end-today" && orderPlacedOnCalendar(order)) {
        toast("Конечную дату меняют, пока заказа нет в календаре");
        return;
      }
      setWorkToday(order, act === "work-start-today" ? "start" : "end");
      if (act === "work-end-today" && !dateDay(order.work_end)) toast("Есть позиция в работе — у заказа нет конечной даты");
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
        line.payment_date = dayKey(clockToday());
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
      copy.number = order.number;
      const name = String(order.name || "").trim();
      copy.name = name ? `${name} - копия` : "копия";
      copy.lines.forEach((l) => (l.id = uid()));
      state.doc.orders.push(copy);
      markDirty();
      renderOrders();
      requestAnimationFrame(() => {
        flashOrder(copy.id);
        const nameInput = orderCardBox(copy.id)?.querySelector('input[data-k="name"]');
        if (!nameInput) return;
        nameInput.focus();
        const end = nameInput.value.length;
        try { nameInput.setSelectionRange(end, end); } catch { /* ignore */ }
      });
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
      const tr = e.target.closest("tr.line-row[data-line]");
      const id = tr?.dataset.line;
      if (!id) return;
      if (order.lines.length <= 1) {
        toast("У заказа должна остаться хотя бы одна позиция. Удалите заказ целиком, если он не нужен.");
        return;
      }
      historyCommit();
      const lastCopy = removeOneLine(order, tr);
      if (lastCopy == null) return;
      if (lastCopy) window.FinCalc?.pruneOrderLinks?.(order.id, id);
      markDirty();
      renderOrders();
      undoToast("Строка удалена");
    }
  }

