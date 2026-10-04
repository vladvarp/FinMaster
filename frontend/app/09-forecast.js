/* bundle-seam */
(() => {
  /* ==== Прогнозирование: месяцы и годы вперёд ==== */

  const FORECAST_MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const FORECAST_PERIOD = 12;
  const FORECAST_MODEL_COLORS = ["#c9a227", "#7c3aed", "#0891b2", "#db2777", "#ea580c", "#16a34a", "#64748b", "#0ea5e9"];
  const forecastUi = { metric: "revenue", horizon: 12, series: "ensemble" };

  function forecastAvg(values) {
    if (!values.length) return 0;
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[i];
    return sum / values.length;
  }

  function forecastStdev(values) {
    if (values.length < 2) return 0;
    const mid = forecastAvg(values);
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += (values[i] - mid) * (values[i] - mid);
    return Math.sqrt(sum / (values.length - 1));
  }

  function forecastMedian(values) {
    const sorted = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function forecastSmape(actual, pred) {
    const n = Math.min(actual.length, pred.length);
    if (!n) return 1;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const denom = Math.abs(actual[i]) + Math.abs(pred[i]);
      sum += denom < 1e-9 ? 0 : (2 * Math.abs(actual[i] - pred[i])) / denom;
    }
    return sum / n;
  }

  function forecastClip(values, allowNegative) {
    return values.map((v) => {
      if (!Number.isFinite(v)) return 0;
      return allowNegative ? v : Math.max(0, v);
    });
  }

  function forecastRound(values) {
    return values.map((v) => round2(v));
  }

  function forecastMonthShift(ym, delta) {
    const [year, month] = ym.split("-").map(Number);
    const date = new Date(year, month - 1 + delta, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function forecastMonthLabel(ym) {
    const [year, month] = ym.split("-").map(Number);
    return `${FORECAST_MONTHS[month - 1] || ym} ${String(year).slice(2)}`;
  }

  function forecastTodayMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  function forecastMonthComplete(ym) {
    const now = new Date();
    const current = forecastTodayMonth();
    if (ym < current) return true;
    if (ym > current) return false;
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return now.getDate() >= last;
  }

  function forecastSeasonalFactors(values, period) {
    const empty = Array(period).fill(0);
    if (values.length < period) return empty;
    const trend = Array(values.length).fill(null);
    if (period % 2 === 0 && values.length >= period + 2) {
      const half = period / 2;
      for (let t = half; t < values.length - half; t++) {
        let sum = 0;
        for (let i = t - half; i <= t + half; i++) {
          const weight = i === t - half || i === t + half ? 0.5 : 1;
          sum += weight * values[i];
        }
        trend[t] = sum / period;
      }
    }
    const buckets = Array.from({ length: period }, () => []);
    let used = 0;
    for (let t = 0; t < values.length; t++) {
      if (trend[t] == null) continue;
      buckets[t % period].push(values[t] - trend[t]);
      used += 1;
    }
    if (used < period) {
      const plain = Array.from({ length: period }, () => []);
      values.forEach((value, index) => plain[index % period].push(value));
      const grand = forecastAvg(values);
      return plain.map((bucket) => (bucket.length ? forecastAvg(bucket) - grand : 0));
    }
    const raw = buckets.map((bucket) => (bucket.length ? forecastAvg(bucket) : 0));
    const shift = forecastAvg(raw);
    return raw.map((value) => value - shift);
  }

  function forecastSes(values, alpha) {
    let level = values[0];
    let sse = 0;
    const errors = [];
    for (let t = 1; t < values.length; t++) {
      const err = values[t] - level;
      errors.push(err);
      sse += err * err;
      level = alpha * values[t] + (1 - alpha) * level;
    }
    return { level, sse, errors };
  }

  function forecastSesPoint(level, horizon) {
    return Array(horizon).fill(level);
  }

  function forecastHolt(values, alpha, beta, phi) {
    let level = values[0];
    let trend = values.length > 1 ? values[1] - values[0] : 0;
    let sse = 0;
    const errors = [];
    for (let t = 1; t < values.length; t++) {
      const pred = level + phi * trend;
      const err = values[t] - pred;
      errors.push(err);
      sse += err * err;
      const next = alpha * values[t] + (1 - alpha) * pred;
      trend = beta * (next - level) + (1 - beta) * phi * trend;
      level = next;
      if (!Number.isFinite(level) || !Number.isFinite(trend)) return null;
    }
    return { level, trend, sse, errors };
  }

  function forecastHoltPoint(state, horizon, phi) {
    const out = [];
    let grown = 0;
    for (let step = 1; step <= horizon; step++) {
      grown += Math.pow(phi, step);
      out.push(state.level + state.trend * grown);
    }
    return out;
  }

  function forecastBest(cands) {
    let best = null;
    cands.forEach((item) => {
      if (!item || !Number.isFinite(item.sse)) return;
      if (!best || item.sse < best.sse) best = item;
    });
    return best;
  }

  function forecastTheta(values, horizon) {
    const alphas = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8];
    const drift = values.length > 1 ? (values[values.length - 1] - values[0]) / (values.length - 1) : 0;
    const best = forecastBest(alphas.map((alpha) => forecastSes(values, alpha)));
    if (!best) return null;
    const point = [];
    for (let step = 1; step <= horizon; step++) point.push(best.level + (drift * step) / 2);
    return { point, errors: best.errors, sse: best.sse };
  }

  function forecastSeasonalTheta(values, period, horizon) {
    const factors = forecastSeasonalFactors(values, period);
    const flat = values.map((value, index) => value - factors[index % period]);
    const model = forecastTheta(flat, horizon);
    if (!model) return null;
    model.point = model.point.map((value, index) => value + factors[(values.length + index) % period]);
    return model;
  }

  function forecastNaive(values, horizon) {
    return Array(horizon).fill(values[values.length - 1]);
  }

  function forecastDrift(values, horizon) {
    const slope = values.length > 1 ? (values[values.length - 1] - values[0]) / (values.length - 1) : 0;
    return Array.from({ length: horizon }, (_, index) => values[values.length - 1] + slope * (index + 1));
  }

  function forecastSeasonalNaive(values, period, horizon) {
    const out = [];
    for (let step = 1; step <= horizon; step++) out.push(values[values.length - period + ((step - 1) % period)]);
    return out;
  }

  function forecastHoltWinters(values, period, horizon, multiplicative) {
    if (values.length < period * 2) return null;
    if (multiplicative && values.some((value) => value <= 0)) return null;
    const alphas = [0.2, 0.4, 0.6, 0.8];
    const betas = [0.05, 0.15, 0.3];
    const gammas = [0.05, 0.2, 0.4];
    let best = null;
    alphas.forEach((alpha) => {
      betas.forEach((beta) => {
        gammas.forEach((gamma) => {
          const fitted = forecastHwFit(values, period, alpha, beta, gamma, multiplicative);
          if (!fitted) return;
          if (!best || fitted.sse < best.sse) best = fitted;
        });
      });
    });
    if (!best) return null;
    const point = [];
    for (let step = 1; step <= horizon; step++) {
      const season = best.season[(values.length + step - 1) % period];
      const level = best.level + step * best.trend;
      point.push(multiplicative ? level * (season || 1) : level + season);
    }
    if (point.some((value) => !Number.isFinite(value))) return null;
    return { point, errors: best.errors, sse: best.sse };
  }

  function forecastHwFit(values, period, alpha, beta, gamma, multiplicative) {
    const avg = forecastAvg(values.slice(0, period));
    if (multiplicative && Math.abs(avg) < 1e-9) return null;
    const season = [];
    for (let i = 0; i < period; i++) season.push(multiplicative ? values[i] / avg : values[i] - avg);
    let level = avg;
    let trend = values.length >= period * 2 ? (forecastAvg(values.slice(period, period * 2)) - avg) / period : 0;
    let sse = 0;
    const errors = [];
    for (let t = period; t < values.length; t++) {
      const prev = season[t % period];
      const pred = multiplicative ? (level + trend) * (prev || 1) : level + trend + prev;
      if (!Number.isFinite(pred)) return null;
      const err = values[t] - pred;
      errors.push(err);
      sse += err * err;
      const next = multiplicative
        ? alpha * (values[t] / (prev || 1)) + (1 - alpha) * (level + trend)
        : alpha * (values[t] - prev) + (1 - alpha) * (level + trend);
      trend = beta * (next - level) + (1 - beta) * trend;
      season[t % period] = multiplicative
        ? gamma * (values[t] / (next || 1)) + (1 - gamma) * prev
        : gamma * (values[t] - next) + (1 - gamma) * prev;
      level = next;
      if (!Number.isFinite(level) || !Number.isFinite(trend)) return null;
    }
    return { level, trend, season, sse, errors };
  }

  function forecastDampedHolt(values, horizon) {
    const alphas = [0.2, 0.4, 0.6, 0.8];
    const betas = [0.05, 0.15, 0.3];
    const phis = [0.8, 0.9, 0.98];
    let best = null;
    let phi = 0.9;
    alphas.forEach((alpha) => {
      betas.forEach((beta) => {
        phis.forEach((nextPhi) => {
          const fitted = forecastHolt(values, alpha, beta, nextPhi);
          if (!fitted) return;
          if (!best || fitted.sse < best.sse) {
            best = fitted;
            phi = nextPhi;
          }
        });
      });
    });
    if (!best) return null;
    return { point: forecastHoltPoint(best, horizon, phi), errors: best.errors, sse: best.sse };
  }

  function forecastSesModel(values, horizon) {
    const best = forecastBest([0.1, 0.2, 0.3, 0.4, 0.6, 0.8].map((alpha) => forecastSes(values, alpha)));
    if (!best) return null;
    return { point: forecastSesPoint(best.level, horizon), errors: best.errors, sse: best.sse };
  }

  function forecastSane(point, values) {
    const cap = Math.max(1, ...values.map((value) => Math.abs(value))) * 8;
    return point.every((value) => Number.isFinite(value) && Math.abs(value) <= cap);
  }

  function forecastCandidates(values, period, horizon) {
    const models = [];
    const push = (id, name, model) => {
      if (!model || !model.point || !forecastSane(model.point, values)) return;
      models.push({ id, name, point: model.point.slice(), errors: model.errors || [], sse: model.sse });
    };
    push("naive", "Наивный", { point: forecastNaive(values, horizon), errors: [], sse: 0 });
    if (values.length > 2) push("drift", "Дрейф", { point: forecastDrift(values, horizon), errors: [], sse: 0 });
    push("ses", "Экспоненциальное сглаживание", forecastSesModel(values, horizon));
    push("holt", "Хольт, затухающий тренд", forecastDampedHolt(values, horizon));
    push("theta", "Тета", forecastTheta(values, horizon));
    if (values.length >= period) {
      push("snaive", "Сезонный наивный", { point: forecastSeasonalNaive(values, period, horizon), errors: [], sse: 0 });
    }
    if (values.length >= period * 2) {
      push("stheta", "Тета с сезоном", forecastSeasonalTheta(values, period, horizon));
      push("hw", "Хольт–Уинтерс", forecastHoltWinters(values, period, horizon, false));
      push("hwm", "Хольт–Уинтерс, доля сезона", forecastHoltWinters(values, period, horizon, true));
    }
    return models;
  }

  function forecastHoldout(length, period) {
    if (length < 8) return 0;
    const want = length >= period * 2 ? Math.min(period, 12) : Math.min(6, Math.floor(length / 3));
    return length - want >= 6 ? want : 0;
  }

  function forecastMedianPath(paths) {
    const horizon = paths[0]?.length || 0;
    const out = [];
    for (let index = 0; index < horizon; index++) out.push(forecastMedian(paths.map((path) => path[index])));
    return out;
  }

  function forecastSeries(values, horizon, period, allowNegative) {
    const hold = forecastHoldout(values.length, period);
    const scored = new Map();
    if (hold) {
      const train = values.slice(0, values.length - hold);
      const actual = values.slice(values.length - hold);
      forecastCandidates(train, period, hold).forEach((model) => {
        scored.set(model.id, forecastSmape(actual, forecastClip(model.point, allowNegative)));
      });
    }
    const fitted = forecastCandidates(values, period, horizon).map((model) => ({
      ...model,
      point: forecastRound(forecastClip(model.point, allowNegative)),
      smape: scored.has(model.id) ? scored.get(model.id) : null,
    }));
    const ranked = fitted
      .filter((model) => model.smape != null)
      .slice()
      .sort((a, b) => a.smape - b.smape);
    const bestScore = ranked.length ? ranked[0].smape : null;
    const pool = (ranked.length ? ranked.filter((model) => model.smape <= bestScore * 1.35 + 0.02) : fitted).slice(0, 5);
    const source = pool.length ? pool : fitted;
    const ensemble = forecastRound(forecastClip(forecastMedianPath(source.map((model) => model.point)), allowNegative));
    const best = ranked[0] || fitted[0];
    const sigma = best ? forecastStdev(best.errors || []) : 0;
    const low = [];
    const high = [];
    for (let index = 0; index < horizon; index++) {
      const spread = sigma * 1.28155 * Math.sqrt(index + 1);
      const peers = source.map((model) => model.point[index]);
      let lo = Math.min(ensemble[index] - spread, ...peers);
      let hi = Math.max(ensemble[index] + spread, ...peers);
      if (!allowNegative) lo = Math.max(0, lo);
      if (hi < lo) hi = lo;
      low.push(round2(lo));
      high.push(round2(hi));
    }
    const ensembleSmape = hold
      ? forecastSmape(
          values.slice(values.length - hold),
          forecastClip(forecastMedianPath(forecastCandidates(values.slice(0, values.length - hold), period, hold).filter((model) => source.some((item) => item.id === model.id)).map((model) => model.point)), allowNegative)
        )
      : null;
    return { models: fitted, ensemble, low, high, hold, ensembleSmape, picked: source.map((model) => model.name) };
  }

  function forecastCollect() {
    const buckets = new Map();
    (state.doc?.orders || []).forEach((order) => {
      (order.lines || []).forEach((line) => {
        if (isFrozenLine(line)) return;
        const day = dateDay(line.order_date) || orderNewestStamp(order);
        if (!day || day.length < 7) return;
        const key = day.slice(0, 7);
        const totals = lineTotals(line, order);
        const row = buckets.get(key) || { revenue: 0, paid: 0, cost: 0 };
        if (totals.expense) row.cost += totals.cost;
        else {
          row.revenue += totals.after;
          row.paid += totals.paid;
        }
        buckets.set(key, row);
      });
    });
    return buckets;
  }

  function forecastHistory(metric) {
    const buckets = forecastCollect();
    const keys = [...buckets.keys()].sort();
    if (!keys.length) return { months: [], values: [], partial: false };
    let end = keys[keys.length - 1];
    const current = forecastTodayMonth();
    let partial = false;
    if (end >= current && !forecastMonthComplete(current)) {
      const previous = forecastMonthShift(current, -1);
      if (keys[0] <= previous) {
        end = previous;
        partial = true;
      }
    }
    const start = keys[0] > end ? end : keys[0];
    const months = [];
    const values = [];
    for (let key = start; key <= end; key = forecastMonthShift(key, 1)) {
      const row = buckets.get(key) || { revenue: 0, paid: 0, cost: 0 };
      months.push(key);
      const net = row.revenue - row.cost;
      values.push(round2(metric === "paid" ? row.paid : metric === "cost" ? row.cost : metric === "net" ? net : row.revenue));
      if (key === end) break;
    }
    return { months, values, partial };
  }

  function forecastSum(values) {
    return round2(values.reduce((sum, value) => sum + (Number(value) || 0), 0));
  }

  function forecastMetricMeta(id) {
    if (id === "paid") return { label: "Оплаты", allowNegative: false };
    if (id === "cost") return { label: "Затраты", allowNegative: false };
    if (id === "net") return { label: "Чистыми", allowNegative: true };
    return { label: "Выручка", allowNegative: false };
  }

  function forecastEmpty(text) {
    $("forecast-kpi").innerHTML = `<div class="empty" style="grid-column:1/-1">${esc(text)}</div>`;
    $("forecast-years").innerHTML = "";
    $("forecast-models").innerHTML = "";
    $("forecast-legend").innerHTML = "";
    $("forecast-note").textContent = "";
    FinCharts.line($("chart-forecast"), { labels: [], datasets: [] });
  }

  function forecastYearRows(months, point, low, high) {
    const rows = new Map();
    months.forEach((month, index) => {
      const year = month.slice(0, 4);
      const row = rows.get(year) || { year, point: 0, low: 0, high: 0, count: 0 };
      row.point += point[index] || 0;
      row.low += low[index] || 0;
      row.high += high[index] || 0;
      row.count += 1;
      rows.set(year, row);
    });
    return [...rows.values()];
  }

  function renderForecast() {
    const metric = forecastUi.metric;
    const horizon = forecastUi.horizon;
    const meta = forecastMetricMeta(metric);
    const metricBox = $("forecast-metric");
    const horizonBox = $("forecast-horizon");
    if (metricBox) metricBox.value = metric;
    if (horizonBox) horizonBox.value = String(horizon);
    const history = forecastHistory(metric);
    if (history.values.length < 3) {
      forecastEmpty("Нужно хотя бы три месяца с заказами. Прогноз строится по датам позиций в этом отчёте.");
      return;
    }
    const result = forecastSeries(history.values, horizon, FORECAST_PERIOD, meta.allowNegative);
    const future = [];
    for (let step = 1; step <= horizon; step++) future.push(forecastMonthShift(history.months[history.months.length - 1], step));
    const shownHistory = history.months.slice(-36);
    const shownValues = history.values.slice(-36);
    const labels = shownHistory.map(forecastMonthLabel).concat(future.map(forecastMonthLabel));
    const fact = shownValues.concat(future.map(() => null));
    const lead = shownValues.length ? shownValues[shownValues.length - 1] : null;
    const pad = shownValues.slice(0, -1).map(() => null);
    const lineOf = (tail) => pad.concat(lead == null ? tail : [lead].concat(tail));
    const rankedModels = result.models.slice().sort((a, b) => (a.smape ?? 9) - (b.smape ?? 9));
    const choices = [{ id: "ensemble", name: "Ансамбль", color: "#2563eb", point: result.ensemble }].concat(
      rankedModels.map((model, index) => ({
        id: model.id,
        name: model.name,
        color: FORECAST_MODEL_COLORS[index % FORECAST_MODEL_COLORS.length],
        point: model.point,
      }))
    );
    if (!choices.some((item) => item.id === forecastUi.series)) forecastUi.series = "ensemble";
    const selected = choices.find((item) => item.id === forecastUi.series) || choices[0];
    const showBand = selected.id === "ensemble";
    const datasets = [
      { values: fact, color: "#0f766e", label: "Факт", fill: true },
      { values: lineOf(selected.point), color: selected.color, label: selected.name, dashed: true, fill: false },
    ];
    if (showBand) {
      datasets.push(
        { values: lineOf(result.low), color: "#94a3b8", label: "Нижняя граница", dashed: true, fill: false },
        { values: lineOf(result.high), color: "#94a3b8", label: "Верхняя граница", dashed: true, fill: false }
      );
    }
    FinCharts.line($("chart-forecast"), { labels, datasets });
    $("forecast-legend").innerHTML = choices
      .map(
        (item) =>
          `<button type="button" class="chart-leg ${item.id === selected.id ? "on" : ""}" data-forecast-series="${esc(item.id)}" title="Показать на графике">
            <i style="background:${item.color}"></i>${esc(item.name)}
          </button>`
      )
      .join("");
    const activePoint = selected.point;
    const next = activePoint[0] || 0;
    const yearSum = forecastSum(activePoint.slice(0, Math.min(12, activePoint.length)));
    const past = forecastSum(history.values.slice(-Math.min(12, history.values.length)));
    const growth = Math.abs(past) > 0.005 ? (yearSum - past) / Math.abs(past) : null;
    const horizonSum = forecastSum(activePoint);
    $("forecast-kpi").innerHTML = `
      <div class="kpi">
        <div class="label">Ближайший месяц</div>
        <div class="value">${esc(money(next))}</div>
        <div class="sub">${esc(forecastMonthLabel(future[0]))}</div>
      </div>
      <div class="kpi">
        <div class="label">Ближайшие 12 месяцев</div>
        <div class="value">${esc(money(yearSum))}</div>
        <div class="sub">${growth == null ? "прошлого года для сравнения нет" : `${growth >= 0 ? "+" : ""}${Math.round(growth * 100)}% к прошлым ${Math.min(12, history.values.length)} мес.`}</div>
      </div>
      <div class="kpi">
        <div class="label">Весь горизонт</div>
        <div class="value">${esc(money(horizonSum))}</div>
        <div class="sub">${horizon} мес.${showBand ? ` · коридор ${esc(money(forecastSum(result.low)))} … ${esc(money(forecastSum(result.high)))}` : ""}</div>
      </div>
      <div class="kpi">
        <div class="label">История</div>
        <div class="value">${history.values.length}</div>
        <div class="sub">${esc(forecastMonthLabel(history.months[0]))} — ${esc(forecastMonthLabel(history.months[history.months.length - 1]))}</div>
      </div>`;
    const years = forecastYearRows(future, activePoint, showBand ? result.low : activePoint, showBand ? result.high : activePoint);
    $("forecast-years").innerHTML = `<table class="data"><thead><tr><th>Год</th><th class="num">Прогноз</th><th class="num">Коридор</th><th class="num">Месяцев</th></tr></thead><tbody>${years
      .map(
        (row) => `<tr><td>${esc(row.year)}</td><td class="num">${esc(money(row.point))}</td><td class="num">${showBand ? `${esc(money(row.low))} … ${esc(money(row.high))}` : "—"}</td><td class="num">${row.count}</td></tr>`
      )
      .join("")}</tbody></table>`;
    const score = (value) => (value == null ? "—" : `${(value * 100).toFixed(1)}%`);
    const modelRow = (id, name, sum, smape) =>
      `<tr class="${id === selected.id ? "is-on" : ""}" data-forecast-series="${esc(id)}"><td>${id === "ensemble" ? `<b>${esc(name)}</b>` : esc(name)}</td><td class="num">${esc(money(sum))}</td><td class="num">${esc(score(smape))}</td></tr>`;
    const body = rankedModels
      .map((model) => modelRow(model.id, model.name, forecastSum(model.point), model.smape))
      .join("");
    $("forecast-models").innerHTML = `<table class="data"><thead><tr><th>Модель</th><th class="num">Сумма горизонта</th><th class="num">sMAPE</th></tr></thead><tbody>
      ${modelRow("ensemble", "Ансамбль", forecastSum(result.ensemble), result.ensembleSmape)}
      ${body}</tbody></table>`;
    const checked = result.hold ? `Проверка на последних ${result.hold} мес.` : "Ряд короткий, проверка на хвосте недоступна.";
    const partial = history.partial ? " Текущий неполный месяц в обучение не входит." : "";
    $("forecast-note").textContent = `${checked}${partial} Медиана моделей: ${result.picked.slice(0, 4).join(", ")}.`;
    $("forecast-chart-sub").textContent = showBand
      ? `${meta.label.toLowerCase()} · ансамбль и коридор. Кнопки над графиком переключают модель`
      : `${meta.label.toLowerCase()} · ${selected.name}`;
  }

  function bindForecast() {
    $("forecast-metric")?.addEventListener("change", (event) => {
      forecastUi.metric = event.target.value || "revenue";
      if (state.view === "forecast") renderForecast();
    });
    $("forecast-horizon")?.addEventListener("change", (event) => {
      const next = Number(event.target.value);
      forecastUi.horizon = [6, 12, 24, 36, 60].includes(next) ? next : 12;
      if (state.view === "forecast") renderForecast();
    });
    $("view-forecast")?.addEventListener("click", (event) => {
      const pick = event.target.closest("[data-forecast-series]");
      if (!pick) return;
      forecastUi.series = pick.dataset.forecastSeries || "ensemble";
      renderForecast();
    });
  }

  if (typeof document !== "undefined") bindForecast();
})();
