/* bundle-seam */
(() => {
  /* Поиск по папке, копия дня и сводка заказчика. */

  let deskDailyOn = false;
  let deskFindTimer = 0;

  function deskSetDaily(on) {
    deskDailyOn = !!on;
    deskPaintDaily();
  }

  function deskPaintDaily() {
    const box = $("daily-backup");
    if (box) box.checked = deskDailyOn;
  }

  function deskCopyToday() {
    if (!deskDailyOn || !state.desktop || !state.path || state.preview || !state.doc) return;
    const path = state.path;
    const document = state.doc;
    apiPost("/api/desk/daily-backup", { path, document })
      .then((copy) => {
        if (copy?.created && state.path === path) toast("Копия дня записана");
      })
      .catch((err) => {
        if (state.path === path) toast(err.message || "Копию дня записать не удалось");
      });
  }

  function deskDayLabel(order) {
    const number = String(order.number || "").trim() || "без номера";
    const name = String(order.name || "").trim();
    return name ? `${number} · ${name}` : number;
  }

  function openDeskCustomer(id) {
    const customer = (state.doc?.customers || []).find((item) => item.id === id);
    const body = $("desk-customer-body");
    if (!customer || !body) return;
    const orders = (state.doc?.orders || []).filter((order) => String(order.customer || "") === String(customer.name || ""));
    let after = 0;
    let unpaid = 0;
    let delaySum = 0;
    let delayN = 0;
    orders.forEach((order) => {
      const tot = orderTotals(order);
      after += tot.after;
      unpaid += tot.unpaid;
      (order.lines || []).forEach((line) => {
        if (isFrozenLine(line) || isExpenseLine(line)) return;
        const lineTot = lineTotals(line, order);
        if (lineTot.paid <= 0.005) return;
        const from = parseDay(line.order_date);
        const paid = parseDay(line.payment_date);
        if (!from || !paid) return;
        delaySum += Math.max(0, dayDiff(from, paid));
        delayN += 1;
      });
    });
    const avg = delayN ? `${Math.round(delaySum / delayN)} ${daysWord(Math.round(delaySum / delayN))}` : "нет оплаченных дат";
    const contacts = [customer.phone, customer.email, customer.organization].map((item) => String(item || "").trim()).filter(Boolean);
    $("desk-customer-title").textContent = customer.name || "Заказчик";
    body.innerHTML = `<p class="desk-customer-meta">${esc(contacts.join(" · ") || "контактов нет")}</p>
      <p class="desk-customer-meta">${orders.length} ${ordWord(orders.length)} · к оплате ${esc(money(after))} · долг ${esc(money(unpaid))} · оплата в среднем ${esc(avg)}</p>
      ${orders.length ? `<div class="table-wrap"><table class="data desk-orders"><thead><tr><th>Заказ</th><th>К оплате</th><th>Долг</th></tr></thead><tbody>${orders
        .map((order) => {
          const tot = orderTotals(order);
          return `<tr><td><button type="button" data-desk-order="${esc(order.id)}">${esc(deskDayLabel(order))}</button></td><td class="num">${esc(money(tot.after))}</td><td class="num">${esc(money(tot.unpaid))}</td></tr>`;
        })
        .join("")}</tbody></table></div>` : `<div class="empty">Заказов с этим именем нет.</div>`}`;
    $("desk-customer-modal")?.classList.add("open");
  }

  async function deskRunFind(query) {
    const box = $("start-find-list");
    if (!box) return;
    const text = String(query || "").trim();
    if (text.length < 2 || !state.desktop) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    let hits = [];
    try {
      const res = await apiPost("/api/desk/search", { query: text });
      hits = res?.hits || [];
    } catch (err) {
      box.hidden = false;
      box.innerHTML = `<div class="empty">${esc(err.message || "Поиск не удался")}</div>`;
      return;
    }
    if (($("start-find")?.value || "").trim() !== text) return;
    if (!hits.length) {
      box.hidden = false;
      box.innerHTML = `<div class="empty">В папке FinMaster такого нет.</div>`;
      return;
    }
    box.hidden = false;
    box.innerHTML = hits
      .map((hit) => `<button type="button" data-desk-hit="${esc(hit.path)}" data-desk-order="${esc(hit.order_id)}"><b>${esc(hit.number || "без номера")}${hit.name ? ` · ${esc(hit.name)}` : ""}</b><small>${esc(hit.customer || "без заказчика")} · ${esc(hit.report || "")}</small></button>`)
      .join("");
  }

  function bindDesk() {
    $("desk-customer-body")?.addEventListener("click", (event) => {
      const id = event.target.closest("[data-desk-order]")?.dataset.deskOrder;
      if (!id) return;
      $("desk-customer-modal")?.classList.remove("open");
      gotoOrder(id);
    });
    $("desk-customer-close")?.addEventListener("click", () => $("desk-customer-modal")?.classList.remove("open"));
    $("desk-customer-modal")?.addEventListener("click", (event) => {
      if (event.target === $("desk-customer-modal")) $("desk-customer-modal").classList.remove("open");
    });
    $("start-find")?.addEventListener("input", (event) => {
      clearTimeout(deskFindTimer);
      const value = event.target.value;
      deskFindTimer = setTimeout(() => deskRunFind(value), 250);
    });
    $("start-find")?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        $("start-find-list").hidden = true;
      }
    });
    $("start-find-list")?.addEventListener("click", async (event) => {
      const hit = event.target.closest("[data-desk-hit]");
      if (!hit) return;
      const path = hit.dataset.deskHit;
      const orderId = hit.dataset.deskOrder;
      $("start-find-list").hidden = true;
      if (!samePath(path, state.path)) await openPath(path);
      if (orderId && samePath(path, state.path)) gotoOrder(orderId);
    });
    $("daily-backup")?.addEventListener("change", async (event) => {
      const want = !!event.target.checked;
      try {
        const res = await apiPost("/api/desk/daily-flag", { enabled: want });
        deskSetDaily(!!res.enabled);
        toast(res.enabled ? "Копия дня включена" : "Копия дня выключена");
      } catch (err) {
        event.target.checked = deskDailyOn;
        toast(err.message || "Не удалось запомнить галочку");
      }
    });
  }

  bindDesk();
})();
