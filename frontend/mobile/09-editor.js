  /* ================= редактор позиции ================= */

  const DISCOUNTS = [0, 5, 10, 15, 20, 25, 50];

  function openEditor(lineId) {
    const order = currentOrder();
    if (!findLine(order, lineId)) return;
    state.editLineId = lineId;
    $("editor").hidden = false;
    $("editor").classList.add("is-on");
    document.body.classList.add("locked");
    renderEditor();
    $("editor-body").scrollTop = 0;
    navReport();
  }

  function closeEditor() {
    state.editLineId = null;
    hideExprPad();
    state.exprField = "";
    state.exprInput = null;
    state.exprSystemKb = false;
    $("editor").hidden = true;
    $("editor").classList.remove("is-on");
    const card = $("editor").querySelector(".sheet-card");
    if (card) card.style.bottom = "";
    document.body.classList.remove("locked");
    if (state.view === "order") renderOrder();
    flushPending();
    navReport();
  }

  function productKind(item) {
    const k = String(item?.kind || "order").toLowerCase();
    return k === "cost" || k === "tax" ? k : "order";
  }

  function productKindOfLine(line) {
    const k = typeKind(line?.order_type);
    if (k === "tax") return "tax";
    if (k === "cost") return "cost";
    return "order";
  }

  function catalogNameKey(name) {
    return String(name || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
  }

  function catalogProductNames(kind = "all") {
    const list = state.doc?.products || [];
    return list
      .filter((p) => kind === "all" || productKind(p) === kind)
      .map((p) => String(p.name || p || "").trim())
      .filter(Boolean);
  }

  function closeEdProductSuggest() {
    const box = $("ed-product-suggest");
    if (box) box.innerHTML = "";
  }

  function edProductSuggestHtml(query, line) {
    const q = String(query || "").trim().toLocaleLowerCase("ru");
    const scope = productKindOfLine(line);
    const items = catalogProductNames(scope).filter((name) => !q || name.toLocaleLowerCase("ru").includes(q));
    if (!items.length) return "";
    return items
      .map((name) => {
        const current = q && name.toLocaleLowerCase("ru") === q;
        return `<button type="button" class="suggest-item${current ? " current" : ""}" data-pick-product>${esc(name)}</button>`;
      })
      .join("");
  }

  function fillEdProductSuggest(query) {
    const box = $("ed-product-suggest");
    if (!box) return;
    const field = document.querySelector('#editor-body [data-f="product"]');
    if (document.activeElement !== field) {
      box.innerHTML = "";
      return;
    }
    const order = currentOrder();
    const line = findLine(order, state.editLineId);
    box.innerHTML = edProductSuggestHtml(query, line);
  }

  function renderEditor() {
    const order = currentOrder();
    const line = findLine(order, state.editLineId);
    if (!line) {
      closeEditor();
      return;
    }
    const lines = order.lines || [];
    const index = lines.findIndex((l) => l.id === line.id);
    const t = lineTotals(line);
    const a = (f) => `data-l="${esc(line.id)}" data-f="${f}"`;
    const { income } = splitLines(lines);
    $("ed-title").textContent = line.frozen
      ? `Заморожена${t.expense ? ` · ${kindLabel(t.kind)}` : ""}`
      : t.expense
      ? `Расход · ${kindLabel(t.kind)}`
      : `Позиция ${income.findIndex((l) => l.id === line.id) + 1} из ${income.length}`;
    $("ed-prev").disabled = index <= 0;
    $("ed-next").disabled = index >= lines.length - 1;

    const head = `
      <div class="field">
        <label>${t.expense ? "За что" : "Позиция"}</label>
        <input type="text" autocomplete="off" spellcheck="false" placeholder="${
          t.expense ? "Налог, аренда, материалы…" : "Название работы или товара"
        }" value="${esc(line.product || "")}" ${a("product")} />
        <div class="suggest-inline" id="ed-product-suggest"></div>
      </div>
      <div class="field">
        <label>Тип заказа</label>
        ${selectHtml(typeNames(), line.order_type, a("order_type"))}
      </div>
      ${
        t.kind === "tax"
          ? `<label class="big-label">Как считать</label>
      <div class="chips inline">${TAX_MODES.map(
        ([id, label]) =>
          `<button type="button" class="chip ${t.mode === id ? "active" : ""}" data-tax-mode="${id}">${esc(label)}</button>`
      ).join("")}</div>`
          : ""
      }
      ${
        t.mode === "amount"
          ? `<label class="big-label">Количество</label>
      <div class="qty-row">
        ${exprFieldHtml(line, "qty_expr", a("qty_expr"), "1+2×6")}
        ${selectHtml(state.doc.units, line.unit, `${a("unit")} class="unit-select"`)}
      </div>
      <div class="hint">Можно 2×6+1 — цифры и знаки на панели внизу</div>

      <label class="big-label">${t.expense ? "Сумма за единицу" : "Цена за единицу"}</label>
      ${exprFieldHtml(line, "price_expr", a("price_expr"), "2×350")}
      <div class="hint">После ввода видно сумму, при нажатии снова — выражение</div>`
          : `<label class="big-label">Процент, %</label>
      ${exprFieldHtml(line, "tax_percent_expr", a("tax_percent_expr"), "20")}
      <div class="hint">${
        t.mode === "net" ? "Считается от выручки заказа за вычетом затрат" : "Считается от всей выручки заказа"
      } — сейчас это ${esc(money(t.base))}</div>`
      }`;

    const money_ = `
      <label class="big-label">Скидка, %</label>
      ${exprFieldHtml(line, "discount_expr", a("discount_expr"), "0")}
      <div class="chips inline">${DISCOUNTS.map(
        (d) => `<button type="button" class="chip ${Math.round(t.discount) === d ? "active" : ""}" data-discount="${d}">${d}%</button>`
      ).join("")}</div>

      <label class="big-label">Оплачено</label>
      ${exprFieldHtml(line, "paid_expr", a("paid_expr"), "0")}
      <div class="chips inline">
        <button type="button" class="chip" data-paid="full">Оплачено полностью</button>
        <button type="button" class="chip" data-paid="half">Половина</button>
        <button type="button" class="chip" data-paid="none">Сбросить</button>
      </div>

      <label class="big-label">Статус</label>
      <div class="status-grid">${(state.doc.statuses || [])
        .map(
          (s) =>
            `<button type="button" class="status-pick ${s.name === line.status ? "active" : ""}" data-pick-status="${esc(s.name)}">
              <i class="dot" style="background:${esc(s.color)}"></i><span>${esc(s.name)}</span>
            </button>`
        )
        .join("")}</div>

      <div class="grid-2 dates">
        <div class="field"><label>Дата заказа</label><input type="date" value="${esc(dateValue(line.order_date))}" ${a("order_date")} /></div>
        <div class="field"><label>Дата оплаты</label><input type="date" value="${esc(dateValue(line.payment_date))}" ${a("payment_date")} /></div>
      </div>
      <div class="chips inline">
        <button type="button" class="chip" data-now="order_date">Заказ — сегодня</button>
        <button type="button" class="chip" data-now="payment_date">Оплата — сегодня</button>
      </div>`;

    const costOnly = `
      <div class="field"><label>Дата</label><input type="date" value="${esc(dateValue(line.order_date))}" ${a("order_date")} /></div>
      <div class="chips inline">
        <button type="button" class="chip" data-now="order_date">Сегодня</button>
      </div>
      <div class="hint">Расход вычитается из заказа: скидки, оплаты и статуса у него нет.</div>`;

    $("editor-body").innerHTML = `
      ${t.expense ? `<div class="cost-banner ${esc(t.kind)}">Это расход — ${esc(kindLabel(t.kind))}</div>` : ""}
      ${line.frozen ? `<div class="frozen-banner">Заморожена — не учитывается в итогах, кассе и календаре</div>` : ""}
      ${head}
      ${t.expense ? costOnly : money_}

      <div class="ed-sums" id="ed-sums">${editorSumsHtml(t)}</div>

      <div class="stack">
        <button type="button" class="btn wide" id="ed-freeze">${line.frozen ? "Вернуть в заказ" : "Заморозить позицию"}</button>
        <button type="button" class="btn wide" id="ed-dup">Дублировать позицию</button>
        <button type="button" class="btn wide danger-ghost" id="ed-del">Удалить позицию</button>
      </div>`;
    if (state.exprField && !$("expr-pad")?.hidden) {
      state.exprInput = document.querySelector(`#editor-body input[data-f="${state.exprField}"]`);
      refreshExprPadResult();
    }
  }

  function editorSumsHtml(t) {
    if (t.expense) {
      return `
      <div class="ed-sum"><span>Вид</span><b>${esc(
        t.mode === "amount" ? kindLabel(t.kind) : `${qtyFmt.format(t.percent)} %`
      )}</b></div>
      ${t.mode === "amount" ? "" : `<div class="ed-sum"><span>База</span><b>${esc(money(t.base))}</b></div>`}
      <div class="ed-sum cost"><span>Вычитается</span><b>−${esc(money(t.cost))}</b></div>`;
    }
    return `
      <div class="ed-sum"><span>Сумма</span><b>${esc(money(t.total))}</b></div>
      <div class="ed-sum"><span>После скидки</span><b>${esc(money(t.after))}</b></div>
      <div class="ed-sum ${t.unpaid > 0.005 ? "debt" : "paid"}"><span>${t.unpaid > 0.005 ? "Осталось" : "Оплачено"}</span><b>${esc(
        money(t.unpaid > 0.005 ? t.unpaid : t.paid)
      )}</b></div>`;
  }

  function refreshEditorSums() {
    const line = findLine(currentOrder(), state.editLineId);
    const box = $("ed-sums");
    if (!line || !box) return;
    box.innerHTML = editorSumsHtml(lineTotals(line));
    refreshExprPadResult();
  }

  function setLineNumber(line, exprKey, value) {
    line[exprKey] = String(value);
    const mirror = EXPR_MIRROR[exprKey];
    if (mirror) {
      const v = evalExpr(line[exprKey]);
      line[mirror] = Number.isFinite(v) ? round2(v) : 0;
    }
  }

  const EXPR_KEYS = [
    ["1", "1", ""],
    ["2", "2", ""],
    ["3", "3", ""],
    ["+", "+", "op"],
    ["(", "(", "op"],
    ["4", "4", ""],
    ["5", "5", ""],
    ["6", "6", ""],
    ["−", "-", "op"],
    [")", ")", "op"],
    ["7", "7", ""],
    ["8", "8", ""],
    ["9", "9", ""],
    ["×", "*", "op"],
    ["⌫", "back", "util"],
    ["0", "0", ""],
    [".", ".", ""],
    ["00", "00", ""],
    ["÷", "/", "op"],
    ["C", "clear", "util"],
  ];

  function fillExprPad() {
    const grid = $("expr-pad-grid");
    if (!grid || grid.childElementCount) return;
    grid.innerHTML = EXPR_KEYS.map(
      ([label, op, kind]) =>
        `<button type="button" class="expr-pad-key ${kind}" data-expr-op="${op}">${label}</button>`
    ).join("");
  }

  function exprTargetInput() {
    if (state.exprInput?.isConnected) return state.exprInput;
    if (!state.exprField) return null;
    state.exprInput = document.querySelector(`#editor-body input[data-f="${state.exprField}"]`);
    return state.exprInput;
  }

  function exprResultText(field, raw, line) {
    const s = String(raw ?? "").trim();
    if (!s) return "2 × 6 + 1";
    const v = evalExpr(s);
    if (!Number.isFinite(v)) return "неверное выражение";
    if (field === "qty_expr") {
      const q = Math.round(v * 1000) / 1000;
      return `= ${q} ${line?.unit || ""}`.trim();
    }
    if (field === "discount_expr") return `= ${round2(v)}%`;
    return `= ${money(v)}`;
  }

  function refreshExprPadResult() {
    const box = $("expr-pad-result");
    if (!box) return;
    const input = exprTargetInput();
    const line = findLine(currentOrder(), state.editLineId);
    const field = input?.dataset?.f || state.exprField;
    const raw = input?.value ?? line?.[field] ?? "";
    const text = exprResultText(field, raw, line);
    box.textContent = text;
    box.classList.toggle("bad", text === "неверное выражение");
  }

  function exprFieldHtml(line, field, attrs, placeholder) {
    const raw = exprRaw(line, field);
    const formula = isFormula(raw) && Number.isFinite(evalExpr(raw));
    return `<input type="text" inputmode="none" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" class="big-input expr-input${formula ? " is-result" : ""}" placeholder="${esc(placeholder)}" value="${esc(formula ? shownExprValue(line, field) : raw)}" data-expr="${esc(raw)}" data-showing="${formula ? "result" : "expr"}" ${attrs} />`;
  }

  function markExprValidity(input) {
    if (!input) return;
    const raw = String(input.dataset.showing === "result" ? input.dataset.expr ?? "" : input.value ?? "").trim();
    input.classList.toggle("invalid", raw !== "" && !Number.isFinite(evalExpr(raw)));
  }

  function revealExpr(input) {
    if (!input || input.dataset.showing !== "result") return;
    input.dataset.showing = "expr";
    input.value = input.dataset.expr || "";
    input.classList.remove("is-result");
    markExprValidity(input);
  }

  function collapseExpr(input) {
    if (!input?.dataset?.f) return;
    const raw = String(input.dataset.showing === "result" ? input.dataset.expr ?? "" : input.value ?? "").replaceAll(",", ".");
    if (input.dataset.showing !== "result") input.dataset.expr = raw;
    const v = evalExpr(raw);
    markExprValidity(input);
    if (Number.isFinite(v) && isFormula(raw)) {
      input.dataset.showing = "result";
      input.value = formatExprResult(v);
      input.classList.add("is-result");
    } else {
      input.dataset.showing = "expr";
      if (input.value !== raw) input.value = raw;
      input.classList.remove("is-result");
    }
  }

  function applyExprToken(input, token) {
    if (!input || !token) return;
    revealExpr(input);
    input.dataset.showing = "expr";
    input.classList.remove("is-result");
    const value = String(input.value ?? "");
    const start = input.selectionStart ?? value.length;
    const end = input.selectionEnd ?? start;
    let next = value;
    let pos = start;
    if (token === "clear") {
      next = "";
      pos = 0;
    } else if (token === "back") {
      if (start !== end) {
        next = value.slice(0, start) + value.slice(end);
        pos = start;
      } else if (start > 0) {
        next = value.slice(0, start - 1) + value.slice(end);
        pos = start - 1;
      } else {
        return;
      }
    } else if (
      input.dataset.f === "price_expr" &&
      /^\d+$/.test(token) &&
      start === end &&
      isBareZeroExpr(value)
    ) {
      next = token === "00" || token === "0" ? "0" : token.replace(/^0+/, "") || "0";
      pos = next.length;
    } else {
      next = value.slice(0, start) + token + value.slice(end);
      pos = start + token.length;
    }
    if (input.dataset.f === "price_expr") {
      const stripped = stripLeadingZerosPlain(next);
      pos = Math.max(0, pos - (next.length - stripped.length));
      next = stripped;
    }
    input.value = next;
    input.dataset.expr = next;
    input.focus();
    try {
      input.setSelectionRange(pos, pos);
    } catch {
      /* some mobile browsers ignore selection on unfocused inputs */
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    markExprValidity(input);
  }

  function showExprPad(input) {
    if (!input) return;
    revealExpr(input);
    state.exprInput = input;
    state.exprField = input.dataset.f || "";
    if (state.exprSystemKb) {
      input.setAttribute("inputmode", "text");
      input.removeAttribute("readonly");
      return;
    }
    fillExprPad();
    const pad = $("expr-pad");
    if (pad) pad.hidden = false;
    $("editor")?.classList.add("expr-open");
    input.setAttribute("inputmode", "none");
    refreshExprPadResult();
    requestAnimationFrame(() => {
      input.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  function hideExprPad() {
    const pad = $("expr-pad");
    if (pad) pad.hidden = true;
    $("editor")?.classList.remove("expr-open");
  }

  function useSystemExprKeyboard() {
    state.exprSystemKb = true;
    hideExprPad();
    const input = exprTargetInput();
    if (!input) return;
    input.setAttribute("inputmode", "text");
    input.removeAttribute("readonly");
    input.focus();
  }

  function editorJump(step) {
    const order = currentOrder();
    const lines = order?.lines || [];
    const index = lines.findIndex((l) => l.id === state.editLineId);
    const next = lines[index + step];
    if (!next) return false;
    hideExprPad();
    state.exprField = "";
    state.exprInput = null;
    document.activeElement?.blur?.();
    state.editLineId = next.id;
    renderEditor();
    $("editor-body").scrollTop = 0;
    navReport();
    flashSwipe($("editor-body"), step);
    try {
      navigator.vibrate?.(10);
    } catch (_) {}
    return true;
  }

