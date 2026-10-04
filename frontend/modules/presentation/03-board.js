  function renderTabs(pres) {
    const host = $("pres-tabs");
    if (!host || !pres) return;
    host.innerHTML = (pres.pages || [])
      .map(
        (page) => `<div class="calc-tab ${page.id === pres.active ? "active" : ""}" data-pres-page="${esc(page.id)}" draggable="true" title="${esc(page.name)}">
          <span class="calc-tab-label">${esc(page.name)}</span>
          ${pres.pages.length > 1 ? `<button type="button" class="calc-tab-x" data-del-pres-page="${esc(page.id)}" title="Закрыть страницу" draggable="false">×</button>` : ""}
        </div>`
      )
      .join("");
  }

  function renderSide() {
    const host = $("pres-side");
    if (!host) return;
    host.innerHTML = `
      <div class="pres-side-top">
        <div class="calc-tools-label">Блоки</div>
        <div class="calc-tools pres-tools">
          ${BLOCK_TYPES.map(
            (item) => `<button type="button" class="btn calc-tool" data-add-pres-block="${esc(item.id)}" title="${esc(item.hint)}" draggable="true">
              <span class="pres-tool-ico" aria-hidden="true">${esc(item.ico)}</span>
              <span class="pres-tool-name">${esc(item.name)}</span>
            </button>`
          ).join("")}
        </div>
      </div>
      <div class="calc-hint hint-i pres-hint">
        <button type="button" class="info-btn" aria-label="Подсказка по блокам">i</button>
        <div class="hint-i-pop" role="tooltip">
          Перетащите блок на холст или кликните, чтобы добавить. Значения приходят из схем калькулятора.
        </div>
      </div>
    `;
  }

  function blockBodyHtml(block) {
    const type = block.type;
    const title = block.title || blockMeta(type).name;
    const showLabel = blockStyle(block).label;
    const labelHtml = showLabel ? `<div class="pres-k">${esc(title)}</div>` : "";
    if (type === "title") {
      return `<div class="pres-block-title">${esc(block.text || title)}</div>`;
    }
    if (type === "note") {
      return `<div class="pres-block-note">${showLabel ? `<b>${esc(title)}</b>` : ""}<p>${esc(block.text || "")}</p></div>`;
    }
    if (type === "spacer") {
      return `<div class="pres-block-spacer"></div>`;
    }
    if (type === "kpi") {
      const value = liveValue(block, "value");
      const goal = liveValue(block, "goal");
      return `<div class="pres-block-kpi">
        ${labelHtml}
        <div class="pres-v">${esc(fmt(value))}</div>
        ${goal != null ? `<div class="pres-sub">цель ${esc(fmt(goal))}</div>` : ""}
      </div>`;
    }
    if (type === "metric") {
      return `<div class="pres-block-metric">
        ${labelHtml}
        <div class="pres-v">${esc(fmt(liveValue(block, "value")))}</div>
      </div>`;
    }
    if (type === "compare") {
      return `<div class="pres-block-compare">
        ${labelHtml}
        <div class="pres-pair">
          <div><span>${esc(block.labels?.a || "A")}</span><b>${esc(fmt(liveValue(block, "a")))}</b></div>
          <div><span>${esc(block.labels?.b || "B")}</span><b>${esc(fmt(liveValue(block, "b")))}</b></div>
        </div>
      </div>`;
    }
    if (type === "delta") {
      const now = liveValue(block, "now");
      const was = liveValue(block, "was");
      let pct = null;
      if (now != null && was != null && was !== 0) pct = ((now - was) / Math.abs(was)) * 100;
      const up = pct != null && pct >= 0;
      return `<div class="pres-block-delta">
        ${labelHtml}
        <div class="pres-v">${esc(fmt(now))}</div>
        <div class="pres-delta ${pct == null ? "" : up ? "is-up" : "is-down"}">${pct == null ? "—" : `${up ? "+" : ""}${Math.round(pct)}%`}</div>
      </div>`;
    }
    if (type === "progress") {
      const value = liveValue(block, "value") || 0;
      const max = liveValue(block, "max");
      const denom = max != null && max > 0 ? max : 100;
      const pct = Math.max(0, Math.min(100, (value / denom) * 100));
      return `<div class="pres-block-progress">
        ${labelHtml}
        <div class="pres-progress-row"><b>${esc(fmt(value))}</b><span>${esc(fmt(denom))}</span></div>
        <div class="pres-bar"><i style="width:${pct}%"></i></div>
      </div>`;
    }
    if (type === "bars") {
      const ports = ["a", "b", "c", "d"];
      const vals = ports.map((id) => liveValue(block, id)).filter((v) => v != null);
      const peak = Math.max(1, ...vals.map((v) => Math.abs(v)));
      return `<div class="pres-block-bars">
        ${labelHtml}
        <div class="pres-cols">
          ${ports
            .map((id) => {
              const v = liveValue(block, id);
              if (v == null) return "";
              const h = Math.max(6, Math.round((Math.abs(v) / peak) * 100));
              return `<div class="pres-col"><i style="height:${h}%"></i><span>${esc(block.labels?.[id] || id.toUpperCase())}</span></div>`;
            })
            .join("")}
        </div>
      </div>`;
    }
    if (type === "share") {
      const part = liveValue(block, "part");
      const whole = liveValue(block, "whole");
      const pct = part != null && whole != null && whole !== 0 ? (part / whole) * 100 : null;
      return `<div class="pres-block-share">
        ${labelHtml}
        <div class="pres-share-ring" style="--p:${pct == null ? 0 : Math.max(0, Math.min(100, pct))}">
          <b>${pct == null ? "—" : `${Math.round(pct)}%`}</b>
        </div>
      </div>`;
    }
    return labelHtml || `<div class="pres-k">${esc(title)}</div>`;
  }

  function renderBoard() {
    const page = activePage();
    const world = $("pres-world");
    const name = $("pres-page-name");
    if (!world || !page) return;
    if (name && document.activeElement !== name) name.value = page.name || "";
    const blocks = [...(page.blocks || [])].sort((a, b) => (a.z || 1) - (b.z || 1));
    const shades = blocks
      .map((block) => {
        clampBlock(block, page);
        blockStyle(block);
        const meta = blockMeta(block.type);
        return `<i class="pres-shade" data-pres-shade="${esc(block.id)}" style="left:${block.x || 0}px;top:${block.y || 0}px;width:${block.w || meta.w}px;height:${block.h || meta.h}px" aria-hidden="true"></i>`;
      })
      .join("");
    const cards = blocks
      .map((block) => {
        const meta = blockMeta(block.type);
        const on = session.selected === block.id;
        return `<article class="pres-block is-${esc(block.type)} ${on ? "is-on" : ""}" data-pres-block="${esc(block.id)}" style="left:${block.x || 0}px;top:${block.y || 0}px;width:${block.w || meta.w}px;height:${block.h || meta.h}px">
          <button type="button" class="pres-x" data-del-pres-block="${esc(block.id)}" title="Удалить">×</button>
          <div class="pres-block-body">${blockBodyHtml(block)}</div>
          <i class="pres-resize" data-resize-pres="${esc(block.id)}" title="Размер"></i>
        </article>`;
      })
      .join("");
    world.innerHTML = `<div class="pres-shade-layer">${shades}</div>${cards}`;
    blocks.forEach((block) => {
      applyBlockStyle(world.querySelector(`[data-pres-block="${CSS.escape(block.id)}"]`), block);
    });
    applyPageLook(page);
    fitWorld();
  }

  function colorFallbacks() {
    return {
      bg: "#ffffff",
      bg2: "#e2e8f0",
      fg: "#0f172a",
      muted: "#64748b",
      accent: "#14b8a6",
      border: "#cbd5e1",
    };
  }

  function displayColor(style, key) {
    const s = style && typeof style === "object" ? style : {};
    if (hexOk(s[key])) return s[key];
    const fallbacks = colorFallbacks();
    if (key === "bg2") return hexOk(s.bg) || fallbacks.bg2;
    return fallbacks[key] || "#64748b";
  }

  function syncColorFields(block) {
    const host = $("pres-inspector");
    if (!host || !block) return;
    const style = blockStyle(block);
    ["bg", "bg2", "fg", "muted", "accent", "border"].forEach((key) => {
      const input = host.querySelector(`input[data-pres-style="${CSS.escape(key)}"]`);
      if (input) input.value = displayColor(style, key);
    });
  }

  function colorField(key, label, style) {
    const hex = displayColor(style, key);
    return `<label class="pres-color-field">
      <span>${esc(label)}</span>
      <span class="pres-color-wrap">
        <input type="color" data-pres-style="${esc(key)}" value="${esc(hex)}" title="${esc(label)}" />
        <button type="button" class="pres-color-clear" data-pres-style-clear="${esc(key)}" title="Сбросить">×</button>
      </span>
    </label>`;
  }

  function segBtn(group, value, current, label) {
    return `<button type="button" class="pres-seg ${current === value ? "is-on" : ""}" data-pres-style-set="${esc(group)}" data-value="${esc(value)}">${esc(label)}</button>`;
  }

  function renderInspector() {
    const host = $("pres-inspector");
    if (!host) return;
    const page = activePage();
    const block = page?.blocks?.find((item) => item.id === session.selected);
    if (!block) {
      const bg = hexOk(page?.bg) || "#e2e8f0";
      host.innerHTML = `
        <div class="pres-inspector-body">
          <div class="pres-inspector-h"><span class="pres-tool-name">Страница</span></div>
          <div class="pres-style-sec">
            <div class="pres-style-label">Фон страницы</div>
            <div class="pres-preset-row">
              ${PAGE_BG_PRESETS.map(
                (item) =>
                  `<button type="button" class="pres-page-bg ${(!page?.bg && !item.color) || page?.bg === item.color ? "is-on" : ""}" data-pres-page-bg="${esc(item.color)}" title="${esc(item.name)}" style="--sw:${esc(item.color || "#cbd5e1")}"></button>`
              ).join("")}
            </div>
            <label class="pres-color-field">
              <span>Свой цвет</span>
              <span class="pres-color-wrap">
                <input type="color" data-pres-page-field="bg" value="${esc(bg)}" />
              </span>
            </label>
            <label class="pres-check"><input type="checkbox" data-pres-page-field="showGrid" ${page?.showGrid ? "checked" : ""} /> Сетка 10px</label>
          </div>
          <div class="pres-inspector-empty" style="margin-top:12px">Выберите блок, чтобы настроить внешний вид, выравнивание и акценты.</div>
        </div>
        <div class="calc-hint hint-i pres-hint">
          <button type="button" class="info-btn" aria-label="Подсказка">i</button>
          <div class="hint-i-pop" role="tooltip">Кликните блок на холсте — справа откроется кастомизация: пресеты, цвета, тень, выравнивание.</div>
        </div>`;
      return;
    }
    const meta = blockMeta(block.type);
    const style = blockStyle(block);
    const ports = meta.ports || [];
    const tip = ports.length
      ? "Входы задаются в калькуляторе: кнопка «Презентация» → перетащите блок на схему."
      : "У этого блока нет входов из схем — это оформление страницы.";
    host.innerHTML = `
      <div class="pres-inspector-body">
        <div class="pres-inspector-h">
          <span class="pres-tool-ico" aria-hidden="true">${esc(meta.ico)}</span>
          <span class="pres-tool-name">${esc(meta.name)}</span>
        </div>
        <label class="field"><span>Подпись</span><input data-pres-field="title" value="${esc(block.title || "")}" maxlength="64" /></label>
        ${
          meta.id === "title" || meta.id === "note"
            ? `<label class="field"><span>Текст</span><textarea data-pres-field="text" rows="3" maxlength="400">${esc(block.text || "")}</textarea></label>`
            : ""
        }
        <div class="pres-style-sec">
          <div class="pres-style-label">Стиль</div>
          <div class="pres-preset-row">
            ${STYLE_PRESETS.map(
              (item) =>
                `<button type="button" class="pres-preset ${style.preset === item.id ? "is-on" : ""}" data-pres-preset="${esc(item.id)}" title="${esc(item.name)}">
                  <i style="background:${esc(item.swatch)}"></i><span>${esc(item.name)}</span>
                </button>`
            ).join("")}
          </div>
        </div>
        <div class="pres-style-sec">
          <div class="pres-style-label">Заливка</div>
          <div class="pres-seg-row">
            ${segBtn("fill", "auto", style.fill, "Авто")}
            ${segBtn("fill", "solid", style.fill, "Цвет")}
            ${segBtn("fill", "gradient", style.fill, "Градиент")}
            ${segBtn("fill", "glass", style.fill, "Стекло")}
            ${segBtn("fill", "none", style.fill, "Нет")}
          </div>
          <div class="pres-color-grid">
            ${colorField("bg", "Фон", style)}
            ${colorField("bg2", "Фон 2", style)}
            ${colorField("fg", "Текст", style)}
            ${colorField("muted", "Подпись", style)}
            ${colorField("accent", "Акцент", style)}
            ${colorField("border", "Рамка", style)}
          </div>
        </div>
        <div class="pres-style-sec">
          <div class="pres-style-label">Композиция</div>
          <div class="pres-seg-row">
            ${segBtn("align", "start", style.align, "Слева")}
            ${segBtn("align", "center", style.align, "Центр")}
            ${segBtn("align", "end", style.align, "Справа")}
          </div>
          <div class="pres-seg-row">
            ${segBtn("weight", "normal", style.weight, "Regular")}
            ${segBtn("weight", "bold", style.weight, "Bold")}
            ${segBtn("weight", "black", style.weight, "Black")}
          </div>
          <label class="pres-range"><span>Отступ</span><input type="range" min="0.4" max="2.2" step="0.05" data-pres-style="pad" value="${esc(style.pad)}" /><b>${esc(style.pad.toFixed(2))}</b></label>
          <label class="pres-range"><span>Шрифт</span><input type="range" min="0.6" max="1.8" step="0.05" data-pres-style="fs" value="${esc(style.fs)}" /><b>${esc(style.fs.toFixed(2))}</b></label>
          <label class="pres-range"><span>Скругление</span><input type="range" min="0" max="40" step="1" data-pres-style="radius" value="${esc(style.radius < 0 ? 16 : style.radius)}" /><b>${esc(String(style.radius < 0 ? 16 : style.radius))}</b></label>
          <label class="pres-range"><span>Рамка</span><input type="range" min="0" max="8" step="1" data-pres-style="borderW" value="${esc(style.borderW < 0 ? 1 : style.borderW)}" /><b>${esc(String(style.borderW < 0 ? 1 : style.borderW))}</b></label>
          <label class="pres-range"><span>Тень</span><input type="range" min="0" max="4" step="1" data-pres-style="shadow" value="${esc(style.shadow < 0 ? 1 : style.shadow)}" /><b>${esc(String(style.shadow < 0 ? 1 : style.shadow))}</b></label>
          <label class="pres-range"><span>Непрозрачность</span><input type="range" min="0.2" max="1" step="0.05" data-pres-style="opacity" value="${esc(style.opacity)}" /><b>${esc(Math.round(style.opacity * 100))}%</b></label>
          <label class="pres-check"><input type="checkbox" data-pres-style-bool="label" ${style.label ? "checked" : ""} /> Показывать подпись</label>
        </div>
        <div class="pres-style-sec">
          <div class="pres-style-label">Слой</div>
          <div class="pres-actions">
            <button type="button" class="btn" data-pres-layer="back" title="Назад">↓</button>
            <button type="button" class="btn" data-pres-layer="front" title="Вперёд">↑</button>
            <button type="button" class="btn" data-pres-dup="1" title="Дублировать">⧉</button>
            <button type="button" class="btn danger" data-del-pres-block="${esc(block.id)}" title="Удалить">×</button>
          </div>
        </div>
        ${
          ports.length
            ? `<div class="pres-ports-list">${ports
                .map((port) => {
                  const v = liveValue(block, port.id);
                  return `<div class="pres-port-row"><span>${esc(port.name)}</span><b>${esc(fmt(v))}</b></div>`;
                })
                .join("")}</div>`
            : ""
        }
      </div>
      <div class="calc-hint hint-i pres-hint">
        <button type="button" class="info-btn" aria-label="Подсказка">i</button>
        <div class="hint-i-pop" role="tooltip">${esc(tip)}</div>
      </div>
    `;
  }

  function render() {
    if (!api || api.view?.() !== "presentation") return;
    const pres = ensurePresentation();
    applyInspectorFold();
    applyCanvasLock();
    renderTabs(pres);
    renderSide();
    renderBoard();
    renderInspector();
    requestAnimationFrame(() => fitWorld());
  }

