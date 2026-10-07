  /* ========== PDF снимка: страница на заказ + страница общего итога ========== */

  const LS_SHARE_PDF = "finmaster.sharePdf";
  const PDF_DEFAULTS = {
    orient: "portrait",
    margin: "normal",
    headerEach: true,
    pageNums: true,
    crop: false,
    orderTitles: false,
    tableAlign: "stretch",
    numAlign: "right",
    headAlign: "auto",
    grand: true,
    font: "segoe",
    scale: 100,
    density: "normal",
    zebra: true,
    grid: false,
    bold: true,
  };
  const PDF_FONTS = {
    segoe: '"Segoe UI", sans-serif',
    arial: "Arial, sans-serif",
    calibri: "Calibri, sans-serif",
    georgia: "Georgia, serif",
    times: '"Times New Roman", serif',
  };
  const PDF_NUM_COLS = new Set(["quantity", "price", "discount", "total", "paid", "unpaid"]);
  const PDF_PREVIEW_SCALE = 1.6;
  let pdfOpts = { ...PDF_DEFAULTS };
  let pdfRenderFrame = 0;

  function loadPdfOpts() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(LS_SHARE_PDF) || "{}") || {};
    } catch {
      saved = {};
    }
    return pdfOptsSnapshot(saved);
  }

  function savePdfOpts() {
    persistPref(LS_SHARE_PDF, JSON.stringify(pdfOpts));
  }

  /* ---- Профили настроек PDF (общие для всех отчётов) ---- */

  const LS_PDF_PROFILES = "finmaster.pdfProfiles";

  function pdfOptsSnapshot(src) {
    return Object.fromEntries(Object.keys(PDF_DEFAULTS).map((k) => [k, src?.[k] ?? PDF_DEFAULTS[k]]));
  }

  function loadPdfProfiles() {
    try {
      const list = JSON.parse(localStorage.getItem(LS_PDF_PROFILES) || "[]");
      return Array.isArray(list)
        ? list.filter((p) => p && String(p.name || "").trim() && p.opts && typeof p.opts === "object")
        : [];
    } catch {
      return [];
    }
  }

  function storePdfProfiles(list) {
    persistPref(LS_PDF_PROFILES, JSON.stringify(list), { now: true });
  }

  function pdfProfileMatches(p) {
    const saved = pdfOptsSnapshot(p.opts);
    return Object.keys(PDF_DEFAULTS).every((k) => String(saved[k]) === String(pdfOpts[k]));
  }

  function renderPdfProfiles() {
    const box = $("pdf-profile-list");
    if (!box) return;
    const list = loadPdfProfiles();
    box.innerHTML = list.length
      ? list
          .map(
            (p, i) => `<span class="share-profile ${pdfProfileMatches(p) ? "active" : ""}">
          <button type="button" data-pdf-profile-apply="${i}" title="Применить профиль «${esc(p.name)}»">${esc(p.name)}</button>
          <button type="button" class="share-profile-del" data-pdf-profile-del="${i}" title="Удалить профиль" aria-label="Удалить профиль">×</button>
        </span>`
          )
          .join("")
      : `<span class="hint">Пока нет — настройте PDF и сохраните профиль.</span>`;
  }

  function applyPdfProfile(p) {
    pdfOpts = pdfOptsSnapshot(p.opts);
    savePdfOpts();
    syncPdfTools();
    schedulePdfPreview();
  }

  function savePdfProfile() {
    const input = $("pdf-profile-name");
    const name = String(input?.value || "").trim().replace(/\s+/g, " ");
    if (!name) {
      toast("Введите название профиля");
      input?.focus();
      return;
    }
    const list = loadPdfProfiles();
    const key = name.toLocaleLowerCase("ru");
    const idx = list.findIndex((p) => String(p.name).trim().toLocaleLowerCase("ru") === key);
    const entry = { name, opts: pdfOptsSnapshot(pdfOpts) };
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
    storePdfProfiles(list);
    if (input) input.value = "";
    renderPdfProfiles();
    toast(idx >= 0 ? `Профиль PDF «${name}» обновлён` : `Профиль PDF «${name}» сохранён`);
  }

  async function deletePdfProfile(index) {
    const list = loadPdfProfiles();
    const p = list[index];
    if (!p) return;
    const ok = await askConfirm({
      title: "Удалить профиль PDF?",
      text: `Профиль «${p.name}» будет удалён. Текущие настройки PDF не изменятся.`,
      ok: "Удалить",
      danger: true,
    });
    if (!ok) return;
    list.splice(index, 1);
    storePdfProfiles(list);
    renderPdfProfiles();
  }

  /** Раскладка PDF в пунктах (1/72 дюйма): список страниц с командами рисования. */
  function sharePdfLayout(o, ctx) {
    const blocks = Array.isArray(ctx?.blocks) && ctx.blocks.length ? ctx.blocks : selectedShareBlocks();
    if (!blocks.length) return null;
    const fields = Array.isArray(ctx?.fields) && ctx.fields.length
      ? SHARE_FIELDS.map((f) => f.id).filter((id) => ctx.fields.includes(id))
      : currentShareFields();
    const hideLabels = ctx?.hideLabels != null ? !!ctx.hideLabels : shareHideLabels();
    const hideStamp = ctx?.hideStamp != null ? !!ctx.hideStamp : shareHideStamp();
    const cols = SHARE_FIELDS.filter((c) => c.kind === "col" && fields.includes(c.id));
    const customTitle = String(ctx?.title || "").trim();
    const title = customTitle || shareTitleText(blocks);
    const theme =
      ctx?.themeKey && SHARE_THEMES[ctx.themeKey] ? SHARE_THEMES[ctx.themeKey] : shareTheme();
    const portrait = o.orient !== "landscape";
    const W = portrait ? 595.28 : 841.89;
    const H = portrait ? 841.89 : 595.28;
    const M = { narrow: 22, normal: 36, wide: 56 }[o.margin] || 36;
    const f = Math.min(2, Math.max(0.6, Number(o.scale) / 100 || 1));
    const fam = PDF_FONTS[o.font] || PDF_FONTS.segoe;
    const font = (weight, size) => `${weight} ${size.toFixed(2)}px ${fam}`;
    const availW = W - M * 2;
    const rowBase = { compact: 16, normal: 20, loose: 25 }[o.density] || 20;
    const stamp = `Сформировано ${new Date().toLocaleString("ru-RU")}`;
    const footH = o.pageNums || !hideStamp ? 16 * f : 0;
    const bottom = H - M - footH;
    const expenseInk = theme.bg === "#0f172a" ? "#fbbf24" : "#b45309";

    const measure = document.createElement("canvas").getContext("2d");
    const textW = (str, fnt) => {
      measure.font = fnt;
      return measure.measureText(String(str ?? "")).width;
    };
    const fitText = (str, fnt, maxW) => {
      measure.font = fnt;
      return fitCanvasText(measure, String(str ?? ""), Math.max(4, maxW));
    };

    const pages = [];
    let page = null;
    const opBottom = (item) => {
      if (item.t === "line") return Math.max(item.y1, item.y2);
      if (item.t === "text") return item.y + (Number(String(item.font).match(/([\d.]+)px/)?.[1]) || 10) * 0.65;
      return item.y + (item.h || 0);
    };
    const op = (item) => {
      page.ops.push(item);
      page.maxY = Math.max(page.maxY, opBottom(item));
    };
    const text = (x, y, str, fnt, color, align = "left", extra = {}) => op({ t: "text", x, y, text: str, font: fnt, color, align, ...extra });
    const rect = (x, y, w, h, fill) => op({ t: "rect", x, y, w, h, fill });
    const line = (x1, y1, x2, y2, color, width = 0.6) => op({ t: "line", x1, y1, x2, y2, color, width });

    const bandH = 38 * f;
    let pageTitle = title;
    let bareHeader = false;
    function newPage(label, sub) {
      page = { ops: [], label, maxY: M, h: H };
      pages.push(page);
      let y = M;
      if (bareHeader) return y;
      if (pages.length === 1 || o.headerEach) {
        op({ t: "band", x: M, y, w: availW, h: bandH, c0: theme.head[0], c1: theme.head[1], accent: theme.headLine ? theme.accent : "" });
        const titleFont = font(700, 14 * f);
        const subFont = font(600, 9 * f);
        const subW = sub ? textW(sub, subFont) + 24 * f : 0;
        text(M + 12 * f, y + bandH / 2, fitText(pageTitle, titleFont, availW - 24 * f - subW), titleFont, theme.headInk);
        if (sub) text(M + availW - 12 * f, y + bandH / 2, sub, subFont, theme.headInk, "right", { alpha: 0.85 });
        y += bandH + 14 * f;
      } else if (sub) {
        text(M + availW, y + 6 * f, sub, font(600, 8 * f), theme.note, "right");
        y += 18 * f;
      }
      return y;
    }

    function tablePlan(spec, bodyRows, footRows) {
      const thSize = 7.5 * f;
      const tdSize = 9.5 * f;
      const padX = 6 * f;
      const natural = spec.map((c, i) => {
        let w = textW(c.label.toUpperCase(), font(600, thSize));
        bodyRows.forEach((r) => (w = Math.max(w, textW(r[i], font(400, tdSize)))));
        footRows.forEach((r) => (w = Math.max(w, textW(r[i], font(700, tdSize)))));
        return Math.max(28 * f, w + padX * 2 + 1);
      });
      let total = natural.reduce((s, w) => s + w, 0);
      const k = total > availW ? availW / total : 1;
      let widths = natural.map((w) => w * k);
      total *= k;
      let x0 = M;
      if (o.tableAlign === "stretch" && total < availW) {
        const extra = availW - total;
        widths = widths.map((w) => w + extra * (w / total));
        total = availW;
      } else if (o.tableAlign === "center" && total < availW) {
        x0 = M + (availW - total) / 2;
      }
      const rowH = rowBase * f * Math.max(0.75, k);
      return { spec, widths, total, x0, thSize: thSize * k, tdSize: tdSize * k, padX: padX * Math.max(0.6, k), rowH, headH: rowH * 1.05 };
    }

    function drawCell(x, y, w, h, str, fnt, color, align, padX) {
      const s = fitText(str, fnt, w - padX * 2);
      const tx = align === "right" ? x + w - padX : align === "center" ? x + w / 2 : x + padX;
      text(tx, y + h / 2, s, fnt, color, align);
    }

    function vlines(plan, y, h) {
      let x = plan.x0;
      plan.widths.slice(0, -1).forEach((w) => {
        x += w;
        line(x, y, x, y + h, theme.line, 0.5);
      });
    }

    function drawHead(plan, y) {
      rect(plan.x0, y, plan.total, plan.headH, theme.thBg);
      const fnt = font(600, plan.thSize);
      let x = plan.x0;
      plan.spec.forEach((c, i) => {
        const align = o.headAlign === "auto" && c.num ? o.numAlign : "left";
        drawCell(x, y, plan.widths[i], plan.headH, c.label.toUpperCase(), fnt, theme.thInk, align, plan.padX);
        x += plan.widths[i];
      });
      if (o.grid) vlines(plan, y, plan.headH);
      return y + plan.headH;
    }

    function drawRow(plan, y, cells, opts = {}) {
      if (opts.bg) rect(plan.x0, y, plan.total, plan.rowH, opts.bg);
      line(plan.x0, y, plan.x0 + plan.total, y, opts.topColor || theme.line, opts.topWidth || 0.6);
      const fnt = font(opts.bold ? 700 : 400, plan.tdSize);
      let x = plan.x0;
      plan.spec.forEach((c, i) => {
        drawCell(x, y, plan.widths[i], plan.rowH, cells[i], fnt, opts.color || theme.ink, c.num ? o.numAlign : "left", plan.padX);
        x += plan.widths[i];
      });
      if (o.grid) vlines(plan, y, plan.rowH);
      return y + plan.rowH;
    }

    function drawTable(plan, y, rows, foot, contLabel, contSub, rowColors) {
      y = drawHead(plan, y);
      rows.forEach((cells, ri) => {
        if (y + plan.rowH > bottom) {
          y = newPage(contLabel, contSub);
          y = drawHead(plan, y);
        }
        y = drawRow(plan, y, cells, { bg: o.zebra && ri % 2 ? theme.zebra : "", color: rowColors?.[ri] || "" });
      });
      if (foot) {
        if (y + plan.rowH > bottom) {
          y = newPage(contLabel, contSub);
          y = drawHead(plan, y);
        }
        y = drawRow(plan, y, foot, { bg: theme.footBg, bold: o.bold, topColor: theme.accent, topWidth: 1.2 });
      }
      line(plan.x0, y, plan.x0 + plan.total, y, theme.line, 0.6);
      return y;
    }

    const spec = cols.map((c) => ({ label: c.label, num: PDF_NUM_COLS.has(c.id) }));
    const blockRows = blocks.map(({ lines }) => lines.map((l) => cols.map((c) => String(shareLineValue(l, c.id) || "—"))));
    const blockFoot = blocks.map(({ lines }) => {
      const cells = shareFooterCells(cols, lines);
      return cells ? cells.map((v) => v || "") : null;
    });
    const plan = cols.length ? tablePlan(spec, blockRows.flat(), blockFoot.filter(Boolean)) : null;
    const metaFont = font(400, 10 * f);
    const totalsFont = font(o.bold ? 700 : 600, 11 * f);

    blocks.forEach(({ order, lines }, bi) => {
      const sub = blocks.length > 1 ? `Заказ ${bi + 1} из ${blocks.length}` : "";
      const label = `Заказ ${order.number || "—"}`;
      pageTitle =
        o.orderTitles && blocks.length > 1
          ? [String(order.number || "").trim(), String(order.name || "").trim()].filter(Boolean).join(" · ") || title
          : title;
      let y = newPage(label, sub);
      shareMetaItems(order, fields, hideLabels).forEach((m) => {
        text(M, y + 6 * f, fitText(m, metaFont, availW), metaFont, theme.meta);
        y += 15 * f;
      });
      y += 6 * f;
      if (plan) {
        const colors = lines.map((l) => (isExpenseLine(l) ? expenseInk : ""));
        y = drawTable(plan, y, blockRows[bi], blockFoot[bi], `${label} · продолжение`, sub ? `${sub} · продолжение` : "продолжение", colors);
      } else {
        text(M, y + 8 * f, "Таблица работ скрыта — включите колонки в снимке.", font(400, 9.5 * f), theme.note);
        y += 20 * f;
      }
      const totalsText = shareTotalsText(fields, cols, lines);
      if (totalsText) {
        if (y + 28 * f > bottom) y = newPage(label, sub);
        y += 12 * f;
        const right = plan && o.numAlign === "right";
        const tx = right ? plan.x0 + plan.total : plan ? plan.x0 : M;
        text(tx, y + 6 * f, fitText(totalsText, totalsFont, availW), totalsFont, theme.ink, right ? "right" : "left");
        y += 16 * f;
      }
    });

    if (o.grand && blocks.length > 1) {
      const grand = shareGrandData(blocks);
      const gcols = shareGrandCols(fields, grand);
      const s = grand.sum;
      bareHeader = true;
      let y = newPage("Общий итог", "");
      text(M, y + 8 * f, "Общий итог", font(700, 16 * f), theme.accent);
      y += 26 * f;
      const cards = [
        ["Заказов", String(s.orders)],
        ["Позиций", String(s.lines)],
        ["Итого", money(s.after)],
      ];
      if (s.cost > 0.005) cards.push(["Расходы", `−${money(s.cost)}`], ["К оплате", money(s.net)]);
      if (fields.includes("paid")) cards.push(["Оплачено", money(s.paid)]);
      if (fields.includes("unpaid")) cards.push(["Остаток", money(s.unpaid)]);
      const perRow = Math.min(cards.length, portrait ? 4 : 6);
      const gap = 8 * f;
      const cardH = 44 * f;
      const cw = (availW - gap * (perRow - 1)) / perRow;
      const valFont = font(700, 13 * f);
      for (let i = 0; i < cards.length; i += perRow) {
        cards.slice(i, i + perRow).forEach(([lab, val], j) => {
          const x = M + j * (cw + gap);
          op({ t: "card", x, y, w: cw, h: cardH, fill: theme.footBg, stroke: theme.line, accent: theme.accent });
          text(x + 10 * f, y + 14 * f, lab.toUpperCase(), font(600, 7.5 * f), theme.thInk);
          text(x + 10 * f, y + 30 * f, fitText(val, valFont, cw - 20 * f), valFont, theme.ink);
        });
        y += cardH + gap;
      }
      y += 10 * f;
      const gspec = gcols.map((c) => ({ label: c.label, num: !!c.money }));
      const grows = grand.rows.map((row) => gcols.map((c) => shareGrandCell(row, c.id)));
      const gfoot = gcols.map((c) => shareGrandFootCell(s, c.id));
      drawTable(tablePlan(gspec, grows, [gfoot]), y, grows, gfoot, "Общий итог · продолжение", "Общий итог · продолжение");
    }

    const total = pages.length;
    pages.forEach((p, i) => {
      page = p;
      if (o.crop) p.h = Math.min(H, Math.ceil(p.maxY + 12 * f + footH + M));
      if (!footH) return;
      const fy = p.h - M - 5 * f;
      const fline = p.h - M - footH + 3 * f;
      line(M, fline, M + availW, fline, theme.line, 0.5);
      if (!hideStamp) text(M, fy, stamp, font(400, 7.5 * f), theme.note);
      if (o.pageNums) text(M + availW, fy, `Стр. ${i + 1} из ${total}`, font(400, 7.5 * f), theme.note, "right");
    });
    return { W, H, pages, bg: theme.bg, title, fontKey: o.font, fontFamily: fam };
  }

  function pdfRoundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function renderPdfPageCanvas(layout, page, scale) {
    const pageH = page.h || layout.H;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(layout.W * scale);
    canvas.height = Math.round(pageH * scale);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(canvas.width / layout.W, 0, 0, canvas.height / pageH, 0, 0);
    ctx.fillStyle = layout.bg;
    ctx.fillRect(0, 0, layout.W, pageH);
    page.ops.forEach((item) => {
      if (item.t === "rect") {
        ctx.fillStyle = item.fill;
        ctx.fillRect(item.x, item.y, item.w, item.h);
      } else if (item.t === "line") {
        ctx.strokeStyle = item.color;
        ctx.lineWidth = item.width;
        ctx.beginPath();
        ctx.moveTo(item.x1, item.y1);
        ctx.lineTo(item.x2, item.y2);
        ctx.stroke();
      } else if (item.t === "band") {
        const g = ctx.createLinearGradient(item.x, 0, item.x + item.w, 0);
        g.addColorStop(0, item.c0);
        g.addColorStop(1, item.c1);
        ctx.fillStyle = g;
        pdfRoundRect(ctx, item.x, item.y, item.w, item.h, 6);
        ctx.fill();
        if (item.accent) {
          ctx.strokeStyle = item.accent;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(item.x, item.y + item.h);
          ctx.lineTo(item.x + item.w, item.y + item.h);
          ctx.stroke();
        }
      } else if (item.t === "card") {
        pdfRoundRect(ctx, item.x, item.y, item.w, item.h, 6);
        ctx.fillStyle = item.fill;
        ctx.fill();
        ctx.strokeStyle = item.stroke;
        ctx.lineWidth = 0.6;
        ctx.stroke();
        ctx.fillStyle = item.accent;
        ctx.fillRect(item.x, item.y + 7, 2.4, item.h - 14);
      } else if (item.t === "text") {
        ctx.globalAlpha = item.alpha ?? 1;
        ctx.font = item.font;
        ctx.fillStyle = item.color;
        ctx.textAlign = item.align || "left";
        ctx.textBaseline = "middle";
        ctx.fillText(item.text, item.x, item.y);
        ctx.globalAlpha = 1;
      }
    });
    return canvas;
  }

  function syncPdfTools() {
    document.querySelectorAll("#pdf-tools [data-pdf-opt]").forEach((seg) => {
      const key = seg.dataset.pdfOpt;
      seg.querySelectorAll("button[data-v]").forEach((b) => b.classList.toggle("active", b.dataset.v === String(pdfOpts[key])));
    });
    document.querySelectorAll("#pdf-tools [data-pdf-check]").forEach((el) => {
      el.checked = !!pdfOpts[el.dataset.pdfCheck];
    });
    const fontSel = $("pdf-font");
    if (fontSel) fontSel.value = pdfOpts.font;
    const scale = $("pdf-scale");
    if (scale) scale.value = String(pdfOpts.scale);
    const scaleVal = $("pdf-scale-val");
    if (scaleVal) scaleVal.textContent = `${pdfOpts.scale}%`;
    renderPdfProfiles();
  }

  function schedulePdfPreview() {
    cancelAnimationFrame(pdfRenderFrame);
    pdfRenderFrame = requestAnimationFrame(renderPdfPreview);
  }

  function renderPdfPreview() {
    const box = $("pdf-pages");
    if (!box || !$("pdf-modal")?.classList.contains("open")) return;
    const wrap = $("pdf-preview-wrap");
    const keepScroll = wrap ? wrap.scrollTop : 0;
    const layout = sharePdfLayout(pdfOpts);
    const count = $("pdf-count");
    if (!layout) {
      box.innerHTML = `<div class="hint">Выберите заказы и строки в снимке.</div>`;
      if (count) count.textContent = "";
      return;
    }
    if (count) count.textContent = `Страниц: ${layout.pages.length}`;
    box.classList.toggle("is-landscape", layout.W > layout.H);
    const frag = document.createDocumentFragment();
    layout.pages.forEach((p, i) => {
      const fig = document.createElement("figure");
      fig.className = "pdf-page";
      fig.appendChild(renderPdfPageCanvas(layout, p, PDF_PREVIEW_SCALE));
      const cap = document.createElement("figcaption");
      cap.textContent = `${i + 1} · ${p.label}`;
      fig.appendChild(cap);
      frag.appendChild(fig);
    });
    box.replaceChildren(frag);
    if (wrap) wrap.scrollTop = keepScroll;
  }

  function openSharePdf() {
    if (!selectedShareBlocks().length) {
      toast("Выберите заказы и строки для PDF");
      return;
    }
    pdfOpts = loadPdfOpts();
    syncPdfTools();
    $("pdf-modal").classList.add("open");
    const wrap = $("pdf-preview-wrap");
    if (wrap) wrap.scrollTop = 0;
    renderPdfPreview();
  }

  function bytesToBase64(bytes) {
    let bin = "";
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    return btoa(bin);
  }

  async function buildSharePdfBase64(opts, ctx) {
    const layout = sharePdfLayout(pdfOptsSnapshot(opts || {}), ctx || null);
    if (!layout) throw new Error("Выберите заказы и строки для PDF");
    if (!window.FinPdf?.build) throw new Error("модуль PDF не загружен");
    const bytes = await window.FinPdf.build(layout, { title: layout.title });
    return bytesToBase64(bytes);
  }

  let pdfJobBusy = false;
  let pdfJobTimer = 0;

  async function pollDesktopPdfJob() {
    if (!state.desktop || pdfJobBusy) return;
    pdfJobBusy = true;
    try {
      const job = await apiGet("/api/desktop/pdf-job");
      if (!job?.id) return;
      const blocks = Array.isArray(job.blocks)
        ? job.blocks
            .map((block) => {
              const order = block?.order;
              const lines = Array.isArray(block?.lines) ? block.lines.filter((line) => line && typeof line === "object") : [];
              if (!order || typeof order !== "object" || !lines.length) return null;
              return { order, lines };
            })
            .filter(Boolean)
        : [];
      try {
        const base64 = await buildSharePdfBase64(job.opts, {
          blocks,
          fields: job.fields,
          hideLabels: job.hide_labels,
          hideStamp: job.hide_stamp,
          title: job.title,
          themeKey: job.theme,
        });
        await apiPost("/api/desktop/pdf-job", { id: job.id, base64 });
      } catch (err) {
        await apiPost("/api/desktop/pdf-job", { id: job.id, error: String(err?.message || err || "ошибка PDF") });
      }
    } catch {
      /* окно ещё не готово или сервер перезапускается */
    } finally {
      pdfJobBusy = false;
    }
  }

  function watchDesktopPdfJobs() {
    if (!state.desktop || pdfJobTimer) return;
    pdfJobTimer = setInterval(() => {
      pollDesktopPdfJob();
    }, 900);
    pollDesktopPdfJob();
  }

  async function saveSharePdf() {
    const btn = $("pdf-save");
    try {
      const layout = sharePdfLayout(pdfOpts);
      if (!layout) throw new Error("Выберите заказы и строки для PDF");
      if (!window.FinPdf?.build) throw new Error("модуль PDF не загружен");
      const name = `${(layout.title || "Заказы").slice(0, 80)}.pdf`.replace(/[\\/:*?"<>|]+/g, "_");
      let path = "";
      if (state.desktop) {
        const picked = await apiPost("/api/dialog/pdf", { suggested: name });
        if (picked.cancelled || !picked.path) return;
        path = picked.path;
      }
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Сохраняю…";
      }
      const bytes = await window.FinPdf.build(layout, { title: layout.title });
      if (state.desktop) {
        await apiPost("/api/write-bytes", { path, base64: bytesToBase64(bytes) });
        toast(`PDF сохранён · страниц: ${layout.pages.length}`);
        return;
      }
      const blob = new Blob([bytes], { type: "application/pdf" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast(`PDF скачан · страниц: ${layout.pages.length}`);
    } catch (err) {
      toast(`Не удалось сохранить PDF: ${err.message || err}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Сохранить PDF";
      }
    }
  }

  function cssEscape(value) {
    if (window.CSS && typeof CSS.escape === "function") return CSS.escape(String(value));
    return String(value).replace(/["\\]/g, "\\$&");
  }

  /** У расхода нет скидки, оплаты и даты оплаты — очищаем, чтобы цифры не всплыли при возврате к обычному типу. */
  function resetExpenseLine(line) {
    line.discount = 0;
    line.discount_expr = "0";
    line.paid = 0;
    line.paid_expr = "0";
    line.payment_date = "";
    if (line.tax_mode == null) line.tax_mode = typeKind(line.order_type) === "tax" ? "gross" : "amount";
    if (line.tax_percent_expr == null) {
      line.tax_percent = num(line.tax_percent);
      line.tax_percent_expr = String(line.tax_percent || 0);
    }
    return line;
  }

  function addExpenseLine(order) {
    const type = typeNames("expense")[0];
    if (!type) {
      toast("Сначала отметьте тип заказа как налог или затрату в справочниках");
      return null;
    }
    const prev = (order.lines || [])[order.lines.length - 1];
    const line = resetExpenseLine(emptyLine());
    line.order_type = type;
    line.tax_mode = typeKind(type) === "tax" ? "gross" : "amount";
    line.product = "";
    line.price = 0;
    line.price_expr = "0";
    if (prev) {
      line.unit = prev.unit;
      line.order_date = prev.order_date;
    }
    order.lines.push(line);
    markDirty();
    renderOrders();
    requestAnimationFrame(() => focusLineCell(line.id, 3));
    return line;
  }

  function addOrderLine(order, afterId) {
    const line = emptyLine();
    const idx = afterId ? order.lines.findIndex((l) => l.id === afterId) : -1;
    if (idx >= 0) order.lines.splice(idx + 1, 0, line);
    else order.lines.push(line);
    markDirty();
    renderOrders();
    requestAnimationFrame(() => focusLineCell(line.id, 2));
    return line;
  }

  function focusCellElement(cell) {
    const target = cell?.querySelector("input, select");
    if (!target) return false;
    target.focus();
    try {
      target.select?.();
    } catch {
      /* ignore */
    }
    return true;
  }

  function focusLineCell(lineId, cellIndex) {
    const row = document.querySelector(`tr[data-line="${cssEscape(lineId)}"]`);
    if (!row) return;
    focusCellElement(row.children[cellIndex]);
    row.classList.add("focus-row");
    setTimeout(() => row.classList.remove("focus-row"), 900);
  }

  function moveLine(order, lineId, dir, cellIndex) {
    const i = order.lines.findIndex((l) => l.id === lineId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.lines.length) return;
    const [item] = order.lines.splice(i, 1);
    order.lines.splice(j, 0, item);
    markDirty();
    renderOrders();
    requestAnimationFrame(() => focusLineCell(lineId, cellIndex));
  }

  function copyCellFromAbove(tr, target) {
    const prev = tr.previousElementSibling;
    const lk = target.dataset?.lk;
    if (!prev || !prev.dataset.line || !lk) return false;
    const src = prev.querySelector(`[data-lk="${lk}"]`);
    if (!src) return false;
    const value = src.dataset.showing === "result" && src.dataset.expr != null ? src.dataset.expr : src.value;
    if (target.dataset.showing) target.dataset.showing = "expr";
    target.value = value;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    try {
      target.select?.();
    } catch {
      /* ignore */
    }
    return true;
  }

  const NAV_SKIP_INPUT_TYPES = new Set(["datetime-local", "date", "time", "number"]);

  function onOrderKeydown(e) {
    if (bindTextSuggestKeys(e)) return;
    const tr = e.target.closest?.("tr[data-line]");
    const td = e.target.closest?.("td");
    if (!tr || !td) return;
    const card = tr.closest("[data-order]");
    const order = findOrder(card?.dataset.order);
    if (!order) return;
    const cellIndex = [...tr.children].indexOf(td);
    const ctrl = e.ctrlKey || e.metaKey;
    const code = e.code;

    if (e.altKey && !ctrl && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      moveLine(order, tr.dataset.line, e.key === "ArrowUp" ? -1 : 1, cellIndex);
      return;
    }
    if (ctrl && e.altKey && code === "KeyD") {
      e.preventDefault();
      const idx = order.lines.findIndex((l) => l.id === tr.dataset.line);
      if (idx < 0) return;
      const copy = JSON.parse(JSON.stringify(order.lines[idx]));
      copy.id = uid();
      order.lines.splice(idx + 1, 0, copy);
      markDirty();
      renderOrders();
      requestAnimationFrame(() => focusLineCell(copy.id, cellIndex));
      return;
    }
    if (ctrl && !e.altKey && code === "KeyD") {
      e.preventDefault();
      copyCellFromAbove(tr, e.target);
      return;
    }
    if (ctrl && e.key === "Enter") {
      e.preventDefault();
      addOrderLine(order, tr.dataset.line);
      return;
    }
    if (e.key === "Enter" && !ctrl && !e.altKey) {
      e.preventDefault();
      const next = e.shiftKey ? tr.previousElementSibling : tr.nextElementSibling;
      if (next?.dataset.line) focusCellElement(next.children[cellIndex]);
      else if (!e.shiftKey) addOrderLine(order, tr.dataset.line);
      return;
    }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !ctrl && !e.altKey && !e.shiftKey) {
      if (e.target.tagName === "SELECT") return;
      if (e.target.tagName === "INPUT" && NAV_SKIP_INPUT_TYPES.has(e.target.type)) return;
      const next = e.key === "ArrowUp" ? tr.previousElementSibling : tr.nextElementSibling;
      if (next?.dataset.line && focusCellElement(next.children[cellIndex])) e.preventDefault();
    }
  }

  function flashOrder(id) {
    const card = document.querySelector(`[data-order="${cssEscape(id)}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("flash");
    setTimeout(() => card.classList.remove("flash"), 1700);
  }

  function syncSearchClear(input) {
    if (!input) return;
    const wrap = input.closest(".search, .cloud-search, .calc-search, .palette-input, .share-orders-search");
    wrap?.classList.toggle("has-value", !!String(input.value || "").length);
  }

  function clearSearchInput(input) {
    if (!input) return;
    input.value = "";
    syncSearchClear(input);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }

  function bindSearchClears() {
    document.querySelectorAll("[data-search-clear]").forEach((btn) => {
      if (btn.dataset.boundClear) return;
      btn.dataset.boundClear = "1";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const input = $(btn.dataset.searchClear) || btn.parentElement?.querySelector("input");
        clearSearchInput(input);
      });
    });
    ["global-search", "cloud-search", "palette-input", "share-orders-search"].forEach((id) => {
      const input = $(id);
      if (!input || input.dataset.boundClearSync) return;
      input.dataset.boundClearSync = "1";
      input.addEventListener("input", () => syncSearchClear(input));
      syncSearchClear(input);
    });
  }

  function gotoOrder(id) {
    state.orderFilter = "all";
    state.search = "";
    const search = $("global-search");
    if (search) search.value = "";
    syncSearchClear(search);
    setView("orders");
    requestAnimationFrame(() => flashOrder(id));
  }

  function gotoCustomer(id) {
    setView("customers");
    requestAnimationFrame(() => {
      const row = document.querySelector(`tr[data-cid="${cssEscape(id)}"]`);
      if (!row) return;
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.add("flash-row");
      setTimeout(() => row.classList.remove("flash-row"), 1700);
      row.querySelector("input")?.focus();
    });
  }

