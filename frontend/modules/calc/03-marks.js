  const PLAN_PORT = "plan";
  const MARK_MAX_FEEDS = 8;
  const COMMON_OUT_MAX = 20;
  const COMMON_SEP_MAX = 8;
  const COMMON_VIEW = "__common";

  function feedPort(feed) {
    return String(feed?.port || PLAN_PORT);
  }

  function feedKey(feed, kind, rest) {
    const primary = feedPort(feed) === PLAN_PORT;
    if (kind === "wall") return primary ? `wall:${rest}` : `wall:${feed.id}:${rest}`;
    if (kind === "count") return primary ? `count:${rest}` : `count:${feed.id}:${rest}`;
    if (kind === "own") return primary ? `own:${rest}` : `own:${feed.id}:${rest}`;
    if (kind === "type") return primary ? `type:${rest}` : `type:${feed.id}:${rest}`;
    if (kind === "frame") return primary ? `frame:${rest}` : `frame:${feed.id}:${rest}`;
    return `${kind}:${rest}`;
  }

  function ensureCommons(node) {
    if (!node) return;
    if (!Array.isArray(node.commons)) node.commons = [];
    const seen = new Set();
    const rows = [];
    let outs = 0;
    node.commons.forEach((row) => {
      if (!row || typeof row !== "object" || rows.length >= COMMON_OUT_MAX + COMMON_SEP_MAX) return;
      let id = String(row.id || "").trim();
      if (!id || seen.has(id)) id = uid();
      seen.add(id);
      if (row.kind === "sep") {
        rows.push({ id, kind: "sep" });
        return;
      }
      if (outs >= COMMON_OUT_MAX) return;
      outs += 1;
      const terms = (Array.isArray(row.terms) ? row.terms : []).slice(0, 12).map((term) => {
        const op = ["+", "-", "*", "/"].includes(term?.op) ? term.op : "+";
        if (term?.kind === "num") return { op, kind: "num", num: plannerRound(plannerClamp(plannerNum(term.num, 0), -1e6, 1e6)) };
        const port = String(term?.port || "");
        if (!port) return null;
        return { op, kind: "ref", port };
      }).filter(Boolean);
      rows.push({
        id,
        kind: "out",
        name: String(row.name || "Итог").trim().slice(0, 48) || "Итог",
        on: row.on !== false,
        terms,
      });
    });
    node.commons = rows;
  }

  function commonOutCount(node) {
    return (node?.commons || []).filter((row) => row.kind !== "sep").length;
  }

  function ensureFeeds(node, bp) {
    if (!Array.isArray(node.feeds) || !node.feeds.length) node.feeds = [{ id: "main", port: PLAN_PORT }];
    const seen = new Set();
    node.feeds = node.feeds.filter((feed) => {
      if (!feed || typeof feed !== "object") return false;
      if (!feed.id) feed.id = uid();
      if (!feed.port) feed.port = feed.id === "main" ? PLAN_PORT : `plan:${feed.id}`;
      if (seen.has(feed.port)) return false;
      seen.add(feed.port);
      return true;
    }).slice(0, MARK_MAX_FEEDS);
    if (!node.feeds.some((feed) => feed.port === PLAN_PORT) && node.feeds.length < MARK_MAX_FEEDS && !node.feeds.length) {
      node.feeds.unshift({ id: "main", port: PLAN_PORT });
    }
    if (!node.feeds.length) node.feeds = [{ id: "main", port: PLAN_PORT }];
    const host = bp || blueprintOf(node);
    const links = host?.links || [];
    const linked = (port) => links.some((link) => link.to === node.id && link.toPort === port);
    const hasContent = (feed) => (node.holes || []).some((hole) => hole.feed === feed.id) || (node.fixtures || []).some((fix) => fix.feed === feed.id);
    node.feeds = node.feeds.filter((feed, index, list) => linked(feedPort(feed)) || hasContent(feed) || index === list.length - 1);
    if (!node.feeds.length) node.feeds = [{ id: "main", port: PLAN_PORT }];
    const last = node.feeds[node.feeds.length - 1];
    if (linked(feedPort(last)) && node.feeds.length < MARK_MAX_FEEDS) {
      const id = uid();
      node.feeds.push({ id, port: `plan:${id}` });
    }
    ensureCommons(node);
    return node;
  }

  function activeFeed(node) {
    const id = session.mark?.feed;
    const found = id && id !== COMMON_VIEW ? (node.feeds || []).find((feed) => feed.id === id) : null;
    if (found) return found;
    const bp = activeBlueprint();
    const linked = (node.feeds || []).find((feed) => (bp?.links || []).some((link) => link.to === node.id && link.toPort === feedPort(feed)));
    return linked || node.feeds?.[0] || null;
  }

  function feedTitle(node, feed, bp) {
    const host = bp || blueprintOf(node);
    const link = (host?.links || []).find((item) => item.to === node.id && item.toPort === feedPort(feed));
    if (!link) return "Чертёж";
    const src = (host.nodes || []).find((item) => item.id === link.from);
    if (!src) return "Чертёж";
    if (src.type === "planner") {
      ensurePlanner(src);
      const layout = (src.layouts || []).find((item) => plannerPort(item, "plan") === link.fromPort);
      return layout?.name || plannerName(src);
    }
    if (src.type === "openings") {
      ensureOpenings(src);
      const srcFeed = (src.feeds || []).find((item) => feedPort(item) === link.fromPort);
      const up = srcFeed && (host.links || []).find((item) => item.to === src.id && item.toPort === feedPort(srcFeed));
      const upNode = up && (host.nodes || []).find((item) => item.id === up.from);
      if (upNode?.type === "planner") {
        ensurePlanner(upNode);
        const layout = (upNode.layouts || []).find((item) => plannerPort(item, "plan") === up.fromPort);
        if (layout?.name) return layout.name;
      }
      return src.name || "Проёмы";
    }
    return src.name || markNodeTitle(src);
  }

  function commonEval(row, lookup) {
    const terms = row?.terms || [];
    if (!terms.length) return 0;
    const nums = terms.map((term) => (term.kind === "num" ? Number(term.num) || 0 : Number(lookup(term.port)) || 0));
    const vals = [nums[0]];
    const add = [];
    for (let i = 1; i < nums.length; i += 1) {
      const op = terms[i].op || "+";
      if (op === "*" || op === "/") {
        const last = vals[vals.length - 1];
        vals[vals.length - 1] = op === "*" ? last * nums[i] : (nums[i] ? last / nums[i] : 0);
      } else {
        add.push(op);
        vals.push(nums[i]);
      }
    }
    let acc = vals[0];
    add.forEach((op, i) => {
      acc = op === "-" ? acc - vals[i + 1] : acc + vals[i + 1];
    });
    return Number.isFinite(acc) ? plannerRound(acc) : 0;
  }

  function commonUnit(row, ports) {
    const units = [];
    (row.terms || []).forEach((term) => {
      if (term.kind !== "ref") return;
      const port = (ports || []).find((item) => item.id === term.port);
      if (port?.unit) units.push(port.unit);
    });
    const uniq = [...new Set(units)];
    if (!uniq.length) return "";
    return uniq.length === 1 ? uniq[0] : uniq.join(" / ");
  }

  function commonMath(node, catalog) {
    const cards = (node.commons || []).filter((row) => row.kind !== "sep");
    const stack = new Set();
    function valueOf(row) {
      if (!row || stack.has(row.id)) return 0;
      stack.add(row.id);
      const n = commonEval(row, (id) => {
        if (String(id).startsWith("common:")) return valueOf(cards.find((item) => `common:${item.id}` === id));
        const found = (catalog || []).find((item) => item.id === id);
        const num = Number(found?.value ?? found?.area);
        return Number.isFinite(num) ? num : 0;
      });
      stack.delete(row.id);
      return n;
    }
    function unitOf(row) {
      if (!row || stack.has(row.id)) return "";
      stack.add(row.id);
      const units = [];
      (row.terms || []).forEach((term) => {
        if (term.kind !== "ref") return;
        const unit = String(term.port).startsWith("common:")
          ? unitOf(cards.find((item) => `common:${item.id}` === term.port))
          : ((catalog || []).find((item) => item.id === term.port)?.unit || "");
        if (unit) units.push(...String(unit).split(" / "));
      });
      stack.delete(row.id);
      const uniq = [...new Set(units.filter(Boolean))];
      if (!uniq.length) return "";
      return uniq.length === 1 ? uniq[0] : uniq.join(" / ");
    }
    return { cards, valueOf, unitOf };
  }

  function appendCommons(node, ports, linked, catalog) {
    ensureCommons(node);
    const math = commonMath(node, catalog || ports);
    math.cards.forEach((row) => {
      const id = `common:${row.id}`;
      if (!row.on && !linked?.has(id)) return;
      ports.push({
        id,
        name: row.name || "Итог",
        value: math.valueOf(row),
        unit: math.unitOf(row),
        common: true,
      });
    });
  }

  function nextCommonName(node) {
    const names = new Set((node.commons || []).filter((row) => row.kind !== "sep").map((row) => row.name));
    let name = "Итог";
    let n = 2;
    while (names.has(name)) {
      name = `Итог ${n}`;
      n += 1;
    }
    return name;
  }

  function commonHost() {
    if ($("planner-modal")?.classList.contains("is-common") && session.planner) return session.planner;
    if ($("mark-modal")?.classList.contains("is-common") && session.mark) return session.mark;
    return null;
  }

  function touchCommon(node) {
    ensureCommons(node);
    const bag = commonHost();
    if (!bag) return null;
    let row = node.commons.find((item) => item.id === bag.commonId);
    if (!row) {
      if (commonOutCount(node) >= COMMON_OUT_MAX) return null;
      row = { id: uid(), name: nextCommonName(node), on: true, terms: [] };
      node.commons.push(row);
      bag.commonId = row.id;
    }
    return row;
  }

  function addCommonTerm(node, term) {
    ensureCommons(node);
    const bag = commonHost();
    if (commonOutCount(node) >= COMMON_OUT_MAX && !node.commons.some((row) => row.id === bag?.commonId && row.kind !== "sep")) {
      api?.toast?.("Достигнут лимит выходов");
      return;
    }
    const row = touchCommon(node);
    if (!row || row.terms.length >= 12) return;
    if (term.kind !== "num" && term.port === `common:${row.id}`) return;
    row.terms.push({ op: "+", kind: term.kind, port: term.port || "", num: term.num });
  }

  function commonSourcesOf(node, bp, values) {
    const host = bp || activeBlueprint();
    const links = host?.links || [];
    if (node.type === "planner") {
      ensurePlanner(node);
      const ports = plannerLayoutPorts(node, links, true).filter((port) => port.signal !== "plan");
      return (node.layouts || []).map((layout) => ({
        id: layout.id,
        name: layout.name,
        rows: ports.filter((port) => port.layoutId === layout.id).map((port) => ({
          id: port.id,
          name: port.name,
          value: port.value ?? port.area,
          unit: port.unit || "м²",
        })),
      }));
    }
    if (node.type === "openings") {
      ensureOpenings(node);
      return node.feeds.filter((feed) => upstreamPlan(node, host, [], values || {}, feedPort(feed))).map((feed) => ({
        id: feed.id,
        name: feedTitle(node, feed, host),
        rows: openingFeedPorts(node, host, values, links, feed, true).filter((port) => port.signal !== "plan").map((port) => ({
          id: port.id,
          name: port.name,
          value: port.value,
          unit: port.unit || "",
        })),
      }));
    }
    ensureElectrics(node);
    return node.feeds.filter((feed) => upstreamPlan(node, host, [], values || {}, feedPort(feed))).map((feed) => ({
      id: feed.id,
      name: feedTitle(node, feed, host),
      rows: electricFeedPorts(node, host, links, feed, true).map((port) => ({
        id: port.id,
        name: port.name,
        value: port.value,
        unit: port.unit || "",
      })),
    }));
  }

  function commonCardGroup(node, sources) {
    const catalog = [];
    (sources || []).forEach((group) => (group.rows || []).forEach((row) => catalog.push(row)));
    const math = commonMath(node, catalog);
    if (!math.cards.length) return null;
    return {
      id: "commons",
      name: "Выходы",
      rows: math.cards.map((row) => ({
        id: `common:${row.id}`,
        name: row.name || "Итог",
        value: math.valueOf(row),
        unit: math.unitOf(row),
      })),
    };
  }

  function commonStageHtml(sources, used) {
    const groups = (sources || []).map((group) => `<div class="common-group${group.id === "commons" ? " is-outs" : ""}"><div class="common-group-h">${esc(group.name)}</div><div class="common-picks">${
      group.rows.length
        ? group.rows.map((row) => `<button type="button" class="${used?.has(row.id) ? "is-used" : ""}" data-common-src="${esc(row.id)}">${esc(row.name)} <em>${esc(fmtShort(row.value))}${row.unit ? ` ${esc(row.unit)}` : ""}</em></button>`).join("")
        : `<div class="calc-empty">Нет чисел</div>`
    }</div></div>`).join("");
    return `${groups || `<div class="calc-empty">Подключите чертёж, чтобы брать его числа</div>`}
      <form class="common-num" data-common-num-form>
        <input data-common-num inputmode="decimal" placeholder="Своё число" aria-label="Своё число" />
        <button type="submit" class="btn">Добавить число</button>
      </form>`;
  }

  function commonSideHtml(node, sources) {
    const bag = commonHost();
    const byId = new Map();
    (sources || []).forEach((group) => group.rows.forEach((row) => byId.set(row.id, { ...row, group: group.name })));
    const linked = linkedFromPorts(node.id, activeBlueprint()?.links || []);
    const cards = (node.commons || []).map((row) => {
      const grip = `<i class="common-grip" draggable="true" data-common-drag="${esc(row.id)}" title="Перетащить"></i>`;
      if (row.kind === "sep") {
        return `<div class="common-sep" data-common-sep="${esc(row.id)}">${grip}<span></span><button type="button" class="calc-x" data-common-del="${esc(row.id)}" title="Удалить линию">×</button></div>`;
      }
      const chain = (row.terms || []).map((term, index) => {
        const meta = term.kind === "num"
          ? { name: fmtShort(term.num), unit: "" }
          : (byId.get(term.port) || { name: "нет значения", unit: "" });
        const sign = OPS.find((item) => item.id === term.op)?.label || "+";
        const op = index
          ? `<button type="button" class="common-op" data-common-op-btn data-common-id="${esc(row.id)}" data-common-op="${index}" title="Сменить действие" aria-label="Сменить действие">${sign}</button>`
          : "";
        const label = meta.group ? `${meta.group}: ${meta.name}` : meta.name;
        return `<span class="common-term" data-common-term="${index}" data-common-id="${esc(row.id)}"><i class="common-term-grip" draggable="true" data-common-term-drag="${index}" data-common-id="${esc(row.id)}" title="Перетащить"></i>${op}<span>${esc(label)}</span><button type="button" class="calc-mini" data-common-id="${esc(row.id)}" data-common-term-del="${index}" title="Убрать">×</button></span>`;
      }).join("");
      const locked = linked.has(`common:${row.id}`);
      const value = commonEval(row, (id) => byId.get(id)?.value ?? 0);
      const unit = commonUnit(row, [...byId.values()]);
      return `<div class="planner-metric ${bag?.commonId === row.id ? "is-sel" : ""}" data-common-pick="${esc(row.id)}">
        ${grip}
        <input class="planner-name" data-common-name="${esc(row.id)}" value="${esc(row.name)}" maxlength="48" aria-label="Имя выхода" />
        <label class="planner-on"><input type="checkbox" data-common-on="${esc(row.id)}" ${row.on || locked ? "checked" : ""} ${locked ? "disabled" : ""} /> На ноду</label>
        <div class="common-chain">${chain || `<span class="calc-empty">Добавьте значения слева</span>`}</div>
        <b>${esc(fmtShort(value))}${unit ? ` ${esc(unit)}` : ""}</b>
        <button type="button" class="calc-x" data-common-del="${esc(row.id)}" title="Удалить выход">×</button>
      </div>`;
    }).join("");
    const add = commonOutCount(node) >= COMMON_OUT_MAX ? "" : `<button type="button" class="btn" data-common-add>+ Выход</button>`;
    const line = (node.commons || []).filter((row) => row.kind === "sep").length >= COMMON_SEP_MAX ? "" : `<button type="button" class="btn" data-common-line>+ Линия</button>`;
    return `<div class="planner-block"><div class="planner-block-h">Общий вывод ${add}${line}</div>
      <p class="planner-lead">Слева числа чертежей. В конце блок «Выходы» — значения карточек, он пересчитывается вместе с ними. Нажмите число — оно встанет в выбранный выход. Клик по знаку между числами меняет действие по кругу. Сначала умножение и деление, потом сложение и вычитание. Числа внутри карточки тянутся за точки. Карточки тоже. «Линия» ставит разделитель между выходами.</p>
      ${cards || `<div class="calc-empty">Выходов пока нет</div>`}
    </div>`;
  }

  function usedCommonPorts(node) {
    const bag = commonHost();
    const row = (node.commons || []).find((item) => item.kind !== "sep" && item.id === bag?.commonId);
    const used = new Set();
    (row?.terms || []).forEach((term) => {
      if (term.kind !== "num" && term.port) used.add(term.port);
    });
    return used;
  }

  function paintCommon(which, node, bp, values) {
    const sources = commonSourcesOf(node, bp, values);
    const listed = sources.concat(commonCardGroup(node, sources) || []);
    const bag = commonHost();
    const picked = (node.commons || []).find((item) => item.kind !== "sep" && item.id === bag?.commonId) || (node.commons || []).find((item) => item.kind !== "sep") || null;
    if (picked && bag) bag.commonId = picked.id;
    const stage = $(which === "planner" ? "planner-common" : "mark-common");
    const side = $(which === "planner" ? "planner-side" : "mark-side");
    if (stage) {
      stage.hidden = false;
      stage.innerHTML = commonStageHtml(listed, usedCommonPorts(node));
    }
    if (side) {
      const scroll = side.scrollTop;
      side.innerHTML = commonSideHtml(node, listed);
      side.scrollTop = scroll;
    }
    if (which === "planner") {
      const title = $("planner-title");
      if (title && document.activeElement !== title) title.value = picked?.name || "Итог";
    }
  }

  function handleCommonClick(e, node) {
    const add = e.target.closest("[data-common-add]");
    if (add) {
      ensureCommons(node);
      if (commonOutCount(node) >= COMMON_OUT_MAX) return true;
      const row = { id: uid(), kind: "out", name: nextCommonName(node), on: true, terms: [] };
      node.commons.push(row);
      const bag = commonHost();
      if (bag) bag.commonId = row.id;
      return true;
    }
    const line = e.target.closest("[data-common-line]");
    if (line) {
      ensureCommons(node);
      if ((node.commons || []).filter((item) => item.kind === "sep").length >= COMMON_SEP_MAX) return true;
      const sep = { id: uid(), kind: "sep" };
      const bag = commonHost();
      const index = node.commons.findIndex((item) => item.id === bag?.commonId);
      if (index >= 0) node.commons.splice(index + 1, 0, sep);
      else node.commons.push(sep);
      return true;
    }
    const del = e.target.closest("[data-common-del]");
    if (del) {
      const id = del.dataset.commonDel;
      node.commons = (node.commons || []).filter((row) => row.id !== id);
      plannerDropPorts(node, [`common:${id}`]);
      const bag = commonHost();
      if (bag?.commonId === id) bag.commonId = node.commons.find((item) => item.kind !== "sep")?.id || "";
      return true;
    }
    const termDel = e.target.closest("[data-common-term-del]");
    if (termDel) {
      const row = (node.commons || []).find((item) => item.id === termDel.dataset.commonId);
      const index = Number(termDel.dataset.commonTermDel);
      if (row && index >= 0) row.terms.splice(index, 1);
      return true;
    }
    const opBtn = e.target.closest("[data-common-op-btn]");
    if (opBtn) {
      const row = (node.commons || []).find((item) => item.id === opBtn.dataset.commonId);
      const term = row?.terms?.[Number(opBtn.dataset.commonOp)];
      if (term) {
        const ids = OPS.map((item) => item.id);
        const at = ids.indexOf(term.op);
        term.op = ids[at >= 0 ? (at + 1) % ids.length : 0];
      }
      return true;
    }
    const pick = e.target.closest("[data-common-pick]");
    if (pick && !e.target.closest("input, select, button, textarea, label")) {
      const bag = commonHost();
      if (bag) bag.commonId = pick.dataset.commonPick;
      return true;
    }
    return false;
  }

  function handleCommonInput(e, node) {
    const name = e.target.closest("[data-common-name]");
    if (!name) return false;
    const row = (node.commons || []).find((item) => item.id === name.dataset.commonName);
    if (row) row.name = String(name.value || "").trim().slice(0, 48);
    const label = row?.name || "Итог";
    document.querySelectorAll(`[data-common-src="${cssEsc(`common:${row?.id || ""}`)}"]`).forEach((btn) => {
      const em = btn.querySelector("em");
      btn.innerHTML = `${esc(label)}${em ? ` ${em.outerHTML}` : ""}`;
    });
    return true;
  }

  function handleCommonChange(e, node) {
    const op = e.target.closest("[data-common-op]");
    if (op) {
      const row = (node.commons || []).find((item) => item.id === op.dataset.commonId);
      const index = Number(op.dataset.commonOp);
      if (row?.terms[index]) row.terms[index].op = ["+", "-", "*", "/"].includes(op.value) ? op.value : "+";
      return true;
    }
    if (e.target?.dataset?.commonOn) {
      const row = (node.commons || []).find((item) => item.id === e.target.dataset.commonOn);
      if (row) row.on = !!e.target.checked;
      return true;
    }
    return false;
  }

  function bindCommonStage(id, getNode, commit) {
    const el = $(id);
    if (!el || el.dataset.bound) return;
    el.dataset.bound = "1";
    el.addEventListener("click", (e) => {
      const node = getNode();
      const src = e.target.closest("[data-common-src]");
      if (!node || !src) return;
      addCommonTerm(node, { kind: "ref", port: src.dataset.commonSrc });
      commit();
    });
    el.addEventListener("submit", (e) => {
      const form = e.target.closest?.("[data-common-num-form]") || (e.target?.matches?.("[data-common-num-form]") ? e.target : null);
      if (!form) return;
      e.preventDefault();
      const node = getNode();
      if (!node) return;
      const num = plannerDraft(form.querySelector("[data-common-num]")?.value);
      if (num == null) return;
      addCommonTerm(node, { kind: "num", num });
      commit();
    });
  }

  function moveCommon(node, fromId, toId, before) {
    const rows = node.commons || [];
    const from = rows.findIndex((row) => row.id === fromId);
    if (from < 0 || fromId === toId) return false;
    const [row] = rows.splice(from, 1);
    const to = rows.findIndex((item) => item.id === toId);
    if (to < 0) rows.push(row);
    else rows.splice(before ? to : to + 1, 0, row);
    return true;
  }

  function moveTerm(node, rowId, from, to, before) {
    const row = (node.commons || []).find((item) => item.id === rowId);
    if (!row || from < 0 || to < 0 || from === to || !row.terms?.[from] || !row.terms?.[to]) return false;
    const [term] = row.terms.splice(from, 1);
    let index = to;
    if (from < to) index -= 1;
    if (!before) index += 1;
    row.terms.splice(Math.max(0, Math.min(row.terms.length, index)), 0, term);
    return true;
  }

  function bindCommonDrag(id, getNode, commit) {
    const el = $(id);
    if (!el || el.dataset.dragBound) return;
    el.dataset.dragBound = "1";
    let fromId = "";
    let termDrag = null;
    const clear = () => el.querySelectorAll(".is-drop-before, .is-drop-after").forEach((card) => card.classList.remove("is-drop-before", "is-drop-after"));
    el.addEventListener("dragstart", (e) => {
      const termGrip = e.target.closest("[data-common-term-drag]");
      if (termGrip) {
        termDrag = { row: termGrip.dataset.commonId, index: Number(termGrip.dataset.commonTermDrag) };
        fromId = "";
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", `term:${termDrag.row}:${termDrag.index}`);
        termGrip.closest("[data-common-term]")?.classList.add("is-dragging");
        return;
      }
      termDrag = null;
      const grip = e.target.closest("[data-common-drag]");
      if (!grip) return;
      fromId = grip.dataset.commonDrag;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", fromId);
      grip.closest("[data-common-pick], [data-common-sep]")?.classList.add("is-dragging");
    });
    el.addEventListener("dragover", (e) => {
      if (termDrag) {
        const term = e.target.closest("[data-common-term]");
        if (!term || term.dataset.commonId !== termDrag.row || Number(term.dataset.commonTerm) === termDrag.index) return;
        e.preventDefault();
        clear();
        const box = term.getBoundingClientRect();
        term.classList.add(e.clientX < box.left + box.width / 2 ? "is-drop-before" : "is-drop-after");
        return;
      }
      if (!fromId) return;
      const card = e.target.closest("[data-common-pick], [data-common-sep]");
      if (!card || card.dataset.commonPick === fromId || card.dataset.commonSep === fromId) return;
      e.preventDefault();
      clear();
      const box = card.getBoundingClientRect();
      card.classList.add(e.clientY < box.top + box.height / 2 ? "is-drop-before" : "is-drop-after");
    });
    el.addEventListener("drop", (e) => {
      const node = getNode();
      if (termDrag) {
        const term = e.target.closest("[data-common-term]");
        if (term && node && term.dataset.commonId === termDrag.row) {
          e.preventDefault();
          const box = term.getBoundingClientRect();
          if (moveTerm(node, termDrag.row, termDrag.index, Number(term.dataset.commonTerm), e.clientX < box.left + box.width / 2)) commit();
        }
        termDrag = null;
        fromId = "";
        clear();
        return;
      }
      const card = e.target.closest("[data-common-pick], [data-common-sep]");
      if (!card || !node || !fromId) return;
      e.preventDefault();
      const box = card.getBoundingClientRect();
      if (moveCommon(node, fromId, card.dataset.commonPick || card.dataset.commonSep, e.clientY < box.top + box.height / 2)) commit();
      fromId = "";
      clear();
    });
    el.addEventListener("dragend", () => {
      fromId = "";
      termDrag = null;
      clear();
      el.querySelectorAll(".is-dragging").forEach((card) => card.classList.remove("is-dragging"));
    });
  }
  const PIPE_MM = [16, 20, 25, 32, 40, 50, 63, 75, 90, 110, 125, 160];
  const SOCKET_BUILTIN = [
    { id: "socket", name: "Розетка", letters: "Р", color: "#f59e0b", size: 80 },
    { id: "switch", name: "Выключатель", letters: "В", color: "#38bdf8", size: 80 },
    { id: "switch2", name: "Двойной выключатель", letters: "ДВ", color: "#22d3ee", size: 80 },
    { id: "pass", name: "Проходной выключатель", letters: "ПВ", color: "#818cf8", size: 80 },
    { id: "lan", name: "Интернет", letters: "И", color: "#34d399", size: 80 },
    { id: "tv", name: "ТВ", letters: "ТВ", color: "#fb7185", size: 80 },
  ];
  const LIGHT_BUILTIN = [
    { id: "chandelier", name: "Люстра", shape: "diamond", color: "#facc15", size: 180 },
    { id: "spot", name: "Спот", shape: "circle", color: "#fde68a", size: 60 },
    { id: "rect", name: "Прямоугольник", shape: "rect", color: "#fde68a", size: 120 },
    { id: "line", name: "Линейный", shape: "line", color: "#fef08a", size: 40 },
  ];

  function portSignal(node, portId) {
    if (!node) return "num";
    const id = String(portId || "");
    if (node.type === "planner" && (id === "plan" || id.startsWith("plan:"))) return "plan";
    if ((node.type === "openings" || node.type === "electrics") && (id === PLAN_PORT || id.startsWith("plan:"))) return "plan";
    if (node.type === "joint") return node.signal === "plan" ? "plan" : "num";
    if (node.type === "bus") {
      const laneId = id.startsWith("in:") ? id.slice(3) : id.startsWith("out:") ? id.slice(4) : "";
      const lane = (node.lanes || []).find((item) => item.id === laneId);
      return lane?.signal === "plan" ? "plan" : "num";
    }
    return "num";
  }

  function markHex(value, fallback) {
    const color = String(value || "").trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(color) ? color : fallback;
  }

  function markLetters(value) {
    return String(value || "").trim().slice(0, 3);
  }

  function customTypeList(kind) {
    const calc = ensureState();
    const key = kind === "light" ? "lightTypes" : "socketTypes";
    if (!calc) return [];
    if (!Array.isArray(calc[key])) calc[key] = [];
    const list = [];
    calc[key].forEach((raw) => {
      if (!raw || typeof raw !== "object" || list.length >= 40) return;
      let id = String(raw.id || "").trim();
      if (!id || list.some((item) => item.id === id)) id = `c-${uid()}`;
      const name = String(raw.name || "").trim().slice(0, 32);
      if (!name) return;
      if (kind === "light") {
        const shape = ["square", "diamond", "rect", "line"].includes(raw.shape) ? raw.shape : "circle";
        list.push({
          id,
          name,
          shape,
          color: markHex(raw.color, "#facc15"),
          size: Math.round(plannerClamp(plannerNum(raw.size, 120), 20, 800)),
        });
        return;
      }
      const letters = markLetters(raw.letters);
      if (!letters) return;
      list.push({
        id,
        name,
        letters,
        color: markHex(raw.color, "#a78bfa"),
        size: Math.round(plannerClamp(plannerNum(raw.size, 80), 20, 400)),
      });
    });
    calc[key] = list;
    return list;
  }

  function markLabels() {
    const calc = ensureState();
    if (!calc) return {};
    if (!calc.labels || typeof calc.labels !== "object") calc.labels = {};
    return calc.labels;
  }

  function markLabel(key, fallback) {
    const value = String(markLabels()[key] || "").trim();
    return value || fallback;
  }

  function openingCounterLabel(node, key, fallback) {
    const custom = String(node?.counterNames?.[key] || "").trim();
    return custom || markLabel(key, fallback);
  }

  function cardNameInput(id, kind, current, fallback) {
    return `<input class="mark-inline-name" data-card-name="${esc(id)}" data-card-kind="${kind}" data-label-fallback="${esc(fallback)}" maxlength="48" value="${esc(current || fallback)}" aria-label="Имя карточки" />`;
  }

  function typeOff() {
    const calc = ensureState();
    if (!calc) return [];
    if (!Array.isArray(calc.typeOff)) calc.typeOff = [];
    const allowed = new Set([
      ...SOCKET_BUILTIN.map((type) => `socket:${type.id}`),
      ...LIGHT_BUILTIN.map((type) => `light:${type.id}`),
    ]);
    calc.typeOff = calc.typeOff.filter((key, index) => allowed.has(key) && calc.typeOff.indexOf(key) === index).slice(0, 20);
    return calc.typeOff;
  }

  function presetCatalog(kind) {
    const builtins = kind === "light" ? LIGHT_BUILTIN : SOCKET_BUILTIN;
    const prefix = kind === "light" ? "light:" : "socket:";
    const off = new Set(typeOff());
    const stored = customTypeList(kind);
    const builtinIds = new Set(builtins.map((item) => item.id));
    const seeded = stored.some((item) => builtinIds.has(item.id));
    const out = [];
    const addBuiltin = (item) => {
      if (off.has(prefix + item.id) || out.some((row) => row.id === item.id)) return;
      out.push({ ...item, name: markLabel(prefix + item.id, item.name) });
    };
    if (seeded) {
      stored.forEach((item) => {
        if (off.has(prefix + item.id)) return;
        const builtin = builtins.find((row) => row.id === item.id);
        out.push(builtin ? { ...builtin, ...item, name: item.name || markLabel(prefix + item.id, builtin.name) } : item);
      });
      builtins.forEach(addBuiltin);
    } else {
      builtins.forEach(addBuiltin);
      stored.forEach((item) => {
        if (!builtinIds.has(item.id)) out.push(item);
      });
    }
    return out;
  }

  function savePresetList(kind, list) {
    const calc = ensureState();
    if (!calc) return;
    const key = kind === "light" ? "lightTypes" : "socketTypes";
    calc[key] = list.slice(0, 40).map((item) => (
      kind === "light"
        ? {
          id: item.id,
          name: String(item.name || "").trim().slice(0, 32),
          shape: ["square", "diamond", "rect", "line", "circle"].includes(item.shape) ? item.shape : "circle",
          color: markHex(item.color, "#facc15"),
          size: Math.round(plannerClamp(plannerNum(item.size, 120), 20, 800)),
        }
        : {
          id: item.id,
          name: String(item.name || "").trim().slice(0, 32),
          letters: markLetters(item.letters),
          color: markHex(item.color, "#a78bfa"),
          size: Math.round(plannerClamp(plannerNum(item.size, 80), 20, 400)),
        }
    )).filter((item) => item.id && item.name && (kind === "light" || item.letters));
  }

  function patchPreset(kind, id, patch) {
    const list = presetCatalog(kind).map((item) => (item.id === id ? { ...item, ...patch } : item));
    savePresetList(kind, list);
  }

  function movePreset(kind, id, targetId, before) {
    const list = presetCatalog(kind);
    const from = list.findIndex((item) => item.id === id);
    if (from < 0 || id === targetId) return;
    const [item] = list.splice(from, 1);
    let to = list.findIndex((row) => row.id === targetId);
    if (to < 0) to = list.length;
    else if (!before) to += 1;
    list.splice(to, 0, item);
    savePresetList(kind, list);
  }

  function socketCatalog() {
    return presetCatalog("socket");
  }

  function lightCatalog() {
    return presetCatalog("light");
  }

  function socketById(id) {
    return socketCatalog().find((item) => item.id === id) || SOCKET_BUILTIN.find((item) => item.id === id) || null;
  }

  function lightById(id) {
    return lightCatalog().find((item) => item.id === id) || LIGHT_BUILTIN.find((item) => item.id === id) || null;
  }

  function dropPreset(kind, id) {
    const calc = ensureState();
    if (!calc || !id) return;
    const key = kind === "light" ? "lightTypes" : "socketTypes";
    calc[key] = (calc[key] || []).filter((item) => item && item.id !== id);
    const builtins = kind === "light" ? LIGHT_BUILTIN : SOCKET_BUILTIN;
    if (builtins.some((item) => item.id === id)) {
      const mark = `${kind}:${id}`;
      if (!typeOff().includes(mark)) calc.typeOff.push(mark);
    }
  }

  function blueprintOf(node) {
    const calc = ensureState();
    return (calc?.blueprints || []).find((bp) => (bp.nodes || []).some((item) => item.id === node?.id)) || activeBlueprint();
  }

  function planWallName(plan, wall, index) {
    return plan?.wallNames?.[wall.id] || `Стена ${index + 1}`;
  }

  function emitPlan(node, bp, stack, values, fromPort) {
    if (!node || !bp) return null;
    const chain = stack || [];
    if (chain.includes(node.id)) return null;
    const next = chain.concat(node.id);
    if (node.type === "planner") {
      ensurePlanner(node);
      const layout = (node.layouts || []).find((item) => plannerPort(item, "plan") === fromPort) || plannerActive(node);
      if (!layout) return null;
      const walls = plannerWalls(layout);
      const wallNames = {};
      walls.forEach((wall, index) => {
        const out = (layout.outs || []).find((item) => item.id === wall.id);
        wallNames[wall.id] = plannerWallName(out, index);
      });
      return {
        height: layout.height,
        color: markHex(layout.color || node.color, "#65a30d"),
        points: layout.points.map((p) => ({ id: p.id, x: p.x, y: p.y })),
        wallNames,
        openings: [],
      };
    }
    if (node.type === "openings") {
      ensureOpenings(node);
      const feed = (node.feeds || []).find((item) => feedPort(item) === fromPort) || node.feeds?.[0];
      if (!feed) return null;
      const base = upstreamPlan(node, bp, next, values, feedPort(feed));
      if (!base) return null;
      const holes = node.holes.filter((hole) => hole.feed === feed.id).map((hole) => resolveHole(hole, base, node, values));
      return {
        height: base.height,
        color: base.color,
        points: base.points.map((p) => ({ id: p.id, x: p.x, y: p.y })),
        wallNames: base.wallNames,
        openings: (base.openings || []).concat(holes),
      };
    }
    return null;
  }

  function upstreamPlan(node, bp, stack, values, portId) {
    let port = portId || PLAN_PORT;
    if (!portId && (node?.type === "openings" || node?.type === "electrics")) {
      if (node.type === "openings") ensureOpenings(node);
      else ensureElectrics(node);
      const hit = (node.feeds || []).find((feed) => (bp?.links || []).some((link) => link.to === node.id && link.toPort === feedPort(feed)));
      if (hit) port = feedPort(hit);
    }
    const link = (bp?.links || []).find((item) => item.to === node?.id && item.toPort === port);
    if (!link) return null;
    const src = (bp.nodes || []).find((item) => item.id === link.from);
    if (!src || portSignal(src, link.fromPort) !== "plan") return null;
    return emitPlan(src, bp, stack || [], values || {}, link.fromPort);
  }

  function resolveHole(raw, plan, node, values) {
    const hole = {
      id: raw.id,
      name: String(raw.name || "").trim().slice(0, 48),
      surface: raw.surface === "floor" || raw.surface === "ceiling" ? raw.surface : "wall",
      wallId: String(raw.wallId || ""),
      along: plannerNum(raw.along, 0),
      rise: plannerNum(raw.rise, 0),
      x: plannerNum(raw.x, 0),
      y: plannerNum(raw.y, 0),
      w: plannerNum(raw.w, 0.9),
      h: plannerNum(raw.h, 2.1),
      d: plannerNum(raw.d, 0.11),
      picked: raw.picked !== false,
      shape: raw.shape === "circle" ? "circle" : "rect",
      local: true,
    };
    const read = (field) => {
      if (!raw.bind?.[field] || !node) return null;
      const value = values?.[`${node.id}:b:${raw.id}:${field}`];
      return Number.isFinite(value) ? value : null;
    };
    if (hole.shape === "circle") {
      const mm = read("d");
      if (mm != null) hole.d = plannerClamp(mm / 1000, 0.005, 5);
    } else {
      const width = read("w");
      const height = read("h");
      if (width != null) hole.w = plannerClamp(width, 0.05, 500);
      if (height != null) hole.h = plannerClamp(height, 0.05, 30);
    }
    const walls = plan ? plannerWalls(plan) : [];
    const wall = walls.find((item) => item.id === hole.wallId) || null;
    const roomH = plan?.height || 2.7;
    if (hole.surface === "wall" && wall) {
      if (hole.shape === "circle") {
        hole.along = plannerClamp(hole.along, 0, wall.len);
        hole.rise = plannerClamp(hole.rise, 0, roomH);
      } else {
        hole.w = plannerClamp(hole.w, 0.05, wall.len);
        hole.h = plannerClamp(hole.h, 0.05, roomH);
        if (hole.along < 0) hole.along = 0;
        if (hole.rise < 0) hole.rise = 0;
        if (hole.along + hole.w > wall.len + 0.0001) hole.along = Math.max(0, wall.len - hole.w);
        if (hole.rise + hole.h > roomH + 0.0001) hole.rise = Math.max(0, roomH - hole.h);
        if (hole.rise <= 0.02) hole.rise = 0;
      }
    }
    hole.along = plannerRound(hole.along);
    hole.rise = plannerRound(hole.rise);
    hole.x = plannerRound(hole.x);
    hole.y = plannerRound(hole.y);
    hole.w = plannerRound(hole.w);
    hole.h = plannerRound(hole.h);
    hole.d = plannerRound(hole.d);
    if (hole.shape === "circle") hole.role = "pipe";
    else if (hole.surface === "wall" && hole.rise <= 0.02) hole.role = "door";
    else if (hole.surface === "wall") hole.role = "window";
    else hole.role = "hatch";
    return hole;
  }

  function rectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    const x0 = Math.max(ax, bx);
    const y0 = Math.max(ay, by);
    const x1 = Math.min(ax + aw, bx + bw);
    const y1 = Math.min(ay + ah, by + bh);
    if (x1 <= x0 || y1 <= y0) return 0;
    return (x1 - x0) * (y1 - y0);
  }

  function circleInRect(cx, cy, r, x0, y0, x1, y1) {
    if (!(r > 0)) return 0;
    const n = 24;
    const step = (r * 2) / n;
    let hit = 0;
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        const x = cx - r + (i + 0.5) * step;
        const y = cy - r + (j + 0.5) * step;
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > r * r) continue;
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) hit += 1;
      }
    }
    return hit * step * step;
  }

  function wallRemain(wall, height, holes) {
    const mine = (holes || []).filter((hole) => hole.surface === "wall" && hole.wallId === wall.id);
    const full = mine.filter((hole) => hole.role === "door" && hole.along <= 0.03 && hole.w >= wall.len - 0.03);
    const cut = (hole, y0, y1) => {
      if (hole.shape === "circle") return circleInRect(hole.along, hole.rise, hole.d / 2, 0, y0, wall.len, y1);
      return rectOverlap(hole.along, hole.rise, hole.w, hole.h, 0, y0, wall.len, y1 - y0);
    };
    if (full.length) {
      const top = Math.max(...full.map((hole) => Math.min(height, hole.rise + hole.h)));
      let area = wall.len * Math.max(0, height - top);
      mine.forEach((hole) => {
        if (full.includes(hole)) return;
        area -= cut(hole, top, height);
      });
      return Math.max(0, plannerRound(area));
    }
    let area = wall.len * height;
    mine.forEach((hole) => {
      area -= cut(hole, 0, height);
    });
    return Math.max(0, plannerRound(area));
  }

  function markToneInputs() {
    return "";
  }

  function markRotateHue(value, shift) {
    const hex = markHex(value, "#65a30d");
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let h = 0;
    if (delta) {
      if (max === r) h = 60 * (((g - b) / delta) % 6);
      else if (max === g) h = 60 * ((b - r) / delta + 2);
      else h = 60 * ((r - g) / delta + 4);
    }
    h = (h + shift + 360) % 360;
    const l = (max + min) / 2;
    const sat = delta ? delta / (1 - Math.abs(2 * l - 1)) : 0;
    const c = (1 - Math.abs(2 * l - 1)) * sat;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return "#" + rgb.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
  }

  function markTones(node, plannerColor) {
    const floor = markHex(plannerColor, "#65a30d");
    return { floor, ceiling: markRotateHue(floor, 120), wall: markRotateHue(floor, 240) };
  }

  function ensureOpenings(node) {
    delete node.tones;
    delete node.color;
    if (!Array.isArray(node.holes)) node.holes = [];
    const holes = [];
    node.holes.forEach((raw) => {
      if (!raw || typeof raw !== "object" || holes.length >= 80) return;
      let id = String(raw.id || "").trim();
      if (!id || holes.some((item) => item.id === id)) id = uid();
      const shape = raw.shape === "circle" ? "circle" : "rect";
      const surface = raw.surface === "floor" || raw.surface === "ceiling" ? raw.surface : "wall";
      holes.push({
        id,
        surface,
        wallId: String(raw.wallId || ""),
        along: plannerRound(plannerClamp(plannerNum(raw.along, 0.4), -500, 500)),
        rise: plannerRound(plannerClamp(plannerNum(raw.rise, 0), -500, 500)),
        x: plannerRound(plannerClamp(plannerNum(raw.x, 0), -500, 500)),
        y: plannerRound(plannerClamp(plannerNum(raw.y, 0), -500, 500)),
        w: plannerRound(plannerClamp(plannerNum(raw.w, 0.9), 0.05, 500)),
        h: plannerRound(plannerClamp(plannerNum(raw.h, 2.1), 0.05, 30)),
        d: plannerRound(plannerClamp(plannerNum(raw.d, 0.11), 0.005, 5)),
        shape,
        bind: { w: !!raw.bind?.w, h: !!raw.bind?.h, d: !!raw.bind?.d },
        picked: raw.picked !== false,
        name: String(raw.name || "").trim().slice(0, 48),
        feed: String(raw.feed || ""),
      });
    });
    node.holes = holes;
    ensureFeeds(node);
    const feedIds = new Set(node.feeds.map((feed) => feed.id));
    const firstFeed = node.feeds[0].id;
    node.holes.forEach((hole) => {
      if (!feedIds.has(hole.feed)) hole.feed = firstFeed;
    });
    if (!node.counterNames || typeof node.counterNames !== "object" || Array.isArray(node.counterNames)) node.counterNames = {};
    if (!Array.isArray(node.owns)) node.owns = [];
    if (!node.outOn || typeof node.outOn !== "object" || Array.isArray(node.outOn)) node.outOn = {};
    node.name = String(node.name || "").trim().slice(0, 48) || "Проёмы";
    return node;
  }

  function ensureElectrics(node) {
    delete node.tones;
    delete node.color;
    if (!Array.isArray(node.fixtures)) node.fixtures = [];
    const list = [];
    node.fixtures.forEach((raw) => {
      if (!raw || typeof raw !== "object" || list.length >= 120) return;
      let id = String(raw.id || "").trim();
      if (!id || list.some((item) => item.id === id)) id = uid();
      const kind = raw.kind === "light" ? "light" : "socket";
      const surface = raw.surface === "floor" || raw.surface === "ceiling" ? raw.surface : "wall";
      const cells = [];
      (Array.isArray(raw.cells) ? raw.cells : ["socket"]).forEach((cell) => {
        const key = String(cell || "").trim();
        if (key && cells.length < 6) cells.push(key);
      });
      if (!cells.length) cells.push("socket");
      list.push({
        id,
        kind,
        surface,
        wallId: String(raw.wallId || ""),
        along: plannerRound(plannerClamp(plannerNum(raw.along, 0.5), -500, 500)),
        rise: plannerRound(plannerClamp(plannerNum(raw.rise, 0.3), -500, 500)),
        x: plannerRound(plannerClamp(plannerNum(raw.x, 0), -500, 500)),
        y: plannerRound(plannerClamp(plannerNum(raw.y, 0), -500, 500)),
        orient: raw.orient === "v" ? "v" : "h",
        cells,
        light: String(raw.light || "chandelier"),
        name: String(raw.name || "").trim().slice(0, 48),
        lw: plannerRound(plannerClamp(plannerNum(raw.lw, 0.6), 0.05, 8)),
        ll: plannerRound(plannerClamp(plannerNum(raw.ll, 1.2), 0.05, 12)),
        angle: lightAngle(raw),
        feed: String(raw.feed || ""),
      });
    });
    node.fixtures = list;
    ensureFeeds(node);
    const feedIds = new Set(node.feeds.map((feed) => feed.id));
    const firstFeed = node.feeds[0].id;
    node.fixtures.forEach((fix) => {
      if (!feedIds.has(fix.feed)) fix.feed = firstFeed;
    });
    if (!node.outOn || typeof node.outOn !== "object") node.outOn = {};
    node.name = String(node.name || "").trim().slice(0, 48) || "Электрика";
    return node;
  }

  function markShown(node, id, linked, present) {
    if (linked?.has(id)) return true;
    if (node.outOn && Object.prototype.hasOwnProperty.call(node.outOn, id)) return !!node.outOn[id];
    return !!present;
  }

  function markChecked(node, id, fallback) {
    if (node.outOn && Object.prototype.hasOwnProperty.call(node.outOn, id)) return !!node.outOn[id];
    return !!fallback;
  }

  function holeLabel(hole, index) {
    const custom = String(hole.name || "").trim();
    if (custom) return custom;
    const role = hole.shape === "circle" || hole.role === "pipe" ? "Труба" : hole.rise <= 0.02 && hole.surface !== "floor" && hole.surface !== "ceiling" ? "Дверь" : hole.surface === "wall" ? "Окно" : "Люк";
    return `${role} ${index + 1}`;
  }

  function openingInputs(node) {
    ensureOpenings(node);
    const ports = node.feeds.map((feed) => ({ id: feedPort(feed), name: "Чертёж", signal: "plan", feed: feed.id }));
    node.holes.forEach((hole, index) => {
      const fields = hole.shape === "circle" ? [["d", "диаметр, мм"]] : [["w", "ширина, м"], ["h", "высота, м"]];
      fields.forEach(([field, title]) => {
        if (!hole.bind?.[field]) return;
        ports.push({ id: `b:${hole.id}:${field}`, name: `${holeLabel(hole, index)} · ${title}` });
      });
    });
    return ports;
  }

  function openingFeedPorts(node, bp, values, links, feed, all) {
    const host = bp || blueprintOf(node);
    const plan = host ? emitPlan(node, host, [], values || {}, feedPort(feed)) : null;
    if (!plan) return [];
    const linked = linkedFromPorts(node.id, links || host?.links || []);
    const ports = [{ id: feedPort(feed), name: feedTitle(node, feed, host), signal: "plan", feed: feed.id }];
    plannerWalls(plan).forEach((wall, index) => {
      const id = feedKey(feed, "wall", wall.id);
      if (!all && !markShown(node, id, linked, false)) return;
      ports.push({
        id,
        name: planWallName(plan, wall, index),
        value: wallRemain(wall, plan.height, plan.openings),
        unit: "м²",
        feed: feed.id,
      });
    });
    const holes = plan.openings || [];
    [
      ["pick", "pick", "Проёмы", holes.filter((hole) => hole.picked !== false).length, false],
      ["door", "doors", "Двери", holes.filter((hole) => hole.role === "door").length, false],
      ["window", "windows", "Окна", holes.filter((hole) => hole.role === "window").length, false],
      ["pipe", "pipes", "Трубы", holes.filter((hole) => hole.role === "pipe").length, false],
      ["hatch", "hatches", "Люки", holes.filter((hole) => hole.role === "hatch").length, false],
    ].forEach(([key, labelKey, fallback, value, present]) => {
      const id = feedKey(feed, "count", key);
      if (!all && !markShown(node, id, linked, present)) return;
      ports.push({ id, name: openingCounterLabel(node, labelKey, fallback), value, unit: "шт", feed: feed.id });
    });
    (node.owns || []).forEach((own) => {
      const id = feedKey(feed, "own", own.id);
      const have = new Set((node.holes || []).filter((hole) => hole.feed === feed.id).map((hole) => hole.id));
      const value = (own.holes || []).filter((holeId) => have.has(holeId)).length;
      if (!all && !markShown(node, id, linked, true)) return;
      ports.push({ id, name: String(own.name || "Свой").slice(0, 48), value, unit: "шт", feed: feed.id });
    });
    return ports;
  }

  function openingOutputs(node, bp, values, links) {
    ensureOpenings(node);
    const host = bp || blueprintOf(node);
    const ports = [];
    const catalog = [];
    node.feeds.forEach((feed) => {
      if (!upstreamPlan(node, host, [], values || {}, feedPort(feed))) return;
      ports.push(...openingFeedPorts(node, host, values, links, feed, false));
      catalog.push(...openingFeedPorts(node, host, values, links, feed, true));
    });
    appendCommons(node, ports, linkedFromPorts(node.id, links || host?.links || []), catalog);
    return ports;
  }

  function electricInputs(node) {
    ensureElectrics(node);
    return node.feeds.map((feed) => ({ id: feedPort(feed), name: "Чертёж", signal: "plan", feed: feed.id }));
  }

  function frameKey(fix) {
    return String(Math.max(1, (fix.cells || []).length));
  }

  function frameLabel(fix) {
    return `${markLabel("frame", "Рамка")} · ${frameKey(fix)}`;
  }

  function electricFeedPorts(node, bp, links, feed, all) {
    const host = bp || blueprintOf(node);
    if (!upstreamPlan(node, host, [], {}, feedPort(feed))) return [];
    const linked = linkedFromPorts(node.id, links || host?.links || []);
    const ports = [];
    const counts = new Map();
    const frames = new Map();
    node.fixtures.filter((fix) => fix.feed === feed.id).forEach((fix) => {
      if (fix.kind === "light") return;
      const key = frameKey(fix);
      const frameId = feedKey(feed, "frame", key);
      if (!frames.has(frameId)) frames.set(frameId, { id: frameId, name: frameLabel(fix), value: 0, n: Number(key) });
      frames.get(frameId).value += 1;
      (fix.cells || []).forEach((typeId) => {
        const type = socketById(typeId);
        const id = feedKey(feed, "type", typeId);
        if (!counts.has(id)) counts.set(id, { id, name: type?.name || "Розетка", value: 0 });
        counts.get(id).value += 1;
      });
    });
    counts.forEach((row) => {
      if (all || markShown(node, row.id, linked, row.value > 0)) ports.push({ ...row, unit: "шт", feed: feed.id });
    });
    [...frames.values()]
      .sort((a, b) => a.n - b.n)
      .forEach((row) => {
        if (all || markShown(node, row.id, linked, row.value > 0)) ports.push({ id: row.id, name: row.name, value: row.value, unit: "шт", feed: feed.id });
      });
    return ports;
  }

  function electricOutputs(node, bp, values, links) {
    ensureElectrics(node);
    const host = bp || blueprintOf(node);
    const ports = [];
    const catalog = [];
    node.feeds.forEach((feed) => {
      ports.push(...electricFeedPorts(node, host, links, feed, false));
      catalog.push(...electricFeedPorts(node, host, links, feed, true));
    });
    appendCommons(node, ports, linkedFromPorts(node.id, links || host?.links || []), catalog);
    return ports;
  }

  function markNodeTitle(node) {
    if (!node) return "Нода";
    if (node.type === "planner") return plannerName(node);
    if (node.type === "openings") return node.name || "Проёмы";
    if (node.type === "electrics") return node.name || "Электрика";
    if (node.type === "const") return "Константа";
    if (node.type === "result") return node.name || "Результат";
    if (node.type === "math") return "Оператор";
    if (node.type === "formula") return "Формула";
    if (node.type === "percent") return "Процент";
    if (node.type === "filter") return "Фильтр";
    if (node.type === "dashboard") return "Дашборд";
    if (node.type === "order") return "Заказ";
    if (node.type === "scheme") return "Схема";
    return "Нода";
  }

  function planPortRow(io) {
    const side = io === "in" ? "in" : "out";
    return `<div class="calc-row ${side}">
      ${side === "in" ? `<i class="calc-port in" data-port="plan" data-io="in" data-signal="plan" title="Чертёж"></i>` : ""}
      <span class="calc-row-name">Чертёж</span>
      ${side === "out" ? `<b class="calc-plan-tag">план</b><i class="calc-port out" data-port="plan" data-io="out" data-signal="plan" title="Чертёж"></i>` : ""}
    </div>`;
  }

  function countRows(node, ports, graph) {
    return (ports || [])
      .filter((port) => port.signal !== "plan")
      .map((port) => {
        const value = graph?.values?.[`${node.id}:${port.id}`];
        const shown = value != null && Number.isFinite(value) ? value : port.value;
        const unit = port.unit || "";
        return `<div class="calc-row out">
          <span class="calc-row-name" title="${esc(port.name)}">${esc(port.name)}</span>
          <b>${esc(fmtShort(shown))}${unit ? ` <small>${esc(unit)}</small>` : ""}</b>
          <i class="calc-port out" data-port="${esc(port.id)}" data-io="out" title="${esc(port.name)}"></i>
        </div>`;
      })
      .join("");
  }

  function filmItems(plan) {
    const walls = plannerWalls(plan);
    return [{ id: "floor", name: "Пол" }, { id: "ceiling", name: "Потолок" }].concat(
      walls.map((wall, index) => ({ id: wall.id, name: planWallName(plan, wall, index), wall }))
    );
  }

  function surfaceThumb(plan, item, holes, fixtures, tones) {
    const vw = 64;
    const vh = 46;
    const pad = 3;
    if (!plan?.points?.length) return "";
    if (item.id === "floor" || item.id === "ceiling") {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      plan.points.forEach((p) => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      });
      const spanX = Math.max(0.05, maxX - minX);
      const spanY = Math.max(0.05, maxY - minY);
      const scale = Math.min((vw - pad * 2) / spanX, (vh - pad * 2) / spanY);
      const ox = (vw - spanX * scale) / 2 - minX * scale;
      const oy = (vh - spanY * scale) / 2 - minY * scale;
      const d = plan.points
        .map((p, i) => `${i ? "L" : "M"}${(ox + p.x * scale).toFixed(1)} ${(oy + p.y * scale).toFixed(1)}`)
        .join("") + "Z";
      const marks = (holes || [])
        .filter((hole) => hole.surface === item.id)
        .map((hole) => {
          const x = ox + (hole.x + (hole.shape === "circle" ? 0 : hole.w / 2)) * scale;
          const y = oy + (hole.y + (hole.shape === "circle" ? 0 : hole.h / 2)) * scale;
          return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2"/>`;
        })
        .join("");
      const lights = (fixtures || [])
        .filter((fix) => fix.surface === item.id)
        .map((fix) => `<circle cx="${(ox + fix.x * scale).toFixed(1)}" cy="${(oy + fix.y * scale).toFixed(1)}" r="2.4"/>`)
        .join("");
      const tone = item.id === "ceiling" ? (tones?.ceiling || "var(--mark-ceiling, #eab308)") : (tones?.floor || "var(--mark-floor, #38bdf8)");
      return `<svg class="calc-film-thumb" style="--film-tone:${tone}" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><path d="${d}"/>${marks}${lights}</svg>`;
    }
    const wall = item.wall;
    if (!wall) return "";
    const len = Math.max(wall.len, 0.2);
    const height = Math.max(plan.height || 2.7, 0.2);
    const scale = Math.min((vw - pad * 2) / len, (vh - pad * 2) / height);
    const ox = (vw - len * scale) / 2;
    const oy = (vh - height * scale) / 2;
    const at = (along, rise) => ({ x: ox + along * scale, y: oy + (height - rise) * scale });
    const cuts = (holes || [])
      .filter((hole) => hole.surface === "wall" && hole.wallId === wall.id)
      .map((hole) => {
        if (hole.shape === "circle") {
          const c = at(hole.along, hole.rise);
          return `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${Math.max(1.6, (hole.d / 2) * scale).toFixed(1)}"/>`;
        }
        const p = at(hole.along, hole.rise + hole.h);
        const q = at(hole.along + hole.w, hole.rise);
        return `<rect x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" width="${Math.max(1, q.x - p.x).toFixed(1)}" height="${Math.max(1, q.y - p.y).toFixed(1)}"/>`;
      })
      .join("");
    const dots = (fixtures || [])
      .filter((fix) => fix.surface === "wall" && fix.wallId === wall.id)
      .map((fix) => {
        const c = at(fix.along, fix.rise);
        return `<rect x="${(c.x - 2).toFixed(1)}" y="${(c.y - 2).toFixed(1)}" width="4" height="4"/>`;
      })
      .join("");
    const box = at(0, height);
    const wallTone = tones?.wall || "var(--mark-wall, #94a3b8)";
    return `<svg class="calc-film-thumb is-wall" style="--film-tone:${wallTone}" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><rect class="calc-film-wall" x="${box.x.toFixed(1)}" y="${box.y.toFixed(1)}" width="${(len * scale).toFixed(1)}" height="${(height * scale).toFixed(1)}"/>${cuts}${dots}</svg>`;
  }

  function planLocateSvg(plan, wallId) {
    const walls = plannerWalls(plan);
    if (!plan?.points?.length || !walls.length) return "";
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    plan.points.forEach((p) => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    const vw = 160;
    const vh = 120;
    const pad = 12;
    const spanX = Math.max(0.05, maxX - minX);
    const spanY = Math.max(0.05, maxY - minY);
    const scale = Math.min((vw - pad * 2) / spanX, (vh - pad * 2) / spanY);
    const ox = (vw - spanX * scale) / 2 - minX * scale;
    const oy = (vh - spanY * scale) / 2 - minY * scale;
    const d = plan.points.map((p, i) => `${i ? "L" : "M"}${(ox + p.x * scale).toFixed(1)} ${(oy + p.y * scale).toFixed(1)}`).join("") + "Z";
    const lines = walls
      .map((wall) => {
        const x1 = ox + wall.a.x * scale;
        const y1 = oy + wall.a.y * scale;
        const x2 = ox + wall.b.x * scale;
        const y2 = oy + wall.b.y * scale;
        return `<line data-locate-wall="${esc(wall.id)}" class="${wall.id === wallId ? "is-on" : ""}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
      })
      .join("");
    return `<svg viewBox="0 0 ${vw} ${vh}" aria-hidden="true"><path d="${d}"/>${lines}</svg>`;
  }

  function filmStrip(plan, nodeId, active, holes, fixtures, tones) {
    if (!plan?.points?.length) return `<div class="calc-empty">Нет чертежа</div>`;
    return filmItems(plan)
      .map((item) => {
        const open = nodeId ? ` data-mark-open="${esc(nodeId)}"` : "";
        return `<button type="button" class="calc-film-card ${item.id === active ? "is-on" : ""}"${open} data-mark-surface="${esc(item.id)}"><span class="calc-film-name">${esc(item.name)}</span>${surfaceThumb(plan, item, holes, fixtures, tones)}</button>`;
      })
      .join("");
  }

  function planPairRow(portId, linked, outPort) {
    const out = outPort
      ? `<b class="calc-plan-tag">${esc(outPort.name)}</b><i class="calc-port out" data-port="${esc(outPort.id)}" data-io="out" data-signal="plan" title="${esc(outPort.name)}"></i>`
      : "";
    return `<div class="calc-row both${linked ? "" : " is-idle"}">
      <i class="calc-port in" data-port="${esc(portId)}" data-io="in" data-signal="plan" title="Чертёж"></i>
      <span>Чертёж</span>
      ${out}
    </div>`;
  }

  function ruPlans(n) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return `${n} чертёж`;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} чертежа`;
    return `${n} чертежей`;
  }

  function commonBlockHtml(node, ports, graph, rowHtml) {
    const byId = new Map((ports || []).filter((port) => port.common).map((port) => [port.id, port]));
    let body = "";
    let any = false;
    (node.commons || []).forEach((row) => {
      if (row.kind === "sep") {
        body += `<div class="calc-common-rule"></div>`;
        any = true;
        return;
      }
      const port = byId.get(`common:${row.id}`);
      if (!port) return;
      body += rowHtml(port);
      any = true;
    });
    return `<div class="calc-sec">Общий вывод</div>${any ? body : `<div class="calc-empty">Соберите в редакторе</div>`}`;
  }

  function markCardHtml(node, bp, graph) {
    const electrics = node.type === "electrics";
    if (electrics) ensureElectrics(node);
    else ensureOpenings(node);
    const outputs = electrics ? electricOutputs(node, bp, graph.values, bp.links) : openingOutputs(node, bp, graph.values, bp.links);
    const inputs = electrics ? electricInputs(node) : openingInputs(node);
    const ready = node.feeds.filter((feed) => upstreamPlan(node, bp, [], graph.values, feedPort(feed)));
    const first = ready[0] ? upstreamPlan(node, bp, [], graph.values, feedPort(ready[0])) : null;
    const tones = markTones(node, first?.color);
    let sub = "нет чертежа";
    if (ready.length > 1) sub = ruPlans(ready.length);
    else if (first && electrics) {
      const mine = node.fixtures.filter((item) => item.feed === ready[0].id && item.kind !== "light");
      const sockets = mine.reduce((sum, item) => sum + (item.cells || []).length, 0);
      sub = `${sockets} шт. · ${mine.length} рамок`;
    } else if (first) {
      const drawn = emitPlan(node, bp, [], graph.values, feedPort(ready[0]));
      sub = `${plannerWalls(first).length} стен · ${(drawn?.openings || []).length} проёмов`;
    }
    const blocks = node.feeds.map((feed) => {
      const plan = upstreamPlan(node, bp, [], graph.values, feedPort(feed));
      const linked = (bp.links || []).some((link) => link.to === node.id && link.toPort === feedPort(feed));
      if (!plan && !linked) {
        if (feed !== node.feeds[node.feeds.length - 1]) return "";
        return `<div class="calc-plan-group">${planPairRow(feedPort(feed), false, null)}</div>`;
      }
      const feedTones = markTones(node, plan?.color || tones.floor);
      const feedPorts = outputs.filter((port) => port.feed === feed.id && !port.common);
      const caption = plan ? `<div class="calc-film-label">${esc(feedTitle(node, feed, bp))}</div>` : "";
      const film = plan
        ? `${caption}<div class="calc-film calc-film-top" data-mark-feed="${esc(feed.id)}">${filmStrip(plan, node.id, "", electrics ? (plan.openings || []) : (emitPlan(node, bp, [], graph.values, feedPort(feed))?.openings || []), electrics ? node.fixtures.filter((fix) => fix.feed === feed.id) : [], feedTones)}</div>`
        : "";
      const binds = electrics ? "" : inputs.filter((port) => {
        const hole = node.holes.find((item) => port.id.startsWith(`b:${item.id}:`));
        return hole && hole.feed === feed.id;
      }).map((port) => {
        const value = graph.values[`${node.id}:${port.id}`];
        const taken = (bp.links || []).some((link) => link.to === node.id && link.toPort === port.id);
        return `<div class="calc-row in">
          <i class="calc-port in" data-port="${esc(port.id)}" data-io="in" title="${esc(port.name)}"></i>
          <span>${esc(port.name)}</span>
          <b>${esc(fmtShort(value))}</b>
          ${taken ? `<button type="button" class="calc-mini" data-del-in-link="${esc(port.id)}" title="Удалить связь">×</button>` : ""}
        </div>`;
      }).join("");
      const plans = feedPorts.filter((port) => port.signal === "plan");
      const nums = countRows(node, feedPorts, graph);
      return `<div class="calc-plan-group" style="--planner-color:${esc(feedTones.floor)}">${film}${planPairRow(feedPort(feed), linked, plans[0] || null)}${binds}${nums}</div>`;
    }).join("");
    const commons = outputs.filter((port) => port.common);
    const title = electrics ? "Имя электрики" : "Имя проёмов";
    const edit = electrics ? "Розетки и свет" : "Проёмы на чертеже";
    const filmsTitle = node.filmsOff ? "Показать ленты" : "Скрыть ленты";
    return `<article class="calc-node ${electrics ? "is-electrics" : "is-openings"} ${node.filmsOff ? "is-films-off" : ""} ${nodeSelected(node.id) ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px;--planner-color:${esc(tones.floor)};--mark-floor:${esc(tones.floor)};--mark-ceiling:${esc(tones.ceiling)};--mark-wall:${esc(tones.wall)}">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <input class="calc-pname calc-planner-name" data-mark-title="${esc(node.id)}" value="${esc(node.name)}" maxlength="48" spellcheck="false" title="${esc(node.name)}" aria-label="${title}" />
        ${markToneInputs(node)}
        <button type="button" class="calc-films-toggle" data-films-toggle="${esc(node.id)}" title="${filmsTitle}" aria-label="${filmsTitle}" aria-pressed="${node.filmsOff ? "false" : "true"}">
          <svg class="is-show" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2" y="6" width="6" height="12" rx="1.2" stroke="currentColor" stroke-width="1.8"/><rect x="9" y="6" width="6" height="12" rx="1.2" stroke="currentColor" stroke-width="1.8"/><rect x="16" y="6" width="6" height="12" rx="1.2" stroke="currentColor" stroke-width="1.8"/></svg>
          <svg class="is-hide" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2" y="6" width="6" height="12" rx="1.2" stroke="currentColor" stroke-width="1.8"/><rect x="9" y="6" width="6" height="12" rx="1.2" stroke="currentColor" stroke-width="1.8"/><rect x="16" y="6" width="6" height="12" rx="1.2" stroke="currentColor" stroke-width="1.8"/><path d="M4 20 20 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
        <button type="button" class="calc-text-btn" data-mark-edit="${esc(node.id)}" title="${edit}">Редактор</button>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <div class="calc-node-sub">${esc(sub)}</div>
      <div class="calc-ports">
        ${blocks}
        ${commonBlockHtml(node, commons, graph, (port) => countRows(node, [port], graph))}
      </div>
    </article>`;
  }

  function openingsNodeHtml(node, bp, graph) {
    return markCardHtml(node, bp, graph);
  }

  function electricsNodeHtml(node, bp, graph) {
    return markCardHtml(node, bp, graph);
  }

  function markNode() {
    const id = session.mark?.id;
    if (!id) return null;
    const node = (activeBlueprint()?.nodes || []).find((item) => item.id === id && (item.type === "openings" || item.type === "electrics")) || null;
    if (!node) {
      session.mark = null;
      $("mark-modal")?.classList.remove("open");
    }
    return node;
  }

  function markContext() {
    const node = markNode();
    const bp = activeBlueprint();
    if (!node || !bp) return null;
    const graph = computeGraph(bp);
    if (node.type === "openings") ensureOpenings(node);
    else ensureElectrics(node);
    const feed = activeFeed(node);
    const base = feed ? upstreamPlan(node, bp, [], graph.values, feedPort(feed)) : null;
    const full = node.type === "openings" && feed ? emitPlan(node, bp, [], graph.values, feedPort(feed)) : base;
    return { node, bp, graph, base, full, feed };
  }

  function markSurfaceOk(plan, surface) {
    if (surface === "floor" || surface === "ceiling") return surface;
    if (plan && plannerWalls(plan).some((wall) => wall.id === surface)) return surface;
    return "floor";
  }

  function openMark(nodeId, surface, feedId) {
    const bp = activeBlueprint();
    const node = bp?.nodes.find((item) => item.id === nodeId && (item.type === "openings" || item.type === "electrics"));
    if (!node) return;
    if (session.planner?.id) closePlanner();
    ensureMarkModal();
    if (node.type === "openings") ensureOpenings(node);
    else ensureElectrics(node);
    const linked = node.feeds.find((feed) => (bp.links || []).some((link) => link.to === node.id && link.toPort === feedPort(feed)));
    const feed = node.feeds.find((item) => item.id === feedId) || linked || node.feeds[0];
    const plan = upstreamPlan(node, bp, [], computeGraph(bp).values, feedPort(feed));
    session.mark = {
      id: nodeId,
      feed: feed?.id || "",
      view: "",
      surface: markSurfaceOk(plan, surface || node.view || "floor"),
      sel: "",
      orient: "h",
      section: 1,
      drag: null,
      snapEnabled: true,
      snapStep: EDITOR_SNAP_DEFAULT,
    };
    session.selected = nodeId;
    hidePortMenu();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    $("mark-modal")?.classList.add("open");
    editorSnapRefresh("mark");
    markHideMenu();
    editorBegin();
    requestAnimationFrame(() => markFill());
  }

  function closeMark() {
    const node = markNode();
    if (node) node.name = node.type === "electrics" ? ensureElectrics(node).name : ensureOpenings(node).name;
    editorEnd();
    session.mark = null;
    markHideMenu();
    $("mark-preset-modal")?.classList.remove("open");
    $("mark-modal")?.classList.remove("open");
    if (api?.view?.() === "calculator") render();
  }

  function markHideMenu() {
    const menu = $("mark-menu");
    if (menu) menu.hidden = true;
    const box = $("mark-nudge-box");
    if (box) box.hidden = true;
    if (session.mark) session.mark.menu = null;
  }

  function pruneMarkLinks(node) {
    const bp = activeBlueprint();
    if (!bp || !node) return;
    const graph = computeGraph(bp);
    const ports = node.type === "openings" ? openingOutputs(node, bp, graph.values, bp.links) : electricOutputs(node, bp, graph.values, bp.links);
    const ids = new Set(ports.map((port) => port.id));
    bp.links = (bp.links || []).filter((link) => link.from !== node.id || ids.has(link.fromPort));
    const inputs = new Set((node.type === "openings" ? openingInputs(node) : electricInputs(node)).map((port) => port.id));
    bp.links = bp.links.filter((link) => link.to !== node.id || inputs.has(link.toPort));
  }

  function fitOpenings(node) {
    const bp = activeBlueprint();
    if (!bp) return;
    const graph = computeGraph(bp);
    node.holes.forEach((hole) => {
      const feed = node.feeds.find((item) => item.id === hole.feed) || node.feeds[0];
      const plan = feed ? upstreamPlan(node, bp, [], graph.values, feedPort(feed)) : null;
      if (!plan) return;
      const live = resolveHole(hole, plan, node, graph.values);
      hole.along = live.along;
      hole.rise = live.rise;
      hole.x = live.x;
      hole.y = live.y;
      if (!hole.bind?.w) hole.w = live.w;
      if (!hole.bind?.h) hole.h = live.h;
      if (!hole.bind?.d) hole.d = live.d;
    });
  }

  function markCommit(rebuild) {
    const node = markNode();
    if (!node) return;
    if (node.type === "openings") {
      ensureOpenings(node);
      fitOpenings(node);
    } else ensureElectrics(node);
    pruneMarkLinks(node);
    if ($("mark-modal")?.classList.contains("open")) editorPush();
    else dirty();
    render();
    if (!$("mark-modal")?.classList.contains("open")) return;
    if (session.mark?.view === COMMON_VIEW) {
      if (rebuild) markFill();
      return;
    }
    if (rebuild) markFill();
    else markDraw();
  }

  function numericFeeds(exceptId, graph, bp) {
    const rows = [];
    (bp?.nodes || []).forEach((node) => {
      if (node.id === exceptId) return;
      const order = node.type === "order" ? api.findOrder(node.orderId) : null;
      nodeOutputs(node, order, bp.links).forEach((port) => {
        if (portSignal(node, port.id) === "plan") return;
        const value = graph?.values?.[`${node.id}:${port.id}`];
        rows.push({
          key: `${node.id}\t${port.id}`,
          label: `${markNodeTitle(node)} · ${port.name || port.id}${Number.isFinite(value) ? ` · ${fmtShort(value)}` : ""}`,
        });
      });
    });
    return rows;
  }

  function markSelect(attrs, name, options, current) {
    const label = options.find((item) => item.value === current)?.label || options[0]?.label || "—";
    const hidden = name ? `<input type="hidden" name="${esc(name)}" value="${esc(current)}" />` : "";
    const list = options
      .map((item) => `<button type="button" class="mark-opt ${item.value === current ? "is-on" : ""}" data-opt="${esc(item.value)}" ${attrs}>${esc(item.label)}</button>`)
      .join("");
    return `<div class="mark-select">${hidden}<button type="button" class="mark-select-btn" ${attrs}>${esc(label)}</button><div class="mark-select-list" hidden>${list}</div></div>`;
  }

  function placeMarkList(btn) {
    const list = btn.parentElement?.querySelector(".mark-select-list");
    const willOpen = !!list?.hidden;
    document.querySelectorAll(".mark-select-list").forEach((el) => { el.hidden = true; });
    if (!willOpen || !list) return;
    const rect = btn.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    list.hidden = false;
    list.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 228))}px`;
    list.style.width = `${Math.max(rect.width, 180)}px`;
    if (below < 200) {
      list.style.top = "auto";
      list.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    } else {
      list.style.bottom = "auto";
      list.style.top = `${rect.bottom + 4}px`;
    }
  }

  function markOnSurface(item, surface) {
    if (surface === "floor" || surface === "ceiling") return item.surface === surface;
    return item.surface === "wall" && item.wallId === surface;
  }

  function markSideHtml(ctx) {
    const { node, bp, graph, base, full } = ctx;
    const feeds = numericFeeds(node.id, graph, bp);
    const feedOpts = [{ value: "", label: "не назначено" }].concat(feeds.map((row) => ({ value: row.key, label: row.label })));
    const linkKey = (portId) => {
      const link = (bp.links || []).find((item) => item.to === node.id && item.toPort === portId);
      return link ? `${link.from}\t${link.fromPort}` : "";
    };
    const surface = session.mark?.surface || "floor";
    if (!base) {
      return `<div class="planner-block"><div class="planner-block-h">${node.type === "electrics" ? "Электрика" : "Проёмы"}</div><p class="planner-lead">Соедините вход «Чертёж» с выходом «Чертёж» планировщика${node.type === "electrics" ? " или проёмов" : ""}.</p></div>`;
    }
    if (node.type === "openings") {
      const walls = plannerWalls(base);
      const inherited = (base.openings || []).length;
      const holes = node.holes
        .map((hole, index) => ({ hole, index, live: resolveHole(hole, base, node, graph.values) }))
        .filter((item) => (!ctx.feed || item.hole.feed === ctx.feed.id) && markOnSurface(item.live, surface))
        .map(({ hole, index, live }) => {
          const place = live.surface === "floor" ? "Пол" : live.surface === "ceiling" ? "Потолок" : planWallName(base, walls.find((wall) => wall.id === live.wallId) || { id: live.wallId }, Math.max(0, walls.findIndex((wall) => wall.id === live.wallId)));
          const bindPick = (field) => (hole.bind?.[field] ? markSelect(`data-hole-var="${esc(hole.id)}" data-bind="${field}"`, "", feedOpts, linkKey(`b:${hole.id}:${field}`)) : "");
          const dims = live.shape === "circle"
            ? `<label class="planner-len">диаметр <input data-hole-d="${esc(hole.id)}" inputmode="decimal" value="${esc(plannerInput(hole.d * 1000))}" ${hole.bind?.d ? "readonly" : ""} /> мм</label>
               <div class="mark-dias">${PIPE_MM.map((mm) => `<button type="button" data-hole-mm="${esc(hole.id)}" data-mm="${mm}">${mm}</button>`).join("")}</div>
               <label class="planner-on"><input type="checkbox" data-hole-bind="${esc(hole.id)}" data-bind="d" ${hole.bind?.d ? "checked" : ""} /> С входа</label>
               ${bindPick("d")}`
            : `<label class="planner-len">ширина <input data-hole-w="${esc(hole.id)}" inputmode="decimal" value="${esc(plannerInput(hole.w))}" ${hole.bind?.w ? "readonly" : ""} /> м</label>
               <label class="planner-on"><input type="checkbox" data-hole-bind="${esc(hole.id)}" data-bind="w" ${hole.bind?.w ? "checked" : ""} /> С входа</label>
               ${bindPick("w")}
               <label class="planner-len">высота <input data-hole-h="${esc(hole.id)}" inputmode="decimal" value="${esc(plannerInput(hole.h))}" ${hole.bind?.h ? "readonly" : ""} /> м</label>
               <label class="planner-on"><input type="checkbox" data-hole-bind="${esc(hole.id)}" data-bind="h" ${hole.bind?.h ? "checked" : ""} /> С входа</label>
               ${bindPick("h")}
               ${live.role === "door" ? `<button type="button" class="btn" data-hole-full="${esc(hole.id)}">Во всю стену</button>` : ""}`;
          const fallback = holeLabel({ ...hole, name: "" }, index);
          return `<div class="planner-metric ${session.mark?.sel === hole.id ? "is-sel" : ""}">
            <span class="planner-label">${cardNameInput(hole.id, "hole", hole.name, fallback)} · ${esc(place)}</span>
            ${dims}
            <label class="planner-on"><input type="checkbox" data-hole-pick="${esc(hole.id)}" ${hole.picked !== false ? "checked" : ""} /> В счёт</label>
            <button type="button" class="calc-mini" data-hole-del="${esc(hole.id)}" title="Удалить">×</button>
          </div>`;
        })
        .join("");
      const wallRows = walls
        .map((wall, index) => {
          const id = feedKey(ctx.feed || node.feeds[0], "wall", wall.id);
          const area = full ? wallRemain(wall, full.height, full.openings) : 0;
          const linked = linkedFromPorts(node.id, bp.links).has(id);
          return `<label class="planner-part"><input type="checkbox" data-mark-out="${esc(id)}" ${markChecked(node, id, false) || linked ? "checked" : ""} ${linked ? "disabled" : ""} /> <span>${esc(planWallName(base, wall, index))}</span> <em>${esc(fmtShort(area))} м²</em></label>`;
        })
        .join("");
      const countFeed = ctx.feed || node.feeds[0];
      const counts = [
        ["pick", "pick", "Проёмы", (full?.openings || []).filter((hole) => hole.picked !== false).length],
        ["door", "doors", "Двери", (full?.openings || []).filter((hole) => hole.role === "door").length],
        ["window", "windows", "Окна", (full?.openings || []).filter((hole) => hole.role === "window").length],
        ["pipe", "pipes", "Трубы", (full?.openings || []).filter((hole) => hole.role === "pipe").length],
        ["hatch", "hatches", "Люки", (full?.openings || []).filter((hole) => hole.role === "hatch").length],
      ]
        .map(([key, labelKey, fallback, value]) => {
          const id = feedKey(countFeed, "count", key);
          const name = openingCounterLabel(node, labelKey, fallback);
          const linked = linkedFromPorts(node.id, bp.links).has(id);
          return `<label class="planner-part"><input type="checkbox" data-mark-out="${esc(id)}" ${markChecked(node, id, false) || linked ? "checked" : ""} ${linked ? "disabled" : ""} /> <input class="planner-name planner-counter-name" data-counter-name="${esc(labelKey)}" value="${esc(name)}" maxlength="48" aria-label="Название счётчика" /> <em>${value}</em></label>`;
        })
        .join("");
      const ownRows = (node.owns || []).map((own) => {
        const groups = new Map();
        node.holes.filter((hole) => !ctx.feed || hole.feed === ctx.feed.id).forEach((hole, index) => {
          const live = resolveHole(hole, base, node, graph.values);
          const key = live.surface === "wall" ? `wall:${live.wallId}` : live.surface;
          const wallIndex = walls.findIndex((wall) => wall.id === live.wallId);
          const place = live.surface === "floor" ? "Пол" : live.surface === "ceiling" ? "Потолок" : planWallName(base, walls[wallIndex] || { id: live.wallId }, Math.max(0, wallIndex));
          if (!groups.has(key)) groups.set(key, { name: place, items: [] });
          groups.get(key).items.push({ hole, index });
        });
        const ordered = walls.map((wall) => `wall:${wall.id}`).concat(["floor", "ceiling"]);
        const keys = ordered.concat([...groups.keys()].filter((key) => !ordered.includes(key)));
        const toggles = keys.filter((key) => groups.has(key)).map((key) => {
          const group = groups.get(key);
          const items = group.items.map(({ hole, index }) => {
            const fallback = holeLabel(hole, index);
            return `<label class="planner-part"><input type="checkbox" data-own="${esc(own.id)}" data-own-hole="${esc(hole.id)}" ${(own.holes || []).includes(hole.id) ? "checked" : ""} /> <span data-own-title="${esc(hole.id)}">${esc(hole.name || fallback)}</span></label>`;
          }).join("");
          const groupIds = group.items.map(({ hole }) => hole.id);
          const hasAny = groupIds.some((id) => (own.holes || []).includes(id));
          return `<div class="planner-own-group-title"><span>${esc(group.name)}</span><button type="button" class="calc-mini planner-own-group-toggle" data-own-group-toggle data-own-group-own="${esc(own.id)}" data-own-group-key="${esc(key)}" title="${hasAny ? "Снять все отметки" : "Отметить все"}" aria-label="${hasAny ? "Снять все отметки" : "Отметить все"}">${hasAny ? "−" : "+"}</button></div>${items}`;
        }).join("");
        return `<div class="planner-metric"><input class="planner-name" data-own-name="${esc(own.id)}" value="${esc(own.name || "Свой")}" maxlength="48" aria-label="Имя своего счётчика" /><button type="button" class="calc-mini" data-own-del="${esc(own.id)}" title="Удалить">×</button>${toggles || `<div class="calc-empty">Нет карточек для подсчёта</div>`}</div>`;
      }).join("");
      return `<div class="planner-block"><div class="planner-block-h">Проёмы</div>
        <p class="planner-lead">Прямоугольник у пола — дверь. Ширина двери на всю стену оставляет только верх. Диаметр с входа приходит в миллиметрах, ширина и высота — в метрах.${inherited ? ` С чертежа уже пришло ${inherited}.` : ""}</p>
        ${holes || `<div class="calc-empty">На этой поверхности проёмов нет</div>`}
      </div>
      <div class="planner-block"><div class="planner-block-h">На ноду</div>
        <p class="planner-lead">Стены выходят уже с вырезами. «В счёт» меняет только число «Проёмы»: включённый проём прибавляется, выключенный на чертеже бледнеет. Двери, окна, трубы и люки считаются сами.</p>
        <div class="mark-bulk">
          <button type="button" class="btn" data-mark-bulk="walls-on">Все стены</button>
          <button type="button" class="btn" data-mark-bulk="walls-off">Снять стены</button>
          <button type="button" class="btn" data-mark-bulk="counts-on">Все счётчики</button>
          <button type="button" class="btn" data-mark-bulk="counts-off">Снять счётчики</button>
        </div>
        <div class="planner-parts">${wallRows}${counts}</div>
        <div class="planner-block-h">Свой счётчик <button type="button" class="btn" data-own-add>+ Свой</button></div>
        ${ownRows}
      </div>`;
    }
    const socketOpts = socketCatalog().map((type) => ({ value: type.id, label: type.name }));
    const fixtures = node.fixtures
      .filter((fix) => (!ctx.feed || fix.feed === ctx.feed.id) && markOnSurface(fix, surface))
      .map((fix) => {
        if (fix.kind === "light") {
          const lightName = lightById(fix.light)?.name || "Свет";
          const shape = lightById(fix.light)?.shape;
          const spin = lightRotates(shape)
            ? `<button type="button" class="btn" data-light-spin="${esc(fix.id)}">+45°</button><label class="planner-len">угол <input data-light-angle="${esc(fix.id)}" inputmode="decimal" value="${esc(String(lightAngle(fix)))}" /> °</label>`
            : "";
          const dims = shape === "rect"
            ? `<label class="planner-len">ширина <input data-light-w="${esc(fix.id)}" inputmode="decimal" value="${esc(plannerInput(fix.lw || 0.6))}" /> м</label><label class="planner-len">длина <input data-light-l="${esc(fix.id)}" inputmode="decimal" value="${esc(plannerInput(fix.ll || 0.3))}" /> м</label>${spin}`
            : shape === "line"
              ? `<label class="planner-len">длина <input data-light-l="${esc(fix.id)}" inputmode="decimal" value="${esc(plannerInput(fix.ll || 1.2))}" /> м</label>${spin}`
              : "";
          return `<div class="planner-metric ${session.mark?.sel === fix.id ? "is-sel" : ""}">
            <span class="planner-label">${cardNameInput(fix.id, "fix", fix.name, lightName)}</span>
            ${markSelect(`data-light="${esc(fix.id)}"`, "", lightCatalog().map((type) => ({ value: type.id, label: type.name })), fix.light || "")}
            ${dims}
            <button type="button" class="calc-mini" data-fix-del="${esc(fix.id)}" title="Удалить">×</button>
          </div>`;
        }
        const cells = (fix.cells || [])
          .map((cell, index) => `<label class="planner-len">${index + 1} ${markSelect(`data-cell="${esc(fix.id)}" data-cell-i="${index}"`, "", socketOpts, cell)}</label>`)
          .join("");
        return `<div class="planner-metric ${session.mark?.sel === fix.id ? "is-sel" : ""}">
          <span class="planner-label">${cardNameInput(fix.id, "fix", fix.name, frameLabel({ ...fix, name: "" }))}</span>
          <label class="planner-len">рамка ${markSelect(`data-orient="${esc(fix.id)}"`, "", [{ value: "h", label: "горизонтально" }, { value: "v", label: "вертикально" }], fix.orient === "v" ? "v" : "h")}</label>
          ${cells}
          ${(fix.cells || []).length < 6 ? `<button type="button" class="btn" data-cell-add="${esc(fix.id)}">Ещё секция</button>` : ""}
          <button type="button" class="calc-mini" data-fix-del="${esc(fix.id)}" title="Удалить">×</button>
        </div>`;
      })
      .join("");
    const typeRows = [];
    const frameRows = [];
    const seenType = new Set();
    const seenFrame = new Set();
    const mine = node.fixtures.filter((fix) => !ctx.feed || fix.feed === ctx.feed.id);
    mine.forEach((fix) => {
      if (fix.kind === "light") return;
      const key = frameKey(fix);
      if (!seenFrame.has(key)) {
        seenFrame.add(key);
        const id = feedKey(ctx.feed || node.feeds[0], "frame", key);
        const value = mine.filter((item) => item.kind !== "light" && frameKey(item) === key).length;
        const linked = linkedFromPorts(node.id, bp.links).has(id);
        frameRows.push({ n: Number(key), html: `<label class="planner-part"><input type="checkbox" data-mark-out="${esc(id)}" ${markChecked(node, id, true) || linked ? "checked" : ""} ${linked ? "disabled" : ""} /> <span>${esc(frameLabel(fix))}</span> <em>${value}</em></label>` });
      }
      (fix.cells || []).forEach((typeId) => {
        if (seenType.has(typeId)) return;
        seenType.add(typeId);
        const id = feedKey(ctx.feed || node.feeds[0], "type", typeId);
        const value = mine.filter((item) => item.kind !== "light").reduce((sum, item) => sum + (item.cells || []).filter((cell) => cell === typeId).length, 0);
        const linked = linkedFromPorts(node.id, bp.links).has(id);
        const name = socketById(typeId)?.name || "Розетка";
        typeRows.push(`<label class="planner-part"><input type="checkbox" data-mark-out="${esc(id)}" ${markChecked(node, id, true) || linked ? "checked" : ""} ${linked ? "disabled" : ""} /> <span>${esc(name)}</span> <em>${value}</em></label>`);
      });
    });
    frameRows.sort((a, b) => a.n - b.n);
    return `<div class="planner-block"><div class="planner-block-h">Точки</div>
      <p class="planner-lead">Правый клик ставит розетку или свет в эту точку. Рамка собирает несколько типов, горизонтально или вертикально.</p>
      ${fixtures || `<div class="calc-empty">На этой поверхности точек нет</div>`}
    </div>
    <div class="planner-block"><div class="planner-block-h">На ноду</div>
      <div class="planner-parts">${typeRows.join("")}${frameRows.map((row) => row.html).join("") || `<div class="calc-empty">Пока нечего считать</div>`}</div>
    </div>`;
  }

  function markMenu(node, bp) {
    const picker = $("mark-layout-trigger");
    const menu = $("mark-layout-menu");
    if (!picker || !menu || !node) return;
    const common = session.mark?.view === COMMON_VIEW;
    const linked = (node.feeds || []).filter((feed) => (bp?.links || []).some((link) => link.to === node.id && link.toPort === feedPort(feed)));
    const current = (node.feeds || []).find((feed) => feed.id === session.mark?.feed) || linked[0];
    picker.textContent = common ? "Общий вывод" : (current && linked.some((feed) => feed.id === current.id) ? feedTitle(node, current, bp) : (linked[0] ? feedTitle(node, linked[0], bp) : "Чертёж"));
    menu.innerHTML = `${linked.map((feed) => `<button type="button" class="planner-layout-option ${!common && feed.id === session.mark?.feed ? "is-active" : ""}" role="menuitem" data-mark-feed-choice="${esc(feed.id)}">${esc(feedTitle(node, feed, bp))}</button>`).join("")}${linked.length ? `<div class="planner-layout-menu-sep"></div>` : ""}<button type="button" class="planner-layout-option ${common ? "is-active" : ""}" role="menuitem" data-mark-feed-choice="${COMMON_VIEW}">Общий вывод</button>`;
  }

  function markFill() {
    const ctx = markContext();
    const side = $("mark-side");
    const title = $("mark-title");
    const hint = $("mark-hint");
    const cap = $("mark-cap");
    const modal = $("mark-modal");
    const common = session.mark?.view === COMMON_VIEW;
    modal?.classList.toggle("is-common", common);
    if (ctx) {
      markMenu(ctx.node, ctx.bp);
      syncMarkPaste(ctx.node);
    }
    if (!ctx || !side) return;
    if (common) {
      const stage = $("mark-common");
      if (stage) stage.hidden = false;
      paintCommon("mark", ctx.node, ctx.bp, ctx.graph.values);
      if (title && document.activeElement !== title) title.value = ctx.node.name || "";
      return;
    }
    const stage = $("mark-common");
    if (stage) stage.hidden = true;
    const scroll = side.scrollTop;
    side.innerHTML = markSideHtml(ctx);
    side.scrollTop = scroll;
    if (title && document.activeElement !== title) title.value = ctx.node.name || "";
    const surface = session.mark?.surface || "floor";
    const walls = ctx.base ? plannerWalls(ctx.base) : [];
    const wallIndex = walls.findIndex((wall) => wall.id === surface);
    if (cap) {
      cap.textContent = surface === "ceiling" ? "Потолок" : surface === "floor" ? "Пол" : wallIndex >= 0 ? planWallName(ctx.base, walls[wallIndex], wallIndex) : "План";
    }
    if (hint) {
      hint.textContent = ctx.node.type === "electrics"
        ? "Правый клик: розетка, ориентация и число секций. Точка встаёт туда, куда нажали. Стрелки двигают уже стоящую."
        : "Правый клик: прямоугольник, круг или диаметр. У пола прямоугольник становится дверью. Стрелки двигают выбранный проём.";
    }
    const film = $("mark-film");
    const filmLabel = $("mark-film-label");
    if (filmLabel) {
      filmLabel.hidden = !ctx.base;
      filmLabel.textContent = ctx.base && ctx.feed ? feedTitle(ctx.node, ctx.feed, ctx.bp) : "";
    }
    if (film) {
      const holes = ctx.node.type === "openings" ? ctx.full?.openings || [] : ctx.base?.openings || [];
      const fixtures = ctx.node.type === "electrics" ? ctx.node.fixtures : [];
      film.innerHTML = ctx.base ? filmStrip(ctx.base, "", surface, holes, fixtures, markTones(ctx.node, ctx.base.color)) : `<div class="calc-empty">Нет чертежа</div>`;
    }
    let locate = $("mark-locate");
    const wrap = $("mark-canvas")?.parentElement;
    if (!locate && wrap) {
      locate = document.createElement("div");
      locate.id = "mark-locate";
      locate.className = "mark-locate";
      wrap.appendChild(locate);
    }
    if (locate) {
      if (!locate.dataset.bound) {
        locate.dataset.bound = "1";
        locate.addEventListener("pointermove", (e) => {
          if (!session.mark?.locateBig) return;
          const wall = e.target.closest?.("[data-locate-wall]") || null;
          locate.querySelectorAll("[data-locate-wall]").forEach((el) => el.classList.toggle("is-hot", el === wall));
        });
        locate.addEventListener("pointerleave", () => {
          locate.querySelectorAll(".is-hot").forEach((el) => el.classList.remove("is-hot"));
        });
        locate.addEventListener("click", (e) => {
          if (!session.mark) return;
          if (e.target.closest("[data-locate-eye]")) {
            session.mark.locateHide = !session.mark.locateHide;
            markFill();
            return;
          }
          const wall = e.target.closest("[data-locate-wall]");
          if (session.mark.locateBig && wall) {
            const node = markNode();
            session.mark.surface = wall.dataset.locateWall;
            if (node) node.view = session.mark.surface;
            session.mark.locateBig = false;
            session.mark.sel = "";
            markCommit(true);
            return;
          }
          session.mark.locateBig = !session.mark.locateBig;
          markFill();
        });
      }
      const eye = `<button type="button" class="calc-mini-toggle mark-locate-eye" data-locate-eye title="${session.mark?.locateHide ? "Показать план" : "Скрыть план"}" aria-label="Показать или скрыть план"><svg class="calc-mini-eye-on" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/></svg><svg class="calc-mini-eye-off" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 3l18 18M10.6 10.7a2.8 2.8 0 0 0 3.7 3.7M6.2 6.3C4.1 7.8 2.5 12 2.5 12s3.5 7 9.5 7c1.2 0 2.3-.2 3.3-.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>`;
      locate.hidden = !ctx.base;
      locate.classList.toggle("is-big", !!session.mark?.locateBig && !session.mark?.locateHide);
      locate.classList.toggle("is-hidden", !!session.mark?.locateHide);
      locate.innerHTML = `${ctx.base ? `<div class="mark-locate-map">${planLocateSvg(ctx.base, surface)}</div>` : ""}${eye}`;
    }
    markDraw();
  }

  function markCamera() {
    if (!session.mark) return { k: 1, x: 0, y: 0 };
    if (!session.mark.cam) session.mark.cam = { k: 1, x: 0, y: 0 };
    return session.mark.cam;
  }

  function markViewOf(canvas, ctx) {
    const surface = session.mark?.surface || "floor";
    if (!ctx.base) return null;
    const cam = markCamera();
    const k = cam.k || 1;
    const width = canvas.clientWidth;
    const heightPx = canvas.clientHeight;
    if (surface === "floor" || surface === "ceiling") {
      const fit = plannerFit(canvas, ctx.base.points);
      const scale = fit.scale * k;
      const ox = (fit.ox - width / 2) * k + width / 2 + (cam.x || 0);
      const oy = (fit.oy - heightPx / 2) * k + heightPx / 2 + (cam.y || 0);
      return {
        kind: "plan",
        plan: ctx.base,
        view: {
          scale,
          to(p) { return { x: ox + p.x * scale, y: oy + p.y * scale }; },
          from(x, y) { return { x: (x - ox) / scale, y: (y - oy) / scale }; },
        },
      };
    }
    const walls = plannerWalls(ctx.base);
    const wall = walls.find((item) => item.id === surface);
    if (!wall) {
      const fit = plannerFit(canvas, ctx.base.points);
      const scale = fit.scale * k;
      const ox = (fit.ox - width / 2) * k + width / 2 + (cam.x || 0);
      const oy = (fit.oy - heightPx / 2) * k + heightPx / 2 + (cam.y || 0);
      return { kind: "plan", plan: ctx.base, view: {
        scale,
        to(p) { return { x: ox + p.x * scale, y: oy + p.y * scale }; },
        from(x, y) { return { x: (x - ox) / scale, y: (y - oy) / scale }; },
      }};
    }
    const pad = 28;
    const len = Math.max(wall.len, 0.2);
    const wallHeight = Math.max(ctx.base.height, 0.2);
    const baseScale = Math.min((width - pad * 2) / len, (heightPx - pad * 2) / wallHeight);
    const scale = baseScale * k;
    const baseOx = (width - len * baseScale) / 2;
    const baseOy = (heightPx - wallHeight * baseScale) / 2;
    const ox = (baseOx - width / 2) * k + width / 2 + (cam.x || 0);
    const oy = (baseOy - heightPx / 2) * k + heightPx / 2 + (cam.y || 0);
    return {
      kind: "wall",
      wall,
      height: ctx.base.height,
      scale,
      toAlong(along, rise) {
        return { x: ox + along * scale, y: oy + (wallHeight - rise) * scale };
      },
      from(x, y) {
        return { along: (x - ox) / scale, rise: wallHeight - (y - oy) / scale };
      },
    };
  }

  function markLocals(ctx) {
    if (ctx.node.type !== "openings") return [];
    return ctx.node.holes.filter((hole) => !ctx.feed || hole.feed === ctx.feed.id).map((hole) => resolveHole(hole, ctx.base, ctx.node, ctx.graph.values));
  }

  function frameBoxes(fix) {
    const cells = (fix.cells || []).slice(0, 6);
    const gap = 0.012;
    const sizes = cells.map((id) => plannerClamp((socketById(id)?.size || 80) / 1000, 0.02, 0.4));
    const horiz = fix.orient !== "v";
    const total = sizes.reduce((sum, size) => sum + size, 0) + gap * Math.max(0, sizes.length - 1);
    let cursor = -total / 2;
    return cells.map((id, index) => {
      const size = sizes[index];
      const box = horiz
        ? { x: cursor, y: -size / 2, w: size, h: size, id }
        : { x: -size / 2, y: cursor, w: size, h: size, id };
      cursor += size + gap;
      return box;
    });
  }

  function markDrawGrid(g, view, width, height, step) {
    if (session.mark?.snapEnabled === false || !view) return;
    const size = plannerClamp(plannerNum(step, EDITOR_SNAP_DEFAULT), 0.01, 5);
    let a, b, to;
    if (view.kind === "wall") {
      a = view.from(0, 0);
      b = view.from(width, height);
      to = (x, y) => view.toAlong(x, y);
    } else {
      a = view.view.from(0, 0);
      b = view.view.from(width, height);
      to = (x, y) => view.view.to({ x, y });
    }
    const ax = a.along ?? a.x, bx = b.along ?? b.x;
    const ay = a.rise ?? a.y, by = b.rise ?? b.y;
    const minX = Math.floor(Math.min(ax, bx) / size) * size;
    const maxX = Math.ceil(Math.max(ax, bx) / size) * size;
    const minY = Math.floor(Math.min(ay, by) / size) * size;
    const maxY = Math.ceil(Math.max(ay, by) / size) * size;
    g.save();
    g.beginPath();
    g.strokeStyle = plannerColors().line;
    g.globalAlpha = 0.65;
    g.lineWidth = 1;
    for (let x = minX; x <= maxX + size * 0.001; x += size) {
      const p = to(x, 0);
      g.moveTo(p.x, 0);
      g.lineTo(p.x, height);
    }
    for (let y = minY; y <= maxY + size * 0.001; y += size) {
      const p = to(0, y);
      g.moveTo(0, p.y);
      g.lineTo(width, p.y);
    }
    g.stroke();
    g.restore();
  }

  function markDraw() {
    const ctx = markContext();
    const canvas = $("mark-canvas");
    if (!ctx || !canvas || !session.mark) return;
    const fitted = plannerFitCanvas(canvas);
    if (!fitted) return;
    const { ctx: g, w, h } = fitted;
    const colors = plannerColors();
    g.clearRect(0, 0, w, h);
    g.fillStyle = colors.bg;
    g.fillRect(0, 0, w, h);
    const view = markViewOf(canvas, ctx);
    session.mark.view = view;
    if (!view || !ctx.base) {
      g.fillStyle = colors.muted;
      g.font = "14px sans-serif";
      g.fillText("Подключите чертёж", 24, 36);
      return;
    }
    const surface = session.mark.surface;
    markDrawGrid(g, view, w, h, session.mark.snapStep || EDITOR_SNAP_DEFAULT);
    const tones = markTones(ctx.node, ctx.base.color);
    if (view.kind === "plan") {
      g.beginPath();
      ctx.base.points.forEach((p, index) => {
        const spot = view.view.to(p);
        if (index) g.lineTo(spot.x, spot.y);
        else g.moveTo(spot.x, spot.y);
      });
      g.closePath();
      g.fillStyle = surface === "ceiling" ? tones.ceiling : tones.floor;
      g.globalAlpha = 0.22;
      g.fill();
      g.globalAlpha = 1;
      g.lineWidth = 2;
      g.strokeStyle = surface === "ceiling" ? tones.ceiling : tones.floor;
      g.stroke();
    } else {
      const a = view.toAlong(0, 0);
      const b = view.toAlong(view.wall.len, view.height);
      g.fillStyle = tones.wall;
      g.globalAlpha = 0.34;
      g.fillRect(a.x, b.y, b.x - a.x, a.y - b.y);
      g.globalAlpha = 1;
      g.strokeStyle = tones.wall;
      g.lineWidth = 2;
      g.strokeRect(a.x, b.y, b.x - a.x, a.y - b.y);
    }
    const drawHole = (hole, ghost) => {
      const onWall = view.kind === "wall" && hole.surface === "wall" && hole.wallId === view.wall.id;
      const onPlan = view.kind === "plan" && hole.surface === surface;
      if (!onWall && !onPlan) return;
      g.save();
      g.globalAlpha = ghost ? 0.45 : hole.picked === false ? 0.28 : 1;
      if (hole.picked === false) g.setLineDash([5, 4]);
      g.fillStyle = colors.bg;
      g.strokeStyle = hole.role === "door" ? "#b45309" : hole.role === "pipe" ? "#0369a1" : "#0f766e";
      g.lineWidth = session.mark.sel === hole.id ? 3 : 1.5;
      if (view.kind === "wall") {
        if (hole.shape === "circle") {
          const c = view.toAlong(hole.along, hole.rise);
          g.beginPath();
          g.arc(c.x, c.y, Math.max(3, (hole.d / 2) * view.scale), 0, Math.PI * 2);
          g.fill();
          g.stroke();
        } else {
          const p = view.toAlong(hole.along, hole.rise + hole.h);
          const q = view.toAlong(hole.along + hole.w, hole.rise);
          g.fillRect(p.x, p.y, q.x - p.x, q.y - p.y);
          g.strokeRect(p.x, p.y, q.x - p.x, q.y - p.y);
        }
      } else if (hole.shape === "circle") {
        const c = view.view.to({ x: hole.x, y: hole.y });
        g.beginPath();
        g.arc(c.x, c.y, Math.max(3, (hole.d / 2) * view.view.scale), 0, Math.PI * 2);
        g.fill();
        g.stroke();
      } else {
        const p = view.view.to({ x: hole.x, y: hole.y });
        const q = view.view.to({ x: hole.x + hole.w, y: hole.y + hole.h });
        g.fillRect(p.x, p.y, q.x - p.x, q.y - p.y);
        g.strokeRect(p.x, p.y, q.x - p.x, q.y - p.y);
      }
      g.restore();
    };
    (ctx.base.openings || []).forEach((hole) => drawHole(hole, true));
    if (ctx.node.type === "openings") markLocals(ctx).forEach((hole) => drawHole(hole, false));
    if (ctx.node.type === "electrics") {
      ctx.node.fixtures.forEach((fix) => {
        if (ctx.feed && fix.feed !== ctx.feed.id) return;
        const here = view.kind === "wall" ? fix.surface === "wall" && fix.wallId === view.wall.id : fix.surface === surface;
        if (!here) return;
        if (fix.kind === "light") {
          lightPaint(g, view, fix, session.mark.sel === fix.id, colors.ink);
          return;
        }
        frameBoxes(fix).forEach((box) => {
          const type = socketById(box.id) || SOCKET_BUILTIN[0];
          let x = 0;
          let y = 0;
          let bw = 8;
          let bh = 8;
          if (view.kind === "wall") {
            const p = view.toAlong(fix.along + box.x, fix.rise + box.y + box.h);
            const q = view.toAlong(fix.along + box.x + box.w, fix.rise + box.y);
            x = p.x;
            y = p.y;
            bw = q.x - p.x;
            bh = q.y - p.y;
          } else {
            const p = view.view.to({ x: fix.x + box.x, y: fix.y + box.y });
            const q = view.view.to({ x: fix.x + box.x + box.w, y: fix.y + box.y + box.h });
            x = p.x;
            y = p.y;
            bw = q.x - p.x;
            bh = q.y - p.y;
          }
          g.fillStyle = type.color;
          g.strokeStyle = session.mark.sel === fix.id ? colors.ink : "#1e293b";
          g.lineWidth = session.mark.sel === fix.id ? 2.5 : 1;
          g.fillRect(x, y, bw, bh);
          g.strokeRect(x, y, bw, bh);
          g.fillStyle = markInk(type.color);
          g.font = `700 ${Math.max(9, Math.min(bw, bh) * 0.42)}px sans-serif`;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText(type.letters || "?", x + bw / 2, y + bh / 2);
        });
      });
    }
    const guides = session.mark.guides;
    if (guides && session.mark.drag && !session.mark.drag.pan) {
      g.save();
      g.strokeStyle = "#0ea5e9";
      g.lineWidth = 1;
      g.setLineDash([5, 4]);
      g.globalAlpha = 0.95;
      g.beginPath();
      if (guides.x != null) {
        const p = view.kind === "wall" ? view.toAlong(guides.x, 0) : view.view.to({ x: guides.x, y: 0 });
        g.moveTo(p.x, 0); g.lineTo(p.x, h);
      }
      if (guides.y != null) {
        const p = view.kind === "wall" ? view.toAlong(0, guides.y) : view.view.to({ x: 0, y: guides.y });
        g.moveTo(0, p.y); g.lineTo(w, p.y);
      }
      g.stroke();
      g.restore();
    }
  }

  function lightBox(fix) {
    const type = lightById(fix.light) || LIGHT_BUILTIN[0];
    const shape = type.shape || "circle";
    let w = plannerClamp((type.size || 120) / 1000, 0.03, 0.8);
    let h = w;
    if (shape === "rect") {
      w = plannerClamp(plannerNum(fix.lw, 0.6), 0.05, 8);
      h = plannerClamp(plannerNum(fix.ll, 0.3), 0.05, 8);
    } else if (shape === "line") {
      w = plannerClamp(plannerNum(fix.ll, 1.2), 0.1, 12);
      h = 0.02;
    }
    return { w, h, shape, type };
  }

  function lightAngle(fix) {
    const raw = fix?.angle;
    const fallback = fix?.orient === "v" ? 90 : 0;
    const value = raw == null || raw === "" ? fallback : plannerNum(raw, fallback);
    return Math.round(((((value % 360) + 360) % 360) * 10)) / 10;
  }

  function lightRotates(shape) {
    return shape === "rect" || shape === "line";
  }

  function lightPaint(g, view, fix, selected, ink) {
    const box = lightBox(fix);
    const p = view.kind === "wall" ? view.toAlong(fix.along - box.w / 2, fix.rise + box.h / 2) : view.view.to({ x: fix.x - box.w / 2, y: fix.y - box.h / 2 });
    const q = view.kind === "wall" ? view.toAlong(fix.along + box.w / 2, fix.rise - box.h / 2) : view.view.to({ x: fix.x + box.w / 2, y: fix.y + box.h / 2 });
    const sw = Math.abs(q.x - p.x);
    const sh = Math.abs(q.y - p.y);
    const cx = (p.x + q.x) / 2;
    const cy = (p.y + q.y) / 2;
    g.save();
    g.translate(cx, cy);
    if (lightRotates(box.shape)) g.rotate((lightAngle(fix) * Math.PI) / 180);
    g.fillStyle = box.type.color;
    g.strokeStyle = selected ? ink : box.type.color;
    g.lineWidth = 2;
    const draw = box.shape === "line" || box.shape === "rect" ? "square" : box.shape;
    markShape(g, draw, -sw / 2, -sh / 2, sw, sh);
    g.restore();
    return { cx, cy, sw, sh, angle: lightRotates(box.shape) ? lightAngle(fix) : 0 };
  }

  function markShape(g, shape, x, y, w, h) {
    g.beginPath();
    if (shape === "diamond") {
      g.moveTo(x + w / 2, y);
      g.lineTo(x + w, y + h / 2);
      g.lineTo(x + w / 2, y + h);
      g.lineTo(x, y + h / 2);
      g.closePath();
    } else if (shape === "square") g.rect(x, y, w, h);
    else g.arc(x + w / 2, y + h / 2, Math.min(Math.abs(w), Math.abs(h)) / 2, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }

  function markInk(hex) {
    const n = Number.parseInt(String(hex || "").slice(1), 16);
    if (!Number.isFinite(n)) return "#fff";
    const r = (n >> 16) & 255;
    const gv = (n >> 8) & 255;
    const b = n & 255;
    return r * 0.3 + gv * 0.59 + b * 0.11 > 160 ? "#1e293b" : "#fff";
  }

  function markHoleScreen(hole, view) {
    if (!view) return null;
    if (view.kind === "wall") {
      if (hole.shape === "circle") {
        const c = view.toAlong(hole.along, hole.rise);
        const r = Math.max(4, (hole.d / 2) * view.scale);
        return { x: c.x - r, y: c.y - r, w: r * 2, h: r * 2, circle: true };
      }
      const p = view.toAlong(hole.along, hole.rise + hole.h);
      const q = view.toAlong(hole.along + hole.w, hole.rise);
      return { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) };
    }
    if (hole.shape === "circle") {
      const c = view.view.to({ x: hole.x, y: hole.y });
      const edge = view.view.to({ x: hole.x + hole.d / 2, y: hole.y });
      const r = Math.max(4, Math.hypot(edge.x - c.x, edge.y - c.y));
      return { x: c.x - r, y: c.y - r, w: r * 2, h: r * 2, circle: true };
    }
    const p = view.view.to({ x: hole.x, y: hole.y });
    const q = view.view.to({ x: hole.x + hole.w, y: hole.y + hole.h });
    return { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) };
  }

  function markEdgeAt(box, x, y) {
    const t = 8;
    if (x < box.x - t || x > box.x + box.w + t || y < box.y - t || y > box.y + box.h + t) return "";
    const left = Math.abs(x - box.x) <= t;
    const right = Math.abs(x - (box.x + box.w)) <= t;
    const top = Math.abs(y - box.y) <= t;
    const bottom = Math.abs(y - (box.y + box.h)) <= t;
    if (box.circle) return "";
    let edge = "";
    if (top) edge += "n";
    if (bottom) edge += "s";
    if (left) edge += "w";
    if (right) edge += "e";
    return edge;
  }

  function markResize(hole, drag, world) {
    const wall = hole.surface === "wall";
    const dx = wall ? world.along - drag.pointer.along : world.x - drag.pointer.x;
    const dy = wall ? world.rise - drag.pointer.rise : world.y - drag.pointer.y;
    if (hole.shape === "circle") return;
    if (wall) {
      let along = drag.along;
      let rise = drag.rise;
      let w = drag.w;
      let h = drag.h;
      if (drag.mode.includes("e")) w = drag.w + dx;
      if (drag.mode.includes("w")) {
        along = drag.along + dx;
        w = drag.w - dx;
      }
      if (drag.mode.includes("n")) h = drag.h + dy;
      if (drag.mode.includes("s")) {
        rise = drag.rise + dy;
        h = drag.h - dy;
      }
      hole.w = plannerRound(Math.max(0.05, w));
      hole.h = plannerRound(Math.max(0.05, h));
      hole.along = plannerRound(along);
      hole.rise = plannerRound(rise);
      return;
    }
    let x = drag.x;
    let y = drag.y;
    let w = drag.w;
    let h = drag.h;
    if (drag.mode.includes("e")) w = drag.w + dx;
    if (drag.mode.includes("w")) {
      x = drag.x + dx;
      w = drag.w - dx;
    }
    if (drag.mode.includes("s")) h = drag.h + dy;
    if (drag.mode.includes("n")) {
      y = drag.y + dy;
      h = drag.h - dy;
    }
    hole.w = plannerRound(Math.max(0.05, w));
    hole.h = plannerRound(Math.max(0.05, h));
    hole.x = plannerRound(x);
    hole.y = plannerRound(y);
  }

  function markHit(ctx, x, y) {
    const view = session.mark?.view;
    if (!view) return "";
    const surface = session.mark.surface;
    if (ctx.node.type === "openings") {
      const holes = markLocals(ctx);
      for (let i = holes.length - 1; i >= 0; i -= 1) {
        const hole = holes[i];
        if (view.kind === "wall") {
          if (hole.surface !== "wall" || hole.wallId !== view.wall.id) continue;
          const spot = hole.shape === "circle" ? view.toAlong(hole.along, hole.rise) : view.toAlong(hole.along + hole.w / 2, hole.rise + hole.h / 2);
          const reach = hole.shape === "circle" ? Math.max(10, (hole.d / 2) * view.scale + 6) : Math.max(12, Math.hypot((hole.w * view.scale) / 2, (hole.h * view.scale) / 2));
          if (Math.hypot(x - spot.x, y - spot.y) <= reach) return hole.id;
        } else if (hole.surface === surface) {
          if (hole.shape === "circle") {
            const spot = view.view.to({ x: hole.x, y: hole.y });
            const edge = view.view.to({ x: hole.x + hole.d / 2, y: hole.y });
            if (Math.hypot(x - spot.x, y - spot.y) <= Math.hypot(edge.x - spot.x, edge.y - spot.y) + 8) return hole.id;
          } else {
            const p = view.view.to({ x: hole.x, y: hole.y });
            const q = view.view.to({ x: hole.x + hole.w, y: hole.y + hole.h });
            const pad = 6;
            if (x >= Math.min(p.x, q.x) - pad && x <= Math.max(p.x, q.x) + pad && y >= Math.min(p.y, q.y) - pad && y <= Math.max(p.y, q.y) + pad) return hole.id;
          }
        }
      }
      return "";
    }
    for (let i = ctx.node.fixtures.length - 1; i >= 0; i -= 1) {
      const fix = ctx.node.fixtures[i];
      if (ctx.feed && fix.feed !== ctx.feed.id) continue;
      const here = view.kind === "wall" ? fix.surface === "wall" && fix.wallId === view.wall.id : fix.surface === surface;
      if (!here) continue;
      if (fix.kind === "light") {
        const box = lightBox(fix);
        const p = view.kind === "wall" ? view.toAlong(fix.along - box.w / 2, fix.rise + box.h / 2) : view.view.to({ x: fix.x - box.w / 2, y: fix.y - box.h / 2 });
        const q = view.kind === "wall" ? view.toAlong(fix.along + box.w / 2, fix.rise - box.h / 2) : view.view.to({ x: fix.x + box.w / 2, y: fix.y + box.h / 2 });
        const cx = (p.x + q.x) / 2;
        const cy = (p.y + q.y) / 2;
        const ang = lightRotates(box.shape) ? (-lightAngle(fix) * Math.PI) / 180 : 0;
        const dx = x - cx;
        const dy = y - cy;
        const rx = dx * Math.cos(ang) - dy * Math.sin(ang);
        const ry = dx * Math.sin(ang) + dy * Math.cos(ang);
        const pad = 6;
        if (Math.abs(rx) <= Math.abs(q.x - p.x) / 2 + pad && Math.abs(ry) <= Math.abs(q.y - p.y) / 2 + pad) {
          session.mark.hitCell = null;
          return fix.id;
        }
        continue;
      }
      const boxes = frameBoxes(fix);
      const hitIndex = boxes.findIndex((box) => {
        const p = view.kind === "wall" ? view.toAlong(fix.along + box.x, fix.rise + box.y) : view.view.to({ x: fix.x + box.x, y: fix.y + box.y });
        const q = view.kind === "wall" ? view.toAlong(fix.along + box.x + box.w, fix.rise + box.y + box.h) : view.view.to({ x: fix.x + box.x + box.w, y: fix.y + box.y + box.h });
        return x >= Math.min(p.x, q.x) - 6 && x <= Math.max(p.x, q.x) + 6 && y >= Math.min(p.y, q.y) - 6 && y <= Math.max(p.y, q.y) + 6;
      });
      if (hitIndex >= 0) {
        session.mark.hitCell = hitIndex;
        return fix.id;
      }
      const spot = view.kind === "wall" ? view.toAlong(fix.along, fix.rise) : view.view.to({ x: fix.x, y: fix.y });
      if (Math.hypot(x - spot.x, y - spot.y) <= 18) {
        session.mark.hitCell = null;
        return fix.id;
      }
    }
    return "";
  }

  function markWorld(x, y) {
    const view = session.mark?.view;
    if (!view) return null;
    const step = session.mark?.snapStep || EDITOR_SNAP_DEFAULT;
    if (view.kind === "wall") {
      const point = view.from(x, y);
      if (session.mark?.snapEnabled !== false) {
        point.along = editorSnapValue(point.along, step);
        point.rise = editorSnapValue(point.rise, step);
      }
      return point;
    }
    const point = view.view.from(x, y);
    return session.mark?.snapEnabled !== false
      ? { x: editorSnapValue(point.x, step), y: editorSnapValue(point.y, step) }
      : { x: plannerRound(point.x), y: plannerRound(point.y) };
  }

  function markPlace(node, world, extra) {
    const surface = session.mark?.surface || "floor";
    const spot = {
      surface,
      wallId: surface !== "floor" && surface !== "ceiling" ? surface : "",
      along: world.along || 0,
      rise: world.rise || 0,
      x: world.x || 0,
      y: world.y || 0,
    };
    const feedId = activeFeed(node)?.id || node.feeds?.[0]?.id || "";
    if (node.type === "openings") {
      const hole = {
        id: uid(),
        feed: feedId,
        ...spot,
        shape: extra.shape || "rect",
        w: extra.w || 0.9,
        h: extra.h || 2.1,
        d: extra.d || 0.11,
        bind: { w: false, h: false, d: false },
        picked: true,
      };
      if (hole.shape === "rect" && hole.surface === "wall" && hole.rise < 0.15) {
        hole.rise = 0;
        hole.w = extra.w || 0.9;
        hole.h = extra.h || 2.1;
        hole.along = (world.along || 0) - hole.w / 2;
      } else if (hole.shape === "rect") {
        hole.w = extra.w || 1.2;
        hole.h = extra.h || 1.2;
        hole.along = (world.along || 0) - hole.w / 2;
        hole.rise = (world.rise || 0) - hole.h / 2;
        if (hole.surface !== "wall") {
          hole.x = (world.x || 0) - hole.w / 2;
          hole.y = (world.y || 0) - hole.h / 2;
        }
      }
      node.holes.push(hole);
      session.mark.sel = hole.id;
      return hole.id;
    }
    if (extra.kind === "light") {
      const lightId = extra.light || "chandelier";
      const shape = lightById(lightId)?.shape;
      const fix = { id: uid(), feed: feedId, kind: "light", ...spot, orient: "h", cells: ["socket"], light: lightId, lw: shape === "rect" ? 0.6 : 0.6, ll: shape === "line" ? 1.2 : 0.3 };
      node.fixtures.push(fix);
      session.mark.sel = fix.id;
      return fix.id;
    }
    const count = plannerClamp(session.mark?.section || 1, 1, 6);
    const cells = Array.from({ length: count }, () => extra.type || "socket");
    const fix = { id: uid(), feed: feedId, kind: "socket", ...spot, orient: session.mark?.orient === "v" ? "v" : "h", cells, light: "chandelier" };
    node.fixtures.push(fix);
    session.mark.sel = fix.id;
    return fix.id;
  }

  function presetSwatch(kind, type) {
    const color = markHex(type?.color, kind === "light" ? "#facc15" : "#a78bfa");
    const ink = markInk(color);
    const px = Math.max(22, Math.min(46, Math.round(plannerNum(type?.size, kind === "light" ? 120 : 80) * 46 / 200)));
    const shape = type?.shape || "circle";
    let glyph = "";
    if (kind !== "light") {
      const x = (50 - px) / 2;
      glyph = `<rect x="${x}" y="${x}" width="${px}" height="${px}" rx="5" fill="${color}"/><text x="25" y="26" text-anchor="middle" fill="${ink}" font-size="${Math.max(10, Math.round(px * 0.36))}" font-weight="700">${esc(type?.letters || "")}</text>`;
    } else if (shape === "line") {
      const w = Math.min(46, Math.max(28, px));
      glyph = `<rect x="${(50 - w) / 2}" y="24" width="${w}" height="2" rx="1" fill="${color}"/>`;
    } else if (shape === "rect") {
      const w = Math.min(46, Math.max(30, px));
      const h = Math.max(12, Math.round(w * 0.4));
      glyph = `<rect x="${(50 - w) / 2}" y="${(50 - h) / 2}" width="${w}" height="${h}" rx="3" fill="${color}"/>`;
    } else if (shape === "diamond") {
      const s = px / 2;
      glyph = `<polygon points="25,${25 - s} ${25 + s},25 25,${25 + s} ${25 - s},25" fill="${color}"/>`;
    } else if (shape === "square") {
      const x = (50 - px) / 2;
      glyph = `<rect x="${x}" y="${x}" width="${px}" height="${px}" rx="3" fill="${color}"/>`;
    } else {
      glyph = `<circle cx="25" cy="25" r="${px / 2}" fill="${color}"/>`;
    }
    return `<span class="mark-swatch"><svg viewBox="0 0 50 50" width="50" height="50" aria-hidden="true">${glyph}</svg></span>`;
  }

  const PRESET_SHAPES = [
    { value: "circle", label: "круг" },
    { value: "square", label: "квадрат" },
    { value: "diamond", label: "ромб" },
    { value: "rect", label: "прямоугольник" },
    { value: "line", label: "линейный" },
  ];

  function presetRow(kind, type) {
    const id = esc(type.id);
    const extra = kind === "light"
      ? markSelect(`data-preset-shape="${id}"`, "", PRESET_SHAPES, type.shape || "circle")
      : `<input data-preset-letters="${id}" data-preset-kind="socket" maxlength="3" value="${esc(type.letters || "")}" aria-label="Буквы" />`;
    return `<div class="mark-preset-row" data-preset-id="${id}" data-preset-kind="${kind}"><span class="mark-drag" draggable="true" title="Перетащить" aria-label="Порядок"></span>${presetSwatch(kind, type)}<input data-preset-name="${id}" data-preset-kind="${kind}" maxlength="32" value="${esc(type.name)}" aria-label="Имя" />${extra}<input type="color" data-preset-color="${id}" data-preset-kind="${kind}" value="${esc(markHex(type.color, kind === "light" ? "#facc15" : "#a78bfa"))}" aria-label="Цвет" /><input data-preset-size="${id}" data-preset-kind="${kind}" inputmode="decimal" value="${esc(String(type.size || ""))}" aria-label="Размер, миллиметры" /><button type="button" class="calc-mini" data-del-custom="${kind}" data-custom-id="${id}" title="Удалить">×</button></div>`;
  }

  function refreshPresetRow(row) {
    if (!row) return;
    const kind = row.dataset.presetKind === "light" ? "light" : "socket";
    const type = presetCatalog(kind).find((item) => item.id === row.dataset.presetId);
    const slot = row.querySelector(".mark-swatch");
    if (type && slot) slot.outerHTML = presetSwatch(kind, type);
  }

  function markPresetHtml() {
    const socketForm = `<form class="mark-custom" data-custom="socket">${presetSwatch("socket", { letters: "Р", color: "#a78bfa", size: 80 })}<input name="name" maxlength="32" placeholder="Имя" aria-label="Имя розетки" /><input name="letters" maxlength="3" placeholder="Буквы" aria-label="Буквы, до трёх" /><input name="color" type="color" value="#a78bfa" aria-label="Цвет" /><input name="size" inputmode="decimal" value="80" aria-label="Размер, миллиметры" /><button type="submit" class="btn">Добавить</button></form>`;
    const lightForm = `<form class="mark-custom" data-custom="light">${presetSwatch("light", { shape: "circle", color: "#facc15", size: 120 })}<input name="name" maxlength="32" placeholder="Имя" aria-label="Имя света" />${markSelect("", "shape", [{ value: "circle", label: "круг" }, { value: "square", label: "квадрат" }, { value: "diamond", label: "ромб" }, { value: "rect", label: "прямоугольник" }, { value: "line", label: "линейный" }], "circle")}<input name="color" type="color" value="#facc15" aria-label="Цвет" /><input name="size" inputmode="decimal" value="120" aria-label="Размер, миллиметры" /><button type="submit" class="btn">Добавить</button></form>`;
    return `<div class="mark-presets" data-presets><section><h4>Розетки</h4>${socketForm}${socketCatalog().map((type) => presetRow("socket", type)).join("")}</section><section><h4>Свет</h4>${lightForm}${lightCatalog().map((type) => presetRow("light", type)).join("")}</section></div>`;
  }

  function refreshPresetDraft(form) {
    const slot = form?.querySelector(".mark-swatch");
    if (!slot) return;
    const data = new FormData(form);
    const next = form.dataset.custom === "light"
      ? presetSwatch("light", { shape: String(data.get("shape") || "circle"), color: data.get("color"), size: data.get("size") })
      : presetSwatch("socket", { letters: String(data.get("letters") || ""), color: data.get("color"), size: data.get("size") });
    slot.outerHTML = next;
  }

  function markShowMenu(clientX, clientY, hitId) {
    const canvas = $("mark-canvas");
    const menu = $("mark-menu");
    const card = $("mark-menu-card");
    const node = markNode();
    if (!canvas || !menu || !card || !node || !session.mark) return;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const world = markWorld(x, y);
    if (!world) return;
    session.mark.menu = { x, y, world, hitId: hitId || "" };
    if (hitId) session.mark.sel = hitId;
    menu.hidden = false;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.classList.toggle("is-plain", !hitId);
    const arrows = $("mark-arrows");
    if (arrows) arrows.hidden = !hitId;
    const surface = session.mark.surface;
    if (node.type === "openings") {
      card.innerHTML = `<button type="button" data-mark-act="rect">Прямоугольник</button><button type="button" data-mark-act="circle">Круг</button><div class="mark-dias">${PIPE_MM.map((mm) => `<button type="button" data-mark-act="dia" data-mm="${mm}">${mm}</button>`).join("")}</div>`;
    } else {
      const fix = hitId ? node.fixtures.find((item) => item.id === hitId) : null;
      const onSocket = fix && fix.kind !== "light" && session.mark.hitCell != null;
      if (fix && fix.kind === "light") {
        const swap = lightCatalog()
          .map((type) => `<button type="button" data-mark-act="swap-light" data-type="${esc(type.id)}" class="${type.id === fix.light ? "is-on" : ""}">${esc(type.name)}</button>`)
          .join("");
        const shape = lightById(fix.light)?.shape;
        const spin = lightRotates(shape)
          ? `<button type="button" data-mark-act="spin">+45°</button><div class="mark-angle"><input data-menu-angle inputmode="decimal" value="${esc(String(lightAngle(fix)))}" aria-label="Угол, градусы" /><button type="button" data-mark-act="angle">Угол</button></div>`
          : "";
        card.innerHTML = `${spin}<div class="mark-types"><b>Свет</b>${swap}</div>`;
      } else if (onSocket) {
        const current = fix.cells[session.mark.hitCell] || "";
        const swap = socketCatalog()
          .map((type) => `<button type="button" data-mark-act="swap" data-type="${esc(type.id)}" class="${type.id === current ? "is-on" : ""}">${esc(type.letters)} · ${esc(type.name)}</button>`)
          .join("");
        const flip = fix.orient === "v" ? "Горизонтально" : "Вертикально";
        card.innerHTML = `<button type="button" data-mark-act="flip">${flip}</button><div class="mark-sec"><span>Ячейки</span><button type="button" data-mark-act="sec" data-step="-1">−</button><b>${fix.cells.length}</b><button type="button" data-mark-act="sec" data-step="1">+</button></div><div class="mark-types"><b>Эта секция</b>${swap}</div>`;
      } else {
        const sockets = socketCatalog()
          .map((type) => `<button type="button" data-mark-act="socket" data-type="${esc(type.id)}">${esc(type.letters)} · ${esc(type.name)}</button>`)
          .join("");
        const lights = lightCatalog()
          .map((type) => `<button type="button" data-mark-act="light" data-type="${esc(type.id)}">${esc(type.name)}</button>`)
          .join("");
        card.innerHTML = `<div class="mark-orient">
          <button type="button" data-mark-act="orient" data-orient="h" class="${session.mark.orient !== "v" ? "is-on" : ""}">Горизонтально</button>
          <button type="button" data-mark-act="orient" data-orient="v" class="${session.mark.orient === "v" ? "is-on" : ""}">Вертикально</button>
        </div>
        <div class="mark-sec"><span>В секции</span><button type="button" data-mark-act="sec" data-step="-1">−</button><b>${session.mark.section || 1}</b><button type="button" data-mark-act="sec" data-step="1">+</button></div>
        <div class="mark-types"><b>Розетки</b>${sockets}<b>Свет</b>${lights}</div>
        <div class="mark-split"></div>
        <button type="button" data-mark-act="presets">Предустановки</button>`;
      }
    }
    const box = $("mark-nudge-box");
    if (box) box.hidden = true;
  }

  function markShift(node, hitId, dir, dist) {
    const vec = PLANNER_NUDGE_DIRS[dir];
    if (!vec || !(dist > 0)) return false;
    const len = Math.hypot(vec[0], vec[1]) || 1;
    const dx = (vec[0] / len) * dist;
    const dy = (vec[1] / len) * dist;
    if (node.type === "openings") {
      const hole = node.holes.find((item) => item.id === hitId);
      if (!hole) return false;
      if (hole.surface === "wall") {
        hole.along = plannerRound(hole.along + dx);
        hole.rise = plannerRound(hole.rise - dy);
      } else {
        hole.x = plannerRound(hole.x + dx);
        hole.y = plannerRound(hole.y + dy);
      }
      return true;
    }
    const fix = node.fixtures.find((item) => item.id === hitId);
    if (!fix) return false;
    if (fix.surface === "wall") {
      fix.along = plannerRound(fix.along + dx);
      fix.rise = plannerRound(fix.rise - dy);
    } else {
      fix.x = plannerRound(fix.x + dx);
      fix.y = plannerRound(fix.y + dy);
    }
    return true;
  }

  function clipWallId(raw, plan) {
    if (raw?.surface !== "wall") return "";
    const walls = plan ? plannerWalls(plan) : [];
    if (walls.some((wall) => wall.id === raw.wallId)) return raw.wallId;
    const index = Number(raw.wallIndex);
    if (index >= 0 && walls[index]) return walls[index].id;
    return walls[0]?.id || "";
  }

  function splitFeedOut(node, id) {
    const kinds = ["wall", "count", "own", "type", "frame"];
    for (const kind of kinds) {
      const head = `${kind}:`;
      if (!id.startsWith(head)) continue;
      const rest = id.slice(head.length);
      const extra = (node.feeds || []).find((feed) => feedPort(feed) !== PLAN_PORT && rest.startsWith(`${feed.id}:`));
      if (extra) return { kind, feedId: extra.id, rest: rest.slice(extra.id.length + 1) };
      const primary = (node.feeds || []).find((feed) => feedPort(feed) === PLAN_PORT) || node.feeds?.[0];
      return primary ? { kind, feedId: primary.id, rest } : null;
    }
    return null;
  }

  function feedOutParts(node, feed, indexOf) {
    const parts = [];
    Object.keys(node.outOn || {}).forEach((id) => {
      const part = splitFeedOut(node, id);
      if (!part || part.feedId !== feed.id || part.kind === "own") return;
      parts.push({
        kind: part.kind,
        rest: part.rest,
        on: !!node.outOn[id],
        wallIndex: part.kind === "wall" ? indexOf(part.rest) : -1,
      });
    });
    return parts;
  }

  function applyFeedClip(node, feed, clip, holes, plan) {
    if (!node.outOn || typeof node.outOn !== "object") node.outOn = {};
    const next = {};
    Object.keys(node.outOn).forEach((id) => {
      const part = splitFeedOut(node, id);
      if (part && part.feedId === feed.id) return;
      next[id] = node.outOn[id];
    });
    node.outOn = next;
    (clip.outs || []).forEach((part) => {
      let rest = part.rest;
      if (part.kind === "wall") rest = clipWallId({ surface: "wall", wallId: part.rest, wallIndex: part.wallIndex }, plan);
      if (!rest) return;
      node.outOn[feedKey(feed, part.kind, rest)] = !!part.on;
    });
    if (node.type !== "openings") return;
    const live = new Set((node.holes || []).map((hole) => hole.id));
    node.owns = (node.owns || []).map((own) => ({
      ...own,
      holes: (own.holes || []).filter((id) => live.has(id)),
    })).filter((own) => (own.holes || []).length);
    (clip.owns || []).forEach((own) => {
      const ids = (own.holes || []).map((index) => holes[index]?.id).filter(Boolean);
      if (!ids.length) return;
      const id = uid();
      node.owns.push({ id, name: String(own.name || "Свой").slice(0, 48) || "Свой", holes: ids });
      node.outOn[feedKey(feed, "own", id)] = !!own.on;
    });
  }

  function showCopied(btn) {
    if (!btn) return;
    if (!btn.dataset.copyHtml) btn.dataset.copyHtml = btn.innerHTML;
    if (!btn.dataset.copyTitle) btn.dataset.copyTitle = btn.getAttribute("title") || "Копировать";
    clearTimeout(Number(btn.dataset.copyTimer) || 0);
    btn.classList.add("is-copied");
    btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 9.2 16.8 19 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    btn.title = "Скопировано";
    btn.setAttribute("aria-label", "Скопировано");
    btn.dataset.copyTimer = String(setTimeout(() => {
      btn.classList.remove("is-copied");
      btn.innerHTML = btn.dataset.copyHtml;
      btn.title = btn.dataset.copyTitle;
      btn.setAttribute("aria-label", btn.dataset.copyTitle);
    }, 900));
  }

  function syncMarkPaste(node) {
    const paste = $("mark-paste");
    const menu = $("mark-paste-menu");
    const show = !!node && editorClip?.kind === node.type;
    if (paste) paste.hidden = !show;
    if (!show && menu) menu.hidden = true;
  }

  function markCopy() {
    const node = markNode();
    const ctx = markContext();
    if (!node || !ctx?.feed) return;
    const walls = ctx.base ? plannerWalls(ctx.base) : [];
    const indexOf = (wallId) => walls.findIndex((wall) => wall.id === wallId);
    if (node.type === "openings") {
      const mine = node.holes.filter((hole) => hole.feed === ctx.feed.id);
      const mineIds = mine.map((hole) => hole.id);
      editorClip = {
        kind: "openings",
        holes: mine.map((hole) => ({
          ...JSON.parse(JSON.stringify(hole)),
          wallIndex: indexOf(hole.wallId),
        })),
        outs: feedOutParts(node, ctx.feed, indexOf),
        owns: (node.owns || []).map((own) => ({
          name: own.name || "Свой",
          on: !!node.outOn?.[feedKey(ctx.feed, "own", own.id)],
          holes: (own.holes || []).map((id) => mineIds.indexOf(id)).filter((index) => index >= 0),
        })).filter((own) => own.holes.length),
      };
    } else {
      editorClip = {
        kind: "electrics",
        fixtures: node.fixtures.filter((fix) => fix.feed === ctx.feed.id).map((fix) => ({
          ...JSON.parse(JSON.stringify(fix)),
          wallIndex: indexOf(fix.wallId),
        })),
        outs: feedOutParts(node, ctx.feed, indexOf),
      };
    }
    syncMarkPaste(node);
    showCopied($("mark-copy"));
  }

  function markPaste(mode) {
    const node = markNode();
    const ctx = markContext();
    if (!node || !ctx?.feed || editorClip?.kind !== node.type) return;
    const feedId = ctx.feed.id;
    if (node.type === "openings") {
      if (mode === "replace") node.holes = node.holes.filter((hole) => hole.feed !== feedId);
      const room = 80 - node.holes.length;
      const incoming = (editorClip.holes || []).slice(0, Math.max(0, room)).map((raw) => {
        const hole = JSON.parse(JSON.stringify(raw));
        delete hole.wallIndex;
        hole.id = uid();
        hole.feed = feedId;
        hole.bind = { w: false, h: false, d: false };
        hole.wallId = clipWallId(raw, ctx.base);
        return hole;
      });
      if (!incoming.length) {
        if ((editorClip.holes || []).length) api?.toast?.("Часть проёмов не влезла");
        if (mode !== "replace") return;
      } else if (incoming.length < (editorClip.holes || []).length) api?.toast?.("Часть проёмов не влезла");
      node.holes.push(...incoming);
      if (mode === "replace") applyFeedClip(node, ctx.feed, editorClip, incoming, ctx.base);
    } else {
      if (mode === "replace") node.fixtures = node.fixtures.filter((fix) => fix.feed !== feedId);
      const room = 120 - node.fixtures.length;
      const incoming = (editorClip.fixtures || []).slice(0, Math.max(0, room)).map((raw) => {
        const fix = JSON.parse(JSON.stringify(raw));
        delete fix.wallIndex;
        fix.id = uid();
        fix.feed = feedId;
        fix.wallId = clipWallId(raw, ctx.base);
        return fix;
      });
      if (!incoming.length) {
        if ((editorClip.fixtures || []).length) api?.toast?.("Часть точек не влезла");
        if (mode !== "replace") return;
      } else if (incoming.length < (editorClip.fixtures || []).length) api?.toast?.("Часть точек не влезла");
      node.fixtures.push(...incoming);
      if (mode === "replace") applyFeedClip(node, ctx.feed, editorClip, [], ctx.base);
    }
    if (session.mark) session.mark.sel = "";
    markCommit(true);
  }

