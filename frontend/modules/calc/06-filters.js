  function uniqueStrings(items) {
    const seen = new Set();
    const out = [];
    (items || []).forEach((item) => {
      const text = String(item || "").trim();
      if (!text || seen.has(text)) return;
      seen.add(text);
      out.push(text);
    });
    return out;
  }

  function filterList(node, key, legacyKey = "", { allowAll = false } = {}) {
    const raw = node?.[key];
    if (Array.isArray(raw)) {
      return uniqueStrings(raw)
        .filter((item) => allowAll || item !== "all")
        .slice(0, FILTER_MULTI_MAX);
    }
    const legacy = legacyKey ? node?.[legacyKey] : null;
    const text = String(legacy ?? "").trim();
    if (!text || (!allowAll && text === "all")) return [];
    return [text];
  }

  function normalizeFilterNode(node) {
    if (!node || (node.type !== "filter" && node.type !== "dashboard")) return node;
    node.customers = filterList(node, "customers", "customer");
    node.orderIds = filterList(node, "orderIds", "orderId");
    node.payFilters = filterList(node, "payFilters", "payFilter");
    node.orderTypes = filterList(node, "orderTypes", "orderType");
    node.products = filterList(node, "products", "product");
    node.statuses = filterList(node, "statuses", "status");
    node.customer = "";
    node.orderId = "";
    node.payFilter = "all";
    node.status = "";
    node.orderType = "";
    node.product = "";
    return node;
  }

  function emptyFilterOpts() {
    return {
      customers: [],
      orderIds: [],
      period: "all",
      payFilters: [],
      statuses: [],
      orderTypes: [],
      products: [],
      dateFrom: "",
      dateTo: "",
    };
  }

  function filterOpts(node) {
    try {
      normalizeFilterNode(node);
      return {
        customers: Array.isArray(node.customers) ? node.customers.slice() : [],
        orderIds: Array.isArray(node.orderIds) ? node.orderIds.slice() : [],
        period: node?.period || "all",
        payFilters: Array.isArray(node.payFilters) ? node.payFilters.slice() : [],
        statuses: Array.isArray(node.statuses) ? node.statuses.slice() : [],
        orderTypes: Array.isArray(node.orderTypes) ? node.orderTypes.slice() : [],
        products: Array.isArray(node.products) ? node.products.slice() : [],
        dateFrom: node?.dateFrom || "",
        dateTo: node?.dateTo || "",
      };
    } catch {
      return emptyFilterOpts();
    }
  }

  function dashStats(node) {
    try {
      return api?.calcStats?.(filterOpts(node)) || {};
    } catch (err) {
      console.warn("calc filter stats", err);
      return {};
    }
  }

  function loadFolds() {
    if (session.folds) return session.folds;
    const merged = {};
    const calc = ensureState();
    if (calc?.folds && typeof calc.folds === "object") {
      ["nodes", "schemes", "orders"].forEach((key) => {
        if (typeof calc.folds[key] === "boolean") merged[key] = calc.folds[key];
      });
    }
    try {
      const raw = JSON.parse(localStorage.getItem("finmaster.calc.folds") || "{}") || {};
      ["nodes", "schemes", "orders"].forEach((key) => {
        if (typeof raw[key] === "boolean") merged[key] = raw[key];
      });
    } catch {
      /* ignore */
    }
    session.folds = merged;
    return session.folds;
  }

  function foldOpen(key) {
    const folds = loadFolds();
    return folds[key] !== false;
  }

  function setFold(key, open) {
    if (!key) return;
    const folds = loadFolds();
    folds[key] = !!open;
    session.folds = folds;
    try {
      localStorage.setItem("finmaster.calc.folds", JSON.stringify(folds));
    } catch {
      /* ignore */
    }
    const calc = ensureState();
    if (calc) {
      calc.folds = {
        nodes: folds.nodes !== false,
        schemes: folds.schemes !== false,
        orders: folds.orders !== false,
      };
    }
  }

  function multiSummary(selected, emptyLabel = "Все") {
    if (!selected.length) return emptyLabel;
    if (selected.length === 1) return selected[0];
    return `${selected.length} выбр.`;
  }

  function multiPickHtml(nodeId, field, label, options, selected, opts = {}) {
    // Avoid destructuring `valueOf`/`toString` — they inherit from Object.prototype and break defaults.
    const getValue = typeof opts.getValue === "function" ? opts.getValue : (item) => item;
    const getLabel = typeof opts.getLabel === "function" ? opts.getLabel : (item) => item;
    const title = opts.title || "";
    const open = session.filterMultiOpen?.field === field && session.filterMultiOpen?.nodeId === nodeId;
    const list = Array.isArray(options) ? options : [];
    const picked = Array.isArray(selected) ? selected : [];
    const selectedSet = new Set(picked);
    const canClear = picked.length > 1;
    const summary = multiSummary(
      picked.map((id) => {
        const hit = list.find((item) => getValue(item) === id);
        return hit ? getLabel(hit) : id;
      })
    );
    return `<div class="calc-filter-row">
      <span>${esc(label)}</span>
      <div class="calc-multi-wrap${canClear ? " has-value" : ""}">
        <details class="calc-multi" data-filter-multi-field="${esc(field)}" ${open ? "open" : ""} title="${esc(title || label)}">
          <summary class="calc-multi-sum calc-filter-input">${esc(summary)}</summary>
          <div class="calc-multi-list">
            ${
              list.length
                ? list
                    .map((item) => {
                      const value = getValue(item);
                      const text = getLabel(item);
                      const on = selectedSet.has(value);
                      return `<label class="calc-multi-opt"><input type="checkbox" data-filter-multi="${esc(field)}" value="${esc(value)}" ${on ? "checked" : ""} /><span>${esc(text)}</span></label>`;
                    })
                    .join("")
                : `<div class="calc-multi-empty">Нет вариантов</div>`
            }
          </div>
        </details>
        ${
          canClear
            ? `<button type="button" class="search-clear" data-filter-multi-clear="${esc(field)}" title="Сбросить" aria-label="Сбросить выбор">×</button>`
            : ""
        }
      </div>
    </div>`;
  }

  function filterFieldsHtml(node) {
    try {
      normalizeFilterNode(node);
      const statuses = Array.isArray(api?.statuses?.()) ? api.statuses() : [];
      const types = Array.isArray(api?.orderTypes?.()) ? api.orderTypes() : [];
      const products = Array.isArray(api?.products?.()) ? api.products() : [];
      const customers = Array.isArray(api?.customers?.()) ? api.customers() : [];
      const selectedCustomers = Array.isArray(node.customers) ? node.customers : [];
      const customerKeys = new Set(selectedCustomers.map((name) => String(name || "").toLowerCase()));
      const orders = (api?.orders?.() || [])
        .map((order, index) => ({ order, index }))
        .filter(({ order }) => {
          if (!customerKeys.size) return true;
          return customerKeys.has(String(order.customer || "").toLowerCase());
        })
        .sort((a, b) => {
          const da = orderStamp(a.order);
          const db = orderStamp(b.order);
          if (db !== da) return db.localeCompare(da);
          return b.index - a.index;
        })
        .map((item) => item.order);
      const orderIds = (Array.isArray(node.orderIds) ? node.orderIds : []).filter((id) => orders.some((order) => order.id === id));
      if (orderIds.length !== (node.orderIds || []).length) node.orderIds = orderIds;
      const period = node.period || "all";
      const range = period === "range";
      const nid = node.id;
      return `<div class="calc-filter-fields">
      ${multiPickHtml(nid, "customers", "Заказчик", customers, selectedCustomers, { title: "Несколько заказчиков" })}
      ${multiPickHtml(nid, "orderIds", "Заказ", orders, orderIds, {
        getValue: (order) => order.id,
        getLabel: (order) => `${order.number || "—"} — ${order.name || order.customer || "Без названия"}`,
        title: "Несколько заказов",
      })}
      <label class="calc-filter-row">
        <span>Период</span>
        <select class="calc-filter-input" data-filter-field="period">
          ${DASH_PERIODS.map(([id, label]) => `<option value="${id}" ${period === id ? "selected" : ""}>${esc(label)}</option>`).join("")}
        </select>
      </label>
      <label class="calc-filter-row${range ? "" : " is-off"}">
        <span>С</span>
        <input class="calc-filter-input" type="date" data-filter-field="dateFrom" value="${esc(node.dateFrom || "")}" />
      </label>
      <label class="calc-filter-row${range ? "" : " is-off"}">
        <span>По</span>
        <input class="calc-filter-input" type="date" data-filter-field="dateTo" value="${esc(node.dateTo || "")}" />
      </label>
      ${multiPickHtml(
        nid,
        "payFilters",
        "Фильтр",
        DASH_PAY_MULTI.map(([id, label]) => ({ id, label })),
        Array.isArray(node.payFilters) ? node.payFilters : [],
        {
          getValue: (item) => item.id,
          getLabel: (item) => item.label,
          title: "Несколько фильтров оплаты",
        }
      )}
      ${multiPickHtml(nid, "orderTypes", "Тип", types, Array.isArray(node.orderTypes) ? node.orderTypes : [], { title: "Несколько типов" })}
      ${multiPickHtml(nid, "products", "Продукт", products, Array.isArray(node.products) ? node.products : [], { title: "Несколько продуктов" })}
      ${multiPickHtml(nid, "statuses", "Статус", statuses, Array.isArray(node.statuses) ? node.statuses : [], { title: "Несколько статусов" })}
    </div>`;
    } catch (err) {
      console.warn("calc filter fields", err);
      return `<div class="calc-filter-fields"><div class="calc-multi-empty">Не удалось показать фильтры</div></div>`;
    }
  }

  function statsPortsHtml(node, portIds, graph, tip) {
    const stats = dashStats(node);
    return portIds
      .map((id) => {
        const meta = dashPortMeta(id);
        const value = graph.values[`${node.id}:${id}`];
        const shown = value != null && Number.isFinite(value) ? value : stats[id];
        return `<div class="calc-row out">
          <span class="calc-row-name" title="${esc(tip || meta.name)}">${esc(meta.name)}</span>
          <b>${esc(fmtShort(shown))}</b>
          <i class="calc-port out" data-port="${esc(id)}" data-io="out" title="${esc(meta.name)}"></i>
        </div>`;
      })
      .join("");
  }

