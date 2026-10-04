  /* ================= редактирование ================= */

  const DECIMAL_FIELDS = new Set(["qty_expr", "price_expr", "discount_expr", "paid_expr", "tax_percent_expr"]);
  const MIRROR = EXPR_MIRROR;

  function onEdit(e) {
    const el = e.target;
    const docField = el.dataset?.d;
    if (docField && state.doc) {
      if (docField === "money_decimals") {
        state.doc.money_decimals = moneyDecimals({ money_decimals: el.value });
        syncMoneyFmt(state.doc.money_decimals);
      } else {
        state.doc[docField] = el.value;
      }
      touchDoc();
      pushSoon();
      updateHead();
      if (docField === "currency" || docField === "money_decimals") renderCurrent();
      return;
    }
    const field = el.dataset?.f;
    if (!field) return;
    const order = el.dataset.o ? orders().find((o) => o.id === el.dataset.o) : currentOrder();
    if (!order) return;

    if (el.dataset.l) {
      const line = findLine(order, el.dataset.l);
      if (!line) return;
      if (DECIMAL_FIELDS.has(field) && el.dataset.showing === "result") return;
      let value = el.value;
      if (DECIMAL_FIELDS.has(field) && value.includes(",")) {
        const pos = el.selectionStart;
        value = value.replaceAll(",", ".");
        el.value = value;
        if (pos != null) el.setSelectionRange(pos, pos);
      }
      if (field === "price_expr") {
        const cleaned = stripLeadingZerosPlain(value);
        if (cleaned !== value) {
          const pos = el.selectionStart;
          const diff = value.length - cleaned.length;
          value = cleaned;
          el.value = cleaned;
          if (pos != null) {
            try {
              el.setSelectionRange(Math.max(0, pos - diff), Math.max(0, pos - diff));
            } catch (_) {}
          }
        }
      }
      const prevKind = field === "order_type" ? typeKind(line.order_type) : "";
      line[field] = value;
      if (DECIMAL_FIELDS.has(field)) el.dataset.expr = value;
      if (MIRROR[field]) {
        const v = evalExpr(value);
        line[MIRROR[field]] = Number.isFinite(v) ? round2(v) : 0;
      }
      if (field === "product") {
        fillEdProductSuggest(value);
        const want = productKindOfLine(line);
        const found = (state.doc.products || []).find(
          (p) => productKind(p) === want && catalogNameKey(p.name || p) === catalogNameKey(value)
        );
        if (found?.unit) {
          line.unit = found.unit;
          const sel = document.querySelector(`select[data-l="${CSS.escape(line.id)}"][data-f="unit"]`);
          if (sel) sel.value = found.unit;
        }
        if (found?.price != null && num(found.price) > 0 && !(num(line.price) > 0)) {
          setLineNumber(line, "price_expr", found.price);
          const inp = document.querySelector(`input[data-l="${CSS.escape(line.id)}"][data-f="price_expr"]`);
          if (inp) {
            inp.value = String(found.price);
            inp.dataset.expr = String(found.price);
            inp.dataset.showing = "expr";
            inp.classList.remove("is-result");
          }
        }
        if (want === "tax" && found?.tax_percent != null && num(found.tax_percent) > 0) {
          setLineNumber(line, "tax_percent_expr", found.tax_percent);
          const inp = document.querySelector(`input[data-l="${CSS.escape(line.id)}"][data-f="tax_percent_expr"]`);
          if (inp) {
            inp.value = String(found.tax_percent);
            inp.dataset.expr = String(found.tax_percent);
            inp.dataset.showing = "expr";
            inp.classList.remove("is-result");
          }
        }
      }
      // Смена вида (доход / налог / затрата) меняет форму редактора — пересобираем экран.
      if (field === "order_type" && typeKind(line.order_type) !== prevKind) {
        const nextKind = typeKind(line.order_type);
        if (nextKind && !prevKind) resetExpenseLine(line);
        line.tax_mode = nextKind === "tax" ? "gross" : "amount";
        touchDoc();
        pushSoon();
        renderOrder();
        renderEditor();
        return;
      }
      if (field === "tax_percent_expr") {
        markExprValidity(el);
        refreshEditorSums();
        renderOrder();
        touchDoc();
        pushSoon();
        return;
      }
      if (field === "paid_expr") autoPaidStatus(line);
      if (DECIMAL_FIELDS.has(field)) markExprValidity(el);
      refreshEditorSums();
      refreshOrderRow(line.id);
    } else {
      order[field] = el.value;
      if (field === "work_start" || field === "work_end") {
        normalizeWorkDates(order);
        touchDoc();
        pushSoon();
        renderOrder();
        return;
      }
      if (field === "number" || field === "name") renderOrderTopOnly(order);
    }
    touchDoc();
    pushSoon();
  }

  function renderOrderTopOnly(order) {
    const top = $("order-top");
    if (!top) return;
    const numEl = top.querySelector(".ot-num");
    const nameEl = top.querySelector(".ot-name");
    if (numEl) numEl.textContent = order.number || "—";
    if (nameEl) nameEl.textContent = order.name || "без названия";
  }

  /** У расхода нет скидки, оплаты и даты оплаты — очищаем, чтобы цифры не всплыли при возврате к обычному типу. */
  function resetExpenseLine(line) {
    line.discount = 0;
    line.discount_expr = "0";
    line.paid = 0;
    line.paid_expr = "0";
    line.payment_date = "";
    if (line.tax_mode == null) line.tax_mode = typeKind(line.order_type) === "tax" ? "gross" : "amount";
    if (line.tax_percent_expr == null) {
      line.tax_percent = num(line.tax_percent);
      line.tax_percent_expr = String(line.tax_percent || 0);
    }
    return line;
  }

  function autoPaidStatus(line) {
    const name = paidStatusName();
    if (!name || isExpenseLine(line)) return;
    const t = lineTotals(line);
    if (t.after > 0 && t.paid + 0.005 >= t.after && line.status !== name) {
      line.status = name;
      document.querySelectorAll("[data-pick-status]").forEach((b) => {
        b.classList.toggle("active", b.dataset.pickStatus === name);
      });
    }
  }

