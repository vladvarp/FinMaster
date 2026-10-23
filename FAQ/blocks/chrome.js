(function () {
  var tipEl = null;
  var showTimer = 0;
  var active = null;
  var lastText = "";
  var menu = null;
  var openSelect = null;

  function migrateTitle(el) {
    if (!el || el.nodeType !== 1) return "";
    var existing = String(el.getAttribute("data-tip") || "").trim();
    var title = el.getAttribute("title");
    if (title != null && String(title).trim()) {
      var text = String(title).trim();
      if (!existing) el.setAttribute("data-tip", text);
      el.removeAttribute("title");
      return existing || text;
    }
    return existing;
  }

  function findTipTarget(start) {
    var el = start;
    var i;
    for (i = 0; i < 8 && el && el !== document.body; i += 1) {
      if (el.closest && el.closest(".ui-tip, .suggest")) return null;
      if (el.getAttribute && el.getAttribute("data-no-tip") === "1") return null;
      var text = migrateTitle(el);
      if (text) return el;
      el = el.parentElement;
    }
    return null;
  }

  function ensureTip() {
    if (tipEl) return tipEl;
    tipEl = document.createElement("div");
    tipEl.className = "ui-tip";
    tipEl.setAttribute("role", "tooltip");
    tipEl.hidden = true;
    document.body.appendChild(tipEl);
    return tipEl;
  }

  function hideTip() {
    clearTimeout(showTimer);
    showTimer = 0;
    active = null;
    lastText = "";
    if (!tipEl) return;
    tipEl.classList.remove("is-on");
    tipEl.hidden = true;
  }

  function placeTip(clientX, clientY) {
    var tip = ensureTip();
    var pad = 10;
    var rect = tip.getBoundingClientRect();
    var x = clientX + 14;
    var y = clientY + 18;
    if (x + rect.width > window.innerWidth - pad) x = clientX - rect.width - 12;
    if (y + rect.height > window.innerHeight - pad) y = clientY - rect.height - 14;
    if (x < pad) x = pad;
    if (y < pad) y = pad;
    tip.style.left = Math.round(x) + "px";
    tip.style.top = Math.round(y) + "px";
  }

  function showTip(el, clientX, clientY) {
    var text = migrateTitle(el);
    if (!text) {
      hideTip();
      return;
    }
    active = el;
    var tip = ensureTip();
    if (text !== lastText) {
      tip.textContent = text;
      lastText = text;
    }
    tip.hidden = false;
    tip.classList.add("is-on");
    placeTip(clientX, clientY);
  }

  document.addEventListener("pointerover", function (e) {
    if (e.pointerType === "touch") return;
    var target = findTipTarget(e.target);
    if (!target || target === active) return;
    clearTimeout(showTimer);
    var x = e.clientX;
    var y = e.clientY;
    showTimer = setTimeout(function () { showTip(target, x, y); }, 260);
  }, true);

  document.addEventListener("pointermove", function (e) {
    if (!active || !tipEl || tipEl.hidden) return;
    placeTip(e.clientX, e.clientY);
  }, true);

  document.addEventListener("pointerout", function (e) {
    if (!active) {
      clearTimeout(showTimer);
      return;
    }
    var related = e.relatedTarget;
    if (related && (active === related || (active.contains && active.contains(related)))) return;
    if (related && findTipTarget(related) === active) return;
    hideTip();
  }, true);

  function ensureMenu() {
    if (menu) return menu;
    menu = document.createElement("div");
    menu.className = "suggest";
    menu.hidden = true;
    menu.addEventListener("mousedown", function (e) {
      var btn = e.target.closest && e.target.closest("[data-i]");
      if (!btn || !openSelect) return;
      e.preventDefault();
      var opt = openSelect.options[Number(btn.getAttribute("data-i"))];
      if (opt) {
        openSelect.value = opt.value;
        openSelect.dispatchEvent(new Event("input", { bubbles: true }));
        openSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      closeMenu();
    });
    document.body.appendChild(menu);
    return menu;
  }

  function closeMenu() {
    if (openSelect) openSelect.classList.remove("is-suggest-open");
    openSelect = null;
    if (menu) menu.hidden = true;
    document.body.style.paddingBottom = "";
  }

  function placeMenu(select) {
    var box = ensureMenu();
    var rect = select.getBoundingClientRect();
    var left = rect.left + window.scrollX;
    var top = rect.bottom + window.scrollY + 4;
    box.style.position = "absolute";
    box.style.left = Math.round(left) + "px";
    box.style.top = Math.round(top) + "px";
    box.style.width = Math.round(rect.width) + "px";
    box.style.minWidth = Math.round(rect.width) + "px";
    box.style.zIndex = "80";
    box.hidden = false;
    var room = document.documentElement.scrollHeight - top;
    if (box.offsetHeight + 12 > room) document.body.style.paddingBottom = (box.offsetHeight + 16) + "px";
  }

  function openMenu(select) {
    if (!select || select.disabled || select.multiple) return;
    if (openSelect === select) {
      closeMenu();
      return;
    }
    closeMenu();
    var box = ensureMenu();
    box.replaceChildren();
    Array.prototype.forEach.call(select.options, function (opt, i) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "option");
      btn.setAttribute("data-i", String(i));
      btn.className = "suggest-item" + (i === select.selectedIndex ? " active" : "");
      btn.textContent = String(opt.textContent || "").trim() || opt.value;
      box.appendChild(btn);
    });
    if (!box.childElementCount) return;
    openSelect = select;
    select.classList.add("is-suggest-open");
    placeMenu(select);
  }

  document.addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    var sel = e.target.closest && e.target.closest("select");
    if (sel && !sel.disabled && !sel.multiple) {
      e.preventDefault();
      openMenu(sel);
      return;
    }
    if (menu && !menu.hidden && menu.contains(e.target)) return;
    if (openSelect) closeMenu();
  }, true);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      hideTip();
      closeMenu();
    }
  }, true);

  document.addEventListener("scroll", function () {
    hideTip();
    closeMenu();
  }, true);
  window.addEventListener("blur", function () {
    hideTip();
    closeMenu();
  });
})();
