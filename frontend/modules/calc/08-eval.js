  function nodeOutputs(node, order, links) {
    if (node.type === "math" || node.type === "result" || node.type === "percent" || node.type === "const") return [{ id: "out", name: "out" }];
    if (node.type === "formula") return node.outputs || [];
    if (node.type === "scheme") return schemeOutputs(findBlueprint(node.blueprintId));
    if (node.type === "filter") {
      return FILTER_PORTS.map((id) => ({ id, name: dashPortMeta(id).name }));
    }
    if (node.type === "dashboard") {
      const open = new Set(openDashPorts(node));
      const linked = linkedFromPorts(node.id, links || []);
      return DASH_PORTS.filter((port) => open.has(port.id) || linked.has(port.id)).map((port) => ({
        id: port.id,
        name: port.name,
      }));
    }
    if (node.type === "order") {
      const found = order || api.findOrder(node.orderId);
      const lines = orderLines(found);
      const linked = linkedFromPorts(node.id, links);
      const linkedIn = usedInputPorts(node.id, links || []);
      const ports = [];
      lines.forEach((line) => {
        const tone = lineTone(line, found);
        ports.push({
          id: `line:${line.id}`,
          name: line.product || "Позиция",
          line,
          tone,
          child: false,
        });
        const fields = new Set(openFieldsFor(node, line.id));
        const shown = new Map();
        lineFieldOptions(line, found).forEach((field) => shown.set(field.id, field));
        lineInputFieldOptions(line, found).forEach((field) => {
          if (!shown.has(field.id)) shown.set(field.id, field);
        });
        shown.forEach((field, fieldId) => {
          const outId = `line:${line.id}:${fieldId}`;
          const inId = lineInPortId(line.id, fieldId);
          if (fields.has(fieldId) || linked.has(outId) || linkedIn.has(inId)) {
            ports.push({
              id: outId,
              name: field.name,
              line,
              tone,
              child: true,
              field: fieldId,
              hasInput: lineInputFieldOptions(line, found).some((item) => item.id === fieldId),
            });
          }
        });
      });
      const openTypes = new Set(openTypesFor(node));
      orderTypeNames(found).forEach((typeName) => {
        const portId = typePortId(typeName);
        const childLinked = typeFieldOptions(found, typeName).some((field) => linked.has(typePortId(typeName, field.id)));
        if (!openTypes.has(typeName) && !linked.has(portId) && !childLinked) return;
        const tone = typeTone(found, typeName);
        ports.push({
          id: portId,
          name: `Σ ${typeName}`,
          typeName,
          tone,
          child: false,
          kind: "type",
        });
        const typeFields = new Set(openTypeFieldsFor(node, typeName));
        typeFieldOptions(found, typeName).forEach((field) => {
          const fieldId = typePortId(typeName, field.id);
          if (typeFields.has(field.id) || linked.has(fieldId)) {
            ports.push({
              id: fieldId,
              name: field.name,
              typeName,
              tone,
              child: true,
              field: field.id,
              kind: "type",
            });
          }
        });
      });
      ports.push({ id: "total", name: "Итого", tone: "total", child: false });
      return ports;
    }
    return [];
  }

  function formulaFieldErrors(node) {
    const bad = new Set();
    const seen = new Map();
    const take = (letter, key) => {
      const name = String(letter || "").trim();
      if (!/^[A-Z]$/.test(name)) {
        bad.add(key);
        return;
      }
      if (seen.has(name)) {
        bad.add(key);
        bad.add(seen.get(name));
      } else seen.set(name, key);
    };
    for (const port of node.inputs || []) take(port.name, `in:${port.id}`);
    for (const port of node.outputs || []) {
      const name = String(port.name || "").trim();
      take(name, `out:${port.id}`);
      const raw = String(port.expr || "");
      const body = raw.includes("=") ? splitAssign(raw).expr : raw;
      const expr = sanitizeFormulaExpr(body);
      const parsed = splitAssign(raw.includes("=") ? raw : `${expr}=${name}`);
      if (parsed.out && parsed.out !== name) bad.add(`expr:${port.id}`);
      try {
        evalExpr(expr || "0", {});
      } catch {
        bad.add(`expr:${port.id}`);
      }
    }
    return bad;
  }

  function formulaConflict(node) {
    return formulaFieldErrors(node).size > 0;
  }

  function computeGraph(bp, stack) {
    const values = {};
    const errors = new Set();
    const fields = {};
    const nodes = bp.nodes || [];
    const links = bp.links || [];
    if ((stack || []).includes(bp.id)) {
      nodes.forEach((node) => errors.add(node.id));
      return { values, errors, fields };
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
          // Сначала принимаем входы → пишем в строки заказа
          (incoming[nodeId] || []).forEach((link) => {
            const parsed = parseLinePort(link.toPort);
            if (!parsed?.input || !parsed.field) return;
            walk(link.from);
            const raw = values[`${link.from}:${link.fromPort}`];
            if (raw == null || !Number.isFinite(raw)) return;
            const line = orderLines(order).find((item) => item.id === parsed.lineId);
            if (!line) return;
            const inputMeta = lineInputFieldOptions(line, order).find((item) => item.id === parsed.field);
            if (!inputMeta) return;
            const exprKey = fieldToExprKey(parsed.field);
            if (!exprKey) return;
            const next = formatCalcNumber(raw);
            if (!next && next !== "0") return;
            const prev = line[exprKey] != null ? String(line[exprKey]).trim() : "";
            if (prev === next) return;
            line[exprKey] = next;
            if (parsed.field === "qty") line.quantity = Number(raw) || 0;
            if (parsed.field === "price") line.price = Number(raw) || 0;
            if (parsed.field === "discount") line.discount = Number(raw) || 0;
            if (parsed.field === "paid") line.paid = Number(raw) || 0;
            if (parsed.field === "percent") line.tax_percent = Number(raw) || 0;
            session.orderWritePending = true;
          });

          let total = 0;
          orderLines(order).forEach((line) => {
            const amount = lineAmount(line, order);
            setVal(nodeId, `line:${line.id}`, amount);
            total += amount;
            const shown = new Map();
            lineFieldOptions(line, order).forEach((field) => shown.set(field.id, field));
            lineInputFieldOptions(line, order).forEach((field) => {
              if (!shown.has(field.id)) shown.set(field.id, field);
            });
            shown.forEach((field, fieldId) => {
              setVal(nodeId, `line:${line.id}:${fieldId}`, lineFieldValue(line, order, fieldId));
              setVal(nodeId, lineInPortId(line.id, fieldId), lineFieldValue(line, order, fieldId));
            });
          });
          orderTypeNames(order).forEach((typeName) => {
            setVal(nodeId, typePortId(typeName), typeAmount(order, typeName));
            typeFieldOptions(order, typeName).forEach((field) => {
              setVal(nodeId, typePortId(typeName, field.id), typeFieldValue(order, typeName, field.id));
            });
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
        const badFields = formulaFieldErrors(node);
        if (badFields.size) {
          errors.add(nodeId);
          fields[nodeId] = [...badFields];
        }
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
          const raw = String(port.expr || "");
          const body = raw.includes("=") ? splitAssign(raw).expr : raw;
          const expr = sanitizeFormulaExpr(body);
          const outName = String(port.name || "").trim();
          try {
            const value = evalExpr(expr || "0", vars);
            setVal(nodeId, port.id, value);
            if (/^[A-Z]$/.test(outName) && value != null && Number.isFinite(value)) {
              vars[outName] = value;
            }
          } catch {
            errors.add(nodeId);
            if (!fields[nodeId]) fields[nodeId] = [];
            if (!fields[nodeId].includes(`expr:${port.id}`)) fields[nodeId].push(`expr:${port.id}`);
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
      } else if (node.type === "filter" || node.type === "dashboard") {
        const stats = dashStats(node);
        const ports = node.type === "filter" ? FILTER_PORTS : openDashPorts(node);
        const linked = linkedFromPorts(nodeId, links);
        const ids = new Set(ports.concat([...linked].filter((id) => DASH_PORTS.some((p) => p.id === id))));
        ids.forEach((id) => {
          const value = Number(stats[id]);
          setVal(nodeId, id, Number.isFinite(value) ? value : 0);
        });
      } else if (node.type === "present") {
        presentPorts(node).forEach((port) => {
          const link = (incoming[nodeId] || []).find((item) => item.toPort === port.id);
          let value = null;
          if (link) {
            walk(link.from);
            const found = values[`${link.from}:${link.fromPort}`];
            if (found != null && Number.isFinite(found)) value = found;
          }
          setVal(nodeId, port.id, value);
          // Пишем только при наличии связи: иначе активная схема затирает значения других схем.
          if (node.blockId && link && value != null && Number.isFinite(value)) {
            const key = `${node.blockId}:${port.id}`;
            presentValues.set(key, value);
            const found = window.FinPresent?.findBlock?.(node.blockId);
            if (found?.block) {
              if (!found.block.values || typeof found.block.values !== "object") found.block.values = {};
              found.block.values[port.id] = value;
            }
          }
        });
      }
      visiting.delete(nodeId);
      done.add(nodeId);
    }

    nodes.forEach((node) => walk(node.id));
    return { values, errors, fields };
  }

