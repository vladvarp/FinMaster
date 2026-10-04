  function chartYears(page) {
    return [...new Set(page.rows.map((r) => String(r.date || "").slice(0, 4)).filter((y) => /^\d{4}$/.test(y)))].sort();
  }

  function chartYear(page) {
    const years = chartYears(page);
    if (!years.length) return "";
    return years.includes(session.chartYear) ? session.chartYear : years[years.length - 1];
  }

  function zoomBarHtml() {
    const presets = [
      ["all", "Всё"],
      ["365", "Год"],
      ["90", "3 мес"],
      ["30", "Месяц"],
    ];
    return `<div class="vault-zoom">
        <div class="vault-zoom-presets">${presets
          .map(
            ([id, label]) =>
              `<button type="button" class="vault-chip ${session.zoomPreset === id ? "active" : ""}" data-vault-zoom="${id}">${label}</button>`
          )
          .join("")}</div>
        <span class="vault-zoom-range" id="vault-zoom-range"></span>
        <span class="vault-zoom-hint">колесо — масштаб · перетаскивание — сдвиг · двойной клик — всё</span>
      </div>`;
  }

  function yearBarHtml(page) {
    const years = chartYears(page);
    const year = chartYear(page);
    if (!years.length) return "";
    const i = years.indexOf(year);
    return `<div class="vault-zoom">
        <div class="vault-year">
          <button type="button" class="vault-year-nav" data-vault-year="prev" ${i <= 0 ? "disabled" : ""} title="Предыдущий год">‹</button>
          <b>${esc(year)}</b>
          <button type="button" class="vault-year-nav" data-vault-year="next" ${i >= years.length - 1 ? "disabled" : ""} title="Следующий год">›</button>
        </div>
        ${
          years.length > 1
            ? `<div class="vault-zoom-presets">${years
                .map((y) => `<button type="button" class="vault-chip ${y === year ? "active" : ""}" data-vault-year="${esc(y)}">${esc(y)}</button>`)
                .join("")}</div>`
            : ""
        }
      </div>`;
  }

  function chartHtml(page) {
    const open = session.chartOpen;
    const modes = [
      ["balance", "Остатки"],
      ["months", "По месяцам"],
    ];
    return `
      <div class="vault-chart-head">
        <button type="button" class="vault-chart-toggle" data-vault-chart-toggle aria-expanded="${open}">
          <span class="vault-chart-ico">${open ? "▾" : "▸"}</span> График
        </button>
        ${
          open
            ? `<div class="vault-chart-modes">
                <button type="button" class="vault-chip vault-series ${session.chartSave ? "on" : ""}" data-vault-chart-save aria-pressed="${session.chartSave}" title="Показать или скрыть копилку на графике — удобно, когда в копилке намного больше, чем на руках"><i></i>Копилка</button>
                <span class="vault-chart-sep"></span>
                ${modes
                  .map(
                    ([id, label]) =>
                      `<button type="button" class="vault-chip ${session.chartMode === id ? "active" : ""}" data-vault-chart-mode="${id}">${label}</button>`
                  )
                  .join("")}
              </div>`
            : `<span class="vault-chart-hint">${page.rows.length ? "остатки на руках и в копилке по датам" : "появится после первых строк"}</span>`
        }
      </div>
      ${
        !open
          ? ""
          : page.rows.length
            ? `${session.chartMode === "months" ? yearBarHtml(page) : zoomBarHtml()}<div class="chart-box vault-chart-box"></div>`
            : `<div class="vault-chart-empty">Добавьте строки — здесь появится график остатков.</div>`
      }`;
  }

  function shortDate(iso, withYear) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return "без даты";
    return withYear ? `${m[3]}.${m[2]}.${m[1].slice(2)}` : `${m[3]}.${m[2]}`;
  }

  function balanceSeries(page) {
    const rows = chronological(page.rows);
    const years = new Set(rows.map((r) => String(r.date || "").slice(0, 4)).filter(Boolean));
    const withYear = years.size > 1;
    const labels = [];
    const dates = [];
    const hand = [];
    const save = [];
    let h = 0;
    let s = 0;
    let lastKey = null;
    rows.forEach((row) => {
      const e = rowEffect(row);
      h += e.hand;
      s += e.save;
      const key = row.date || "";
      if (key === lastKey && labels.length) {
        hand[hand.length - 1] = h;
        save[save.length - 1] = s;
      } else {
        labels.push(shortDate(key, withYear));
        dates.push(key);
        hand.push(h);
        save.push(s);
        lastKey = key;
      }
    });
    return {
      labels,
      dates,
      datasets: [
        { label: "На руках", values: hand.map((v) => Math.round(v * 100) / 100), color: CHART_COLORS.hand, fill: true },
        { label: "В копилке", values: save.map((v) => Math.round(v * 100) / 100), color: CHART_COLORS.save, fill: true },
      ],
    };
  }

  function monthSeries(page) {
    const year = chartYear(page);
    const sums = Array.from({ length: 12 }, () => ({ in: 0, out: 0, save: 0 }));
    page.rows.forEach((row) => {
      const key = String(row.date || "");
      if (key.slice(0, 4) !== year) return;
      const m = sums[Number(key.slice(5, 7)) - 1];
      if (!m) return;
      const a = Number(row.amount) || 0;
      if (row.type === "in") m.in += Math.abs(a);
      else if (row.type === "out") m.out += Math.abs(a);
      else if (a > 0) m.save += a;
    });
    const pick = (field) => sums.map((m) => Math.round(m[field] * 100) / 100);
    return {
      labels: MONTHS_SHORT.slice(),
      legend: [
        { label: "Пополнено", color: CHART_COLORS.in },
        { label: "Потрачено", color: CHART_COLORS.out },
        { label: "Отложено", color: CHART_COLORS.save },
      ],
      datasets: [
        { label: "Пополнено", values: pick("in"), color: CHART_COLORS.in },
        { label: "Потрачено", values: pick("out"), color: CHART_COLORS.out },
        { label: "Отложено", values: pick("save"), color: CHART_COLORS.save },
      ],
    };
  }

  /** Видимый отрезок графика остатков: индексы точек from..to включительно. */
  function zoomRange(n) {
    const z = session.zoom;
    if (!z || n < 3) return { from: 0, to: Math.max(0, n - 1) };
    const span = Math.min(Math.max(2, z.to - z.from), n - 1);
    const from = Math.max(0, Math.min(z.from, n - 1 - span));
    return { from, to: from + span };
  }

  function setZoom(from, to, n) {
    if (n < 3 || (from <= 0 && to >= n - 1)) session.zoom = null;
    else session.zoom = { from, to };
  }

  function presetZoom(page, preset) {
    session.zoomPreset = preset;
    const { dates } = balanceSeries(page);
    const n = dates.length;
    const days = Number(preset);
    const dated = dates.filter(Boolean);
    const last = dated[dated.length - 1];
    if (!days || n < 3 || !last) {
      session.zoom = null;
      return;
    }
    const d = new Date(`${last}T00:00:00`);
    d.setDate(d.getDate() - days);
    const pad = (x) => String(x).padStart(2, "0");
    const edge = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    let from = dates.findIndex((iso) => !iso || iso >= edge);
    if (from < 0) from = 0;
    setZoom(Math.min(from, n - 3), n - 1, n);
  }

  function paintChart(page, canvas, { instant = false } = {}) {
    const charts = typeof FinCharts !== "undefined" ? FinCharts : window.FinCharts;
    if (!charts || !canvas) return;
    let series;
    if (session.chartMode === "months") series = monthSeries(page);
    else {
      series = balanceSeries(page);
      const n = series.labels.length;
      const { from, to } = zoomRange(n);
      series.labels = series.labels.slice(from, to + 1);
      series.datasets.forEach((ds) => (ds.values = ds.values.slice(from, to + 1)));
      const label = $("vault-zoom-range");
      if (label) {
        label.textContent = n ? `${series.labels[0]} — ${series.labels[series.labels.length - 1]} · ${to - from + 1} из ${n} точек` : "";
      }
    }
    if (!session.chartSave) {
      const keep = series.datasets.map((ds) => ds.color !== CHART_COLORS.save);
      series.datasets = series.datasets.filter((_, i) => keep[i]);
      if (series.legend) series.legend = series.legend.filter((_, i) => keep[i]);
    }
    if (session.chartMode === "months") charts.bar(canvas, { ...series, tinyLabels: true });
    else charts.line(canvas, { ...series, instant });
  }

  function syncZoomPresets() {
    document.querySelectorAll("#vault-body [data-vault-zoom]").forEach((b) => b.classList.toggle("active", b.dataset.vaultZoom === session.zoomPreset));
  }

  /** Колесо, перетаскивание и двойной клик по графику остатков. Отступы — как у FinCharts.line. */
  function bindChartCanvas(canvas) {
    if (canvas.dataset.vaultZoomBound) return;
    canvas.dataset.vaultZoomBound = "1";
    const PAD_L = 58;
    const PAD_R = 18;
    const repaint = () => {
      const page = activePage();
      if (page) paintChart(page, canvas, { instant: true });
      syncZoomPresets();
    };
    const pointCount = () => {
      const page = activePage();
      return page ? balanceSeries(page).labels.length : 0;
    };
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (session.chartMode !== "balance") return;
        const n = pointCount();
        if (n < 3) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const r = Math.min(1, Math.max(0, (e.clientX - rect.left - PAD_L) / Math.max(1, rect.width - PAD_L - PAD_R)));
        const { from, to } = zoomRange(n);
        const span = to - from;
        const next = Math.min(n - 1, Math.max(2, Math.round(span * (e.deltaY > 0 ? 1.25 : 0.8))));
        if (next === span) return;
        let nf = Math.round(from + r * span - r * next);
        nf = Math.max(0, Math.min(nf, n - 1 - next));
        setZoom(nf, nf + next, n);
        session.zoomPreset = session.zoom ? "" : "all";
        repaint();
      },
      { passive: false }
    );
    let drag = null;
    canvas.addEventListener("pointerdown", (e) => {
      if (session.chartMode !== "balance" || !session.zoom || e.button !== 0) return;
      const n = pointCount();
      drag = { x: e.clientX, n, ...zoomRange(n) };
      canvas.setPointerCapture?.(e.pointerId);
      canvas.classList.add("is-panning");
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const rect = canvas.getBoundingClientRect();
      const span = drag.to - drag.from;
      const perPoint = Math.max(1, rect.width - PAD_L - PAD_R) / Math.max(1, span);
      const nf = Math.max(0, Math.min(drag.from + Math.round((drag.x - e.clientX) / perPoint), drag.n - 1 - span));
      if (nf === zoomRange(drag.n).from) return;
      setZoom(nf, nf + span, drag.n);
      session.zoomPreset = "";
      repaint();
    });
    const stop = () => {
      drag = null;
      canvas.classList.remove("is-panning");
    };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    canvas.addEventListener("dblclick", () => {
      if (session.chartMode !== "balance") return;
      session.zoom = null;
      session.zoomPreset = "all";
      repaint();
    });
  }

