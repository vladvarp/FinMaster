  /* ================= список заказов ================= */

  const ORDER_FILTERS = [
    ["all", "Все"],
    ["debt", "С долгом"],
    ["paid", "Оплачены"],
    ["month", "Этот месяц"],
  ];

  function renderChips() {
    const btn = $("btn-m-order-filter");
    const menu = $("m-order-filter-menu");
    const label = $("m-order-filter-label");
    if (!btn || !menu) return;
    const list = orders();
    const meta = ORDER_FILTERS.find(([id]) => id === state.filter) || ORDER_FILTERS[0];
    const n = meta[0] === "all" ? list.length : list.filter((o) => matchesFilter(o, meta[0])).length;
    if (label) label.textContent = meta[1];
    btn.title = `Фильтр заказов: ${meta[1]} · ${n}`;
    btn.classList.toggle("active", state.filter !== "all");
    btn.setAttribute("aria-expanded", "false");
    menu.hidden = true;
    menu.innerHTML = ORDER_FILTERS.map(([id, name]) => {
      const count = id === "all" ? list.length : list.filter((o) => matchesFilter(o, id)).length;
      return `<button type="button" class="btn ${state.filter === id ? "active" : ""}" data-chip="${id}" role="menuitem">${esc(name)}<span>${count}</span></button>`;
    }).join("");
  }

  function statusDotsHtml(lines) {
    const items = (lines || []).map((l) => `<i class="dot" style="background:${esc(statusMeta(l.status).color)}"></i>`);
    if (!items.length) return "";
    const inner = items.join("");
    if (items.length <= 10) return `<span class="dots">${inner}</span>`;
    return `<span class="dots dots-marquee" style="--dot-n:${items.length}"><span class="dots-track">${inner}</span></span>`;
  }

  function tuneStatusDots() {
    document.querySelectorAll(".dots-marquee").forEach((box) => {
      const track = box.querySelector(".dots-track");
      if (!track) return;
      track.style.animation = "none";
      const shift = Math.max(0, Math.ceil(track.scrollWidth - box.clientWidth));
      box.style.setProperty("--dot-shift", `${shift}px`);
      box.style.setProperty("--dot-dur", `${Math.max(2.4, 1.4 + shift / 22)}s`);
      box.classList.toggle("is-moving", shift > 1);
      track.style.animation = "";
    });
  }

  function renderOrders() {
    if (!requireDocument()) return;
    renderChips();
    updateSortBtn();
    const list = visibleOrders();
    const box = $("orders-list");
    if (!list.length) {
      box.innerHTML = `<div class="empty">${
        orders().length ? "Ничего не найдено.<br>Измените поиск или фильтр." : "Заказов пока нет.<br>Нажмите «+», чтобы создать первый."
      }</div>`;
      return;
    }
    box.innerHTML = list
      .map((order) => {
        const t = orderTotals(order);
        const live = (order.lines || []).filter((line) => !isFrozenLine(line));
        const tint = statusMeta(live[0]?.status || order.lines?.[0]?.status).color;
        const debt = t.unpaid > 0.005;
        return `<article class="card order-item" data-open="${esc(order.id)}" style="--tint:${esc(tint)}">
          <div class="oi-top">
            <span class="oi-num">${esc(order.number || "—")}</span>
            <span class="oi-sep">—</span>
            <span class="oi-customer">${esc(order.name || "без названия")}</span>
          </div>
          <div class="oi-name">${esc(order.customer || "Без заказчика")} · ${live.length} поз.</div>
          <div class="oi-foot">
            <span class="sum">${esc(money(t.after))}</span>
            ${debt ? `<span class="sum debt">долг ${esc(money(t.unpaid))}</span>` : `<span class="sum paid">оплачено</span>`}
            ${statusDotsHtml(live)}
          </div>
        </article>`;
      })
      .join("");
    requestAnimationFrame(tuneStatusDots);
  }

