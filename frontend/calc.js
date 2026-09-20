(() => {
  "use strict";

  const MATH_MAX = 20;
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const OPS = [
    { id: "+", label: "+" },
    { id: "-", label: "−" },
    { id: "*", label: "×" },
    { id: "/", label: "÷" },
  ];

  let api = null;
  const session = {
    bound: false,
    busy: false,
    selected: "",
    linking: null,
    search: "",
    place: 0,
    connectAt: 0,
    tabDrag: "",
    tabMoved: false,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cssEsc(value) {
    const text = String(value ?? "");
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(text);
    return text.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function uid() {
    return api?.uid ? api.uid() : `id-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  }

  function ensureState() {
    const doc = api?.doc?.();
    if (!doc) return null;
    if (!doc.ui || typeof doc.ui !== "object") doc.ui = {};
    if (!doc.ui.calculator || typeof doc.ui.calculator !== "object") {
      doc.ui.calculator = { active: "", blueprints: [] };
    }
    const calc = doc.ui.calculator;
    if (!Array.isArray(calc.blueprints)) calc.blueprints = [];
    if (!calc.blueprints.length) {
      const first = emptyBlueprint("Схема 1");
      calc.blueprints.push(first);
      calc.active = first.id;
    }
    if (!calc.blueprints.some((bp) => bp.id === calc.active)) calc.active = calc.blueprints[0].id;
    return calc;
  }

  function emptyBlueprint(name) {
    return { id: uid(), name: name || "Схема", x: 0, y: 0, zoom: 1, nodes: [], links: [] };
  }

  function activeBlueprint() {
    const calc = ensureState();
    if (!calc) return null;
    return calc.blueprints.find((bp) => bp.id === calc.active) || calc.blueprints[0] || null;
  }

  function dirty() {
    api?.markDirty?.("Калькулятор");
  }

  function fmt(value) {
    if (value == null || !Number.isFinite(value)) return "—";
    return api?.money ? api.money(value) : String(value);
  }

  function fmtShort(value) {
    if (value == null || !Number.isFinite(value)) return "—";
    return Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  }

  function tokenize(src) {
    const text = String(src || "").replace(/,/g, ".").replace(/\s+/g, "");
    const tokens = [];
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if ("+-*/()=".includes(ch)) {
        tokens.push(ch);
        i += 1;
        continue;
      }
      if (/[0-9.]/.test(ch)) {
        let raw = "";
        while (i < text.length && /[0-9.]/.test(text[i])) raw += text[i++];
        const num = Number(raw);
        if (!Number.isFinite(num)) throw new Error("число");
        tokens.push({ n: num });
        continue;
      }
      if (/[A-Za-zА-Яа-я_]/.test(ch)) {
        let raw = "";
        while (i < text.length && /[A-Za-zА-Яа-я0-9_]/.test(text[i])) raw += text[i++];
        tokens.push({ id: raw });
        continue;
      }
      throw new Error("символ");
    }
    return tokens;
  }

  function splitAssign(src) {
    const text = String(src || "").trim();
    const eq = text.lastIndexOf("=");
    if (eq <= 0) return { expr: text, out: "" };
    return { expr: text.slice(0, eq).trim(), out: text.slice(eq + 1).trim() };
  }

  function evalExpr(src, vars) {
    const tokens = tokenize(src);
    let i = 0;
    const peek = () => tokens[i];
    const eat = (want) => {
      const tok = tokens[i];
      if (want && tok !== want) throw new Error("формула");
      i += 1;
      return tok;
    };
    function parsePrimary() {
      const tok = peek();
      if (!tok) throw new Error("формула");
      if (tok === "(") {
        eat("(");
        const value = parseAdd();
        eat(")");
        return value;
      }
      if (tok === "-") {
        eat("-");
        return -parsePrimary();
      }
      if (tok && typeof tok === "object" && "n" in tok) {
        eat();
        return tok.n;
      }
      if (tok && typeof tok === "object" && tok.id) {
        eat();
        const value = vars[tok.id];
        if (value == null || !Number.isFinite(value)) return 0;
        return value;
      }
      throw new Error("формула");
    }
    function parseMul() {
      let value = parsePrimary();
      while (peek() === "*" || peek() === "/") {
        const op = eat();
        const rhs = parsePrimary();
        value = op === "*" ? value * rhs : rhs === 0 ? NaN : value / rhs;
      }
      return value;
    }
    function parseAdd() {
      let value = parseMul();
      while (peek() === "+" || peek() === "-") {
        const op = eat();
        const rhs = parseMul();
        value = op === "+" ? value + rhs : value - rhs;
      }
      return value;
    }
    if (!tokens.length) return 0;
    const value = parseAdd();
    if (i !== tokens.length) throw new Error("формула");
    return value;
  }

  function mathShown(node, links) {
    const used = new Set((links || []).filter((link) => link.to === node.id).map((link) => link.toPort));
    let last = 0;
    for (let i = 1; i <= MATH_MAX; i += 1) {
      if (used.has(`in${i}`)) last = i;
    }
    if (!last) return 2;
    return Math.min(MATH_MAX, last < MATH_MAX ? last + 1 : MATH_MAX);
  }

  function orderLines(order) {
    if (!order) return [];
    return (order.lines || []).filter((line) => !api.isFrozen(line));
  }

  function lineAmount(line, order) {
    const totals = api.lineTotals(line, order);
    if (!totals) return 0;
    return totals.expense ? totals.cost : totals.after;
  }

  function findBlueprint(id) {
    return (ensureState()?.blueprints || []).find((bp) => bp.id === id) || null;
  }

  function resultName(node) {
    return String(node?.name || "").trim() || "Результат";
  }

  function schemeOutputs(bp) {
    return (bp?.nodes || [])
      .filter((node) => node.type === "result")
      .map((node) => ({
        id: `result:${node.id}`,
        name: resultName(node),
        resultId: node.id,
      }));
  }

  function nodeInputs(node, links) {
    if (node.type === "math") {
      const n = mathShown(node, links);
      return Array.from({ length: n }, (_, i) => ({ id: `in${i + 1}`, name: String(i + 1) }));
    }
    if (node.type === "result") return [{ id: "in", name: "вход" }];
    if (node.type === "percent") return [
      { id: "in1", name: "число" },
      { id: "in2", name: "%" },
    ];
    if (node.type === "formula") return node.inputs || [];
    return [];
  }

  function nodeOutputs(node, order) {
    if (node.type === "math" || node.type === "result" || node.type === "percent" || node.type === "const") return [{ id: "out", name: "out" }];
    if (node.type === "formula") return node.outputs || [];
    if (node.type === "scheme") return schemeOutputs(findBlueprint(node.blueprintId));
    if (node.type === "order") {
      const lines = orderLines(order);
      const ports = lines.map((line) => ({
        id: `line:${line.id}`,
        name: line.product || "Позиция",
        line,
      }));
      ports.push({ id: "total", name: "Итого" });
      return ports;
    }
    return [];
  }

  function formulaConflict(node) {
    const names = new Set();
    const assigns = new Map();
    let error = false;
    for (const port of node.inputs || []) {
      const name = String(port.name || "").trim();
      if (!/^[A-Z]$/.test(name) || names.has(name)) error = true;
      names.add(name);
    }
    for (const port of node.outputs || []) {
      const parsed = splitAssign(port.expr ? (String(port.expr).includes("=") ? port.expr : `${port.expr}=${port.name}`) : port.name);
      const outName = parsed.out || String(port.name || "").trim();
      const expr = parsed.expr.replace(/\s+/g, "");
      if (!outName) error = true;
      if (names.has(outName) && (node.inputs || []).some((item) => item.name === outName)) error = true;
      if (assigns.has(outName) && assigns.get(outName) !== expr) error = true;
      if (parsed.out && port.name && parsed.out !== String(port.name).trim()) error = true;
      assigns.set(outName, expr);
      try {
        evalExpr(parsed.expr || "0", {});
      } catch {
        error = true;
      }
    }
    const outNames = (node.outputs || []).map((port) => String(port.name || "").trim());
    if (new Set(outNames).size !== outNames.length) error = true;
    return error;
  }

  function computeGraph(bp, stack) {
    const values = {};
    const errors = new Set();
    const nodes = bp.nodes || [];
    const links = bp.links || [];
    if ((stack || []).includes(bp.id)) {
      nodes.forEach((node) => errors.add(node.id));
      return { values, errors };
    }
    const byId = Object.fromEntries(nodes.map((node) => [node.id, node]));
    const incoming = {};
    links.forEach((link) => {
      if (!incoming[link.to]) incoming[link.to] = [];
      incoming[link.to].push(link);
    });

    function setVal(nodeId, port, value) {
      values[`${nodeId}:${port}`] = Number.isFinite(value) ? value : null;
    }

    const visiting = new Set();
    const done = new Set();

    function walk(nodeId) {
      if (done.has(nodeId)) return;
      if (visiting.has(nodeId)) {
        errors.add(nodeId);
        return;
      }
      const node = byId[nodeId];
      if (!node) return;
      visiting.add(nodeId);
      (incoming[nodeId] || []).forEach((link) => walk(link.from));
      if (node.type === "order") {
        const order = api.findOrder(node.orderId);
        if (!order) errors.add(nodeId);
        else {
          let total = 0;
          orderLines(order).forEach((line) => {
            const amount = lineAmount(line, order);
            setVal(nodeId, `line:${line.id}`, amount);
            total += amount;
          });
          const totals = api.orderTotals(order);
          setVal(nodeId, "total", totals?.after ?? total);
        }
      } else if (node.type === "math") {
        const ports = nodeInputs(node, links);
        const nums = [];
        ports.forEach((port) => {
          const link = (incoming[nodeId] || []).find((item) => item.toPort === port.id);
          if (!link) return;
          walk(link.from);
          const value = values[`${link.from}:${link.fromPort}`];
          if (value != null && Number.isFinite(value)) nums.push(value);
        });
        let result = null;
        if (nums.length) {
          if (node.op === "+") result = nums.reduce((a, b) => a + b, 0);
          else if (node.op === "-") result = nums.slice(1).reduce((a, b) => a - b, nums[0]);
          else if (node.op === "*") result = nums.reduce((a, b) => a * b, 1);
          else if (node.op === "/") {
            result = nums[0];
            for (let i = 1; i < nums.length; i += 1) {
              if (!nums[i]) {
                result = NaN;
                break;
              }
              result /= nums[i];
            }
          }
        } else result = 0;
        setVal(nodeId, "out", result);
      } else if (node.type === "percent") {
        const read = (portId) => {
          const link = (incoming[nodeId] || []).find((item) => item.toPort === portId);
          if (!link) return 0;
          walk(link.from);
          const found = values[`${link.from}:${link.fromPort}`];
          return found != null && Number.isFinite(found) ? found : 0;
        };
        setVal(nodeId, "out", (read("in1") * read("in2")) / 100);
      } else if (node.type === "const") {
        const value = Number(node.value);
        setVal(nodeId, "out", Number.isFinite(value) ? value : 0);
      } else if (node.type === "result") {
        const link = (incoming[nodeId] || []).find((item) => item.toPort === "in");
        let value = null;
        if (link) {
          walk(link.from);
          const found = values[`${link.from}:${link.fromPort}`];
          if (found != null && Number.isFinite(found)) value = found;
        }
        setVal(nodeId, "in", value);
        setVal(nodeId, "out", value);
      } else if (node.type === "formula") {
        if (formulaConflict(node)) errors.add(nodeId);
        const vars = {};
        (node.inputs || []).forEach((port) => {
          const link = (incoming[nodeId] || []).find((item) => item.toPort === port.id);
          let value = 0;
          if (link) {
            walk(link.from);
            const found = values[`${link.from}:${link.fromPort}`];
            if (found != null && Number.isFinite(found)) value = found;
          }
          vars[port.name] = value;
          vars[port.id] = value;
          setVal(nodeId, port.id, value);
        });
        (node.outputs || []).forEach((port) => {
          const parsed = splitAssign(String(port.expr || "").includes("=") ? port.expr : `${port.expr || "0"}=${port.name}`);
          try {
            const value = evalExpr(parsed.expr || "0", vars);
            setVal(nodeId, port.id, value);
          } catch {
            errors.add(nodeId);
            setVal(nodeId, port.id, null);
          }
        });
      } else if (node.type === "scheme") {
        const other = findBlueprint(node.blueprintId);
        if (!other || other.id === bp.id || (stack || []).includes(other.id)) errors.add(nodeId);
        else {
          const inner = computeGraph(other, (stack || []).concat(bp.id));
          schemeOutputs(other).forEach((port) => {
            const value = inner.values[`${port.resultId}:out`];
            setVal(nodeId, port.id, value);
            if (inner.errors.has(port.resultId)) errors.add(nodeId);
          });
        }
      }
      visiting.delete(nodeId);
      done.add(nodeId);
    }

    nodes.forEach((node) => walk(node.id));
    return { values, errors };
  }

  function worldPoint(bp, clientX, clientY) {
    const board = $("calc-board");
    const rect = board.getBoundingClientRect();
    const zoom = bp.zoom || 1;
    return {
      x: (clientX - rect.left - (bp.x || 0)) / zoom,
      y: (clientY - rect.top - (bp.y || 0)) / zoom,
    };
  }

  function applyWorld(bp) {
    const world = $("calc-world");
    if (!world || !bp) return;
    world.style.transform = `translate(${bp.x || 0}px, ${bp.y || 0}px) scale(${bp.zoom || 1})`;
  }

  function nextLetter(used) {
    for (const letter of LETTERS) {
      if (!used.has(letter)) return letter;
    }
    return "";
  }

  function nextName(used) {
    for (const letter of LETTERS) {
      if (!used.has(letter)) return letter;
    }
    let i = used.size + 1;
    while (used.has(`P${i}`)) i += 1;
    return `P${i}`;
  }

  function sanitizeFormulaInput(raw, used, fallback) {
    const letter = String(raw || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 1);
    if (letter && !used.has(letter)) return letter;
    return fallback || nextLetter(used) || "A";
  }

  function parseConstValue(raw) {
    const text = String(raw ?? "").replace(",", ".").trim();
    if (!text) return 0;
    const value = Number(text);
    return Number.isFinite(value) ? value : 0;
  }

  function addNode(type, point, extra) {
    const bp = activeBlueprint();
    if (!bp) return;
    const at = point || {
      x: 120 + (session.place % 6) * 28,
      y: 80 + (session.place % 6) * 28,
    };
    session.place += 1;
    const node = { id: uid(), type, x: at.x, y: at.y };
    if (type === "math") node.op = "+";
    if (type === "result") {
      node.op = "result";
      node.name = "Результат";
    }
    if (type === "percent") node.op = "percent";
    if (type === "const") node.value = 0;
    if (type === "scheme") node.blueprintId = extra?.blueprintId || "";
    if (type === "formula") {
      node.inputs = [
        { id: uid(), name: "A" },
        { id: uid(), name: "B" },
      ];
      node.outputs = [
        { id: uid(), name: "C", expr: "A+B" },
        { id: uid(), name: "D", expr: "(-40+A)*B" },
      ];
    }
    if (type === "order") node.orderId = extra?.orderId || "";
    bp.nodes.push(node);
    session.selected = node.id;
    dirty();
    render();
  }

  function removeNode(id) {
    const bp = activeBlueprint();
    if (!bp) return;
    bp.nodes = bp.nodes.filter((node) => node.id !== id);
    bp.links = bp.links.filter((link) => link.from !== id && link.to !== id);
    if (session.selected === id) session.selected = "";
    dirty();
    render();
  }

  function usedInputPorts(nodeId, links) {
    const used = new Set();
    (links || []).forEach((link) => {
      if (link.to === nodeId) used.add(link.toPort);
    });
    return used;
  }

  function firstFreeMathPort(nodeId, links) {
    const used = usedInputPorts(nodeId, links);
    for (let i = 1; i <= MATH_MAX; i += 1) {
      if (!used.has(`in${i}`)) return `in${i}`;
    }
    return "";
  }

  function resolveToPort(dst, requested, links) {
    if (dst.type === "math") {
      if (/^in([1-9]|1[0-9]|20)$/.test(requested || "")) return requested;
      return firstFreeMathPort(dst.id, links);
    }
    const inputs = nodeInputs(dst, links);
    if (requested && inputs.some((port) => port.id === requested)) return requested;
    return inputs[0]?.id || "";
  }

  function matchPortId(wanted, ids) {
    if (!wanted) return "";
    if (ids.includes(wanted)) return wanted;
    const hits = ids.filter((id) => id.startsWith(wanted) || wanted.startsWith(id));
    return hits.length === 1 ? hits[0] : "";
  }

  function healLinks(bp) {
    if (!bp) return false;
    let changed = false;
    (bp.links || []).forEach((link) => {
      const src = (bp.nodes || []).find((node) => node.id === link.from);
      if (!src || src.type !== "order") return;
      const ids = nodeOutputs(src, api.findOrder(src.orderId)).map((port) => port.id);
      const hit = matchPortId(link.fromPort, ids);
      if (hit && hit !== link.fromPort) {
        link.fromPort = hit;
        changed = true;
      }
    });
    return changed;
  }

  function connect(from, fromPort, to, toPort) {
    const bp = activeBlueprint();
    if (!bp || from === to) return false;
    const src = bp.nodes.find((node) => node.id === from);
    const dst = bp.nodes.find((node) => node.id === to);
    if (!src || !dst) return false;
    const srcIds = nodeOutputs(src, api.findOrder(src.orderId)).map((port) => port.id);
    const fromHit = matchPortId(fromPort, srcIds);
    if (!fromHit) return false;
    const port = resolveToPort(dst, toPort, bp.links);
    if (!port) return false;
    bp.links = bp.links.filter((link) => !(link.to === to && link.toPort === port));
    bp.links.push({ id: uid(), from, fromPort: fromHit, to, toPort: port });
    dirty();
    render();
    return true;
  }

  function removeLink(id) {
    const bp = activeBlueprint();
    if (!bp || !id) return;
    const before = bp.links.length;
    bp.links = bp.links.filter((link) => link.id !== id);
    if (bp.links.length !== before) {
      dirty();
      render();
    }
  }

  function finishLink(from, fromPort, to, toPort) {
    session.linking = null;
    setLinkingClass();
    return connect(from, fromPort, to, toPort);
  }

  function disconnectInput(nodeId, portId) {
    const bp = activeBlueprint();
    if (!bp) return;
    const before = bp.links.length;
    bp.links = bp.links.filter((link) => !(link.to === nodeId && link.toPort === portId));
    if (bp.links.length !== before) {
      dirty();
      render();
    }
  }

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
    let best = String(order?.created_at || "");
    for (const line of order.lines || []) {
      const day = String(line.order_date || "");
      if (day > best) best = day;
    }
    return best;
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
      <div class="calc-tools">
        <div class="calc-tools-label">Ноды</div>
        <button type="button" class="btn calc-tool" data-add-node="math" draggable="true">Оператор</button>
        <button type="button" class="btn calc-tool" data-add-node="formula" draggable="true">Формула</button>
        <button type="button" class="btn calc-tool" data-add-node="percent" draggable="true">Процент %</button>
        <button type="button" class="btn calc-tool" data-add-node="const" draggable="true">Константа</button>
        <button type="button" class="btn calc-tool" data-add-node="result" draggable="true">Результат</button>
      </div>
      <div class="calc-orders calc-schemes">
        <div class="calc-tools-label">Схемы</div>
        <div class="calc-order-list calc-scheme-list">
          ${
            schemes.length
              ? schemes
                  .map((item) => {
                    const n = (item.nodes || []).filter((node) => node.type === "result").length;
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
      <div class="calc-orders">
        <div class="calc-tools-label">Заказы</div>
        <input type="search" id="calc-order-search" placeholder="Номер, название…" value="${esc(session.search)}" />
        <div class="calc-order-list">
          ${
            orders.length
              ? orders
                  .map((order) => {
                    const n = orderLines(order).length;
                    const used = usedOrders.has(order.id);
                    return `<button type="button" class="calc-order${used ? " is-used" : ""}" draggable="true" data-order="${esc(order.id)}"${used ? ' title="На схеме"' : ""}>
                      <b>${esc(order.number || "—")}</b>
                      <span>${esc(order.name || order.customer || "Без названия")}</span>
                      <small>${used ? "на схеме" : `${n} поз.`}</small>
                    </button>`;
                  })
                  .join("")
              : `<div class="calc-empty">Нет заказов</div>`
          }
        </div>
      </div>`;
  }

  function orderNodeHtml(node, order, graph) {
    const missing = !order;
    const ports = nodeOutputs(node, order);
    return `<article class="calc-node is-order ${missing ? "is-error" : ""} ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>${missing ? "Заказ удалён" : `№ ${esc(order.number || "—")}`}</span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <div class="calc-node-sub">${missing ? "" : esc(order.name || order.customer || "")}</div>
      <div class="calc-ports">
        ${ports
          .map((port) => {
            const value = graph.values[`${node.id}:${port.id}`];
            return `<div class="calc-row">
              <span class="calc-row-name" title="${esc(port.name)}">${esc(port.name)}</span>
              <b>${esc(fmtShort(value))}</b>
              <i class="calc-port out" data-port="${esc(port.id)}" data-io="out"></i>
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
      <div class="calc-screen" title="Выход">${esc(fmtShort(value))}</div>
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

  function formulaNodeHtml(node, bp, graph) {
    const bad = graph.errors.has(node.id);
    const linked = usedInputPorts(node.id, bp.links);
    return `<article class="calc-node is-formula ${bad ? "is-error" : ""} ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>Формула</span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
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
              <input class="calc-pname" data-out-name="${esc(port.id)}" value="${esc(port.name)}" maxlength="24" />
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
    return `<article class="calc-node is-result ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <input class="calc-pname calc-result-name" data-result-name="${esc(node.id)}" value="${esc(resultName(node))}" maxlength="48" spellcheck="false" title="Имя результата" />
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <div class="calc-screen" title="Значение связи">${esc(fmtShort(value))}</div>
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
      <div class="calc-screen" title="Число × % / 100">${esc(fmtShort(value))}</div>
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

  function nodesRoot() {
    return $("calc-nodes") || $("calc-world");
  }

  function renderNodes(bp, graph) {
    const host = nodesRoot();
    if (!host) return;
    const focus = document.activeElement;
    const keep = focus && host.contains(focus) ? { name: focus.dataset.inName || focus.dataset.outName || focus.dataset.outExpr || focus.dataset.resultName || focus.dataset.constValue, start: focus.selectionStart, end: focus.selectionEnd } : null;
    host.innerHTML = (bp.nodes || [])
      .map((node) => {
        if (node.type === "math") return mathNodeHtml(node, bp, graph);
        if (node.type === "percent") return percentNodeHtml(node, bp, graph);
        if (node.type === "const") return constNodeHtml(node, graph);
        if (node.type === "result") return resultNodeHtml(node, bp, graph);
        if (node.type === "formula") return formulaNodeHtml(node, bp, graph);
        if (node.type === "scheme") return schemeNodeHtml(node, graph);
        return orderNodeHtml(node, api.findOrder(node.orderId), graph);
      })
      .join("");
    applyWorld(bp);
    if (keep?.name) {
      const again = host.querySelector(`[data-in-name="${cssEsc(keep.name)}"], [data-out-name="${cssEsc(keep.name)}"], [data-out-expr="${cssEsc(keep.name)}"], [data-result-name="${cssEsc(keep.name)}"], [data-const-value="${cssEsc(keep.name)}"]`);
      if (again) {
        again.focus({ preventScroll: true });
        try {
          again.setSelectionRange(keep.start, keep.end);
        } catch {
          /* ignore */
        }
      }
    }
  }

  function screenToWorld(clientX, clientY, bp) {
    const board = $("calc-board");
    const rect = board.getBoundingClientRect();
    const zoom = bp.zoom || 1;
    return {
      x: (clientX - rect.left - (bp.x || 0)) / zoom,
      y: (clientY - rect.top - (bp.y || 0)) / zoom,
    };
  }

  function findPortEl(nodeEl, portId, io) {
    if (!nodeEl) return null;
    const ports = [...nodeEl.querySelectorAll(`.calc-port[data-io="${io}"]`)];
    const exact = ports.find((el) => el.dataset.port === portId);
    if (exact) return exact;
    const hit = matchPortId(portId, ports.map((el) => el.dataset.port || ""));
    return hit ? ports.find((el) => el.dataset.port === hit) : null;
  }

  function portWorld(nodeEl, portId, io, bp) {
    const port = findPortEl(nodeEl, portId, io);
    if (!port) return null;
    const rect = port.getBoundingClientRect();
    return screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2, bp);
  }

  function bezierMid(a, b) {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.45);
    return {
      x: 0.125 * a.x + 0.375 * (a.x + dx) + 0.375 * (b.x - dx) + 0.125 * b.x,
      y: 0.125 * a.y + 0.375 * a.y + 0.375 * b.y + 0.125 * b.y,
    };
  }

  function wireKind(node) {
    const type = node?.type || "";
    if (type === "order" || type === "math" || type === "formula" || type === "percent" || type === "const" || type === "result" || type === "scheme") return type;
    return "order";
  }

  function upstreamFlow(bp, nodeId) {
    const ids = new Set();
    if (!bp || !nodeId) return ids;
    const incoming = {};
    (bp.links || []).forEach((link) => {
      if (!incoming[link.to]) incoming[link.to] = [];
      incoming[link.to].push(link);
    });
    const seen = new Set();
    function walk(id) {
      if (!id || seen.has(id)) return;
      seen.add(id);
      (incoming[id] || []).forEach((link) => {
        ids.add(link.id);
        walk(link.from);
      });
    }
    walk(nodeId);
    return ids;
  }

  function setLinkingClass() {
    const board = $("calc-board");
    if (!board) return;
    const link = session.linking;
    board.classList.toggle("is-link-out", !!(link && !link.reverse));
    board.classList.toggle("is-link-in", !!(link && link.reverse));
  }

  function drawWires(bp, graph) {
    const svg = $("calc-wires");
    const host = nodesRoot();
    if (!svg || !host || !bp) return;
    const ns = "http://www.w3.org/2000/svg";
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const addPath = (d, cls) => {
      const el = document.createElementNS(ns, "path");
      el.setAttribute("d", d);
      el.setAttribute("class", cls);
      el.setAttribute("pointer-events", "none");
      svg.appendChild(el);
    };
    const hostButtons = [];
    const byId = Object.fromEntries((bp.nodes || []).map((node) => [node.id, node]));
    const flowIds = upstreamFlow(bp, session.selected);
    (bp.links || []).forEach((link) => {
      const fromEl = host.querySelector(`[data-node="${cssEsc(link.from)}"]`);
      const toEl = host.querySelector(`[data-node="${cssEsc(link.to)}"]`);
      if (!fromEl || !toEl) return;
      const a = portWorld(fromEl, link.fromPort, "out", bp);
      const b = portWorld(toEl, link.toPort, "in", bp);
      if (!a || !b) return;
      const dx = Math.max(40, Math.abs(b.x - a.x) * 0.45);
      const src = byId[link.from];
      const flow = flowIds.has(link.id);
      const err = graph.errors.has(link.from) || graph.errors.has(link.to);
      addPath(
        `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`,
        `calc-wire is-${wireKind(src)}${flow ? " is-flow" : ""}${err ? " is-error" : ""}`
      );
      if (!session.linking && !session.drag && !session.pan) {
        const mid = bezierMid(a, b);
        hostButtons.push({ id: link.id, x: mid.x, y: mid.y });
      }
    });
    host.querySelectorAll(".calc-unlink-wire").forEach((el) => el.remove());
    hostButtons.forEach((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "calc-unlink-wire";
      btn.dataset.delLink = item.id;
      btn.title = "Удалить связь";
      btn.textContent = "×";
      btn.style.left = `${item.x}px`;
      btn.style.top = `${item.y}px`;
      host.appendChild(btn);
    });
    if (session.linking?.x != null) {
      const L = session.linking;
      let a = null;
      let b = null;
      let kind = "order";
      if (L.reverse) {
        const toEl = host.querySelector(`[data-node="${cssEsc(L.to)}"]`);
        a = { x: L.x, y: L.y };
        b = toEl ? portWorld(toEl, L.toPort, "in", bp) : null;
        kind = wireKind(byId[L.to]);
      } else {
        const fromEl = host.querySelector(`[data-node="${cssEsc(L.from)}"]`);
        a = fromEl ? portWorld(fromEl, L.fromPort, "out", bp) : null;
        b = { x: L.x, y: L.y };
        kind = wireKind(byId[L.from]);
      }
      if (a && b) {
        const dx = Math.max(40, Math.abs(b.x - a.x) * 0.45);
        addPath(`M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`, `calc-wire is-temp is-${kind}`);
      }
    }
    setLinkingClass();
  }

  function render() {
    if (!api || api.view() !== "calculator") return;
    const calc = ensureState();
    const bp = activeBlueprint();
    if (!calc || !bp) return;
    if (healLinks(bp)) dirty();
    if (session.busy) {
      applyWorld(bp);
      drawWires(bp, computeGraph(bp));
      return;
    }
    const graph = computeGraph(bp);
    renderTabs(calc);
    renderTitle(bp);
    renderSide(bp);
    renderNodes(bp, graph);
    requestAnimationFrame(() => drawWires(bp, graph));
  }

  function recalculate() {
    session.linking = null;
    session.drag = null;
    session.pan = null;
    session.busy = false;
    setLinkingClass();
    const calc = ensureState();
    if (!calc) return;
    calc.blueprints.forEach((bp) => healLinks(bp));
    dirty();
    render();
  }

  function onBoardPointerDown(e) {
    const bp = activeBlueprint();
    if (!bp) return;
    const del = e.target.closest("[data-del-node]");
    if (del) {
      e.preventDefault();
      e.stopPropagation();
      removeNode(del.dataset.delNode);
      return;
    }
    const unlink = e.target.closest("[data-del-link], [data-del-in-link]");
    if (unlink) {
      e.preventDefault();
      e.stopPropagation();
      if (unlink.dataset.delLink) removeLink(unlink.dataset.delLink);
      else disconnectInput(unlink.closest(".calc-node")?.dataset.node, unlink.dataset.delInLink);
      return;
    }
    if (e.target.closest(".calc-refresh, .calc-bp-name, input, textarea, select")) return;
    const port = e.target.closest(".calc-port");
    const node = e.target.closest(".calc-node");
    const drag = e.target.closest("[data-drag-node]");
    if (port) {
      e.preventDefault();
      e.stopPropagation();
      const nodeId = port.closest(".calc-node")?.dataset.node;
      const io = port.dataset.io;
      const portId = port.dataset.port;
      session.selected = nodeId || "";
      if (session.linking) {
        const src = session.linking;
        if (src.reverse && io === "out" && nodeId !== src.to) {
          session.linking = null;
          finishLink(nodeId, portId, src.to, src.toPort);
          return;
        }
        if (!src.reverse && io === "in" && nodeId !== src.from) {
          session.linking = null;
          finishLink(src.from, src.fromPort, nodeId, portId);
          return;
        }
      }
      if (io === "in") {
        if (e.altKey) {
          disconnectInput(nodeId, portId);
          return;
        }
        const at = screenToWorld(e.clientX, e.clientY, bp);
        session.linking = { reverse: true, to: nodeId, toPort: portId, x: at.x, y: at.y, sx: e.clientX, sy: e.clientY };
        session.busy = true;
        $("calc-board").setPointerCapture(e.pointerId);
        drawWires(bp, computeGraph(bp));
        return;
      }
      const board = $("calc-board");
      const at = screenToWorld(e.clientX, e.clientY, bp);
      session.linking = { from: nodeId, fromPort: portId, x: at.x, y: at.y, sx: e.clientX, sy: e.clientY };
      session.busy = true;
      board.setPointerCapture(e.pointerId);
      drawWires(bp, computeGraph(bp));
      return;
    }
    if (session.linking) {
      session.linking = null;
      drawWires(bp, computeGraph(bp));
    }
    if (e.target.closest("button")) return;
    if (drag && node) {
      e.preventDefault();
      session.selected = node.dataset.node;
      session.busy = true;
      session.drag = {
        id: node.dataset.node,
        dx: e.clientX,
        dy: e.clientY,
        x: Number(node.style.left.replace("px", "")) || 0,
        y: Number(node.style.top.replace("px", "")) || 0,
      };
      $("calc-board").setPointerCapture(e.pointerId);
      node.classList.add("is-on");
      return;
    }
    if (node) {
      session.selected = node.dataset.node;
      nodesRoot()?.querySelectorAll(".calc-node").forEach((el) => {
        el.classList.toggle("is-on", el.dataset.node === node.dataset.node);
      });
      drawWires(bp, computeGraph(bp));
      return;
    }
    session.selected = "";
    nodesRoot()?.querySelectorAll(".calc-node").forEach((el) => el.classList.remove("is-on"));
    drawWires(bp, computeGraph(bp));
    session.busy = true;
    session.pan = { x: e.clientX, y: e.clientY, ox: bp.x || 0, oy: bp.y || 0 };
    $("calc-board").setPointerCapture(e.pointerId);
  }

  function onBoardPointerMove(e) {
    const bp = activeBlueprint();
    if (!bp) return;
    if (session.linking) {
      const at = screenToWorld(e.clientX, e.clientY, bp);
      session.linking.x = at.x;
      session.linking.y = at.y;
      drawWires(bp, computeGraph(bp));
      return;
    }
    if (session.drag) {
      const zoom = bp.zoom || 1;
      const node = bp.nodes.find((item) => item.id === session.drag.id);
      if (!node) return;
      node.x = session.drag.x + (e.clientX - session.drag.dx) / zoom;
      node.y = session.drag.y + (e.clientY - session.drag.dy) / zoom;
      const el = nodesRoot()?.querySelector(`[data-node="${cssEsc(node.id)}"]`);
      if (el) {
        el.style.left = `${node.x}px`;
        el.style.top = `${node.y}px`;
      }
      drawWires(bp, computeGraph(bp));
      return;
    }
    if (session.pan) {
      bp.x = session.pan.ox + (e.clientX - session.pan.x);
      bp.y = session.pan.oy + (e.clientY - session.pan.y);
      applyWorld(bp);
    }
  }

  function onBoardPointerUp(e) {
    const bp = activeBlueprint();
    const movedNode = session.drag;
    const movedPan = session.pan;
    const linking = session.linking;
    session.drag = null;
    session.pan = null;
    session.busy = false;
    if (e.target.closest?.("input, textarea, select, .calc-bp-name, .calc-refresh")) return;
    if (linking) {
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".calc-port");
      const nodeId = over?.closest?.(".calc-node")?.dataset.node;
      const io = over?.dataset.io;
      if (linking.reverse && io === "out" && nodeId && nodeId !== linking.to) {
        session.linking = null;
        finishLink(nodeId, over.dataset.port, linking.to, linking.toPort);
        setLinkingClass();
        return;
      }
      if (!linking.reverse && io === "in" && nodeId && nodeId !== linking.from) {
        session.linking = null;
        finishLink(linking.from, linking.fromPort, nodeId, over.dataset.port);
        setLinkingClass();
        return;
      }
      const dx = e.clientX - (linking.sx || e.clientX);
      const dy = e.clientY - (linking.sy || e.clientY);
      if (dx * dx + dy * dy > 64 && !over) {
        session.linking = null;
        setLinkingClass();
        if (bp) drawWires(bp, computeGraph(bp));
      }
      return;
    }
    if (movedNode) {
      dirty();
      if (bp) drawWires(bp, computeGraph(bp));
      return;
    }
    if (movedPan) {
      const dx = e.clientX - movedPan.x;
      const dy = e.clientY - movedPan.y;
      if (dx * dx + dy * dy > 16) dirty();
    }
  }

  function onBoardWheel(e) {
    const bp = activeBlueprint();
    if (!bp || e.target.closest("input, textarea")) return;
    e.preventDefault();
    const before = bp.zoom || 1;
    const next = Math.max(0.35, Math.min(2.5, before * (e.deltaY > 0 ? 0.92 : 1.08)));
    const rect = $("calc-board").getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const k = next / before;
    bp.x = cx - (cx - (bp.x || 0)) * k;
    bp.y = cy - (cy - (bp.y || 0)) * k;
    bp.zoom = next;
    applyWorld(bp);
    clearTimeout(onBoardWheel.t);
    onBoardWheel.t = setTimeout(() => dirty(), 280);
  }

  function onDrop(e) {
    const bp = activeBlueprint();
    if (!bp) return;
    const orderId = e.dataTransfer?.getData("text/finmaster-order") || e.dataTransfer?.getData("text/plain");
    const kind = e.dataTransfer?.getData("text/finmaster-node");
    const blueprintId = e.dataTransfer?.getData("text/finmaster-blueprint");
    e.preventDefault();
    const at = worldPoint(bp, e.clientX, e.clientY);
    if (kind === "math" || kind === "formula" || kind === "percent" || kind === "const" || kind === "result") addNode(kind, at);
    else if (blueprintId && blueprintId !== bp.id) addNode("scheme", at, { blueprintId });
    else if (orderId && api.findOrder(orderId)) addNode("order", at, { orderId });
  }

  function formulaNode(id) {
    return (activeBlueprint()?.nodes || []).find((node) => node.id === id && node.type === "formula");
  }

  function bind() {
    if (session.bound) return;
    session.bound = true;
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
      renderSide(activeBlueprint());
    });
    $("calc-side")?.addEventListener("click", (e) => {
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
    });
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
    board.addEventListener("wheel", onBoardWheel, { passive: false });
    root.addEventListener("click", (e) => {
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
      if (e.target.closest("[data-add-in]") && node.type === "formula") {
        if ((node.inputs || []).length >= 26) return;
        const used = new Set((node.inputs || []).map((port) => port.name));
        const name = nextLetter(used);
        if (!name) return;
        node.inputs.push({ id: uid(), name });
        dirty();
        render();
        return;
      }
      if (e.target.closest("[data-add-out]") && node.type === "formula") {
        if ((node.outputs || []).length >= MATH_MAX) return;
        const used = new Set((node.inputs || []).map((port) => port.name).concat((node.outputs || []).map((port) => port.name)));
        const name = nextName(used);
        node.outputs.push({ id: uid(), name, expr: name === "C" ? "A+B" : "0" });
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
      }
    });
    root.addEventListener("change", (e) => {
      const nodeEl = e.target.closest(".calc-node");
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
      if (e.target.dataset.constValue && node.type === "const") {
        node.value = parseConstValue(e.target.value);
        e.target.value = String(node.value);
        dirty();
        render();
        return;
      }
      if (node.type !== "formula") return;
      if (e.target.dataset.inName) {
        const port = node.inputs.find((item) => item.id === e.target.dataset.inName);
        if (port) {
          const used = new Set((node.inputs || []).filter((item) => item.id !== port.id).map((item) => item.name));
          port.name = sanitizeFormulaInput(e.target.value, used, port.name);
          e.target.value = port.name;
        }
      }
      if (e.target.dataset.outName) {
        const port = node.outputs.find((item) => item.id === e.target.dataset.outName);
        if (port) port.name = e.target.value.trim().slice(0, 24) || port.name;
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
      if (e.target.matches(".calc-expr, .calc-pname, .calc-const-val")) {
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
      if (e.key === "Escape" && session.linking) {
        session.linking = null;
        setLinkingClass();
        const bp = activeBlueprint();
        if (bp) drawWires(bp, computeGraph(bp));
        return;
      }
      if (!/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && (e.key === "Delete" || e.key === "Backspace") && session.selected) {
        e.preventDefault();
        removeNode(session.selected);
      }
    });
    window.addEventListener("resize", () => {
      if (api?.view?.() === "calculator") {
        const bp = activeBlueprint();
        if (bp) drawWires(bp, computeGraph(bp));
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
  };
})();
