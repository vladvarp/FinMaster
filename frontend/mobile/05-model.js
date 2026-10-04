  /* ================= модель ================= */

  function orders() {
    return state.doc?.orders || [];
  }

  function currentOrder() {
    return orders().find((o) => o.id === state.orderId) || null;
  }

  function findLine(order, id) {
    return (order?.lines || []).find((l) => l.id === id) || null;
  }

  function emptyLine() {
    return {
      id: uid(),
      order_type: typeNames("income")[0] || typeNames()[0] || "",
      product: "",
      quantity: 1,
      qty_expr: "1",
      unit: state.doc.units?.[0] || "шт.",
      price: 0,
      price_expr: "0",
      discount: 0,
      discount_expr: "0",
      order_date: localStamp(new Date()),
      paid: 0,
      paid_expr: "0",
      payment_date: "",
      status: state.doc.statuses?.[0]?.name || "Новый заказ",
      tax_mode: "gross",
      tax_percent: 0,
      tax_percent_expr: "0",
      work_start: "",
      work_end: "",
      work_pauses: [],
      frozen: false,
    };
  }

  function nextOrderNumber() {
    const nums = orders()
      .map((o) => parseInt(String(o.number || "").replace(/\D/g, ""), 10))
      .filter((n) => Number.isFinite(n));
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return String(next).padStart(4, "0");
  }

  function emptyOrder() {
    return {
      id: uid(),
      number: nextOrderNumber(),
      customer: "",
      name: "",
      notes: "",
      created_at: localDateTimeStamp(new Date()),
      work_start: "",
      work_end: "",
      work_pauses: [],
      lines: [emptyLine()],
    };
  }

  function matchesQuery(order, q) {
    if (!q) return true;
    const hay = [order.number, order.customer, order.name, order.notes]
      .concat((order.lines || []).map((l) => `${l.product} ${l.status} ${l.order_type}`))
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  }

  function matchesFilter(order, filter) {
    const t = orderTotals(order);
    if (filter === "debt") return t.unpaid > 0.005;
    if (filter === "paid") return t.after > 0 && t.unpaid <= 0.005;
    if (filter === "month") {
      const now = new Date();
      const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      return (order.lines || []).some((l) => String(l.order_date || "").startsWith(key));
    }
    return true;
  }

  function orderNewestStamp(order) {
    let best = "";
    for (const line of order.lines || []) {
      const d = String(line.order_date || "").slice(0, 10);
      if (d.length >= 10 && d > best) best = d;
    }
    if (best) return best;
    return String(order.created_at || "").slice(0, 10);
  }

  const SORT_OPTIONS = [
    { value: "date-desc", label: "Сначала новые" },
    { value: "date-asc", label: "Сначала старые" },
    { value: "number", label: "По номеру" },
    { value: "customer", label: "По заказчику" },
    { value: "amount-desc", label: "По сумме" },
  ];

  function compareOrders(a, b, sort) {
    if (sort === "date-asc") return orderNewestStamp(a).localeCompare(orderNewestStamp(b));
    if (sort === "number") return String(a.number || "").localeCompare(String(b.number || ""), "ru", { numeric: true });
    if (sort === "customer") return String(a.customer || "").localeCompare(String(b.customer || ""), "ru");
    if (sort === "amount-desc") return orderTotals(b).after - orderTotals(a).after;
    return orderNewestStamp(b).localeCompare(orderNewestStamp(a));
  }

  function visibleOrders() {
    const q = state.query.trim().toLowerCase();
    return orders()
      .filter((o) => matchesQuery(o, q) && matchesFilter(o, state.filter))
      .sort((a, b) => compareOrders(a, b, state.sort));
  }

  function orderQueue(orderId = state.orderId) {
    const shown = visibleOrders();
    if (shown.some((o) => o.id === orderId)) return shown;
    return orders()
      .slice()
      .sort((a, b) => compareOrders(a, b, state.sort));
  }

  function neighborOrder(dir, orderId = state.orderId) {
    const list = orderQueue(orderId);
    const i = list.findIndex((o) => o.id === orderId);
    if (i < 0) return null;
    return list[i + dir] || null;
  }

  function flashSwipe(screen, dir) {
    if (!screen) return;
    screen.classList.remove("swipe-next", "swipe-prev");
    void screen.offsetWidth;
    screen.classList.add(dir > 0 ? "swipe-next" : "swipe-prev");
  }

  function showNeighborOrder(dir) {
    if (state.view !== "order") return false;
    if (!$("editor").hidden || !$("sheet").hidden) return false;
    const next = neighborOrder(dir);
    if (!next) return false;
    state.headOpen = false;
    setView("order", next.id);
    flashSwipe($("screen-order"), dir);
    try {
      navigator.vibrate?.(10);
    } catch (_) {}
    return true;
  }

  function showNeighborSnap(dir) {
    if (state.view !== "snapshot") return false;
    if (!$("sheet").hidden) return false;
    const current = snapOrder();
    if (!current) return false;
    const next = neighborOrder(dir, current.id);
    if (!next) return false;
    state.snap.orderId = next.id;
    state.snap.lines = null;
    state.snap.linesOpen = false;
    renderSnapshot();
    flashSwipe($("screen-snapshot"), dir);
    try {
      navigator.vibrate?.(10);
    } catch (_) {}
    return true;
  }

  function updateSortBtn() {
    const btn = $("btn-sort");
    if (!btn) return;
    const cur = SORT_OPTIONS.find((x) => x.value === state.sort) || SORT_OPTIONS[0];
    btn.textContent =
      state.sort === "date-asc"
        ? "↑ старые"
        : state.sort === "amount-desc"
          ? "Σ сумма"
          : state.sort === "number"
            ? "номер"
            : state.sort === "customer"
              ? "Ая клиент"
              : "↓ новые";
    btn.title = cur.label;
  }

  function touchDoc() {
    if (state.doc) state.doc.modified_at = new Date().toISOString();
  }

