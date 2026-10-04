  function findBlueprint(id) {
    return (ensureState()?.blueprints || []).find((bp) => bp.id === id) || null;
  }

  function resultName(node) {
    return String(node?.name || "").trim() || "Результат";
  }

  function resultPriority(node) {
    const n = Number(node?.priority);
    return Number.isFinite(n) ? n : 9999;
  }

  function resultVisible(node) {
    return node?.visible !== false;
  }

  function nextResultPriority(bp) {
    let max = 0;
    (bp?.nodes || []).forEach((node) => {
      if (node.type !== "result") return;
      const n = Number(node.priority);
      if (Number.isFinite(n) && n > max) max = n;
    });
    return max + 1;
  }

  function schemeOutputs(bp) {
    return (bp?.nodes || [])
      .filter((node) => node.type === "result" && resultVisible(node))
      .sort((a, b) => resultPriority(a) - resultPriority(b) || resultName(a).localeCompare(resultName(b), "ru"))
      .map((node) => ({
        id: `result:${node.id}`,
        name: resultName(node),
        resultId: node.id,
      }));
  }

  function pruneHiddenResultLinks(resultId) {
    const portId = `result:${resultId}`;
    (ensureState()?.blueprints || []).forEach((bp) => {
      bp.links = (bp.links || []).filter((link) => link.fromPort !== portId);
    });
  }

  function resultEyeIcon(on) {
    if (on) {
      return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
        <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>
      </svg>`;
    }
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 3l18 18M10.6 10.7a2.8 2.8 0 0 0 3.7 3.7M9.5 5.3A10.7 10.7 0 0 1 12 5c6 0 9.5 7 9.5 7a16.6 16.6 0 0 1-3.2 3.8M6.2 6.3C4.1 7.8 2.5 12 2.5 12s3.5 7 9.5 7c1.2 0 2.3-.2 3.3-.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
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
    if (node.type === "present") return presentPorts(node);
    if (node.type === "order") {
      const order = api.findOrder(node.orderId);
      const linkedIn = usedInputPorts(node.id, links || []);
      const linkedOut = linkedFromPorts(node.id, links || []);
      const ports = [];
      orderLines(order).forEach((line) => {
        const open = new Set(openFieldsFor(node, line.id));
        lineInputFieldOptions(line, order).forEach((field) => {
          const inId = lineInPortId(line.id, field.id);
          const outId = `line:${line.id}:${field.id}`;
          if (open.has(field.id) || linkedIn.has(inId) || linkedOut.has(outId)) {
            ports.push({
              id: inId,
              name: field.name,
              lineId: line.id,
              field: field.id,
            });
          }
        });
      });
      return ports;
    }
    return [];
  }

  function presentPorts(node) {
    const meta = window.FinPresent?.blockMeta?.(node.blockType || "metric");
    return (meta?.ports || []).map((port) => ({ id: port.id, name: port.name }));
  }

  function presentOwner(blockId, portId, exceptBpId) {
    const calc = ensureState();
    for (const bp of calc.blueprints || []) {
      if (exceptBpId && bp.id === exceptBpId) continue;
      const nodes = bp.nodes || [];
      for (const link of bp.links || []) {
        const dst = nodes.find((item) => item.id === link.to);
        if (!dst || dst.type !== "present" || dst.blockId !== blockId) continue;
        if (link.toPort !== portId) continue;
        return { blueprint: bp, node: dst, link };
      }
    }
    return null;
  }

  function presentUsage(blockId) {
    const calc = ensureState();
    const activeId = activeBlueprint()?.id || "";
    let onActive = 0;
    let onOther = 0;
    const otherNames = [];
    for (const bp of calc.blueprints || []) {
      const count = (bp.nodes || []).filter((node) => node.type === "present" && node.blockId === blockId).length;
      if (!count) continue;
      if (bp.id === activeId) onActive += count;
      else {
        onOther += count;
        if (bp.name) otherNames.push(bp.name);
      }
    }
    return { onActive, onOther, otherNames };
  }

  function setPresentHover(blockId) {
    session.presentHover = blockId || "";
    const host = nodesRoot();
    if (!host) return;
    host.querySelectorAll(".calc-node.is-present").forEach((el) => {
      const match = !!session.presentHover && el.dataset.presentBlockId === session.presentHover;
      el.classList.toggle("is-present-hl", match);
    });
  }

  function freePresentPort(blockId, portId) {
    const calc = ensureState();
    let changed = false;
    (calc.blueprints || []).forEach((bp) => {
      const before = (bp.links || []).length;
      bp.links = (bp.links || []).filter((link) => {
        const dst = (bp.nodes || []).find((item) => item.id === link.to);
        if (!dst || dst.type !== "present") return true;
        if (dst.blockId !== blockId || link.toPort !== portId) return true;
        return false;
      });
      if (bp.links.length !== before) changed = true;
    });
    if (changed) {
      dirty();
      render();
      renderPresentPanel();
    }
    return changed;
  }

  function removePresentBlockNodes(blockId) {
    if (!blockId) return false;
    const calc = ensureState();
    if (!calc) return false;
    let changed = false;
    (calc.blueprints || []).forEach((bp) => {
      const drop = new Set(
        (bp.nodes || []).filter((node) => node.type === "present" && node.blockId === blockId).map((node) => node.id)
      );
      if (!drop.size) return;
      bp.nodes = (bp.nodes || []).filter((node) => !drop.has(node.id));
      bp.links = (bp.links || []).filter((link) => !drop.has(link.from) && !drop.has(link.to));
      if (session.selected && drop.has(session.selected)) session.selected = "";
      changed = true;
    });
    [...presentValues.keys()].forEach((key) => {
      if (key.startsWith(`${blockId}:`)) presentValues.delete(key);
    });
    if (changed) {
      dirty();
      if (api?.view?.() === "calculator") render();
      else renderPresentPanel();
    }
    return changed;
  }

