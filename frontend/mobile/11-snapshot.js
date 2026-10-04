  /* ================= снимок для заказчика ================= */

  const SNAP_FIELDS = [
    { id: "number", label: "Номер", kind: "meta" },
    { id: "customer", label: "Заказчик", kind: "meta" },
    { id: "organization", label: "Организация", kind: "meta" },
    { id: "name", label: "Название", kind: "meta" },
    { id: "order_type", label: "Тип", kind: "col" },
    { id: "product", label: "Позиция", kind: "col" },
    { id: "quantity", label: "Кол-во", kind: "col" },
    { id: "order_date", label: "Дата заказа", kind: "col" },
    { id: "status", label: "Статус", kind: "col" },
    { id: "price", label: "Цена", kind: "col" },
    { id: "discount", label: "Скидка", kind: "col" },
    { id: "total", label: "Сумма", kind: "col" },
    { id: "paid", label: "Оплачено", kind: "col" },
    { id: "unpaid", label: "Долг", kind: "col" },
    { id: "payment_date", label: "Дата оплаты", kind: "col" },
    { id: "totals", label: "Итоги заказа", kind: "meta" },
    { id: "expenses", label: "Налоги и затраты", kind: "meta" },
  ];

  const SNAP_PRESETS = {
    work: ["number", "name", "order_type", "product", "quantity", "status", "order_date"],
    invoice: ["number", "customer", "organization", "name", "order_type", "product", "quantity", "price", "discount", "total", "paid", "unpaid", "totals"],
    short: ["number", "customer", "product", "quantity", "total", "totals"],
    full: SNAP_FIELDS.map((f) => f.id),
  };

  const SNAP_THEMES = {
    teal: {
      label: "Бирюза",
      head: ["#0f766e", "#115e59"],
      headInk: "#ffffff",
      accent: "#14b8a6",
      bg: "#ffffff",
      ink: "#0f172a",
      meta: "#475569",
      line: "#e2e8f0",
      thBg: "#f1f5f9",
      thInk: "#64748b",
      zebra: "#f8fafc",
      footBg: "#f1f5f9",
      note: "#94a3b8",
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

  const SNAP_MONEY_COLS = new Set(["price", "total", "paid", "unpaid"]);

  function loadSnapPrefs() {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_SNAP) || "null");
      if (saved && typeof saved === "object") {
        if (Array.isArray(saved.fields)) state.snap.fields = saved.fields;
        if (SNAP_THEMES[saved.theme]) state.snap.theme = saved.theme;
        state.snap.hideLabels = !!saved.hideLabels;
        state.snap.hideStamp = !!saved.hideStamp;
      }
    } catch {
      /* ignore */
    }
    if (!state.snap.fields) state.snap.fields = SNAP_PRESETS.invoice.slice();
  }

  function saveSnapPrefs() {
    try {
      localStorage.setItem(
        LS_SNAP,
        JSON.stringify({
          fields: state.snap.fields,
          theme: state.snap.theme,
          hideLabels: state.snap.hideLabels,
          hideStamp: state.snap.hideStamp,
        })
      );
    } catch {
      /* ignore */
    }
  }

  function snapOrder() {
    const list = orders();
    if (!list.length) return null;
    return list.find((o) => o.id === state.snap.orderId) || list.find((o) => o.id === state.orderId) || list[list.length - 1];
  }

  /** Снимок уходит заказчику — налоги и затраты в него не попадают. */
  /** Расходы попадают в снимок только при включённом поле «Налоги и затраты». */
  function snapShowsExpenses() {
    return state.snap.fields.includes("expenses");
  }

  function snapCandidates(order) {
    const withExpenses = snapShowsExpenses();
    return (order?.lines || []).filter((l) => !isFrozenLine(l) && (withExpenses || !isExpenseLine(l)));
  }

  function snapLines(order) {
    const all = snapCandidates(order);
    if (!state.snap.lines) return all;
    const picked = all.filter((l) => state.snap.lines.has(l.id));
    return picked.length ? picked : all;
  }

  function snapCols() {
    return SNAP_FIELDS.filter((f) => f.kind === "col" && state.snap.fields.includes(f.id));
  }

  function customerOrg(name) {
    return (state.doc?.customers || []).find((c) => c.name === name)?.organization || "";
  }

  function snapNumber(n) {
    const r = round2(n);
    if (Number.isInteger(r)) return String(r);
    return r.toFixed(2).replace(".", ",");
  }

  function snapValue(line, id) {
    const t = lineTotals(line);
    if (t.expense) {
      // Расход в снимке — название, объём и сумма с минусом; скидок и оплат у него нет.
      if (id === "order_type") return `${line.order_type || "—"} · ${kindLabel(t.kind)}`;
      if (id === "product") return line.product || "—";
      if (id === "quantity")
        return t.mode === "amount" ? `${snapNumber(t.qty)} ${line.unit || ""}`.trim() : `${snapNumber(t.percent)} %`;
      if (id === "price") return t.mode === "amount" ? money(t.price) : money(t.base);
      if (id === "total") return `−${money(t.cost)}`;
      if (id === "order_date") return fmtDate(line.order_date);
      return "—";
    }
    if (id === "order_type") return line.order_type || "—";
    if (id === "product") return line.product || "—";
    if (id === "quantity") return `${snapNumber(t.qty)} ${line.unit || ""}`.trim();
    if (id === "price") return money(t.price);
    if (id === "discount") return `${snapNumber(t.discount)} %`;
    if (id === "total") return money(t.after);
    if (id === "paid") return money(t.paid);
    if (id === "unpaid") return money(t.unpaid);
    if (id === "order_date") return fmtDate(line.order_date);
    if (id === "payment_date") return fmtDate(line.payment_date);
    if (id === "status") return line.status || "—";
    return "";
  }

  function orderNumberText(order) {
    return String(order?.number || "").replace(/^№\s*/, "").trim();
  }

  function snapMetaPairs(order) {
    const f = state.snap.fields;
    const items = [];
    if (f.includes("number")) items.push(["Номер", orderNumberText(order)]);
    if (f.includes("name")) items.push(["Заказ", order.name]);
    if (f.includes("customer")) items.push(["Заказчик", order.customer]);
    if (f.includes("organization")) items.push(["Организация", customerOrg(order.customer)]);
    return items;
  }

  function snapMetaItems(order) {
    return snapMetaPairs(order).map(([label, value]) => {
      const v = value || "—";
      if (state.snap.hideLabels) return v;
      return `${label}: ${v}`;
    });
  }

  function snapTitle(order) {
    const typed = String(state.snap.title || "").trim();
    if (typed) return typed;
    return [orderNumberText(order), order?.name].filter(Boolean).join(" · ") || "Снимок заказа";
  }

  function snapNeedsFooter(cols) {
    return (cols || []).some((c) => SNAP_MONEY_COLS.has(c.id));
  }

  function snapFooterValue(colId, lines) {
    const tot = sumLines(lines);
    if (colId === "total") return money(tot.cost > 0.005 ? tot.net : tot.after);
    if (colId === "paid") return money(tot.paid);
    if (colId === "unpaid") return money(tot.unpaid);
    if (colId === "price") return "Итого";
    return "";
  }

  function snapFooterCells(cols, lines) {
    if (!snapNeedsFooter(cols)) return null;
    return cols.map((c) => (SNAP_MONEY_COLS.has(c.id) ? snapFooterValue(c.id, lines) : ""));
  }

  function snapTotalsText(cols, lines) {
    if (!state.snap.fields.includes("totals") || snapNeedsFooter(cols)) return "";
    const tot = sumLines(lines);
    const bits = [`Итого ${money(tot.after)}`];
    if (tot.cost > 0.005) {
      bits.push(`расходы −${money(tot.cost)}`);
      bits.push(`к оплате ${money(tot.net)}`);
    }
    if (state.snap.fields.includes("paid")) bits.push(`оплачено ${money(tot.paid)}`);
    if (state.snap.fields.includes("unpaid")) bits.push(`остаток ${money(tot.unpaid)}`);
    return bits.join(" · ");
  }

  function renderSnapshot() {
    if (!requireDocument()) return;
    const box = $("snapshot-body");
    const list = orders();
    if (!list.length) {
      box.innerHTML = `<div class="empty">Сначала создайте заказ — потом можно отправить снимок заказчику.</div>`;
      return;
    }
    const order = snapOrder();
    const lines = snapCandidates(order);
    const picked = snapLines(order);
    const theme = SNAP_THEMES[state.snap.theme] || SNAP_THEMES.teal;

    box.innerHTML = `
      <article class="card">
        <div class="field last">
          <label>Заказ</label>
          <button type="button" class="picker" id="snap-order">
            <span>${esc(order.number || "—")} · ${esc(order.name || "без названия")}</span><span class="picker-ico">▾</span>
          </button>
        </div>
      </article>

      <article class="card fold ${state.snap.linesOpen ? "" : "closed"}">
        <button type="button" class="fold-head" id="snap-lines-fold">
          <span>Позиции в снимке</span>
          <span class="fold-side"><small id="snap-lines-meta">${picked.length} из ${lines.length}</small><span class="fold-ico">▾</span></span>
        </button>
        <div class="fold-body">
          <div class="chips inline" style="margin-bottom:8px">
            <button type="button" class="chip" data-snap-pay="all">Все</button>
            <button type="button" class="chip" data-snap-pay="debt">Долг</button>
            <button type="button" class="chip" data-snap-pay="paid">Оплата</button>
          </div>
          <div class="list tight">${lines
            .map((line, i) => {
              const on = picked.includes(line);
              const t = lineTotals(line);
              return `<label class="pick-row ${on ? "on" : ""} ${t.expense ? "cost" : ""}">
            <input type="checkbox" data-snap-line="${esc(line.id)}" ${on ? "checked" : ""} />
            <span class="pr-main"><strong>${i + 1}. ${esc(line.product || line.order_type || "Без названия")}</strong>
            <small>${esc(
              [line.order_type, t.expense ? kindLabel(t.kind) : "", t.mode === "amount" ? qtyText(line) : `${t.percent} %`]
                .filter(Boolean)
                .join(" · ")
            )}</small></span>
            <b>${t.expense ? `−${esc(money(t.cost))}` : esc(money(t.after))}</b>
          </label>`;
            })
            .join("")}</div>
        </div>
      </article>

      <article class="card fold ${state.snap.fieldsOpen ? "" : "closed"}">
        <button type="button" class="fold-head" id="snap-fields-fold">
          <span>Что показать заказчику</span>
          <span class="fold-ico">▾</span>
        </button>
        <div class="fold-body">
          <div class="chips inline">
            <button type="button" class="chip" data-preset="short">Коротко</button>
            <button type="button" class="chip" data-preset="work">Для работы</button>
            <button type="button" class="chip" data-preset="invoice">Как счёт</button>
            <button type="button" class="chip" data-preset="full">Всё</button>
          </div>
          ${
            state.shareProfiles.length
              ? `<div class="snap-prof-label">Профили</div>
          <div class="chips wrap">${state.shareProfiles
            .map(
              (profile, i) =>
                `<button type="button" class="chip ${snapProfileOn(profile) ? "active" : ""}" data-snap-profile="${i}">${esc(profile.name)}</button>`
            )
            .join("")}</div>`
              : ""
          }
          <div class="chips wrap">${SNAP_FIELDS.map(
            (f) =>
              `<button type="button" class="chip ${state.snap.fields.includes(f.id) ? "active" : ""}" data-field="${f.id}">${esc(f.label)}</button>`
          ).join("")}</div>
          <div class="field" style="margin-top:12px">
            <label>Заголовок</label>
            <input type="text" id="snap-title" placeholder="${esc(snapTitle(order))}" value="${esc(state.snap.title || "")}" />
          </div>
          <label class="check"><input type="checkbox" id="snap-hide-labels" ${state.snap.hideLabels ? "checked" : ""} /> Без подписей полей</label>
          <label class="check"><input type="checkbox" id="snap-hide-stamp" ${state.snap.hideStamp ? "checked" : ""} /> Без даты формирования</label>
        </div>
      </article>

      <h3 class="section">Оформление</h3>
      <div class="chips inline">${Object.entries(SNAP_THEMES)
        .map(
          ([key, t]) =>
            `<button type="button" class="chip theme-chip ${key === state.snap.theme ? "active" : ""}" data-snap-theme="${key}">
              <i class="sw" style="background:linear-gradient(135deg,${t.head[0]},${t.head[1]})"></i>${esc(t.label)}
            </button>`
        )
        .join("")}</div>

      <h3 class="section">Предпросмотр</h3>
      <div class="preview-wrap"><div class="preview" id="snap-preview" style="background:${theme.bg};color:${theme.ink}"></div></div>

      <div class="stack">
        <button type="button" class="btn primary wide" id="snap-share">${telegramApp ? "Поделиться в Telegram" : "Поделиться картинкой"}</button>
        <button type="button" class="btn wide" id="snap-download">${telegramApp ? "Прислать PNG в чат" : "Сохранить PNG в телефон"}</button>
        <button type="button" class="btn wide" id="snap-text">Скопировать текстом</button>
      </div>`;

    renderSnapPreview();
  }

  function renderSnapPreview() {
    const box = $("snap-preview");
    if (!box) return;
    const order = snapOrder();
    if (!order) return;
    const lines = snapLines(order);
    const cols = snapCols();
    const t = SNAP_THEMES[state.snap.theme] || SNAP_THEMES.teal;
    const meta = snapMetaItems(order);
    const foot = snapFooterCells(cols, lines);
    const totals = snapTotalsText(cols, lines);
    box.style.background = t.bg;
    box.style.color = t.ink;
    box.innerHTML = `
      <div style="background:linear-gradient(90deg,${t.head[0]},${t.head[1]});color:${t.headInk};padding:14px 16px;${
        t.headLine ? `border-bottom:2px solid ${t.accent};` : ""
      }"><b style="font-size:16px">${esc(snapTitle(order))}</b></div>
      <div style="padding:12px 16px 16px">
        ${meta.length ? `<div style="display:grid;gap:3px;font-size:12px;color:${t.meta};margin-bottom:10px">${meta.map((m) => `<div>${esc(m)}</div>`).join("")}</div>` : ""}
        ${
          cols.length
            ? `<table style="border-collapse:collapse;font-size:12px;width:max-content;min-width:100%">
                <thead><tr>${cols
                  .map(
                    (c) =>
                      `<th style="text-align:left;padding:7px 9px;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:${t.thInk};background:${t.thBg};white-space:nowrap">${esc(
                        c.label
                      )}</th>`
                  )
                  .join("")}</tr></thead>
                <tbody>${lines
                  .map(
                    (line, ri) =>
                      `<tr style="background:${ri % 2 ? t.zebra : "transparent"}">${cols
                        .map(
                          (c) =>
                            `<td style="padding:7px 9px;border-top:1px solid ${t.line};color:${t.ink};white-space:nowrap">${esc(
                              snapValue(line, c.id)
                            )}</td>`
                        )
                        .join("")}</tr>`
                  )
                  .join("")}</tbody>
                ${
                  foot
                    ? `<tfoot><tr>${foot
                        .map(
                          (v) =>
                            `<td style="padding:8px 9px;border-top:2px solid ${t.accent};background:${t.footBg};font-weight:700;color:${t.ink};white-space:nowrap">${esc(
                              v
                            )}</td>`
                        )
                        .join("")}</tr></tfoot>`
                    : ""
                }
              </table>`
            : `<div style="font-size:12px;color:${t.note}">Включите колонки — появится таблица работ.</div>`
        }
        ${totals ? `<div style="margin-top:10px;font-size:13px;font-weight:700">${esc(totals)}</div>` : ""}
        ${
          state.snap.hideStamp
            ? ""
            : `<div style="margin-top:10px;font-size:10px;color:${t.note}">Сформировано ${esc(new Date().toLocaleString("ru-RU"))}</div>`
        }
      </div>`;
  }

  function fitText(ctx, text, maxW) {
    const s = String(text ?? "");
    if (ctx.measureText(s).width <= maxW) return s;
    let t = s;
    while (t.length && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
    return `${t}…`;
  }

  function snapColWidths(cols, lines) {
    const ctx = document.createElement("canvas").getContext("2d");
    const foot = snapFooterCells(cols, lines);
    return cols.map((col, i) => {
      ctx.font = "600 11px Segoe UI, sans-serif";
      let w = ctx.measureText(col.label.toUpperCase()).width;
      ctx.font = "13px Segoe UI, sans-serif";
      lines.forEach((line) => {
        w = Math.max(w, ctx.measureText(String(snapValue(line, col.id) || "—")).width);
      });
      if (foot && foot[i]) {
        ctx.font = "700 13px Segoe UI, sans-serif";
        w = Math.max(w, ctx.measureText(foot[i]).width);
      }
      return Math.min(280, Math.ceil(w) + 22);
    });
  }

  function snapToCanvas() {
    const order = snapOrder();
    if (!order) throw new Error("Нет заказа для снимка");
    const lines = snapLines(order);
    if (!lines.length) throw new Error("Выберите хотя бы одну позицию");
    const cols = snapCols();
    const theme = SNAP_THEMES[state.snap.theme] || SNAP_THEMES.teal;
    const title = snapTitle(order);
    const meta = snapMetaItems(order);
    const foot = snapFooterCells(cols, lines);
    const totals = snapTotalsText(cols, lines);
    const stamp = `Сформировано ${new Date().toLocaleString("ru-RU")}`;
    const widths = cols.length ? snapColWidths(cols, lines) : [];
    const tableW = widths.reduce((s, w) => s + w, 0);
    const pad = 20;
    const rowH = 34;

    const measure = document.createElement("canvas").getContext("2d");
    let inner = tableW;
    measure.font = "700 20px Segoe UI, sans-serif";
    inner = Math.max(inner, measure.measureText(title).width);
    measure.font = "13px Segoe UI, sans-serif";
    meta.forEach((m) => {
      inner = Math.max(inner, measure.measureText(m).width);
    });
    if (totals) {
      measure.font = "700 14px Segoe UI, sans-serif";
      inner = Math.max(inner, measure.measureText(totals).width);
    }
    if (!state.snap.hideStamp) {
      measure.font = "11px Segoe UI, sans-serif";
      inner = Math.max(inner, measure.measureText(stamp).width);
    }

    const width = Math.ceil(pad * 2 + Math.max(inner, 120));
    const headerH = 64;
    const bodyH =
      16 +
      (meta.length ? meta.length * 22 + 10 : 0) +
      (cols.length ? 32 + lines.length * rowH + (foot ? rowH : 0) : 28) +
      (totals ? 36 : 0) +
      16;
    const height = headerH + bodyH + (state.snap.hideStamp ? 12 : 34);

    const scale = Math.min(3, Math.max(2, Math.round(window.devicePixelRatio || 2)));
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, width, height);

    const grad = ctx.createLinearGradient(0, 0, width, 0);
    grad.addColorStop(0, theme.head[0]);
    grad.addColorStop(1, theme.head[1]);
    ctx.fillStyle = grad;
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
    ctx.fillText(fitText(ctx, title, width - pad * 2), pad, 40);

    let y = headerH + 16;
    ctx.fillStyle = theme.meta;
    ctx.font = "13px Segoe UI, sans-serif";
    meta.forEach((m) => {
      ctx.fillText(m, pad, y + 14);
      y += 22;
    });
    if (meta.length) y += 10;

    if (cols.length) {
      const xs = [];
      let acc = pad;
      widths.forEach((w) => {
        xs.push(acc);
        acc += w;
      });
      ctx.fillStyle = theme.thBg;
      ctx.fillRect(pad, y, tableW, 32);
      ctx.fillStyle = theme.thInk;
      ctx.font = "600 11px Segoe UI, sans-serif";
      cols.forEach((col, i) => {
        ctx.fillText(fitText(ctx, col.label.toUpperCase(), widths[i] - 14), xs[i] + 8, y + 21);
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
          ctx.fillText(fitText(ctx, String(snapValue(line, col.id) || "—"), widths[i] - 14), xs[i] + 8, y + 22);
        });
        y += rowH;
      });
      if (foot) {
        ctx.fillStyle = theme.footBg;
        ctx.fillRect(pad, y, tableW, rowH);
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(pad + tableW, y);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = theme.ink;
        ctx.font = "700 13px Segoe UI, sans-serif";
        foot.forEach((v, i) => {
          if (!v) return;
          ctx.fillText(fitText(ctx, v, widths[i] - 14), xs[i] + 8, y + 22);
        });
        y += rowH;
      }
    }

    if (totals) {
      y += 14;
      ctx.fillStyle = theme.ink;
      ctx.font = "700 14px Segoe UI, sans-serif";
      ctx.fillText(totals, pad, y + 14);
      y += 22;
    }
    if (!state.snap.hideStamp) {
      ctx.fillStyle = theme.note;
      ctx.font = "11px Segoe UI, sans-serif";
      ctx.fillText(stamp, pad, height - 14);
    }
    return canvas;
  }

  function visLen(s) {
    return [...String(s ?? "")].length;
  }

  function padVis(s, n) {
    const str = String(s ?? "");
    return `${str}${" ".repeat(Math.max(0, n - visLen(str)))}`;
  }

  function snapToText() {
    const order = snapOrder();
    if (!order) throw new Error("Нет заказа для снимка");
    const lines = snapLines(order);
    if (!lines.length) throw new Error("Выберите хотя бы одну позицию");
    const cols = snapCols();
    const out = [snapTitle(order)];
    const meta = snapMetaItems(order);
    if (meta.length) {
      out.push("");
      meta.forEach((m) => out.push(m));
    }
    if (cols.length) {
      const foot = snapFooterCells(cols, lines);
      const rows = [
        cols.map((c) => c.label),
        ...lines.map((line) => cols.map((c) => String(snapValue(line, c.id) || "—"))),
      ];
      if (foot && foot.some(Boolean)) rows.push(foot.map((v) => v || ""));
      const widths = cols.map((_, i) => Math.max(1, ...rows.map((row) => visLen(row[i]))));
      out.push("");
      rows.forEach((row, ri) => {
        out.push(row.map((cell, i) => padVis(cell, widths[i])).join("  "));
        if (ri === 0) out.push(widths.map((w) => "─".repeat(w)).join("  "));
      });
    }
    const totals = snapTotalsText(cols, lines);
    if (totals) {
      out.push("");
      out.push(totals);
    }
    if (!state.snap.hideStamp) {
      out.push("");
      out.push(`Сформировано ${new Date().toLocaleString("ru-RU")}`);
    }
    return `${out.join("\n").trim()}\n`;
  }

  function snapFileName() {
    const order = snapOrder();
    const base = [order?.number ? `zakaz-${order.number}` : "snimok", order?.name]
      .filter(Boolean)
      .join("-")
      .replace(/[^\wа-яё\-]+/gi, "-")
      .slice(0, 60);
    return `${base || "snimok"}.png`;
  }

  function canvasBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const s = String(reader.result || "");
        const i = s.indexOf(",");
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      reader.onerror = () => reject(new Error("Не удалось прочитать картинку"));
      reader.readAsDataURL(blob);
    });
  }

  function telegramUserId() {
    const user = telegramApp && telegramApp.initDataUnsafe && telegramApp.initDataUnsafe.user;
    const id = user && user.id;
    return Number(id) || 0;
  }

  async function sendSnapshotToTelegram(mode) {
    const canvas = snapToCanvas();
    const blob = await canvasBlob(canvas);
    if (!blob) throw new Error("Не удалось создать картинку");
    return api("/api/remote/snapshot-png", {
      method: "POST",
      body: JSON.stringify({
        png: await blobToBase64(blob),
        filename: snapFileName(),
        caption: snapTitle(snapOrder()),
        mode,
        user_id: telegramUserId(),
      }),
    });
  }

  async function snapShare() {
    try {
      if (telegramApp) {
        const res = await sendSnapshotToTelegram("share");
        if (res.share_id && typeof telegramApp.shareMessage === "function") {
          telegramApp.shareMessage(res.share_id, (ok) => {
            if (ok) toast("Снимок отправлен");
          });
          toast("Выберите чат — если окно не открылось, снимок уже у бота");
          return;
        }
        toast("Снимок в чате с ботом — перешлите заказчику");
        return;
      }
      const canvas = snapToCanvas();
      const blob = await canvasBlob(canvas);
      if (!blob) throw new Error("Не удалось создать картинку");
      const file = new File([blob], snapFileName(), { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: snapTitle(snapOrder()) });
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: snapTitle(snapOrder()), text: snapToText() });
        toast("Картинку телефон не отдаёт — отправлен текст");
        return;
      }
      snapDownload();
    } catch (err) {
      if (String(err?.name) === "AbortError") return;
      toast(`Не получилось: ${err.message || err}`);
    }
  }

  async function snapDownload() {
    try {
      if (telegramApp) {
        await sendSnapshotToTelegram("save");
        toast("PNG в чате с ботом — откройте файл и сохраните");
        return;
      }
      const canvas = snapToCanvas();
      const blob = await canvasBlob(canvas);
      if (!blob) throw new Error("Не удалось создать картинку");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = snapFileName();
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast("Снимок сохранён в загрузки");
    } catch (err) {
      toast(`Не получилось: ${err.message || err}`);
    }
  }

  async function snapCopyText() {
    try {
      const text = snapToText();
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        toast("Текст скопирован — вставьте в чат");
        return;
      }
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
      throw new Error("буфер обмена недоступен");
    } catch (err) {
      if (String(err?.name) === "AbortError") return;
      toast(`Не получилось: ${err.message || err}`);
    }
  }

