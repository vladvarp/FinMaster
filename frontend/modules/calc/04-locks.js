  function orderFieldOwner(orderId, lineId, field, exceptBpId, exceptNodeId) {
    const calc = ensureState();
    if (!calc || !orderId || !lineId || !field) return null;
    const want = lineInPortId(lineId, field);
    for (const bp of calc.blueprints || []) {
      if (exceptBpId && bp.id === exceptBpId) continue;
      const nodes = bp.nodes || [];
      for (const link of bp.links || []) {
        if (link.toPort !== want) continue;
        const dst = nodes.find((item) => item.id === link.to);
        if (!dst || dst.type !== "order" || dst.orderId !== orderId) continue;
        if (exceptNodeId && dst.id === exceptNodeId) continue;
        const src = nodes.find((item) => item.id === link.from);
        return { blueprint: bp, node: dst, link, source: src };
      }
    }
    return null;
  }

  function orderFieldOwnerReason(owner, line, order, field) {
    if (!owner) return "";
    const scheme = owner.blueprint?.name || "Схема";
    const fieldName = lineFieldLabel(line, order, field);
    const orderLabel = order?.number || order?.name || "заказ";
    let src = "связь";
    if (owner.source) {
      if (owner.source.type === "const") src = owner.source.note ? `Константа «${String(owner.source.note).split("\n")[0].slice(0, 40)}»` : "Константа";
      else if (owner.source.type === "math") src = `Оператор ${owner.source.op || ""}`.trim();
      else if (owner.source.type === "formula") src = "Формула";
      else if (owner.source.type === "percent") src = "Процент";
      else if (owner.source.type === "result") src = owner.source.name || "Результат";
      else if (owner.source.type === "order") {
        const other = api.findOrder(owner.source.orderId);
        src = `Заказ ${other?.number || "—"}`;
      } else if (owner.source.type === "filter") src = "Фильтр";
      else if (owner.source.type === "dashboard") src = "Дашборд";
      else if (owner.source.type === "scheme") src = "Схема";
      else src = owner.source.type || "нода";
    }
    return `Поле «${fieldName}» занято схемой «${scheme}» · ${orderLabel} ← ${src}`;
  }

  /** Все занятые входы полей заказов — для блокировки ячеек в таблице. */
  function collectOrderFieldLocks() {
    const calc = ensureState();
    if (!calc) return [];
    const locks = [];
    for (const bp of calc.blueprints || []) {
      const nodes = bp.nodes || [];
      for (const link of bp.links || []) {
        const parsed = parseLinePort(link.toPort);
        if (!parsed?.input || !parsed.field) continue;
        const dst = nodes.find((item) => item.id === link.to);
        if (!dst || dst.type !== "order" || !dst.orderId) continue;
        const order = api.findOrder?.(dst.orderId);
        if (!order) continue;
        const line = (order.lines || []).find((item) => item.id === parsed.lineId);
        if (!line) continue;
        const src = nodes.find((item) => item.id === link.from);
        const owner = { blueprint: bp, node: dst, link, source: src };
        locks.push({
          orderId: dst.orderId,
          lineId: parsed.lineId,
          field: parsed.field,
          exprKey: fieldToExprKey(parsed.field),
          schemeId: bp.id,
          schemeName: bp.name || "Схема",
          reason: orderFieldOwnerReason(owner, line, order, parsed.field),
        });
      }
    }
    return locks;
  }

  /** Удалить ноды/связи калькулятора на заказ или одну позицию. */
  function pruneOrderCalcLinks(orderId, lineId) {
    const calc = ensureState();
    if (!calc || !orderId) return false;
    let changed = false;
    (calc.blueprints || []).forEach((bp) => {
      const orderNodeIds = new Set(
        (bp.nodes || []).filter((node) => node.type === "order" && node.orderId === orderId).map((node) => node.id)
      );
      if (!orderNodeIds.size) return;
      if (!lineId) {
        const beforeNodes = (bp.nodes || []).length;
        bp.nodes = (bp.nodes || []).filter((node) => !orderNodeIds.has(node.id));
        if (bp.nodes.length !== beforeNodes) changed = true;
        const beforeLinks = (bp.links || []).length;
        bp.links = (bp.links || []).filter((link) => !orderNodeIds.has(link.from) && !orderNodeIds.has(link.to));
        if ((bp.links || []).length !== beforeLinks) changed = true;
        return;
      }
      (bp.nodes || []).forEach((node) => {
        if (!orderNodeIds.has(node.id) || !node.openFields?.[lineId]) return;
        delete node.openFields[lineId];
        changed = true;
      });
      const beforeLinks = (bp.links || []).length;
      bp.links = (bp.links || []).filter((link) => {
        const touchesOrder = orderNodeIds.has(link.from) || orderNodeIds.has(link.to);
        if (!touchesOrder) return true;
        const to = parseLinePort(link.toPort);
        const from = parseLinePort(link.fromPort);
        if (to?.lineId === lineId || from?.lineId === lineId) return false;
        return true;
      });
      if ((bp.links || []).length !== beforeLinks) changed = true;
    });
    if (changed) dirty();
    return changed;
  }

