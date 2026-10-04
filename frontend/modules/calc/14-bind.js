/* bundle-seam */
(() => {
  function bind() {
    if (session.bound) return;
    session.bound = true;
    bindFormulaProfileModals();
    const root = $("view-calculator");
    const board = $("calc-board");
    if (!root || !board) return;
    $("calc-tabs")?.addEventListener("pointerdown", (e) => {
      const calc = ensureState();
      if (!calc) return;
      const del = e.target.closest("[data-del-bp]");
      if (!del) return;
      e.preventDefault();
      e.stopPropagation();
      if (calc.blueprints.length < 2) return;
      const id = del.dataset.delBp;
      calc.blueprints.forEach((item) => {
        item.nodes = (item.nodes || []).filter((node) => !(node.type === "scheme" && node.blueprintId === id));
        const ids = new Set(item.nodes.map((node) => node.id));
        item.links = (item.links || []).filter((link) => ids.has(link.from) && ids.has(link.to));
      });
      calc.blueprints = calc.blueprints.filter((item) => item.id !== id);
      if (calc.active === id) calc.active = calc.blueprints[0].id;
      dirty();
      render();
    });
    $("calc-tabs")?.addEventListener("click", (e) => {
      if (e.target.closest("[data-del-bp]")) return;
      if (session.tabMoved) {
        session.tabMoved = false;
        return;
      }
      const calc = ensureState();
      const tab = e.target.closest("[data-bp]");
      if (!calc || !tab || tab.dataset.bp === calc.active) return;
      calc.active = tab.dataset.bp;
      dirty();
      render();
    });
    $("calc-tabs")?.addEventListener("dragstart", (e) => {
      const tab = e.target.closest("[data-bp]");
      if (!tab || e.target.closest("[data-del-bp]")) {
        e.preventDefault();
        return;
      }
      session.tabDrag = tab.dataset.bp || "";
      session.tabMoved = false;
      tab.classList.add("is-drag");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/finmaster-tab", session.tabDrag);
      e.dataTransfer.setData("text/plain", session.tabDrag);
    });
    $("calc-tabs")?.addEventListener("dragend", () => {
      session.tabDrag = "";
      $("calc-tabs")?.querySelectorAll(".calc-tab").forEach((el) => {
        el.classList.remove("is-drag", "is-drop-before", "is-drop-after");
      });
    });
    $("calc-tabs")?.addEventListener("dragover", (e) => {
      const dragId = session.tabDrag;
      if (!dragId) return;
      const tab = e.target.closest("[data-bp]");
      const host = $("calc-tabs");
      host?.querySelectorAll(".calc-tab").forEach((el) => el.classList.remove("is-drop-before", "is-drop-after"));
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (!tab || tab.dataset.bp === dragId) return;
      const rect = tab.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      tab.classList.add(after ? "is-drop-after" : "is-drop-before");
    });
    $("calc-tabs")?.addEventListener("drop", (e) => {
      const fromId = session.tabDrag || e.dataTransfer?.getData("text/finmaster-tab") || e.dataTransfer?.getData("text/plain");
      const tab = e.target.closest("[data-bp]");
      e.preventDefault();
      if (!fromId || !tab || tab.dataset.bp === fromId) return;
      const rect = tab.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      if (reorderBlueprint(fromId, tab.dataset.bp, after)) session.tabMoved = true;
      session.tabDrag = "";
    });
    root.querySelector(".calc-tabbar")?.addEventListener(
      "wheel",
      (e) => {
        const host = $("calc-tabs");
        if (!host) return;
        const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        if (!delta) return;
        e.preventDefault();
        host.scrollLeft += delta;
      },
      { passive: false }
    );
    root.addEventListener("click", (e) => {
      const eye = e.target.closest("[data-result-eye]");
      if (eye) {
        e.preventDefault();
        e.stopPropagation();
        const bp = activeBlueprint();
        const node = bp?.nodes.find((item) => item.id === eye.dataset.resultEye && item.type === "result");
        if (!node) return;
        node.visible = !resultVisible(node);
        if (!resultVisible(node)) pruneHiddenResultLinks(node.id);
        dirty();
        render();
        return;
      }
      if (!e.target.closest("[data-add-bp]")) return;
      const calc = ensureState();
      if (!calc) return;
      const bp = emptyBlueprint(`Схема ${calc.blueprints.length + 1}`);
      calc.blueprints.push(bp);
      calc.active = bp.id;
      dirty();
      render();
    });
    $("calc-refresh")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      recalculate();
    });
    $("calc-chain-move")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      session.moveChain = !session.moveChain;
      syncChainMoveBtn();
    });
    $("calc-prune")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const n = pruneOrphanNodes();
      const btn = $("calc-prune");
      if (btn) {
        btn.title = n ? `Убрано: ${n}` : "Нет нод без связей";
        clearTimeout(btn._pruneT);
        btn._pruneT = setTimeout(() => {
          btn.title = "Убрать ноды без связей";
        }, 1600);
      }
    });
    $("calc-present-btn")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePresentPanel();
    });
    document.addEventListener("click", (e) => {
      if (!session.presentPanel) return;
      if (e.target.closest("[data-close-present-panel]")) {
        togglePresentPanel(false);
        return;
      }
      const item = e.target.closest("[data-present-block]");
      if (item && item.closest("#calc-present-panel")) {
        addPresentNode(item.dataset.presentPage, item.dataset.presentBlock);
      }
    });
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (!session.filterMultiOpen && !nodesRoot()?.querySelector(".calc-multi[open]")) return;
        const hit = e.target.closest?.(".calc-multi, [data-filter-multi-clear]");
        if (hit) return;
        closeOpenFilterMultis();
      },
      true
    );
    document.addEventListener("dragstart", (e) => {
      const item = e.target.closest("[data-present-block]");
      if (!item || !item.closest("#calc-present-panel")) return;
      e.dataTransfer.setData("text/finmaster-present", item.dataset.presentBlock);
      e.dataTransfer.setData("text/finmaster-present-page", item.dataset.presentPage || "");
      e.dataTransfer.effectAllowed = "copy";
    });
    syncChainMoveBtn();
    syncMiniToggle();
    $("calc-mini-toggle")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      session.miniHidden = !session.miniHidden;
      syncMiniToggle();
      const bp = activeBlueprint();
      if (bp && !session.miniHidden) drawMinimap(bp);
    });
    $("calc-bp-name")?.addEventListener("input", (e) => {
      const bp = activeBlueprint();
      if (!bp) return;
      bp.name = String(e.target.value || "").slice(0, 48);
      const label = $("calc-tabs")?.querySelector(".calc-tab.active .calc-tab-label");
      if (label) label.textContent = bp.name || "Схема";
      dirty();
    });
    $("calc-bp-name")?.addEventListener("focusout", (e) => {
      const bp = activeBlueprint();
      if (!bp) return;
      bp.name = String(e.target.value || "").trim().slice(0, 48) || "Схема";
      e.target.value = bp.name;
      dirty();
      render();
    });
    $("calc-bp-name")?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      e.target.blur();
    });
    $("calc-side")?.addEventListener("input", (e) => {
      if (e.target.id !== "calc-order-search") return;
      session.search = e.target.value;
      const start = e.target.selectionStart;
      const end = e.target.selectionEnd;
      const list = document.querySelector("#calc-side .calc-order-list");
      const listScroll = list?.scrollTop || 0;
      const sideScroll = $("calc-side")?.scrollTop || 0;
      renderSide(activeBlueprint());
      const input = $("calc-order-search");
      if (input) {
        input.focus({ preventScroll: true });
        try {
          input.setSelectionRange(start ?? input.value.length, end ?? input.value.length);
        } catch {
          /* ignore */
        }
      }
      const side = $("calc-side");
      if (side) side.scrollTop = sideScroll;
      const nextList = document.querySelector("#calc-side .calc-order-list");
      if (nextList) nextList.scrollTop = listScroll;
    });
    $("calc-side")?.addEventListener("click", (e) => {
      const clear = e.target.closest("[data-search-clear]");
      if (clear) {
        e.preventDefault();
        e.stopPropagation();
        session.search = "";
        renderSide(activeBlueprint());
        $("calc-order-search")?.focus();
        return;
      }
      const add = e.target.closest("[data-add-node]");
      if (add) {
        addNode(add.dataset.addNode);
        return;
      }
      const scheme = e.target.closest("[data-blueprint]");
      if (scheme) {
        addNode("scheme", null, { blueprintId: scheme.dataset.blueprint });
        return;
      }
      const order = e.target.closest("[data-order]");
      if (order) addNode("order", null, { orderId: order.dataset.order });
      const summary = e.target.closest("details.calc-fold > summary");
      if (summary) {
        const fold = summary.parentElement;
        if (fold instanceof HTMLDetailsElement && fold.dataset.fold) {
          requestAnimationFrame(() => setFold(fold.dataset.fold, fold.open));
        }
      }
    });
    $("calc-side")?.addEventListener(
      "toggle",
      (e) => {
        const fold = e.target;
        if (!(fold instanceof HTMLDetailsElement)) return;
        if (!fold.matches("details.calc-fold[data-fold]")) return;
        setFold(fold.dataset.fold, fold.open);
      },
      true
    );
    $("calc-side")?.addEventListener("dragstart", (e) => {
      const order = e.target.closest("[data-order]");
      const tool = e.target.closest("[data-add-node]");
      const scheme = e.target.closest("[data-blueprint]");
      if (order) {
        e.dataTransfer.setData("text/finmaster-order", order.dataset.order);
        e.dataTransfer.setData("text/plain", order.dataset.order);
        e.dataTransfer.effectAllowed = "copy";
      } else if (tool) {
        e.dataTransfer.setData("text/finmaster-node", tool.dataset.addNode);
        e.dataTransfer.effectAllowed = "copy";
      } else if (scheme) {
        e.dataTransfer.setData("text/finmaster-blueprint", scheme.dataset.blueprint);
        e.dataTransfer.effectAllowed = "copy";
      }
    });
    board.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    board.addEventListener("drop", onDrop);
    board.addEventListener("scroll", () => {
      board.scrollTop = 0;
      board.scrollLeft = 0;
    });
    board.addEventListener("pointerdown", onBoardPointerDown);
    board.addEventListener("pointermove", onBoardPointerMove);
    board.addEventListener("pointerup", onBoardPointerUp);
    board.addEventListener("pointercancel", onBoardPointerUp);
    board.addEventListener("auxclick", (e) => {
      if (e.button === 1) e.preventDefault();
    });
    board.addEventListener("contextmenu", (e) => {
      if (e.target.closest(".calc-port, .calc-port-menu")) e.preventDefault();
    });
    board.addEventListener("wheel", onBoardWheel, { passive: false });
    const mini = $("calc-minimap");
    mini?.addEventListener("pointerdown", (e) => {
      if (session.miniHidden) return;
      e.preventDefault();
      e.stopPropagation();
      const bp = activeBlueprint();
      const at = miniWorldPoint(e.clientX, e.clientY);
      if (!bp || !at) return;
      session.miniDrag = true;
      session.busy = true;
      centerViewOn(bp, at.x, at.y);
      mini.setPointerCapture(e.pointerId);
    });
    mini?.addEventListener("pointermove", (e) => {
      if (!session.miniDrag || session.miniHidden) return;
      const bp = activeBlueprint();
      const at = miniWorldPoint(e.clientX, e.clientY);
      if (!bp || !at) return;
      centerViewOn(bp, at.x, at.y);
    });
    mini?.addEventListener("pointerup", () => {
      if (!session.miniDrag) return;
      session.miniDrag = null;
      session.busy = false;
      dirty();
    });
    mini?.addEventListener("pointercancel", () => {
      session.miniDrag = null;
      session.busy = false;
    });
    board.addEventListener("click", async (e) => {
      const btn = e.target.closest(".calc-screen-copy");
      if (!btn || !board.contains(btn) || btn.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      const text = btn.dataset.copy || "";
      if (!(await copyScreenText(text))) return;
      const screen = btn.closest(".calc-screen");
      btn.classList.add("is-copied");
      screen?.classList.add("is-copied");
      btn.title = "Скопировано";
      clearTimeout(btn._copyT);
      btn._copyT = setTimeout(() => {
        btn.classList.remove("is-copied");
        screen?.classList.remove("is-copied");
        btn.title = "Копировать";
      }, 1400);
    });
    root.addEventListener("click", (e) => {
      const clearMulti = e.target.closest("[data-filter-multi-clear]");
      if (clearMulti) {
        e.preventDefault();
        e.stopPropagation();
        const nodeEl = clearMulti.closest(".calc-node");
        const bp = activeBlueprint();
        const node = nodeEl && bp ? bp.nodes.find((item) => item.id === nodeEl.dataset.node) : null;
        const field = clearMulti.dataset.filterMultiClear || "";
        const allowed = new Set(["customers", "orderIds", "payFilters", "orderTypes", "products", "statuses"]);
        if (!node || !allowed.has(field) || (node.type !== "filter" && node.type !== "dashboard")) return;
        node[field] = [];
        if (field === "customers") {
          /* keep orderIds — user can clear orders separately */
        }
        normalizeFilterNode(node);
        if (session.filterMultiOpen?.nodeId === node.id && session.filterMultiOpen?.field === field) {
          session.filterMultiOpen = null;
          session.filterMultiScroll = 0;
        }
        session.selected = node.id;
        dirty();
        render();
        return;
      }
      const nodeEl = e.target.closest(".calc-node");
      const bp = activeBlueprint();
      if (e.target.closest("[data-del-node]")) {
        removeNode(e.target.closest("[data-del-node]").dataset.delNode);
        return;
      }
      const dropLink = e.target.closest("[data-del-link]");
      if (dropLink) {
        removeLink(dropLink.dataset.delLink);
        return;
      }
      const dropIn = e.target.closest("[data-del-in-link]");
      if (dropIn) {
        disconnectInput(dropIn.closest(".calc-node")?.dataset.node, dropIn.dataset.delInLink);
        return;
      }
      if (!bp || !nodeEl) return;
      const node = bp.nodes.find((item) => item.id === nodeEl.dataset.node);
      if (!node) return;
      session.selected = node.id;
      const op = e.target.closest("[data-op]");
      if (op && node.type === "math") {
        node.op = op.dataset.op;
        dirty();
        render();
        return;
      }
      if (e.target.closest("[data-formula-profile-save]") && node.type === "formula") {
        openFormulaProfileSave(node);
        return;
      }
      if (e.target.closest("[data-formula-profile-del]") && node.type === "formula") {
        openFormulaProfileDelete();
        return;
      }
      if (e.target.closest("[data-add-in]") && node.type === "formula") {
        if ((node.inputs || []).length >= 26) return;
        const used = formulaLetterSet(node);
        const name = nextLetter(used);
        if (!name) return;
        node.inputs.push({ id: uid(), name });
        dirty();
        render();
        return;
      }
      if (e.target.closest("[data-add-out]") && node.type === "formula") {
        if ((node.outputs || []).length >= MATH_MAX) return;
        const used = formulaLetterSet(node);
        const name = nextLetter(used);
        if (!name) return;
        node.outputs.push({ id: uid(), name, expr: "0" });
        dirty();
        render();
        return;
      }
      if (e.target.closest("[data-del-in]") && node.type === "formula") {
        const id = e.target.closest("[data-del-in]").dataset.delIn;
        if ((node.inputs || []).length <= 1) return;
        node.inputs = node.inputs.filter((port) => port.id !== id);
        bp.links = bp.links.filter((link) => !(link.to === node.id && link.toPort === id));
        dirty();
        render();
        return;
      }
      if (e.target.closest("[data-del-out]") && node.type === "formula") {
        const id = e.target.closest("[data-del-out]").dataset.delOut;
        if ((node.outputs || []).length <= 1) return;
        node.outputs = node.outputs.filter((port) => port.id !== id);
        bp.links = bp.links.filter((link) => !(link.from === node.id && link.fromPort === id));
        dirty();
        render();
        return;
      }
      const dashPorts = e.target.closest("[data-dash-ports]");
      if (dashPorts && node.type === "dashboard") {
        showDashPortMenu(e.clientX, e.clientY, node.id);
        return;
      }
      const orderTypes = e.target.closest("[data-order-types]");
      if (orderTypes && node.type === "order") {
        showOrderTypeMenu(e.clientX, e.clientY, node.id);
      }
    });
    root.addEventListener("input", (e) => {
      if (e.target.dataset?.groupColor) {
        const nodeEl = e.target.closest("[data-node]");
        const bp = activeBlueprint();
        const node = nodeEl && bp ? bp.nodes.find((item) => item.id === nodeEl.dataset.node) : null;
        if (node?.type === "group") {
          node.color = String(e.target.value || "#14b8a6");
          const vis = groupsRoot()?.querySelector(`[data-node="${cssEsc(node.id)}"]`);
          const chrome = findGroupChrome(node.id);
          vis?.style.setProperty("--group-color", node.color);
          chrome?.style.setProperty("--group-color", node.color);
          drawMinimap(bp);
        }
        return;
      }
      const nodeEl = e.target.closest(".calc-node");
      const bp = activeBlueprint();
      const node = nodeEl && bp ? bp.nodes.find((item) => item.id === nodeEl.dataset.node) : null;
      if (!node || !bp) return;
      if (e.target.dataset?.constValue && node.type === "const") {
        const text = String(e.target.value || "").replace(",", ".").trim();
        if (text && text !== "-" && text !== "." && text !== "-.") {
          const value = Number(text);
          if (Number.isFinite(value)) node.value = value;
        } else if (!text) {
          node.value = 0;
        }
        dirty();
        patchGraphLive();
        return;
      }
      if (e.target.dataset?.constNote && node.type === "const") {
        node.note = String(e.target.value || "").slice(0, 500);
        dirty();
        return;
      }
      if (e.target.dataset?.outExpr && node.type === "formula") {
        const port = (node.outputs || []).find((item) => item.id === e.target.dataset.outExpr);
        if (port) port.expr = e.target.value;
        dirty();
        patchGraphLive();
      }
    });
    root.addEventListener("toggle", (e) => {
      if (session.filterMultiLock) return;
      const box = e.target;
      if (!(box instanceof HTMLDetailsElement) || !box.classList.contains("calc-multi")) return;
      const nodeEl = box.closest("[data-node]");
      const field = box.dataset.filterMultiField || "";
      const nodeId = nodeEl?.dataset?.node || "";
      if (!field || !nodeId) return;
      if (box.open) {
        session.filterMultiOpen = { nodeId, field };
        session.filterMultiLock = true;
        try {
          nodesRoot()?.querySelectorAll(".calc-multi[open]").forEach((el) => {
            if (el !== box) el.open = false;
          });
        } finally {
          session.filterMultiLock = false;
        }
      } else if (session.filterMultiOpen?.nodeId === nodeId && session.filterMultiOpen?.field === field) {
        session.filterMultiOpen = null;
        session.filterMultiScroll = 0;
      }
    }, true);
    root.addEventListener("change", (e) => {
      const nodeEl = e.target.closest(".calc-node, .calc-group-chrome");
      const bp = activeBlueprint();
      const node = nodeEl && bp ? bp.nodes.find((item) => item.id === nodeEl.dataset.node) : null;
      if (!node) return;
      if (e.target.dataset.resultName && node.type === "result") {
        node.name = String(e.target.value || "").trim().slice(0, 48) || "Результат";
        e.target.value = node.name;
        dirty();
        render();
        return;
      }
      if (e.target.dataset.resultPrio && node.type === "result") {
        const n = Math.round(Number(e.target.value));
        node.priority = Number.isFinite(n) ? Math.max(0, Math.min(9999, n)) : nextResultPriority(bp);
        e.target.value = String(node.priority);
        dirty();
        render();
        return;
      }
      if (e.target.dataset.groupName && node.type === "group") {
        node.name = String(e.target.value || "").trim().slice(0, 48) || "Группа";
        e.target.value = node.name;
        dirty();
        return;
      }
      if (e.target.dataset.groupColor && node.type === "group") {
        node.color = String(e.target.value || "#14b8a6");
        const vis = groupsRoot()?.querySelector(`[data-node="${cssEsc(node.id)}"]`);
        const chrome = findGroupChrome(node.id);
        vis?.style.setProperty("--group-color", node.color);
        chrome?.style.setProperty("--group-color", node.color);
        dirty();
        drawMinimap(bp);
        return;
      }
      if (e.target.dataset.constValue && node.type === "const") {
        node.value = parseConstValue(e.target.value);
        e.target.value = String(node.value);
        dirty();
        render();
        return;
      }
      if (e.target.dataset.filterField && (node.type === "filter" || node.type === "dashboard")) {
        const field = e.target.dataset.filterField;
        const raw = String(e.target.value || "").trim();
        if (field === "period") node.period = DASH_PERIODS.some(([id]) => id === raw) ? raw : "all";
        else if (field === "dateFrom") node.dateFrom = raw.slice(0, 10);
        else if (field === "dateTo") node.dateTo = raw.slice(0, 10);
        dirty();
        render();
        return;
      }
      if (e.target.dataset.filterMulti && (node.type === "filter" || node.type === "dashboard")) {
        const field = e.target.dataset.filterMulti;
        const box = e.target.closest(".calc-multi");
        const checked = [...(box?.querySelectorAll(`input[data-filter-multi="${cssEsc(field)}"]:checked`) || [])].map((el) =>
          String(el.value || "").trim()
        );
        const allowed = new Set(["customers", "orderIds", "payFilters", "orderTypes", "products", "statuses"]);
        if (!allowed.has(field)) return;
        node[field] = uniqueStrings(checked).slice(0, FILTER_MULTI_MAX);
        if (field === "customers") {
          const keys = new Set(node.customers.map((name) => name.toLowerCase()));
          if (keys.size) {
            node.orderIds = (node.orderIds || []).filter((id) => {
              const order = api.findOrder?.(id);
              return order && keys.has(String(order.customer || "").toLowerCase());
            });
          }
        }
        normalizeFilterNode(node);
        session.filterMultiOpen = { nodeId: node.id, field };
        const listEl = box?.querySelector(".calc-multi-list");
        if (listEl) session.filterMultiScroll = listEl.scrollTop;
        dirty();
        render();
        return;
      }
      if (node.type !== "formula") return;
      if (e.target.dataset.formulaProfile != null) {
        const raw = String(e.target.value || "");
        if (!raw) return;
        const profile = loadFormulaProfiles()[Number(raw)];
        if (!profile) return;
        applyFormulaProfile(node, bp, profile);
        dirty();
        render();
        api?.toast?.(`Профиль «${profile.name}»`);
        return;
      }
      if (e.target.dataset.inName) {
        const port = node.inputs.find((item) => item.id === e.target.dataset.inName);
        if (port) {
          const used = formulaLetterSet(node, port.id);
          port.name = sanitizeFormulaInput(e.target.value, used, port.name);
          e.target.value = port.name;
        }
      }
      if (e.target.dataset.outName) {
        const port = node.outputs.find((item) => item.id === e.target.dataset.outName);
        if (port) {
          const used = formulaLetterSet(node, port.id);
          port.name = sanitizeFormulaInput(e.target.value, used, port.name);
          e.target.value = port.name;
        }
      }
      if (e.target.dataset.outExpr) {
        const port = node.outputs.find((item) => item.id === e.target.dataset.outExpr);
        if (port) port.expr = e.target.value;
      }
      dirty();
      render();
    });
    root.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      if (e.target.matches(".calc-expr, .calc-pname, .calc-const-val, .calc-filter-input")) {
        e.preventDefault();
        e.target.blur();
      }
    });
    document.addEventListener("pointermove", (e) => {
      if (api?.view?.() !== "calculator" || !session.linking || session.drag || session.pan) return;
      const bp = activeBlueprint();
      if (!bp) return;
      const at = screenToWorld(e.clientX, e.clientY, bp);
      session.linking.x = at.x;
      session.linking.y = at.y;
      drawWires(bp, computeGraph(bp));
      const want = session.linking.reverse ? "out" : "in";
      nodesRoot()?.querySelectorAll(".calc-port").forEach((el) => el.classList.toggle("is-hot", false));
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".calc-port");
      if (over?.dataset.io === want) over.classList.add("is-hot");
    });
    document.addEventListener("keydown", (e) => {
      if (api?.view?.() !== "calculator") return;
      if (e.key === "Escape") {
        hidePortMenu();
        session.resize = null;
        let redraw = false;
        if (session.linking) {
          session.linking = null;
          setLinkingClass();
          redraw = true;
        }
        if (session.selectedLink) {
          session.selectedLink = "";
          redraw = true;
        }
        if (redraw) {
          const bp = activeBlueprint();
          if (bp) drawWires(bp, computeGraph(bp));
        }
        return;
      }
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === "KeyD" && session.selected) {
        e.preventDefault();
        duplicateNode(session.selected);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && session.selectedLink) {
        e.preventDefault();
        removeLink(session.selectedLink);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && session.selected) {
        e.preventDefault();
        removeNode(session.selected);
      }
    });
    window.addEventListener("resize", () => {
      if (api?.view?.() === "calculator") {
        const bp = activeBlueprint();
        if (bp) {
          drawWires(bp, computeGraph(bp));
          drawMinimap(bp);
        }
      }
    });
  }

  window.FinCalc = {
    bind(next) {
      api = next;
      bind();
    },
    render(next) {
      if (next) api = next;
      render();
    },
    presentValue(blockId, portId) {
      const key = `${blockId}:${portId}`;
      if (!presentValues.has(key)) return null;
      return presentValues.get(key);
    },
    syncPresentValues(next) {
      if (next) api = next;
      rebuildPresentValues();
    },
    refreshPresent() {
      renderPresentPanel();
    },
    hidePresentPanel() {
      hidePresentPanel();
    },
    removePresentBlock(blockId) {
      return removePresentBlockNodes(blockId);
    },
    orderFieldLocks() {
      try {
        return collectOrderFieldLocks();
      } catch (err) {
        console.warn("calc orderFieldLocks", err);
        return [];
      }
    },
    orderFieldLock(orderId, lineId, fieldOrExpr) {
      try {
        const locks = collectOrderFieldLocks();
        const field =
          fieldOrExpr === "qty_expr"
            ? "qty"
            : fieldOrExpr === "price_expr"
              ? "price"
              : fieldOrExpr === "discount_expr"
                ? "discount"
                : fieldOrExpr === "paid_expr"
                  ? "paid"
                  : fieldOrExpr === "tax_percent_expr"
                    ? "percent"
                    : fieldOrExpr;
        return (
          locks.find((item) => item.orderId === orderId && item.lineId === lineId && item.field === field) || null
        );
      } catch (err) {
        console.warn("calc orderFieldLock", err);
        return null;
      }
    },
    pruneOrderLinks(orderId, lineId) {
      return pruneOrderCalcLinks(orderId, lineId);
    },
  };
})();
