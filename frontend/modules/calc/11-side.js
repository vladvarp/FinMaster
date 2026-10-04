  function renderTabs(calc) {
    const host = $("calc-tabs");
    if (!host) return;
    const left = host.scrollLeft;
    host.innerHTML = calc.blueprints
      .map(
        (bp) => `<div class="calc-tab ${bp.id === calc.active ? "active" : ""}" data-bp="${esc(bp.id)}" draggable="true" title="${esc(bp.name)}">
          <span class="calc-tab-label">${esc(bp.name)}</span>
          ${calc.blueprints.length > 1 ? `<button type="button" class="calc-tab-x" data-del-bp="${esc(bp.id)}" title="Закрыть схему" draggable="false">×</button>` : ""}
        </div>`
      )
      .join("");
    host.scrollLeft = left;
    const on = host.querySelector(".calc-tab.active");
    if (on) on.scrollIntoView({ inline: "nearest", block: "nearest" });
  }

  function reorderBlueprint(fromId, toId, placeAfter) {
    const calc = ensureState();
    if (!calc || !fromId || !toId || fromId === toId) return false;
    const from = calc.blueprints.findIndex((bp) => bp.id === fromId);
    let to = calc.blueprints.findIndex((bp) => bp.id === toId);
    if (from < 0 || to < 0) return false;
    const [item] = calc.blueprints.splice(from, 1);
    to = calc.blueprints.findIndex((bp) => bp.id === toId);
    if (to < 0) {
      calc.blueprints.push(item);
    } else {
      calc.blueprints.splice(placeAfter ? to + 1 : to, 0, item);
    }
    dirty();
    render();
    return true;
  }

  function renderTitle(bp) {
    const field = $("calc-bp-name");
    if (!field || !bp) return;
    if (document.activeElement === field) return;
    field.value = bp.name || "Схема";
  }

  function orderStamp(order) {
    let best = "";
    for (const line of order?.lines || []) {
      const day = String(line.order_date || "").slice(0, 10);
      if (day.length >= 10 && day > best) best = day;
    }
    if (best) return best;
    return String(order?.created_at || "").slice(0, 10);
  }

  function renderSide(bp) {
    const host = $("calc-side");
    if (!host) return;
    const calc = ensureState();
    const q = session.search.trim().toLowerCase();
    const src = api.orders() || [];
    const orders = src
      .map((order, index) => ({ order, index }))
      .filter(({ order }) => {
        if (!q) return true;
        const blob = `${order.number || ""} ${order.name || ""} ${order.customer || ""}`.toLowerCase();
        return blob.includes(q);
      })
      .sort((a, b) => {
        const da = orderStamp(a.order);
        const db = orderStamp(b.order);
        if (db !== da) return db.localeCompare(da);
        return b.index - a.index;
      })
      .map((item) => item.order);
    const usedOrders = new Set(
      (bp?.nodes || []).filter((node) => node.type === "order" && node.orderId).map((node) => node.orderId)
    );
    const schemes = (calc?.blueprints || []).filter((item) => item.id !== bp?.id);
    host.innerHTML = `
      <details class="calc-fold" data-fold="nodes" ${foldOpen("nodes") ? "open" : ""}>
        <summary class="calc-tools-label">Ноды</summary>
        <div class="calc-tools">
          <button type="button" class="btn calc-tool" data-add-node="math" draggable="true">Оператор</button>
          <button type="button" class="btn calc-tool" data-add-node="formula" draggable="true">Формула</button>
          <button type="button" class="btn calc-tool" data-add-node="percent" draggable="true">Процент</button>
          <button type="button" class="btn calc-tool" data-add-node="const" draggable="true">Константа</button>
          <button type="button" class="btn calc-tool" data-add-node="filter" draggable="true">Фильтр</button>
          <button type="button" class="btn calc-tool" data-add-node="dashboard" draggable="true">Дашборд</button>
          <button type="button" class="btn calc-tool" data-add-node="result" draggable="true">Результат</button>
          <button type="button" class="btn calc-tool" data-add-node="group" draggable="true">Группа</button>
        </div>
      </details>
      <details class="calc-fold" data-fold="schemes" ${foldOpen("schemes") ? "open" : ""}>
        <summary class="calc-tools-label">Схемы</summary>
        <div class="calc-orders calc-schemes">
          <div class="calc-order-list calc-scheme-list">
            ${
              schemes.length
                ? schemes
                    .map((item) => {
                      const n = (item.nodes || []).filter((node) => node.type === "result" && resultVisible(node)).length;
                      return `<button type="button" class="calc-order" draggable="true" data-blueprint="${esc(item.id)}">
                        <b>${esc(item.name || "Схема")}</b>
                        <span>${n ? `${n} рез.` : "нет результатов"}</span>
                      </button>`;
                    })
                    .join("")
                : `<div class="calc-empty">Другая схема станет нодой: её выходы — ноды «Результат»</div>`
            }
          </div>
        </div>
      </details>
      <details class="calc-fold" data-fold="orders" ${foldOpen("orders") ? "open" : ""}>
        <summary class="calc-tools-label">Заказы</summary>
        <div class="calc-orders">
          <div class="calc-search${session.search ? " has-value" : ""}">
            <input type="search" id="calc-order-search" placeholder="Номер, название…" value="${esc(session.search)}" autocomplete="off" />
            <button type="button" class="search-clear" data-search-clear="calc-order-search" title="Очистить" aria-label="Очистить поиск">×</button>
          </div>
          <div class="calc-order-list">
            ${
              orders.length
                ? orders
                    .map((order) => {
                      const n = orderLines(order).length;
                      const used = usedOrders.has(order.id);
                      const label = `${order.number || "—"} — ${order.name || order.customer || "Без названия"}`;
                      const tip = used ? `${label} · на схеме` : label;
                      return `<button type="button" class="calc-order${used ? " is-used" : ""}" draggable="true" data-order="${esc(order.id)}" title="${esc(tip)}">
                        <b>${esc(order.number || "—")}</b>
                        <span>${esc(order.name || order.customer || "Без названия")}</span>
                        <small>${used ? "на схеме" : `${n} поз.`}</small>
                      </button>`;
                    })
                    .join("")
                : `<div class="calc-empty">Нет заказов</div>`
            }
          </div>
        </div>
      </details>`;
  }

  function hidePortMenu() {
    document.querySelectorAll(".calc-port-menu").forEach((el) => el.remove());
  }

  function showDashPortMenu(clientX, clientY, nodeId) {
    hidePortMenu();
    const bp = activeBlueprint();
    const node = bp?.nodes.find((item) => item.id === nodeId && item.type === "dashboard");
    if (!bp || !node) return;
    const open = new Set(openDashPorts(node));
    const linked = linkedFromPorts(node.id, bp.links);
    const menu = document.createElement("div");
    menu.className = "calc-port-menu";
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    DASH_PORTS.forEach((port) => {
      const shown = open.has(port.id) || linked.has(port.id);
      const locked = linked.has(port.id);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = port.name;
      if (shown) {
        btn.className = "is-shown";
        btn.title = locked ? "Порт занят связью" : "Убрать с ноды";
      } else {
        btn.title = "Добавить на ноду";
      }
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (locked) return;
        if (shown) dropDashPort(node, port.id);
        else ensureDashPort(node, port.id);
        hidePortMenu();
        dirty();
        render();
      });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    const place = () => {
      const rect = menu.getBoundingClientRect();
      let left = clientX;
      let top = clientY;
      if (left + rect.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - rect.width - 8);
      if (top + rect.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - rect.height - 8);
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    };
    place();
    const close = (e) => {
      if (e.target.closest?.(".calc-port-menu")) return;
      hidePortMenu();
      document.removeEventListener("pointerdown", close, true);
    };
    setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
  }

  function showLinePortMenu(clientX, clientY, nodeId, lineId) {
    hidePortMenu();
    const bp = activeBlueprint();
    const node = bp?.nodes.find((item) => item.id === nodeId && item.type === "order");
    const order = api.findOrder(node?.orderId);
    const line = (order?.lines || []).find((item) => item.id === lineId);
    if (!bp || !node || !line) return;
    const byId = new Map();
    lineFieldOptions(line, order).forEach((field) => byId.set(field.id, { ...field, canOut: true, canIn: false }));
    lineInputFieldOptions(line, order).forEach((field) => {
      const prev = byId.get(field.id) || { id: field.id, name: field.name, canOut: false, canIn: false };
      prev.canIn = true;
      prev.name = field.name;
      byId.set(field.id, prev);
    });
    const options = [...byId.values()];
    if (!options.length) return;
    const open = new Set(openFieldsFor(node, lineId));
    const linkedOut = linkedFromPorts(node.id, bp.links);
    const linkedIn = usedInputPorts(node.id, bp.links);
    const menu = document.createElement("div");
    menu.className = "calc-port-menu";
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    options.forEach((field) => {
      const outId = `line:${lineId}:${field.id}`;
      const inId = lineInPortId(lineId, field.id);
      const shown = open.has(field.id) || linkedOut.has(outId) || linkedIn.has(inId);
      const lockedElsewhere = field.canIn && !!orderFieldOwner(node.orderId, lineId, field.id, null, node.id);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = field.name + (field.canIn ? " ↔" : " →");
      if (lockedElsewhere && !shown) {
        btn.className = "is-locked";
        btn.title = orderFieldOwnerReason(
          orderFieldOwner(node.orderId, lineId, field.id),
          line,
          order,
          field.id
        );
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          api?.toast?.(btn.title);
        });
      } else if (shown) {
        btn.className = "is-shown";
        btn.title = linkedOut.has(outId) || linkedIn.has(inId) ? "Порт занят связью" : "Убрать с ноды";
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (linkedOut.has(outId) || linkedIn.has(inId)) {
            api?.toast?.("Сначала удалите связь");
            return;
          }
          dropOpenField(node, lineId, field.id);
          hidePortMenu();
          dirty();
          render();
        });
      } else {
        btn.title = field.canIn ? "Показать вход и выход" : "Показать выход";
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          ensureOpenField(node, lineId, field.id);
          hidePortMenu();
          dirty();
          render();
        });
      }
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    const onDoc = (e) => {
      if (e.target.closest?.(".calc-port-menu")) return;
      hidePortMenu();
      document.removeEventListener("pointerdown", onDoc, true);
    };
    setTimeout(() => document.addEventListener("pointerdown", onDoc, true), 0);
  }

  function freeOrderFieldPort(orderId, lineId, field) {
    const calc = ensureState();
    const want = lineInPortId(lineId, field);
    let changed = false;
    (calc.blueprints || []).forEach((bp) => {
      const before = (bp.links || []).length;
      bp.links = (bp.links || []).filter((link) => {
        if (link.toPort !== want) return true;
        const dst = (bp.nodes || []).find((item) => item.id === link.to);
        if (!dst || dst.type !== "order" || dst.orderId !== orderId) return true;
        return false;
      });
      if (bp.links.length !== before) changed = true;
    });
    if (changed) {
      dirty();
      render();
      api?.refreshOrders?.();
    }
    return changed;
  }

  function showOrderInputPortMenu(clientX, clientY, nodeId, portId) {
    hidePortMenu();
    const bp = activeBlueprint();
    const node = bp?.nodes.find((item) => item.id === nodeId && item.type === "order");
    const parsed = parseLinePort(portId);
    if (!bp || !node || !parsed?.input || !parsed.field) return;
    const owner = orderFieldOwner(node.orderId, parsed.lineId, parsed.field);
    if (!owner || owner.node.id === node.id) return;
    const order = api.findOrder(node.orderId);
    const line = (order?.lines || []).find((item) => item.id === parsed.lineId);
    const menu = document.createElement("div");
    menu.className = "calc-port-menu";
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    const info = document.createElement("div");
    info.className = "calc-port-menu-empty";
    info.textContent = orderFieldOwnerReason(owner, line, order, parsed.field);
    menu.appendChild(info);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Освободить порт";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      freeOrderFieldPort(node.orderId, parsed.lineId, parsed.field);
      hidePortMenu();
    });
    menu.appendChild(btn);
    document.body.appendChild(menu);
    placePortMenu(menu, clientX, clientY);
    bindPortMenuClose(menu);
  }

  function placePortMenu(menu, clientX, clientY) {
    const rect = menu.getBoundingClientRect();
    let left = clientX;
    let top = clientY;
    if (left + rect.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - rect.width - 8);
    if (top + rect.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - rect.height - 8);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function bindPortMenuClose(menu) {
    const onDoc = (e) => {
      if (e.target.closest?.(".calc-port-menu")) return;
      hidePortMenu();
      document.removeEventListener("pointerdown", onDoc, true);
    };
    setTimeout(() => document.addEventListener("pointerdown", onDoc, true), 0);
  }

  function showOrderTypeMenu(clientX, clientY, nodeId) {
    hidePortMenu();
    const bp = activeBlueprint();
    const node = bp?.nodes.find((item) => item.id === nodeId && item.type === "order");
    const order = api.findOrder(node?.orderId);
    if (!bp || !node || !order) return;
    const names = orderTypeNames(order);
    const open = new Set(openTypesFor(node));
    const linked = linkedFromPorts(node.id, bp.links);
    const menu = document.createElement("div");
    menu.className = "calc-port-menu";
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    if (!names.length) {
      const empty = document.createElement("div");
      empty.className = "calc-port-menu-empty";
      empty.textContent = "Нет типов в заказе";
      menu.appendChild(empty);
    }
    names.forEach((typeName) => {
      const portId = typePortId(typeName);
      const childLinked = typeFieldOptions(order, typeName).some((field) => linked.has(typePortId(typeName, field.id)));
      const shown = open.has(typeName) || linked.has(portId) || childLinked;
      const locked = linked.has(portId) || childLinked;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = typeName;
      if (shown) {
        btn.className = "is-shown";
        btn.title = locked ? "Порт занят связью" : "Убрать с ноды";
      } else {
        btn.title = "Добавить сумму типа";
      }
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (locked) return;
        if (shown) dropOpenType(node, typeName);
        else ensureOpenType(node, typeName);
        hidePortMenu();
        dirty();
        render();
      });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    placePortMenu(menu, clientX, clientY);
    bindPortMenuClose(menu);
  }

  function showTypePortMenu(clientX, clientY, nodeId, typeName) {
    hidePortMenu();
    const bp = activeBlueprint();
    const node = bp?.nodes.find((item) => item.id === nodeId && item.type === "order");
    const order = api.findOrder(node?.orderId);
    if (!bp || !node || !order) return;
    const options = typeFieldOptions(order, typeName);
    if (!options.length) return;
    const open = new Set(openTypeFieldsFor(node, typeName));
    const linked = linkedFromPorts(node.id, bp.links);
    const menu = document.createElement("div");
    menu.className = "calc-port-menu";
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    options.forEach((field) => {
      const portId = typePortId(typeName, field.id);
      const shown = open.has(field.id) || linked.has(portId);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = field.name;
      if (shown) {
        btn.className = "is-shown";
        btn.title = "Убрать с ноды";
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropOpenTypeField(node, typeName, field.id);
          bp.links = (bp.links || []).filter((link) => !(link.from === nodeId && link.fromPort === portId));
          hidePortMenu();
          dirty();
          render();
        });
      } else {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          ensureOpenType(node, typeName);
          ensureOpenTypeField(node, typeName, field.id);
          hidePortMenu();
          dirty();
          render();
        });
      }
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    placePortMenu(menu, clientX, clientY);
    bindPortMenuClose(menu);
  }

  function orderNodeHtml(node, order, graph, bp) {
    const missing = !order;
    const ports = nodeOutputs(node, order, bp?.links);
    const linkedIn = usedInputPorts(node.id, bp?.links || []);
    return `<article class="calc-node is-order ${missing ? "is-error" : ""} ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>${missing ? "Заказ удалён" : esc(order.number || "—")}</span>
        <button type="button" class="calc-mini calc-order-types" data-order-types="${esc(node.id)}" title="Суммы по типам" ${missing ? "disabled" : ""}>Σ</button>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <div class="calc-node-sub">${missing ? "" : esc(order.name || order.customer || "")}</div>
      <div class="calc-ports">
        ${ports
          .map((port) => {
            const value = graph.values[`${node.id}:${port.id}`];
            const tone = port.tone || "income";
            const child = port.child ? " is-child" : "";
            const fieldCls = port.child && port.field ? ` is-field-${port.field}` : "";
            const isType = port.kind === "type";
            if (port.child && port.hasInput && port.field && port.line) {
              const inId = lineInPortId(port.line.id, port.field);
              const owner = orderFieldOwner(node.orderId, port.line.id, port.field);
              const locked = !!owner && owner.node.id !== node.id;
              const linked = linkedIn.has(inId);
              const tip = locked
                ? `${orderFieldOwnerReason(owner, port.line, order, port.field)} · ПКМ — освободить`
                : `${esc(port.name)} · вход задаёт значение в заказе`;
              return `<div class="calc-row both is-${tone}${child}${fieldCls}${locked ? " is-locked" : ""}" title="${esc(tip)}">
              <i class="calc-port in ${locked ? "is-locked" : ""}" data-port="${esc(inId)}" data-io="in" data-line="${esc(port.line.id)}" data-field="${esc(port.field)}" data-order-lock="${locked ? "1" : ""}" title="${esc(tip)}"></i>
              <span class="calc-row-name" title="${esc(tip)}">${esc(port.name)}</span>
              <b>${esc(fmtShort(value))}</b>
              ${linked ? `<button type="button" class="calc-mini" data-del-in-link="${esc(inId)}" title="Удалить связь">×</button>` : ""}
              <i class="calc-port out" data-port="${esc(port.id)}" data-io="out" data-line="${esc(port.line.id)}" data-child="1" title="${esc(port.name)}"></i>
            </div>`;
            }
            const kindTip =
              tone === "tax" ? "Налог" : tone === "cost" ? "Затрата" : tone === "frozen" ? "Заморожено" : "";
            const tip = port.child
              ? esc(port.name)
              : isType
                ? `${esc(port.name)}${kindTip ? ` · ${kindTip}` : ""} · ПКМ — поля типа`
                : port.id === "total"
                  ? esc(port.name)
                  : `${esc(port.name)}${kindTip ? ` · ${kindTip}` : ""} · ПКМ — поля позиции`;
            return `<div class="calc-row out is-${tone}${child}${fieldCls}${isType ? " is-type-sum" : ""}">
              <span class="calc-row-name" title="${tip}">${esc(port.name)}</span>
              <b>${esc(fmtShort(value))}</b>
              <i class="calc-port out" data-port="${esc(port.id)}" data-io="out" data-line="${esc(port.line?.id || "")}" data-type="${esc(port.typeName || "")}" data-child="${port.child ? "1" : "0"}" title="${tip}"></i>
            </div>`;
          })
          .join("")}
      </div>
    </article>`;
  }

  function mathNodeHtml(node, bp, graph) {
    const ports = nodeInputs(node, bp.links);
    const linked = usedInputPorts(node.id, bp.links);
    const value = graph.values[`${node.id}:out`];
    return `<article class="calc-node is-math ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>Оператор</span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <div class="calc-ops">
        ${OPS.map((op) => `<button type="button" class="calc-op ${node.op === op.id ? "on" : ""}" data-op="${op.id}">${op.label}</button>`).join("")}
      </div>
      ${screenHtml(value, "Выход")}
      <div class="calc-ports">
        ${ports
          .map(
            (port) => `<div class="calc-row in">
              <i class="calc-port in" data-port="${esc(port.id)}" data-io="in"></i>
              <span>вход ${esc(port.name)}</span>
              ${linked.has(port.id) ? `<button type="button" class="calc-mini" data-del-in-link="${esc(port.id)}" title="Удалить связь">×</button>` : ""}
            </div>`
          )
          .join("")}
        <div class="calc-row out">
          <span>выход</span>
          <i class="calc-port out" data-port="out" data-io="out"></i>
        </div>
      </div>
    </article>`;
  }

  const LS_FORMULA_PROFILES = "finmaster.formulaProfiles";
  let formulaProfilesMem = null;
  let formulaProfileNodeId = "";

  function loadFormulaProfiles() {
    if (formulaProfilesMem) return formulaProfilesMem;
    const fromApi = api?.formulaProfiles?.();
    const raw = Array.isArray(fromApi) ? fromApi : [];
    const cleaned = raw
      .map((item) => {
        const name = String(item?.name || "").trim().replace(/\s+/g, " ").slice(0, 40);
        const inputs = (Array.isArray(item?.inputs) ? item.inputs : [])
          .map((letter) => String(letter || "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1))
          .filter(Boolean)
          .slice(0, 26);
        const outputs = (Array.isArray(item?.outputs) ? item.outputs : [])
          .map((out) => ({
            name: String(out?.name || "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1),
            expr: String(out?.expr || "0").slice(0, 200),
          }))
          .filter((out) => out.name)
          .slice(0, MATH_MAX);
        if (!name || !inputs.length || !outputs.length) return null;
        return { name, inputs, outputs };
      })
      .filter(Boolean)
      .slice(0, 40);
    formulaProfilesMem = cleaned;
    return cleaned;
  }

  function storeFormulaProfiles(list) {
    formulaProfilesMem = list.slice();
    try {
      localStorage.setItem(LS_FORMULA_PROFILES, JSON.stringify(formulaProfilesMem));
    } catch {
      /* ignore */
    }
    api?.saveFormulaProfiles?.(formulaProfilesMem);
  }

  function formulaSnapshot(node) {
    return {
      inputs: (node.inputs || []).map((port) => String(port.name || "").trim()),
      outputs: (node.outputs || []).map((port) => ({
        name: String(port.name || "").trim(),
        expr: String(port.expr || "0"),
      })),
    };
  }

  function formulaProfileKey(profile) {
    return JSON.stringify({
      inputs: profile.inputs,
      outputs: profile.outputs.map((out) => ({ name: out.name, expr: out.expr })),
    });
  }

  function formulaProfilesHtml(node) {
    const list = loadFormulaProfiles();
    const current = formulaProfileKey(formulaSnapshot(node));
    const selected = list.findIndex((profile) => formulaProfileKey(profile) === current);
    const empty = !list.length;
    const options = empty
      ? `<option value="">Создайте профиль</option>`
      : `<option value="" hidden ${selected < 0 ? "selected" : ""}></option>${list
          .map(
            (profile, i) =>
              `<option value="${i}" ${i === selected ? "selected" : ""}>${esc(profile.name)}</option>`
          )
          .join("")}`;
    return `<div class="calc-fprof">
      <select data-formula-profile aria-label="Профили формулы" title="${empty ? "Профилей пока нет. Создайте новый кнопкой +" : "Подставить сохранённую формулу"}"${empty ? " disabled" : ""}>
        ${options}
      </select>
      <button type="button" class="calc-mini" data-formula-profile-save title="Сохранить текущую формулу как профиль">+</button>
      <button type="button" class="calc-mini" data-formula-profile-del title="Удалить профили">×</button>
    </div>`;
  }

  function applyFormulaProfile(node, bp, profile) {
    const oldIn = new Set((node.inputs || []).map((port) => port.id));
    const oldOut = new Set((node.outputs || []).map((port) => port.id));
    bp.links = (bp.links || []).filter((link) => {
      if (link.to === node.id && oldIn.has(link.toPort)) return false;
      if (link.from === node.id && oldOut.has(link.fromPort)) return false;
      return true;
    });
    const used = new Set();
    const take = (raw) => {
      let letter = String(raw || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z]/g, "")
        .slice(0, 1);
      if (!letter || used.has(letter)) letter = nextLetter(used) || "A";
      used.add(letter);
      return letter;
    };
    node.inputs = profile.inputs.slice(0, 26).map((name) => ({ id: uid(), name: take(name) }));
    if (!node.inputs.length) node.inputs = [{ id: uid(), name: take("A") }];
    node.outputs = profile.outputs.slice(0, MATH_MAX).map((out) => ({
      id: uid(),
      name: take(out.name),
      expr: String(out.expr || "0").slice(0, 200),
    }));
    if (!node.outputs.length) node.outputs = [{ id: uid(), name: take("C"), expr: "0" }];
  }

  function openFormulaProfileSave(node) {
    formulaProfileNodeId = node.id;
    const modal = $("formula-profile-modal");
    const input = $("formula-profile-name");
    if (!modal || !input) return;
    input.value = "";
    modal.classList.add("open");
    setTimeout(() => input.focus(), 30);
  }

  function closeFormulaProfileSave() {
    $("formula-profile-modal")?.classList.remove("open");
    formulaProfileNodeId = "";
  }

  function commitFormulaProfileSave() {
    const node = formulaNode(formulaProfileNodeId);
    const input = $("formula-profile-name");
    const name = String(input?.value || "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (!node) {
      closeFormulaProfileSave();
      return;
    }
    if (!name) {
      api?.toast?.("Введите название профиля");
      input?.focus();
      return;
    }
    const list = loadFormulaProfiles().slice();
    const key = name.toLocaleLowerCase("ru");
    const idx = list.findIndex((profile) => profile.name.toLocaleLowerCase("ru") === key);
    const entry = { name, ...formulaSnapshot(node) };
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
    storeFormulaProfiles(list);
    closeFormulaProfileSave();
    render();
    api?.toast?.(idx >= 0 ? `Профиль «${name}» обновлён` : `Профиль «${name}» сохранён`);
  }

  function openFormulaProfileDelete() {
    const modal = $("formula-profile-del-modal");
    const box = $("formula-profile-del-list");
    if (!modal || !box) return;
    const list = loadFormulaProfiles();
    box.innerHTML = list.length
      ? list
          .map(
            (profile, i) =>
              `<label class="formula-profile-pick"><input type="checkbox" data-formula-del="${i}" /> <span>${esc(profile.name)}</span></label>`
          )
          .join("")
      : `<p class="formula-profile-empty">Сохранённых профилей пока нет.</p>`;
    const ok = $("formula-profile-del-ok");
    if (ok) ok.disabled = !list.length;
    modal.classList.add("open");
  }

  function closeFormulaProfileDelete() {
    $("formula-profile-del-modal")?.classList.remove("open");
  }

  async function commitFormulaProfileDelete() {
    const picked = [...document.querySelectorAll("#formula-profile-del-list [data-formula-del]:checked")].map((el) =>
      Number(el.dataset.formulaDel)
    );
    if (!picked.length) {
      api?.toast?.("Отметьте профили, которые нужно удалить");
      return;
    }
    const list = loadFormulaProfiles();
    const names = picked.map((i) => list[i]?.name).filter(Boolean);
    const ok = api?.askConfirm
      ? await api.askConfirm({
          title: names.length === 1 ? "Удалить профиль?" : "Удалить профили?",
          text:
            names.length === 1
              ? `Профиль «${names[0]}» будет удалён. Текущая формула не изменится.`
              : `Будут удалены: ${names.map((name) => `«${name}»`).join(", ")}. Текущая формула не изменится.`,
          ok: "Удалить",
          danger: true,
        })
      : false;
    if (!ok) return;
    const drop = new Set(picked);
    storeFormulaProfiles(list.filter((_, i) => !drop.has(i)));
    closeFormulaProfileDelete();
    render();
    api?.toast?.(names.length === 1 ? `Профиль «${names[0]}» удалён` : `Удалено профилей: ${names.length}`);
  }

  function bindFormulaProfileModals() {
    $("formula-profile-cancel")?.addEventListener("click", closeFormulaProfileSave);
    $("formula-profile-ok")?.addEventListener("click", commitFormulaProfileSave);
    $("formula-profile-name")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitFormulaProfileSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeFormulaProfileSave();
      }
    });
    $("formula-profile-modal")?.addEventListener("click", (e) => {
      if (e.target === $("formula-profile-modal")) closeFormulaProfileSave();
    });
    $("formula-profile-del-cancel")?.addEventListener("click", closeFormulaProfileDelete);
    $("formula-profile-del-ok")?.addEventListener("click", () => {
      commitFormulaProfileDelete();
    });
    $("formula-profile-del-modal")?.addEventListener("click", (e) => {
      if (e.target === $("formula-profile-del-modal")) closeFormulaProfileDelete();
    });
  }

  function formulaNodeHtml(node, bp, graph) {
    const bad = graph.errors.has(node.id);
    const linked = usedInputPorts(node.id, bp.links);
    return `<article class="calc-node is-formula ${bad ? "is-error" : ""} ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>Формула</span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      ${formulaProfilesHtml(node)}
      <div class="calc-ports">
        <div class="calc-sec">Входы</div>
        ${(node.inputs || [])
          .map(
            (port) => `<div class="calc-row in">
              <i class="calc-port in" data-port="${esc(port.id)}" data-io="in"></i>
              <input class="calc-pname" data-in-name="${esc(port.id)}" value="${esc(port.name)}" maxlength="1" spellcheck="false" title="Одна заглавная латинская буква" />
              ${linked.has(port.id) ? `<button type="button" class="calc-mini" data-del-in-link="${esc(port.id)}" title="Удалить связь">×</button>` : ""}
              <button type="button" class="calc-mini" data-del-in="${esc(port.id)}" title="Убрать вход">−</button>
            </div>`
          )
          .join("")}
        <button type="button" class="btn small calc-add" data-add-in="1">+ вход</button>
        <div class="calc-sec">Выходы</div>
        ${(node.outputs || [])
          .map((port) => {
            const value = graph.values[`${node.id}:${port.id}`];
            const expr = String(port.expr || "").includes("=") ? splitAssign(port.expr).expr : port.expr || "";
            return `<div class="calc-row out formula">
              <input class="calc-expr" data-out-expr="${esc(port.id)}" value="${esc(expr)}" spellcheck="false" />
              <span class="calc-eq">=</span>
              <input class="calc-pname" data-out-name="${esc(port.id)}" value="${esc(port.name)}" maxlength="1" spellcheck="false" title="Одна заглавная латинская буква" />
              <b class="calc-out-val">${esc(fmtShort(value))}</b>
              <i class="calc-port out" data-port="${esc(port.id)}" data-io="out"></i>
              <button type="button" class="calc-mini" data-del-out="${esc(port.id)}" title="Убрать выход">−</button>
            </div>`;
          })
          .join("")}
        <button type="button" class="btn small calc-add" data-add-out="1">+ выход</button>
      </div>
    </article>`;
  }

  function constNodeHtml(node, graph) {
    const value = graph.values[`${node.id}:out`];
    const raw = Number.isFinite(Number(node.value)) ? String(node.value) : "0";
    return `<article class="calc-node is-const ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>Константа</span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <input class="calc-const-val" data-const-value="${esc(node.id)}" value="${esc(raw)}" inputmode="decimal" spellcheck="false" title="Число" />
      <textarea class="calc-const-note" data-const-note="${esc(node.id)}" rows="1" maxlength="500" placeholder="Комментарий…" title="Комментарий: что это за число и откуда оно">${esc(node.note || "")}</textarea>
      <div class="calc-ports">
        <div class="calc-row out">
          <span>${esc(fmtShort(value))}</span>
          <i class="calc-port out" data-port="out" data-io="out" title="Выход"></i>
        </div>
      </div>
    </article>`;
  }

  function resultNodeHtml(node, bp, graph) {
    const value = graph.values[`${node.id}:out`];
    const linked = usedInputPorts(node.id, bp.links);
    const prio = Number.isFinite(Number(node.priority)) ? Number(node.priority) : nextResultPriority(bp);
    const shown = resultVisible(node);
    return `<article class="calc-node is-result ${shown ? "" : "is-scheme-off"} ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <input class="calc-result-prio" data-result-prio="${esc(node.id)}" type="number" min="0" max="9999" step="1" value="${prio}" title="Приоритет на схеме (меньше — выше)" aria-label="Приоритет" />
        <input class="calc-pname calc-result-name" data-result-name="${esc(node.id)}" value="${esc(resultName(node))}" maxlength="48" spellcheck="false" title="Имя результата" />
        <button type="button" class="calc-eye ${shown ? "" : "is-off"}" data-result-eye="${esc(node.id)}" title="${shown ? "Скрыть из ноды схемы" : "Показать в ноде схемы"}" aria-label="${shown ? "Скрыть из ноды схемы" : "Показать в ноде схемы"}" aria-pressed="${shown ? "true" : "false"}">${resultEyeIcon(shown)}</button>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      ${screenHtml(value, "Значение связи")}
      <div class="calc-ports">
        <div class="calc-row in">
          <i class="calc-port in" data-port="in" data-io="in"></i>
          <span>вход</span>
          ${linked.has("in") ? `<button type="button" class="calc-mini" data-del-in-link="in" title="Удалить связь">×</button>` : ""}
        </div>
        <div class="calc-row out">
          <span>выход</span>
          <i class="calc-port out" data-port="out" data-io="out" title="Выход"></i>
        </div>
      </div>
    </article>`;
  }

  function percentNodeHtml(node, bp, graph) {
    const value = graph.values[`${node.id}:out`];
    const linked = usedInputPorts(node.id, bp.links);
    return `<article class="calc-node is-percent ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>Процент</span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      ${screenHtml(value, "Число × % / 100")}
      <div class="calc-ports">
        ${nodeInputs(node)
          .map(
            (port) => `<div class="calc-row in">
              <i class="calc-port in" data-port="${esc(port.id)}" data-io="in" title="Вход"></i>
              <span>${esc(port.name)}</span>
              ${linked.has(port.id) ? `<button type="button" class="calc-mini" data-del-in-link="${esc(port.id)}" title="Удалить связь">×</button>` : ""}
            </div>`
          )
          .join("")}
        <div class="calc-row out">
          <span>выход</span>
          <i class="calc-port out" data-port="out" data-io="out" title="Выход"></i>
        </div>
      </div>
    </article>`;
  }

  function schemeNodeHtml(node, graph) {
    const other = findBlueprint(node.blueprintId);
    const missing = !other;
    const ports = nodeOutputs(node);
    return `<article class="calc-node is-scheme ${missing ? "is-error" : ""} ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>${missing ? "Схема удалена" : esc(other.name || "Схема")}</span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <div class="calc-ports">
        ${
          ports.length
            ? ports
                .map((port) => {
                  const value = graph.values[`${node.id}:${port.id}`];
                  return `<div class="calc-row">
                    <span class="calc-row-name" title="${esc(port.name)}">${esc(port.name)}</span>
                    <b>${esc(fmtShort(value))}</b>
                    <i class="calc-port out" data-port="${esc(port.id)}" data-io="out" title="Выход"></i>
                  </div>`;
                })
                .join("")
            : `<div class="calc-empty">Нет нод «Результат»</div>`
        }
      </div>
    </article>`;
  }

  function groupNodeHtml(node, zIndex) {
    const w = Math.max(160, node.w || 320);
    const h = Math.max(120, node.h || 220);
    const color = String(node.color || "#14b8a6");
    const z = Number.isFinite(zIndex) ? zIndex : 0;
    return `<article class="calc-node is-group ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px;width:${w}px;height:${h}px;z-index:${z};--group-color:${esc(color)}"></article>`;
  }

  function groupChromeHtml(node, zIndex) {
    const w = Math.max(160, node.w || 320);
    const h = Math.max(120, node.h || 220);
    const color = String(node.color || "#14b8a6");
    const name = String(node.name || "").trim() || "Группа";
    const z = Number.isFinite(zIndex) ? zIndex : 0;
    return `<div class="calc-group-chrome ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px;width:${w}px;height:${h}px;z-index:${z};--group-color:${esc(color)}">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить группу · Shift — только рамка"></i>
      <header class="calc-node-h calc-group-h">
        <input class="calc-pname calc-group-name" data-group-name="${esc(node.id)}" value="${esc(name)}" maxlength="48" spellcheck="false" title="Имя группы" />
        <input class="calc-group-color" data-group-color="${esc(node.id)}" type="color" value="${esc(color)}" title="Цвет группы" />
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <i class="calc-resize" data-resize-group="${esc(node.id)}" title="Изменить размер"></i>
    </div>`;
  }

  function filterNodeHtml(node, graph) {
    return `<article class="calc-node is-filter ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>Фильтр</span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      ${filterFieldsHtml(node)}
      <div class="calc-ports">
        ${statsPortsHtml(node, FILTER_PORTS, graph)}
      </div>
    </article>`;
  }

  function dashboardNodeHtml(node, bp, graph) {
    const ports = nodeOutputs(node, null, bp.links).map((port) => port.id);
    return `<article class="calc-node is-dashboard ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>Дашборд</span>
        <button type="button" class="calc-mini calc-dash-ports" data-dash-ports="${esc(node.id)}" title="Порты метрик">+</button>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      ${filterFieldsHtml(node)}
      <div class="calc-ports">
        ${statsPortsHtml(node, ports, graph, "ПКМ / + — выбрать порты")}
      </div>
    </article>`;
  }

  function presentNodeHtml(node, bp, graph) {
    const found = window.FinPresent?.findBlock?.(node.blockId);
    const title = found?.block?.title || node.title || "Блок";
    const pageName = found?.page?.name || "Страница";
    const meta = window.FinPresent?.blockMeta?.(node.blockType || found?.block?.type || "metric");
    const linked = usedInputPorts(node.id, bp.links);
    const ports = presentPorts(node);
    return `<article class="calc-node is-present ${session.selected === node.id ? "is-on" : ""} ${session.presentHover && session.presentHover === node.blockId ? "is-present-hl" : ""}" data-node="${esc(node.id)}" data-present-block-id="${esc(node.blockId || "")}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span title="${esc(pageName)} · ${esc(title)}"><span class="pres-tool-ico" aria-hidden="true">${esc(meta?.ico || "▣")}</span><span class="pres-tool-name">${esc(title)}</span></span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <div class="calc-node-sub">${esc(pageName)} · ${esc(meta?.name || node.blockType || "")}</div>
      <div class="calc-ports">
        ${
          ports.length
            ? ports
                .map((port) => {
                  const value = graph.values[`${node.id}:${port.id}`];
                  const owner = presentOwner(node.blockId, port.id, bp.id);
                  const locked = !!owner && !linked.has(port.id);
                  const tip = locked
                    ? `Занято схемой «${owner.blueprint.name || "Схема"}». ПКМ — освободить.`
                    : port.name;
                  return `<div class="calc-row in ${locked ? "is-locked" : ""}" title="${esc(tip)}">
                    <i class="calc-port in ${locked ? "is-locked" : ""}" data-port="${esc(port.id)}" data-io="in" data-present-lock="${locked ? "1" : ""}" title="${esc(tip)}"></i>
                    <span>${esc(port.name)}</span>
                    <b>${esc(fmtShort(value))}</b>
                    ${linked.has(port.id) ? `<button type="button" class="calc-mini" data-del-in-link="${esc(port.id)}" title="Удалить связь">×</button>` : ""}
                  </div>`;
                })
                .join("")
            : `<div class="calc-empty">Нет входов</div>`
        }
      </div>
    </article>`;
  }

  function fitScreenNodes() {
    const host = nodesRoot();
    if (!host) return;
    host.querySelectorAll(".calc-node.is-math, .calc-node.is-result, .calc-node.is-percent, .calc-node.is-const").forEach((el) => {
      el.style.width = "";
      const screen = el.querySelector(".calc-screen-val, .calc-const-val");
      if (!screen) return;
      const btn = el.querySelector(".calc-screen-copy");
      const pad = 16 + (btn ? btn.offsetWidth + 8 : 0);
      const need = Math.ceil(Math.max(screen.scrollWidth, screen.offsetWidth) + pad);
      const isResult = el.classList.contains("is-result");
      const minW = isResult ? 376 : 188;
      const maxW = isResult ? 1040 : 520;
      const width = Math.min(maxW, Math.max(minW, need));
      el.style.width = `${width}px`;
    });
  }

  function patchGraphLive() {
    const bp = activeBlueprint();
    if (!bp || session.busy) return;
    rebuildPresentValues();
    const graph = computeGraph(bp);
    flushOrderWrites();
    const host = nodesRoot();
    if (!host) return;
    host.querySelectorAll(".calc-node").forEach((el) => {
      const nodeId = el.dataset.node;
      if (!nodeId) return;
      el.querySelectorAll(".calc-out-val").forEach((box) => {
        const expr = box.closest(".calc-row")?.querySelector("[data-out-expr]");
        if (!expr) return;
        box.textContent = fmtShort(graph.values[`${nodeId}:${expr.dataset.outExpr}`]);
      });
      el.querySelectorAll(".calc-row.out > b:not(.calc-out-val), .calc-row.both > b:not(.calc-out-val), .calc-row.in > b:not(.calc-out-val)").forEach((box) => {
        const row = box.closest(".calc-row");
        if (!row) return;
        const outPort = row.querySelector(".calc-port.out");
        const inPort = row.querySelector(".calc-port.in");
        const portId = outPort?.dataset.port || inPort?.dataset.port;
        if (!portId) return;
        const value = graph.values[`${nodeId}:${portId}`];
        box.textContent = fmtShort(value);
      });
      el.querySelectorAll(".calc-row.out > span").forEach((box) => {
        if (box.classList.contains("calc-row-name")) return;
        const port = box.closest(".calc-row")?.querySelector(".calc-port.out");
        if (!port) return;
        box.textContent = fmtShort(graph.values[`${nodeId}:${port.dataset.port}`]);
      });
      const screen = el.querySelector(".calc-screen-val");
      if (screen) {
        const value = graph.values[`${nodeId}:out`];
        screen.textContent = fmtShort(value);
        const btn = el.querySelector(".calc-screen-copy");
        if (btn) {
          const copy = fmtCopy(value);
          btn.dataset.copy = copy || "";
          btn.classList.toggle("is-off", !copy);
          btn.disabled = !copy;
        }
      }
    });
    fitScreenNodes();
    requestAnimationFrame(() => {
      drawWires(bp, graph);
      drawMinimap(bp);
    });
  }

