  function orderLines(order) {
    return order?.lines || [];
  }

  function lineAmount(line, order) {
    const totals = api.lineTotals(line, order);
    if (!totals) return 0;
    return totals.expense ? totals.cost : totals.after;
  }

  function lineTone(line, order) {
    if (api.isFrozen?.(line)) return "frozen";
    const totals = api.lineTotals(line, order);
    if (totals?.kind === "tax") return "tax";
    if (totals?.kind === "cost") return "cost";
    return "income";
  }

  function lineFieldOptions(line, order) {
    if (!line) {
      return [
        { id: "qty", name: "количество" },
        { id: "price", name: "цена" },
        { id: "discount", name: "скидка" },
        { id: "paid", name: "оплачено" },
        { id: "unpaid", name: "не оплачено" },
      ];
    }
    const totals = api.lineTotals?.(line, order);
    if (totals?.expense) {
      if (totals.kind === "tax" && totals.mode && totals.mode !== "amount") {
        return [{ id: "percent", name: "процент" }];
      }
      return [
        { id: "qty", name: "количество" },
        { id: "price", name: "сумма за единицу" },
      ];
    }
    return [
      { id: "qty", name: "количество" },
      { id: "price", name: "цена" },
      { id: "discount", name: "скидка" },
      { id: "paid", name: "оплачено" },
      { id: "unpaid", name: "не оплачено" },
    ];
  }

  /** Поля, которые можно подать на вход ноды заказа (запись в строку). */
  function lineInputFieldOptions(line, order) {
    if (!line) {
      return [
        { id: "qty", name: "количество" },
        { id: "price", name: "цена" },
        { id: "discount", name: "скидка" },
        { id: "paid", name: "оплачено" },
      ];
    }
    const totals = api.lineTotals?.(line, order);
    if (totals?.expense) {
      if (totals.kind === "tax" && totals.mode && totals.mode !== "amount") {
        return [{ id: "percent", name: "процент" }];
      }
      return [
        { id: "qty", name: "количество" },
        { id: "price", name: "сумма за единицу" },
      ];
    }
    return [
      { id: "qty", name: "количество" },
      { id: "price", name: "цена" },
      { id: "discount", name: "скидка" },
      { id: "paid", name: "оплачено" },
    ];
  }

  function lineFieldLabel(line, order, fieldId) {
    const all = [...lineInputFieldOptions(line, order), ...lineFieldOptions(line, order)];
    return all.find((item) => item.id === fieldId)?.name || fieldId;
  }

  function lineFieldValue(line, order, field) {
    const totals = api.lineTotals(line, order) || {};
    if (field === "qty") return Number(api.qtyValue?.(line) ?? line.quantity) || 0;
    if (field === "price") return Number(api.lineUnitPrice?.(line) ?? line.price) || 0;
    if (field === "discount") return Number(totals.discount) || 0;
    if (field === "paid") return Number(totals.paid) || 0;
    if (field === "unpaid") return Number(totals.unpaid) || 0;
    if (field === "percent") return Number(totals.percent) || 0;
    return 0;
  }

  function lineInPortId(lineId, field) {
    return `in:line:${lineId}:${field}`;
  }

  function parseLinePort(portId) {
    const text = String(portId || "");
    const inn = text.match(/^in:line:([^:]+):([a-z]+)$/);
    if (inn) return { lineId: inn[1], field: inn[2] || "", input: true };
    const m = text.match(/^line:([^:]+)(?::([a-z]+))?$/);
    if (!m) return null;
    return { lineId: m[1], field: m[2] || "", input: false };
  }

  function fieldToExprKey(field) {
    if (field === "qty") return "qty_expr";
    if (field === "price") return "price_expr";
    if (field === "discount") return "discount_expr";
    if (field === "paid") return "paid_expr";
    if (field === "percent") return "tax_percent_expr";
    return "";
  }

  function formatCalcNumber(value) {
    if (!Number.isFinite(value)) return "";
    const rounded = Math.round(value * 1e6) / 1e6;
    if (Number.isInteger(rounded)) return String(rounded);
    return String(rounded).replace(/\.?0+$/, "");
  }

  /** Владелец входа поля заказа (по всем схемам). */
