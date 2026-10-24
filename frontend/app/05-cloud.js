  /* ==== Облако заказов: интерактивный граф ==== */
  const CLOUD_COLORS = ["#0f766e", "#2563eb", "#7c3aed", "#d97706", "#db2777", "#0891b2", "#059669", "#e11d48", "#4f46e5", "#ca8a04"];
  const GALAXY_TYPES = [
    ["spiral", "спиральная"],
    ["barred", "пересечённая"],
    ["elliptical", "эллиптическая"],
    ["lenticular", "линзовидная"],
    ["flocculent", "клочковатая"],
    ["irregular", "неправильная"],
  ];
  const GALAXY_COLORS = {
    spiral: "#84a4d6",
    barred: "#94aac8",
    elliptical: "#d6c4a8",
    lenticular: "#bab0a4",
    flocculent: "#769cd2",
    irregular: "#608ec4",
  };
  let orderCloud = null;
  let startCloud = null;
  let unsavedWait = null;

  function startViewMode() {
    try {
      return localStorage.getItem(LS_START_VIEW) === "galaxies" ? "galaxies" : "list";
    } catch {
      return "list";
    }
  }

  function persistStartView(mode) {
    try {
      localStorage.setItem(LS_START_VIEW, mode === "galaxies" ? "galaxies" : "list");
    } catch {
      /* ignore */
    }
  }

  function galaxyTypeFor(path) {
    return GALAXY_TYPES[cloudHash(path) % GALAXY_TYPES.length][0];
  }

  function galaxyVolume(item) {
    return Math.max(1, Number(item.lines) || 0, (Number(item.orders) || 0) * 2, (Number(item.bytes) || 0) / 2400);
  }

  function galaxyItems() {
    const lib = state.library?.items || [];
    const seen = new Set(lib.map((item) => String(item.path || "").replace(/\//g, "\\").toLowerCase()));
    const extra = (state.recentItems || []).filter((item) => {
      if (item.exists === false) return false;
      const key = String(item.path || "").replace(/\//g, "\\").toLowerCase();
      return key && !seen.has(key);
    });
    return [
      ...lib.map((item) => ({ ...item, origin: "library" })),
      ...extra.map((item) => ({ ...item, origin: "recent" })),
    ];
  }

  function galaxyGraphData(items = galaxyItems()) {
    const vols = items.map((item) => galaxyVolume(item));
    const peak = Math.max(1, ...vols);
    return {
      nodes: items.map((item) => {
        const type = galaxyTypeFor(item.path);
        const volume = galaxyVolume(item);
        const mass = Math.log1p(volume) / Math.log1p(peak);
        return {
          id: `galaxy:${item.path}`,
          kind: "galaxy",
          label: item.title || item.name || "Отчёт",
          path: item.path,
          origin: item.origin,
          galaxy: type,
          volume,
          orders: item.orders || 0,
          lines: item.lines || 0,
          value: item.value || 0,
          current: samePath(item.path, state.path),
          color: GALAXY_COLORS[type] || GALAXY_COLORS.spiral,
          radius: 26 + mass * 56,
        };
      }),
      edges: [],
    };
  }

  function cloudState() {
    if (!state.cloud) {
      state.cloud = {
        query: "",
        layout: "galaxy",
        color: "status",
        size: "amount",
        debtOnly: false,
        labels: true,
        motion: true,
        heat: false,
        space3d: false,
        catalog: false,
        ...loadStoredCloud(),
      };
      state.cloud.catalog = false;
    }
    return state.cloud;
  }

  function cloudHash(text) {
    let h = 0;
    for (const ch of String(text || "Без значения")) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
    return Math.abs(h);
  }

  function cloudCategoryColor(value) {
    return CLOUD_COLORS[cloudHash(value) % CLOUD_COLORS.length];
  }

  function cloudNodeColor(kind, item) {
    const mode = cloudState().color;
    if (kind === "customer") return mode === "debt" ? (item.debt > 0.005 ? "#dc2626" : "#059669") : cloudCategoryColor(item.customer);
    if (mode === "customer") return cloudCategoryColor(item.customer);
    if (mode === "type") return cloudCategoryColor(item.type || "Без типа");
    if (mode === "debt") {
      if (item.debt <= 0.005) return "#059669";
      if (item.paid > 0.005) return "#f59e0b";
      return "#dc2626";
    }
    return statusMeta(item.status || "Без статуса").color;
  }

  function cloudRadius(kind, item, maxima) {
    if (kind === "customer") {
      const factor = Math.min(1.45, Math.sqrt(Math.max(0, item.value) / Math.max(1, maxima.value)));
      return 17 + factor * 13;
    }
    if (kind === "order") {
      const factor = Math.min(1.25, Math.sqrt(Math.max(0, item.value) / Math.max(1, maxima.value)));
      return 10 + factor * 10;
    }
    const mode = cloudState().size;
    if (mode === "equal") return 6;
    const key = mode === "debt" ? "debt" : mode === "quantity" ? "quantity" : "value";
    const factor = Math.sqrt(Math.max(0, item[key]) / Math.max(1, maxima[key]));
    return 4.5 + factor * 9.5;
  }

  function cloudGraphData() {
    const query = cloudState().query.trim().toLocaleLowerCase("ru");
    const debtOnly = cloudState().debtOnly;
    const orderRows = [];
    (state.doc.orders || []).forEach((order) => {
      const orderText = [order.number, order.name, order.customer, order.notes].join(" ").toLocaleLowerCase("ru");
      const lines = (order.lines || []).filter((line) => {
        if (isFrozenLine(line)) return false;
        const t = lineTotals(line);
        if (t.expense) return false;
        if (debtOnly && t.unpaid <= 0.005) return false;
        if (!query || orderText.includes(query)) return true;
        return [line.product, line.order_type, line.status, line.unit].join(" ").toLocaleLowerCase("ru").includes(query);
      });
      if (lines.length) orderRows.push({ order, lines });
    });

    const maxima = { value: 1, debt: 1, quantity: 1 };
    orderRows.forEach(({ lines }) => lines.forEach((line) => {
      const t = lineTotals(line);
      maxima.value = Math.max(maxima.value, t.after);
      maxima.debt = Math.max(maxima.debt, t.unpaid);
      maxima.quantity = Math.max(maxima.quantity, Math.abs(qtyValue(line)));
    }));

    const customers = new Map();
    orderRows.forEach(({ order, lines }) => {
      const name = String(order.customer || "Без заказчика").trim() || "Без заказчика";
      if (!customers.has(name)) customers.set(name, { customer: name, orders: [], value: 0, paid: 0, debt: 0, positions: 0 });
      const c = customers.get(name);
      c.orders.push(order);
      lines.forEach((line) => {
        const t = lineTotals(line);
        c.value += t.after;
        c.paid += t.paid;
        c.debt += t.unpaid;
        c.positions += 1;
      });
    });

    const nodes = [];
    const edges = [];
    customers.forEach((c) => {
      const id = `customer:${c.customer}`;
      nodes.push({
        id,
        kind: "customer",
        label: c.customer,
        customer: c.customer,
        value: c.value,
        paid: c.paid,
        debt: c.debt,
        count: c.orders.length,
        positions: c.positions,
        color: cloudNodeColor("customer", c),
        radius: cloudRadius("customer", c, maxima),
      });
    });

    orderRows.forEach(({ order, lines }) => {
      const customer = String(order.customer || "Без заказчика").trim() || "Без заказчика";
      const totals = lines.reduce((acc, line) => {
        const t = lineTotals(line);
        acc.value += t.after;
        acc.paid += t.paid;
        acc.debt += t.unpaid;
        return acc;
      }, { value: 0, paid: 0, debt: 0 });
      const first = lines.find((line) => line.order_date) || lines[0];
      const statuses = unique(lines.map((line) => line.status).filter(Boolean));
      const types = unique(lines.map((line) => line.order_type).filter(Boolean));
      const orderNode = {
        id: `order:${order.id}`,
        rawId: order.id,
        kind: "order",
        parent: `customer:${customer}`,
        label: `${order.number || "—"} · ${order.name || "Без названия"}`,
        number: order.number || "—",
        name: order.name || "Без названия",
        customer,
        status: statuses.length === 1 ? statuses[0] : "Смешанные статусы",
        statuses,
        type: types.length === 1 ? types[0] : "Несколько типов",
        value: totals.value,
        paid: totals.paid,
        debt: totals.debt,
        count: lines.length,
        time: first?.order_date ? parseDay(first.order_date)?.getTime() ?? NaN : NaN,
      };
      orderNode.color = cloudNodeColor("order", orderNode);
      orderNode.radius = cloudRadius("order", orderNode, maxima);
      nodes.push(orderNode);
      edges.push({ source: orderNode.parent, target: orderNode.id, kind: "customer" });

      lines.forEach((line, index) => {
        const t = lineTotals(line);
        const lineNode = {
          id: `line:${order.id}:${line.id}`,
          rawId: line.id,
          orderId: order.id,
          kind: "line",
          parent: orderNode.id,
          label: line.product || line.order_type || `Позиция ${index + 1}`,
          product: line.product || "Без продукта",
          type: line.order_type || "Без типа",
          status: line.status || "Без статуса",
          customer,
          orderNumber: order.number || "—",
          orderName: order.name || "Без названия",
          value: t.after,
          paid: t.paid,
          debt: t.unpaid,
          quantity: Math.abs(qtyValue(line)),
          unit: line.unit || "",
          discount: t.discount,
          orderDate: line.order_date || "",
          paymentDate: line.payment_date || "",
          time: line.order_date ? parseDay(line.order_date)?.getTime() ?? orderNode.time : orderNode.time,
        };
        lineNode.color = cloudNodeColor("line", lineNode);
        lineNode.radius = cloudRadius("line", lineNode, maxima);
        nodes.push(lineNode);
        edges.push({ source: orderNode.id, target: lineNode.id, kind: "line" });
      });
    });
    return { nodes, edges, orderRows, customers };
  }

  function cloudPercent(paid, value) {
    return value > 0.005 ? Math.min(100, Math.round((paid / value) * 100)) : 0;
  }

  function renderCloudKpis(graph) {
    const orderNodes = graph.nodes.filter((node) => node.kind === "order");
    const lineNodes = graph.nodes.filter((node) => node.kind === "line");
    const value = lineNodes.reduce((sum, node) => sum + node.value, 0);
    const debt = lineNodes.reduce((sum, node) => sum + node.debt, 0);
    const paid = lineNodes.reduce((sum, node) => sum + node.paid, 0);
    $("cloud-kpis").innerHTML = `
      <div><span>Заказы</span><b>${orderNodes.length}</b></div>
      <div><span>Позиции</span><b>${lineNodes.length}</b></div>
      <div><span>Оборот</span><b>${esc(money(value))}</b></div>
      <div class="${debt > 0.005 ? "debt" : ""}"><span>Долг</span><b>${esc(money(debt))}</b><small>${cloudPercent(paid, value)}% собрано</small></div>`;
  }

  function renderCloudLegend(graph) {
    const mode = cloudState().color;
    let items;
    if (mode === "debt") {
      items = [["Оплачено", "#059669"], ["Частично", "#f59e0b"], ["Не оплачено", "#dc2626"]];
    } else {
      const key = mode === "customer" ? "customer" : mode === "type" ? "type" : "status";
      const map = new Map();
      graph.nodes.filter((node) => node.kind === "line").forEach((node) => {
        const name = node[key] || "Без значения";
        if (!map.has(name)) map.set(name, node.color);
      });
      items = [...map.entries()].slice(0, 9);
    }
    $("cloud-legend").innerHTML = [
      ...(cloudState().heat ? [`<span class="cloud-legend-heat" title="Цвет показывает, где сосредоточен долг"><i></i>тепло долга: слабый → сильный</span>`] : []),
      `<span class="cloud-legend-kind"><i class="customer"></i>звезда — заказчик</span>`,
      `<span class="cloud-legend-kind"><i class="order"></i>планета — заказ</span>`,
      `<span class="cloud-legend-kind"><i class="line"></i>спутник — позиция</span>`,
      `<span class="cloud-legend-link trunk" title="Стрелка и бегущие штрихи показывают направление">заказчик → заказ</span>`,
      `<span class="cloud-legend-link branch" title="От заказа к его позициям">заказ → позиция</span>`,
      `<span class="cloud-legend-link bridge" title="Пунктир между близкими заказчиками">связь заказчиков</span>`,
      ...items.map(([label, color]) => `<span title="${esc(label)}"><i style="background:${esc(color)}"></i>${esc(label)}</span>`),
    ].join("");
  }

  function cloudMetric(label, value, danger = false) {
    return `<div class="cloud-detail-metric${danger ? " danger" : ""}"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
  }

  function renderCloudInspector(node) {
    const box = $("cloud-inspector");
    if (!box) return;
    if (!node) {
      box.innerHTML = cloudState().catalog
        ? `<div class="cloud-inspector-idle">
        <div class="cloud-scan"><span></span></div>
        <strong>Выберите галактику</strong>
        <p>Каждый отчёт — отдельная галактика. Нажмите, чтобы влететь внутрь и открыть файл.</p>
      </div>`
        : `<div class="cloud-inspector-idle">
        <div class="cloud-scan"><span></span></div>
        <strong>Выберите объект</strong>
        <p>Наведите на узел для быстрой справки. Нажмите, чтобы зафиксировать подробности.</p>
      </div>`;
      return;
    }
    if (node.kind === "galaxy") {
      const typeLabel = (GALAXY_TYPES.find((row) => row[0] === node.galaxy) || ["", "галактика"])[1];
      const origin = node.origin === "recent" ? "Недавний файл" : "Папка FinMaster";
      box.innerHTML = `<div class="cloud-detail">
        <div class="cloud-detail-top"><span class="cloud-detail-dot" style="--node:${esc(node.color)}"></span><span>Галактика</span></div>
        <h3>${esc(node.label)}</h3>
        <p>${esc(origin)} · ${esc(typeLabel)}</p>
        <div class="cloud-detail-metrics">${cloudMetric("Заказы", String(node.orders || 0))}${cloudMetric("Позиции", String(node.lines || 0))}${cloudMetric("Оборот", money(node.value || 0))}</div>
        <div class="cloud-detail-row"><span>Файл</span><b>${esc(node.path || "—")}</b></div>
        <div class="cloud-detail-actions"><button class="btn primary" type="button" data-cloud-galaxy="${esc(node.path)}">${node.current ? "Войти в систему" : "Открыть отчёт"}</button></div>
      </div>`;
      return;
    }
    const kind = node.kind === "customer" ? "Заказчик" : node.kind === "order" ? "Заказ" : "Позиция";
    let meta = "";
    let metrics = "";
    let actions = "";
    if (node.kind === "customer") {
      meta = `${node.count} ${ordWord(node.count)} · ${node.positions} ${posWord(node.positions)}`;
      metrics = cloudMetric("Оборот", money(node.value)) + cloudMetric("Оплачено", money(node.paid)) + cloudMetric("Долг", money(node.debt), node.debt > 0.005);
      actions = `<button class="btn primary" type="button" data-cloud-customer="${esc(node.customer)}">Показать только связи</button>
        <button class="btn" type="button" data-cloud-focus="${esc(node.id)}">Центрировать</button>`;
    } else if (node.kind === "order") {
      meta = `${esc(node.customer)} · ${node.count} ${posWord(node.count)}`;
      metrics = cloudMetric("Сумма", money(node.value)) + cloudMetric("Оплачено", money(node.paid)) + cloudMetric("Долг", money(node.debt), node.debt > 0.005);
      actions = `<button class="btn primary" type="button" data-cloud-open="${esc(node.rawId)}">Открыть заказ</button>
        <button class="btn" type="button" data-cloud-snapshot="${esc(node.rawId)}">Снимок</button>
        <button class="btn" type="button" data-cloud-focus="${esc(node.id)}">Центрировать</button>`;
    } else {
      meta = `${esc(node.orderNumber)} · ${esc(node.orderName)}`;
      metrics = cloudMetric("Сумма", money(node.value)) + cloudMetric("Оплачено", money(node.paid)) + cloudMetric("Долг", money(node.debt), node.debt > 0.005);
      actions = `<button class="btn primary" type="button" data-cloud-open="${esc(node.orderId)}">Открыть заказ</button>
        <button class="btn" type="button" data-cloud-focus="${esc(node.id)}">Центрировать</button>`;
    }
    const progress = cloudPercent(node.paid, node.value);
    box.innerHTML = `<div class="cloud-detail">
      <div class="cloud-detail-top"><span class="cloud-detail-dot" style="--node:${esc(node.color)}"></span><span>${kind}</span></div>
      <h3>${esc(node.label)}</h3>
      <p>${meta}</p>
      <div class="cloud-detail-metrics">${metrics}</div>
      <div class="cloud-progress"><span style="width:${progress}%"></span></div>
      <div class="cloud-progress-label"><span>Собираемость</span><b>${progress}%</b></div>
      ${node.status ? `<div class="cloud-detail-row"><span>Статус</span><b>${esc(node.status)}</b></div>` : ""}
      ${node.type ? `<div class="cloud-detail-row"><span>Тип</span><b>${esc(node.type)}</b></div>` : ""}
      ${node.quantity != null ? `<div class="cloud-detail-row"><span>Количество</span><b>${esc(String(node.quantity))} ${esc(node.unit || "")}</b></div>` : ""}
      ${node.orderDate ? `<div class="cloud-detail-row"><span>Дата заказа</span><b>${esc(cashDateText(parseDay(node.orderDate)))}</b></div>` : ""}
      <div class="cloud-detail-actions">${actions}</div>
    </div>`;
  }

  function renderCloudTooltip(node, point) {
    const tip = $("cloud-tooltip");
    if (!tip) return;
    if (!node || !point) {
      tip.hidden = true;
      return;
    }
    const kind = node.kind === "galaxy" ? "Галактика" : node.kind === "customer" ? "Заказчик" : node.kind === "order" ? "Заказ" : "Позиция";
    const extra = node.kind === "galaxy"
      ? `${node.origin === "recent" ? "недавний" : "FinMaster"} · ${node.orders || 0} зак.`
      : `${esc(money(node.value))}${node.debt > 0.005 ? ` · долг ${esc(money(node.debt))}` : ""}`;
    tip.innerHTML = `<small>${kind}</small><b>${esc(node.label)}</b><span>${extra}</span>`;
    tip.hidden = false;
    const wrap = $("cloud-canvas-wrap").getBoundingClientRect();
    const tw = tip.offsetWidth || 220;
    const th = tip.offsetHeight || 72;
    tip.style.left = `${Math.max(10, Math.min(wrap.width - tw - 10, point.x + 16))}px`;
    tip.style.top = `${Math.max(10, Math.min(wrap.height - th - 10, point.y + 16))}px`;
  }

  function ensureOrderCloud() {
    if (orderCloud || !window.FinOrderCloud || !$("cloud-canvas")) return orderCloud;
    orderCloud = window.FinOrderCloud.create({
      canvas: $("cloud-canvas"),
      minimap: $("cloud-minimap"),
      onHover: renderCloudTooltip,
      onSelect: renderCloudInspector,
      onOpen: (node) => {
        if (node.kind === "galaxy") {
          openGalaxy(node);
          return;
        }
        const id = node.kind === "order" ? node.rawId : node.kind === "line" ? node.orderId : null;
        if (id) gotoOrder(id);
      },
      onTransform: ({ zoom }) => {
        if ($("cloud-zoom-value")) $("cloud-zoom-value").textContent = `${Math.round(zoom * 100)}%`;
      },
    });
    return orderCloud;
  }

  function syncCloudControls() {
    const s = cloudState();
    if ($("cloud-search") && document.activeElement !== $("cloud-search")) $("cloud-search").value = s.query;
    if ($("cloud-layout")) $("cloud-layout").value = s.layout;
    if ($("cloud-color")) $("cloud-color").value = s.color;
    if ($("cloud-size")) $("cloud-size").value = s.size;
    if ($("cloud-debt")) $("cloud-debt").checked = !!s.debtOnly;
    $("cloud-labels")?.setAttribute("aria-pressed", String(s.labels !== false));
    $("cloud-motion")?.setAttribute("aria-pressed", String(s.motion !== false));
    $("cloud-heat")?.setAttribute("aria-pressed", String(!!s.heat));
    $("cloud-heat")?.classList.toggle("active", !!s.heat);
    $("cloud-3d")?.setAttribute("aria-pressed", String(!!s.space3d));
    $("cloud-3d")?.classList.toggle("active", !!s.space3d);
    if ($("cloud-motion")) $("cloud-motion").textContent = s.motion === false ? "Ⅱ" : "◉";
    const hint = $("cloud-hint");
    if (hint) {
      hint.innerHTML = s.catalog
        ? `<b>Галактики</b> двойной клик — войти в отчёт · <b>левая</b> обзор · <b>средняя</b> сдвиг · <b>колесо</b> масштаб`
        : s.space3d
        ? `<b>3D</b> левая — обзор · <b>средняя</b> сдвиг · <b>колесо</b> масштаб · <b>узел</b> сдвинуть · <b>двойной клик</b> открыть · <b>T</b> автотур`
        : `<b>Стрелка</b> заказчик → заказ → позиция · <b>колесо</b> масштаб · <b>drag</b> карта · <b>узел</b> сдвинуть · <b>двойной клик</b> открыть · <b>T</b> автотур · <b>Esc</b> свернуть карту`;
    }
    $("cloud-canvas-wrap")?.classList.toggle("space-3d", !!s.space3d || !!s.catalog);
  }

  function heatFociWord(n) {
    const abs = Math.abs(Math.round(n)) % 100;
    const tail = abs % 10;
    if (abs > 10 && abs < 20) return "очагов";
    if (tail === 1) return "очаг";
    if (tail >= 2 && tail <= 4) return "очага";
    return "очагов";
  }

  function syncCloudHeatScale(graph) {
    const on = !!cloudState().heat;
    const empty = $("cloud-empty") && !$("cloud-empty").hidden;
    const el = $("cloud-heat-scale");
    if (el) el.hidden = !on || empty;
    $("cloud-canvas-wrap")?.classList.toggle("heat-on", on);
    const sum = $("cloud-heat-sum");
    if (!sum || !on) return;
    const nodes = (graph || cloudGraphData()).nodes || [];
    const debt = nodes.filter((n) => n.kind === "line").reduce((acc, n) => acc + (n.debt || 0), 0);
    const foci = nodes.filter((n) => n.kind === "customer" && (n.debt || 0) > 0.01).length;
    sum.textContent = debt > 0.01
      ? `в кадре ${money(debt)}${foci ? ` · ${foci} ${heatFociWord(foci)}` : ""}`
      : "неоплаченных позиций нет";
  }

  function renderGalaxyCloud() {
    syncCloudControls();
    const items = galaxyItems();
    const graph = galaxyGraphData(items);
    $("cloud-kpis").innerHTML = `
      <div><span>Галактики</span><b>${items.length}</b></div>
      <div><span>FinMaster</span><b>${items.filter((item) => item.origin === "library").length}</b></div>
      <div><span>Недавние</span><b>${items.filter((item) => item.origin === "recent").length}</b></div>`;
    $("cloud-legend").innerHTML = [
      `<span class="cloud-legend-kind"><i class="customer"></i>галактика — отчёт</span>`,
      `<span class="cloud-legend-link trunk" title="Файлы из папки Documents/FinMaster">папка FinMaster</span>`,
      `<span class="cloud-legend-link bridge" title="Недавние файлы вне папки">недавние вне папки</span>`,
      ...GALAXY_TYPES.map(([id, label]) => `<span title="${esc(label)}"><i style="background:${esc(GALAXY_COLORS[id])}"></i>${esc(label)}</span>`),
    ].join("");
    const empty = !items.length;
    $("cloud-empty").hidden = !empty;
    $("cloud-canvas")?.classList.toggle("is-empty", empty);
    if (empty) {
      const title = $("cloud-empty").querySelector("strong");
      const note = $("cloud-empty").querySelector(":scope > span");
      const add = $("cloud-add-order");
      if (title) title.textContent = "Галактик пока нет";
      if (note) note.textContent = "Сохраните отчёт в папку FinMaster или откройте файл — он появится здесь.";
      if (add) add.hidden = true;
    }
    const el = $("cloud-heat-scale");
    if (el) el.hidden = true;
    const engine = ensureOrderCloud();
    engine?.update(graph, {
      catalog: true,
      labels: true,
      motion: cloudState().motion !== false,
      heat: false,
      space3d: true,
      query: cloudState().query,
      openOnClick: false,
    });
    $("cloud-tech").textContent = `${items.length} галактик · размер по объёму отчёта · 3D`;
    renderCloudInspector(orderCloud?.selected?.data || null);
  }

  function renderCloud() {
    const catalog = !!cloudState().catalog;
    $("cloud-board")?.classList.toggle("is-catalog", catalog);
    $("cloud-galaxies")?.setAttribute("aria-pressed", String(catalog));
    $("cloud-galaxies")?.classList.toggle("active", catalog);
    if ($("cloud-title")) {
      $("cloud-title").innerHTML = catalog
        ? `Галактики <span class="cloud-live"><i></i> отчёты</span>`
        : `Облако заказов <span class="cloud-live"><i></i> живая физика</span>`;
    }
    if ($("cloud-eyebrow")) $("cloud-eyebrow").textContent = catalog ? "REPORT GALAXIES" : "LIVE RELATIONSHIP ENGINE";
    if ($("cloud-search")) $("cloud-search").placeholder = catalog ? "Название отчёта…" : "Номер, заказчик, работа, продукт…";
    if (catalog) {
      renderGalaxyCloud();
      return;
    }
    syncCloudControls();
    const graph = cloudGraphData();
    renderCloudKpis(graph);
    renderCloudLegend(graph);
    const empty = !$("cloud-canvas") || graph.nodes.length === 0;
    $("cloud-empty").hidden = !empty;
    $("cloud-canvas").classList.toggle("is-empty", empty);
    if (empty) {
      const hasOrders = (state.doc.orders || []).length > 0;
      const title = $("cloud-empty").querySelector("strong");
      const note = $("cloud-empty").querySelector(":scope > span");
      const add = $("cloud-add-order");
      if (title) title.textContent = hasOrders ? "Совпадений не найдено" : "Облако пока пусто";
      if (note) note.textContent = hasOrders ? "Измените запрос или выключите фильтр долгов." : "Добавьте первый заказ — связи появятся здесь автоматически.";
      if (add) add.hidden = hasOrders;
    }
    syncCloudHeatScale(graph);
    const engine = ensureOrderCloud();
    engine?.update(graph, {
      layout: cloudState().layout,
      labels: cloudState().labels,
      motion: cloudState().motion,
      heat: cloudState().heat,
      space3d: cloudState().space3d,
      query: cloudState().query,
      catalog: false,
      openOnClick: false,
    });
    $("cloud-tech").textContent = `${graph.nodes.length} узлов · ${graph.edges.length} связей · MST-созвездия · ${cloudState().space3d ? "3D" : "2D"}${cloudState().heat ? " · тепло долга" : ""}`;
    if (state.focusLineId) applyCloudFocus({ fly: false });
  }

  function bindCloud() {
    let searchTimer = 0;
    $("cloud-search")?.addEventListener("input", (e) => {
      cloudState().query = e.target.value;
      syncSearchClear(e.target);
      renderCloud();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => orderCloud?.fit(), 180);
    });
    $("cloud-layout")?.addEventListener("change", (e) => {
      cloudState().layout = e.target.value;
      persistCloudPrefs();
      orderCloud?.setOptions({ layout: e.target.value });
      setTimeout(() => orderCloud?.fit(), 140);
    });
    $("cloud-color")?.addEventListener("change", (e) => {
      cloudState().color = e.target.value;
      persistCloudPrefs();
      renderCloud();
    });
    $("cloud-size")?.addEventListener("change", (e) => {
      cloudState().size = e.target.value;
      persistCloudPrefs();
      renderCloud();
    });
    $("cloud-debt")?.addEventListener("change", (e) => {
      cloudState().debtOnly = e.target.checked;
      persistCloudPrefs();
      renderCloud();
      setTimeout(() => orderCloud?.fit(), 100);
    });
    $("cloud-labels")?.addEventListener("click", (e) => {
      cloudState().labels = !cloudState().labels;
      persistCloudPrefs();
      e.currentTarget.setAttribute("aria-pressed", String(cloudState().labels));
      orderCloud?.setOptions({ labels: cloudState().labels });
    });
    $("cloud-motion")?.addEventListener("click", (e) => {
      cloudState().motion = !cloudState().motion;
      persistCloudPrefs();
      e.currentTarget.setAttribute("aria-pressed", String(cloudState().motion));
      e.currentTarget.textContent = cloudState().motion ? "◉" : "Ⅱ";
      orderCloud?.setOptions({ motion: cloudState().motion });
    });
    $("cloud-heat")?.addEventListener("click", (e) => {
      cloudState().heat = !cloudState().heat;
      persistCloudPrefs();
      e.currentTarget.setAttribute("aria-pressed", String(cloudState().heat));
      e.currentTarget.classList.toggle("active", cloudState().heat);
      orderCloud?.setOptions({ heat: cloudState().heat });
      syncCloudHeatScale();
      renderCloudLegend(cloudGraphData());
    });
    $("cloud-3d")?.addEventListener("click", (e) => {
      cloudState().space3d = !cloudState().space3d;
      persistCloudPrefs();
      e.currentTarget.setAttribute("aria-pressed", String(cloudState().space3d));
      e.currentTarget.classList.toggle("active", cloudState().space3d);
      orderCloud?.setOptions({ space3d: cloudState().space3d });
      syncCloudControls();
    });
    $("cloud-galaxies")?.addEventListener("click", () => {
      cloudState().catalog = !cloudState().catalog;
      renderCloud();
      setTimeout(() => orderCloud?.fit(), 80);
    });
    $("cloud-tour")?.addEventListener("click", () => {
      if (!orderCloud?.startTour()) toast("Для автотура нужны заказы или долги");
      else toast("Автотур по очагам долга · Esc остановить");
    });
    $("cloud-fit")?.addEventListener("click", () => orderCloud?.fit());
    $("cloud-zoom-in")?.addEventListener("click", () => orderCloud?.zoomAt(1.22));
    $("cloud-zoom-out")?.addEventListener("click", () => orderCloud?.zoomAt(1 / 1.22));
    $("cloud-fs")?.addEventListener("click", () => toggleCloudFullscreen());
    $("cloud-add-order")?.addEventListener("click", () => {
      state.doc.orders.push(emptyOrder());
      markDirty();
      gotoOrder(state.doc.orders[state.doc.orders.length - 1].id);
    });
    $("cloud-inspector")?.addEventListener("click", (e) => {
      const open = e.target.closest("[data-cloud-open]");
      const snapshot = e.target.closest("[data-cloud-snapshot]");
      const customer = e.target.closest("[data-cloud-customer]");
      const focus = e.target.closest("[data-cloud-focus]");
      const galaxy = e.target.closest("[data-cloud-galaxy]");
      if (open) gotoOrder(open.dataset.cloudOpen);
      else if (galaxy) openGalaxy({ path: galaxy.dataset.cloudGalaxy, id: `galaxy:${galaxy.dataset.cloudGalaxy}` });
      else if (snapshot) openShare(findOrder(snapshot.dataset.cloudSnapshot));
      else if (focus) orderCloud?.focus(focus.dataset.cloudFocus);
      else if (customer) {
        cloudState().query = customer.dataset.cloudCustomer;
        $("cloud-search").value = cloudState().query;
        renderCloud();
        setTimeout(() => orderCloud?.fit(), 100);
      }
    });
    document.addEventListener("fullscreenchange", syncCloudFullscreen);
    document.addEventListener("webkitfullscreenchange", syncCloudFullscreen);
  }

  function calculatorApi() {
    return {
      doc: () => state.doc,
      view: () => state.view,
      uid,
      money,
      toast,
      markDirty,
      orders: () => state.doc?.orders || [],
      findOrder,
      lineTotals,
      orderTotals,
      isFrozen: isFrozenLine,
      isExpense: isExpenseLine,
      taxMode,
      qtyValue,
      lineUnitPrice: (line) => Math.max(0, numExpr(line, "price_expr", "price")),
      statuses: () => (state.doc?.statuses || []).map((s) => s.name),
      orderTypes: () => typeNames(),
      products: () => {
        const seen = new Set();
        const out = [];
        const add = (raw) => {
          const name = String(raw || "").trim().replace(/\s+/g, " ");
          if (!name) return;
          const key = catalogNameKey(name);
          if (seen.has(key)) return;
          seen.add(key);
          out.push(name);
        };
        catalogProductNames("all").forEach(add);
        (state.doc?.orders || []).forEach((order) => {
          (order.lines || []).forEach((line) => add(line.product));
        });
        return out.sort((a, b) => a.localeCompare(b, "ru", { sensitivity: "base" }));
      },
      customers: () => unique((state.doc?.orders || []).map((o) => o.customer).filter(Boolean)),
      calcStats: (opts) => calcNodeStats(opts || {}),
      presentValue: (blockId, portId) => window.FinCalc?.presentValue?.(blockId, portId) ?? null,
      refreshOrders: () => {
        if (state.view === "orders") renderOrders();
        else updateOrdersSummary?.();
      },
      askConfirm,
      formulaProfiles: () => {
        try {
          const list = JSON.parse(localStorage.getItem("finmaster.formulaProfiles") || "[]");
          return Array.isArray(list) ? list : [];
        } catch {
          return [];
        }
      },
      saveFormulaProfiles: (list) => persistPref("finmaster.formulaProfiles", JSON.stringify(list), { now: true }),
      copyText: async (text) => {
        if (state.desktop) await apiPost("/api/clipboard-text", { text });
        else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
        else throw new Error("clipboard");
      },
    };
  }

  function presentationApi() {
    return {
      doc: () => state.doc,
      view: () => state.view,
      uid,
      money,
      markDirty,
      presentValue: (blockId, portId) => window.FinCalc?.presentValue?.(blockId, portId) ?? null,
    };
  }

  function calcNodeStats(opts) {
    const customers = (Array.isArray(opts.customers) ? opts.customers : opts.customer ? [opts.customer] : [])
      .map((name) => String(name || "").trim().toLowerCase())
      .filter(Boolean);
    const orderIds = (Array.isArray(opts.orderIds) ? opts.orderIds : opts.orderId ? [opts.orderId] : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean);
    const period = opts.period || "all";
    const payFilters = (Array.isArray(opts.payFilters) ? opts.payFilters : opts.payFilter && opts.payFilter !== "all" ? [opts.payFilter] : [])
      .map((id) => String(id || "").trim())
      .filter((id) => id && id !== "all");
    const statuses = (Array.isArray(opts.statuses) ? opts.statuses : opts.status ? [opts.status] : [])
      .map((name) => String(name || "").trim())
      .filter(Boolean);
    const orderTypes = (Array.isArray(opts.orderTypes) ? opts.orderTypes : opts.orderType ? [opts.orderType] : [])
      .map((name) => String(name || "").trim())
      .filter(Boolean);
    const products = (Array.isArray(opts.products) ? opts.products : opts.product ? [opts.product] : [])
      .map((name) => String(name || "").trim())
      .filter(Boolean);
    const dateFrom = dateDay(opts.dateFrom);
    const dateTo = dateDay(opts.dateTo);
    let rows = allRows();
    if (orderIds.length) {
      const idSet = new Set(orderIds);
      rows = rows.filter(({ order }) => idSet.has(order.id));
    }
    if (customers.length) {
      const set = new Set(customers);
      rows = rows.filter(({ order }) => set.has(String(order.customer || "").toLowerCase()));
    }
    if (statuses.length) {
      const set = new Set(statuses);
      rows = rows.filter(({ line }) => set.has(line.status));
    }
    if (orderTypes.length) {
      const set = new Set(orderTypes);
      rows = rows.filter(({ line }) => set.has(line.order_type));
    }
    if (products.length) {
      const set = new Set(products);
      rows = rows.filter(({ line }) => set.has(line.product));
    }
    if (payFilters.length) {
      rows = rows.filter(({ order }) => payFilters.some((filter) => orderFilterMatch(order, filter)));
    }
    if (period === "range") {
      rows = rows.filter(({ line }) => {
        const d = dateDay(line.order_date);
        if (!d) return false;
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        return true;
      });
    } else if (period && period !== "all") {
      rows = rows.filter(({ line }) => dashPeriodMatch(line.order_date, period));
    }
    const s = summarize(rows);
    const active = rows.filter(({ line }) => !/отмен|аннул|черн/i.test(line.status));
    const as = summarize(active);
    const now = new Date();
    const curKey = monthKeyOf(now.toISOString());
    let monthAfter = 0;
    let monthCost = 0;
    rows.forEach(({ line, totals }) => {
      if (monthKeyOf(line.order_date) !== curKey) return;
      if (totals.expense) monthCost += totals.cost;
      else monthAfter += totals.after;
    });
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate() || 1;
    const monthAgo = localStamp(new Date(now.getTime() - 30 * 86400000));
    const overdueRows = rows.filter(({ line, totals }) => totals.unpaid > 0.005 && line.order_date && dateDay(line.order_date) < monthAgo);
    const overdueSum = overdueRows.reduce((acc, r) => acc + r.totals.unpaid, 0);
    const orderSums = new Map();
    rows.forEach(({ order, totals }) => {
      if (totals.expense) return;
      orderSums.set(order.id, (orderSums.get(order.id) || 0) + totals.after);
    });
    const paidOrders = [...orderSums.values()].filter((v) => v > 0);
    const avgCheck = paidOrders.length ? paidOrders.reduce((a, b) => a + b, 0) / paidOrders.length : 0;
    return {
      orders: s.orderCount,
      lines: s.count,
      after: s.after,
      afterActive: as.after,
      paid: s.paid,
      unpaid: s.unpaid,
      total: s.total,
      cost: s.cost,
      costCount: s.costCount,
      net: s.net,
      paidShare: s.after ? Math.round((s.paid / s.after) * 100) : 0,
      avgCheck,
      overdue: overdueRows.length,
      overdueSum,
      monthAfter,
      monthCost,
      forecast: monthAfter ? (monthAfter / dayOfMonth) * daysInMonth : 0,
    };
  }

  function renderCalculator() {
    window.FinCalc?.render(calculatorApi());
  }

  function bindCalculator() {
    window.FinCalc?.bind(calculatorApi());
  }

  function renderPresentation() {
    window.FinCalc?.syncPresentValues?.(calculatorApi());
    window.FinPresent?.render(presentationApi());
  }

  function bindPresentation() {
    window.FinPresent?.bind(presentationApi());
  }

  function vaultApi() {
    return {
      doc: () => state.doc,
      view: () => state.view,
      uid,
      money,
      markDirty,
      toast,
      confirm: askConfirm,
    };
  }

  function renderVault() {
    window.FinVault?.render(vaultApi());
  }

  function bindVault() {
    window.FinVault?.bind(vaultApi());
  }

  function cloudFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function cloudFullscreenOn() {
    const board = $("cloud-board");
    const el = cloudFullscreenElement();
    return !!board && (el === board || board.contains(el));
  }

  async function toggleCloudFullscreen(force) {
    const board = $("cloud-board");
    if (!board) return;
    try {
      if (force === false || (force == null && cloudFullscreenOn())) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) await exit.call(document);
      } else if (!cloudFullscreenOn()) {
        const enter = board.requestFullscreen || board.webkitRequestFullscreen;
        if (enter) await enter.call(board);
      }
    } catch {
      toast("Полноэкранный режим недоступен в этом окне");
    }
  }

  function syncCloudFullscreen() {
    const on = cloudFullscreenOn();
    $("cloud-board")?.classList.toggle("is-fullscreen", on);
    $("cloud-stage")?.classList.toggle("is-fullscreen", on);
    const fs = $("cloud-fs");
    fs?.classList.toggle("on", on);
    fs?.setAttribute("aria-pressed", String(on));
    fs?.setAttribute("title", on ? "Вернуться в окно" : "Развернуть карту");
    fs?.setAttribute("aria-label", on ? "Вернуться в окно" : "Развернуть карту");
    requestAnimationFrame(() => orderCloud?.resize?.());
  }

  function renderCatalogs() {
    const statusNames = (state.doc.statuses || []).map((s) => s.name);
    $("status-list").innerHTML = (state.doc.statuses || [])
      .map((s, i) => {
        const used = statusUsage(s.name);
        return `<div class="list-item" data-i="${i}">
        <button type="button" class="item-drag" title="Перетащить"><span></span></button>
        <input type="color" data-ck="color" value="${esc(toHex(s.color))}" />
        <input data-ck="name" value="${esc(s.name)}"${catalogNameAttrs(statusNames, s.name, i)} />
        <label class="paid-toggle" title="Статус полной оплаты"><input type="radio" name="paid-status-flag" data-ck="is_paid" ${s.is_paid ? "checked" : ""} /> Оплачено</label>
        <button type="button" class="lock-btn ${s.locked ? "on" : ""}" data-cact="lock" title="${s.locked ? "Снять замок" : "Замок: не менять глобальным статусом"}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.8"/>
            <path d="${s.locked ? "M8 11V8a4 4 0 0 1 8 0v3" : "M8 11V8a4 4 0 0 1 7.5-2"}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </button>
        ${catalogDelBtn("data-cact=\"del\"", used)}
      </div>`;
      })
      .join("");
    const unitNames = state.doc.units || [];
    $("unit-list").innerHTML = unitNames
      .map((u, i) => {
        const used = unitUsage(u);
        return `<div class="list-item" data-i="${i}"><button type="button" class="item-drag" title="Перетащить"><span></span></button><input data-uk value="${esc(u)}"${catalogNameAttrs(
          unitNames,
          u,
          i
        )} />${catalogDelBtn("data-uact=\"del\"", used, "поз./шабл.")}</div>`;
      })
      .join("");
    const typeNamesList = (state.doc.order_types || []).map((t) => typeEntry(t).name);
    $("type-list").innerHTML = (state.doc.order_types || [])
      .map(typeEntry)
      .map((t, i) => {
        const used = orderTypeUsage(t.name);
        return `<div class="list-item type-item ${t.is_tax || t.is_cost ? "is-expense" : ""}" data-i="${i}">
        <button type="button" class="item-drag" title="Перетащить"><span></span></button>
        <input data-tk value="${esc(t.name)}"${catalogNameAttrs(typeNamesList, t.name, i)} />
        ${catalogDelBtn("data-tact=\"del\"", used)}
        <div class="type-flags">
          <label class="type-flag tax ${t.is_tax ? "on" : ""}" title="Строки этого типа вычитаются из суммы заказа как налог">
            <input type="checkbox" data-ck="is_tax" ${t.is_tax ? "checked" : ""} /><span>Налог</span>
          </label>
          <label class="type-flag ${t.is_cost ? "on" : ""}" title="Строки этого типа вычитаются из суммы заказа как затрата">
            <input type="checkbox" data-ck="is_cost" ${t.is_cost ? "checked" : ""} /><span>Затрата</span>
          </label>
          <span class="type-flag-note">${
            t.is_tax ? "процент можно задать в строке заказа" : t.is_cost ? "вычитается из заказа" : "обычная выручка"
          }</span>
        </div>
      </div>`;
      })
      .join("");
    syncProductsFromOrders();
    const units = state.doc.units || [];
    const tab = productKind({ kind: state.productCatalogTab || "order" });
    state.productCatalogTab = tab;
    const tabMeta = {
      order: {
        hint: "Шаблоны доходных позиций: ед. и цена подставляются при выборе. Удалить можно только шаблон, который нигде не используется.",
        add: "+ Продукт",
      },
      cost: {
        hint: "Шаблоны затрат для расходных строк. Удалить можно только шаблон, который нигде не используется.",
        add: "+ Затрата",
      },
      tax: {
        hint: "Шаблоны налогов: ед., сумма и % по умолчанию. Удалить можно только шаблон, который нигде не используется.",
        add: "+ Налог",
      },
    };
    const hintEl = $("product-catalog-hint");
    if (hintEl) hintEl.textContent = tabMeta[tab].hint;
    const addBtn = $("btn-add-product");
    if (addBtn) addBtn.textContent = tabMeta[tab].add;
    document.querySelectorAll("[data-product-tab]").forEach((btn) => {
      btn.classList.toggle("is-on", btn.dataset.productTab === tab);
      btn.setAttribute("aria-selected", btn.dataset.productTab === tab ? "true" : "false");
    });
    const filtered = (state.doc.products || [])
      .map((p, i) => ({ p: productEntry(p), i }))
      .filter(({ p }) => p.kind === tab);
    const productNames = filtered.map(({ p }) => p.name);
    $("product-catalog").innerHTML = filtered
      .map(({ p, i }, row) => {
        const unitOpts = unique([p.unit, ...units]);
        const used = productTemplateUsage(p.name, tab);
        const taxField =
          tab === "tax"
            ? `<input data-pt inputmode="decimal" placeholder="%" title="% по умолчанию" value="${
                p.tax_percent ? esc(formatQty(p.tax_percent)) : ""
              }" />`
            : "";
        const delBtn = catalogDelBtn('data-pact="del"', used);
        return `<div class="list-item" data-i="${i}" data-kind="${esc(tab)}"><button type="button" class="item-drag" title="Перетащить"><span></span></button><input data-pk value="${esc(p.name)}"${catalogNameAttrs(
          productNames,
          p.name,
          row
        )} /><select data-pu title="Ед. по умолчанию">${optionList(unitOpts, p.unit)}</select><input data-pp inputmode="decimal" placeholder="${
          tab === "tax" ? "Сумма" : "Цена"
        }" title="${tab === "order" ? "Цена по умолчанию" : "Сумма за ед. по умолчанию"}" value="${
          p.price ? esc(formatQty(p.price)) : ""
        }" />${taxField}${delBtn}</div>`;
      })
      .join("");
  }

  function toHex(color) {
    if (!color) return "#64748b";
    if (color.startsWith("#") && color.length === 7) return color;
    return "#64748b";
  }

  function normalizeOrderTypes() {
    if (!state.doc) return;
    const seen = new Set();
    const next = [];
    for (const item of state.doc.order_types || []) {
      const entry = typeEntry(item);
      const key = catalogNameKey(entry.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      next.push(entry);
    }
    state.doc.order_types = next;
  }

  function renderAll() {
    if (!state.doc) return;
    normalizeOrderTypes();
    normalizeProducts();
    FinCharts.setCurrency(state.doc.currency || "₽");
    FinCharts.setMoneyDecimals?.(moneyDecimals());
    syncMoneyFmt(moneyDecimals());
    updateChrome();
    fillFilterSelects();
    if (state.view === "dashboard") renderDashboard();
    if (state.view === "orders") renderOrders();
    if (state.view === "analytics") renderAnalytics();
    if (state.view === "cashflow") renderCashflow();
    if (state.view === "forecast") renderForecast();
    if (state.view === "calendar") renderCalendar();
    if (state.view === "calculator") renderCalculator();
    if (state.view === "presentation") renderPresentation();
    if (state.view === "cloud") renderCloud();
    if (state.view === "vault") renderVault();
    if (state.view === "catalogs") renderCatalogs();
    if (state.view === "customers") renderCustomers();
    else {
      syncCustomersFromOrders();
      const list = state.doc.customers || [];
      $("customer-list").innerHTML = unique(list.map((c) => c.name)).map((c) => `<option value="${esc(c)}">`).join("");
    }
    refreshAssistant();
    applySidebar();
  }

  function findOrder(id) {
    return state.doc.orders.find((o) => o.id === id);
  }

  const VIEW_SCROLL = new Set(["dashboard", "orders", "analytics", "cashflow", "forecast", "vault", "customers", "catalogs"]);
  const viewScroll = {};

  function setView(name) {
    const content = document.querySelector(".content");
    if (content && VIEW_SCROLL.has(state.view)) viewScroll[state.view] = content.scrollTop;
    closeProductSuggest();
    if (name !== "cloud") orderCloud?.stopTour();
    if (name !== "calculator") {
      const panel = document.getElementById("calc-present-panel");
      if (panel) panel.hidden = true;
      $("calc-present-btn")?.classList.remove("is-on");
    }
    state.view = name;
    rememberReportView(state.path, name);
    document.querySelectorAll(".nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
    if (name === "analytics" && !$("c-a-from").value && !$("c-b-from").value) {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0);
      const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0);
      const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      setDT("c-b-from", prevStart);
      setDT("c-b-to", prevEnd);
      setDT("c-a-from", monthStart);
      setDT("c-a-to", now);
    }
    renderAll();
    if (content && VIEW_SCROLL.has(name)) content.scrollTop = viewScroll[name] || 0;
    if (name === "cloud") {
      applyCloudFocus({ fly: true });
      requestAnimationFrame(() => orderCloud?.resize?.());
    }
    if (name === "calculator") requestAnimationFrame(() => renderCalculator());
    if (name === "presentation") requestAnimationFrame(() => renderPresentation());
  }

  function createNew() {
    state.doc = emptyDoc();
    persistCloudPrefs();
    persistChartPrefs();
    state.path = null;
    state.preview = false;
    previewReturn = "";
    historyReset("Новый отчёт");
    setClean();
    applyPreviewMode();
    showApp();
    setView("orders");
  }

  async function openFromDialog() {
    if (state.desktop) {
      try {
        const res = await apiPost("/api/dialog/open", {});
        if (res.cancelled) return;
        applyLoaded(res);
        return;
      } catch (err) {
        toast(String(err.message || err));
        $("file-input").click();
        return;
      }
    }
    $("file-input").click();
  }

  function rememberDeskBase(doc, path) {
    if (!window.FM_DESK || !doc) return;
    try {
      window.FM_DESK_BASE = {
        path: path || "",
        modified: String(doc.modified_at || ""),
        doc: JSON.parse(JSON.stringify(doc)),
      };
    } catch {
      window.FM_DESK_BASE = null;
    }
  }

  function applyLoaded(res, { keepView = false, view = "" } = {}) {
    const stay = keepView && !!state.view && $("app-shell") && !$("app-shell").hidden;
    const next = view || (stay ? state.view : reportViewFor(res.path) || "dashboard");
    const opened = String(state.path || "");
    const real = opened && !opened.toLowerCase().endsWith(".fbak") ? opened : "";
    const back = real || (state.preview ? previewReturn : "");
    state.doc = res.document;
    state.path = res.path;
    state.preview = !!res.preview;
    previewReturn = state.preview ? back : "";
    state.focusOrderId = null;
    state.focusLineId = null;
    cloudState().catalog = false;
    adoptCloudFromDocument();
    adoptChartsFromDocument();
    if (res.history?.meta) {
      adoptHistory(res.history, res.history_limit);
    } else if (res.history && Array.isArray(res.history.items) && res.history.items.length) {
      adoptHistory(res.history, res.history_limit);
    } else {
      historyReset("Открыт отчёт", { persist: !res.history?.folder });
    }
    if (res.recent) renderRecent(res.recent);
    else if (res.path) pushLocalRecent(res.path, res.document.title);
    setClean();
    applyPreviewMode();
    showApp();
    setView(next);
    if (next === "cloud") showCloudOverview();
    remotePublish();
    rememberDeskBase(state.doc, state.path);
    toast(state.preview ? "Резервная копия открыта только для просмотра" : "Отчёт открыт");
  }

  async function openPath(path, opts) {
    if (state.desktop || window.FM_DESK) {
      try {
        applyLoaded(await apiPost("/api/open-path", { path }), opts);
      } catch (err) {
        toast("Не удалось открыть файл. Возможно, он перемещён.");
      }
      return;
    }
    toast("В браузерном режиме откройте файл через кнопку «Открыть».");
  }

  function restoreNewModal() {
    if ($("new-modal-title")) $("new-modal-title").textContent = "Создать новый отчёт?";
    if ($("new-modal-text")) $("new-modal-text").textContent = "Текущий файл будет закрыт. Несохранённые изменения нужно сохранить заранее.";
    if ($("new-save")) $("new-save").textContent = "Сохранить и создать";
    if ($("new-discard")) $("new-discard").textContent = "Создать без сохранения";
  }

  function confirmSwitchReport() {
    if (!state.dirty) return Promise.resolve(true);
    restoreNewModal();
    if ($("new-modal-title")) $("new-modal-title").textContent = "Отчёт не сохранён";
    if ($("new-modal-text")) $("new-modal-text").textContent = "Вы переходите в другую галактику. Сохранить текущий отчёт перед открытием?";
    if ($("new-save")) $("new-save").textContent = "Сохранить и открыть";
    if ($("new-discard")) $("new-discard").textContent = "Открыть без сохранения";
    $("new-modal").classList.add("open");
    return new Promise((resolve) => {
      unsavedWait = resolve;
    });
  }

  async function openGalaxy(data, { fromStart = false } = {}) {
    const path = data?.path;
    if (!path) return;
    const same = samePath(path, state.path) && state.doc;
    if (!fromStart && !same && state.doc && !$("app-shell")?.hidden) {
      const choice = await confirmSwitchReport();
      if (choice === "cancel" || choice === false) return;
      if (choice === "save") {
        const ok = await save();
        if (!ok) return;
      } else if (choice === "discard") {
        await revertHistoryToLastSave();
      }
    }
    const engine = fromStart ? startCloud : orderCloud;
    const node = engine?.findNode?.(data.id || `galaxy:${path}`) || engine?.findNode?.(path);
    if (node && engine.flyInto) await engine.flyInto(node);
    if (same && !fromStart) {
      cloudState().catalog = false;
      renderCloud();
      setTimeout(() => orderCloud?.fit(), 40);
      return;
    }
    await openPath(path, { keepView: !fromStart && !!state.doc && !$("app-shell")?.hidden, view: fromStart ? "" : "cloud" });
  }

  function applyStartView(mode) {
    const view = mode === "galaxies" ? "galaxies" : "list";
    persistStartView(view);
    $("start-inner")?.classList.toggle("is-galaxies", view === "galaxies");
    if ($("start-lists")) $("start-lists").hidden = view === "galaxies";
    if ($("start-galaxy")) $("start-galaxy").hidden = view !== "galaxies";
    $("start-view-toggle")?.querySelectorAll("[data-start-view]").forEach((btn) => {
      const on = btn.dataset.startView === view;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", String(on));
    });
    if (view === "galaxies") {
      requestAnimationFrame(() => {
        renderStartGalaxies();
        startCloud?.resize();
        startCloud?.fit(false);
      });
    }
  }

  function ensureStartCloud() {
    if (startCloud || !window.FinOrderCloud || !$("start-galaxy-canvas")) return startCloud;
    startCloud = window.FinOrderCloud.create({
      canvas: $("start-galaxy-canvas"),
      onHover: (node, point) => {
        const tip = $("start-galaxy-tip");
        if (!tip) return;
        if (!node || !point) {
          tip.hidden = true;
          return;
        }
        tip.innerHTML = `<b>${esc(node.label)}</b><span>${node.origin === "recent" ? "недавний файл" : "папка FinMaster"}</span>`;
        tip.hidden = false;
        const wrap = $("start-galaxy").getBoundingClientRect();
        const tw = tip.offsetWidth || 200;
        const th = tip.offsetHeight || 48;
        tip.style.left = `${Math.max(10, Math.min(wrap.width - tw - 10, point.x + 16))}px`;
        tip.style.top = `${Math.max(10, Math.min(wrap.height - th - 10, point.y + 16))}px`;
      },
      onSelect: () => {},
      onOpen: (node) => {
        if (node?.kind === "galaxy") openGalaxy(node, { fromStart: true });
      },
    });
    startCloud.setOptions({ catalog: true, labels: true, motion: true, heat: false, space3d: true, openOnClick: true });
    return startCloud;
  }

  function renderStartGalaxies() {
    const engine = ensureStartCloud();
    engine?.update(galaxyGraphData(), {
      catalog: true,
      labels: true,
      motion: true,
      heat: false,
      space3d: true,
      query: "",
      openOnClick: true,
    });
  }

  function showGalaxyCatalog() {
    cloudState().catalog = true;
    if ($("app-shell")?.hidden || !state.doc) {
      applyStartView("galaxies");
      return;
    }
    if (state.view !== "cloud") setView("cloud");
    else renderCloud();
    setTimeout(() => orderCloud?.fit(), 80);
  }

  async function save({ as = false, silent = false } = {}) {
    if (!state.doc) return false;
    const fromPreview = !!state.preview;
    if (fromPreview) {
      if (silent) return false;
      as = true;
    }
    persistCloudPrefs();
    try {
      if (state.desktop || window.FM_DESK) {
        let path = fromPreview ? "" : state.path;
        if (as || !path) {
          if (silent && !path) {
            if (!save._warned) {
              toast("Включили автосохранение — сначала сохраните файл вручную.");
              save._warned = true;
            }
            return false;
          }
          const picked = await apiPost("/api/dialog/save", { suggested: `${state.doc.title || "Отчёт"}.fmaster` });
          if (picked.cancelled || !picked.path) return false;
          path = picked.path;
        }
        const history = historyDiskPayload();
        let body = { path, document: state.doc, history, new_id: fromPreview };
        if (window.FM_DESK && window.FM_DESK_BASE && window.FM_DESK_BASE.path === path && typeof window.FM_DESK_PATCH === "function") {
          let patch = null;
          try {
            patch = window.FM_DESK_PATCH(window.FM_DESK_BASE.doc, state.doc);
          } catch {
            patch = null;
          }
          if (patch && patch.empty && !state.dirty) {
            setClean();
            return true;
          }
          if (patch && (patch.set || patch.orders)) {
            body = {
              path,
              patch: {},
              base_modified: window.FM_DESK_BASE.modified,
              history,
              new_id: fromPreview,
            };
            if (patch.set) body.patch.set = patch.set;
            if (patch.orders) body.patch.orders = patch.orders;
          }
        }
        let res;
        try {
          res = await apiPost("/api/write", body);
        } catch (err) {
          if (!body.patch || !/изменён/i.test(String(err && err.message || ""))) throw err;
          res = await apiPost("/api/write", { path, document: state.doc, history, new_id: fromPreview });
        }
        if (res.skipped) return false;
        if (res.document) state.doc = res.document;
        else if (res.modified_at && state.doc) state.doc.modified_at = res.modified_at;
        state.path = res.path;
        state.preview = false;
        previewReturn = "";
        rememberReportView(state.path, state.view);
        if (res.recent) renderRecent(res.recent);
        setClean();
        rememberDeskBase(state.doc, state.path);
        applyPreviewMode();
        if (!silent) {
          toast(fromPreview ? "Отчёт сохранён. У него новый номер, исходные копии не изменились." : "Отчёт сохранён");
        }
        return true;
      }

      const payload = JSON.stringify(fromPreview ? { ...state.doc, id: uid() } : state.doc, null, 2);
      if (as || !state.path) {
        downloadFile(`${state.doc.title || "Отчёт"}.fmaster`, payload);
        state.path = `${state.doc.title || "Отчёт"}.fmaster`;
        if (fromPreview) {
          state.doc.id = JSON.parse(payload).id;
          state.preview = false;
          applyPreviewMode();
        }
        pushLocalRecent(state.path, state.doc.title);
        setClean();
        toast("Файл скачан. В отдельном окне FinMaster сохраняет напрямую на диск.");
        return true;
      }
      downloadFile(state.path, payload);
      setClean();
      if (!silent) toast("Файл скачан");
      return true;
    } catch (err) {
      toast(`Ошибка сохранения: ${err.message || err}`);
      return false;
    }
  }

  function downloadFile(name, text) {
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function exportCsv() {
    const rows = allRows();
    const head = ["Номер", "Заказчик", "Название", "Начало работ", "Конец работ", "Тип", "Вид", "Продукт", "Количество", "Ед", "Цена", "Скидка%", "Итог", "Расход", "Оплачено", "Не оплачено", "Дата заказа", "Дата оплаты", "Статус"];
    const lines = [head.join(";")];
    rows.forEach(({ order, line, totals }) => {
      const vals = [
        order.number,
        order.customer,
        order.name,
        dateDay(order.work_start),
        dateDay(order.work_end),
        line.order_type,
        kindLabel(totals.kind) || "доход",
        line.product,
        totals.mode === "amount" ? line.quantity : `${totals.percent} %`,
        totals.mode === "amount" ? line.unit : "",
        totals.mode === "amount" ? totals.total : totals.base,
        totals.expense ? "" : line.discount,
        totals.expense ? "" : totals.after,
        totals.expense ? totals.cost : "",
        totals.expense ? "" : totals.paid,
        totals.expense ? "" : totals.unpaid,
        line.order_date ? dateDay(line.order_date) : "",
        totals.expense ? "" : line.payment_date ? dateDay(line.payment_date) : "",
        totals.expense ? kindLabel(totals.kind) : line.status,
      ].map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`);
      lines.push(vals.join(";"));
    });
    const csv = "\ufeff" + lines.join("\n");
    if (state.desktop) {
      try {
        const picked = await apiPost("/api/dialog/export", { suggested: `${state.doc.title || "Экспорт"}.csv` });
        if (picked.cancelled || !picked.path) return;
        await apiPost("/api/write-text", { path: picked.path, content: csv });
        toast("CSV сохранён");
        return;
      } catch (err) {
        toast(String(err.message || err));
      }
    }
    downloadFile(`${state.doc.title || "Экспорт"}.csv`, csv);
  }

  function fileStamp(value) {
    return String(value || "").replace("T", " ").slice(0, 19);
  }

  function renderRecentItems(items) {
    const box = $("recent-list");
    if (!box) return;
    if (!items.length) {
      box.innerHTML = `<div class="recent-item missing"><div>Пока нет недавних отчётов</div></div>`;
      return;
    }
    box.innerHTML = items
      .map((item) => {
        const missing = item.exists === false;
        const date = fileStamp(item.opened_at);
        return `<div class="recent-item ${missing ? "missing" : ""}" data-path="${esc(item.path)}">
          <div><b>${esc(item.title || item.path)}</b><div class="meta">${esc(item.path)}</div></div>
          <div class="recent-side">
            <div class="meta">${missing ? "файл не найден" : esc(date)}</div>
            <button type="button" class="recent-remove" data-recent-remove title="Убрать из списка">✕</button>
          </div>
        </div>`;
      })
      .join("");
  }

  function renderLibrary(lib) {
    const box = $("library-list");
    const pathEl = $("library-path");
    const openBtn = $("btn-open-library");
    if (!box) return;
    if (!lib) {
      if (pathEl) pathEl.textContent = "";
      if (openBtn) openBtn.hidden = true;
      box.innerHTML = `<div class="recent-item missing"><div>Папка отчётов доступна в программе на компьютере</div></div>`;
      return;
    }
    if (pathEl) pathEl.textContent = lib.path || "";
    if (openBtn) openBtn.hidden = !state.desktop;
    const items = lib.items || [];
    if (!items.length) {
      box.innerHTML = `<div class="recent-item missing"><div>Пока пусто — новые отчёты появятся здесь</div></div>`;
      return;
    }
    box.innerHTML = items
      .map((item) => {
        const date = fileStamp(item.modified_at);
        return `<div class="recent-item" data-path="${esc(item.path)}">
          <div><b>${esc(item.title || item.name || item.path)}</b><div class="meta">${esc(item.name || item.path)}</div></div>
          <div class="recent-side">
            <div class="meta">${esc(date)}</div>
            <button type="button" class="recent-remove" data-library-delete title="Удалить отчёт в корзину">✕</button>
          </div>
        </div>`;
      })
      .join("");
  }

  async function renderStartLists(data) {
    let payload = data;
    if (!payload) {
      if (state.desktop) {
        try {
          payload = await apiGet("/api/bootstrap");
          state.autosave = !!payload.autosave;
          if (payload.history_limit) history.limit = clampHistoryLimit(payload.history_limit);
        } catch {
          payload = {};
        }
      } else {
        state.recentItems = localRecent();
        state.library = null;
        renderRecentItems(state.recentItems);
        renderLibrary(null);
        applyStartView(startViewMode());
        return;
      }
    }
    if (payload && "runtime_choice" in payload) applyRuntimeMenu(payload.runtime_choice !== false);
    state.recentItems = payload.recent || [];
    state.library = payload.library || null;
    state.listsSig = fileListsSig(state.library, state.recentItems);
    renderRecentItems(state.recentItems);
    renderLibrary(state.library);
    applyStartView(startViewMode());
  }

  async function renderRecent(list) {
    if (list) {
      state.recentItems = list;
      renderRecentItems(list);
      if (cloudState().catalog && state.view === "cloud") renderGalaxyCloud();
      if ($("start-screen") && !$("start-screen").classList.contains("hidden") && startViewMode() === "galaxies") renderStartGalaxies();
      return;
    }
    await renderStartLists();
  }

  async function refreshUpdateButton() {
    const btn = $("btn-update");
    if (!btn || !state.desktop) return;
    let data = null;
    try {
      data = await apiGet("/api/update");
      state.updateReady = !!data.available;
      state.updateCurrent = data.current || "";
      state.updateLatest = data.latest || "";
      state.updateDamaged = !!data.damaged;
      state.updateIntegrity = !!data.integrity;
      state.updateOffline = !!data.offline;
      state.updateYear = Number(data.year) || 0;
    } catch {
      state.updateReady = false;
      state.updateDamaged = false;
      state.updateIntegrity = false;
      state.updateOffline = false;
      state.updateYear = 0;
      return false;
    }
    const fromRepo = data && data.enabled === false;
    btn.disabled = fromRepo;
    if (fromRepo) {
      state.updateReady = false;
      state.updateDamaged = false;
      state.updateIntegrity = false;
      state.updateOffline = false;
      state.updateYear = 0;
    }
    paintUpdateButton();
    return true;
  }

  function paintUpdateButton() {
    const btn = $("btn-update");
    if (!btn) return;
    const red = (!!state.updateReady && !!state.updateDamaged) || !!state.updateIntegrity;
    btn.classList.toggle("update-ready", !!state.updateReady || red);
    btn.classList.toggle("update-damaged", red);
    if (btn.classList.contains("update-checking")) {
      btn.title = "Проверяю обновление…";
      btn.setAttribute("aria-label", "Проверяю обновление…");
      return;
    }
    const title = btn.disabled
      ? "В репозитории обновление выключено"
      : state.updateIntegrity
        ? "Целостность программы нарушена"
        : state.updateDamaged
          ? "Возможно, файлы повреждены"
          : state.updateReady
            ? "Есть обновление"
            : "Обновить программу";
    btn.title = title;
    btn.setAttribute("aria-label", title);
  }

  async function runProgramUpdate() {
    try {
      await apiPost("/api/update", {});
    } catch (err) {
      toast(err && err.message ? err.message : "Не удалось запустить обновление");
    }
  }

  function infoButton() {
    return `<button type="button" class="info-btn confirm-info" data-diff="files" title="Чем отличается" aria-label="Чем отличается">i</button>`;
  }

  function filesWord(count) {
    const n10 = count % 10;
    const n100 = count % 100;
    const word = n10 === 1 && n100 !== 11 ? "файл отличается" : n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14) ? "файла отличаются" : "файлов отличаются";
    return count + " " + word;
  }

  function paintIntegrity(ok, value) {
    const textEl = $("confirm-text");
    if (!textEl) return;
    const lines = [...textEl.querySelectorAll(".confirm-integrity")];
    let line = lines[0];
    lines.slice(1).forEach((extra) => extra.remove());
    if (!line) {
      line = document.createElement("span");
      line.className = "confirm-line confirm-integrity";
      textEl.appendChild(line);
    }
    line.classList.toggle("warn", !ok);
    line.classList.toggle("ok", !!ok);
    line.innerHTML = `<i>Проверка</i><b>${esc(value)}${ok ? "" : infoButton()}</b>`;
  }

  function diffHost() {
    let panel = $("confirm-diff");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "confirm-diff";
      panel.className = "confirm-diff";
      $("confirm-text")?.after(panel);
    }
    return panel;
  }

  async function toggleFileDiff(btn) {
    const panel = diffHost();
    const same = panel.classList.contains("open");
    document.querySelectorAll("#confirm-text .confirm-info").forEach((item) => item.classList.remove("open"));
    if (same) {
      panel.classList.remove("open");
      return;
    }
    btn?.classList.add("open");
    panel.innerHTML = `<p class="confirm-diff-wait">Смотрю файлы…</p>`;
    panel.classList.add("open");
    try {
      const data = diffCache || await apiPost("/api/integrity", { remember: false });
      diffCache = data;
      const files = data.files || [];
      if (!files.length) {
        panel.innerHTML = `<p class="confirm-diff-wait">Отличий нет. Файлы совпадают с GitHub.</p>`;
        return;
      }
      panel.innerHTML = `<div class="confirm-diff-head">${esc(filesWord(files.length))}</div><ul>${files.map((file, index) =>
        `<li class="${file.kind === "missing" ? "is-missing" : "is-changed"}" style="--i:${index}"><span>${esc(file.path)}</span><em>${file.kind === "missing" ? "нет файла" : "изменён"}</em></li>`
      ).join("")}</ul>`;
    } catch (err) {
      panel.innerHTML = `<p class="confirm-diff-wait">${esc(err && err.message ? err.message : "Не удалось сверить файлы")}</p>`;
    }
  }

  async function checkProgramIntegrity(btn) {
    if (!btn || btn.dataset.busy === "1") return;
    btn.dataset.busy = "1";
    const previous = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Проверяю…";
    try {
      const data = await apiPost("/api/integrity", { remember: true });
      diffCache = data;
      const broken = !data.ok;
      state.updateIntegrity = broken;
      paintUpdateButton();
      paintIntegrity(data.ok, broken ? "Целостность программы нарушена" : "Целостность не нарушена");
      if (broken) toast("Целостность программы нарушена");
      else $("confirm-diff")?.classList.remove("open");
    } catch (err) {
      toast(err && err.message ? err.message : "Не удалось проверить целостность");
    } finally {
      btn.disabled = false;
      btn.textContent = previous;
      delete btn.dataset.busy;
    }
  }

  function confirmExtra(label, onClick) {
    const actions = document.querySelector("#confirm-modal .modal-actions");
    const old = $("confirm-extra");
    if (!label) {
      old?.remove();
      return;
    }
    const btn = old || document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.id = "confirm-extra";
    btn.disabled = false;
    btn.textContent = label;
    btn.onclick = onClick;
    if (!old && actions) actions.insertBefore(btn, actions.firstChild);
  }

  async function askProgramUpdate() {
    const ready = !!state.updateReady;
    const current = state.updateCurrent || "дата неизвестна";
    const latest = state.updateLatest || "дата неизвестна";
    const versionsMatch = !ready && !state.updateOffline && !state.updateDamaged && !!state.updateCurrent && state.updateCurrent === state.updateLatest;
    const integrityLine = state.updateIntegrity
      ? { label: "Проверка", value: "Целостность программы нарушена", warn: true, info: true, integrity: true }
      : null;
    const ok = await askConfirm(ready
      ? {
          title: state.updateDamaged ? "Версия старая" : "Есть обновление",
          lines: [
            ...(state.updateDamaged
              ? [
                  { label: "Новая версия", value: latest, info: !integrityLine },
                  { label: "Сейчас", value: current, warn: true },
                ]
              : [
                  { label: "Новая версия", value: latest, info: !integrityLine },
                  { label: "Сейчас установлена", value: current },
                ]),
            ...(integrityLine ? [integrityLine] : []),
          ],
          ok: "Обновить",
          cancel: "Не сейчас",
          about: true,
        }
      : {
          title: "Обновление",
          lines: [
            { label: "Сейчас установлена", value: current },
            state.updateOffline
              ? { label: "GitHub", value: "Не удалось проверить обновление: сервер не ответил", warn: true }
              : { label: "Версия", value: "Это последняя версия" },
            ...(integrityLine ? [integrityLine] : []),
          ],
          ok: "Скачать",
          cancel: "Отмена",
          extra: versionsMatch ? "Проверить целостность" : "",
          about: true,
        });
    if (!ok) return;
    await flushPendingSaves();
    if (state.dirty) {
      state._update = true;
      $("close-modal").classList.add("open");
      return;
    }
    await runProgramUpdate();
  }

  async function askClose() {
    await flushPendingSaves();
    if (!state.dirty) {
      if (state._home) {
        state._home = false;
        showStart();
        return;
      }
      if (state.newAfterSave) {
        state.newAfterSave = false;
        await createNew();
        return;
      }
      if (state.desktop) {
        try {
          await apiPost("/api/quit", {});
        } catch {
          window.close();
        }
      } else {
        window.close();
      }
      return;
    }
    $("close-modal").classList.add("open");
  }

  let confirmWait = null;
  let diffCache = null;

  function closeConfirm(ok) {
    $("confirm-modal")?.classList.remove("open");
    const aboutBtn = $("confirm-about");
    if (aboutBtn) aboutBtn.hidden = true;
    const wait = confirmWait;
    confirmWait = null;
    wait?.(!!ok);
  }

  function askConfirm({ title, text, lines, ok = "Продолжить", cancel = "Отмена", danger = false, extra = "", about = false } = {}) {
    closeConfirm(false);
    return new Promise((resolve) => {
      confirmWait = resolve;
      diffCache = null;
      $("confirm-diff")?.remove();
      const titleEl = $("confirm-title");
      const textEl = $("confirm-text");
      const okBtn = $("confirm-ok");
      const cancelBtn = $("confirm-cancel");
      if (titleEl) titleEl.textContent = title || "Подтверждение";
      if (textEl) {
        if (lines && lines.length) {
          textEl.innerHTML = lines.map((row) =>
            `<span class="confirm-line${row.warn ? " warn" : ""}${row.integrity ? " confirm-integrity" : ""}"><i>${esc(row.label)}</i><b>${esc(row.value)}${row.info ? infoButton() : ""}</b></span>`
          ).join("");
        } else {
          textEl.textContent = text || "";
        }
      }
      if (okBtn) {
        okBtn.textContent = ok;
        okBtn.className = danger ? "btn danger" : "btn primary";
      }
      if (cancelBtn) cancelBtn.textContent = cancel;
      const aboutBtn = $("confirm-about");
      if (aboutBtn) aboutBtn.hidden = !about;
      confirmExtra(extra, (event) => checkProgramIntegrity(event.currentTarget));
      $("confirm-modal")?.classList.add("open");
      queueMicrotask(() => okBtn?.focus());
    });
  }

  function typeKindWarning(name, prevKind, nextKind) {
    const label = name || "этот тип";
    if (!prevKind && nextKind) {
      return {
        title: "Отметить тип как расход?",
        text: `Тип «${label}» станет ${nextKind === "tax" ? "налогом" : "затратой"}. Строки с этим типом в заказах перейдут в расходы и будут вычитаться из суммы.`,
      };
    }
    if (prevKind && !nextKind) {
      return {
        title: "Снять пометку с типа?",
        text: `Тип «${label}» снова станет обычной выручкой. Строки в заказах выйдут из блока расходов.`,
      };
    }
    return {
      title: "Изменить вид типа?",
      text: `Тип «${label}» станет ${nextKind === "tax" ? "налогом" : "затратой"} вместо ${
        prevKind === "tax" ? "налога" : "затраты"
      }. Строки этого типа в заказах изменятся.`,
    };
  }

  window.__finmasterIsDirty = () => !!state.dirty;
  window.__finmasterCanClose = () => !state.dirty;
  window.__finmasterAskClose = () => {
    askClose();
    return false;
  };

  function esc(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function bindSortable(container, { handle, item, onCommit }) {
    if (!container) return;
    container.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const grip = e.target.closest(handle);
      if (!grip || !container.contains(grip)) return;
      const row = grip.closest(item);
      if (!row) return;
      e.preventDefault();
      row.classList.add("is-dragging");
      const parent = row.parentNode;
      const note = row.nextElementSibling;
      const paired = note?.classList?.contains("line-note-row") && note.dataset.line === row.dataset.line ? note : null;
      let moved = false;
      const move = (ev) => {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        let over = el?.closest(item);
        if (!over) {
          const noteRow = el?.closest("tr.line-note-row");
          const prev = noteRow?.previousElementSibling;
          if (prev?.matches?.(item)) over = prev;
        }
        if (!over || over === row || over === paired || over.parentNode !== parent) return;
        const rect = over.getBoundingClientRect();
        const before = ev.clientY > rect.top + rect.height / 2 ? over.nextSibling : over;
        if (before === row || before === paired) return;
        parent.insertBefore(row, before);
        if (paired) parent.insertBefore(paired, row.nextSibling);
        moved = true;
      };
      const up = () => {
        row.classList.remove("is-dragging");
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", up);
        if (moved) onCommit(row);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", up);
    });
  }

  function reorderByDom(arr, nodes, attr = "i") {
    return [...nodes]
      .map((el) => arr[Number(el.dataset[attr])])
      .filter((x) => x !== undefined);
  }

  function closeFileMenu() {
    const menu = $("file-menu");
    const btn = $("btn-file-menu");
    if (menu) menu.hidden = true;
    btn?.setAttribute("aria-expanded", "false");
  }

  function bindFileMenu() {
    const btn = $("btn-file-menu");
    const menu = $("file-menu");
    if (!btn || !menu) return;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
      if (open) paintWindowsLogin();
    });
    menu.addEventListener("click", (e) => {
      if (e.target.closest("button")) closeFileMenu();
    });
    document.addEventListener("click", (e) => {
      if (menu.hidden) return;
      if (e.target.closest("#file-menu") || e.target.closest("#btn-file-menu")) return;
      closeFileMenu();
    });
  }

  function bindGlobalTooltips() {
    let tipEl = null;
    let showTimer = 0;
    let active = null;
    let lastText = "";
    let lastX = 0;
    let lastY = 0;

    function ensureTip() {
      if (tipEl) return tipEl;
      tipEl = document.createElement("div");
      tipEl.className = "ui-tip";
      tipEl.id = "ui-tip";
      tipEl.setAttribute("role", "tooltip");
      tipEl.hidden = true;
      document.body.appendChild(tipEl);
      return tipEl;
    }

    function isTipChrome(el) {
      return !!el?.closest?.(".ui-tip, .fin-tip, .hint-i-pop, .cloud-tooltip, .calc-port-menu, .suggest");
    }

    function migrateTitle(el) {
      if (!el || el.nodeType !== 1) return "";
      const existing = String(el.getAttribute("data-tip") || "").trim();
      const title = el.getAttribute("title");
      if (title != null && String(title).trim()) {
        const text = String(title).trim();
        if (!existing) el.setAttribute("data-tip", text);
        el.removeAttribute("title");
        return existing || text;
      }
      return existing;
    }

    function findTipTarget(start) {
      let el = start;
      for (let i = 0; i < 8 && el && el !== document.body; i += 1) {
        if (isTipChrome(el)) return null;
        if (el.getAttribute?.("data-no-tip") === "1") return null;
        const text = migrateTitle(el) || String(el.getAttribute?.("data-tip") || "").trim();
        if (text) return el;
        el = el.parentElement;
      }
      return null;
    }

    function tipText(el) {
      return migrateTitle(el) || String(el?.getAttribute?.("data-tip") || "").trim();
    }

    function hide() {
      clearTimeout(showTimer);
      showTimer = 0;
      active = null;
      lastText = "";
      if (!tipEl) return;
      tipEl.classList.remove("is-on");
      tipEl.hidden = true;
    }

    function place(clientX, clientY) {
      const tip = ensureTip();
      const pad = 10;
      const rect = tip.getBoundingClientRect();
      let x = clientX + 14;
      let y = clientY + 18;
      if (x + rect.width > window.innerWidth - pad) x = clientX - rect.width - 12;
      if (y + rect.height > window.innerHeight - pad) y = clientY - rect.height - 14;
      if (x < pad) x = pad;
      if (y < pad) y = pad;
      tip.style.left = `${Math.round(x)}px`;
      tip.style.top = `${Math.round(y)}px`;
    }

    function show(el, clientX, clientY) {
      const text = tipText(el);
      if (!text) {
        hide();
        return;
      }
      active = el;
      lastX = clientX;
      lastY = clientY;
      const tip = ensureTip();
      if (text !== lastText) {
        tip.textContent = text;
        lastText = text;
      }
      tip.hidden = false;
      tip.classList.add("is-on");
      place(clientX, clientY);
    }

    document.addEventListener(
      "pointerover",
      (e) => {
        if (e.pointerType === "touch") return;
        const target = findTipTarget(e.target);
        if (!target) return;
        if (target === active) return;
        clearTimeout(showTimer);
        const x = e.clientX;
        const y = e.clientY;
        showTimer = setTimeout(() => show(target, x, y), 260);
      },
      true
    );

    document.addEventListener(
      "pointermove",
      (e) => {
        if (!active || !tipEl || tipEl.hidden) return;
        lastX = e.clientX;
        lastY = e.clientY;
        place(e.clientX, e.clientY);
      },
      true
    );

    document.addEventListener(
      "pointerout",
      (e) => {
        if (!active) {
          clearTimeout(showTimer);
          return;
        }
        const related = e.relatedTarget;
        if (related && (active === related || active.contains?.(related))) return;
        if (related && findTipTarget(related) === active) return;
        hide();
      },
      true
    );

    document.addEventListener("scroll", hide, true);
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") hide();
      },
      true
    );
    window.addEventListener("blur", hide);
  }

  const RUNTIME_TITLES = { flask: "Flask", pywebview: "pywebview", pillow: "Pillow" };
  let runtimeTimer = 0;
  let runtimeView = null;

  function stopRuntimePoll() {
    if (!runtimeTimer) return;
    clearInterval(runtimeTimer);
    runtimeTimer = 0;
  }

  function runtimeLibs(host, packages) {
    host.replaceChildren();
    (packages || []).forEach((item) => {
      const row = document.createElement("div");
      row.className = "runtime-lib";
      const name = document.createElement("span");
      name.textContent = RUNTIME_TITLES[item.name] || item.name;
      const state = document.createElement("span");
      state.className = item.installed ? "ok" : "miss";
      state.textContent = item.installed ? `установлен ${item.version || ""}`.trim() : "нужно установить";
      row.append(name, state);
      host.append(row);
    });
  }

  function runtimeChoice(box, data, mode, title, detail, enabled) {
    const label = document.createElement("label");
    label.className = "runtime-choice" + (data.preference === mode ? " is-on" : "") + (enabled ? "" : " is-off");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "finmaster-runtime";
    input.value = mode;
    input.checked = data.preference === mode;
    input.disabled = !enabled;
    const text = document.createElement("span");
    const strong = document.createElement("b");
    strong.textContent = title;
    const small = document.createElement("small");
    small.textContent = detail;
    text.append(strong, small);
    label.append(input, text);
    if (enabled) {
      input.addEventListener("change", async () => {
        if (!input.checked) return;
        try {
          paintRuntime(await apiPost("/api/runtime/mode", { mode }));
        } catch (err) {
          toast(err.message || "Не удалось сменить среду");
          paintRuntime(await apiGet("/api/runtime"));
        }
      });
    }
    box.append(label);
  }

  function paintRuntime(data) {
    const note = $("runtime-note");
    if (note) note.textContent = data.note || "";
    const choices = $("runtime-choices");
    if (choices) {
      choices.replaceChildren();
      const folder = data.folder || {};
      runtimeChoice(
        choices,
        data,
        "folder",
        "Папка FinMaster",
        folder.available
          ? `По умолчанию · своя копия рядом с отчётами${folder.version ? " · " + folder.version : ""}`
          : "По умолчанию · ещё не скачана",
        !!folder.available
      );
      if (data.can_switch) {
        const system = data.system || {};
        runtimeChoice(
          choices,
          data,
          "system",
          "Системный Python",
          system.version ? `Уже установлен в Windows · ${system.version}` : "Уже установлен в Windows",
          true
        );
      }
    }
    const folderPath = $("runtime-folder-path");
    if (folderPath) folderPath.textContent = (data.folder && data.folder.path) || "";
    runtimeLibs($("runtime-folder-libs"), data.folder && data.folder.packages);
    const systemBlock = $("runtime-system-block");
    if (systemBlock) {
      systemBlock.hidden = !data.can_switch;
      const systemPath = $("runtime-system-path");
      if (systemPath) systemPath.textContent = (data.system && data.system.path) || "";
      runtimeLibs($("runtime-system-libs"), data.can_switch ? data.system && data.system.packages : []);
    }
    const log = $("runtime-log");
    const lines = (data.job && data.job.log) || [];
    if (log) {
      log.hidden = !lines.length && !(data.job && data.job.error);
      log.textContent = lines.join("\n");
      if (data.job && data.job.error) log.textContent += (lines.length ? "\n" : "") + data.job.error;
      log.scrollTop = log.scrollHeight;
    }
  }

  function paintRuntimeJob(job) {
    if (runtimeView) runtimeView = { ...runtimeView, job };
    const log = $("runtime-log");
    const lines = (job && job.log) || [];
    if (log) {
      log.hidden = !lines.length && !(job && job.error);
      log.textContent = lines.join("\n");
      if (job && job.error) log.textContent += (lines.length ? "\n" : "") + job.error;
      log.scrollTop = log.scrollHeight;
    }
  }

  async function refreshRuntime() {
    const data = await apiGet("/api/runtime");
    runtimeView = data;
    paintRuntime(data);
    if (data.job && data.job.running) startRuntimePoll();
    else stopRuntimePoll();
    return data;
  }

  function startRuntimePoll() {
    if (runtimeTimer) return;
    runtimeTimer = setInterval(async () => {
      try {
        const job = await apiGet("/api/runtime/job");
        if (job.running) {
          paintRuntimeJob(job);
          return;
        }
        stopRuntimePoll();
        await refreshRuntime();
        if (job.error) toast(job.error);
        else if (job.ok) toast("Библиотеки установлены в папку FinMaster");
      } catch {
        stopRuntimePoll();
      }
    }, 800);
  }

  async function openRuntime() {
    $("runtime-modal")?.classList.add("open");
    try {
      await refreshRuntime();
    } catch (err) {
      toast(err.message || "Не удалось прочитать среду запуска");
    }
  }

  function closeRuntime() {
    stopRuntimePoll();
    $("runtime-modal")?.classList.remove("open");
  }

  function applyRuntimeMenu(show) {
    const button = $("btn-runtime");
    const sep = $("runtime-menu-sep");
    if (button) button.hidden = !show;
    if (sep) sep.hidden = !show;
  }

  function bindRuntime() {
    $("btn-runtime")?.addEventListener("click", () => openRuntime());
    $("runtime-close")?.addEventListener("click", () => closeRuntime());
    $("runtime-modal")?.addEventListener("click", (e) => {
      if (e.target === $("runtime-modal")) closeRuntime();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && $("runtime-modal")?.classList.contains("open")) closeRuntime();
    });
  }

  function bind() {
    applyTheme(localStorage.getItem(LS_THEME) || currentTheme(), false);
    bindGlobalTooltips();
    $("nav").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-view]");
      if (btn) setView(btn.dataset.view);
    });
    bindCashflow();
    bindCalendar();
    bindFileMenu();
    bindRuntime();
    bindCloud();
    bindCalculator();
    bindPresentation();
    bindVault();
    bindSearchClears();
    $("global-search").addEventListener("input", (e) => {
      state.search = e.target.value;
      syncSearchClear(e.target);
      renderAll();
    });
    $("report-title").addEventListener("input", (e) => {
      if (!state.doc) return;
      state.doc.title = e.target.value;
      markDirty();
    });
    $("btn-report-settings")?.addEventListener("click", () => openReportSettings());
    $("report-settings-close")?.addEventListener("click", () => closeReportSettings());
    $("report-settings-modal")?.addEventListener("click", (e) => {
      if (e.target === $("report-settings-modal")) closeReportSettings();
    });
    $("report-currency")?.addEventListener("input", (e) => {
      setCurrency(e.target.value, { refresh: false });
    });
    $("report-currency")?.addEventListener("change", (e) => {
      setCurrency(e.target.value, { refresh: true });
    });
    document.querySelector(".report-currency-presets")?.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-currency]");
      if (!chip) return;
      setCurrency(chip.dataset.currency, { refresh: true });
    });
    document.querySelector(".report-decimals-presets")?.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-decimals]");
      if (!chip) return;
      setMoneyDecimals(chip.dataset.decimals, { refresh: true });
    });
    $("btn-add-order").addEventListener("click", () => {
      const order = emptyOrder();
      state.doc.orders.push(order);
      markDirty();
      state.orderFilter = "all";
      setView("orders");
      requestAnimationFrame(() => flashOrder(order.id));
    });
    $("btn-share-many").addEventListener("click", () => openShare(null));
    $("dash-focus")?.addEventListener("click", (e) => {
      if (e.target.closest("#focus-clear")) {
        state.remoteStats = null;
        setFocusOrder(null);
      } else if (e.target.closest("#focus-open")) {
        const id = state.focusOrderId;
        state.focusOrderId = null;
        state.focusLineId = null;
        if (id) gotoOrder(id);
      }
    });
    $("order-sort").addEventListener("change", () => renderOrders());
    $("autosave")?.addEventListener("change", async (e) => {
      state.autosave = e.target.checked;
      if (window.FM_DESK) {
        if (!state.autosave) clearTimeout(state.autosaveTimer);
        toast(state.autosave ? "Автосохранение в браузере включено" : "В браузере автосохранение выключено. Данные уйдут по кнопке «Сохранить».");
        return;
      }
      if (state.desktop) {
        try {
          await apiPost("/api/autosave", { enabled: state.autosave });
        } catch {
          /* ignore */
        }
      } else {
        localStorage.setItem(LS_AUTOSAVE, String(state.autosave));
      }
      if (state.autosave) save({ silent: true });
      toast(state.autosave ? "Автосохранение включено" : "Автосохранение выключено");
    });

    $("orders-list").addEventListener("input", onOrderInput);
    $("orders-list").addEventListener("change", onOrderInput);
    $("orders-list").addEventListener("click", onOrderClick);
    $("orders-list").addEventListener("dblclick", (e) => {
      const cell = e.target.closest?.("td, .tax-percent");
      const input = e.target.closest?.("input.is-calc-locked") || cell?.querySelector?.("input.is-calc-locked");
      if (!input || input.dataset.calcLock !== "1") return;
      const tr = input.closest("[data-line]");
      const card = input.closest("[data-order]");
      if (!tr || !card) return;
      e.preventDefault();
      if (window.FinCalc?.focusOrderField?.(card.dataset.order, tr.dataset.line, input.dataset.lk)) setView("calculator");
    });
    $("orders-list").addEventListener("contextmenu", onLineContextMenu);
    $("orders-list").addEventListener("keydown", onOrderKeydown);
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#line-menu")) closeLineMenu();
    });
    $("line-menu-freeze")?.addEventListener("click", (e) => {
      e.preventDefault();
      toggleLineFrozen();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeLineMenu();
    });
    $("orders-list").addEventListener("focusin", (e) => {
      const kind = suggestKindOf(e.target);
      if (kind) openTextSuggest(e.target, kind, "browse");
    });
    $("orders-list").addEventListener("focusout", (e) => {
      if (!suggestKindOf(e.target)) return;
      requestAnimationFrame(() => {
        if (document.activeElement === textSuggest.input) return;
        if (($("text-suggest") || $("product-suggest"))?.contains(document.activeElement)) return;
        closeTextSuggest();
      });
    });
    $("orders-list").addEventListener("mousedown", (e) => {
      const input = e.target.closest?.("input[data-suggest], input[data-lk='product'], input[data-k='customer']");
      if (!input || !suggestKindOf(input)) return;
      if (document.activeElement === input) {
        requestAnimationFrame(() => openTextSuggest(input, suggestKindOf(input), "browse"));
      }
    });
    const suggestBox = () => suggestBoxEl();
    suggestBox()?.addEventListener("mousedown", (e) => {
      const btn = e.target.closest("[data-i]");
      if (!btn) return;
      e.preventDefault();
      const item = textSuggest.items[Number(btn.dataset.i)];
      if (item != null) pickTextSuggest(item);
    });
    window.addEventListener("scroll", () => {
      if (textSuggest.input || textSuggest.selectEl) positionTextSuggest();
    }, true);
    window.addEventListener("resize", () => {
      if (textSuggest.input || textSuggest.selectEl) positionTextSuggest();
    });
    document.addEventListener(
      "mousedown",
      (e) => {
        if (e.button !== 0) return;
        const sel = e.target.closest?.("select");
        if (sel && !sel.disabled && !sel.multiple) {
          e.preventDefault();
          openSelectSuggest(sel);
          return;
        }
        if (!textSuggestOpen()) return;
        if (suggestBox()?.contains(e.target)) return;
        if (textSuggest.selectEl && e.target === textSuggest.selectEl) return;
        if (textSuggest.input && (e.target === textSuggest.input || textSuggest.input.contains?.(e.target))) return;
        closeTextSuggest();
      },
      true
    );
    document.addEventListener("focusin", (e) => {
      if (e.target.closest?.("#orders-list")) return;
      const kind = suggestKindOf(e.target);
      if (!kind) return;
      openTextSuggest(e.target, kind, "browse");
    });
    document.addEventListener("focusout", (e) => {
      if (e.target.closest?.("#orders-list")) return;
      if (e.target?.tagName === "SELECT") {
        requestAnimationFrame(() => {
          if (suggestBox()?.contains(document.activeElement)) return;
          if (document.activeElement === textSuggest.selectEl) return;
          if (textSuggest.kind === "select") closeTextSuggest();
        });
        return;
      }
      if (!suggestKindOf(e.target)) return;
      requestAnimationFrame(() => {
        if (document.activeElement === textSuggest.input) return;
        if (suggestBox()?.contains(document.activeElement)) return;
        closeTextSuggest();
      });
    });
    document.addEventListener("mousedown", (e) => {
      if (e.target.closest?.("#orders-list")) return;
      const input = e.target.closest?.("input[data-suggest], #f-customer, #f-product, input[data-filter-field='customer']");
      if (!input || !suggestKindOf(input)) return;
      if (document.activeElement === input) {
        requestAnimationFrame(() => openTextSuggest(input, suggestKindOf(input), "browse"));
      }
    });
    document.addEventListener("input", (e) => {
      if (textSuggest.picking) return;
      const kind = suggestKindOf(e.target);
      if (!kind) return;
      if (e.target.closest?.("#orders-list") && e.target.dataset?.lk === "product") return;
      openTextSuggest(e.target, kind, "filter");
    });
    document.addEventListener("keydown", (e) => {
      if (e.target?.tagName === "SELECT") {
        bindTextSuggestKeys(e);
        return;
      }
      if (e.target.closest?.("#orders-list")) return;
      bindTextSuggestKeys(e);
    });
    $("order-filter")?.addEventListener("click", (e) => {
      if (e.target.closest("#btn-order-filter")) {
        const menu = $("order-filter-menu");
        const btn = $("btn-order-filter");
        if (!menu) return;
        const open = menu.hidden;
        if (open) closeLineFilter();
        menu.hidden = !open;
        btn?.setAttribute("aria-expanded", String(open));
        return;
      }
      const item = e.target.closest("[data-order-filter]");
      if (!item) return;
      state.orderFilter = item.dataset.orderFilter || "all";
      renderOrders();
    });
    $("line-filter")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.target.closest("#btn-line-filter")) {
        const menu = $("line-filter-menu");
        const btn = $("btn-line-filter");
        if (!menu) return;
        const open = menu.hidden;
        if (open) {
          closeOrderFilter();
          renderLineFilterPanel();
        }
        menu.hidden = !open;
        btn?.setAttribute("aria-expanded", String(open));
        if (open) menu.querySelector("[data-lf='q']")?.focus();
        return;
      }
      const more = e.target.closest("[data-lf-more]");
      if (more) {
        lineFilterState().more[more.dataset.lfMore] = true;
        renderLineFilterPanel();
        return;
      }
      const chip = e.target.closest("[data-lf-chip]");
      if (chip) {
        toggleLineFacet(chip.dataset.lfKey, chip.dataset.lfChip);
        return;
      }
      if (e.target.closest("[data-lf='exclude']")) {
        const f = lineFilterState();
        f.exclude = !f.exclude;
        renderLineFilterPanel();
        renderOrders();
        return;
      }
      if (e.target.closest("[data-lf='reset']")) resetLineFilter();
    });
    $("line-filter")?.addEventListener("input", (e) => {
      const t = e.target;
      if (t.dataset.lf === "q") {
        lineFilterState().chipQ = t.value;
        renderLineFilterPanel();
        return;
      }
      if (!t.dataset.lfField) return;
      lineFilterState()[t.dataset.lfField] = t.value;
      syncLineFilterButton();
      renderOrders();
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#order-filter")) closeOrderFilter();
      if (!e.target.closest("#line-filter")) closeLineFilter();
    });
    $("btn-undo").addEventListener("click", undo);
    $("btn-redo").addEventListener("click", redo);
    $("btn-history")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const panel = $("history-panel");
      toggleHistoryPanel(panel?.hidden);
    });
    $("history-panel")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.target.closest("#btn-history-manage")) {
        openHistoryLibrary();
        return;
      }
      if (e.target.closest("#btn-history-backups")) {
        openBackupLibrary();
        return;
      }
      const diffBtn = e.target.closest("[data-history-diff]");
      if (diffBtn) {
        openHistoryDiff(diffBtn.dataset.historyDiff);
        return;
      }
      const item = e.target.closest("[data-history-id]");
      if (item) historyJump(item.dataset.historyId);
    });
    $("history-limit")?.addEventListener("change", (e) => {
      setHistoryLimit(e.target.value);
    });
    $("history-modal-close")?.addEventListener("click", () => $("history-modal")?.classList.remove("open"));
    $("history-modal")?.addEventListener("click", (e) => {
      if (e.target === $("history-modal")) $("history-modal")?.classList.remove("open");
    });
    $("history-modal-list")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-hist-del]");
      if (btn) deleteHistoryFolder(btn.dataset.histDel);
    });
    $("backup-tab-this")?.addEventListener("click", () => showBackupPane("this"));
    $("backup-tab-other")?.addEventListener("click", () => showBackupPane("other"));
    $("backup-close")?.addEventListener("click", () => $("backup-modal")?.classList.remove("open"));
    $("backup-modal")?.addEventListener("click", (e) => {
      if (e.target === $("backup-modal")) $("backup-modal")?.classList.remove("open");
    });
    $("backup-create")?.addEventListener("click", () => createReportBackup());
    $("preview-save")?.addEventListener("click", () => save({ as: true }));
    $("preview-back")?.addEventListener("click", () => {
      if (!previewReturn) return;
      openPath(previewReturn);
    });
    $("diff-close")?.addEventListener("click", () => closeDiffModal());
    $("diff-modal")?.addEventListener("click", (e) => {
      if (e.target === $("diff-modal")) closeDiffModal();
    });
    $("backup-list")?.addEventListener("click", (e) => {
      const diffBtn = e.target.closest("[data-bak-diff]");
      if (diffBtn) {
        openBackupDiff(diffBtn.dataset.bakDiff, diffBtn.dataset.bakId || "");
        return;
      }
      const openBtn = e.target.closest("[data-bak-open]");
      if (openBtn) {
        const path = openBtn.dataset.bakOpen;
        confirmSwitchReport().then(async (choice) => {
          if (!choice || choice === "cancel") return;
          if (choice === "save") {
            const ok = await save();
            if (!ok) return;
          } else if (choice === "discard") {
            await revertHistoryToLastSave();
          }
          $("backup-modal")?.classList.remove("open");
          openPath(path);
        });
        return;
      }
      const allBtn = e.target.closest("[data-bak-del-all]");
      if (allBtn) {
        deleteReportBackups(allBtn.dataset.bakDelAll, allBtn.dataset.bakTitle || "", allBtn.dataset.bakCount || "");
        return;
      }
      const delBtn = e.target.closest("[data-bak-del]");
      if (delBtn) deleteReportBackup(delBtn.dataset.bakDel, delBtn.dataset.bakId || "");
    });
    document.addEventListener("click", (e) => {
      if (e.target.closest("#history-pop") || e.target.closest("#history-panel") || e.target.closest("#history-modal") || e.target.closest("#backup-modal")) return;
      toggleHistoryPanel(false);
    });
    window.addEventListener("resize", placeHistoryPanel);
    window.addEventListener("scroll", placeHistoryPanel, true);
    bindAssistantWindow();
    $("btn-fullscreen")?.addEventListener("click", () => toggleAppFullscreen());
    document.addEventListener("fullscreenchange", () => {
      if (state.desktop || cloudFullscreenOn()) return;
      syncAppFullscreen(pageFullscreenOn());
    });
    document.addEventListener("webkitfullscreenchange", () => {
      if (state.desktop || cloudFullscreenOn()) return;
      syncAppFullscreen(pageFullscreenOn());
    });
    $("btn-help").addEventListener("click", openHelp);
    $("btn-guide")?.addEventListener("click", openGuide);
    $("btn-update")?.addEventListener("click", async () => {
      const btn = $("btn-update");
      if (!btn || btn.dataset.busy === "1") return;
      btn.dataset.busy = "1";
      btn.classList.add("update-checking");
      btn.setAttribute("aria-busy", "true");
      btn.title = "Проверяю обновление…";
      btn.setAttribute("aria-label", "Проверяю обновление…");
      try {
        const checked = await refreshUpdateButton();
        btn.classList.remove("update-checking");
        btn.removeAttribute("aria-busy");
        paintUpdateButton();
        if (!checked) {
          toast("Не удалось проверить обновление");
          return;
        }
        if (btn.disabled) return;
        await askProgramUpdate();
      } finally {
        btn.classList.remove("update-checking");
        btn.removeAttribute("aria-busy");
        delete btn.dataset.busy;
        paintUpdateButton();
      }
    });
    $("help-close").addEventListener("click", () => $("help-modal").classList.remove("open"));
    $("help-modal").addEventListener("click", (e) => {
      if (e.target === $("help-modal")) $("help-modal").classList.remove("open");
    });
    $("palette").addEventListener("click", (e) => {
      const item = e.target.closest("[data-pi]");
      if (item) paletteRun(Number(item.dataset.pi));
    });
    $("palette-input").addEventListener("input", (e) => renderPaletteList(e.target.value));
    $("palette-input").addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        paletteMove(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        paletteMove(-1);
      } else if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        runAssistantAsk();
      } else if (e.key === "Enter") {
        e.preventDefault();
        paletteRun(palette.index);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if ($("ask-modal")?.classList.contains("open")) {
          closeAskModal();
          return;
        }
        setAssistantMin(true);
      }
    });
    $("orders-list").addEventListener("focusin", onExprFocus);
    $("orders-list").addEventListener("focusout", onExprBlur);
    bindSortable($("orders-list"), {
      handle: ".line-drag",
      item: "tr.line-row",
      onCommit: (tr) => {
        const card = tr.closest("[data-order]");
        const order = findOrder(card?.dataset.order);
        const tbody = tr.closest("tbody");
        if (!order || !tbody) return;
        const ids = [...tbody.querySelectorAll("tr.line-row[data-line]")].map((r) => r.dataset.line);
        if (!applyLineGroupOrder(order, lineTableGroup(tr), ids)) return;
        markDirty();
        renderOrders();
      },
    });
    bindSortable($("status-list"), {
      handle: ".item-drag",
      item: ".list-item",
      onCommit: (row) => {
        const next = reorderByDom(state.doc.statuses, row.parentNode.querySelectorAll(".list-item"));
        if (next.length === (state.doc.statuses || []).length) state.doc.statuses = next;
        markDirty();
        renderCatalogs();
      },
    });
    bindSortable($("unit-list"), {
      handle: ".item-drag",
      item: ".list-item",
      onCommit: () => {
        const list = $("unit-list");
        const next = reorderByDom(state.doc.units, list.querySelectorAll(".list-item"));
        if (next.length === (state.doc.units || []).length) state.doc.units = next;
        markDirty();
        renderCatalogs();
      },
    });
    bindSortable($("type-list"), {
      handle: ".item-drag",
      item: ".list-item",
      onCommit: () => {
        const list = $("type-list");
        const next = reorderByDom(state.doc.order_types, list.querySelectorAll(".list-item"));
        if (next.length === (state.doc.order_types || []).length) state.doc.order_types = next;
        markDirty();
        renderCatalogs();
      },
    });
    bindSortable($("product-catalog"), {
      handle: ".item-drag",
      item: ".list-item",
      onCommit: () => {
        const tab = productKind({ kind: state.productCatalogTab || "order" });
        const list = state.doc.products || [];
        const host = $("product-catalog");
        const ordered = [...host.querySelectorAll(".list-item")]
          .map((el) => list[Number(el.dataset.i)])
          .filter(Boolean)
          .map((p) => ({ ...productEntry(p), kind: tab }));
        const order = list.filter((p) => productKind(p) === "order");
        const cost = list.filter((p) => productKind(p) === "cost");
        const tax = list.filter((p) => productKind(p) === "tax");
        const pack = { order, cost, tax };
        pack[tab] = ordered;
        state.doc.products = [...pack.order, ...pack.cost, ...pack.tax];
        markDirty();
        renderCatalogs();
      },
    });

    document.querySelector(".product-tabs")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-product-tab]");
      if (!btn) return;
      state.productCatalogTab = productKind({ kind: btn.dataset.productTab });
      renderCatalogs();
    });

    $("status-list").addEventListener("input", (e) => {
      const row = e.target.closest(".list-item");
      if (!row) return;
      const i = Number(row.dataset.i);
      const s = state.doc.statuses[i];
      if (!s) return;
      if (e.target.dataset.ck === "name") {
        const names = (state.doc.statuses || []).map((x) => x.name);
        const accepted = tryCatalogName(e.target, names, i);
        if (accepted == null) return;
        const prev = s.name;
        s.name = accepted;
        renameCatalogValue("status", prev, s.name);
        markDirty();
        return;
      }
      if (e.target.dataset.ck === "color") s.color = e.target.value;
      markDirty();
    });
    $("status-list").addEventListener("focusout", (e) => {
      if (e.target.dataset.ck !== "name") return;
      const i = Number(e.target.closest(".list-item")?.dataset.i);
      const s = state.doc.statuses?.[i];
      if (!s) return;
      const names = (state.doc.statuses || []).map((x) => x.name);
      const next = finishCatalogName(e.target, names, i, s.name);
      if (next == null || next === s.name) return;
      const prev = s.name;
      s.name = next;
      renameCatalogValue("status", prev, s.name);
      markDirty();
    });
    $("status-list").addEventListener("change", (e) => {
      if (e.target.dataset.ck !== "is_paid") return;
      const i = Number(e.target.closest(".list-item").dataset.i);
      (state.doc.statuses || []).forEach((st, idx) => {
        st.is_paid = idx === i;
      });
      markDirty();
      renderCatalogs();
    });
    $("status-list").addEventListener("click", (e) => {
      const lockBtn = e.target.closest("[data-cact='lock']");
      if (lockBtn) {
        const i = Number(lockBtn.closest(".list-item").dataset.i);
        const s = state.doc.statuses[i];
        if (s) s.locked = !s.locked;
        markDirty();
        renderCatalogs();
        return;
      }
      if (e.target.closest("[data-cact='del']")) {
        const btn = e.target.closest("[data-cact='del']");
        if (btn.disabled) return;
        const i = Number(btn.closest(".list-item").dataset.i);
        const s = state.doc.statuses[i];
        if (!s) return;
        const used = statusUsage(s.name);
        if (used > 0) {
          toast(`Нельзя удалить: статус используется в ${used} поз.`);
          renderCatalogs();
          return;
        }
        historyCommit();
        state.doc.statuses.splice(i, 1);
        markDirty();
        renderCatalogs();
        undoToast("Статус удалён");
      }
    });
    $("btn-add-status").addEventListener("click", () => {
      const names = (state.doc.statuses || []).map((x) => x.name);
      state.doc.statuses.push({
        id: uid(),
        name: uniqueCatalogName(names, "Новый статус"),
        color: "#64748b",
        is_paid: false,
        locked: false,
      });
      markDirty();
      renderCatalogs();
    });
    $("unit-list").addEventListener("input", (e) => {
      const i = Number(e.target.closest(".list-item").dataset.i);
      if (!e.target.hasAttribute("data-uk")) return;
      const names = state.doc.units || [];
      const accepted = tryCatalogName(e.target, names, i);
      if (accepted == null) return;
      const prev = state.doc.units[i];
      state.doc.units[i] = accepted;
      renameCatalogValue("unit", prev, accepted);
      (state.doc.products || []).forEach((p) => {
        if (p.unit === prev) p.unit = accepted;
      });
      markDirty();
    });
    $("unit-list").addEventListener("focusout", (e) => {
      if (!e.target.hasAttribute("data-uk")) return;
      const i = Number(e.target.closest(".list-item")?.dataset.i);
      if (!Number.isFinite(i) || !state.doc.units?.[i]) return;
      const next = finishCatalogName(e.target, state.doc.units, i, state.doc.units[i]);
      if (next == null || next === state.doc.units[i]) return;
      const prev = state.doc.units[i];
      state.doc.units[i] = next;
      renameCatalogValue("unit", prev, next);
      (state.doc.products || []).forEach((p) => {
        if (p.unit === prev) p.unit = next;
      });
      markDirty();
    });
    $("unit-list").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-uact='del']");
      if (!btn || btn.disabled) return;
      const i = Number(btn.closest(".list-item").dataset.i);
      const name = state.doc.units[i];
      if (name == null) return;
      const used = unitUsage(name);
      if (used > 0) {
        toast(`Нельзя удалить: единица используется в ${used} поз./шабл.`);
        renderCatalogs();
        return;
      }
      historyCommit();
      state.doc.units.splice(i, 1);
      markDirty();
      renderCatalogs();
      undoToast("Единица измерения удалена");
    });
    $("btn-add-unit").addEventListener("click", () => {
      state.doc.units.push(uniqueCatalogName(state.doc.units || [], "ед."));
      markDirty();
      renderCatalogs();
    });
    $("type-list").addEventListener("focusin", (e) => {
      if (e.target.hasAttribute("data-tk")) e.target.dataset.old = e.target.value;
    });
    $("type-list").addEventListener("input", (e) => {
      if (!e.target.hasAttribute("data-tk")) return;
      const i = Number(e.target.closest(".list-item").dataset.i);
      const names = (state.doc.order_types || []).map((t) => typeEntry(t).name);
      const accepted = tryCatalogName(e.target, names, i);
      if (accepted == null) return;
      const entry = typeEntry(state.doc.order_types[i]);
      const prev = e.target.dataset.old ?? entry.name;
      entry.name = accepted;
      state.doc.order_types[i] = entry;
      if (prev && prev !== entry.name) {
        renameCatalogValue("order_type", prev, entry.name);
        e.target.dataset.old = entry.name;
      }
      markDirty();
    });
    $("type-list").addEventListener("focusout", (e) => {
      if (!e.target.hasAttribute("data-tk")) return;
      const i = Number(e.target.closest(".list-item")?.dataset.i);
      const current = state.doc.order_types?.[i];
      if (current == null) return;
      const saved = typeEntry(current).name;
      const names = (state.doc.order_types || []).map((t) => typeEntry(t).name);
      const next = finishCatalogName(e.target, names, i, saved);
      if (next == null || next === saved) return;
      const entry = typeEntry(current);
      entry.name = next;
      state.doc.order_types[i] = entry;
      renameCatalogValue("order_type", saved, next);
      e.target.dataset.old = next;
      markDirty();
    });
    $("type-list").addEventListener("change", async (e) => {
      const key = e.target.dataset.ck;
      if (key !== "is_tax" && key !== "is_cost") return;
      const i = Number(e.target.closest(".list-item").dataset.i);
      const entry = typeEntry(state.doc.order_types[i]);
      const prevKind = entry.is_tax ? "tax" : entry.is_cost ? "cost" : "";
      const nextKind = e.target.checked ? (key === "is_tax" ? "tax" : "cost") : "";
      if (prevKind === nextKind) return;
      e.target.checked = !e.target.checked;
      const warn = typeKindWarning(entry.name, prevKind, nextKind);
      const ok = await askConfirm({ title: warn.title, text: warn.text, ok: "Изменить" });
      if (!ok) return;
      entry.is_tax = nextKind === "tax";
      entry.is_cost = nextKind === "cost";
      state.doc.order_types[i] = entry;
      (state.doc.orders || []).forEach((order) =>
        (order.lines || []).forEach((line) => {
          if (line.order_type !== entry.name) return;
          line.tax_mode = nextKind === "tax" ? "gross" : "amount";
        })
      );
      markDirty();
      renderAll();
    });
    $("type-list").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-tact='del']");
      if (!btn || btn.disabled) return;
      const i = Number(btn.closest(".list-item").dataset.i);
      const entry = typeEntry(state.doc.order_types[i]);
      const used = orderTypeUsage(entry.name);
      if (used > 0) {
        toast(`Нельзя удалить: тип используется в ${used} поз.`);
        renderCatalogs();
        return;
      }
      historyCommit();
      state.doc.order_types.splice(i, 1);
      markDirty();
      renderCatalogs();
      undoToast("Тип заказа удалён");
    });
    $("btn-add-type").addEventListener("click", () => {
      const names = (state.doc.order_types || []).map((t) => typeEntry(t).name);
      state.doc.order_types.push({ id: uid(), name: uniqueCatalogName(names, "Новый тип"), is_tax: false, is_cost: false });
      markDirty();
      renderCatalogs();
    });
    $("product-catalog").addEventListener("focusin", (e) => {
      if (e.target.hasAttribute("data-pk")) e.target.dataset.old = e.target.value;
    });
    $("product-catalog").addEventListener("input", (e) => {
      const row = e.target.closest(".list-item");
      if (!row) return;
      const i = Number(row.dataset.i);
      const item = state.doc.products[i];
      if (!item) return;
      const tab = productKind(item);
      if (e.target.hasAttribute("data-pk")) {
        const names = productsOfKind(tab).map((p) => p.name);
        const rowIndex = productsOfKind(tab).findIndex((p) => p === item);
        const accepted = tryCatalogName(e.target, names, rowIndex >= 0 ? rowIndex : -1);
        if (accepted == null) return;
        const old = e.target.dataset.old || item.name;
        item.name = accepted;
        item.kind = tab;
        renameProduct(old, accepted, tab);
        e.target.dataset.old = accepted;
        markDirty();
        return;
      }
      if (e.target.hasAttribute("data-pu")) {
        item.unit = e.target.value;
        markDirty();
        return;
      }
      if (e.target.hasAttribute("data-pp") || e.target.hasAttribute("data-pt")) {
        const raw = String(e.target.value || "").replaceAll(",", ".");
        if (raw !== e.target.value) e.target.value = raw;
        const v = evalExpr(raw);
        e.target.classList.toggle("invalid", raw.trim() !== "" && !Number.isFinite(v));
        const n = Number.isFinite(v) ? Math.max(0, round2(v)) : 0;
        if (e.target.hasAttribute("data-pt")) item.tax_percent = n;
        else item.price = n;
        item.kind = tab;
        markDirty();
      }
    });
    $("product-catalog").addEventListener("focusout", (e) => {
      if (!e.target.hasAttribute("data-pk")) return;
      const i = Number(e.target.closest(".list-item")?.dataset.i);
      const item = state.doc.products?.[i];
      if (!item) return;
      const tab = productKind(item);
      const names = productsOfKind(tab).map((p) => p.name);
      const rowIndex = productsOfKind(tab).findIndex((p) => p === item);
      const next = finishCatalogName(e.target, names, rowIndex >= 0 ? rowIndex : -1, item.name);
      if (next == null || next === item.name) return;
      const old = item.name;
      item.name = next;
      item.kind = tab;
      renameProduct(old, next, tab);
      e.target.dataset.old = next;
      markDirty();
    });
    $("product-catalog").addEventListener("change", (e) => {
      const i = Number(e.target.closest(".list-item")?.dataset.i);
      const item = state.doc.products?.[i];
      if (!item) return;
      if (e.target.hasAttribute("data-pu")) {
        item.unit = e.target.value;
        markDirty();
      }
      if (e.target.hasAttribute("data-pp") || e.target.hasAttribute("data-pt")) {
        const raw = String(e.target.value || "").replaceAll(",", ".").trim();
        const v = evalExpr(raw);
        const n = Number.isFinite(v) ? Math.max(0, round2(v)) : 0;
        if (e.target.hasAttribute("data-pt")) {
          item.tax_percent = n;
          e.target.value = item.tax_percent ? formatQty(item.tax_percent) : "";
        } else {
          item.price = n;
          e.target.value = item.price ? formatQty(item.price) : "";
        }
        e.target.classList.remove("invalid");
        markDirty();
      }
    });
    $("product-catalog").addEventListener("click", (e) => {
      const del = e.target.closest("[data-pact='del']");
      if (!del || del.disabled) return;
      const row = del.closest(".list-item");
      const i = Number(row?.dataset.i);
      const item = state.doc.products?.[i];
      if (!item) return;
      const used = productTemplateUsage(item.name, productKind(item));
      if (used > 0) {
        toast(`Нельзя удалить: шаблон используется в ${used} поз.`);
        renderCatalogs();
        return;
      }
      historyCommit();
      state.doc.products.splice(i, 1);
      markDirty();
      renderCatalogs();
      undoToast("Шаблон удалён из справочника");
    });
    $("btn-add-product").addEventListener("click", () => {
      const tab = productKind({ kind: state.productCatalogTab || "order" });
      const list = state.doc.products || (state.doc.products = []);
      const names = productsOfKind(tab).map((p) => p.name);
      const base = tab === "cost" ? "Новая затрата" : tab === "tax" ? "Новый налог" : "Новый продукт";
      list.push({
        name: uniqueCatalogName(names, base),
        unit: (state.doc.units || [])[0] || "шт.",
        price: 0,
        kind: tab,
        tax_percent: 0,
      });
      markDirty();
      renderCatalogs();
    });
    $("customers-panel").addEventListener("input", (e) => {
      const card = e.target.closest("[data-cid]");
      const cf = e.target.dataset.cf;
      if (!card || !cf) return;
      const c = (state.doc.customers || []).find((x) => x.id === card.dataset.cid);
      if (!c) return;
      if (cf === "name") {
        const old = c.name;
        c.name = e.target.value;
        if (old && old !== c.name) renameCatalogValue("customer", old, c.name);
      } else {
        c[cf] = e.target.value;
      }
      markDirty();
    });
    $("customers-panel").addEventListener("click", (e) => {
      const star = e.target.closest("[data-star]");
      if (star) {
        const row = star.closest("[data-cid]");
        const c = (state.doc.customers || []).find((x) => x.id === row?.dataset.cid);
        if (!c) return;
        const v = Number(star.dataset.star);
        c.rating = c.rating === v ? 0 : v;
        markDirty();
        renderCustomers();
        return;
      }
      const btn = e.target.closest("[data-cact='delcust']");
      if (!btn) return;
      const row = btn.closest("[data-cid]");
      if (!row) return;
      historyCommit();
      const gone = (state.doc.customers || []).find((x) => x.id === row.dataset.cid);
      state.doc.customers = (state.doc.customers || []).filter((x) => x.id !== row.dataset.cid);
      markDirty();
      renderCustomers();
      undoToast(`Заказчик ${gone?.name || ""} убран из справочника`.replace(/\s+/g, " ").trim());
    });
    $("btn-add-customer").addEventListener("click", () => {
      const c = { id: uid(), name: "Новый заказчик", organization: "", phone: "", email: "", address: "", rating: 0 };
      (state.doc.customers || (state.doc.customers = [])).push(c);
      state.selectedCustomerId = c.id;
      markDirty();
      renderCustomers();
    });
    $("btn-toggle-sidebar").addEventListener("click", () => {
      ensureUi().sidebar_collapsed = !ensureUi().sidebar_collapsed;
      applySidebar();
      markDirty();
    });
    $("orders-list").addEventListener("mousedown", (e) => {
      const handle = e.target.closest(".col-resizer");
      if (!handle) return;
      e.preventDefault();
      const key = handle.dataset.col;
      const startX = e.clientX;
      const startW = colWidth(key, 100);
      handle.classList.add("dragging");
      const move = (ev) => {
        const w = Math.max(52, startW + ev.clientX - startX);
        ensureUi().column_widths[key] = w;
        document.querySelectorAll(`col[data-col="${key}"]`).forEach((col) => {
          col.style.width = `${w}px`;
        });
      };
      const up = () => {
        handle.classList.remove("dragging");
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        markDirty();
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });

    ["f-from", "f-to", "f-date-field", "f-group", "f-status", "f-type", "f-customer", "f-product", "f-unit", "f-min", "f-max", "f-unpaid", "c-a-from", "c-a-to", "c-b-from", "c-b-to"].forEach(
      (id) => {
        $(id).addEventListener("input", () => state.view === "analytics" && renderAnalytics());
        $(id).addEventListener("change", () => state.view === "analytics" && renderAnalytics());
      }
    );
    $("btn-filters-reset").addEventListener("click", () => {
      ["f-from", "f-to", "f-customer", "f-product", "f-min", "f-max", "c-a-from", "c-a-to", "c-b-from", "c-b-to"].forEach((id) => ($(id).value = ""));
      $("f-status").value = "";
      $("f-type").value = "";
      $("f-unit").value = "";
      $("f-unpaid").checked = false;
      renderAnalytics();
    });
    $("btn-preset-today").addEventListener("click", () => {
      const d = new Date();
      setDT("f-from", new Date(d.getFullYear(), d.getMonth(), d.getDate()));
      setDT("f-to", new Date(d.getFullYear(), d.getMonth(), d.getDate()));
      renderAnalytics();
    });
    $("btn-preset-week").addEventListener("click", () => {
      const d = new Date();
      const from = new Date(d.getTime() - 7 * 86400000);
      from.setHours(0, 0, 0, 0);
      setDT("f-from", from);
      setDT("f-to", d);
      renderAnalytics();
    });
    $("btn-preset-month").addEventListener("click", () => {
      const d = new Date();
      setDT("f-from", new Date(d.getFullYear(), d.getMonth(), 1, 0, 0));
      setDT("f-to", d);
      renderAnalytics();
    });
    $("btn-preset-year").addEventListener("click", () => {
      const d = new Date();
      setDT("f-from", new Date(d.getFullYear(), 0, 1, 0, 0));
      setDT("f-to", d);
      renderAnalytics();
    });

    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-line-series]");
      if (!btn || !state.doc) return;
      const id = btn.dataset.lineSeries;
      const chart = LINE_CHARTS.includes(btn.dataset.lineChart) ? btn.dataset.lineChart : "dash";
      const on = lineSeriesOn(chart);
      const next = !on[id];
      if (!next && LINE_METRICS.every((m) => (m.id === id ? false : on[m.id]))) return;
      chartPrefs.series[chart] = { ...on, [id]: next };
      persistChartPrefs();
      if (chart === "analytics") paintTrendLine($("chart-an-line"), analyticsRows(), $("f-group").value, $("f-date-field").value);
      else paintTrendLine($("chart-dash-line"), dashRows(), "day", "order_date");
    });
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-zoom-preset]");
      if (!btn) return;
      const chart = btn.dataset.lineZoom;
      if (!lineZoom[chart]) return;
      lineZoom[chart].preset = btn.dataset.zoomPreset;
      paintLineZoomed(chart);
    });

    $("btn-save").addEventListener("click", () => save());
    $("btn-save-as").addEventListener("click", () => save({ as: true }));
    $("btn-open").addEventListener("click", () => maybeOpen(openFromDialog));
    $("btn-new").addEventListener("click", onNew);
    $("btn-q-new")?.addEventListener("click", onNew);
    $("btn-q-open")?.addEventListener("click", () => maybeOpen(openFromDialog));
    $("btn-q-save")?.addEventListener("click", () => save());
    $("btn-q-save-as")?.addEventListener("click", () => save({ as: true }));
    $("btn-home").addEventListener("click", () => {
      if (state.dirty) {
        state._home = true;
        askClose();
        return;
      }
      showStart();
    });
    $("btn-export").addEventListener("click", exportCsv);
    $("share-cancel").addEventListener("click", () => $("share-modal").classList.remove("open"));
    $("share-fields").addEventListener("change", () => {
      ensureUi().share_fields = currentShareFields();
      markDirty();
      renderSharePreview();
    });
    $("share-themes").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-share-theme]");
      if (!btn) return;
      ensureUi().share_theme = btn.dataset.shareTheme;
      markDirty();
      renderShareThemes();
      renderSharePreview();
    });
    $("share-title").addEventListener("input", renderSharePreview);
    $("share-modal").addEventListener("click", (e) => {
      const head = e.target.closest("[data-share-fold]");
      if (!head) return;
      const fold = head.closest(".share-fold");
      if (!fold) return;
      const open = fold.classList.toggle("collapsed") === false;
      const ico = fold.querySelector(".share-fold-ico");
      if (ico) ico.textContent = open ? "▾" : "▸";
      rememberShareState();
    });
    $("share-hide-labels").addEventListener("change", renderSharePreview);
    $("share-hide-stamp").addEventListener("change", renderSharePreview);
    $("share-orders").addEventListener("click", (e) => {
      const tog = e.target.closest("[data-share-toggle]");
      if (!tog) return;
      const block = tog.closest(".share-order");
      if (!block) return;
      const open = block.classList.toggle("collapsed") === false;
      tog.setAttribute("aria-expanded", open ? "true" : "false");
      tog.textContent = open ? "▾" : "▸";
      rememberShareState();
    });
    $("share-orders").addEventListener("change", (e) => {
      const block = e.target.closest(".share-order");
      if (block && e.target.hasAttribute("data-share-order")) {
        block.querySelectorAll("[data-share-line]").forEach((el) => {
          if (!el.closest(".is-search-hidden")) el.checked = e.target.checked;
        });
        if (e.target.checked) {
          block.classList.remove("collapsed");
          const tog = block.querySelector("[data-share-toggle]");
          if (tog) {
            tog.setAttribute("aria-expanded", "true");
            tog.textContent = "▾";
          }
        }
      }
      if (block && e.target.hasAttribute("data-share-line")) {
        const any = [...block.querySelectorAll("[data-share-line]")].some((el) => el.checked);
        const orderCb = block.querySelector("[data-share-order]");
        if (orderCb) orderCb.checked = any;
      }
      renderSharePreview();
    });
    document.querySelectorAll("[data-share-preset]").forEach((btn) => {
      btn.addEventListener("click", () => applySharePreset(btn.dataset.sharePreset));
    });
    $("share-copy-text").addEventListener("click", copyShareText);
    $("share-copy").addEventListener("click", copySharePng);
    $("share-save").addEventListener("click", saveSharePng);
    $("share-grand")?.addEventListener("change", (e) => {
      persistPref(LS_SHARE_GRAND, e.target.checked ? "1" : "0");
      renderSharePreview();
    });
    $("share-orders-search")?.addEventListener("input", applyShareSearch);
    $("share-orders-search")?.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && e.target.value) {
        e.preventDefault();
        e.stopPropagation();
        e.target.value = "";
        applyShareSearch();
      }
    });
    $("share-check-all")?.addEventListener("click", () => setAllShareChecks(true));
    $("share-check-debt")?.addEventListener("click", () => setShareChecksByPay("debt"));
    $("share-check-paid")?.addEventListener("click", () => setShareChecksByPay("paid"));
    $("share-check-none")?.addEventListener("click", () => setAllShareChecks(false));
    $("share-profile-save")?.addEventListener("click", saveShareProfile);
    $("share-profile-name")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveShareProfile();
      }
    });
    $("share-profile-list")?.addEventListener("click", (e) => {
      const del = e.target.closest("[data-profile-del]");
      if (del) {
        deleteShareProfile(Number(del.dataset.profileDel));
        return;
      }
      const apply = e.target.closest("[data-profile-apply]");
      if (!apply) return;
      const p = loadShareProfiles()[Number(apply.dataset.profileApply)];
      if (p) applyShareProfile(p);
    });
    $("share-pdf")?.addEventListener("click", openSharePdf);
    $("pdf-back")?.addEventListener("click", () => $("pdf-modal").classList.remove("open"));
    $("pdf-save")?.addEventListener("click", saveSharePdf);
    $("pdf-modal")?.addEventListener("click", (e) => {
      if (e.target === $("pdf-modal")) $("pdf-modal").classList.remove("open");
    });
    $("pdf-tools")?.addEventListener("click", (e) => {
      const applyBtn = e.target.closest("[data-pdf-profile-apply]");
      if (applyBtn) {
        const p = loadPdfProfiles()[Number(applyBtn.dataset.pdfProfileApply)];
        if (p) applyPdfProfile(p);
        return;
      }
      const delBtn = e.target.closest("[data-pdf-profile-del]");
      if (delBtn) {
        deletePdfProfile(Number(delBtn.dataset.pdfProfileDel));
        return;
      }
      if (e.target.closest("#pdf-profile-save")) {
        savePdfProfile();
        return;
      }
      const btn = e.target.closest("[data-pdf-opt] button[data-v]");
      if (btn) {
        pdfOpts[btn.closest("[data-pdf-opt]").dataset.pdfOpt] = btn.dataset.v;
        savePdfOpts();
        syncPdfTools();
        schedulePdfPreview();
        return;
      }
      if (e.target.closest("#pdf-reset")) {
        pdfOpts = { ...PDF_DEFAULTS };
        savePdfOpts();
        syncPdfTools();
        schedulePdfPreview();
      }
    });
    $("pdf-tools")?.addEventListener("change", (e) => {
      const el = e.target;
      if (el.dataset.pdfCheck) pdfOpts[el.dataset.pdfCheck] = el.checked;
      else if (el.dataset.pdfSelect) pdfOpts[el.dataset.pdfSelect] = el.value;
      else return;
      savePdfOpts();
      renderPdfProfiles();
      schedulePdfPreview();
    });
    $("pdf-tools")?.addEventListener("input", (e) => {
      const key = e.target.dataset.pdfRange;
      if (!key) return;
      pdfOpts[key] = Number(e.target.value);
      const val = $("pdf-scale-val");
      if (val) val.textContent = `${pdfOpts.scale}%`;
      savePdfOpts();
      renderPdfProfiles();
      schedulePdfPreview();
    });
    $("pdf-profile-name")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        savePdfProfile();
      }
    });
    $("btn-open-library")?.addEventListener("click", async () => {
      try {
        await apiPost("/api/open-folder", {});
      } catch (err) {
        toast(String(err.message || "Не удалось открыть папку"));
      }
    });
    $("start-view-toggle")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-start-view]");
      if (btn) applyStartView(btn.dataset.startView);
    });
    $("library-list")?.addEventListener("click", (e) => {
      const del = e.target.closest("[data-library-delete]");
      if (del) {
        e.preventDefault();
        e.stopPropagation();
        const row = del.closest(".recent-item");
        if (row?.dataset.path) deleteLibraryFile(row.dataset.path);
        return;
      }
      const item = e.target.closest(".recent-item");
      if (!item || item.classList.contains("missing") || !item.dataset.path) return;
      openPath(item.dataset.path);
    });
    $("recent-list").addEventListener("click", async (e) => {
      const rm = e.target.closest("[data-recent-remove]");
      if (rm) {
        e.preventDefault();
        e.stopPropagation();
        const row = rm.closest(".recent-item");
        if (row?.dataset.path) await removeRecent(row.dataset.path);
        return;
      }
      const item = e.target.closest(".recent-item");
      if (!item || item.classList.contains("missing")) return;
      openPath(item.dataset.path);
    });
    document.querySelectorAll(".js-theme-toggle").forEach((btn) => {
      btn.addEventListener("click", () => applyTheme(currentTheme() === "dark" ? "light" : "dark", true));
    });
    $("file-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        const text = await file.text();
        state.doc = JSON.parse(text);
        state.path = file.name;
        adoptCloudFromDocument();
        adoptChartsFromDocument();
        historyReset("Открыт отчёт");
        pushLocalRecent(file.name, state.doc.title);
        setClean();
        showApp();
        setView("dashboard");
        toast("Отчёт открыт");
      } catch {
        toast("Не удалось прочитать файл отчёта");
      }
    });

    $("close-cancel").addEventListener("click", () => {
      state.closeAfterSave = false;
      state._home = false;
      state._update = false;
      $("close-modal").classList.remove("open");
    });
    $("close-discard").addEventListener("click", async () => {
      $("close-modal").classList.remove("open");
      await revertHistoryToLastSave();
      state.dirty = false;
      if (state._update) {
        state._update = false;
        await runProgramUpdate();
        return;
      }
      if (state._home) {
        state._home = false;
        showStart();
        return;
      }
      if (state.desktop) {
        try {
          await apiPost("/api/quit", {});
        } catch {
          window.close();
        }
      } else {
        window.close();
      }
    });
    $("close-save").addEventListener("click", async () => {
      const ok = await save();
      if (!ok) return;
      $("close-modal").classList.remove("open");
      if (state._update) {
        state._update = false;
        await runProgramUpdate();
        return;
      }
      if (state._home) {
        state._home = false;
        showStart();
        return;
      }
      if (state.newAfterSave) {
        state.newAfterSave = false;
        await createNew();
        return;
      }
      if (state.desktop) await apiPost("/api/quit", {});
      else window.close();
    });

    $("new-cancel").addEventListener("click", () => {
      $("new-modal").classList.remove("open");
      if (unsavedWait) {
        const done = unsavedWait;
        unsavedWait = null;
        restoreNewModal();
        done("cancel");
      }
    });
    $("new-modal")?.addEventListener("click", (e) => {
      if (e.target === $("new-modal")) $("new-cancel").click();
    });
    $("new-discard").addEventListener("click", async () => {
      $("new-modal").classList.remove("open");
      await revertHistoryToLastSave();
      if (unsavedWait) {
        const done = unsavedWait;
        unsavedWait = null;
        restoreNewModal();
        done("discard");
        return;
      }
      await createNew();
    });
    $("new-save").addEventListener("click", async () => {
      $("new-modal").classList.remove("open");
      if (unsavedWait) {
        const done = unsavedWait;
        unsavedWait = null;
        restoreNewModal();
        done("save");
        return;
      }
      const ok = await save();
      if (ok) await createNew();
    });
    $("confirm-cancel")?.addEventListener("click", () => closeConfirm(false));
    $("confirm-about")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const copy = $("program-about-copy");
      if (copy) copy.textContent = state.updateYear ? `© ${state.updateYear} V.Ar Production` : "© V.Ar Production";
      $("program-about-modal")?.classList.add("open");
    });
    const closeProgramAbout = () => $("program-about-modal")?.classList.remove("open");
    $("program-about-close")?.addEventListener("click", closeProgramAbout);
    $("program-about-modal")?.addEventListener("click", async (event) => {
      if (event.target === $("program-about-modal")) {
        closeProgramAbout();
        return;
      }
      const link = event.target.closest("[data-link]");
      if (!link) return;
      event.preventDefault();
      if (!state.desktop) {
        window.open(link.href, "_blank", "noopener");
        return;
      }
      try {
        await apiPost("/api/open-link", { id: link.dataset.link });
      } catch (err) {
        toast(err && err.message ? err.message : "Не удалось открыть ссылку");
      }
    });
    $("confirm-ok")?.addEventListener("click", () => closeConfirm(true));
    $("confirm-text")?.addEventListener("click", (event) => {
      const info = event.target.closest(".confirm-info");
      if (!info) return;
      event.preventDefault();
      event.stopPropagation();
      toggleFileDiff(info);
    });
    $("confirm-modal")?.addEventListener("click", (e) => {
      if (e.target === $("confirm-modal")) closeConfirm(false);
    });

    document.addEventListener("keydown", (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const code = e.code;
      if (e.key === "F1") {
        e.preventDefault();
        openHelp();
        return;
      }
      if (e.key === "F11") {
        e.preventDefault();
        toggleAppFullscreen();
        return;
      }
      if (e.key === "Enter" && e.shiftKey && !ctrl && !e.altKey) {
        const typing = e.target?.closest?.("input, textarea, select, [contenteditable='true']");
        if (!typing && state.doc && !$("app-shell")?.hidden) {
          e.preventDefault();
          if ($("ask-modal")?.classList.contains("open")) $("ask-query")?.focus();
          else openAskModal(String($("palette-input")?.value || "").trim());
          return;
        }
      }
      if (e.key === "Escape") {
        if ($("ask-modal")?.classList.contains("open")) {
          e.preventDefault();
          closeAskModal();
          return;
        }
        if (cloudFullscreenOn()) {
          e.preventDefault();
          toggleCloudFullscreen(false);
          return;
        }
        if (state.appFullscreen) {
          e.preventDefault();
          toggleAppFullscreen(false);
          return;
        }
        if (productSuggestOpen()) {
          e.preventDefault();
          closeProductSuggest();
          return;
        }
        if (netConsoleOpen()) {
          e.preventDefault();
          closeNetConsole();
          return;
        }
        if (paletteIsOpen() && !$("palette").classList.contains("is-min") && $("palette")?.contains(document.activeElement)) {
          setAssistantMin(true);
          return;
        }
        if ($("confirm-modal")?.classList.contains("open")) {
          e.preventDefault();
          closeConfirm(false);
          return;
        }
        if ($("pdf-modal")?.classList.contains("open")) {
          e.preventDefault();
          $("pdf-modal").classList.remove("open");
          return;
        }
        if ($("diff-modal")?.classList.contains("open")) {
          e.preventDefault();
          closeDiffModal();
          return;
        }
        if ($("backup-modal")?.classList.contains("open")) {
          e.preventDefault();
          $("backup-modal").classList.remove("open");
          return;
        }
        if ($("help-modal").classList.contains("open")) $("help-modal").classList.remove("open");
        if ($("report-settings-modal")?.classList.contains("open")) {
          e.preventDefault();
          closeReportSettings();
          return;
        }
        if ($("device-info-modal")?.classList.contains("open")) {
          $("device-info-modal").classList.remove("open");
          return;
        }
        if ($("remote-guide-modal")?.classList.contains("open")) {
          $("remote-guide-modal").classList.remove("open");
          return;
        }
        if ($("remote-modal").classList.contains("open")) $("remote-modal").classList.remove("open");
        if (!$("file-menu")?.hidden) {
          e.preventDefault();
          closeFileMenu();
          return;
        }
        if ($("cal-filter-menu") && !$("cal-filter-menu").hidden) {
          e.preventDefault();
          closeCalMenus();
          return;
        }
        if ($("cal-weekend-menu") && !$("cal-weekend-menu").hidden) {
          e.preventDefault();
          closeCalMenus();
          return;
        }
      }
      if (state.view === "cloud" && e.key === "/" && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) {
        e.preventDefault();
        $("cloud-search")?.focus();
        return;
      }
      if (state.view === "calendar" && !ctrl && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          calendarShift(-1, e.shiftKey && calendarState().mode === "classic" ? "year" : "period");
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          calendarShift(1, e.shiftKey && calendarState().mode === "classic" ? "year" : "period");
          return;
        }
        if (e.key === "t" || e.key === "T") {
          e.preventDefault();
          goTimelineToday();
          renderCalendar();
          return;
        }
        if (e.key === "Enter" && calendarState().selected) {
          e.preventDefault();
          gotoOrder(calendarState().selected);
          return;
        }
        if (e.key === "1" || e.key === "2" || e.key === "3") {
          e.preventDefault();
          calendarState().mode = CALENDAR_MODES[Number(e.key) - 1];
          persistCalendar();
          markDirty();
          renderCalendar();
          return;
        }
      }
      if (!ctrl) return;
      if ((code === "Space" && !e.altKey && !e.shiftKey) || code === "KeyK" || (e.shiftKey && code === "KeyP")) {
        e.preventDefault();
        summonAssistant();
        return;
      }
      if (code === "Backquote" || e.key === "`" || e.key === "ё" || e.key === "Ё") {
        e.preventDefault();
        toggleNetConsole();
        return;
      }
      if (code === "KeyS") {
        e.preventDefault();
        save({ as: e.shiftKey });
        return;
      }
      if (code === "KeyO") {
        e.preventDefault();
        maybeOpen(openFromDialog);
        return;
      }
      if (code === "KeyN") {
        e.preventDefault();
        onNew();
        return;
      }
      if (code === "KeyF") {
        e.preventDefault();
        if (!$("app-shell").hidden) {
          $("global-search").focus();
          $("global-search").select();
        }
        return;
      }
      if (code === "KeyZ" && !e.shiftKey) {
        if (assistantCapturesUndo()) return;
        e.preventDefault();
        undo();
        return;
      }
      if (code === "KeyY" || (code === "KeyZ" && e.shiftKey)) {
        if (assistantCapturesUndo()) return;
        e.preventDefault();
        redo();
      }
    });

    window.addEventListener("resize", () => {
      if (state.doc && (state.view === "dashboard" || state.view === "analytics" || state.view === "cloud")) renderAll();
    });
  }

  function setDT(id, date) {
    const p = (n) => String(n).padStart(2, "0");
    $(id).value = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  }

  function onNew() {
    if (state.dirty) {
      restoreNewModal();
      $("new-modal").classList.add("open");
    }
    else createNew();
  }

  async function maybeOpen(fn) {
    if (state.dirty) {
      const ok = await askConfirm({
        title: "Открыть другой отчёт?",
        text: "В текущем отчёте есть несохранённые изменения. Если открыть другой файл, они пропадут.",
        ok: "Открыть без сохранения",
        danger: true,
      });
      if (!ok) return;
      await revertHistoryToLastSave();
    }
    await fn();
  }

  function onOrderInput(e) {
    const card = e.target.closest("[data-order]");
    if (!card) return;
    const order = findOrder(card.dataset.order);
    if (!order) return;
    if (e.target.dataset.g) {
      const g = e.target.dataset.g;
      if (g === "discount") {
        const v = Math.min(100, Math.max(0, num(e.target.value)));
        (order.lines || []).forEach((line) => {
          if (isFrozenLine(line) || isExpenseLine(line)) return;
          line.discount = v;
          line.discount_expr = String(v);
          applyPaidIfCovered(line);
        });
        markDirty();
        if (e.type !== "change") {
          card.querySelectorAll("[data-line]").forEach((tr) => {
            const line = order.lines.find((l) => l.id === tr.dataset.line);
            if (line) refreshComputed(card, tr, order, line);
          });
          followEditedOrder(order.id);
          return;
        }
      } else if (g === "status" || g === "order_type") {
        if (!e.target.value) return;
        (order.lines || []).forEach((line) => {
          if (isFrozenLine(line) || isExpenseLine(line)) return;
          if (g === "status" && statusLocked(line.status)) return;
          line[g] = e.target.value;
        });
        markDirty();
      } else if (g === "order_date" || g === "payment_date") {
        if (e.type !== "change" || !e.target.value) return;
        (order.lines || []).forEach((line) => {
          if (isFrozenLine(line)) return;
          if (g === "payment_date" && isExpenseLine(line)) return;
          line[g] = e.target.value;
        });
        markDirty();
      }
      renderOrders();
      return;
    }
    if (e.target.dataset.k) {
      if (e.target.dataset.k === "work_end" && orderPlacedOnCalendar(order)) {
        e.target.value = dateDay(order.work_end) || "";
        return;
      }
      order[e.target.dataset.k] = e.target.value;
      if (e.target.dataset.k === "notes") {
        card.querySelector(".note-btn")?.classList.toggle("has-note", !!String(e.target.value || "").trim());
      }
      if (e.target.dataset.k === "name" && !state.path) state.doc.title = e.target.value || state.doc.title;
      if (e.target.dataset.k === "customer" && e.type === "change") {
        syncCustomersFromOrders();
        const list = state.doc.customers || [];
        $("customer-list").innerHTML = unique(list.map((c) => c.name)).map((c) => `<option value="${esc(c)}">`).join("");
      }
      if (e.target.dataset.k === "work_start" || e.target.dataset.k === "work_end") {
        normalizeWorkDates(order);
        if (e.type === "change" && e.target.dataset.k === "work_end" && !dateDay(order.work_end) && orderHasOpenPosition(order)) {
          toast("Есть позиция в работе — у заказа нет конечной даты");
        }
        if (e.type === "change") {
          e.target.value = order[e.target.dataset.k] || "";
          const other = e.target.dataset.k === "work_start" ? "work_end" : "work_start";
          const otherEl = card.querySelector(`[data-k="${other}"]`);
          if (otherEl) otherEl.value = order[other] || "";
          const placed = orderPlacedOnCalendar(order);
          const endInput = card.querySelector('[data-k="work_end"]');
          const endBtn = card.querySelector('[data-act="work-end-today"]');
          if (endInput) {
            endInput.disabled = placed;
            endInput.title = placed
              ? orderHasOpenPosition(order)
                ? "Есть позиция в работе — у заказа нет конечной даты"
                : "Пока заказ в календаре, конец правится там и не раньше последней позиции"
              : "";
          }
          if (endBtn) endBtn.disabled = placed;
          const pill = card.querySelector(".work-pill");
          if (pill) {
            const meta = workStatusMeta(order);
            pill.className = `work-pill work-pill-${meta.id}`;
            pill.textContent = meta.label;
          }
        }
      }
      markDirty();
      followEditedOrder(order.id);
      return;
    }
    const tr = e.target.closest("[data-line]");
    if (!tr) return;
    const line = order.lines.find((l) => l.id === tr.dataset.line);
    if (!line || !e.target.dataset.lk) return;
    if (e.target.dataset.calcLock === "1" || e.target.classList.contains("is-calc-locked")) {
      const lock = calcLockFor(order.id, line.id, e.target.dataset.lk);
      if (lock?.reason) toast(lock.reason);
      return;
    }
    const key = e.target.dataset.lk;
    if (EXPR_MAP[key]) {
      if (e.target.dataset.showing === "result") return;
      commaToDot(e.target);
      if (key === "price_expr") {
        const cleaned = stripLeadingZerosPlain(e.target.value);
        if (cleaned !== e.target.value) {
          const pos = e.target.selectionStart;
          const diff = e.target.value.length - cleaned.length;
          e.target.value = cleaned;
          try {
            if (pos != null) e.target.setSelectionRange(Math.max(0, pos - diff), Math.max(0, pos - diff));
          } catch {
            /* ignore */
          }
        }
      }
      line[key] = e.target.value;
      const v = evalExpr(e.target.value);
      e.target.dataset.expr = e.target.value;
      e.target.classList.toggle("invalid", e.target.value.trim() !== "" && !Number.isFinite(v));
      if (Number.isFinite(v)) {
        const numKey = EXPR_MAP[key];
        let n = round2(v);
        if (numKey === "discount") n = Math.min(100, Math.max(0, n));
        if (numKey === "price" || numKey === "paid" || numKey === "tax_percent") n = Math.max(0, n);
        line[numKey] = n;
      }
    } else {
      const prevKind = key === "order_type" ? typeKind(line.order_type) : "";
      line[key] = key === "notes" ? String(e.target.value || "").slice(0, 2000) : e.target.type === "number" ? num(e.target.value) : e.target.value;
      if (key === "notes") {
        const on = lineHasNote(line);
        card.querySelectorAll(`[data-line="${cssEscape(line.id)}"] .note-btn`).forEach((btn) => btn.classList.toggle("has-note", on));
      }
      if (key === "product") {
        if (e.type === "change") ensureProduct(line.product, line.unit, line.price, productKindOfLine(line), line.tax_percent);
        applyLineProductDefaults(tr, line);
        if (e.type === "input" && !productSuggest.picking) openProductSuggest(e.target, "filter");
      }
      if (key === "tax_mode") {
        markDirty();
        renderOrders();
        requestAnimationFrame(() => focusLineCell(line.id, 4));
        return;
      }
      if (key === "order_type") {
        const nextKind = typeKind(line.order_type);
        if (nextKind !== prevKind) {
          if (nextKind && !prevKind) resetExpenseLine(line);
          line.tax_mode = nextKind === "tax" ? "gross" : "amount";
          markDirty();
          renderOrders();
          requestAnimationFrame(() => focusLineCell(line.id, 1));
          return;
        }
      }
    }
    applyPaidIfCovered(line);
    applyRowStatus(tr, line.status);
    const statusSel = tr.querySelector('[data-lk="status"]');
    if (statusSel && statusSel.value !== line.status) statusSel.value = line.status;
    markDirty();
    refreshComputed(card, tr, order, line);
    followEditedOrder(order.id);
  }

  function refreshComputed(card, tr, order, line) {
    const t = lineTotals(line, order);
    const cells = tr.querySelectorAll(".computed");
    if (t.expense) {
      if (cells[0]) cells[0].textContent = `−${money(t.cost)}`;
    } else {
      if (cells[0]) cells[0].textContent = money(t.unpaid);
      if (cells[1]) {
        cells[1].innerHTML = `${esc(money(t.after))}${beforeDiscountNote(t)}`;
      }
    }
    if (!t.expense || t.mode === "amount") refreshPercentRows(card, order);
    const tot = orderTotals(order);
    const foot = card.querySelector(".totals");
    if (foot) foot.innerHTML = orderTotalsHtml(tot);
    const oeSum = card.querySelector(".oe-sum");
    if (oeSum) oeSum.textContent = `−${money(tot.cost)} · чистыми ${money(tot.net)}`;
    updateOrdersSummary();
  }

  /** Налог в процентах зависит от других строк — обновляем его при любой правке заказа. */
  function refreshPercentRows(card, order) {
    for (const item of order.lines || []) {
      if (isFrozenLine(item) || !isExpenseLine(item) || taxMode(item) === "amount") continue;
      const row = card.querySelector(`tr[data-line="${cssEscape(item.id)}"]`);
      if (!row) continue;
      const t = lineTotals(item, order);
      const cell = row.querySelector(".computed");
      if (cell) cell.textContent = `−${money(t.cost)}`;
      const of = row.querySelector(".tax-of");
      if (of) of.textContent = `% от ${money(t.base)}`;
    }
  }

  function onExprFocus(e) {
    const inp = e.target;
    const key = inp.dataset?.lk;
    if (!EXPR_MAP[key] || inp.dataset.calcLock === "1" || inp.classList.contains("is-calc-locked")) return;
    if (inp.dataset.showing === "result") {
      inp.dataset.showing = "expr";
      inp.value = inp.dataset.expr || "";
      queueMicrotask(() => {
        try {
          inp.select();
        } catch {
          /* ignore */
        }
      });
      return;
    }
    if (key === "price_expr" && isBareZeroExpr(inp.value)) {
      queueMicrotask(() => {
        try {
          inp.select();
        } catch {
          /* ignore */
        }
      });
    }
  }

  function onExprBlur(e) {
    const inp = e.target;
    const key = inp.dataset?.lk;
    if (!EXPR_MAP[key] || inp.dataset.calcLock === "1" || inp.classList.contains("is-calc-locked")) return;
    const card = inp.closest("[data-order]");
    const tr = inp.closest("[data-line]");
    if (!card || !tr) return;
    const order = findOrder(card.dataset.order);
    const line = order?.lines.find((l) => l.id === tr.dataset.line);
    if (!line) return;
    const raw = inp.value.includes(",") && DECIMAL_KEYS.has(key) ? inp.value.replaceAll(",", ".") : inp.value;
    const next = key === "price_expr" ? stripLeadingZerosPlain(raw) : raw;
    if (next !== inp.value) inp.value = next;
    line[key] = next;
    inp.dataset.expr = raw;
    const v = evalExpr(raw);
    inp.classList.toggle("invalid", raw.trim() !== "" && !Number.isFinite(v));
    if (Number.isFinite(v)) {
      const numKey = EXPR_MAP[key];
      let n = round2(v);
      if (numKey === "discount") n = Math.min(100, Math.max(0, n));
      if (numKey === "price" || numKey === "paid") n = Math.max(0, n);
      line[numKey] = n;
      if (isFormula(raw)) {
        inp.dataset.showing = "result";
        inp.value = formatQty(n);
      } else {
        inp.dataset.showing = "expr";
      }
    }
    applyPaidIfCovered(line);
    applyRowStatus(tr, line.status);
    const statusSel = tr.querySelector('[data-lk="status"]');
    if (statusSel && statusSel.value !== line.status) statusSel.value = line.status;
    refreshComputed(card, tr, order, line);
    markDirty();
  }

  const SHARE_FIELDS = [
    { id: "number", label: "Номер заказа", kind: "meta" },
    { id: "customer", label: "Имя заказчика", kind: "meta" },
    { id: "organization", label: "Организация", kind: "meta" },
    { id: "name", label: "Название заказа", kind: "meta" },
    { id: "order_type", label: "Тип / работа", kind: "col" },
    { id: "product", label: "Продукт", kind: "col" },
    { id: "quantity", label: "Количество", kind: "col" },
    { id: "order_date", label: "Дата заказа", kind: "col" },
    { id: "status", label: "Статус", kind: "col" },
    { id: "price", label: "Цена", kind: "col" },
    { id: "discount", label: "Скидка", kind: "col" },
    { id: "total", label: "Сумма позиции", kind: "col" },
    { id: "paid", label: "Оплачено", kind: "col" },
    { id: "unpaid", label: "Не оплачено", kind: "col" },
    { id: "payment_date", label: "Дата оплаты", kind: "col" },
    { id: "totals", label: "Итоги заказа", kind: "meta" },
    { id: "expenses", label: "Налоги и затраты", kind: "meta" },
  ];
  const SHARE_PRESETS = {
    work: ["number", "name", "order_type", "product", "quantity", "status", "order_date"],
    invoice: ["number", "customer", "organization", "name", "order_type", "product", "quantity", "price", "discount", "total", "paid", "unpaid", "totals"],
    full: SHARE_FIELDS.map((f) => f.id),
  };

  const SHARE_THEMES = {
    teal: {
      label: "Изумруд",
      head: ["#0f766e", "#115e59"],
      headInk: "#ffffff",
      accent: "#0f766e",
      bg: "#ffffff",
      ink: "#0f172a",
      meta: "#334155",
      line: "#e2e8f0",
      thBg: "#f8fafc",
      thInk: "#64748b",
      zebra: "#f8fafc",
      footBg: "#f1f5f9",
      note: "#94a3b8",
    },
    graphite: {
      label: "Графит",
      head: ["#1e293b", "#0f172a"],
      headInk: "#ffffff",
      accent: "#334155",
      bg: "#ffffff",
      ink: "#0f172a",
      meta: "#334155",
      line: "#e2e8f0",
      thBg: "#f8fafc",
      thInk: "#64748b",
      zebra: "#f8fafc",
      footBg: "#f1f5f9",
      note: "#94a3b8",
    },
    indigo: {
      label: "Индиго",
      head: ["#4f46e5", "#3730a3"],
      headInk: "#ffffff",
      accent: "#4f46e5",
      bg: "#ffffff",
      ink: "#111827",
      meta: "#3f3f5a",
      line: "#e4e7f5",
      thBg: "#f5f6fd",
      thInk: "#6366f1",
      zebra: "#f9f9fe",
      footBg: "#eef0fc",
      note: "#a5b4fc",
    },
    gold: {
      label: "Золото",
      head: ["#c9a227", "#8a6d0f"],
      headInk: "#ffffff",
      accent: "#c9a227",
      bg: "#fffdf6",
      ink: "#1c1917",
      meta: "#44403c",
      line: "#ece3cd",
      thBg: "#faf5e6",
      thInk: "#a16207",
      zebra: "#fdfaf0",
      footBg: "#f7efdc",
      note: "#b8a67a",
    },
    rose: {
      label: "Вишня",
      head: ["#be123c", "#881337"],
      headInk: "#ffffff",
      accent: "#be123c",
      bg: "#ffffff",
      ink: "#18181b",
      meta: "#3f3f46",
      line: "#f0dde2",
      thBg: "#fdf2f5",
      thInk: "#9f1239",
      zebra: "#fdf8f9",
      footBg: "#fbe8ed",
      note: "#d4a4b3",
    },
    mono: {
      label: "Минимал",
      head: ["#ffffff", "#ffffff"],
      headInk: "#0f172a",
      headLine: true,
      accent: "#0f172a",
      bg: "#ffffff",
      ink: "#0f172a",
      meta: "#475569",
      line: "#e2e8f0",
      thBg: "#ffffff",
      thInk: "#94a3b8",
      zebra: "#fafafa",
      footBg: "#f8fafc",
      note: "#94a3b8",
    },
    night: {
      label: "Ночь",
      head: ["#1e293b", "#0b1220"],
      headInk: "#ffffff",
      accent: "#2dd4bf",
      bg: "#0f172a",
      ink: "#e7eef8",
      meta: "#cbd5e1",
      line: "#25324a",
      thBg: "#16233b",
      thInk: "#94a3b8",
      zebra: "#131f36",
      footBg: "#16233b",
      note: "#64748b",
    },
  };

  function shareThemeKey() {
    const key = ensureUi().share_theme;
    return SHARE_THEMES[key] ? key : "teal";
  }

  function shareTheme() {
    return SHARE_THEMES[shareThemeKey()];
  }

  function renderShareThemes() {
    const box = $("share-themes");
    if (!box) return;
    const cur = shareThemeKey();
    box.innerHTML = Object.entries(SHARE_THEMES)
      .map(
        ([key, t]) => `<button type="button" class="share-theme ${key === cur ? "active" : ""}" data-share-theme="${key}" title="${esc(t.label)}">
          <span class="st-swatch" style="background:linear-gradient(135deg, ${t.head[0]}, ${t.head[1]})"></span>
          <span>${esc(t.label)}</span>
        </button>`
      )
      .join("");
  }

  function currentShareFields() {
    return [...document.querySelectorAll("#share-fields input:checked")].map((el) => el.value);
  }

  function fmtShareDate(value) {
    if (!value) return "—";
    return dateDay(value) || "—";
  }

  function customerOrg(name) {
    return (state.doc.customers || []).find((c) => c.name === name)?.organization || "";
  }

  function shareNumber(n) {
    const r = round2(n);
    if (Number.isInteger(r)) return String(r);
    return r.toFixed(2).replace(".", ",");
  }

  function shareLineValue(line, id) {
    const t = lineTotals(line);
    if (t.expense) {
      // Расход в снимке — только название, объём и сумма с минусом; скидок и оплат у него нет.
      if (id === "order_type") return `${line.order_type || "—"} · ${kindLabel(t.kind)}`;
      if (id === "product") return line.product || "—";
      if (id === "quantity") return t.mode === "amount" ? `${shareNumber(qtyValue(line))} ${line.unit || ""}`.trim() : `${shareNumber(t.percent)} %`;
      if (id === "price") return t.mode === "amount" ? money(numExpr(line, "price_expr", "price")) : money(t.base);
      if (id === "total") return `−${money(t.cost)}`;
      if (id === "order_date") return fmtShareDate(line.order_date);
      return "—";
    }
    if (id === "order_type") return line.order_type || "—";
    if (id === "product") return line.product || "—";
    if (id === "quantity") return `${shareNumber(qtyValue(line))} ${line.unit || ""}`.trim();
    if (id === "price") return money(numExpr(line, "price_expr", "price"));
    if (id === "discount") return `${shareNumber(numExpr(line, "discount_expr", "discount"))} %`;
    if (id === "total") return money(t.after);
    if (id === "paid") return money(t.paid);
    if (id === "unpaid") return money(t.unpaid);
    if (id === "order_date") return fmtShareDate(line.order_date);
    if (id === "payment_date") return fmtShareDate(line.payment_date);
    if (id === "status") return line.status || "—";
    return "";
  }

  function shareHideLabels() {
    return !!$("share-hide-labels")?.checked;
  }

  function shareHideStamp() {
    return !!$("share-hide-stamp")?.checked;
  }

  function shareTitleText(blocks) {
    const typed = ($("share-title")?.value || "").trim();
    if (typed) return typed;
    if (blocks.length === 1) {
      const o = blocks[0].order;
      return [o.number, o.name].filter(Boolean).join(" · ") || "Снимок заказа";
    }
    if (blocks.length > 1) return `Заказы (${blocks.length})`;
    return "Снимок заказа";
  }

  function linesTotals(lines) {
    const acc = (lines || []).reduce(
      (sum, line) => {
        const t = lineTotals(line);
        if (t.expense) {
          sum.cost += t.cost;
          return sum;
        }
        sum.total += t.total;
        sum.after += t.after;
        sum.paid += t.paid;
        sum.unpaid += t.unpaid;
        return sum;
      },
      { total: 0, after: 0, paid: 0, unpaid: 0, cost: 0 }
    );
    acc.net = round2(acc.after - acc.cost);
    return acc;
  }

  /** Расходы попадают в снимок только при включённом поле «Налоги и затраты». */
  function shareShowsExpenses() {
    return currentShareFields().includes("expenses");
  }

  function selectedShareBlocks() {
    const withExpenses = shareShowsExpenses();
    return [...document.querySelectorAll("#share-orders .share-order")]
      .map((block) => {
        const order = findOrder(block.dataset.order);
        if (!order || !block.querySelector("[data-share-order]")?.checked) return null;
        const ids = new Set([...block.querySelectorAll("[data-share-line]:checked")].map((el) => el.dataset.shareLine));
        const lines = (order.lines || []).filter((l) => ids.has(l.id) && !isFrozenLine(l) && (withExpenses || !isExpenseLine(l)));
        if (!lines.length) return null;
        return { order, lines };
      })
      .filter(Boolean);
  }

  function shareMetaPairs(order, fields) {
    const items = [];
    if (fields.includes("number")) items.push(["№", order.number]);
    if (fields.includes("name")) items.push(["Заказ", order.name]);
    if (fields.includes("customer")) items.push(["Заказчик", order.customer]);
    if (fields.includes("organization")) items.push(["Организация", customerOrg(order.customer)]);
    return items;
  }

  function shareMetaItems(order, fields, hideLabels) {
    return shareMetaPairs(order, fields).map(([label, value]) => {
      const v = value || "—";
      if (hideLabels) return v;
      return label === "№" ? `№ ${v}` : `${label}: ${v}`;
    });
  }

  function shareTotalsText(fields, cols, lines) {
    if (!fields.includes("totals") || shareNeedsMoneyFooter(cols)) return "";
    const tot = linesTotals(lines);
    const bits = [];
    if (fields.includes("total") || !cols.length) bits.push(`Итого ${money(tot.after)}`);
    if (tot.cost > 0.005) {
      bits.push(`расходы −${money(tot.cost)}`);
      bits.push(`к оплате ${money(tot.net)}`);
    }
    if (fields.includes("paid")) bits.push(`оплачено ${money(tot.paid)}`);
    if (fields.includes("unpaid")) bits.push(`остаток ${money(tot.unpaid)}`);
    return bits.length ? bits.join(" · ") : `Позиций: ${lines.length}`;
  }

  const SHARE_MONEY_COLS = new Set(["total", "paid", "unpaid"]);

  function shareNeedsMoneyFooter(cols) {
    return (cols || []).some((c) => SHARE_MONEY_COLS.has(c.id));
  }

  function shareFooterValue(colId, lines) {
    const tot = linesTotals(lines);
    if (colId === "total") return tot.cost > 0.005 ? money(tot.net) : money(tot.after);
    if (colId === "paid") return money(tot.paid);
    if (colId === "unpaid") return money(tot.unpaid);
    return "";
  }

  function shareFooterCells(cols, lines) {
    if (!shareNeedsMoneyFooter(cols)) return null;
    return cols.map((c) => (SHARE_MONEY_COLS.has(c.id) ? shareFooterValue(c.id, lines) : ""));
  }

  function shareColWidths(cols, linesList) {
    const ctx = document.createElement("canvas").getContext("2d");
    const cellPad = 24;
    return cols.map((col) => {
      ctx.font = "600 11px Segoe UI, sans-serif";
      let w = ctx.measureText(String(col.label || "").toUpperCase()).width;
      ctx.font = "13px Segoe UI, sans-serif";
      (linesList || []).forEach((line) => {
        w = Math.max(w, ctx.measureText(String(shareLineValue(line, col.id) || "—")).width);
      });
      ctx.font = "700 13px Segoe UI, sans-serif";
      const foot = shareFooterCells(cols, linesList);
      if (foot) {
        const idx = cols.indexOf(col);
        w = Math.max(w, ctx.measureText(String(foot[idx] || "")).width);
      }
      return Math.max(52, Math.ceil(w + cellPad));
    });
  }

  function shareColStarts(widths, origin) {
    const xs = [];
    let x = origin;
    widths.forEach((w) => {
      xs.push(x);
      x += w;
    });
    return xs;
  }

  /** Одинаковые ширины колонок для всех таблиц снимка. */
  function shareSharedColWidths(cols, blocks) {
    if (!cols.length || !blocks.length) return [];
    const per = blocks.map((b) => shareColWidths(cols, b.lines));
    return cols.map((_, i) => Math.max(...per.map((w) => w[i])));
  }

  const LS_SHARE_GRAND = "finmaster.shareGrand";

  function shareGrandOn(blocks) {
    return (blocks?.length || 0) > 1 && !!$("share-grand")?.checked;
  }

  function shareGrandData(blocks) {
    const rows = blocks.map(({ order, lines }) => ({ order, lines, tot: linesTotals(lines) }));
    const sum = rows.reduce(
      (acc, r) => {
        acc.total += r.tot.total;
        acc.after += r.tot.after;
        acc.paid += r.tot.paid;
        acc.unpaid += r.tot.unpaid;
        acc.cost += r.tot.cost;
        acc.lines += r.lines.filter((l) => !isExpenseLine(l)).length;
        return acc;
      },
      { total: 0, after: 0, paid: 0, unpaid: 0, cost: 0, lines: 0 }
    );
    ["total", "after", "paid", "unpaid", "cost"].forEach((k) => (sum[k] = round2(sum[k])));
    sum.net = round2(sum.after - sum.cost);
    sum.orders = rows.length;
    return { rows, sum };
  }

  function shareGrandCols(fields, grand) {
    const cols = [{ id: "order", label: "Заказ" }];
    if (fields.includes("customer")) cols.push({ id: "customer", label: "Заказчик" });
    cols.push({ id: "after", label: "Итого", money: true });
    if (grand.sum.cost > 0.005) {
      cols.push({ id: "cost", label: "Расходы", money: true });
      cols.push({ id: "net", label: "К оплате", money: true });
    }
    if (fields.includes("paid")) cols.push({ id: "paid", label: "Оплачено", money: true });
    if (fields.includes("unpaid")) cols.push({ id: "unpaid", label: "Остаток", money: true });
    return cols;
  }

  function shareGrandCell(row, colId) {
    const { order, tot } = row;
    if (colId === "order") return [order.number ? `№ ${order.number}` : "", order.name].filter(Boolean).join(" · ") || "—";
    if (colId === "customer") return order.customer || "—";
    if (colId === "cost") return tot.cost > 0.005 ? `−${money(tot.cost)}` : "—";
    return money(tot[colId] || 0);
  }

  function shareGrandFootCell(sum, colId) {
    if (colId === "order") return `Всего · ${sum.orders} зак.`;
    if (colId === "customer") return "";
    if (colId === "cost") return sum.cost > 0.005 ? `−${money(sum.cost)}` : "—";
    return money(sum[colId] || 0);
  }

  function shareGrandWidths(cols, grand) {
    const ctx = document.createElement("canvas").getContext("2d");
    return cols.map((col) => {
      ctx.font = "600 11px Segoe UI, sans-serif";
      let w = ctx.measureText(col.label.toUpperCase()).width;
      ctx.font = "13px Segoe UI, sans-serif";
      grand.rows.forEach((row) => {
        w = Math.max(w, ctx.measureText(shareGrandCell(row, col.id)).width);
      });
      ctx.font = "700 13px Segoe UI, sans-serif";
      w = Math.max(w, ctx.measureText(shareGrandFootCell(grand.sum, col.id)).width);
      return Math.max(52, Math.ceil(w + 24));
    });
  }

  /** Выбор в окне снимка живёт между открытиями окна. */
  let shareMemory = null;

  function rememberShareState() {
    const box = $("share-orders");
    if (!box || !$("share-modal")?.classList.contains("open")) return;
    const blocks = [...box.querySelectorAll(".share-order")];
    shareMemory = {
      orders: new Set(blocks.filter((b) => b.querySelector("[data-share-order]")?.checked).map((b) => b.dataset.order)),
      lines: new Set([...box.querySelectorAll("[data-share-line]:checked")].map((el) => el.dataset.shareLine)),
      known: new Set([...box.querySelectorAll("[data-share-line]")].map((el) => el.dataset.shareLine)),
      open: new Set(blocks.filter((b) => !b.classList.contains("collapsed")).map((b) => b.dataset.order)),
      title: $("share-title")?.value || "",
      folds: Object.fromEntries([...document.querySelectorAll("#share-modal .share-fold")].map((f) => [f.id, !f.classList.contains("collapsed")])),
    };
  }

  function renderShareOrdersPicker(focusOrderId) {
    const box = $("share-orders");
    const orders = [...(state.doc.orders || [])].sort((a, b) => orderNewestStamp(b).localeCompare(orderNewestStamp(a)));
    const mem = shareMemory;
    const focusNew = !!(focusOrderId && (!mem || !mem.orders.has(focusOrderId)));
    box.innerHTML = orders.length
      ? orders
          .map((order) => {
            const forced = focusNew && focusOrderId === order.id;
            const on = forced || (mem ? mem.orders.has(order.id) : false);
            const open = forced || focusOrderId === order.id || (mem ? mem.open.has(order.id) : false);
            const lineOn = (line) => {
              if (forced || !mem) return on;
              return mem.known.has(line.id) ? mem.lines.has(line.id) : on;
            };
            return `<div class="share-order ${open ? "" : "collapsed"}" data-order="${esc(order.id)}" data-q="${esc(
              shareSearchText(order.number, order.name, order.customer, order.organization)
            )}">
          <div class="share-order-head">
            <button type="button" class="share-toggle" data-share-toggle title="Строки заказа" aria-expanded="${open ? "true" : "false"}">${open ? "▾" : "▸"}</button>
            <label><input type="checkbox" data-share-order ${on ? "checked" : ""} /> ${esc(order.number || "—")} · ${esc(order.name || "без названия")}</label>
          </div>
          <div class="share-lines">${(order.lines || [])
            .filter((line) => !isFrozenLine(line))
            .map((line) => {
              const kind = typeKind(line.order_type);
              return `<label class="${kind ? "share-cost" : ""}" data-q="${esc(
                shareSearchText(line.order_type, line.product, line.status, kind ? kindLabel(kind) : "")
              )}"><input type="checkbox" data-share-line="${esc(line.id)}" ${
                lineOn(line) ? "checked" : ""
              } /> ${esc(line.order_type || "тип")} · ${esc(line.product || "—")}${kind ? ` · ${esc(kindLabel(kind))}` : ""}</label>`;
            })
            .join("")}</div>
        </div>`;
          })
          .join("")
      : `<div class="hint">Нет заказов</div>`;
    applyShareSearch();
    if (focusOrderId) {
      [...box.querySelectorAll(".share-order")].find((el) => el.dataset.order === focusOrderId)?.scrollIntoView({ block: "nearest" });
    }
  }

  function shareSearchText(...parts) {
    return parts
      .map((p) => String(p ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .replace(/ё/g, "е");
  }

  /** Фильтр списка «Заказы и строки»: скрывает лишнее, галочки не трогает. */
  function applyShareSearch() {
    const box = $("share-orders");
    if (!box) return;
    syncSearchClear($("share-orders-search"));
    const words = shareSearchText($("share-orders-search")?.value).split(/\s+/).filter(Boolean);
    const hit = (text) => words.every((w) => text.includes(w));
    let shownOrders = 0;
    let shownLines = 0;
    box.querySelectorAll(".share-order").forEach((block) => {
      const labels = [...block.querySelectorAll(".share-lines > label")];
      const orderText = block.dataset.q || "";
      const orderHit = !words.length || hit(orderText);
      let lineHits = 0;
      labels.forEach((label) => {
        const show = orderHit || hit(`${orderText} ${label.dataset.q || ""}`);
        label.classList.toggle("is-search-hidden", !show);
        if (show) lineHits += 1;
      });
      const visible = orderHit || lineHits > 0;
      block.classList.toggle("is-search-hidden", !visible);
      block.classList.toggle("is-search-open", !!words.length && visible && !orderHit);
      if (visible) {
        shownOrders += 1;
        shownLines += lineHits;
      }
    });
    box.classList.toggle("is-searching", words.length > 0);
    const found = $("share-orders-found");
    if (found) found.textContent = words.length ? (shownOrders ? `${shownOrders} зак. · ${shownLines} стр.` : "ничего") : "";
    const all = $("share-check-all");
    const none = $("share-check-none");
    if (all) all.dataset.tip = words.length ? "Отметить найденные заказы и строки" : "Отметить все заказы и строки";
    if (none) none.dataset.tip = words.length ? "Снять галочки с найденных заказов и строк" : "Снять все галочки с заказов и строк";
  }

  function openShare(orderOrId) {
    const order = typeof orderOrId === "string" ? findOrder(orderOrId) : orderOrId;
    const saved = ensureUi().share_fields;
    const selected = saved && saved.length ? saved : SHARE_PRESETS.work;
    $("share-fields").innerHTML = SHARE_FIELDS.map(
      (f) => `<label><input type="checkbox" value="${f.id}" ${selected.includes(f.id) ? "checked" : ""} /> ${esc(f.label)}</label>`
    ).join("");
    renderShareThemes();
    renderShareOrdersPicker(order?.id || null);
    const grandBox = $("share-grand");
    if (grandBox) {
      let saved = null;
      try {
        saved = localStorage.getItem(LS_SHARE_GRAND);
      } catch {
        saved = null;
      }
      grandBox.checked = saved !== "0";
    }
    $("share-title").value = shareMemory?.title || "";
    document.querySelectorAll("#share-modal .share-fold").forEach((fold) => {
      const open = !!shareMemory?.folds?.[fold.id];
      fold.classList.toggle("collapsed", !open);
      const ico = fold.querySelector(".share-fold-ico");
      if (ico) ico.textContent = open ? "▾" : "▸";
    });
    $("share-modal").classList.add("open");
    renderSharePreview();
    if (order) {
      requestAnimationFrame(() =>
        [...document.querySelectorAll("#share-orders .share-order")]
          .find((el) => el.dataset.order === order.id)
          ?.scrollIntoView({ block: "nearest" })
      );
    }
  }

  function setAllShareChecks(on) {
    document.querySelectorAll("#share-orders .share-order:not(.is-search-hidden)").forEach((block) => {
      const lines = [...block.querySelectorAll("[data-share-line]")];
      lines.forEach((el) => {
        if (!el.closest(".is-search-hidden")) el.checked = on;
      });
      const orderCb = block.querySelector("[data-share-order]");
      if (orderCb) orderCb.checked = lines.length ? lines.some((el) => el.checked) : on;
    });
    renderSharePreview();
  }

  function shareLinePayMatch(line, order, mode) {
    if (!line || isFrozenLine(line) || isExpenseLine(line)) return false;
    const tot = lineTotals(line, order);
    if (mode === "debt") return tot.unpaid > 0.005;
    if (mode === "paid") return tot.after > 0.005 && tot.unpaid <= 0.005;
    return true;
  }

  /** Отметить в снимке только позиции с долгом или только оплаченные. */
  function setShareChecksByPay(mode) {
    document.querySelectorAll("#share-orders .share-order").forEach((block) => {
      const order = findOrder(block.dataset.order);
      let any = false;
      block.querySelectorAll("[data-share-line]").forEach((el) => {
        const line = (order?.lines || []).find((item) => item.id === el.dataset.shareLine);
        const on = shareLinePayMatch(line, order, mode);
        el.checked = on;
        if (on) any = true;
      });
      const orderCb = block.querySelector("[data-share-order]");
      if (orderCb) orderCb.checked = any;
      if (any) block.classList.remove("collapsed");
    });
    applyShareSearch();
    renderSharePreview();
  }

  /* ---- Профили полей снимка (общие для всех отчётов) ---- */

  const LS_SHARE_PROFILES = "finmaster.shareProfiles";

  function loadShareProfiles() {
    try {
      const list = JSON.parse(localStorage.getItem(LS_SHARE_PROFILES) || "[]");
      return Array.isArray(list) ? list.filter((p) => p && String(p.name || "").trim() && Array.isArray(p.fields)) : [];
    } catch {
      return [];
    }
  }

  function storeShareProfiles(list) {
    persistPref(LS_SHARE_PROFILES, JSON.stringify(list), { now: true });
  }

  function shareProfileSnapshot() {
    return {
      fields: currentShareFields(),
      hideLabels: shareHideLabels(),
      hideStamp: shareHideStamp(),
      grand: !!$("share-grand")?.checked,
    };
  }

  function shareProfileMatches(p, cur) {
    const a = [...p.fields].sort().join(",");
    const b = [...cur.fields].sort().join(",");
    return a === b && !!p.hideLabels === cur.hideLabels && !!p.hideStamp === cur.hideStamp && (p.grand ?? true) === cur.grand;
  }

  function renderShareProfiles() {
    const box = $("share-profile-list");
    if (!box) return;
    const list = loadShareProfiles();
    const cur = shareProfileSnapshot();
    box.innerHTML = list.length
      ? list
          .map(
            (p, i) => `<span class="share-profile ${shareProfileMatches(p, cur) ? "active" : ""}">
          <button type="button" data-profile-apply="${i}" title="Применить профиль «${esc(p.name)}»">${esc(p.name)}</button>
          <button type="button" data-profile-del="${i}" title="Удалить профиль" aria-label="Удалить профиль">×</button>
        </span>`
          )
          .join("")
      : `<span class="hint">Пока нет — отметьте поля и сохраните профиль.</span>`;
  }

  function applyShareProfile(p) {
    const ids = new Set(p.fields);
    document.querySelectorAll("#share-fields input").forEach((el) => {
      el.checked = ids.has(el.value);
    });
    $("share-hide-labels").checked = !!p.hideLabels;
    $("share-hide-stamp").checked = !!p.hideStamp;
    const grand = $("share-grand");
    if (grand) {
      grand.checked = p.grand ?? true;
      persistPref(LS_SHARE_GRAND, grand.checked ? "1" : "0");
    }
    ensureUi().share_fields = currentShareFields();
    markDirty();
    renderSharePreview();
  }

  function saveShareProfile() {
    const input = $("share-profile-name");
    const name = String(input?.value || "").trim().replace(/\s+/g, " ");
    if (!name) {
      toast("Введите название профиля");
      input?.focus();
      return;
    }
    const list = loadShareProfiles();
    const key = name.toLocaleLowerCase("ru");
    const idx = list.findIndex((p) => String(p.name).trim().toLocaleLowerCase("ru") === key);
    const entry = { name, ...shareProfileSnapshot() };
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
    storeShareProfiles(list);
    if (input) input.value = "";
    renderShareProfiles();
    toast(idx >= 0 ? `Профиль «${name}» обновлён` : `Профиль «${name}» сохранён`);
  }

  async function deleteShareProfile(index) {
    const list = loadShareProfiles();
    const p = list[index];
    if (!p) return;
    const ok = await askConfirm({
      title: "Удалить профиль?",
      text: `Профиль «${p.name}» будет удалён. Текущие поля снимка не изменятся.`,
      ok: "Удалить",
      danger: true,
    });
    if (!ok) return;
    list.splice(index, 1);
    storeShareProfiles(list);
    renderShareProfiles();
  }

  function applySharePreset(name) {
    const ids = SHARE_PRESETS[name] || SHARE_PRESETS.work;
    document.querySelectorAll("#share-fields input").forEach((el) => {
      el.checked = ids.includes(el.value);
    });
    ensureUi().share_fields = ids.slice();
    markDirty();
    renderSharePreview();
  }

  function renderSharePreview() {
    const box = $("share-preview");
    if (!box) return;
    const blocks = selectedShareBlocks();
    const fields = currentShareFields();
    const hideLabels = shareHideLabels();
    const hideStamp = shareHideStamp();
    const cols = SHARE_FIELDS.filter((f) => f.kind === "col" && fields.includes(f.id));
    const title = shareTitleText(blocks);
    const t = shareTheme();
    const sharedWidths = shareSharedColWidths(cols, blocks);
    const body = blocks.length
      ? blocks
          .map(({ order, lines }, i) => {
            const meta = shareMetaItems(order, fields, hideLabels);
            const totalsText = shareTotalsText(fields, cols, lines);
            const foot = shareFooterCells(cols, lines);
            const colWidths = sharedWidths;
            const table = cols.length
              ? `<table style="width:max-content;border-collapse:collapse;font-size:13px;table-layout:fixed"><colgroup>${colWidths
                  .map((w) => `<col style="width:${w}px">`)
                  .join("")}</colgroup><thead><tr>${cols
                  .map(
                    (c) =>
                      `<th style="text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:${t.thInk};background:${t.thBg};border-top:1px solid ${t.line};white-space:nowrap">${esc(c.label)}</th>`
                  )
                  .join("")}</tr></thead><tbody>${lines
                  .map(
                    (line, ri) =>
                      `<tr style="background:${ri % 2 ? t.zebra : "transparent"}">${cols
                        .map(
                          (c) =>
                            `<td style="text-align:left;padding:8px 10px;border-top:1px solid ${t.line};color:${t.ink};white-space:nowrap">${esc(shareLineValue(line, c.id))}</td>`
                        )
                        .join("")}</tr>`
                  )
                  .join("")}</tbody>${
                  foot
                    ? `<tfoot><tr>${foot
                        .map(
                          (v) =>
                            `<td style="text-align:left;padding:10px;border-top:2px solid ${t.accent};font-weight:700;color:${t.ink};background:${t.footBg};white-space:nowrap">${esc(v)}</td>`
                        )
                        .join("")}</tr></tfoot>`
                    : ""
                }</table>`
              : "";
            const sep = i ? `border-top:2px solid ${t.accent};margin-top:12px;padding-top:16px;` : "";
            return `<div class="share-order-block" style="padding:0 20px 16px;${sep}">
          ${meta.length ? `<div class="sp-meta" style="padding:0 0 10px;display:grid;gap:4px;font-size:13px;color:${t.meta}">${meta.map((m) => `<div>${esc(m)}</div>`).join("")}</div>` : ""}
          ${table || `<div style="padding:8px 0;font-size:13px;color:${t.note}">Таблица работ скрыта — включите колонки слева.</div>`}
          ${totalsText ? `<div class="sp-foot" style="padding:10px 0 4px;font-size:14px;color:${t.ink}"><b>${esc(totalsText)}</b></div>` : ""}
        </div>`;
          })
          .join("") + shareGrandHtml(blocks, fields, t)
      : `<div style="padding:20px;color:${t.note}">Выберите хотя бы один заказ и строку слева.</div>`;
    box.style.background = t.bg;
    box.style.color = t.ink;
    box.innerHTML = `
      <div class="sp-head" style="background:linear-gradient(90deg,${t.head[0]},${t.head[1]});color:${t.headInk};padding:18px 20px;${
        t.headLine ? `border-bottom:2px solid ${t.accent};` : ""
      }">
        <b style="font-size:18px;display:block">${esc(title)}</b>
      </div>
      ${body}
      ${hideStamp ? "" : `<div class="sp-note" style="padding:0 20px 16px;font-size:11px;color:${t.note}">Сформировано ${esc(new Date().toLocaleString("ru-RU"))}</div>`}
    `;
    renderShareProfiles();
    rememberShareState();
  }

  function shareGrandHtml(blocks, fields, t) {
    if (!shareGrandOn(blocks)) return "";
    const grand = shareGrandData(blocks);
    const cols = shareGrandCols(fields, grand);
    const widths = shareGrandWidths(cols, grand);
    const cell = (text, extra = "") =>
      `<td style="text-align:left;padding:8px 10px;border-top:1px solid ${t.line};color:${t.ink};white-space:nowrap;${extra}">${esc(text)}</td>`;
    return `<div class="share-order-block share-grand" style="padding:16px 20px 16px;border-top:2px solid ${t.accent};margin-top:12px">
      <div style="font-size:15px;font-weight:700;color:${t.accent};margin-bottom:10px">Общий итог</div>
      <table style="width:max-content;border-collapse:collapse;font-size:13px;table-layout:fixed"><colgroup>${widths
        .map((w) => `<col style="width:${w}px">`)
        .join("")}</colgroup><thead><tr>${cols
        .map(
          (c) =>
            `<th style="text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:${t.thInk};background:${t.thBg};border-top:1px solid ${t.line};white-space:nowrap">${esc(c.label)}</th>`
        )
        .join("")}</tr></thead><tbody>${grand.rows
        .map((row, ri) => `<tr style="background:${ri % 2 ? t.zebra : "transparent"}">${cols.map((c) => cell(shareGrandCell(row, c.id))).join("")}</tr>`)
        .join("")}</tbody><tfoot><tr>${cols
        .map((c) => cell(shareGrandFootCell(grand.sum, c.id), `border-top:2px solid ${t.accent};font-weight:700;background:${t.footBg}`))
        .join("")}</tr></tfoot></table>
    </div>`;
  }

  function wrapCanvasText(ctx, text, maxW) {
    const words = String(text || "").split(/\s+/);
    const lines = [];
    let cur = "";
    words.forEach((w) => {
      const test = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(test).width > maxW && cur) {
        lines.push(cur);
        cur = w;
      } else cur = test;
    });
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  }

  function fitCanvasText(ctx, text, maxW) {
    const s = String(text || "");
    if (ctx.measureText(s).width <= maxW) return s;
    let t = s;
    while (t.length && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
    return `${t}…`;
  }

  function shareToCanvas() {
    const blocks = selectedShareBlocks();
    if (!blocks.length) throw new Error("Выберите заказы и строки для снимка");
    const fields = currentShareFields();
    const hideLabels = shareHideLabels();
    const hideStamp = shareHideStamp();
    const cols = SHARE_FIELDS.filter((f) => f.kind === "col" && fields.includes(f.id));
    const title = shareTitleText(blocks);
    const stamp = `Сформировано ${new Date().toLocaleString("ru-RU")}`;
    const pad = 20;
    const rowH = 34;
    const sharedWidths = shareSharedColWidths(cols, blocks);
    const sharedTableW = sharedWidths.reduce((s, w) => s + w, 0);
    const layouts = blocks.map(({ order, lines }) => ({ order, lines, colWidths: sharedWidths, tableW: sharedTableW }));
    const grand = shareGrandOn(blocks) ? shareGrandData(blocks) : null;
    const grandCols = grand ? shareGrandCols(fields, grand) : [];
    const grandWidths = grand ? shareGrandWidths(grandCols, grand) : [];
    const grandTableW = grandWidths.reduce((s, w) => s + w, 0);
    const measure = document.createElement("canvas").getContext("2d");
    let inner = Math.max(0, sharedTableW, grandTableW);
    measure.font = "700 20px Segoe UI, sans-serif";
    inner = Math.max(inner, measure.measureText(title).width);
    measure.font = "13px Segoe UI, sans-serif";
    layouts.forEach(({ order, lines }) => {
      shareMetaItems(order, fields, hideLabels).forEach((line) => {
        inner = Math.max(inner, measure.measureText(line).width);
      });
      const totalsText = shareTotalsText(fields, cols, lines);
      if (totalsText) {
        measure.font = "700 14px Segoe UI, sans-serif";
        inner = Math.max(inner, measure.measureText(totalsText).width);
        measure.font = "13px Segoe UI, sans-serif";
      }
    });
    if (!hideStamp) {
      measure.font = "11px Segoe UI, sans-serif";
      inner = Math.max(inner, measure.measureText(stamp).width);
    }
    const width = Math.ceil(pad * 2 + Math.max(inner, 80));
    const headerH = 64;
    let bodyH = 16;
    layouts.forEach(({ order, lines }, bi) => {
      const meta = shareMetaItems(order, fields, hideLabels);
      const foot = shareFooterCells(cols, lines);
      bodyH +=
        (bi ? 36 : 0) +
        (meta.length ? meta.length * 22 + 10 : 0) +
        (cols.length ? 32 + lines.length * rowH + (foot ? rowH : 0) : 28) +
        (shareTotalsText(fields, cols, lines) ? 36 : 0) +
        16;
    });
    if (grand) bodyH += 36 + 30 + 32 + grand.rows.length * rowH + rowH + 16;
    const height = headerH + bodyH + (hideStamp ? 16 : 36);
    const scale = 2;
    const theme = shareTheme();
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, width, height);
    const head = ctx.createLinearGradient(0, 0, width, 0);
    head.addColorStop(0, theme.head[0]);
    head.addColorStop(1, theme.head[1]);
    ctx.fillStyle = head;
    ctx.fillRect(0, 0, width, headerH);
    if (theme.headLine) {
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, headerH - 1);
      ctx.lineTo(width, headerH - 1);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    ctx.fillStyle = theme.headInk;
    ctx.font = "700 20px Segoe UI, sans-serif";
    ctx.fillText(title, pad, 40);
    let y = headerH + 16;
    layouts.forEach(({ order, lines, colWidths, tableW }, bi) => {
      if (bi) {
        y += 16;
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(width - pad, y);
        ctx.stroke();
        ctx.lineWidth = 1;
        y += 20;
      }
      const meta = shareMetaItems(order, fields, hideLabels);
      ctx.fillStyle = theme.meta;
      ctx.font = "13px Segoe UI, sans-serif";
      meta.forEach((line) => {
        ctx.fillText(line, pad, y + 14);
        y += 22;
      });
      if (meta.length) y += 10;
      if (cols.length) {
        const xs = shareColStarts(colWidths, pad);
        ctx.fillStyle = theme.thBg;
        ctx.fillRect(pad, y, tableW, 32);
        ctx.fillStyle = theme.thInk;
        ctx.font = "600 11px Segoe UI, sans-serif";
        cols.forEach((col, i) => {
          ctx.fillText(fitCanvasText(ctx, col.label.toUpperCase(), colWidths[i] - 12), xs[i] + 8, y + 21);
        });
        y += 32;
        ctx.font = "13px Segoe UI, sans-serif";
        lines.forEach((line, ri) => {
          if (ri % 2) {
            ctx.fillStyle = theme.zebra;
            ctx.fillRect(pad, y, tableW, rowH);
          }
          ctx.strokeStyle = theme.line;
          ctx.beginPath();
          ctx.moveTo(pad, y);
          ctx.lineTo(pad + tableW, y);
          ctx.stroke();
          ctx.fillStyle = theme.ink;
          cols.forEach((col, i) => {
            const text = fitCanvasText(ctx, String(shareLineValue(line, col.id) || "—"), colWidths[i] - 12);
            ctx.save();
            ctx.beginPath();
            ctx.rect(xs[i], y, colWidths[i] - 2, rowH);
            ctx.clip();
            ctx.fillText(text, xs[i] + 8, y + 22);
            ctx.restore();
          });
          y += rowH;
        });
        const foot = shareFooterCells(cols, lines);
        if (foot) {
          ctx.fillStyle = theme.footBg;
          ctx.fillRect(pad, y, tableW, rowH);
          ctx.strokeStyle = theme.accent;
          ctx.beginPath();
          ctx.moveTo(pad, y);
          ctx.lineTo(pad + tableW, y);
          ctx.stroke();
          ctx.fillStyle = theme.ink;
          ctx.font = "700 13px Segoe UI, sans-serif";
          foot.forEach((v, i) => {
            ctx.save();
            ctx.beginPath();
            ctx.rect(xs[i], y, colWidths[i] - 2, rowH);
            ctx.clip();
            ctx.fillText(fitCanvasText(ctx, v, colWidths[i] - 12), xs[i] + 8, y + 22);
            ctx.restore();
          });
          y += rowH;
        }
      }
      const totalsText = shareTotalsText(fields, cols, lines);
      if (totalsText) {
        y += 14;
        ctx.fillStyle = theme.ink;
        ctx.font = "700 14px Segoe UI, sans-serif";
        ctx.fillText(totalsText, pad, y + 14);
        y += 22;
      }
      y += 16;
    });
    if (grand) {
      y += 16;
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(width - pad, y);
      ctx.stroke();
      ctx.lineWidth = 1;
      y += 20;
      ctx.fillStyle = theme.accent;
      ctx.font = "700 15px Segoe UI, sans-serif";
      ctx.fillText("Общий итог", pad, y + 14);
      y += 30;
      const xs = shareColStarts(grandWidths, pad);
      ctx.fillStyle = theme.thBg;
      ctx.fillRect(pad, y, grandTableW, 32);
      ctx.fillStyle = theme.thInk;
      ctx.font = "600 11px Segoe UI, sans-serif";
      grandCols.forEach((col, i) => ctx.fillText(fitCanvasText(ctx, col.label.toUpperCase(), grandWidths[i] - 12), xs[i] + 8, y + 21));
      y += 32;
      const drawRow = (cells, bold, bg, lineColor) => {
        if (bg) {
          ctx.fillStyle = bg;
          ctx.fillRect(pad, y, grandTableW, rowH);
        }
        ctx.strokeStyle = lineColor;
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(pad + grandTableW, y);
        ctx.stroke();
        ctx.fillStyle = theme.ink;
        ctx.font = `${bold ? "700 " : ""}13px Segoe UI, sans-serif`;
        cells.forEach((text, i) => ctx.fillText(fitCanvasText(ctx, text, grandWidths[i] - 12), xs[i] + 8, y + 22));
        y += rowH;
      };
      grand.rows.forEach((row, ri) =>
        drawRow(
          grandCols.map((c) => shareGrandCell(row, c.id)),
          false,
          ri % 2 ? theme.zebra : "",
          theme.line
        )
      );
      drawRow(
        grandCols.map((c) => shareGrandFootCell(grand.sum, c.id)),
        true,
        theme.footBg,
        theme.accent
      );
      y += 16;
    }
    if (!hideStamp) {
      ctx.fillStyle = theme.note;
      ctx.font = "11px Segoe UI, sans-serif";
      ctx.fillText(stamp, pad, height - 16);
    }
    return canvas;
  }

  function visLen(s) {
    return [...String(s ?? "")].length;
  }

  function padVis(s, n, align = "left") {
    const str = String(s ?? "");
    const extra = Math.max(0, n - visLen(str));
    return align === "right" ? `${" ".repeat(extra)}${str}` : `${str}${" ".repeat(extra)}`;
  }

  function shareToText() {
    const blocks = selectedShareBlocks();
    if (!blocks.length) throw new Error("Выберите заказы и строки для снимка");
    const fields = currentShareFields();
    const hideLabels = shareHideLabels();
    const hideStamp = shareHideStamp();
    const cols = SHARE_FIELDS.filter((f) => f.kind === "col" && fields.includes(f.id));
    const title = shareTitleText(blocks);
    const out = [title];
    const textRows = (lines) => {
      const foot = shareFooterCells(cols, lines);
      const rows = [cols.map((c) => c.label), ...lines.map((line) => cols.map((c) => String(shareLineValue(line, c.id) || "—")))];
      if (foot && foot.some(Boolean)) rows.push(foot.map((v) => v || ""));
      return rows;
    };
    const sharedTextWidths = cols.length
      ? cols.map((_, i) => Math.max(1, ...blocks.flatMap(({ lines }) => textRows(lines).map((row) => visLen(row[i])))))
      : [];

    blocks.forEach(({ order, lines }, bi) => {
      if (bi) out.push("");
      const meta = shareMetaItems(order, fields, hideLabels);
      if (meta.length) {
        out.push("");
        meta.forEach((line) => out.push(line));
      }

      if (cols.length) {
        const rows = textRows(lines);
        const widths = sharedTextWidths;
        out.push("");
        rows.forEach((row, ri) => {
          out.push(row.map((cell, i) => padVis(cell, widths[i])).join("  "));
          if (ri === 0) out.push(widths.map((w) => "─".repeat(w)).join("  "));
        });
      }

      const totalsText = shareTotalsText(fields, cols, lines);
      if (totalsText) {
        out.push("");
        out.push(totalsText);
      }
    });

    if (shareGrandOn(blocks)) {
      const grand = shareGrandData(blocks);
      const gcols = shareGrandCols(fields, grand);
      const rows = [
        gcols.map((c) => c.label),
        ...grand.rows.map((row) => gcols.map((c) => shareGrandCell(row, c.id))),
        gcols.map((c) => shareGrandFootCell(grand.sum, c.id)),
      ];
      const widths = gcols.map((_, i) => Math.max(1, ...rows.map((row) => visLen(row[i]))));
      out.push("", "━━━ Общий итог ━━━", "");
      rows.forEach((row, ri) => {
        if (ri === rows.length - 1) out.push(widths.map((w) => "─".repeat(w)).join("  "));
        out.push(row.map((cell, i) => padVis(cell, widths[i], gcols[i].money ? "right" : "left")).join("  "));
        if (ri === 0) out.push(widths.map((w) => "─".repeat(w)).join("  "));
      });
    }

    if (!hideStamp) {
      out.push("");
      out.push(`Сформировано ${new Date().toLocaleString("ru-RU")}`);
    }
    return `${out.join("\n").trim()}\n`;
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function copyShareText() {
    try {
      const text = shareToText();
      if (state.desktop) {
        await apiPost("/api/clipboard-text", { text });
        toast("Текст снимка скопирован — вставьте в чат (Ctrl+V)");
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        toast("Текст снимка скопирован в буфер обмена");
        return;
      }
      throw new Error("clipboard");
    } catch (err) {
      toast(`Не удалось скопировать текст: ${err.message || err}`);
    }
  }

  async function copySharePng() {
    try {
      const canvas = shareToCanvas();
      const blob = await canvasToPngBlob(canvas);
      if (!blob) throw new Error("Не удалось создать изображение");
      if (state.desktop) {
        await apiPost("/api/clipboard-png", { base64: await blobToBase64(blob) });
        toast("Снимок скопирован — вставьте в чат или документ (Ctrl+V)");
        return;
      }
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        toast("Снимок скопирован в буфер обмена");
        return;
      }
      throw new Error("clipboard");
    } catch (err) {
      toast(`Не удалось скопировать: ${err.message || err}`);
    }
  }

  async function canvasToPngBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
  }

  async function saveSharePng() {
    try {
      const canvas = await shareToCanvas();
      const blob = await canvasToPngBlob(canvas);
      const title = shareTitleText(selectedShareBlocks());
      const name = `${(title || "снимок").slice(0, 80)}.png`.replace(/[\\/:*?"<>|]+/g, "_");
      if (state.desktop) {
        const picked = await apiPost("/api/dialog/png", { suggested: name });
        if (picked.cancelled || !picked.path) return;
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = "";
        bytes.forEach((b) => {
          bin += String.fromCharCode(b);
        });
        await apiPost("/api/write-bytes", { path: picked.path, base64: btoa(bin) });
        toast("PNG сохранён");
        return;
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
      toast("PNG скачан");
    } catch (err) {
      toast(`Не удалось сохранить снимок: ${err.message || err}`);
    }
  }

