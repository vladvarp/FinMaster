  /* ================= утилиты ================= */

  let sleepWake = null;
  const sleep = (ms) => new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (sleepWake === resolve) sleepWake = null;
      resolve();
    }, ms);
    sleepWake = () => {
      clearTimeout(timer);
      sleepWake = null;
      resolve();
    };
  });
  function wakeSleep() {
    sleepWake?.();
  }

  function sameFile(a, b) {
    const n = (p) => String(p || "").replace(/\//g, "\\").toLowerCase();
    return !!a && !!b && n(a) === n(b);
  }

  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  const round2 = (n) => {
    const v = Number(n);
    return Number.isFinite(v) ? Number(v.toFixed(2)) : 0;
  };
  const EXPR_MIRROR = {
    qty_expr: "quantity",
    price_expr: "price",
    discount_expr: "discount",
    paid_expr: "paid",
    tax_percent_expr: "tax_percent",
  };
  const TAX_MODES = [
    ["gross", "% от выручки"],
    ["net", "% от выручки − затраты"],
    ["amount", "Своя сумма"],
  ];

  function isFormula(expr) {
    return /[+\-*/()×xX÷]/.test(String(expr || ""));
  }

  function isBareZeroExpr(value) {
    return /^0([.,]0+)?$/.test(String(value || "").trim());
  }

  function stripLeadingZerosPlain(raw) {
    const text = String(raw ?? "").replaceAll(",", ".");
    if (!text || isFormula(text)) return String(raw ?? "");
    const m = /^(-?)0+(\d+(?:\.\d*)?)$/.exec(text);
    return m ? m[1] + m[2] : text;
  }

  function formatExprResult(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "0";
    return v.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  }

  function exprRaw(line, field) {
    const raw = line[field];
    if (raw != null && String(raw).trim() !== "") return String(raw);
    const numKey = EXPR_MIRROR[field];
    return String((numKey && line[numKey]) ?? "");
  }

  function shownExprValue(line, field) {
    const expr = exprRaw(line, field);
    const v = evalExpr(expr);
    const tail = /\.\d{3,}/.test(String(expr).replaceAll(",", "."));
    if (Number.isFinite(v) && (isFormula(expr) || tail)) return formatExprResult(v);
    return expr;
  }

  function evalExpr(raw) {
    const s = String(raw ?? "").trim().replaceAll("×", "*").replaceAll("÷", "/").replaceAll(",", ".");
    if (!s) return 0;
    const normalized = s.replace(/(\d)\s*[xX]\s*(\d)/g, "$1*$2");
    if (!/^[\d+\-*/().\s]+$/.test(normalized)) return NaN;
    try {
      const value = Function(`"use strict"; return (${normalized});`)();
      return typeof value === "number" && Number.isFinite(value) ? value : NaN;
    } catch {
      return NaN;
    }
  }

  function numExpr(line, exprKey, numKey) {
    const raw = line[exprKey] != null && String(line[exprKey]).trim() !== "" ? line[exprKey] : line[numKey];
    const v = evalExpr(raw);
    return Number.isFinite(v) ? v : num(line[numKey]);
  }

