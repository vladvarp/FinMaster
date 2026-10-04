  /* ================= карточка заказа ================= */

  function selectHtml(values, selected, attrs) {
    const opts = (values || [])
      .map((v) => `<option value="${esc(v)}" ${v === selected ? "selected" : ""}>${esc(v)}</option>`)
      .join("");
    const extra = selected && !(values || []).includes(selected) ? `<option value="${esc(selected)}" selected>${esc(selected)}</option>` : "";
    return `<select ${attrs}>${extra}${opts}</select>`;
  }

  function lineRowHtml(line, index) {
    const t = lineTotals(line);
    if (t.expense) return costRowHtml(line, index);
    const meta = statusMeta(line.status);
    const parts = [line.order_type, `${qtyText(line)} × ${money(t.price)}`];
    if (t.discount > 0) parts.push(`−${Math.round(t.discount)}%`);
    return `<article class="line-row${isFrozenLine(line) ? " is-frozen" : ""}" data-edit="${esc(line.id)}" style="--tint:${esc(meta.color)}">
      <button type="button" class="lr-drag" aria-label="Перетащить" title="Перетащить"><span></span></button>
      <span class="lr-index">${index + 1}</span>
      <div class="lr-main">
        <strong>${esc(line.product || "Без названия")}</strong>
        <small>${esc(parts.filter(Boolean).join(" · "))}</small>
        <span class="lr-status" style="background:${esc(meta.color)}">${esc(line.status || "—")}</span>
      </div>
      <div class="lr-right">
        <b>${esc(money(t.after))}</b>
        ${t.unpaid > 0.005 ? `<small class="debt">долг ${esc(money(t.unpaid))}</small>` : `<small class="paid">оплачено</small>`}
        <span class="lr-go">›</span>
      </div>
    </article>`;
  }

  function costRowHtml(line, index) {
    const t = lineTotals(line);
    const calc =
      t.mode === "amount"
        ? `${qtyText(line)} × ${money(t.price)}`
        : `${qtyFmt.format(t.percent)} % от ${money(t.base)}${t.mode === "net" ? " (без затрат)" : ""}`;
    return `<article class="line-row cost-row${isFrozenLine(line) ? " is-frozen" : ""}" data-edit="${esc(line.id)}">
      <button type="button" class="lr-drag" aria-label="Перетащить" title="Перетащить"><span></span></button>
      <span class="lr-index">${index + 1}</span>
      <div class="lr-main">
        <strong>${esc(line.product || line.order_type || "Расход")}</strong>
        <small>${esc([line.order_type, calc].filter(Boolean).join(" · "))}</small>
        <span class="lr-status cost-kind ${esc(t.kind)}">${esc(kindLabel(t.kind))}</span>
      </div>
      <div class="lr-right">
        <b class="cost">−${esc(money(t.cost))}</b>
        <span class="lr-go">›</span>
      </div>
    </article>`;
  }

  function renderOrder() {
    if (!requireDocument()) return;
    const order = currentOrder();
    if (!order) {
      setView("orders");
      return;
    }
    const t = orderTotals(order);
    const lines = order.lines || [];
    const { income, expense, frozen } = splitLines(lines);
    const a = (f) => `data-o="${esc(order.id)}" data-f="${f}"`;

    $("order-top").innerHTML = `
      <div class="ot-line">
        <span class="ot-num">${esc(order.number || "—")}</span>
        <span class="ot-name">${esc(order.name || "без названия")}</span>
      </div>
      <div class="ot-sums">
        <div class="ot-sum"><span>Итого</span><b>${esc(money(t.after))}</b></div>
        <div class="ot-sum ${t.unpaid > 0.005 ? "debt" : "paid"}"><span>${t.unpaid > 0.005 ? "Долг" : "Оплачено"}</span><b>${esc(
          money(t.unpaid > 0.005 ? t.unpaid : t.paid)
        )}</b></div>
        <div class="ot-sum"><span>Позиций</span><b>${income.length}</b></div>
        ${
          t.cost > 0.005
            ? `<div class="ot-sum cost"><span>Расход</span><b>−${esc(money(t.cost))}</b></div>
        <div class="ot-sum ${t.net >= 0 ? "paid" : "debt"}"><span>Чистыми</span><b>${esc(money(t.net))}</b></div>`
            : ""
        }
      </div>`;

    $("order-head").innerHTML = `<article class="card fold ${state.headOpen ? "" : "closed"}">
      <button type="button" class="fold-head" id="order-fold">
        <span>Данные заказа</span>
        <span class="fold-ico">▾</span>
      </button>
      <div class="fold-body">
        <div class="grid-2">
          <div class="field"><label>Номер</label><input type="text" inputmode="numeric" value="${esc(order.number || "")}" ${a("number")} /></div>
          <div class="field"><label>Создан</label><input type="date" value="${esc(dateValue(order.created_at))}" ${a("created_at")} /></div>
        </div>
        <div class="field"><label>Заказчик</label><input type="text" list="customers-list" value="${esc(order.customer || "")}" ${a("customer")} /></div>
        <div class="field"><label>Название</label><input type="text" value="${esc(order.name || "")}" ${a("name")} /></div>
        <div class="grid-2">
          <div class="field"><label>Начало работ</label><input type="date" value="${esc(dateValue(order.work_start))}" ${a("work_start")} /></div>
          <div class="field"><label>Конец работ</label><input type="date" value="${esc(dateValue(order.work_end))}" ${a("work_end")} /></div>
        </div>
        <div class="work-row">
          <span class="work-pill work-pill-${esc(workStatusMeta(order).id)}">${esc(workStatusMeta(order).label)}</span>
          ${workActButtons(order, false)}
        </div>
        <div class="field last"><label>Заметки</label><textarea rows="3" ${a("notes")}>${esc(order.notes || "")}</textarea></div>
      </div>
    </article>
    <datalist id="customers-list">${(state.doc.customers || []).map((c) => `<option value="${esc(c.name || "")}"></option>`).join("")}</datalist>`;

    $("lines-title").textContent = `Позиции · ${income.length}`;
    $("lines-list").innerHTML = income.length
      ? income.map((line, i) => lineRowHtml(line, i)).join("")
      : `<div class="empty">Позиций нет. Нажмите «+ Позиция».</div>`;

    const costsRow = $("costs-row");
    const costsList = $("costs-list");
    const addCost = $("btn-add-cost");
    if (costsRow && costsList) {
      costsRow.hidden = !expense.length;
      costsList.hidden = !expense.length;
      $("costs-title").textContent = `Расходы · ${expense.length}`;
      $("costs-sum").textContent = expense.length ? `−${money(t.cost)}` : "";
      costsList.innerHTML = expense.map((line, i) => costRowHtml(line, i)).join("");
    }
    if (addCost) addCost.hidden = !typeNames("expense").length;

    const frozenBlock = $("frozen-block");
    const frozenList = $("frozen-list");
    if (frozenBlock && frozenList) {
      const open = !!state.frozenOpen && frozen.length > 0;
      frozenBlock.hidden = !frozen.length;
      frozenBlock.classList.toggle("is-open", open);
      $("frozen-title").textContent = `Замороженные · ${frozen.length}`;
      $("frozen-toggle")?.setAttribute("aria-expanded", open ? "true" : "false");
      frozenList.innerHTML = frozen.map((line, i) => (isExpenseLine(line) ? costRowHtml(line, i) : lineRowHtml(line, i))).join("");
    }
  }

  function bindSortable(container, { handle, item, onCommit }) {
    if (!container || container.dataset.sortable === "1") return;
    container.dataset.sortable = "1";
    container.addEventListener(
      "pointerdown",
      (e) => {
      if (e.button !== 0) return;
      const grip = e.target.closest(handle);
      if (!grip || !container.contains(grip)) return;
      const row = grip.closest(item);
      if (!row) return;
      e.preventDefault();
      row.classList.add("is-dragging");
      const parent = row.parentNode;
      let moved = false;
      const move = (ev) => {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const over = el?.closest(item);
        if (!over || over === row || over.parentNode !== parent) return;
        const rect = over.getBoundingClientRect();
        parent.insertBefore(row, ev.clientY > rect.top + rect.height / 2 ? over.nextSibling : over);
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
    },
      { passive: false }
    );
  }

  function commitLineOrder(listEl, expense) {
    const order = currentOrder();
    if (!order || !listEl) return;
    const ids = [...listEl.querySelectorAll(".line-row[data-edit]")].map((el) => el.dataset.edit);
    const group = (order.lines || []).filter((line) => !isFrozenLine(line) && (expense ? isExpenseLine(line) : !isExpenseLine(line)));
    if (ids.length !== group.length) return;
    const byId = new Map(group.map((line) => [line.id, line]));
    const nextGroup = ids.map((id) => byId.get(id)).filter(Boolean);
    if (nextGroup.length !== group.length) return;
    let i = 0;
    order.lines = (order.lines || []).map((line) => {
      if (isFrozenLine(line) || isExpenseLine(line) !== expense) return line;
      return nextGroup[i++] || line;
    });
    touchDoc();
    pushSoon();
    renderOrder();
  }

  function refreshOrderRow(lineId) {
    const order = currentOrder();
    if (!order) return;
    const row = document.querySelector(`.line-row[data-edit="${CSS.escape(lineId)}"]`);
    const { income, expense, frozen } = splitLines(order.lines);
    const wasCost = !!row?.classList.contains("cost-row");
    const index = income.findIndex((l) => l.id === lineId);
    const costIndex = expense.findIndex((l) => l.id === lineId);
    const frozenIndex = frozen.findIndex((l) => l.id === lineId);
    const line = index >= 0 ? income[index] : costIndex >= 0 ? expense[costIndex] : frozen[frozenIndex];
    if (!line) return;
    if (frozenIndex >= 0) {
      renderOrder();
      return;
    }
    // Смена типа переносит строку между списками — проще перерисовать заказ целиком.
    // Налог в процентах зависит от других строк, поэтому его тоже проще пересобрать вместе с заказом.
    const hasPercentTax = expense.some((l) => taxMode(l) !== "amount" && typeKind(l.order_type) === "tax");
    if (!row || wasCost !== (costIndex >= 0) || (hasPercentTax && costIndex < 0)) {
      renderOrder();
      return;
    }
    row.outerHTML = costIndex >= 0 ? costRowHtml(line, costIndex) : lineRowHtml(line, index);
    const t = orderTotals(order);
    const sum = $("costs-sum");
    if (sum && expense.length) sum.textContent = `−${money(t.cost)}`;
    const top = $("order-top");
    if (!top) return;
    const cells = top.querySelectorAll(".ot-sum");
    const set = (cell, label, value, cls) => {
      if (!cell) return;
      cell.className = `ot-sum${cls ? ` ${cls}` : ""}`;
      cell.querySelector("span").textContent = label;
      cell.querySelector("b").textContent = value;
    };
    set(cells[0], "Итого", money(t.after));
    set(
      cells[1],
      t.unpaid > 0.005 ? "Долг" : "Оплачено",
      money(t.unpaid > 0.005 ? t.unpaid : t.paid),
      t.unpaid > 0.005 ? "debt" : "paid"
    );
    set(cells[2], "Позиций", String(income.length));
    if (cells.length >= 5) {
      set(cells[3], "Расход", `−${money(t.cost)}`, "cost");
      set(cells[4], "Чистыми", money(t.net), t.net >= 0 ? "paid" : "debt");
    }
  }

