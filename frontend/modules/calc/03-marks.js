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
    if (kind === "surf") return primary ? `surf:${rest}` : `surf:${feed.id}:${rest}`;
    if (kind === "tile") return primary ? `tile:${rest}` : `tile:${feed.id}:${rest}`;
    if (kind === "cut") return primary ? `cut:${rest}` : `cut:${feed.id}:${rest}`;
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
    const hasContent = (feed) => (node.holes || []).some((hole) => hole.feed === feed.id) || (node.fixtures || []).some((fix) => fix.feed === feed.id) || (node.lays || []).some((lay) => lay.feed === feed.id);
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
    let src = (host.nodes || []).find((item) => item.id === link.from);
    if (!src) return "Чертёж";
    let fromPort = link.fromPort;
    if (src.type === "joint" || src.type === "bus" || src.type === "teleport" || src.type === "teleout") {
      const origin = planSource(src, host, fromPort);
      if (!origin) return "Чертёж";
      src = origin.node;
      fromPort = origin.port;
    }
    if (src.type === "planner") {
      ensurePlanner(src);
      const layout = (src.layouts || []).find((item) => plannerPort(item, "plan") === fromPort);
      return layout?.name || plannerName(src);
    }
    if (src.type === "openings") {
      ensureOpenings(src);
      const srcFeed = (src.feeds || []).find((item) => feedPort(item) === fromPort);
      const up = srcFeed && (host.links || []).find((item) => item.to === src.id && item.toPort === feedPort(srcFeed));
      const upNode = up && (host.nodes || []).find((item) => item.id === up.from);
      const origin = upNode && (upNode.type === "joint" || upNode.type === "bus" || upNode.type === "teleport" || upNode.type === "teleout") ? planSource(upNode, host, up.fromPort) : (upNode ? { node: upNode, port: up.fromPort } : null);
      if (origin?.node?.type === "planner") {
        ensurePlanner(origin.node);
        const layout = (origin.node.layouts || []).find((item) => plannerPort(item, "plan") === origin.port);
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
    if (node.type === "tiles") {
      ensureTiles(node);
      return node.feeds.filter((feed) => upstreamPlan(node, host, [], values || {}, feedPort(feed))).map((feed) => ({
        id: feed.id,
        name: feedTitle(node, feed, host),
        rows: tileFeedPorts(node, host, values, links, feed, true).filter((port) => port.signal !== "plan").map((port) => ({
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

  function portSignal(node, portId, seen) {
    if (!node) return "num";
    const id = String(portId || "");
    const guard = seen || new Set();
    if (node.type === "result") {
      const key = `result:${node.id}`;
      if (guard.has(key)) return "num";
      guard.add(key);
      const home = blueprintOf(node);
      const link = (home?.links || []).find((item) => item.to === node.id && item.toPort === "in");
      if (!link) return "num";
      const src = (home.nodes || []).find((item) => item.id === link.from);
      return src && portSignal(src, link.fromPort, guard) === "plan" ? "plan" : "num";
    }
    if (node.type === "scheme") {
      if (!id.startsWith("result:")) return "num";
      const key = `scheme:${node.id}:${id}`;
      if (guard.has(key)) return "num";
      guard.add(key);
      const other = findBlueprint(node.blueprintId);
      const home = blueprintOf(node);
      if (!other || (home && other.id === home.id)) return "num";
      const result = (other.nodes || []).find((item) => item.id === id.slice(7) && item.type === "result");
      if (!result || result.visible === false) return "num";
      return portSignal(result, "out", guard);
    }
    if (node.type === "planner" && (id === "plan" || id.startsWith("plan:"))) return "plan";
    if ((node.type === "openings" || node.type === "electrics" || node.type === "tiles") && (id === PLAN_PORT || id.startsWith("plan:"))) return "plan";
    if (node.type === "joint") return node.signal === "plan" ? "plan" : "num";
    if (node.type === "teleport") {
      const entry = teleportPortOf(node, id) || teleportEntries(node)[0];
      return entry?.signal === "plan" ? "plan" : "num";
    }
    if (node.type === "teleout") {
      const pid = id.startsWith("out:") ? id.slice(4) : "";
      const port = (node.ports || []).find((item) => item.id === pid);
      return port?.signal === "plan" ? "plan" : "num";
    }
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
    if (node.type === "joint" || node.type === "bus" || node.type === "teleport" || node.type === "teleout") {
      const origin = planSource(node, bp, fromPort);
      if (!origin || origin.node.id === node.id) return null;
      return emitPlan(origin.node, bp, next, values, origin.port);
    }
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
    if (node.type === "tiles") return null;
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
    if (node.type === "result") {
      const link = (bp.links || []).find((item) => item.to === node.id && item.toPort === "in");
      if (!link) return null;
      const src = (bp.nodes || []).find((item) => item.id === link.from);
      if (!src || portSignal(src, link.fromPort) !== "plan") return null;
      return emitPlan(src, bp, next, values, link.fromPort);
    }
    if (node.type === "scheme") {
      const mark = `bp:${node.blueprintId}`;
      if (next.includes(mark) || node.blueprintId === bp.id) return null;
      const other = findBlueprint(node.blueprintId);
      if (!other) return null;
      const resultId = String(fromPort || "").startsWith("result:") ? fromPort.slice(7) : "";
      const result = (other.nodes || []).find((item) => item.id === resultId && item.type === "result");
      if (!result || result.visible === false) return null;
      return emitPlan(result, other, next.concat(mark), values, "out");
    }
    return null;
  }

  function planSource(node, bp, fromPort, seen) {
    const guard = seen || new Set();
    const key = `${node?.id || ""}:${fromPort || ""}`;
    if (!node || guard.has(key)) return null;
    guard.add(key);
    if (node.type === "joint") {
      const link = (bp?.links || []).find((item) => item.to === node.id && item.toPort === "in");
      if (!link) return null;
      const src = (bp.nodes || []).find((item) => item.id === link.from);
      return planSource(src, bp, link.fromPort, guard);
    }
    if (node.type === "teleport") {
      const port = teleportPortOf(node, fromPort) || teleportEntries(node)[0];
      if (!port) return null;
      const link = (bp?.links || []).find((item) => item.to === node.id && teleportLinkHits(node, port, item.toPort));
      if (!link) return null;
      const src = (bp.nodes || []).find((item) => item.id === link.from);
      return planSource(src, bp, link.fromPort, guard);
    }
    if (node.type === "teleout") {
      const pid = String(fromPort || "").startsWith("out:") ? String(fromPort).slice(4) : "";
      const port = (node.ports || []).find((item) => item.id === pid);
      const host = teleportHost(bp, port?.source);
      if (!host) return null;
      return planSource(host, bp, `in:${port.source}`, guard);
    }
    if (node.type === "bus") {
      const link = (bp?.links || []).find((item) => item.to === node.id && item.toPort === `in:${laneIdOf(fromPort)}`);
      if (!link) return null;
      const src = (bp.nodes || []).find((item) => item.id === link.from);
      return planSource(src, bp, link.fromPort, guard);
    }
    return { node, port: fromPort };
  }

  function upstreamPlan(node, bp, stack, values, portId) {
    let port = portId || PLAN_PORT;
    if (!portId && (node?.type === "openings" || node?.type === "electrics" || node?.type === "tiles")) {
      if (node.type === "openings") ensureOpenings(node);
      else if (node.type === "tiles") ensureTiles(node);
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
        fromCenter: raw.fromCenter === true,
        edgeFrom: String(raw.edgeFrom || ""),
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
    if (node.type === "tiles") return false;
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
    if (node.type === "tiles") return node.name || "Плитка";
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

  const TILE_PATTERNS = [
    ["rect", "Прямоугольник"],
    ["chevron", "Шеврон"],
    ["herringbone", "Ёлка"],
    ["honeycomb", "Соты"],
    ["quad", "2+2"],
    ["parquet", "Паркет"],
  ];
  const TILE_DIRS = [[0, "Вдоль · слева"], [90, "Поперёк · снизу"], [180, "Вдоль · справа"], [270, "Поперёк · сверху"]];

  function tilePatternName(id) {
    return TILE_PATTERNS.find((item) => item[0] === id)?.[1] || "Прямоугольник";
  }

  function tileCm(meters) {
    return plannerInput(plannerRound(plannerNum(meters, 0) * 100));
  }

  function tileFromCm(text, fallback, lo, hi) {
    const n = plannerDraft(text);
    if (n == null) return null;
    return plannerRound(plannerClamp(n / 100, lo, hi));
  }

  function polySigned(pts) {
    let area = 0;
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      area += p.x * q.y - q.x * p.y;
    }
    return area / 2;
  }

  function polyArea(pts) {
    return Math.abs(polySigned(pts || []));
  }

  function polyNorm(pts) {
    const clean = [];
    (pts || []).forEach((p) => {
      if (!p) return;
      const last = clean[clean.length - 1];
      if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-7) clean.push({ x: p.x, y: p.y });
    });
    if (clean.length > 2 && Math.hypot(clean[0].x - clean[clean.length - 1].x, clean[0].y - clean[clean.length - 1].y) < 1e-7) clean.pop();
    if (clean.length > 2 && polySigned(clean) < 0) clean.reverse();
    return clean;
  }

  function polyIsRect(pts) {
    const poly = polyNorm(pts);
    if (poly.length !== 4) return false;
    for (let i = 0; i < 4; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % 4];
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      if (dx > 1e-4 && dy > 1e-4) return false;
    }
    return true;
  }

  function clipToConvex(subject, clip) {
    const window = polyNorm(clip);
    if (window.length < 3) return [];
    let output = polyNorm(subject);
    const cross = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const hit = (p, q, a, b) => {
      const rx = q.x - p.x;
      const ry = q.y - p.y;
      const sx = b.x - a.x;
      const sy = b.y - a.y;
      const den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-12) return { x: p.x, y: p.y };
      const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / den;
      return { x: p.x + t * rx, y: p.y + t * ry };
    };
    for (let i = 0; i < window.length && output.length; i += 1) {
      const a = window[i];
      const b = window[(i + 1) % window.length];
      const input = output;
      output = [];
      for (let j = 0; j < input.length; j += 1) {
        const p = input[j];
        const q = input[(j + 1) % input.length];
        const pin = cross(a, b, p) >= -1e-9;
        const qin = cross(a, b, q) >= -1e-9;
        if (qin) {
          if (!pin) output.push(hit(p, q, a, b));
          output.push(q);
        } else if (pin) output.push(hit(p, q, a, b));
      }
      output = polyNorm(output);
    }
    return output.length > 2 ? output : [];
  }

  function clipHalf(poly, inside, at) {
    const out = [];
    if (!poly?.length) return out;
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const pin = inside(p);
      const qin = inside(q);
      if (qin) {
        if (!pin) out.push(at(p, q));
        out.push(q);
      } else if (pin) out.push(at(p, q));
    }
    return polyNorm(out);
  }

  function tileSubtract(poly, hole) {
    const x0 = hole.x;
    const y0 = hole.y;
    const x1 = hole.x + hole.w;
    const y1 = hole.y + hole.h;
    const vx = (p, q, x) => {
      const t = Math.abs(q.x - p.x) < 1e-12 ? 0 : (x - p.x) / (q.x - p.x);
      return { x, y: p.y + t * (q.y - p.y) };
    };
    const hy = (p, q, y) => {
      const t = Math.abs(q.y - p.y) < 1e-12 ? 0 : (y - p.y) / (q.y - p.y);
      return { x: p.x + t * (q.x - p.x), y };
    };
    const left = clipHalf(poly, (p) => p.x <= x0 + 1e-8, (p, q) => vx(p, q, x0));
    const right = clipHalf(poly, (p) => p.x >= x1 - 1e-8, (p, q) => vx(p, q, x1));
    let mid = clipHalf(poly, (p) => p.x >= x0 - 1e-8, (p, q) => vx(p, q, x0));
    mid = clipHalf(mid, (p) => p.x <= x1 + 1e-8, (p, q) => vx(p, q, x1));
    const bottom = clipHalf(mid, (p) => p.y <= y0 + 1e-8, (p, q) => hy(p, q, y0));
    const top = clipHalf(mid, (p) => p.y >= y1 - 1e-8, (p, q) => hy(p, q, y1));
    return [left, right, bottom, top].filter((part) => polyArea(part) > 1e-6);
  }

  function tileInset(poly, gap) {
    if (!gap || poly.length < 3) return poly;
    let area = 0;
    poly.forEach((p, i) => {
      const next = poly[(i + 1) % poly.length];
      area += p.x * next.y - next.x * p.y;
    });
    const direction = area >= 0 ? 1 : -1;
    const offset = gap / 2;
    const edges = poly.map((p, i) => {
      const next = poly[(i + 1) % poly.length];
      const dx = next.x - p.x;
      const dy = next.y - p.y;
      const length = Math.hypot(dx, dy) || 1;
      const normal = direction > 0
        ? { x: -dy / length, y: dx / length }
        : { x: dy / length, y: -dx / length };
      return { point: { x: p.x + normal.x * offset, y: p.y + normal.y * offset }, direction: { x: dx, y: dy }, normal };
    });
    const inset = poly.map((_, i) => {
      const previous = edges[(i + edges.length - 1) % edges.length];
      const current = edges[i];
      const cross = previous.direction.x * current.direction.y - previous.direction.y * current.direction.x;
      if (Math.abs(cross) < 1e-10) {
        return { x: poly[i].x + (previous.normal.x + current.normal.x) * offset / 2, y: poly[i].y + (previous.normal.y + current.normal.y) * offset / 2 };
      }
      const dx = current.point.x - previous.point.x;
      const dy = current.point.y - previous.point.y;
      const t = (dx * current.direction.y - dy * current.direction.x) / cross;
      return { x: previous.point.x + previous.direction.x * t, y: previous.point.y + previous.direction.y * t };
    });
    return inset.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) && polyArea(inset) > 1e-8 ? inset : poly;
  }

  function tileSpan(part, toLocal, tile) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    part.forEach((p) => {
      const q = toLocal(p);
      if (q.x < minX) minX = q.x;
      if (q.x > maxX) maxX = q.x;
      if (q.y < minY) minY = q.y;
      if (q.y > maxY) maxY = q.y;
    });
    return {
      w: plannerClamp(maxX - minX, 0, tile.w),
      h: plannerClamp(maxY - minY, 0, tile.h),
    };
  }

  function tileHoleSplitsCell(cell, hole) {
    const xs = cell.map((p) => p.x);
    const ys = cell.map((p) => p.y);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const eps = 0.002;
    const overlapX = Math.min(x1, hole.x + hole.w) - Math.max(x0, hole.x);
    const overlapY = Math.min(y1, hole.y + hole.h) - Math.max(y0, hole.y);
    if (overlapX <= eps || overlapY <= eps) return false;
    // Проём должен пересечь плитку насквозь, от одного её края до противоположного.
    const throughHeight = hole.y <= y0 + eps && hole.y + hole.h >= y1 - eps;
    const throughWidth = hole.x <= x0 + eps && hole.x + hole.w >= x1 - eps;
    return throughHeight || throughWidth;
  }

  function tileHasFactoryEdge(part, cell) {
    const eps = 0.002;
    const cross = (a, b) => a.x * b.y - a.y * b.x;
    const dot = (a, b) => a.x * b.x + a.y * b.y;
    for (let i = 0; i < cell.length; i += 1) {
      const ca = cell[i];
      const cb = cell[(i + 1) % cell.length];
      const edge = { x: cb.x - ca.x, y: cb.y - ca.y };
      const edgeLen = Math.hypot(edge.x, edge.y);
      if (edgeLen < 0.003) continue;
      for (let j = 0; j < part.length; j += 1) {
        const pa = part[j];
        const pb = part[(j + 1) % part.length];
        const side = { x: pb.x - pa.x, y: pb.y - pa.y };
        const sideLen = Math.hypot(side.x, side.y);
        if (sideLen < 0.003 || Math.abs(cross(edge, side)) > eps * edgeLen * sideLen) continue;
        if (Math.abs(cross(edge, { x: pa.x - ca.x, y: pa.y - ca.y })) > eps * edgeLen) continue;
        const axis = { x: edge.x / edgeLen, y: edge.y / edgeLen };
        const a0 = dot({ x: pa.x - ca.x, y: pa.y - ca.y }, axis);
        const a1 = dot({ x: pb.x - ca.x, y: pb.y - ca.y }, axis);
        if (Math.min(edgeLen, Math.max(a0, a1)) - Math.max(0, Math.min(a0, a1)) > 0.003) return true;
      }
    }
    return false;
  }

  function tilePack(parts, width, height, tolW, tolH, allowPairs = true) {
    let count = 0;
    let cuts = 0;
    const rest = [];
    parts.forEach((part) => {
      if (part.full) count += 1;
      else if (part.w > 0.003 && part.h > 0.003) rest.push(part);
    });
    rest.sort((a, b) => b.w * b.h - a.w * a.h);
    const used = new Array(rest.length).fill(false);
    const halfW = width / 2;
    const halfH = height / 2;
    const fits = (a, b) => {
      if (!a.cleanEdge || !b.cleanEdge || (a.parentId && a.parentId === b.parentId)) return false;
      const alongW = a.w + b.w <= width + tolW + 1e-9 && a.h <= height + tolH + 1e-9 && b.h <= height + tolH + 1e-9 && (a.w < halfW - 1e-9 || b.w < halfW - 1e-9);
      const alongH = a.h + b.h <= height + tolH + 1e-9 && a.w <= width + tolW + 1e-9 && b.w <= width + tolW + 1e-9 && (a.h < halfH - 1e-9 || b.h < halfH - 1e-9);
      return alongW || alongH;
    };
    for (let i = 0; i < rest.length; i += 1) {
      if (used[i]) continue;
      let best = -1;
      let bestArea = -1;
      for (let j = i + 1; allowPairs && j < rest.length; j += 1) {
        if (used[j] || !fits(rest[i], rest[j])) continue;
        const area = rest[j].w * rest[j].h;
        if (area > bestArea) {
          bestArea = area;
          best = j;
        }
      }
      if (best >= 0) {
        used[best] = true;
        rest[i].pair = rest[best].parentId || rest[best].id;
        rest[best].pair = rest[i].parentId || rest[i].id;
      }
      used[i] = true;
      count += 1;
      cuts += 1;
    }
    return { count, cuts };
  }

  function tileFrame(geom, dir, shiftX, shiftY, turn) {
    const span = geom.span || { w: 0, h: 0 };
    // «Вдоль · справа» разворачивает ряд только по горизонтали.
    // Вертикальная опора остаётся у пола, чтобы раскладка не начиналась от потолка.
    const origin = dir === 180
      ? { x: geom.anchor.x + span.w, y: geom.anchor.y }
      : dir === 270
        ? { x: geom.anchor.x + span.w, y: geom.anchor.y + span.h }
        : geom.anchor;
    let ux = dir === 90 ? { x: 0, y: 1 } : dir === 270 ? { x: 0, y: -1 } : dir === 180 ? { x: -1, y: 0 } : { x: 1, y: 0 };
    let uy = dir === 90 ? { x: 1, y: 0 } : dir === 270 ? { x: -1, y: 0 } : { x: 0, y: 1 };
    const rad = ((Number(turn) || 0) * Math.PI) / 180;
    if (rad) {
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      const spin = (v) => ({ x: v.x * c - v.y * s, y: v.x * s + v.y * c });
      ux = spin(ux);
      uy = spin(uy);
    }
    const det = ux.x * uy.y - ux.y * uy.x || 1;
    return {
      toSurface(x, y) {
        const px = x + shiftX;
        const py = y + shiftY;
        return { x: origin.x + px * ux.x + py * uy.x, y: origin.y + px * ux.y + py * uy.y };
      },
      toPattern(x, y) {
        const dx = x - origin.x;
        const dy = y - origin.y;
        return {
          x: (dx * uy.y - dy * uy.x) / det - shiftX,
          y: (dy * ux.x - dx * ux.y) / det - shiftY,
        };
      },
    };
  }

  function tileRectToPattern(frame, rect) {
    const pts = [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.w, y: rect.y },
      { x: rect.x + rect.w, y: rect.y + rect.h },
      { x: rect.x, y: rect.y + rect.h },
    ].map((p) => frame.toPattern(p.x, p.y));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  function tileBBox(pts) {
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  function tileCut(cell, surface, holes) {
    let parts = [clipToConvex(surface, cell)].filter((part) => polyArea(part) > 1e-6);
    holes.forEach((hole) => {
      const next = [];
      parts.forEach((part) => next.push(...tileSubtract(part, hole)));
      parts = next;
    });
    return parts;
  }

  function tileRemember(bag, tile, part, cell, toLocal) {
    const span = tileSpan(part, toLocal, tile);
    if (span.w < 0.003 || span.h < 0.003) return;
    const full = polyArea(part) >= polyArea(cell) * 0.985 && span.w >= tile.w - 0.002 && span.h >= tile.h - 0.002;
    bag.pieces.push({ w: span.w, h: span.h, full });
    if (bag.polys && bag.polys.length < 1400) bag.polys.push(part);
    else bag.solid = true;
  }

  function tileRectRun(tile, frame, region, holes, bag) {
    const pitchX = tile.w + (tile.gap || 0);
    const pitchY = tile.h + (tile.gap || 0);
    const i0 = Math.floor((region.x - tile.w) / pitchX) - 1;
    const i1 = Math.ceil((region.x + region.w) / pitchX) + 1;
    const j0 = Math.floor(region.y / pitchY) - 1;
    const j1 = Math.ceil((region.y + region.h) / pitchY) + 1;
    if ((i1 - i0) * (j1 - j0) > 24000) {
      bag.overflow = true;
      return;
    }
    const overlap = (a, b) => {
      const x = Math.max(a.x, b.x);
      const y = Math.max(a.y, b.y);
      const w = Math.min(a.x + a.w, b.x + b.w) - x;
      const h = Math.min(a.y + a.h, b.y + b.h) - y;
      return w > 1e-5 && h > 1e-5 ? { x, y, w, h } : null;
    };
    const cut = (rects, hole) => {
      const next = [];
      rects.forEach((rect) => {
        const x0 = Math.max(rect.x, hole.x);
        const y0 = Math.max(rect.y, hole.y);
        const x1 = Math.min(rect.x + rect.w, hole.x + hole.w);
        const y1 = Math.min(rect.y + rect.h, hole.y + hole.h);
        if (x1 <= x0 + 1e-8 || y1 <= y0 + 1e-8) {
          next.push(rect);
          return;
        }
        if (x0 > rect.x + 1e-6) next.push({ x: rect.x, y: rect.y, w: x0 - rect.x, h: rect.h });
        if (rect.x + rect.w > x1 + 1e-6) next.push({ x: x1, y: rect.y, w: rect.x + rect.w - x1, h: rect.h });
        if (y0 > rect.y + 1e-6) next.push({ x: x0, y: rect.y, w: x1 - x0, h: y0 - rect.y });
        if (rect.y + rect.h > y1 + 1e-6) next.push({ x: x0, y: y1, w: x1 - x0, h: rect.y + rect.h - y1 });
      });
      return next.filter((rect) => rect.w > 0.003 && rect.h > 0.003);
    };
    for (let i = i0; i < i1; i += 1) {
      for (let j = j0; j < j1; j += 1) {
        const shiftStep = Math.abs(j) % (Math.max(1, Math.round(tile.bondRows || 1)) + 1);
        const rowShift = tile.w * plannerClamp(tile.bond || 0, 0, 1) * shiftStep;
        const cell = { x: i * pitchX + rowShift, y: j * pitchY, w: tile.w, h: tile.h };
        const hit = overlap(cell, region);
        if (!hit) continue;
        let rects = [hit];
        holes.forEach((hole) => { rects = cut(rects, hole); });
        const area = rects.reduce((sum, rect) => sum + rect.w * rect.h, 0);
        if (area < 1e-4) continue;
        const full = area >= tile.w * tile.h - 1e-4 && hit.w >= tile.w - 0.002 && hit.h >= tile.h - 0.002 && Math.abs(hit.x - cell.x) < 0.002 && Math.abs(hit.y - cell.y) < 0.002;
        const toPoly = (rect) => polyNorm([
          frame.toSurface(rect.x, rect.y),
          frame.toSurface(rect.x + rect.w, rect.y),
          frame.toSurface(rect.x + rect.w, rect.y + rect.h),
          frame.toSurface(rect.x, rect.y + rect.h),
        ]);
        const piece = {
          id: `r${i}:${j}`,
          w: Math.min(tile.w, hit.w),
          h: Math.min(tile.h, hit.h),
          full,
          pair: "",
          pattern: tile.pattern,
          tileW: tile.w,
          tileH: tile.h,
          cell: toPoly(cell),
          face: toPoly(hit),
          cuts: rects.map(toPoly),
          poly: toPoly(hit),
        };
        const throughCut = holes.some((hole) => tileHoleSplitsCell(
          [{ x: cell.x, y: cell.y }, { x: cell.x + cell.w, y: cell.y }, { x: cell.x + cell.w, y: cell.y + cell.h }, { x: cell.x, y: cell.y + cell.h }],
          hole,
        ));
        // Внутреннее отверстие или вырез от одного края не делит плитку на заготовки.
        // Геометрия реза нужна предпросмотру всегда, даже если вырез не делит плитку насквозь.
        piece.cuts = rects.map(toPoly);
        if (throughCut) {
          rects.forEach((rect, index) => {
            bag.pieces.push({
              id: `${piece.id}:cut:${index}`,
              parentId: piece.id,
              w: rect.w,
              h: rect.h,
              full: false,
              cleanEdge: tileHasFactoryEdge(toPoly(rect), toPoly(cell)),
              pair: "",
            });
          });
        } else {
          bag.pieces.push({ id: piece.id, w: piece.w, h: piece.h, full, pair: "" });
        }
        if (bag.polys && bag.polys.length < 1400) bag.polys.push(piece);
        else bag.solid = true;
      }
    }
  }

  function tileQuadCells(tile) {
    const w = tile.w;
    const h = tile.h;
    const long = Math.max(w, h);
    const short = Math.min(w, h);
    if (long - short < 0.004) {
      return {
        cells: [
          { x: 0, y: 0, w, h, swap: false },
          { x: w, y: 0, w, h, swap: false },
          { x: 0, y: h, w, h, swap: false },
          { x: w, y: h, w, h, swap: false },
        ],
        groupW: w * 2,
        groupH: h * 2,
      };
    }
    const flat = { w: long, h: short, swap: h > w };
    const tall = { w: short, h: long, swap: w > h };
    return {
      cells: [
        { x: 0, y: 0, w: flat.w, h: flat.h, swap: flat.swap },
        { x: 0, y: short, w: flat.w, h: flat.h, swap: flat.swap },
        { x: long, y: 0, w: tall.w, h: tall.h, swap: tall.swap },
        { x: long + short, y: 0, w: tall.w, h: tall.h, swap: tall.swap },
      ],
      groupW: long + short * 2,
      groupH: Math.max(short * 2, long),
    };
  }

  function tileHerringCells(tile) {
    const long = tile.w;
    const short = tile.h;
    const k = Math.max(1, Math.round(long / Math.max(short, 0.02)));
    const cells = [];
    for (let i = 0; i < k; i += 1) cells.push({ x: 0, y: i * short, w: long, h: short, swap: false });
    cells.push({ x: long, y: 0, w: short, h: long, swap: true });
    const stack = k * short;
    if (stack < long - 0.004) cells.push({ x: 0, y: stack, w: long, h: long - stack, swap: false, gap: true });
    if (stack > long + 0.004) cells.push({ x: long, y: long, w: short, h: stack - long, swap: true, gap: true });
    return { cells, groupW: long + short, groupH: Math.max(long, stack) };
  }

  function tileShape(tile, kind, ox, oy) {
    const w = tile.w;
    const h = tile.h;
    if (kind === "hex") {
      return [
        { x: ox + w / 2, y: oy },
        { x: ox, y: oy + h * 0.25 },
        { x: ox, y: oy + h * 0.75 },
        { x: ox + w / 2, y: oy + h },
        { x: ox + w, y: oy + h * 0.75 },
        { x: ox + w, y: oy + h * 0.25 },
      ];
    }
    if (kind === "honeycomb") {
      return [
        { x: ox + w * 0.25, y: oy },
        { x: ox, y: oy + h / 2 },
        { x: ox + w * 0.25, y: oy + h },
        { x: ox + w * 0.75, y: oy + h },
        { x: ox + w, y: oy + h / 2 },
        { x: ox + w * 0.75, y: oy },
      ];
    }
    return [
      { x: ox, y: oy },
      { x: ox + w, y: oy },
      { x: ox + w, y: oy + h },
      { x: ox, y: oy + h },
    ];
  }

  function tileChevron(tile, side, ox, oy) {
    const L = tile.w * Math.SQRT1_2;
    const T = tile.h * Math.SQRT2;
    const local = side
      ? [
        { x: L, y: L },
        { x: 2 * L, y: 0 },
        { x: 2 * L, y: T },
        { x: L, y: L + T },
      ]
      : [
        { x: 0, y: 0 },
        { x: L, y: L },
        { x: L, y: L + T },
        { x: 0, y: T },
      ];
    return local.map((p) => ({ x: p.x + ox, y: p.y + oy }));
  }

  function tileChevronLocal(tile, side, x, y) {
    const L = tile.w * Math.SQRT1_2;
    const T = tile.h * Math.SQRT2;
    if (!side) return { x: (x / L) * tile.w, y: ((y - x) / T) * tile.h };
    const u = (x - L) / L;
    const v = (y - (2 * L - x)) / T;
    return { x: u * tile.w, y: v * tile.h };
  }

  function tileParquetLayout(tile) {
    const L = tile.w;
    const W = tile.h;
    const c = Math.SQRT1_2;
    const rot = (x, y) => ({ x: (x - y) * c, y: (x + y) * c });
    const board = (x, y, rw, rh, alongY) => ({
      alongY,
      x,
      y,
      pts: [rot(x, y), rot(x + rw, y), rot(x + rw, y + rh), rot(x, y + rh)],
    });
    return {
      boards: [board(0, 0, L, W, false), board(0, W, W, L, true)],
      vx: rot(-L, L),
      vy: rot(W, W),
    };
  }

  function tilePatternRun(tile, frame, surface, holes, bag) {
    const pattern = tile.pattern;
    const poly = surface.map((p) => frame.toPattern(p.x, p.y));
    const box = tileBBox(poly);
    let seq = 0;
    const emit = (pts, toLocal) => {
      const cell = polyNorm(pts.map((p) => frame.toSurface(p.x, p.y)));
      if (cell.length < 3) return;
      const clipped = clipToConvex(surface, cell);
      if (polyArea(clipped) < 1e-6) return;
      let parts = [clipped];
      holes.forEach((hole) => {
        const next = [];
        parts.forEach((part) => next.push(...tileSubtract(part, hole)));
        parts = next;
      });
      const area = parts.reduce((sum, part) => sum + polyArea(part), 0);
      if (area < 1e-4) return;
      const span = tileSpan(clipped, toLocal, tile);
      const full = area >= polyArea(cell) * 0.985 && span.w >= tile.w - 0.002 && span.h >= tile.h - 0.002;
      const piece = { id: `p${seq}`, w: span.w, h: span.h, full, pair: "", pattern: tile.pattern, tileW: tile.w, tileH: tile.h, cell, face: clipped, cuts: parts, poly: tile.gap > 0 ? tileInset(clipped, tile.gap) : clipped };
      seq += 1;
      const throughCut = holes.some((hole) => tileHoleSplitsCell(cell, hole));
      if (throughCut) {
        // Только сквозной проём образует отдельные фрагменты для подбора пары.
        parts.forEach((part, index) => {
          const fragment = tileSpan(part, toLocal, tile);
          if (fragment.w < 0.003 || fragment.h < 0.003) return;
          bag.pieces.push({
            id: `${piece.id}:cut:${index}`,
            parentId: piece.id,
            w: fragment.w,
            h: fragment.h,
            full: false,
            cleanEdge: tileHasFactoryEdge(part, cell),
            pair: "",
          });
        });
      } else {
        // Внутренние отверстия и краевые вырезы не дробят плитку в расчёте.
        bag.pieces.push({ id: piece.id, w: span.w, h: span.h, full, pair: "" });
      }
      // Для предпросмотра всегда сохраняем реальный контур после выреза.
      piece.cuts = parts;
      if (bag.polys && bag.polys.length < 1400) bag.polys.push(piece);
      else bag.solid = true;
    };
    if (pattern === "rect") {
      const pitchX = tile.w + (tile.gap || 0);
      const pitchY = tile.h + (tile.gap || 0);
      const i0 = Math.floor((box.x - tile.w) / pitchX) - 1;
      const i1 = Math.ceil((box.x + box.w) / pitchX) + 1;
      const j0 = Math.floor((box.y - tile.h) / pitchY) - 1;
      const j1 = Math.ceil((box.y + box.h) / pitchY) + 1;
      if ((i1 - i0) * (j1 - j0) > 24000) {
        bag.overflow = true;
        return;
      }
      for (let i = i0; i < i1; i += 1) {
        for (let j = j0; j < j1; j += 1) {
          const shiftStep = Math.abs(j) % (Math.max(1, Math.round(tile.bondRows || 1)) + 1);
          const rowShift = tile.w * plannerClamp(tile.bond || 0, 0, 1) * shiftStep;
          const x = i * pitchX + rowShift;
          const y = j * pitchY;
          emit(
            [{ x, y }, { x: x + tile.w, y }, { x: x + tile.w, y: y + tile.h }, { x, y: y + tile.h }],
            (p) => {
              const q = frame.toPattern(p.x, p.y);
              return { x: q.x - x, y: q.y - y };
            },
          );
        }
      }
      return;
    }
    if (pattern === "chevron") {
      const L = tile.w * Math.SQRT1_2;
      const T = tile.h * Math.SQRT2;
      const i0 = Math.floor(box.x / (2 * L)) - 2;
      const i1 = Math.ceil((box.x + box.w) / (2 * L)) + 2;
      const j0 = Math.floor((box.y - L) / T) - 2;
      const j1 = Math.ceil((box.y + box.h) / T) + 2;
      if ((i1 - i0) * (j1 - j0) > 8000) {
        bag.overflow = true;
        return;
      }
      for (let i = i0; i < i1; i += 1) {
        for (let j = j0; j < j1; j += 1) {
          const ox = i * 2 * L;
          const oy = j * T;
          [0, 1].forEach((side) => {
            const pts = tileChevron(tile, side, ox, oy);
            emit(pts, (p) => {
              const q = frame.toPattern(p.x, p.y);
              return tileChevronLocal(tile, side, q.x - ox, q.y - oy);
            });
          });
        }
      }
      return;
    }
    if (pattern === "parquet") {
      const lay = tileParquetLayout(tile);
      const { vx, vy, boards } = lay;
      const det = vx.x * vy.y - vx.y * vy.x || 1;
      const at = (x, y) => ({ i: (x * vy.y - y * vy.x) / det, j: (y * vx.x - x * vx.y) / det });
      const corners = [at(box.x, box.y), at(box.x + box.w, box.y), at(box.x, box.y + box.h), at(box.x + box.w, box.y + box.h)];
      const i0 = Math.floor(Math.min(...corners.map((p) => p.i))) - 1;
      const i1 = Math.ceil(Math.max(...corners.map((p) => p.i))) + 1;
      const j0 = Math.floor(Math.min(...corners.map((p) => p.j))) - 1;
      const j1 = Math.ceil(Math.max(...corners.map((p) => p.j))) + 1;
      if ((i1 - i0) * (j1 - j0) * boards.length > 12000) {
        bag.overflow = true;
        return;
      }
      const unrot = (x, y) => ({ x: (x + y) * Math.SQRT1_2, y: (-x + y) * Math.SQRT1_2 });
      for (let i = i0; i < i1; i += 1) {
        for (let j = j0; j < j1; j += 1) {
          const ox = i * vx.x + j * vy.x;
          const oy = i * vx.y + j * vy.y;
          boards.forEach((board) => {
            const pts = board.pts.map((p) => ({ x: p.x + ox, y: p.y + oy }));
            emit(pts, (p) => {
              const q = frame.toPattern(p.x, p.y);
              const u = unrot(q.x - ox, q.y - oy);
              const lx = u.x - board.x;
              const ly = u.y - board.y;
              return board.alongY ? { x: ly, y: lx } : { x: lx, y: ly };
            });
          });
        }
      }
      return;
    }
    if (pattern === "herringbone" || pattern === "quad") {
      const group = pattern === "quad" ? tileQuadCells(tile) : tileHerringCells(tile);
      const i0 = Math.floor(box.x / group.groupW) - 1;
      const i1 = Math.ceil((box.x + box.w) / group.groupW) + 1;
      const j0 = Math.floor(box.y / group.groupH) - 1;
      const j1 = Math.ceil((box.y + box.h) / group.groupH) + 1;
      if ((i1 - i0) * (j1 - j0) * group.cells.length > 12000) {
        bag.overflow = true;
        return;
      }
      for (let i = i0; i < i1; i += 1) {
        for (let j = j0; j < j1; j += 1) {
          group.cells.forEach((cell) => {
            const ox = i * group.groupW + cell.x;
            const oy = j * group.groupH + cell.y;
            const pts = tileShape(tile, "rect", 0, 0).map((p) => ({ x: ox + (cell.swap ? (p.y / tile.h) * cell.w : (p.x / tile.w) * cell.w), y: oy + (cell.swap ? (p.x / tile.w) * cell.h : (p.y / tile.h) * cell.h) }));
            emit(pts, (p) => {
              const q = frame.toPattern(p.x, p.y);
              return cell.swap ? { x: q.y - oy, y: q.x - ox } : { x: q.x - ox, y: q.y - oy };
            });
          });
        }
      }
      return;
    }
    const stepX = pattern === "honeycomb" ? tile.w * 0.75 : tile.w;
    const stepY = tile.h;
    const i0 = Math.floor(box.x / stepX) - 2;
    const i1 = Math.ceil((box.x + box.w) / stepX) + 2;
    const j0 = Math.floor(box.y / stepY) - 2;
    const j1 = Math.ceil((box.y + box.h) / stepY) + 2;
    if ((i1 - i0) * (j1 - j0) > 12000) {
      bag.overflow = true;
      return;
    }
    for (let i = i0; i < i1; i += 1) {
      for (let j = j0; j < j1; j += 1) {
        const ox = i * stepX;
        const oy = j * stepY + (pattern === "honeycomb" && i % 2 ? tile.h / 2 : 0);
        const pts = tileShape(tile, pattern, ox, oy);
        emit(pts, (p) => {
          const q = frame.toPattern(p.x, p.y);
          return { x: q.x - ox, y: q.y - oy };
        });
      }
    }
  }

  function tileGeom(plan, surface, wall, lay) {
    const holes = [];
    if (lay.openings) {
      (plan.openings || []).forEach((hole) => {
        // Круглые отверстия (трубы и проходки) не вырезают плитку в этом расчёте.
        if (hole.shape === "circle") return;
        if (hole.surface !== surface) return;
        if (surface === "wall" && hole.wallId !== wall?.id) return;
        if (hole.shape === "circle") {
          const r = hole.d / 2;
          holes.push(surface === "wall"
            ? { x: hole.along - r, y: hole.rise - r, w: hole.d, h: hole.d }
            : { x: hole.x - r, y: hole.y - r, w: hole.d, h: hole.d });
        } else if (surface === "wall") holes.push({ x: hole.along, y: hole.rise, w: hole.w, h: hole.h });
        else holes.push({ x: hole.x, y: hole.y, w: hole.w, h: hole.h });
      });
    }
    if (surface === "wall") {
      const x0 = lay.left;
      const y0 = lay.bottom;
      const x1 = wall.len - lay.right;
      const y1 = plan.height - lay.top;
      if (x1 - x0 < 0.01 || y1 - y0 < 0.01) return null;
      return {
        poly: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
        holes,
        anchor: { x: x0, y: y0 },
        span: { w: x1 - x0, h: y1 - y0 },
        rect: true,
      };
    }
    const pts = (plan.points || []).map((p) => ({ x: p.x, y: p.y }));
    if (pts.length < 3) return null;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs) + lay.left;
    const maxX = Math.max(...xs) - lay.right;
    const minY = Math.min(...ys) + lay.bottom;
    const maxY = Math.max(...ys) - lay.top;
    if (maxX - minX < 0.01 || maxY - minY < 0.01) return null;
    const box = [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }];
    const poly = clipToConvex(pts, box);
    if (polyArea(poly) < 1e-4) return null;
    return { poly, holes, anchor: { x: minX, y: minY }, span: { w: maxX - minX, h: maxY - minY }, rect: polyIsRect(poly) };
  }

  function tileBag(tile, lay, geom, draw) {
    const bag = { pieces: [], polys: draw ? [] : null, solid: false, overflow: false };
    if (!geom) return bag;
    const frame = tileFrame(geom, lay.dir, lay.shiftX, lay.shiftY, lay.turn);
    const axis = ((Math.round(lay.turn || 0) % 90) + 90) % 90 === 0;
    if (tile.pattern === "rect" && geom.rect && axis) {
      const region = tileBBox(geom.poly.map((p) => frame.toPattern(p.x, p.y)));
      const holes = geom.holes.map((hole) => tileRectToPattern(frame, hole));
      tileRectRun(tile, frame, region, holes, bag);
    } else tilePatternRun(tile, frame, geom.poly, geom.holes, bag);
    if (bag.overflow) {
      let area = polyArea(geom.poly);
      geom.holes.forEach((hole) => { area -= hole.w * hole.h; });
      const one = tile.w * tile.h;
      bag.pieces = [{ w: tile.w, h: tile.h, full: true }];
      bag.rough = one > 0 ? Math.max(0, Math.ceil(Math.max(0, area) / one)) : 0;
    }
    return bag;
  }

  function tileLayDefaults(node, surface) {
    return {
      tileId: "",
      left: 0,
      right: 0,
      bottom: 0,
      top: 0,
      shiftX: 0,
      shiftY: 0,
      dir: 0,
      turn: 0,
      tolW: 0.02,
      tolH: 0.02,
      openings: true,
    };
  }

  function ensureTiles(node) {
    delete node.tones;
    delete node.color;
    if (!Array.isArray(node.tiles)) node.tiles = [];
    const tiles = [];
    node.tiles.forEach((raw) => {
      if (!raw || typeof raw !== "object" || tiles.length >= 16) return;
      let id = String(raw.id || "").trim();
      if (!id || tiles.some((item) => item.id === id)) id = uid();
      const pattern = TILE_PATTERNS.some((item) => item[0] === raw.pattern) ? raw.pattern : "rect";
      tiles.push({
        id,
        name: String(raw.name || "").trim().slice(0, 48) || `Плитка ${tiles.length + 1}`,
        pattern,
        w: plannerRound(plannerClamp(plannerNum(raw.w, 0.6), 0.02, 3)),
        h: plannerRound(plannerClamp(plannerNum(raw.h, 0.6), 0.02, 3)),
        color: markHex(raw.color, "#d6c4a8"),
        gap: plannerRound(plannerClamp(raw.gap == null ? 0.001 : plannerNum(raw.gap, 0.001), 0, 0.03)),
        bond: plannerRound(plannerClamp(plannerNum(raw.bond, 0), 0, 1)),
        bondRows: Math.round(plannerClamp(plannerNum(raw.bondRows, 1), 1, 30)),
        noPairs: raw.noPairs === true,
        grout: markHex(raw.grout, "#a8a29e"),
      });
    });
    node.tiles = tiles;
    const known = new Set(tiles.map((item) => item.id));
    if (!Array.isArray(node.lays)) node.lays = [];
    const lays = [];
    node.lays.forEach((raw) => {
      if (!raw || typeof raw !== "object" || lays.length >= 160) return;
      const surface = raw.surface === "floor" || raw.surface === "ceiling" ? raw.surface : "wall";
      let tileId = String(raw.tileId || "");
      if (tileId && !known.has(tileId)) tileId = "";
      const dir = [0, 90, 180, 270].includes(Number(raw.dir)) ? Number(raw.dir) : 0;
      lays.push({
        feed: String(raw.feed || ""),
        surface,
        wallId: surface === "wall" ? String(raw.wallId || "") : "",
        tileId,
        left: plannerRound(plannerClamp(plannerNum(raw.left, 0), 0, 5)),
        right: plannerRound(plannerClamp(plannerNum(raw.right, 0), 0, 5)),
        bottom: plannerRound(plannerClamp(plannerNum(raw.bottom, 0), 0, 5)),
        top: plannerRound(plannerClamp(plannerNum(raw.top, 0), 0, 5)),
        shiftX: plannerRound(plannerClamp(plannerNum(raw.shiftX, 0), -5, 5)),
        shiftY: plannerRound(plannerClamp(plannerNum(raw.shiftY, 0), -5, 5)),
        dir,
        turn: plannerRound(((plannerNum(raw.turn, 0) % 360) + 360) % 360),
        tolW: plannerRound(plannerClamp(plannerNum(raw.tolW, 0.02), 0, 0.3)),
        tolH: plannerRound(plannerClamp(plannerNum(raw.tolH, 0.02), 0, 0.3)),
        openings: raw.openings !== false,
      });
    });
    node.lays = lays;
    ensureFeeds(node);
    const feedIds = new Set(node.feeds.map((feed) => feed.id));
    const firstFeed = node.feeds[0].id;
    node.lays.forEach((lay) => {
      if (!feedIds.has(lay.feed)) lay.feed = firstFeed;
    });
    if (!node.outOn || typeof node.outOn !== "object" || Array.isArray(node.outOn)) node.outOn = {};
    node.name = String(node.name || "").trim().slice(0, 48) || "Плитка";
    return node;
  }

  function tileLayRead(node, feedId, surface, wallId) {
    const kind = surface === "floor" || surface === "ceiling" ? surface : "wall";
    const wall = kind === "wall" ? String(wallId || "") : "";
    const found = (node.lays || []).find((lay) => lay.feed === feedId && lay.surface === kind && lay.wallId === wall);
    const base = tileLayDefaults(node, kind);
    return found ? { ...base, ...found, feed: feedId, surface: kind, wallId: wall } : { ...base, feed: feedId, surface: kind, wallId: wall };
  }

  function tileLayWrite(node, feedId, surface, wallId, patch) {
    ensureTiles(node);
    const kind = surface === "floor" || surface === "ceiling" ? surface : "wall";
    const wall = kind === "wall" ? String(wallId || "") : "";
    let lay = node.lays.find((item) => item.feed === feedId && item.surface === kind && item.wallId === wall);
    if (!lay) {
      lay = { ...tileLayDefaults(node, kind), feed: feedId, surface: kind, wallId: wall };
      node.lays.push(lay);
    }
    Object.assign(lay, patch);
    return lay;
  }

  function tileFaces(plan) {
    const faces = [{ surface: "floor", wall: null, name: "Пол" }, { surface: "ceiling", wall: null, name: "Потолок" }];
    plannerWalls(plan).forEach((wall, index) => {
      faces.push({ surface: "wall", wall, name: planWallName(plan, wall, index) });
    });
    return faces;
  }

  function tileFaceCount(node, plan, feed, face) {
    const lay = tileLayRead(node, feed.id, face.surface, face.wall?.id || "");
    const tile = node.tiles.find((item) => item.id === lay.tileId);
    if (!tile) return { count: 0, tile: null, lay, bag: null };
    const geom = tileGeom(plan, face.surface, face.wall, lay);
    const bag = tileBag(tile, lay, geom, false);
    const packed = bag.rough != null ? { count: bag.rough, cuts: 0 } : tilePack(bag.pieces, tile.w, tile.h, lay.tolW, lay.tolH, !tile.noPairs);
    return { count: packed.count, cuts: packed.cuts, tile, lay, bag };
  }

  function tilePreview(node, plan, feed, face) {
    const lay = tileLayRead(node, feed.id, face.surface, face.wall?.id || "");
    const tile = node.tiles.find((item) => item.id === lay.tileId);
    if (!tile) return null;
    const geom = tileGeom(plan, face.surface, face.wall, lay);
    const bag = tileBag(tile, lay, geom, true);
    const packed = bag.rough != null ? { count: bag.rough, cuts: 0 } : tilePack(bag.pieces, tile.w, tile.h, lay.tolW, lay.tolH, !tile.noPairs);
    if (bag.polys) {
      const paired = new Map();
      bag.pieces.forEach((part) => {
        if (part.parentId && part.pair && !paired.has(part.parentId)) paired.set(part.parentId, part.pair);
      });
      bag.polys.forEach((piece) => { piece.pair = paired.get(piece.id) || ""; });
    }
    return { tile, lay, geom, bag, count: packed.count, cuts: packed.cuts };
  }

  function tileInputs(node) {
    ensureTiles(node);
    return node.feeds.map((feed) => ({ id: feedPort(feed), name: "Чертёж", signal: "plan", feed: feed.id }));
  }

  function tileFeedPorts(node, bp, values, links, feed, all) {
    const host = bp || blueprintOf(node);
    const plan = host ? upstreamPlan(node, host, [], values || {}, feedPort(feed)) : null;
    if (!plan) return [];
    const linked = linkedFromPorts(node.id, links || host?.links || []);
    const ports = [];
    const byTile = new Map();
    tileFaces(plan).forEach((face) => {
      const row = tileFaceCount(node, plan, feed, face);
      const key = face.surface === "wall" ? face.wall.id : face.surface;
      const id = feedKey(feed, "surf", key);
      if (all || markShown(node, id, linked, row.count > 0)) {
        ports.push({
          id,
          name: row.tile ? `${face.name} · ${row.tile.name}` : face.name,
          value: row.count,
          unit: "шт",
          feed: feed.id,
        });
      }
      if (!row.tile) return;
      if (!byTile.has(row.tile.id)) byTile.set(row.tile.id, { name: row.tile.name, value: 0, cuts: 0 });
      const acc = byTile.get(row.tile.id);
      acc.value += row.count;
      acc.cuts += row.cuts || 0;
    });
    byTile.forEach((row, tileId) => {
      const id = feedKey(feed, "tile", tileId);
      if (all || markShown(node, id, linked, row.value > 0)) {
        ports.push({ id, name: row.name, value: row.value, unit: "шт", feed: feed.id });
      }
      const cutId = feedKey(feed, "cut", tileId);
      if (all || markShown(node, cutId, linked, row.cuts > 0)) {
        ports.push({ id: cutId, name: `${row.name} · резка`, value: row.cuts, unit: "шт", feed: feed.id });
      }
    });
    return ports;
  }

  function tileOutputs(node, bp, values, links) {
    ensureTiles(node);
    const host = bp || blueprintOf(node);
    const ports = [];
    const catalog = [];
    node.feeds.forEach((feed) => {
      if (!upstreamPlan(node, host, [], values || {}, feedPort(feed))) return;
      ports.push(...tileFeedPorts(node, host, values, links, feed, false));
      catalog.push(...tileFeedPorts(node, host, values, links, feed, true));
    });
    appendCommons(node, ports, linkedFromPorts(node.id, links || host?.links || []), catalog);
    return ports;
  }

  function tileFaceOf(plan, surface) {
    if (!plan) return null;
    if (surface === "floor" || surface === "ceiling") return tileFaces(plan).find((face) => face.surface === surface) || null;
    const walls = plannerWalls(plan);
    const wall = walls.find((item) => item.id === surface);
    if (!wall) return null;
    return { surface: "wall", wall, name: planWallName(plan, wall, Math.max(0, walls.indexOf(wall))) };
  }

  function markCardHtml(node, bp, graph) {
    const electrics = node.type === "electrics";
    const tiles = node.type === "tiles";
    if (electrics) ensureElectrics(node);
    else if (tiles) ensureTiles(node);
    else ensureOpenings(node);
    const outputs = electrics ? electricOutputs(node, bp, graph.values, bp.links) : tiles ? tileOutputs(node, bp, graph.values, bp.links) : openingOutputs(node, bp, graph.values, bp.links);
    const inputs = electrics ? electricInputs(node) : tiles ? tileInputs(node) : openingInputs(node);
    const ready = node.feeds.filter((feed) => upstreamPlan(node, bp, [], graph.values, feedPort(feed)));
    const first = ready[0] ? upstreamPlan(node, bp, [], graph.values, feedPort(ready[0])) : null;
    const tones = markTones(node, first?.color);
    let sub = "нет чертежа";
    if (ready.length > 1) sub = ruPlans(ready.length);
    else if (first && electrics) {
      const mine = node.fixtures.filter((item) => item.feed === ready[0].id && item.kind !== "light");
      const sockets = mine.reduce((sum, item) => sum + (item.cells || []).length, 0);
      sub = `${sockets} шт. · ${mine.length} рамок`;
    } else if (first && tiles) {
      const qty = tileFaces(first).reduce((sum, face) => sum + tileFaceCount(node, first, ready[0], face).count, 0);
      sub = `${qty} шт.`;
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
        ? `${caption}<div class="calc-film calc-film-top" data-mark-feed="${esc(feed.id)}">${filmStrip(plan, node.id, "", electrics || tiles ? (plan.openings || []) : (emitPlan(node, bp, [], graph.values, feedPort(feed))?.openings || []), electrics ? node.fixtures.filter((fix) => fix.feed === feed.id) : [], feedTones)}</div>`
        : "";
      const binds = electrics || tiles ? "" : inputs.filter((port) => {
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
    const title = tiles ? "Имя плитки" : electrics ? "Имя электрики" : "Имя проёмов";
    const edit = tiles ? "Плитка на чертеже" : electrics ? "Розетки и свет" : "Проёмы на чертеже";
    const filmsTitle = node.filmsOff ? "Показать ленты" : "Скрыть ленты";
    const kindClass = tiles ? "is-tiles" : electrics ? "is-electrics" : "is-openings";
    return `<article class="calc-node ${kindClass} ${node.filmsOff ? "is-films-off" : ""} ${nodeSelected(node.id) ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px;--planner-color:${esc(tones.floor)};--mark-floor:${esc(tones.floor)};--mark-ceiling:${esc(tones.ceiling)};--mark-wall:${esc(tones.wall)}">
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

  function tilesNodeHtml(node, bp, graph) {
    return markCardHtml(node, bp, graph);
  }

  function electricsNodeHtml(node, bp, graph) {
    return markCardHtml(node, bp, graph);
  }

  function markNode() {
    const id = session.mark?.id;
    if (!id) return null;
    const node = (activeBlueprint()?.nodes || []).find((item) => item.id === id && (item.type === "openings" || item.type === "electrics" || item.type === "tiles")) || null;
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
    else if (node.type === "tiles") ensureTiles(node);
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
    const node = bp?.nodes.find((item) => item.id === nodeId && (item.type === "openings" || item.type === "electrics" || item.type === "tiles"));
    if (!node) return;
    if (session.planner?.id) closePlanner();
    ensureMarkModal();
    if (node.type === "openings") ensureOpenings(node);
    else if (node.type === "tiles") ensureTiles(node);
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
    if (node) node.name = node.type === "electrics" ? ensureElectrics(node).name : node.type === "tiles" ? ensureTiles(node).name : ensureOpenings(node).name;
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
    const edge = $("mark-edge");
    if (edge) edge.hidden = true;
    if (session.mark) session.mark.menu = null;
  }

  function pruneMarkLinks(node) {
    const bp = activeBlueprint();
    if (!bp || !node) return;
    const graph = computeGraph(bp);
    const ports = node.type === "openings" ? openingOutputs(node, bp, graph.values, bp.links) : node.type === "tiles" ? tileOutputs(node, bp, graph.values, bp.links) : electricOutputs(node, bp, graph.values, bp.links);
    const ids = new Set(ports.map((port) => port.id));
    bp.links = (bp.links || []).filter((link) => link.from !== node.id || ids.has(link.fromPort));
    const inputs = new Set((node.type === "openings" ? openingInputs(node) : node.type === "tiles" ? tileInputs(node) : electricInputs(node)).map((port) => port.id));
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
    } else if (node.type === "tiles") ensureTiles(node);
    else ensureElectrics(node);
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
    if (node.type === "tiles") tileSyncOuts(node);
  }

  function tileSyncOuts(node) {
    const side = $("mark-side");
    const ctx = markContext();
    const feed = ctx?.feed || node.feeds?.[0];
    const base = ctx?.base;
    if (!side || !feed || !base) return;
    const setCount = (id, text) => {
      const box = side.querySelector(`[data-mark-out="${CSS.escape(id)}"]`);
      const em = box?.closest("label")?.querySelector("em");
      if (em) em.textContent = text;
    };
    const totals = new Map();
    tileFaces(base).forEach((item) => {
      const row = tileFaceCount(node, base, feed, item);
      const key = item.surface === "wall" ? item.wall.id : item.surface;
      setCount(feedKey(feed, "surf", key), `${row.count} шт.`);
      if (!row.tile) return;
      const bag = totals.get(row.tile.id) || { buy: 0, cuts: 0 };
      bag.buy += row.count;
      bag.cuts += row.cuts || 0;
      totals.set(row.tile.id, bag);
    });
    node.tiles.forEach((tile) => {
      const bag = totals.get(tile.id) || { buy: 0, cuts: 0 };
      setCount(feedKey(feed, "tile", tile.id), `${bag.buy} шт.`);
      setCount(feedKey(feed, "cut", tile.id), `${bag.cuts} шт.`);
    });
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

  function tileField(label, field, value) {
    return `<label class="planner-len"><span>${label}</span><span class="tile-val"><input data-tile-field="${field}" inputmode="decimal" value="${esc(tileCm(value))}" /> см</span></label>`;
  }

  function tileFitRatio(tile) {
    if (!tile) return;
    const fit = (n) => plannerRound(plannerClamp(n, 0.02, 3));
    if (tile.pattern === "quad") tile.h = fit(tile.w * 2);
    else if (tile.pattern === "honeycomb") tile.h = fit(tile.w * Math.sqrt(3) / 2);
  }

  function tileSideHtml(ctx) {
    const { node, bp, base } = ctx;
    const feed = ctx.feed || node.feeds[0];
    const surface = session.mark?.surface || "floor";
    const face = tileFaceOf(base, surface);
    if (!feed || !face) return `<div class="planner-block"><div class="planner-block-h">Плитка</div><p class="planner-lead">На этой поверхности считать нечего.</p></div>`;
    const lay = tileLayRead(node, feed.id, face.surface, face.wall?.id || "");
    const here = tileFaceCount(node, base, feed, face);
    const hasHoles = (base.openings || []).some((hole) => hole.surface === face.surface && (face.surface !== "wall" || hole.wallId === face.wall?.id));
    const types = node.tiles.map((tile) => {
      const one = tile.pattern === "honeycomb";
      const size = one
        ? `<label class="planner-len">Размер <input data-tile-w="${esc(tile.id)}" inputmode="decimal" value="${esc(tileCm(tile.w))}" /> см</label>`
        : `<label class="planner-len">Ширина <input data-tile-w="${esc(tile.id)}" inputmode="decimal" value="${esc(tileCm(tile.w))}" /> см</label>
        <label class="planner-len">Высота <input data-tile-h="${esc(tile.id)}" inputmode="decimal" value="${esc(tileCm(tile.h))}" /> см</label>`;
      const bond = tile.pattern === "rect"
        ? `<label class="planner-len">Сдвиг <input data-tile-bond="${esc(tile.id)}" inputmode="decimal" value="${esc(plannerInput((tile.bond || 0) * tile.w * 100))}" /> см</label>
          <label class="planner-len">Сдвигаемых рядов <input data-tile-bond-rows="${esc(tile.id)}" type="number" min="1" max="30" step="1" value="${esc(tile.bondRows || 1)}" /></label>`
        : "";
      return `<div class="planner-metric is-tile">
      <button type="button" class="calc-mini" data-tile-del="${esc(tile.id)}" title="Удалить">×</button>
      <input class="planner-name" data-tile-name="${esc(tile.id)}" value="${esc(tile.name)}" maxlength="48" aria-label="Имя плитки" />
      ${markSelect(`data-tile-pattern="${esc(tile.id)}"`, "", TILE_PATTERNS.map(([value, label]) => ({ value, label })), tile.pattern)}
      <div class="tile-row">${size}</div>
      ${bond ? `<div class="tile-row">${bond}</div>` : ""}
      <div class="tile-row">
        <label class="planner-len">Шов <input data-tile-gap="${esc(tile.id)}" inputmode="decimal" value="${esc(plannerInput((tile.gap || 0) * 1000))}" /> мм</label>
      </div>
      <label class="planner-on"><input type="checkbox" data-tile-no-pairs="${esc(tile.id)}" ${tile.noPairs ? "checked" : ""} /> Не объединять обрезки в пары</label>
      <div class="tile-row">
        <label class="planner-len">Цвет <input data-tile-color="${esc(tile.id)}" type="color" value="${esc(tile.color)}" aria-label="Цвет плитки" /></label>
        <label class="planner-len">Затирка <input data-tile-grout="${esc(tile.id)}" type="color" value="${esc(tile.grout || "#a8a29e")}" aria-label="Цвет затирки" /></label>
      </div>
    </div>`;
    }).join("");
    const useOpts = [{ value: "", label: "Не класть" }].concat(node.tiles.map((tile) => ({ value: tile.id, label: tile.name })));
    const rows = tileFaces(base).map((item) => {
      const row = tileFaceCount(node, base, feed, item);
      const key = item.surface === "wall" ? item.wall.id : item.surface;
      const id = feedKey(feed, "surf", key);
      const linked = linkedFromPorts(node.id, bp.links).has(id);
      return `<label class="planner-part"><input type="checkbox" data-mark-out="${esc(id)}" ${markChecked(node, id, false) || linked ? "checked" : ""} ${linked ? "disabled" : ""} /> <span>${esc(row.tile ? `${item.name} · ${row.tile.name}` : item.name)}</span> <em>${row.count} шт.</em></label>`;
    }).join("");
    const sums = node.tiles.map((tile) => {
      const totals = tileFaces(base).reduce((sum, item) => {
        const row = tileFaceCount(node, base, feed, item);
        if (row.tile?.id !== tile.id) return sum;
        return { buy: sum.buy + row.count, cuts: sum.cuts + (row.cuts || 0) };
      }, { buy: 0, cuts: 0 });
      const id = feedKey(feed, "tile", tile.id);
      const cutId = feedKey(feed, "cut", tile.id);
      const linked = linkedFromPorts(node.id, bp.links).has(id);
      const cutLinked = linkedFromPorts(node.id, bp.links).has(cutId);
      return `<label class="planner-part"><input type="checkbox" data-mark-out="${esc(id)}" ${markChecked(node, id, false) || linked ? "checked" : ""} ${linked ? "disabled" : ""} /> <span>${esc(tile.name)}</span> <em>${totals.buy} шт.</em></label>
        <label class="planner-part"><input type="checkbox" data-mark-out="${esc(cutId)}" ${markChecked(node, cutId, false) || cutLinked ? "checked" : ""} ${cutLinked ? "disabled" : ""} /> <span>${esc(tile.name)} · резка</span> <em>${totals.cuts} шт.</em></label>`;
    }).join("");
    const dimMode = tilePreviewDimMode();
    const previewPanel = `<div id="mark-tile-tip" class="tile-preview-panel" hidden>
      <div class="tile-preview-head"><strong>Предпросмотр плитки</strong><div class="tile-preview-modes">${TILE_PREVIEW_DIMS.map(([id, label]) => `<button type="button" class="btn ${dimMode === id ? "is-active" : ""}" data-tile-dim-mode="${id}" aria-pressed="${dimMode === id ? "true" : "false"}">${label}</button>`).join("")}</div></div>
      <svg viewBox="0 0 200 160" aria-hidden="true"></svg><div class="tile-preview-legend" data-tile-preview-legend hidden></div><p></p>
    </div>`;
    let tileSectionOpen = true;
    try { tileSectionOpen = window.localStorage.getItem("finmaster.tilePreview.sectionOpen") !== "false"; } catch { /* storage may be unavailable */ }
    return `${previewPanel}
    <details class="planner-block tile-types-block tile-section-collapse" ${tileSectionOpen ? "open" : ""}>
      <summary class="planner-block-h"><span>Плитки</span><button type="button" class="planner-help" aria-label="Пояснение к разделу" title="Здесь настраиваются типы плитки: размеры, сдвиг рядов и ширина шва. Раздел можно свернуть целиком.">i</button></summary>
      <div class="tile-section-content">
        <div class="tile-section-actions"><button type="button" class="btn" data-tile-add>+ Плитка</button></div>
        ${types || `<div class="calc-empty">Добавьте тип плитки</div>`}
      </div>
    </details>
    <div class="planner-block"><div class="planner-block-h">${esc(face.name)}</div>
      <div class="tile-face">
      <label class="planner-len"><span>Плитка на этой поверхности</span>${markSelect('data-tile-use="1"', "", useOpts, lay.tileId || "")}</label>
      <label class="planner-len"><span>Откуда начинается ряд</span>${markSelect('data-tile-dir="1"', "", TILE_DIRS.map(([value, label]) => ({ value: String(value), label })), String(lay.dir || 0))}</label>
      <label class="planner-len"><span>Поворот кладки</span><span class="tile-val"><input data-tile-turn inputmode="decimal" value="${esc(plannerInput(lay.turn || 0))}" /> °</span></label>
      <hr class="tile-rule">
      ${tileField("Отступ сверху", "top", lay.top)}
      ${tileField("Отступ снизу", "bottom", lay.bottom)}
      ${tileField("Отступ слева", "left", lay.left)}
      ${tileField("Отступ справа", "right", lay.right)}
      <hr class="tile-rule">
      ${tileField("Сдвиг вбок", "shiftX", lay.shiftX)}
      ${tileField("Сдвиг вверх", "shiftY", lay.shiftY)}
      <hr class="tile-rule">
      ${tileField("Запас по ширине", "tolW", lay.tolW)}
      ${tileField("Запас по высоте", "tolH", lay.tolH)}
      ${hasHoles ? `<label class="planner-on"><input type="checkbox" data-tile-open="1" ${lay.openings ? "checked" : ""} /> Вырезать проёмы из плитки</label>` : ""}
      <p class="planner-lead" data-tile-need>Купить: ${here.count} шт. Разрезать: ${here.cuts || 0} шт.</p>
      </div>
    </div>
    <div class="planner-block"><div class="planner-block-h">На ноду</div>
      <p class="planner-lead">Строка стены, пола или потолка — сколько купить на эту поверхность. Строка плитки складывает такие поверхности. «Резка» — сколько из них придётся резать. Её не прибавляют к покупке.</p>
      <div class="planner-parts">${rows}${sums}</div>
    </div>`;
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
      const title = node.type === "electrics" ? "Электрика" : node.type === "tiles" ? "Плитка" : "Проёмы";
      return `<div class="planner-block"><div class="planner-block-h">${title}</div><p class="planner-lead">Соедините вход «Чертёж» с выходом «Чертёж» планировщика${node.type === "openings" ? "" : " или проёмов"}.</p></div>`;
    }
    if (node.type === "tiles") return tileSideHtml(ctx);
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

  function markSideHelpify(side) {
    if (!side) return;
    const groups = new Map();
    side.querySelectorAll('.planner-lead').forEach((lead) => {
      if (lead.hasAttribute("data-tile-need")) return;
      const block = lead.closest('.planner-block');
      if (!block) return;
      let head = block.querySelector(':scope > .planner-block-h');
      if (!head) { head = document.createElement('div'); head.className = 'planner-block-h'; head.textContent = 'Пояснение'; block.insertBefore(head, block.firstChild); }
      const value = String(lead.textContent || '').trim();
      if (value) { if (!groups.has(head)) groups.set(head, []); groups.get(head).push(value); }
      lead.remove();
    });
    groups.forEach((texts, head) => {
      let wrap = head.querySelector(':scope > .planner-block-title-wrap');
      if (!wrap) {
        wrap = document.createElement('span'); wrap.className = 'planner-block-title-wrap';
        const node = [...head.childNodes].find((item) => item.nodeType === Node.TEXT_NODE && String(item.textContent || '').trim());
        if (node) { const title = document.createElement('span'); title.className = 'planner-block-title'; title.textContent = node.textContent.trim(); head.replaceChild(title, node); wrap.appendChild(title); }
        else { const title = [...head.children].find((item) => !item.matches('button,.planner-help')); if (title) wrap.appendChild(title); }
        head.insertBefore(wrap, head.firstChild);
      }
      let button = wrap.querySelector(':scope > .planner-help');
      if (!button) { button = document.createElement('button'); button.type = 'button'; button.className = 'planner-help'; button.textContent = 'i'; button.setAttribute('aria-label', 'Пояснение к разделу'); wrap.appendChild(button); }
      button.title = [...new Set(texts)].join(String.fromCharCode(10));
      button.removeAttribute('data-help');
    });
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
      markSideHelpify(side);
      if (title && document.activeElement !== title) title.value = ctx.node.name || "";
      return;
    }
    const stage = $("mark-common");
    if (stage) stage.hidden = true;
    const scroll = side.scrollTop;
    side.innerHTML = markSideHtml(ctx);
    markSideHelpify(side);
    const tileSection = side.querySelector(".tile-section-collapse");
    tileSection?.addEventListener("toggle", () => {
      try { window.localStorage.setItem("finmaster.tilePreview.sectionOpen", String(tileSection.open)); } catch { /* storage may be unavailable */ }
    });
    side.scrollTop = scroll;
    if (title && document.activeElement !== title) title.value = ctx.node.name || "";
    const surface = session.mark?.surface || "floor";
    const walls = ctx.base ? plannerWalls(ctx.base) : [];
    const wallIndex = walls.findIndex((wall) => wall.id === surface);
    if (cap) {
      cap.textContent = surface === "ceiling" ? "Потолок" : surface === "floor" ? "Пол" : wallIndex >= 0 ? planWallName(ctx.base, walls[wallIndex], wallIndex) : "План";
    }
    const dims = $("mark-modal")?.querySelector("[data-mark-dims]");
    if (dims) {
      dims.hidden = ctx.node.type !== "tiles";
      dims.classList.toggle("is-on", !!session.mark?.dims);
      dims.setAttribute("aria-pressed", session.mark?.dims ? "true" : "false");
    }
    if (hint) {
      hint.textContent = ctx.node.type === "tiles"
        ? "Наведите на плитку — размеры. Клик выделяет пару обрезков. Кнопка линейки показывает размеры стены и пола."
        : ctx.node.type === "electrics"
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

  function tileDimText(meters) {
    const cm = Math.round(Math.abs(meters) * 100);
    if (cm >= 100) return `${plannerInput(meters)} м`;
    return `${cm} см`;
  }

  function tileTipText(meters) {
    const cm = Math.round(Math.abs(meters) * 1000) / 10;
    const body = Math.abs(cm - Math.round(cm)) < 0.05 ? String(Math.round(cm)) : cm.toFixed(1).replace(".", ",");
    return `${body}см`;
  }

  function tileDimLine(g, a, b, text) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 32 || !text) return;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    g.save();
    g.strokeStyle = "#9a3412";
    g.fillStyle = "#9a3412";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
    g.font = "12px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    const tw = g.measureText(text).width + 8;
    g.fillStyle = plannerColors().bg;
    g.fillRect(mx - tw / 2, my - 8, tw, 16);
    g.fillStyle = "#9a3412";
    g.fillText(text, mx, my);
    g.restore();
  }

  function tileDimShift(a, b, away, dist) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len;
    let ny = dx / len;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    if ((away.x - mx) * nx + (away.y - my) * ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    return {
      a: { x: a.x + nx * dist, y: a.y + ny * dist },
      b: { x: b.x + nx * dist, y: b.y + ny * dist },
    };
  }

  function tileDrawDims(g, view, ctx) {
    if (!session.mark?.dims || !ctx.base) return;
    const face = tileFaceOf(ctx.base, session.mark.surface || "floor");
    if (!face) return;
    if (view.kind === "wall" && view.wall) {
      const len = view.wall.len;
      const height = view.height;
      const mid = view.toAlong(len / 2, height / 2);
      const bottomA = view.toAlong(0, 0);
      const bottomB = view.toAlong(len, 0);
      const sideA = view.toAlong(0, 0);
      const sideB = view.toAlong(0, height);
      tileDimLine(g, tileDimShift(bottomA, bottomB, mid, 22).a, tileDimShift(bottomA, bottomB, mid, 22).b, tileDimText(len));
      tileDimLine(g, tileDimShift(sideA, sideB, mid, 22).a, tileDimShift(sideA, sideB, mid, 22).b, tileDimText(height));
      const holes = (ctx.base.openings || [])
        .filter((hole) => hole.surface === "wall" && hole.wallId === view.wall.id && hole.shape !== "circle")
        .map((hole) => ({ a: hole.along, b: hole.along + hole.w, rise: hole.rise, h: hole.h }))
        .sort((p, q) => p.a - q.a);
      let cursor = 0;
      const segs = [];
      holes.forEach((hole) => {
        const a = Math.max(0, hole.a);
        const b = Math.min(len, hole.b);
        if (a > cursor + 0.01) segs.push({ a: cursor, b: a, open: false });
        if (b > a + 0.01) segs.push({ a, b, open: true, rise: hole.rise, h: hole.h });
        cursor = Math.max(cursor, b);
      });
      if (len > cursor + 0.01) segs.push({ a: cursor, b: len, open: false });
      segs.forEach((seg) => {
        const p = view.toAlong(seg.a, 0);
        const q = view.toAlong(seg.b, 0);
        const line = tileDimShift(p, q, mid, 8);
        tileDimLine(g, line.a, line.b, tileDimText(seg.b - seg.a));
        if (seg.open) {
          const hp = view.toAlong(seg.a, seg.rise);
          const hq = view.toAlong(seg.a, seg.rise + seg.h);
          const hline = tileDimShift(hp, hq, mid, 8);
          tileDimLine(g, hline.a, hline.b, tileDimText(seg.h));
        }
      });
      return;
    }
    const pts = ctx.base.points || [];
    if (pts.length < 3 || !view.view) return;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const mid = view.view.to({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
    const widthA = view.view.to({ x: minX, y: minY });
    const widthB = view.view.to({ x: maxX, y: minY });
    const heightA = view.view.to({ x: minX, y: minY });
    const heightB = view.view.to({ x: minX, y: maxY });
    tileDimLine(g, tileDimShift(widthA, widthB, mid, 18).a, tileDimShift(widthA, widthB, mid, 18).b, tileDimText(maxX - minX));
    tileDimLine(g, tileDimShift(heightA, heightB, mid, 18).a, tileDimShift(heightA, heightB, mid, 18).b, tileDimText(maxY - minY));
    (ctx.base.openings || []).forEach((hole) => {
      if (hole.surface !== face.surface || hole.shape === "circle") return;
      const p = view.view.to({ x: hole.x, y: hole.y });
      const q = view.view.to({ x: hole.x + hole.w, y: hole.y });
      const r = view.view.to({ x: hole.x, y: hole.y + hole.h });
      const line = tileDimShift(p, q, mid, 8);
      const rise = tileDimShift(p, r, mid, 8);
      tileDimLine(g, line.a, line.b, tileDimText(hole.w));
      tileDimLine(g, rise.a, rise.b, tileDimText(hole.h));
    });
  }

  function polyHit(poly, x, y) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const a = poly[i];
      const b = poly[j];
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / ((b.y - a.y) || 1e-12) + a.x) inside = !inside;
    }
    return inside;
  }

  function tilePieceAt(x, y) {
    const view = session.mark?.view;
    const pieces = session.mark?.tilePieces || [];
    if (!view) return null;
    const world = view.kind === "wall" ? view.from(x, y) : view.view?.from(x, y);
    if (!world) return null;
    const px = world.along != null ? world.along : world.x;
    const py = world.rise != null ? world.rise : world.y;
    for (let i = pieces.length - 1; i >= 0; i -= 1) {
      const fragments = Array.isArray(pieces[i].cuts) && pieces[i].cuts.length ? pieces[i].cuts : [pieces[i].poly];
      if (fragments.some((poly) => poly?.length >= 3 && polyHit(poly, px, py))) return pieces[i];
    }
    return null;
  }

  function tileTone(hex) {
    const raw = String(hex || "").replace("#", "");
    const n = parseInt(raw.length === 3 ? raw.replace(/./g, (ch) => ch + ch) : raw, 16);
    const r = (n >> 16) & 255;
    const gch = (n >> 8) & 255;
    const b = n & 255;
    if (!Number.isFinite(n)) return { base: "#d6c4a8", mid: "#cbb89a" };
    const lin = (c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const lum = 0.2126 * lin(r) + 0.7152 * lin(gch) + 0.0722 * lin(b);
    const lighten = lum < 0.5;
    const mix = (c) => Math.round(Math.min(255, Math.max(0, lighten ? c + (255 - c) * 0.05 : c * 0.95)));
    const byte = (c) => c.toString(16).padStart(2, "0");
    return { base: `#${byte(r)}${byte(gch)}${byte(b)}`, mid: `#${byte(mix(r))}${byte(mix(gch))}${byte(mix(b))}` };
  }

  const TILE_PREVIEW_DIM_KEY = "finmaster.tilePreview.dimMode";
  const TILE_PREVIEW_DIMS = [
    ["tile", "Плитка"],
    ["cuts", "Фрагменты"],
    ["holes", "Отверстия"],
    ["offsets", "Отступы"],
  ];

  function tilePreviewDimMode() {
    try {
      const value = window.localStorage.getItem(TILE_PREVIEW_DIM_KEY);
      return TILE_PREVIEW_DIMS.some(([id]) => id === value) ? value : "tile";
    } catch {
      return "tile";
    }
  }

  function tileTipHide() {
    const tip = $("mark-tile-tip");
    if (tip && !session.mark?.tileSel) tip.hidden = true;
  }

  function tileTipShow(piece, ctx) {
    const tip = $("mark-tile-tip");
    if (!tip) return;
    if (!piece?.poly?.length || !ctx?.base) {
      tip.hidden = true;
      return;
    }
    const fullW = piece.tileW || piece.w;
    const fullH = piece.tileH || piece.h;
    const pattern = piece.pattern || "rect";
    const cell = piece.cell?.length >= 3 ? piece.cell : piece.poly;
    const face = piece.face?.length >= 3 ? piece.face : piece.poly;
    const fragments = Array.isArray(piece.cuts) && piece.cuts.length
      ? piece.cuts.filter((poly) => Array.isArray(poly) && poly.length >= 3)
      : [face];
    const svg = tip.querySelector("svg");
    const note = tip.querySelector("p");
    const mode = tilePreviewDimMode();
    let holeCount = 0;
    tip.querySelectorAll("[data-tile-dim-mode]").forEach((btn) => {
      const active = btn.dataset.tileDimMode === mode;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    if (svg) {
      const pad = 58;
      const maxW = 300;
      const maxH = 330;
      const pts = cell.concat(...fragments);
      const minX = Math.min(...pts.map((pt) => pt.x));
      const minY = Math.min(...pts.map((pt) => pt.y));
      const maxX = Math.max(...pts.map((pt) => pt.x));
      const maxY = Math.max(...pts.map((pt) => pt.y));
      const spanX = Math.max(0.02, maxX - minX);
      const spanY = Math.max(0.02, maxY - minY);
      const scale = Math.min(maxW / spanX, maxH / spanY);
      const boxW = spanX * scale;
      const boxH = spanY * scale;
      const sx = (x) => pad + (x - minX) * scale;
      // На стене высота растёт вверх, а координата SVG — вниз.
      const invertY = session.mark?.view?.kind === "wall";
      const sy = (y) => pad + (invertY ? maxY - y : y - minY) * scale;
      const pathOf = (poly) => `${poly.map((pt, i) => `${i ? "L" : "M"}${sx(pt.x).toFixed(1)} ${sy(pt.y).toFixed(1)}`).join(" ")} Z`;
      const mid = (poly) => poly.reduce((sum, pt) => ({ x: sum.x + pt.x, y: sum.y + pt.y }), { x: 0, y: 0 });
      const cellMid = mid(cell);
      cellMid.x /= cell.length;
      cellMid.y /= cell.length;
      const onEdge = (a, b, edgeA, edgeB) => {
        const near = (pt, c, d) => {
          const abx = d.x - c.x, aby = d.y - c.y;
          const len2 = abx * abx + aby * aby || 1;
          const t = Math.max(0, Math.min(1, ((pt.x - c.x) * abx + (pt.y - c.y) * aby) / len2));
          return Math.hypot(pt.x - (c.x + abx * t), pt.y - (c.y + aby * t)) < 0.01;
        };
        return near(a, edgeA, edgeB) && near(b, edgeA, edgeB);
      };
      const edgeLen = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
      const edgesOf = (poly) => poly.map((pt, i) => [pt, poly[(i + 1) % poly.length]]);
      const cellEdges = edgesOf(cell);
      const placed = [];
      const calloutBoxes = [];
      const callout = (ax, ay, text, color) => {
        const width = Math.max(42, text.length * 7.2 + 16);
        const height = 23;
        const candidates = [];
        for (const radius of [30, 46, 62, 78, 94]) {
          for (let step = 0; step < 12; step += 1) {
            const angle = (step / 12) * Math.PI * 2 - Math.PI / 2;
            candidates.push({ x: ax + Math.cos(angle) * radius, y: ay + Math.sin(angle) * radius });
          }
        }
        let target = null;
        for (const point of candidates) {
          const box = { left: point.x - width / 2, right: point.x + width / 2, top: point.y - height / 2, bottom: point.y + height / 2 };
          if (box.left < 2 || box.top < 2 || box.right > boxW + pad * 2 - 2 || box.bottom > boxH + pad * 2 - 2) continue;
          if (calloutBoxes.some((item) => box.left < item.right + 4 && box.right + 4 > item.left && box.top < item.bottom + 4 && box.bottom + 4 > item.top)) continue;
          const coversHole = holes.some((hole) => {
            const hx = surface === "wall" ? hole.along : hole.x;
            const hy = surface === "wall" ? hole.rise : hole.y;
            const left = sx(hx) - (hole.shape === "circle" ? hole.d * scale / 2 : 0);
            const right = sx(hx + (hole.shape === "circle" ? 0 : hole.w)) + (hole.shape === "circle" ? hole.d * scale / 2 : 0);
            const top = Math.min(sy(hy), sy(hy + (hole.shape === "circle" ? 0 : hole.h))) - (hole.shape === "circle" ? hole.d * scale / 2 : 0);
            const bottom = Math.max(sy(hy), sy(hy + (hole.shape === "circle" ? 0 : hole.h))) + (hole.shape === "circle" ? hole.d * scale / 2 : 0);
            return box.left < right + 3 && box.right + 3 > left && box.top < bottom + 3 && box.bottom + 3 > top;
          });
          if (coversHole) continue;
          target = { ...point, box };
          break;
        }
        if (!target) return "";
        calloutBoxes.push(target.box);
        const dx = target.x - ax, dy = target.y - ay, len = Math.hypot(dx, dy) || 1;
        const ex = target.x - dx / len * (width * 0.34);
        const ey = target.y - dy / len * (height * 0.34);
        return `<path d="M${ax.toFixed(1)} ${ay.toFixed(1)} L${ex.toFixed(1)} ${ey.toFixed(1)}" stroke="${color}" stroke-width="1.5" fill="none"/><rect x="${target.box.left.toFixed(1)}" y="${target.box.top.toFixed(1)}" width="${width.toFixed(1)}" height="${height}" rx="6" fill="#fff" fill-opacity=".94" stroke="${color}" stroke-width="1.2"/><text x="${target.x.toFixed(1)}" y="${target.y.toFixed(1)}" font-size="13" font-weight="700" fill="${color}" text-anchor="middle" dominant-baseline="middle">${text}</text>`;
      };
      const label = (a, b, away, dist, inward) => {
        const meters = edgeLen(a, b);
        if (meters < 0.025) return "";
        const A = { x: sx(a.x), y: sy(a.y) };
        const B = { x: sx(b.x), y: sy(b.y) };
        const screen = Math.hypot(B.x - A.x, B.y - A.y);
        if (screen < 34) return "";
        const dx = B.x - A.x, dy = B.y - A.y;
        let nx = -dy / screen, ny = dx / screen;
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
        const C = { x: sx(away.x), y: sy(away.y) };
        if ((C.x - mx) * nx + (C.y - my) * ny > 0) { nx = -nx; ny = -ny; }
        if (inward) { nx = -nx; ny = -ny; }
        const px = mx + nx * dist, py = my + ny * dist;
        let ang = Math.atan2(dy, dx) * 180 / Math.PI;
        if (ang > 90 || ang < -90) ang += 180;
        const text = tileTipText(meters);
        if (placed.some((item) => Math.hypot(item.x - px, item.y - py) < 38)) return "";
        placed.push({ x: px, y: py, text });
        return `<text x="${px.toFixed(1)}" y="${py.toFixed(1)}" font-size="19" font-weight="700" fill="#c2410c" text-anchor="middle" dominant-baseline="middle" transform="rotate(${ang.toFixed(1)} ${px.toFixed(1)} ${py.toFixed(1)})">${text}</text>`;
      };
      const outline = `<path d="${pathOf(cell)}" fill="none" stroke="#a8a29e" stroke-width="1.6" stroke-dasharray="6 4"/>`;
      const fills = fragments.map((poly) => `<path d="${pathOf(poly)}" fill="#d6c4a8" stroke="#44403c" stroke-width="2"/>`).join("");
      const fresh = [], rest = [];
      fragments.forEach((poly) => edgesOf(poly).forEach(([a, b]) => {
        const host = cellEdges.find(([c, d]) => onEdge(a, b, c, d));
        if (!host) fresh.push([a, b, poly]);
        else if (edgeLen(host[0], host[1]) - edgeLen(a, b) > 0.02) rest.push([a, b, poly]);
      }));
      const seams = fresh.map(([a, b]) => `M${sx(a.x).toFixed(1)} ${sy(a.y).toFixed(1)} L${sx(b.x).toFixed(1)} ${sy(b.y).toFixed(1)}`).join(" ");
      const seamPath = seams ? `<path d="${seams}" fill="none" stroke="#44403c" stroke-width="2"/>` : "";
      const whole = mode === "tile" ? cellEdges.map(([a, b]) => label(a, b, cellMid, 34, false)).join("") : "";
      const slices = mode === "cuts" ? fresh.concat(rest).map(([a, b, poly]) => {
        const local = mid(poly); local.x /= poly.length; local.y /= poly.length;
        return label(a, b, local, 20, false);
      }).join("") : "";
      const faceInfo = tileFaceOf(ctx.base, session.mark?.surface || "floor");
      const surface = faceInfo?.surface || "floor";
      const wallId = faceInfo?.wall?.id || session.mark?.view?.wall?.id || "";
      const cellBounds = {
        left: Math.min(...cell.map((pt) => pt.x)),
        right: Math.max(...cell.map((pt) => pt.x)),
        bottom: Math.min(...cell.map((pt) => pt.y)),
        top: Math.max(...cell.map((pt) => pt.y)),
      };
      const clipToCell = (subject) => {
        const signedArea = cell.reduce((sum, point, index) => {
          const next = cell[(index + 1) % cell.length];
          return sum + point.x * next.y - next.x * point.y;
        }, 0);
        const direction = signedArea >= 0 ? 1 : -1;
        let output = subject;
        cellEdges.forEach(([a, b]) => {
          const input = output;
          output = [];
          if (!input.length) return;
          const side = (point) => direction * ((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x));
          let start = input[input.length - 1];
          input.forEach((end) => {
            const startSide = side(start), endSide = side(end);
            const startInside = startSide >= -1e-8, endInside = endSide >= -1e-8;
            if (startInside !== endInside) {
              const t = startSide / (startSide - endSide);
              output.push({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
            }
            if (endInside) output.push(end);
            start = end;
          });
        });
        return output;
      };
      const polygonArea = (poly) => Math.abs(poly.reduce((sum, point, index) => {
        const next = poly[(index + 1) % poly.length];
        return sum + point.x * next.y - next.x * point.y;
      }, 0) / 2);
      const pointSegmentDistance = (p, a, b) => {
        const dx = b.x - a.x, dy = b.y - a.y;
        const len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
        return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
      };
      const segmentsCross = (a, b, c, d) => {
        const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
        const onSegment = (p, q, r) =>
          q.x >= Math.min(p.x, r.x) - 1e-8 && q.x <= Math.max(p.x, r.x) + 1e-8 &&
          q.y >= Math.min(p.y, r.y) - 1e-8 && q.y <= Math.max(p.y, r.y) + 1e-8;
        const ab1 = cross(a, b, c), ab2 = cross(a, b, d);
        const cd1 = cross(c, d, a), cd2 = cross(c, d, b);
        if (((ab1 > 1e-8 && ab2 < -1e-8) || (ab1 < -1e-8 && ab2 > 1e-8)) &&
            ((cd1 > 1e-8 && cd2 < -1e-8) || (cd1 < -1e-8 && cd2 > 1e-8))) return true;
        return (Math.abs(ab1) <= 1e-8 && onSegment(a, c, b)) ||
          (Math.abs(ab2) <= 1e-8 && onSegment(a, d, b)) ||
          (Math.abs(cd1) <= 1e-8 && onSegment(c, a, d)) ||
          (Math.abs(cd2) <= 1e-8 && onSegment(c, b, d));
      };
      const openingHitsCell = (hole) => {
        const x = surface === "wall" ? hole.along : hole.x;
        const y = surface === "wall" ? hole.rise : hole.y;
        if (hole.shape === "circle") {
          const center = { x, y }, radius = Math.max(0, hole.d / 2);
          if (polyHit(cell, x, y)) return true;
          return cellEdges.some(([a, b]) => pointSegmentDistance(center, a, b) <= radius + 1e-7);
        }
        const rect = [
          { x, y }, { x: x + hole.w, y },
          { x: x + hole.w, y: y + hole.h }, { x, y: y + hole.h },
        ];
        return polygonArea(clipToCell(rect)) > 1e-8;
      };
      const holes = (ctx.base.openings || []).filter((hole) =>
        hole.surface === surface && (surface !== "wall" || hole.wallId === wallId) && openingHitsCell(hole)
      );
      holeCount = holes.length;
      const legend = tip.querySelector("[data-tile-preview-legend]");
      const legendRows = [];
      const holeShapes = holes.map((hole) => {
        const x = surface === "wall" ? hole.along : hole.x;
        const y = surface === "wall" ? hole.rise : hole.y;
        if (hole.shape === "circle") {
          const cx = sx(x), cy = sy(y), radius = Math.max(2, hole.d * scale / 2);
          return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${radius.toFixed(1)}" fill="#dc2626" fill-opacity=".24" stroke="#b91c1c" stroke-width="2"/>`;
        }
        const top = invertY ? sy(y + hole.h) : sy(y);
        return `<rect x="${sx(x).toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(1, hole.w * scale).toFixed(1)}" height="${Math.max(1, hole.h * scale).toFixed(1)}" fill="#dc2626" fill-opacity=".24" stroke="#b91c1c" stroke-width="2"/>`;
      }).join("");
      let holeDims = "";
      if (mode === "holes") {
        holeDims = holes.map((hole, index) => {
          const x = surface === "wall" ? hole.along : hole.x;
          const y = surface === "wall" ? hole.rise : hole.y;
          if (hole.shape === "circle") {
            const cx = sx(x), cy = sy(y);
            const value = `Ø ${tileTipText(hole.d)}`;
            legendRows.push(`<span><b>${index + 1}.</b> ${value}</span>`);
            return callout(cx, cy, value, "#b91c1c");
          }
          const clippedPart = clipToCell([
            { x, y }, { x: x + hole.w, y },
            { x: x + hole.w, y: y + hole.h }, { x, y: y + hole.h },
          ]);
          if (clippedPart.length < 3 || polygonArea(clippedPart) < 1e-8) return "";
          const partLeft = Math.min(...clippedPart.map((point) => point.x));
          const partRight = Math.max(...clippedPart.map((point) => point.x));
          const partBottom = Math.min(...clippedPart.map((point) => point.y));
          const partTop = Math.max(...clippedPart.map((point) => point.y));
          const partW = Math.max(0, partRight - partLeft);
          const partH = Math.max(0, partTop - partBottom);
          if (partW < 0.005 || partH < 0.005) return "";
          const center = { x: (partLeft + partRight) / 2, y: (partBottom + partTop) / 2 };
          const value = `${tileTipText(partW)} × ${tileTipText(partH)}`;
          legendRows.push(`<span><b>${index + 1}.</b> ${value}</span>`);
          const anchorX = sx(center.x), anchorY = sy(center.y);
          return callout(anchorX, anchorY, value, "#b91c1c");
        }).join("");
      }
      let offsetDims = "";
      if (mode === "offsets") {
        offsetDims = holes.map((hole, index) => {
          const x = surface === "wall" ? hole.along : hole.x;
          const y = surface === "wall" ? hole.rise : hole.y;
          if (hole.shape === "circle") {
            // Круг виден на соседней плитке, но отступы показываем только
            // на той плитке, внутри которой находится его центр.
            if (!polyHit(cell, x, y)) return "";
            const center = { x, y };
            const nearest = cellEdges.map(([a, b]) => {
              const dx = b.x - a.x, dy = b.y - a.y;
              const len2 = dx * dx + dy * dy || 1;
              const normal = { x: -dy / Math.sqrt(len2), y: dx / Math.sqrt(len2) };
              const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
              const point = { x: a.x + dx * t, y: a.y + dy * t };
              return { from: center, point, distance: Math.max(0, Math.hypot(x - point.x, y - point.y) - hole.d / 2), normal };
            }).sort((a, b) => a.distance - b.distance);
            const first = nearest[0];
            const second = nearest.find((item) => Math.abs(first.normal.x * item.normal.x + first.normal.y * item.normal.y) < 0.75) || nearest[1];
            const line = (item, text) => {
              const ax = sx(item.from.x), ay = sy(item.from.y), bx = sx(item.point.x), by = sy(item.point.y);
              return `<path d="M${ax.toFixed(1)} ${ay.toFixed(1)} L${bx.toFixed(1)} ${by.toFixed(1)}" stroke="#7c3aed" stroke-width="1.5" stroke-dasharray="4 3" fill="none"/>` + callout((ax + bx) / 2, (ay + by) / 2, text, "#6d28d9");
            };
            const firstText = `A ${tileTipText(first.distance)}`;
            const secondText = second ? `B ${tileTipText(second.distance)}` : "";
            legendRows.push(`<span><b>${index + 1}.</b> ${firstText}${secondText ? ` · ${secondText}` : ""}</span>`);
            return line(first, firstText) + (second ? line(second, secondText) : "");
          }

          // Для прямоугольника используем только ту часть контура,
          // которая реально видна внутри текущего фрагмента плитки.
          const clippedPart = clipToCell([
            { x, y }, { x: x + hole.w, y },
            { x: x + hole.w, y: y + hole.h }, { x, y: y + hole.h },
          ]);
          if (clippedPart.length < 3 || polygonArea(clippedPart) < 1e-8) return "";
          const visibleHoleEdges = edgesOf(clippedPart).filter(([a, b]) =>
            !cellEdges.some(([c, d]) => onEdge(a, b, c, d))
          );
          if (!visibleHoleEdges.length) return "";

          const project = (p, a, b) => {
            const dx = b.x - a.x, dy = b.y - a.y;
            const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
            return { x: a.x + dx * t, y: a.y + dy * t };
          };
          // Отступ считаем отдельно для каждого оставшегося фрагмента.
          // Для П-/Г-образного остатка общий контур исходной плитки не является
          // противоположным ребром фрагмента.
          const nearest = [];
          fragments.forEach((fragment, fragmentIndex) => {
            edgesOf(fragment).forEach(([a, b]) => {
              const dx = b.x - a.x, dy = b.y - a.y;
              const len = Math.hypot(dx, dy) || 1;
              const normal = { x: -dy / len, y: dx / len };
              visibleHoleEdges.forEach(([c, d]) => {
                const hx = d.x - c.x, hy = d.y - c.y;
                const hlen = Math.hypot(hx, hy) || 1;
                // Сравниваем только параллельные рёбра с общей проекцией.
                if (Math.abs((dx * hy - dy * hx) / (len * hlen)) > 0.02) return;
                const ux = dx / len, uy = dy / len;
                const a0 = a.x * ux + a.y * uy, a1 = b.x * ux + b.y * uy;
                const c0 = c.x * ux + c.y * uy, c1 = d.x * ux + d.y * uy;
                if (Math.min(Math.max(a0, a1), Math.max(c0, c1)) -
                    Math.max(Math.min(a0, a1), Math.min(c0, c1)) < 0.002) return;
                const holeMid = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };
                const fragmentPoint = project(holeMid, a, b);
                const distance = Math.hypot(fragmentPoint.x - holeMid.x, fragmentPoint.y - holeMid.y);
                if (distance > 0.002) nearest.push({ from: fragmentPoint, point: holeMid, distance, normal, fragmentIndex });
              });
            });
          });
          if (!nearest.length) return "";
          const line = (item, text) => {
            const ax = sx(item.from.x), ay = sy(item.from.y), bx = sx(item.point.x), by = sy(item.point.y);
            return `<path d="M${ax.toFixed(1)} ${ay.toFixed(1)} L${bx.toFixed(1)} ${by.toFixed(1)}" stroke="#7c3aed" stroke-width="1.5" stroke-dasharray="4 3" fill="none"/>` + callout((ax + bx) / 2, (ay + by) / 2, text, "#6d28d9");
          };
          const fragmentRows = [];
          const fragmentLines = [];
          fragments.forEach((_, fragmentIndex) => {
            const candidates = nearest.filter((item) => item.fragmentIndex === fragmentIndex)
              .sort((a, b) => b.distance - a.distance);
            if (!candidates.length) return;
            const first = candidates[0];
            const second = candidates.find((item) => Math.abs(first.normal.x * item.normal.x + first.normal.y * item.normal.y) < 0.75);
            const prefix = fragments.length > 1 ? `Ф${fragmentIndex + 1} ` : "";
            const firstText = `${prefix}A ${tileTipText(first.distance)}`;
            const secondText = second ? `${prefix}B ${tileTipText(second.distance)}` : "";
            fragmentRows.push(`${firstText}${secondText ? ` · ${secondText}` : ""}`);
            fragmentLines.push(line(first, firstText));
            if (second) fragmentLines.push(line(second, secondText));
          });
          if (fragmentRows.length) legendRows.push(`<span><b>${index + 1}.</b> ${fragmentRows.join(" · ")}</span>`);
          return fragmentLines.join("");
        }).join("");
      }
      const clip = `<defs><clipPath id="tile-preview-clip"><path d="${pathOf(cell)}"/></clipPath></defs>`;
      svg.setAttribute("viewBox", `0 0 ${boxW + pad * 2} ${boxH + pad * 2}`);
      svg.innerHTML = `${clip}${outline}${fills}${seamPath}<g clip-path="url(#tile-preview-clip)">${holeShapes}</g>${whole}${slices}${holeDims}${offsetDims}`;
      if (legend) {
        legend.innerHTML = legendRows.join("");
        legend.hidden = !["holes", "offsets"].includes(mode) || !legendRows.length;
      }
    }
    if (note) {
      const name = tilePatternName(pattern);
      const whole = `${tileTipText(fullW)} × ${tileTipText(fullH)}`;
      const left = piece.w < fullW - 0.004 || piece.h < fullH - 0.004;
      const desc = {
        tile: `Размер плитки: ${whole}`,
        cuts: `Размеры фрагментов: ${tileTipText(piece.w)} × ${tileTipText(piece.h)}`,
        holes: holeCount ? "Размеры отверстий: ширина, высота или диаметр" : "В выбранной плитке нет отверстий",
        offsets: holeCount ? "Для круглых отверстий — от центра (только на плитке с центром); для прямоугольных — от видимого ребра отверстия до противоположного ребра фрагмента плитки" : "В выбранной плитке нет отверстий",
      }[mode];
      note.textContent = `${name} · ${desc}${left && mode === "tile" ? ` · фрагмент ${tileTipText(piece.w)} × ${tileTipText(piece.h)}` : ""}`;
    }
    tip.hidden = false;
  }

  function tilePaint(g, view, ctx) {
    if (session.mark) session.mark.tilePieces = [];
    const face = tileFaceOf(ctx.base, session.mark?.surface || "floor");
    if (!face || !ctx.feed) { tileTipShow(null, ctx); return; }
    const preview = tilePreview(ctx.node, ctx.base, ctx.feed, face);
    const need = $("mark-side")?.querySelector("[data-tile-need]");
    if (need) need.textContent = `Купить: ${preview?.count || 0} шт. Разрезать: ${preview?.cuts || 0} шт.`;
    if (!preview?.tile || !preview.geom) { tileTipShow(null, ctx); return; }
    const spot = (p) => (view.kind === "wall" ? view.toAlong(p.x, p.y) : view.view.to(p));
    const trace = (poly) => {
      g.beginPath();
      poly.forEach((p, index) => {
        const s = spot(p);
        if (index) g.lineTo(s.x, s.y);
        else g.moveTo(s.x, s.y);
      });
      g.closePath();
    };
    session.mark.tilePieces = preview.bag.solid ? [] : (preview.bag.polys || []);
    g.save();
    if ((preview.tile.gap || 0) > 0.0005) {
      g.fillStyle = preview.tile.grout || "#a8a29e";
      g.globalAlpha = 1;
      trace(preview.geom.poly);
      g.fill();
    }
    const tone = tileTone(preview.tile.color);
    const paintFill = (poly) => {
      const pts = poly.map((p) => spot(p));
      if (!pts.length) return;
      let cx = 0;
      let cy = 0;
      pts.forEach((p) => { cx += p.x; cy += p.y; });
      cx /= pts.length;
      cy /= pts.length;
      let radius = 1;
      pts.forEach((p) => { radius = Math.max(radius, Math.hypot(p.x - cx, p.y - cy)); });
      const grd = g.createRadialGradient(cx, cy, radius * 0.12, cx, cy, radius);
      grd.addColorStop(0, tone.mid);
      grd.addColorStop(1, tone.base);
      g.fillStyle = grd;
    };
    g.strokeStyle = preview.tile.grout || "rgba(15,23,42,0.4)";
    g.lineWidth = 1;
    if (preview.bag.solid || !preview.bag.polys?.length) {
      trace(preview.geom.poly);
      paintFill(preview.geom.poly);
      g.globalAlpha = 0.72;
      g.fill();
    } else {
      g.globalAlpha = 0.92;
      const polygons = [];
      preview.bag.polys.forEach((piece) => {
        const fragments = Array.isArray(piece.cuts) && piece.cuts.length ? piece.cuts : [piece.poly || piece];
        fragments.forEach((poly) => {
          if (Array.isArray(poly) && poly.length >= 3) polygons.push({ poly, piece });
        });
      });
      // Сначала заливаем все фрагменты без обводки: иначе общие рёбра
      // соседних частей Г-образного выреза превращаются в лишние линии.
      polygons.forEach(({ poly }) => {
        trace(poly);
        paintFill(poly);
        g.fill();
      });
      // Объединяем контуры фрагментов отдельно для каждой плитки.
      // Вырезы могут разбивать Г-образный остаток на прямоугольники с Т-образными
      // стыками: сравнения только целых рёбер недостаточно, поэтому сначала
      // разбиваем рёбра по всем вершинам, лежащим на них.
      const boundaryOf = (items) => {
        const points = items.flatMap(({ poly }) => poly);
        const edges = new Map();
        const keyOf = (a, b) => {
          const point = (p) => `${Math.round(p.x * 10000)},${Math.round(p.y * 10000)}`;
          const pa = point(a);
          const pb = point(b);
          return pa < pb ? `${pa}|${pb}` : `${pb}|${pa}`;
        };
        items.forEach(({ poly }) => {
          poly.forEach((a, index) => {
            const b = poly[(index + 1) % poly.length];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len2 = dx * dx + dy * dy;
            if (len2 < 1e-12) return;
            const split = [0, 1];
            points.forEach((p) => {
              const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
              if (t <= 1e-7 || t >= 1 - 1e-7) return;
              const px = a.x + t * dx;
              const py = a.y + t * dy;
              if (Math.hypot(p.x - px, p.y - py) <= 1e-5) split.push(t);
            });
            split.sort((x, y) => x - y);
            for (let i = 1; i < split.length; i += 1) {
              const t0 = split[i - 1];
              const t1 = split[i];
              if (t1 - t0 < 1e-7) continue;
              const p = { x: a.x + t0 * dx, y: a.y + t0 * dy };
              const q = { x: a.x + t1 * dx, y: a.y + t1 * dy };
              const key = keyOf(p, q);
              const edge = edges.get(key);
              if (edge) edge.count += 1;
              else edges.set(key, { a: p, b: q, count: 1 });
            }
          });
        });
        return [...edges.values()].filter((edge) => edge.count === 1);
      };
      const groups = new Map();
      polygons.forEach((item) => {
        if (!groups.has(item.piece)) groups.set(item.piece, []);
        groups.get(item.piece).push(item);
      });
      const drawBoundaries = (items) => {
        const edges = boundaryOf(items);
        g.beginPath();
        edges.forEach(({ a, b }) => {
          const p = spot(a);
          const q = spot(b);
          g.moveTo(p.x, p.y);
          g.lineTo(q.x, q.y);
        });
        g.stroke();
      };
      groups.forEach((items) => drawBoundaries(items));
      const pickedGroups = [...groups.entries()].filter(([piece]) =>
        session.mark.tileSel && (piece.id === session.mark.tileSel || piece.pair === session.mark.tileSel)
      );
      if (pickedGroups.length) {
        g.save();
        g.strokeStyle = "#2563eb";
        g.lineWidth = 2.5;
        pickedGroups.forEach(([, items]) => drawBoundaries(items));
        g.restore();
      }
    }
    g.restore();
    tileDrawDims(g, view, ctx);
    (ctx.base.openings || []).forEach((hole) => {
      const onWall = view.kind === "wall" && hole.surface === "wall" && hole.wallId === view.wall?.id;
      const onPlan = view.kind === "plan" && hole.surface === face.surface;
      if (!onWall && !onPlan) return;
      g.save();
      g.strokeStyle = "#9a3412";
      g.lineWidth = 1.5;
      if (!preview.lay.openings) g.setLineDash([4, 3]);
      if (preview.lay.openings) g.fillStyle = plannerColors().bg;
      if (view.kind === "wall") {
        if (hole.shape === "circle") {
          const c = view.toAlong(hole.along, hole.rise);
          g.beginPath();
          g.arc(c.x, c.y, Math.max(3, (hole.d / 2) * view.scale), 0, Math.PI * 2);
          if (preview.lay.openings) g.fill();
          g.stroke();
        } else {
          const p = view.toAlong(hole.along, hole.rise + hole.h);
          const q = view.toAlong(hole.along + hole.w, hole.rise);
          if (preview.lay.openings) g.fillRect(p.x, p.y, q.x - p.x, q.y - p.y);
          g.strokeRect(p.x, p.y, q.x - p.x, q.y - p.y);
        }
      } else if (hole.shape === "circle") {
        const c = view.view.to({ x: hole.x, y: hole.y });
        g.beginPath();
        g.arc(c.x, c.y, Math.max(3, (hole.d / 2) * view.view.scale), 0, Math.PI * 2);
        if (preview.lay.openings) g.fill();
        g.stroke();
      } else {
        const p = view.view.to({ x: hole.x, y: hole.y });
        const q = view.view.to({ x: hole.x + hole.w, y: hole.y + hole.h });
        if (preview.lay.openings) g.fillRect(p.x, p.y, q.x - p.x, q.y - p.y);
        g.strokeRect(p.x, p.y, q.x - p.x, q.y - p.y);
      }
      g.restore();
    });
    const selectedPiece = (session.mark?.tilePieces || []).find((item) => item.id === session.mark?.tileSel);
    tileTipShow(selectedPiece || null, ctx);
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
    if (ctx.node.type === "tiles") tilePaint(g, view, ctx);
    else {
      (ctx.base.openings || []).forEach((hole) => drawHole(hole, true));
      if (ctx.node.type === "openings") markLocals(ctx).forEach((hole) => drawHole(hole, false));
    }
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
    if (ctx.node.type !== "electrics") return "";
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

  function markRoomBox(plan) {
    const pts = plan?.points || [];
    if (!pts.length) return { l: 0, r: 0, t: 0, b: 0 };
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) };
  }

  function markItemSpan(item, plan, kind, outer) {
    const wall = item.surface === "wall";
    const circle = kind === "hole" && item.shape === "circle";
    const fromCenter = kind === "fix" || (!outer && !!item.fromCenter);
    const r = circle ? item.d / 2 : 0;
    const cx = wall
      ? (kind === "fix" || circle ? item.along : item.along + item.w / 2)
      : (kind === "fix" || circle ? item.x : item.x + item.w / 2);
    const cy = wall
      ? (kind === "fix" || circle ? item.rise : item.rise + item.h / 2)
      : (kind === "fix" || circle ? item.y : item.y + item.h / 2);
    let l = cx - (fromCenter || kind === "fix" ? 0 : circle ? r : (wall ? item.along + item.w / 2 - item.along : item.w / 2));
    let ri = cx + (fromCenter || kind === "fix" ? 0 : circle ? r : (wall ? item.w / 2 : item.w / 2));
    let t;
    let b;
    if (fromCenter || kind === "fix") {
      l = cx;
      ri = cx;
      t = cy;
      b = cy;
    } else if (wall) {
      l = circle ? cx - r : item.along;
      ri = circle ? cx + r : item.along + item.w;
      b = circle ? cy - r : item.rise;
      t = circle ? cy + r : item.rise + item.h;
    } else {
      l = circle ? cx - r : item.x;
      ri = circle ? cx + r : item.x + item.w;
      t = circle ? cy - r : item.y;
      b = circle ? cy + r : item.y + item.h;
    }
    const limit = wall
      ? { l: 0, r: plannerWalls(plan).find((row) => row.id === item.wallId)?.len || 0, t: plan?.height || 2.7, b: 0 }
      : markRoomBox(plan);
    return { wall, up: wall ? 1 : -1, l, r: ri, t, b, cx, cy, limit };
  }

  function markGaps(span, ref, boundary) {
    const my = span;
    if (boundary) {
      if (span.up > 0) return { top: ref.t - my.t, bottom: my.b - ref.b, left: my.l - ref.l, right: ref.r - my.r };
      return { top: my.t - ref.t, bottom: ref.b - my.b, left: my.l - ref.l, right: ref.r - my.r };
    }
    if (span.up > 0) return { top: ref.b - my.t, bottom: my.b - ref.t, left: my.l - ref.r, right: ref.l - my.r };
    return { top: my.t - ref.b, bottom: ref.t - my.b, left: my.l - ref.r, right: ref.l - my.r };
  }

  function markEdgeContext(node, hitId) {
    const ctx = markContext();
    const plan = ctx?.base;
    if (!node || !plan || !hitId) return null;
    if (node.type === "openings") {
      const hole = node.holes.find((item) => item.id === hitId);
      if (!hole) return null;
      const live = resolveHole(hole, plan, node, ctx.graph?.values);
      const span = markItemSpan({ ...live, fromCenter: hole.fromCenter }, plan, "hole");
      const other = hole.edgeFrom ? node.holes.find((item) => item.id === hole.edgeFrom && item.id !== hole.id) : null;
      const otherLive = other ? resolveHole(other, plan, node, ctx.graph?.values) : null;
      const same = otherLive && otherLive.surface === live.surface && (live.surface !== "wall" || otherLive.wallId === live.wallId);
      const ref = same ? markItemSpan(otherLive, plan, "hole", true) : span.limit;
      return { kind: "hole", item: hole, live, span, gaps: markGaps(span, ref, !same), boundary: !same, plan };
    }
    const fix = node.fixtures.find((item) => item.id === hitId);
    if (!fix) return null;
    const span = markItemSpan(fix, plan, "fix", true);
    return { kind: "fix", item: fix, span, gaps: markGaps(span, span.limit, true), boundary: true, plan };
  }

  function markApplyEdge(node, hitId, side, cm) {
    const edge = markEdgeContext(node, hitId);
    if (!edge || cm == null || !["top", "bottom", "left", "right"].includes(side)) return false;
    const gap = cm / 100;
    const span = edge.span;
    const other = edge.boundary ? null : node.holes.find((item) => item.id === edge.item.edgeFrom);
    if (!edge.boundary && !other) return false;
    const ref = edge.boundary ? span.limit : markItemSpan(resolveHole(other, edge.plan, node, markContext()?.graph?.values), edge.plan, "hole", true);
    let target;
    if (edge.boundary) {
      if (span.up > 0) {
        if (side === "top") target = ref.t - gap;
        else if (side === "bottom") target = ref.b + gap;
        else if (side === "left") target = ref.l + gap;
        else target = ref.r - gap;
      } else if (side === "top") target = ref.t + gap;
      else if (side === "bottom") target = ref.b - gap;
      else if (side === "left") target = ref.l + gap;
      else target = ref.r - gap;
    } else if (span.up > 0) {
      if (side === "top") target = ref.b - gap;
      else if (side === "bottom") target = ref.t + gap;
      else if (side === "left") target = ref.r + gap;
      else target = ref.l - gap;
    } else if (side === "top") target = ref.b + gap;
    else if (side === "bottom") target = ref.t - gap;
    else if (side === "left") target = ref.r + gap;
    else target = ref.l - gap;
    const item = edge.item;
    const fromCenter = edge.kind === "fix" || item.fromCenter;
    const circle = edge.kind === "hole" && item.shape === "circle";
    const r = circle ? item.d / 2 : 0;
    const vertical = side === "top" || side === "bottom";
    if (edge.kind === "fix") {
      if (span.wall) {
        if (vertical) item.rise = plannerRound(target);
        else item.along = plannerRound(target);
      } else if (vertical) item.y = plannerRound(target);
      else item.x = plannerRound(target);
      return true;
    }
    if (fromCenter) {
      if (span.wall) {
        if (vertical) item.rise = plannerRound(circle ? target : target - item.h / 2);
        else item.along = plannerRound(circle ? target : target - item.w / 2);
      } else if (vertical) item.y = plannerRound(circle ? target : target - item.h / 2);
      else item.x = plannerRound(circle ? target : target - item.w / 2);
      return true;
    }
    if (side === "top") {
      if (span.wall) item.rise = plannerRound(circle ? target - r : target - item.h);
      else item.y = plannerRound(circle ? target + r : target);
    } else if (side === "bottom") {
      if (span.wall) item.rise = plannerRound(circle ? target + r : target);
      else item.y = plannerRound(circle ? target - r : target - item.h);
    } else if (side === "left") {
      if (span.wall) item.along = plannerRound(circle ? target + r : target);
      else item.x = plannerRound(circle ? target + r : target);
    } else if (span.wall) item.along = plannerRound(circle ? target - r : target - item.w);
    else item.x = plannerRound(circle ? target - r : target - item.w);
    return true;
  }

  function markEdgeHtml(node, hitId) {
    const edge = markEdgeContext(node, hitId);
    const box = $("mark-edge");
    if (!box) return;
    if (!edge) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    const field = (side, label) => `<label><span>${label}</span><input data-edge="${side}" inputmode="decimal" value="${esc(plannerInput(edge.gaps[side] * 100))}" /><span>см</span></label>`;
    let extra = "";
    if (edge.kind === "hole") {
      const live = edge.live;
      const others = node.holes.filter((item) => item.id !== edge.item.id && item.surface === live.surface && (live.surface !== "wall" || item.wallId === live.wallId));
      const edgeName = live.surface === "wall" ? "Край стены" : live.surface === "ceiling" ? "Край потолка" : "Край пола";
      const opts = [{ value: "", label: edgeName }].concat(others.map((item, index) => ({ value: item.id, label: item.name || holeLabel(item, index) })));
      extra = `<label class="mark-edge-check"><input type="checkbox" data-edge-center ${edge.item.fromCenter ? "checked" : ""} /><span>От центра</span></label><label class="mark-edge-from"><span>Считать от</span>${markSelect('data-edge-from="1"', "", opts, edge.item.edgeFrom || "")}</label>`;
    }
    box.hidden = false;
    box.innerHTML = `${field("top", "Сверху")}${field("bottom", "Снизу")}${field("left", "Слева")}${field("right", "Справа")}${extra}`;
  }

  function markShowMenu(clientX, clientY, hitId) {
    const canvas = $("mark-canvas");
    const menu = $("mark-menu");
    const card = $("mark-menu-card");
    const node = markNode();
    if (!canvas || !menu || !card || !node || !session.mark || node.type === "tiles") return;
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
    markEdgeHtml(node, hitId || "");
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
    if (node.type === "tiles") {
      editorClip = {
        kind: "tiles",
        tiles: JSON.parse(JSON.stringify(node.tiles)),
        lays: node.lays.filter((lay) => lay.feed === ctx.feed.id).map((lay) => ({
          ...JSON.parse(JSON.stringify(lay)),
          wallIndex: indexOf(lay.wallId),
        })),
      };
    } else if (node.type === "openings") {
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
    if (node.type === "tiles") {
      const map = new Map();
      (editorClip.tiles || []).forEach((raw) => {
        const same = node.tiles.find((item) => item.name === raw.name && item.pattern === raw.pattern && item.w === raw.w && item.h === raw.h && item.color === raw.color);
        if (same) {
          map.set(raw.id, same.id);
          return;
        }
        if (node.tiles.length >= 16) return;
        const id = uid();
        map.set(raw.id, id);
        node.tiles.push({ ...JSON.parse(JSON.stringify(raw)), id });
      });
      if (mode === "replace") node.lays = node.lays.filter((lay) => lay.feed !== feedId);
      (editorClip.lays || []).forEach((raw) => {
        const lay = JSON.parse(JSON.stringify(raw));
        delete lay.wallIndex;
        lay.feed = feedId;
        lay.tileId = map.get(lay.tileId) || lay.tileId || "";
        lay.wallId = lay.surface === "wall" ? clipWallId(raw, ctx.base) : "";
        node.lays.push(lay);
      });
    } else if (node.type === "openings") {
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

