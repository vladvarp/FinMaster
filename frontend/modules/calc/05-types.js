  function typeLabel(name) {
    const text = String(name || "").trim();
    return text || "Без типа";
  }

  function typePortKey(name) {
    return encodeURIComponent(typeLabel(name));
  }

  function typePortId(name, field) {
    const key = typePortKey(name);
    return field ? `type:${key}:${field}` : `type:${key}`;
  }

  function parseTypePort(portId) {
    const text = String(portId || "");
    const m = text.match(/^type:([^:]+)(?::([a-z]+))?$/);
    if (!m) return null;
    let typeName = m[1];
    try {
      typeName = decodeURIComponent(m[1]);
    } catch {
      /* keep raw */
    }
    return { typeName, field: m[2] || "" };
  }

  function orderTypeNames(order) {
    const names = [];
    const seen = new Set();
    orderLines(order).forEach((line) => {
      const name = typeLabel(line.order_type);
      if (seen.has(name)) return;
      seen.add(name);
      names.push(name);
    });
    return names;
  }

  function linesOfType(order, typeName) {
    const want = typeLabel(typeName);
    return orderLines(order).filter((line) => typeLabel(line.order_type) === want);
  }

  function typeTone(order, typeName) {
    const lines = linesOfType(order, typeName);
    if (!lines.length) return "income";
    return lineTone(lines[0], order);
  }

  function typeAmount(order, typeName) {
    return linesOfType(order, typeName).reduce((sum, line) => sum + lineAmount(line, order), 0);
  }

  function typeFieldOptions(order, typeName) {
    const lines = linesOfType(order, typeName);
    if (!lines.length) return [];
    return lineFieldOptions(lines[0], order);
  }

  function typeFieldValue(order, typeName, field) {
    return linesOfType(order, typeName).reduce((sum, line) => sum + lineFieldValue(line, order, field), 0);
  }

  function openFieldsFor(node, lineId) {
    const map = node.openFields && typeof node.openFields === "object" ? node.openFields : {};
    return Array.isArray(map[lineId]) ? map[lineId].slice() : [];
  }

  function ensureOpenField(node, lineId, field) {
    if (!node.openFields || typeof node.openFields !== "object") node.openFields = {};
    const list = Array.isArray(node.openFields[lineId]) ? node.openFields[lineId] : [];
    if (!list.includes(field)) list.push(field);
    node.openFields[lineId] = list;
  }

  function dropOpenField(node, lineId, field) {
    if (!node?.openFields || !Array.isArray(node.openFields[lineId])) return;
    node.openFields[lineId] = node.openFields[lineId].filter((item) => item !== field);
    if (!node.openFields[lineId].length) delete node.openFields[lineId];
  }

  function openTypesFor(node) {
    const list = Array.isArray(node?.openTypes) ? node.openTypes : [];
    const out = [];
    const seen = new Set();
    list.forEach((item) => {
      const name = typeLabel(item);
      if (seen.has(name)) return;
      seen.add(name);
      out.push(name);
    });
    return out;
  }

  function ensureOpenType(node, typeName) {
    const name = typeLabel(typeName);
    const list = openTypesFor(node);
    if (!list.includes(name)) list.push(name);
    node.openTypes = list;
  }

  function dropOpenType(node, typeName) {
    const name = typeLabel(typeName);
    node.openTypes = openTypesFor(node).filter((item) => item !== name);
    if (node.openTypeFields && typeof node.openTypeFields === "object") delete node.openTypeFields[name];
  }

  function openTypeFieldsFor(node, typeName) {
    const map = node.openTypeFields && typeof node.openTypeFields === "object" ? node.openTypeFields : {};
    const list = map[typeLabel(typeName)];
    return Array.isArray(list) ? list.slice() : [];
  }

  function ensureOpenTypeField(node, typeName, field) {
    const name = typeLabel(typeName);
    if (!node.openTypeFields || typeof node.openTypeFields !== "object") node.openTypeFields = {};
    const list = Array.isArray(node.openTypeFields[name]) ? node.openTypeFields[name] : [];
    if (!list.includes(field)) list.push(field);
    node.openTypeFields[name] = list;
  }

  function dropOpenTypeField(node, typeName, field) {
    const name = typeLabel(typeName);
    if (!node?.openTypeFields || !Array.isArray(node.openTypeFields[name])) return;
    node.openTypeFields[name] = node.openTypeFields[name].filter((item) => item !== field);
    if (!node.openTypeFields[name].length) delete node.openTypeFields[name];
  }

  function linkedFromPorts(nodeId, links) {
    const set = new Set();
    (links || []).forEach((link) => {
      if (link.from === nodeId) set.add(link.fromPort);
    });
    return set;
  }

  function dashPortMeta(id) {
    return DASH_PORTS.find((item) => item.id === id) || { id, name: id };
  }

  function normalizeDashPorts(list) {
    const allowed = new Set(DASH_PORTS.map((item) => item.id));
    const out = [];
    const seen = new Set();
    (Array.isArray(list) ? list : DASH_DEFAULT).forEach((id) => {
      const key = String(id || "");
      if (!allowed.has(key) || seen.has(key)) return;
      seen.add(key);
      out.push(key);
    });
    return out.length ? out : DASH_DEFAULT.slice();
  }

  function openDashPorts(node) {
    return normalizeDashPorts(node?.openPorts);
  }

  function ensureDashPort(node, portId) {
    const list = openDashPorts(node);
    if (!list.includes(portId)) list.push(portId);
    node.openPorts = normalizeDashPorts(list);
  }

  function dropDashPort(node, portId) {
    node.openPorts = openDashPorts(node).filter((id) => id !== portId);
    if (!node.openPorts.length) node.openPorts = DASH_DEFAULT.slice();
  }

  const FILTER_MULTI_MAX = 48;
  const DASH_PAY_MULTI = DASH_PAY_FILTERS.filter(([id]) => id !== "all");

