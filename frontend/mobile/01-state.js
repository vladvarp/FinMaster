(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const LS_TOKEN = "finmaster.remote.token";
  const LS_THEME = "finmaster.mobile.theme";
  const LS_NAME = "finmaster.remote.name";
  const LS_CID = "finmaster.remote.cid";
  const LS_SNAP = "finmaster.mobile.snapshot";
  let moneyFmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const qtyFmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 3 });

  function moneyDecimals(doc) {
    const n = Number((doc || state.doc)?.money_decimals);
    return Number.isFinite(n) ? Math.max(0, Math.min(4, Math.round(n))) : 2;
  }

  function syncMoneyFmt(decimals) {
    const n = Number(decimals);
    const d = Number.isFinite(n) ? Math.max(0, Math.min(4, Math.round(n))) : 2;
    moneyFmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });
    return d;
  }

  const state = {
    token: "",
    cid: "",
    doc: null,
    version: 0,
    docVersion: 0,
    path: "",
    dirty: false,
    recent: [],
    library: { path: "", items: [] },
    listsSig: "",
    clients: [],
    history: { undo: false, redo: false, index: -1, limit: 40, items: [] },
    view: "orders",
    orderId: null,
    ordersResume: null,
    scroll: { orders: 0, stats: 0, snapshot: 0, files: 0, calendar: 0, order: {} },
    editLineId: null,
    headOpen: false,
    frozenOpen: false,
    cal: { mode: "extended", filter: "all", anchor: null },
    query: "",
    filter: "all",
    stats: { period: "all", filter: "all", status: "" },
    sort: "date-desc",
    pending: null,
    pushTimer: null,
    pushing: false,
    pinging: false,
    stopped: false,
    autosave: false,
    snap: {
      orderId: null,
      lines: null,
      fields: null,
      theme: "teal",
      hideLabels: false,
      hideStamp: false,
      title: "",
      fieldsOpen: false,
      linesOpen: false,
    },
    shareProfiles: [],
    shareProfilesSig: "",
    device: null,
    deviceFactsOpen: false,
    snapReturn: null,
    homeScreen: "",
    waitingForDoc: false,
    expectPath: "",
    offline: false,
    exprField: "",
    exprInput: null,
    exprSystemKb: false,
  };


/* bundle-seam */
})();
