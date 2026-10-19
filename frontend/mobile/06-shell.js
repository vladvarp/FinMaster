  /* ================= общая отрисовка ================= */

  function updateHead() {
    $("head-title").textContent = hasDocument() ? state.doc.title || "FinMaster" : "Недавние отчёты";
    const file = hasDocument()
      ? state.path
        ? state.path.split(/[\\/]/).pop()
        : "файл не сохранён"
      : "на компьютере ничего не открыто";
    const phones = state.clients.filter((c) => c.kind === "mobile").length;
    $("head-sub").textContent = `${state.dirty ? "• " : ""}${file}${phones > 1 ? ` · ${phones} телефона` : ""}`;
    $("btn-back").hidden = !(state.view === "order" || (state.view === "snapshot" && state.snapReturn));
    const undo = $("btn-undo");
    const redo = $("btn-redo");
    if (undo) undo.disabled = !state.history.undo;
    if (redo) redo.disabled = !state.history.redo;
  }

  const SCREENS = ["orders", "order", "stats", "snapshot", "files", "calendar"];

  function rememberSnapReturn() {
    if (state.view === "snapshot") return;
    state.snapReturn = { view: state.view, orderId: state.orderId };
  }

  function openSnapshot() {
    rememberSnapReturn();
    setView("snapshot");
  }

  function goBack() {
    if (state.view === "snapshot" && state.snapReturn) {
      const ret = state.snapReturn;
      state.snapReturn = null;
      setView(ret.view, ret.orderId);
      return;
    }
    setView("orders");
  }

  function pageScrollY() {
    return window.scrollY || document.documentElement.scrollTop || 0;
  }

  function savePageScroll() {
    const y = pageScrollY();
    if (state.view === "order") {
      if (state.orderId) state.scroll.order[state.orderId] = y;
      return;
    }
    if (state.view in state.scroll && state.view !== "order") state.scroll[state.view] = y;
  }

  function restorePageScroll() {
    const y =
      state.view === "order"
        ? state.scroll.order[state.orderId] || 0
        : Number(state.scroll[state.view]) || 0;
    const go = () => window.scrollTo(0, y);
    go();
    requestAnimationFrame(() => requestAnimationFrame(go));
  }

  function setView(view, orderId) {
    const enteringCalendar = view === "calendar" && state.view !== "calendar";
    if (enteringCalendar) {
      state.cal.mode = "classic";
      state.cal.revealPick = true;
      const picked = state.cal.pick ? parseDay(state.cal.pick) : null;
      if (picked) state.cal.anchor = dayStart(picked);
      state.scroll.calendar = 0;
    }
    const changed = view !== state.view || (orderId !== undefined && orderId !== state.orderId);
    if (orderId !== undefined && orderId !== state.orderId) state.frozenOpen = false;
    if (changed) savePageScroll();
    state.view = view;
    if (orderId !== undefined) state.orderId = orderId;
    if (view === "order") state.ordersResume = state.orderId || null;
    else if (view === "orders") state.ordersResume = null;
    SCREENS.forEach((v) => {
      $(`screen-${v}`).hidden = v !== view;
    });
    document.querySelectorAll("#tabbar button").forEach((b) => {
      const tab = b.dataset.tab;
      b.classList.toggle("active", tab === view || (view === "order" && tab === "orders"));
    });
    renderCurrent();
    restorePageScroll();
    if (changed) navReport();
  }

  function resumeOrdersTab() {
    const id = state.ordersResume;
    if (id && orders().some((o) => o.id === id)) {
      setView("order", id);
      return true;
    }
    setView("orders");
    return false;
  }

  function requireDocument() {
    if (hasDocument()) return true;
    state.waitingForDoc = true;
    if (state.view !== "files") setView("files");
    else renderFiles();
    return false;
  }

  function renderCurrent() {
    updateHead();
    if (state.view === "orders") renderOrders();
    else if (state.view === "order") renderOrder();
    else if (state.view === "stats") renderStats();
    else if (state.view === "calendar") renderCalendar();
    else if (state.view === "snapshot") renderSnapshot();
    else renderFiles();
    if (state.editLineId && !$("editor").hidden) renderEditor();
  }

