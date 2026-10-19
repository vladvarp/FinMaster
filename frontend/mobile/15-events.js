/* bundle-seam */
(() => {
  /* ================= события ================= */

  function bind() {
    fillExprPad();
    let skipLineClick = false;
    bindSortable($("lines-list"), {
      handle: ".lr-drag",
      item: ".line-row",
      onCommit: () => {
        skipLineClick = true;
        commitLineOrder($("lines-list"), false);
      },
    });
    bindSortable($("costs-list"), {
      handle: ".lr-drag",
      item: ".line-row",
      onCommit: () => {
        skipLineClick = true;
        commitLineOrder($("costs-list"), true);
      },
    });

    const dockEditorToViewport = () => {
      const editor = $("editor");
      const card = editor?.querySelector(".sheet-card");
      if (!card) return;
      if (editor.hidden) {
        card.style.bottom = "";
        return;
      }
      const vv = window.visualViewport;
      if (!vv) return;
      const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      card.style.bottom = overlap ? `${overlap}px` : "";
    };
    window.visualViewport?.addEventListener("resize", dockEditorToViewport);
    window.visualViewport?.addEventListener("scroll", dockEditorToViewport);

    const orderScreen = $("screen-order");
    const snapScreen = $("screen-snapshot");
    const swipeIgnore = (el) => el.closest("input, textarea, select, button, a, .sheet, .editor, .preview-wrap");
    const editorSwipeIgnore = (el) => el.closest("input, textarea, select, button, a, .expr-pad, #ed-product-suggest");
    const bindSwipeNav = (screen, active, go, ignore = swipeIgnore) => {
      if (!screen) return;
      let swipe = null;
      screen.addEventListener(
        "touchstart",
        (e) => {
          if (!active() || e.touches.length !== 1 || ignore(e.target)) {
            swipe = null;
            return;
          }
          const t = e.touches[0];
          swipe = { x: t.clientX, y: t.clientY, at: Date.now() };
        },
        { passive: true }
      );
      screen.addEventListener(
        "touchmove",
        (e) => {
          if (!swipe || e.touches.length !== 1) {
            swipe = null;
            return;
          }
          const t = e.touches[0];
          const dx = t.clientX - swipe.x;
          const dy = t.clientY - swipe.y;
          if (Math.abs(dy) > 28 && Math.abs(dy) >= Math.abs(dx)) swipe = null;
        },
        { passive: true }
      );
      screen.addEventListener(
        "touchend",
        (e) => {
          if (!swipe) return;
          const t = e.changedTouches[0];
          const dx = t.clientX - swipe.x;
          const dy = t.clientY - swipe.y;
          const dt = Date.now() - swipe.at;
          swipe = null;
          if (dt > 650 || Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          go(dx < 0 ? 1 : -1);
        },
        { passive: true }
      );
      screen.addEventListener("touchcancel", () => {
        swipe = null;
      });
      screen.addEventListener("animationend", (e) => {
        if (e.target === screen) screen.classList.remove("swipe-next", "swipe-prev");
      });
    };
    bindSwipeNav(
      orderScreen,
      () => state.view === "order" && $("editor").hidden && $("sheet").hidden,
      showNeighborOrder
    );
    bindSwipeNav(
      snapScreen,
      () => state.view === "snapshot" && $("sheet").hidden,
      showNeighborSnap
    );
    bindSwipeNav(
      $("editor-body"),
      () => !$("editor").hidden && !!$("expr-pad")?.hidden,
      editorJump,
      editorSwipeIgnore
    );

    document.addEventListener("touchstart", (e) => {
      const input = e.target.closest("#editor-body input.expr-input");
      if (!input || state.exprSystemKb || document.activeElement === input) return;
      input.setAttribute("readonly", "readonly");
    }, true);

    document.addEventListener("focusin", (e) => {
      const product = e.target.closest('#editor-body [data-f="product"]');
      if (product) {
        fillEdProductSuggest(product.value);
        hideExprPad();
        return;
      }
      if (!e.target.closest("#ed-product-suggest")) closeEdProductSuggest();
      const input = e.target.closest("#editor-body input.expr-input");
      if (input) {
        if (state.exprField && state.exprField !== input.dataset.f) state.exprSystemKb = false;
        showExprPad(input);
        if (!state.exprSystemKb) {
          requestAnimationFrame(() => input.removeAttribute("readonly"));
        }
        return;
      }
      if (e.target.closest("#expr-pad")) return;
      if (e.target.closest("#editor") && !e.target.closest("input, select, textarea")) return;
      hideExprPad();
    });

    $("expr-pad")?.addEventListener("pointerdown", (e) => {
      const key = e.target.closest("[data-expr-op]");
      if (!key) return;
      e.preventDefault();
      applyExprToken(exprTargetInput(), key.dataset.exprOp);
    });

    $("expr-pad-hide")?.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      useSystemExprKeyboard();
    });

    document.addEventListener("input", (e) => {
      if (e.target.id === "device-name") {
        const value = e.target.value.trim();
        if (value) localStorage.setItem(LS_NAME, value);
        else localStorage.removeItem(LS_NAME);
        return;
      }
      if (e.target.id === "snap-title") {
        state.snap.title = e.target.value;
        renderSnapPreview();
        return;
      }
      if (e.target.id === "search") {
        state.query = e.target.value;
        renderOrders();
        return;
      }
      onEdit(e);
    });

    document.addEventListener("change", (e) => {
      if (e.target.id === "device-name" || e.target.id === "snap-title" || e.target.id === "search") return;
      if (e.target.dataset.calMonth != null || e.target.dataset.calYear != null) {
        if (!state.cal.anchor) state.cal.anchor = dayStart(new Date());
        const monthEl = document.querySelector("[data-cal-month]");
        const yearEl = document.querySelector("[data-cal-year]");
        const month = monthEl ? Number(monthEl.value) : state.cal.anchor.getMonth();
        const year = yearEl ? Number(yearEl.value) : state.cal.anchor.getFullYear();
        state.cal.anchor = new Date(year, month, 1);
        renderCalendar();
        return;
      }
      if (e.target.dataset.calNote != null) {
        setDayNote(e.target.dataset.calNote, e.target.value);
        touchDoc();
        pushSoon();
        if (state.view === "calendar") renderCalendar();
        return;
      }
      if (e.target.dataset.calDate) {
        const id = e.target.dataset.calWork || state.orderId;
        const order = orders().find((o) => o.id === id) || currentOrder();
        if (!order) return;
        order[e.target.dataset.calDate] = e.target.value;
        normalizeWorkDates(order);
        touchDoc();
        pushSoon();
        if (state.view === "calendar") renderCalendar();
        else renderOrder();
        toast(e.target.dataset.calDate === "work_start" ? "Начало обновлено" : "Конец обновлён");
        return;
      }
      if (e.target.id === "snap-hide-labels") {
        state.snap.hideLabels = e.target.checked;
        saveSnapPrefs();
        renderSnapPreview();
        return;
      }
      if (e.target.id === "snap-hide-stamp") {
        state.snap.hideStamp = e.target.checked;
        saveSnapPrefs();
        renderSnapPreview();
        return;
      }
      const snapLine = e.target.dataset?.snapLine;
      if (snapLine) {
        const order = snapOrder();
        if (!state.snap.lines) state.snap.lines = new Set((order?.lines || []).map((l) => l.id));
        if (e.target.checked) state.snap.lines.add(snapLine);
        else state.snap.lines.delete(snapLine);
        e.target.closest(".pick-row")?.classList.toggle("on", e.target.checked);
        const meta = $("snap-lines-meta");
        if (meta) {
          const all = snapCandidates(order);
          meta.textContent = `${snapLines(order).length} из ${all.length}`;
        }
        renderSnapPreview();
        return;
      }
      onEdit(e);
    });

    document.addEventListener("focusout", (e) => {
      const input = e.target.closest?.("#editor-body input.expr-input");
      if (input) {
        const next = e.relatedTarget;
        if (!next?.closest?.("#expr-pad")) {
          setTimeout(() => {
            if (document.activeElement === input) return;
            if (document.activeElement?.closest?.("#expr-pad")) return;
            collapseExpr(input);
          }, 0);
        }
      }
      setTimeout(flushPending, 150);
    });

    $("main").addEventListener("click", async (e) => {
      const workBtn = e.target.closest("[data-work-act]");
      if (workBtn) {
        const id = workBtn.dataset.calWork || state.orderId;
        const order = orders().find((o) => o.id === id) || currentOrder();
        if (!order) return;
        const act = workBtn.dataset.workAct;
        if (act === "clear-start" || act === "clear-end") {
          clearWorkDate(order, act === "clear-start" ? "start" : "end");
          toast(act === "clear-start" ? "Начало убрано" : "Конец убран");
        } else {
          setWorkToday(order, act);
          toast(act === "start" ? "Старт — сегодня" : "Финиш — сегодня");
        }
        touchDoc();
        pushSoon();
        if (state.view === "calendar") renderCalendar();
        else renderOrder();
        return;
      }
      const calMode = e.target.closest("[data-cal-mode]");
      if (calMode) {
        const next = calMode.dataset.calMode;
        if (next === "day" && state.cal.mode !== "day") state.cal.anchor = dayStart(new Date());
        state.cal.mode = next;
        renderCalendar();
        return;
      }
      if (e.target.closest("#mcal-hide-pause")) {
        state.cal.hidePause = state.cal.hidePause === false;
        renderCalendar();
        return;
      }
      if (e.target.closest("#btn-mcal-filter")) {
        const menu = $("mcal-filter-menu");
        const btn = $("btn-mcal-filter");
        if (!menu) return;
        const open = menu.hidden;
        menu.hidden = !open;
        btn?.setAttribute("aria-expanded", String(open));
        return;
      }
      const calFilter = e.target.closest("[data-cal-filter]");
      if (calFilter) {
        state.cal.filter = calFilter.dataset.calFilter;
        renderCalendar();
        return;
      }
      const filterMenu = $("mcal-filter-menu");
      if (filterMenu && !filterMenu.hidden && !e.target.closest(".mcal-filter")) {
        filterMenu.hidden = true;
        $("btn-mcal-filter")?.setAttribute("aria-expanded", "false");
      }
      const calNav = e.target.closest("[data-cal-nav]");
      if (calNav) {
        const dir = Number(calNav.dataset.calNav);
        if (!state.cal.anchor) state.cal.anchor = dayStart(new Date());
        if (dir === 0) state.cal.anchor = dayStart(new Date());
        else if (state.cal.mode === "classic") state.cal.anchor = new Date(state.cal.anchor.getFullYear(), state.cal.anchor.getMonth() + dir, 1);
        else if (state.cal.mode === "day") state.cal.anchor = addDays(dayStart(state.cal.anchor), dir);
        else state.cal.anchor = addDays(mondayOf(state.cal.anchor), dir * 7);
        renderCalendar();
        return;
      }
      const calDay = e.target.closest("[data-cal-day]");
      if (calDay && !e.target.closest("[data-open], textarea, .mcal-acts")) {
        state.cal.pick = state.cal.pick === calDay.dataset.calDay ? "" : calDay.dataset.calDay;
        renderCalendar();
        return;
      }
      const open = e.target.closest("[data-open]");
      if (open) {
        if (e.target.closest("button, input, label, select, textarea, a, .mcal-acts")) return;
        setView("order", open.dataset.open);
        return;
      }
      const editRow = e.target.closest("[data-edit]");
      if (editRow) {
        if (skipLineClick) {
          skipLineClick = false;
          return;
        }
        if (e.target.closest(".lr-drag")) return;
        openEditor(editRow.dataset.edit);
        return;
      }
      if (e.target.closest("#btn-m-order-filter")) {
        const menu = $("m-order-filter-menu");
        const btn = $("btn-m-order-filter");
        if (!menu) return;
        const open = menu.hidden;
        menu.hidden = !open;
        btn?.setAttribute("aria-expanded", String(open));
        return;
      }
      const chip = e.target.closest("[data-chip]");
      if (chip) {
        state.filter = chip.dataset.chip;
        renderOrders();
        return;
      }
      const orderFilterMenu = $("m-order-filter-menu");
      if (orderFilterMenu && !orderFilterMenu.hidden && !e.target.closest("#m-order-filter")) {
        orderFilterMenu.hidden = true;
        $("btn-m-order-filter")?.setAttribute("aria-expanded", "false");
      }
      const statsPeriod = e.target.closest("#stats-period");
      if (statsPeriod) {
        openStatsPeriod();
        return;
      }
      const statsFilter = e.target.closest("#stats-filter");
      if (statsFilter) {
        openStatsFilter();
        return;
      }
      const statsStatus = e.target.closest("#stats-status");
      if (statsStatus) {
        openStatsStatus();
        return;
      }
      if (e.target.closest("#order-fold")) {
        state.headOpen = !state.headOpen;
        document.querySelector("#order-head .fold")?.classList.toggle("closed", !state.headOpen);
        return;
      }
      if (e.target.closest("#frozen-toggle")) {
        state.frozenOpen = !state.frozenOpen;
        $("frozen-block")?.classList.toggle("is-open", state.frozenOpen);
        $("frozen-toggle")?.setAttribute("aria-expanded", state.frozenOpen ? "true" : "false");
        return;
      }
      if (e.target.closest("#snap-fields-fold")) {
        state.snap.fieldsOpen = !state.snap.fieldsOpen;
        e.target.closest(".fold")?.classList.toggle("closed", !state.snap.fieldsOpen);
        return;
      }
      if (e.target.closest("#snap-lines-fold")) {
        state.snap.linesOpen = !state.snap.linesOpen;
        e.target.closest(".fold")?.classList.toggle("closed", !state.snap.linesOpen);
        return;
      }
      const snapPay = e.target.closest("[data-snap-pay]");
      if (snapPay) {
        const order = snapOrder();
        const mode = snapPay.dataset.snapPay;
        const all = snapCandidates(order);
        if (mode === "all") {
          state.snap.lines = null;
        } else {
          const ids = all
            .filter((line) => {
              if (isExpenseLine(line)) return false;
              const tot = lineTotals(line, order);
              if (mode === "debt") return tot.unpaid > 0.005;
              return tot.after > 0.005 && tot.unpaid <= 0.005;
            })
            .map((line) => line.id);
          state.snap.lines = new Set(ids);
        }
        state.snap.linesOpen = true;
        renderSnapshot();
        return;
      }
      const preset = e.target.closest("[data-preset]");
      if (preset) {
        state.snap.fields = (SNAP_PRESETS[preset.dataset.preset] || SNAP_PRESETS.invoice).slice();
        saveSnapPrefs();
        renderSnapshot();
        return;
      }
      const profileBtn = e.target.closest("[data-snap-profile]");
      if (profileBtn) {
        const profile = state.shareProfiles[Number(profileBtn.dataset.snapProfile)];
        if (!profile) return;
        state.snap.fields = profile.fields.slice();
        state.snap.hideLabels = !!profile.hideLabels;
        state.snap.hideStamp = !!profile.hideStamp;
        saveSnapPrefs();
        renderSnapshot();
        return;
      }
      const field = e.target.closest("[data-field]");
      if (field) {
        const id = field.dataset.field;
        state.snap.fields = state.snap.fields.includes(id)
          ? state.snap.fields.filter((f) => f !== id)
          : state.snap.fields.concat([id]);
        field.classList.toggle("active");
        saveSnapPrefs();
        // Список позиций зависит от поля «Налоги и затраты» — его нужно пересобрать.
        if (id === "expenses") renderSnapshot();
        else renderSnapPreview();
        return;
      }
      const themeBtn = e.target.closest("[data-snap-theme]");
      if (themeBtn) {
        state.snap.theme = themeBtn.dataset.snapTheme;
        saveSnapPrefs();
        renderSnapshot();
        return;
      }
      if (e.target.closest("#snap-order")) {
        openSheet(
          "Какой заказ показать",
          orders()
            .slice()
            .reverse()
            .map((o) => ({
              label: `${o.number || "—"} · ${o.name || "без названия"}`,
              hint: `${o.customer || "без заказчика"} · ${money(orderTotals(o).after)}`,
              value: o.id,
            })),
          snapOrder()?.id,
          (item) => {
            state.snap.orderId = item.value;
            state.snap.lines = null;
            state.snap.linesOpen = false;
            renderSnapshot();
          }
        );
        return;
      }
      if (e.target.closest("#snap-share")) {
        snapShare();
        return;
      }
      if (e.target.closest("#snap-download")) {
        snapDownload();
        return;
      }
      if (e.target.closest("#snap-text")) {
        snapCopyText();
        return;
      }
      const openFile = e.target.closest("[data-open-file]");
      if (openFile) {
        const path = openFile.dataset.openFile;
        if (await command("open", { path })) {
          toast("Открываю на компьютере…");
          await waitForOpenedReport(path);
        }
        return;
      }
      const delFile = e.target.closest("[data-delete-file]");
      if (delFile) {
        const path = delFile.dataset.deleteFile;
        const name = String(path || "").split(/[\\/]/).pop() || "отчёт";
        if (!confirm(`Удалить «${name}» из папки FinMaster? Файл попадёт в корзину на компьютере.`)) return;
        try {
          const res = await api("/api/remote/command", {
            method: "POST",
            body: JSON.stringify({ type: "delete", path }),
          });
          if (typeof res.version === "number") state.version = res.version;
          if (res.library) state.library = res.library;
          if (res.recent) state.recent = res.recent;
          if (res.closed) {
            state.doc = null;
            state.path = "";
            state.waitingForDoc = true;
          }
          renderFiles();
          toast("Отчёт удалён");
        } catch (err) {
          toast(`Не удалось: ${err.message || err}`);
        }
        return;
      }
      if (e.target.closest("#cmd-save")) {
        await push();
        if (await command("save")) toast("Компьютер сохраняет отчёт…");
        return;
      }
      if (e.target.closest("#cmd-new")) {
        await createNewReport();
        return;
      }
      if (e.target.closest("#device-info")) {
        state.deviceFactsOpen = !state.deviceFactsOpen;
        const box = $("device-facts");
        if (box) {
          box.hidden = !state.deviceFactsOpen;
          box.innerHTML = deviceFactsHtml();
        }
        return;
      }
      if (e.target.closest("#cmd-fullscreen")) {
        await toggleFullscreen();
        renderFiles();
        return;
      }
      if (e.target.closest("#cmd-homescreen")) {
        addToHomeScreen();
        return;
      }
      if (e.target.closest("#cmd-copy-link")) {
        copyLink();
        return;
      }
      if (e.target.closest("#cmd-leave")) {
        state.stopped = true;
        api("/api/remote/leave", { method: "POST", body: JSON.stringify({ cid: state.cid }) }).catch(() => {});
        localStorage.removeItem(LS_TOKEN);
        blocked("Отключено", "Чтобы подключиться снова, откройте закладку или отсканируйте QR-код.");
      }
    });

    $("editor").addEventListener("pointerdown", (e) => {
      const pickProduct = e.target.closest("[data-pick-product]");
      if (pickProduct) {
        e.preventDefault();
        const inp = document.querySelector('#editor-body [data-f="product"]');
        if (inp) {
          inp.value = pickProduct.textContent;
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          inp.dispatchEvent(new Event("change", { bubbles: true }));
        }
        closeEdProductSuggest();
        return;
      }
      if (!e.target.closest('#editor-body [data-f="product"]') && !e.target.closest("#ed-product-suggest")) {
        closeEdProductSuggest();
      }
    });

    document.addEventListener("focusout", (e) => {
      if (!e.target.closest?.('#editor-body [data-f="product"]')) return;
      requestAnimationFrame(() => {
        if (document.activeElement?.closest?.("#ed-product-suggest, #editor-body [data-f='product']")) return;
        closeEdProductSuggest();
      });
    });

    $("editor").addEventListener("click", (e) => {
      if (e.target.closest("[data-close-editor]") || e.target.closest("#ed-done")) {
        closeEditor();
        return;
      }
      const order = currentOrder();
      const line = findLine(order, state.editLineId);
      if (!line) return;

      const taxMode_ = e.target.closest("[data-tax-mode]");
      if (taxMode_) {
        line.tax_mode = taxMode_.dataset.taxMode;
        if (line.tax_percent_expr == null) {
          line.tax_percent = 0;
          line.tax_percent_expr = "0";
        }
        touchDoc();
        pushSoon();
        renderEditor();
        renderOrder();
        return;
      }
      const disc = e.target.closest("[data-discount]");
      if (disc) {
        setLineNumber(line, "discount_expr", Number(disc.dataset.discount));
        touchDoc();
        pushSoon();
        renderEditor();
        refreshOrderRow(line.id);
        return;
      }
      const paid = e.target.closest("[data-paid]");
      if (paid) {
        const t = lineTotals(line);
        const value = paid.dataset.paid === "full" ? t.after : paid.dataset.paid === "half" ? round2(t.after / 2) : 0;
        setLineNumber(line, "paid_expr", value);
        if (paid.dataset.paid === "full") autoPaidStatus(line);
        touchDoc();
        pushSoon();
        renderEditor();
        refreshOrderRow(line.id);
        return;
      }
      const status = e.target.closest("[data-pick-status]");
      if (status) {
        line.status = status.dataset.pickStatus;
        document.querySelectorAll("[data-pick-status]").forEach((b) => b.classList.toggle("active", b === status));
        touchDoc();
        pushSoon();
        refreshOrderRow(line.id);
        return;
      }
      const now = e.target.closest("[data-now]");
      if (now) {
        line[now.dataset.now] = localStamp(new Date());
        const inp = document.querySelector(`input[data-l="${CSS.escape(line.id)}"][data-f="${now.dataset.now}"]`);
        if (inp) inp.value = line[now.dataset.now];
        touchDoc();
        pushSoon();
        return;
      }
      if (e.target.closest("#ed-prev")) {
        editorJump(-1);
        return;
      }
      if (e.target.closest("#ed-next")) {
        editorJump(1);
        return;
      }
      if (e.target.closest("#ed-freeze")) {
        line.frozen = !isFrozenLine(line);
        touchDoc();
        pushSoon();
        closeEditor();
        toast(line.frozen ? "Позиция заморожена" : "Позиция снова в заказе");
        return;
      }
      if (e.target.closest("#ed-dup")) {
        const copy = { ...line, id: uid(), frozen: false };
        const index = order.lines.findIndex((l) => l.id === line.id);
        order.lines.splice(index + 1, 0, copy);
        touchDoc();
        pushSoon();
        state.editLineId = copy.id;
        renderOrder();
        renderEditor();
        toast("Позиция продублирована");
        return;
      }
      if (e.target.closest("#ed-del")) {
        if ((order.lines || []).length <= 1) {
          toast("В заказе должна остаться хотя бы одна позиция");
          return;
        }
        if (!confirm("Удалить эту позицию?")) return;
        order.lines = order.lines.filter((l) => l.id !== line.id);
        touchDoc();
        pushSoon();
        closeEditor();
        toast("Позиция удалена");
      }
    });

    $("btn-add-order").addEventListener("click", () => {
      if (!state.doc) return;
      const order = emptyOrder();
      state.doc.orders = orders().concat([order]);
      touchDoc();
      pushSoon();
      state.headOpen = true;
      setView("order", order.id);
      toast("Заказ создан");
    });

    $("btn-add-line").addEventListener("click", () => {
      const order = currentOrder();
      if (!order) return;
      const line = emptyLine();
      order.lines = (order.lines || []).concat([line]);
      touchDoc();
      pushSoon();
      renderOrder();
      openEditor(line.id);
    });

    $("btn-add-cost")?.addEventListener("click", () => {
      const order = currentOrder();
      const type = typeNames("expense")[0];
      if (!order) return;
      if (!type) {
        toast("Отметьте тип заказа как налог или затрату на компьютере");
        return;
      }
      const line = resetExpenseLine(emptyLine());
      line.order_type = type;
      line.tax_mode = typeKind(type) === "tax" ? "gross" : "amount";
      line.price = 0;
      line.price_expr = "0";
      order.lines = (order.lines || []).concat([line]);
      touchDoc();
      pushSoon();
      renderOrder();
      openEditor(line.id);
    });

    $("btn-dup-order").addEventListener("click", () => {
      const order = currentOrder();
      if (!order) return;
      const copy = {
        ...JSON.parse(JSON.stringify(order)),
        id: uid(),
        number: nextOrderNumber(),
        created_at: localDateTimeStamp(new Date()),
      };
      copy.lines = (copy.lines || []).map((l) => ({ ...l, id: uid() }));
      state.doc.orders = orders().concat([copy]);
      touchDoc();
      pushSoon();
      setView("order", copy.id);
      toast("Заказ скопирован");
    });

    $("btn-order-snapshot").addEventListener("click", () => {
      state.snap.orderId = state.orderId;
      state.snap.lines = null;
      state.snap.linesOpen = false;
      openSnapshot();
    });

    $("btn-del-order").addEventListener("click", () => {
      const order = currentOrder();
      if (!order) return;
      if (!confirm(`Удалить заказ ${order.number}?`)) return;
      state.doc.orders = orders().filter((o) => o.id !== order.id);
      touchDoc();
      pushSoon();
      setView("orders");
      toast("Заказ удалён");
    });

    $("btn-back").addEventListener("click", goBack);

    $("btn-sort").addEventListener("click", () => {
      openSheet("Сортировка заказов", SORT_OPTIONS, state.sort, (item) => {
        state.sort = item.value;
        renderOrders();
      });
    });

    $("btn-undo").addEventListener("click", async () => {
      setSync("warn", "отменяю на компьютере…");
      if (await command("undo")) state.history = { ...state.history, undo: false };
      updateHead();
    });

    $("btn-redo").addEventListener("click", async () => {
      setSync("warn", "возвращаю действие…");
      if (await command("redo")) state.history = { ...state.history, redo: false };
      updateHead();
    });

    $("btn-menu").addEventListener("click", openMenu);

    $("tabbar").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-tab]");
      if (!btn) return;
      const tab = btn.dataset.tab;
      if (tab === "orders" && state.view === "order") return;
      if (tab === "files") refreshRecent();
      if (tab === "snapshot") rememberSnapReturn();
      else state.snapReturn = null;
      if (tab === "orders") {
        resumeOrdersTab();
        return;
      }
      setView(tab);
    });

    $("btn-retry").addEventListener("click", () => {
      unblocked();
      boot();
    });

    $("sheet").addEventListener("click", (e) => {
      if (e.target.closest("[data-close-sheet]")) {
        closeSheet();
        return;
      }
      const hist = e.target.closest("[data-history-id]");
      if (hist) {
        command("history_jump", { id: hist.dataset.historyId });
        return;
      }
      const menu = e.target.closest("[data-menu]");
      if (menu) {
        $("sheet")._menu?.(menu.dataset.menu);
        return;
      }
      const pick = e.target.closest("[data-pick]");
      if (pick) $("sheet")._pick?.(Number(pick.dataset.pick));
    });

    const onFullscreen = () => {
      if (state.view === "files") renderFiles();
      renderMenu();
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("webkitfullscreenchange", onFullscreen);

    window.addEventListener("beforeunload", () => {
      if (state.pushTimer) {
        navigator.sendBeacon?.(
          `/api/remote/push?t=${encodeURIComponent(state.token)}`,
          new Blob([JSON.stringify({ document: state.doc, cid: state.cid })], { type: "application/json" })
        );
      }
    });
    window.addEventListener("pagehide", () => {
      if (!state.token || !state.cid || !state.stopped) return;
      navigator.sendBeacon?.(
        `/api/remote/leave?t=${encodeURIComponent(state.token)}`,
        new Blob([JSON.stringify({ cid: state.cid })], { type: "application/json" })
      );
    });

    window.addEventListener("resize", () => {
      if (state.view === "orders") tuneStatusDots();
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && !state.stopped) {
        refreshRecent();
        navReport();
      }
    });
  }

  const savedTheme = localStorage.getItem(LS_THEME);
  document.documentElement.setAttribute(
    "data-theme",
    savedTheme || (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  );

  loadSnapPrefs();
  initTelegram();
  bind();
  boot();
})();
