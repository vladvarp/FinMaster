  function ensureMarkModal() {
    if ($("mark-modal")) return;
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "mark-modal";
    modal.innerHTML = `<div class="modal-card planner-modal mark-modal" role="dialog" aria-label="Чертёж">
      <div class="planner-head">
        <div class="planner-layout-control" id="mark-layout-control">
          <button type="button" class="planner-layout-trigger" id="mark-layout-trigger" aria-haspopup="true" aria-expanded="false">Чертёж</button>
          <div class="planner-layout-menu" id="mark-layout-menu" role="menu" hidden></div>
        </div>
        <input id="mark-title" class="planner-title" maxlength="48" spellcheck="false" aria-label="Имя" />
        <button type="button" class="btn" id="mark-reset">Сброс</button>
        <button type="button" class="btn primary" id="mark-close">Готово</button>
      </div>
      <div class="planner-body">
        <div class="planner-stage">
          <div class="planner-cap" id="mark-cap">Пол</div>
          <div class="planner-plan-wrap">
            ${editorSnapControls("mark")}
            <canvas id="mark-canvas"></canvas>
            <div class="planner-clip">
              <div class="mark-paste-wrap">
                <button type="button" class="planner-clip-btn" id="mark-paste" title="Вставить" aria-label="Вставить" aria-haspopup="true" aria-expanded="false" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h8v2h2a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2V5z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 5.5h6V7H9z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></button>
                <div class="mark-paste-menu" id="mark-paste-menu" hidden>
                  <button type="button" data-mark-paste="add">Добавить</button>
                  <button type="button" data-mark-paste="replace">Заменить</button>
                </div>
              </div>
              <button type="button" class="planner-clip-btn" id="mark-copy" title="Копировать" aria-label="Копировать"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
            </div>
            <div id="mark-menu" class="mark-menu" hidden>
              <div id="mark-arrows" class="planner-nudge">
                <button type="button" class="planner-nudge-dir" data-dir="nw" aria-label="Вверх-влево"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
                <button type="button" class="planner-nudge-dir" data-dir="n" aria-label="Вверх"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
                <button type="button" class="planner-nudge-dir" data-dir="ne" aria-label="Вверх-вправо"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
                <button type="button" class="planner-nudge-dir" data-dir="w" aria-label="Влево"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
                <button type="button" class="planner-nudge-dir" data-dir="e" aria-label="Вправо"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
                <button type="button" class="planner-nudge-dir" data-dir="sw" aria-label="Вниз-влево"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
                <button type="button" class="planner-nudge-dir" data-dir="s" aria-label="Вниз"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
                <button type="button" class="planner-nudge-dir" data-dir="se" aria-label="Вниз-вправо"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
              </div>
              <form id="mark-nudge-box" class="planner-nudge-box" hidden>
                <input id="mark-nudge-input" inputmode="decimal" autocomplete="off" placeholder="0" aria-label="Сдвиг, метры" />
                <span>м</span>
                <button type="submit" aria-label="Сдвинуть"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8.2 6.4 11.4 12.8 4.6"/></svg></button>
              </form>
              <div id="mark-menu-card" class="mark-menu-card"></div>
            </div>
          </div>
          <div class="planner-hint" id="mark-hint"></div>
          <div class="calc-film-label" id="mark-film-label" hidden></div>
          <div class="mark-film" id="mark-film"></div>
          <div id="mark-common" class="common-stage" hidden></div>
        </div>
        <div class="planner-side" id="mark-side"></div>
      </div>
    </div>`;
    document.body.appendChild(modal);
    bindEditorSnap(modal, "mark");
    const preset = document.createElement("div");
    preset.className = "modal";
    preset.id = "mark-preset-modal";
    preset.innerHTML = `<div class="modal-card mark-preset-card" role="dialog" aria-label="Предустановки"><div class="planner-head"><strong>Предустановки</strong><button type="button" class="btn primary" id="mark-preset-close">Готово</button></div><div id="mark-preset-body"></div></div>`;
    document.body.appendChild(preset);
    preset.addEventListener("click", (e) => {
      const pickBtn = e.target.closest(".mark-select-btn");
      if (pickBtn) {
        e.preventDefault();
        placeMarkList(pickBtn);
        return;
      }
      const opt = e.target.closest(".mark-opt");
      if (opt) {
        const box = opt.closest(".mark-select");
        const hidden = box?.querySelector('input[type="hidden"]');
        if (hidden) hidden.value = opt.dataset.opt || "";
        const face = box?.querySelector(".mark-select-btn");
        if (face) face.textContent = opt.textContent || "";
        box?.querySelectorAll(".mark-select-list").forEach((el) => { el.hidden = true; });
        const form = opt.closest("form");
        if (form) refreshPresetDraft(form);
        const shapeId = opt.dataset.presetShape;
        if (shapeId) {
          patchPreset("light", shapeId, { shape: opt.dataset.opt || "circle" });
          refreshPresetRow(opt.closest(".mark-preset-row"));
          markCommit(false);
        }
        return;
      }
      const delCustom = e.target.closest("[data-del-custom]");
      if (delCustom) {
        dropPreset(delCustom.dataset.delCustom === "light" ? "light" : "socket", delCustom.dataset.customId);
        const body = $("mark-preset-body");
        if (body) body.innerHTML = markPresetHtml();
        markCommit(true);
        return;
      }
      if (!e.target.closest(".mark-select")) document.querySelectorAll("#mark-preset-modal .mark-select-list").forEach((el) => { el.hidden = true; });
      if (e.target === preset || e.target.closest("#mark-preset-close")) preset.classList.remove("open");
    });
    preset.addEventListener("input", (e) => {
      const form = e.target.closest?.("form.mark-custom");
      if (form) refreshPresetDraft(form);
      const kind = e.target.dataset?.presetKind === "light" ? "light" : "socket";
      const nameId = e.target.dataset?.presetName;
      if (nameId) {
        const name = String(e.target.value || "").trim().slice(0, 32);
        if (name) patchPreset(kind, nameId, { name });
        markCommit(false);
        return;
      }
      const lettersId = e.target.dataset?.presetLetters;
      if (lettersId) {
        const letters = markLetters(e.target.value);
        if (letters) {
          patchPreset("socket", lettersId, { letters });
          refreshPresetRow(e.target.closest(".mark-preset-row"));
          markCommit(false);
        }
        return;
      }
      const colorId = e.target.dataset?.presetColor;
      if (colorId) {
        patchPreset(kind, colorId, { color: e.target.value });
        refreshPresetRow(e.target.closest(".mark-preset-row"));
        markCommit(false);
        return;
      }
      const sizeId = e.target.dataset?.presetSize;
      if (sizeId) {
        const size = plannerDraft(e.target.value);
        if (size == null) return;
        patchPreset(kind, sizeId, { size });
        refreshPresetRow(e.target.closest(".mark-preset-row"));
        markCommit(false);
      }
    });
    preset.addEventListener("dragstart", (e) => {
      const handle = e.target.closest?.(".mark-drag");
      const row = handle?.closest(".mark-preset-row");
      if (!handle || !row) {
        e.preventDefault();
        return;
      }
      preset.dataset.dragId = row.dataset.presetId || "";
      preset.dataset.dragKind = row.dataset.presetKind || "";
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", preset.dataset.dragId);
      row.classList.add("is-drag");
    });
    preset.addEventListener("dragover", (e) => {
      const row = e.target.closest?.(".mark-preset-row");
      if (!row || !preset.dataset.dragId || row.dataset.presetKind !== preset.dataset.dragKind) return;
      e.preventDefault();
      const box = row.getBoundingClientRect();
      const before = e.clientY < box.top + box.height / 2;
      preset.querySelectorAll(".mark-preset-row").forEach((el) => el.classList.remove("is-before", "is-after"));
      row.classList.add(before ? "is-before" : "is-after");
      preset.dataset.dragBefore = before ? "1" : "0";
      preset.dataset.dragOver = row.dataset.presetId || "";
    });
    preset.addEventListener("drop", (e) => {
      const kind = preset.dataset.dragKind === "light" ? "light" : "socket";
      const id = preset.dataset.dragId;
      const target = preset.dataset.dragOver;
      if (id && target) movePreset(kind, id, target, preset.dataset.dragBefore !== "0");
      preset.querySelectorAll(".mark-preset-row").forEach((el) => el.classList.remove("is-drag", "is-before", "is-after"));
      delete preset.dataset.dragId;
      delete preset.dataset.dragKind;
      delete preset.dataset.dragOver;
      const body = $("mark-preset-body");
      if (body) body.innerHTML = markPresetHtml();
      markCommit(false);
      e.preventDefault();
    });
    preset.addEventListener("dragend", () => {
      preset.querySelectorAll(".mark-preset-row").forEach((el) => el.classList.remove("is-drag", "is-before", "is-after"));
      delete preset.dataset.dragId;
      delete preset.dataset.dragKind;
    });
    preset.addEventListener("submit", (e) => onMarkCustom(e));
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeMark();
    });
    $("mark-reset")?.addEventListener("click", async () => {
      const node = markNode();
      if (!node) return;
      const ok = api?.confirm
        ? await api.confirm({
            title: "Сбросить ноду?",
            text: node.type === "openings"
              ? "Все добавленные проёмы и пользовательские счётчики будут удалены."
              : "Все добавленные розетки, рамки и светильники будут удалены.",
            ok: "Сбросить",
            danger: true,
          })
        : true;
      if (!ok || !markNode()) return;
      if (node.type === "openings") {
        node.holes = [];
        node.owns = [];
      } else {
        node.fixtures = [];
      }
      session.mark.sel = "";
      session.mark.guides = null;
      markHideMenu();
      markCommit(true);
    });
    $("mark-close")?.addEventListener("click", () => closeMark());
    $("mark-copy")?.addEventListener("click", () => markCopy());
    $("mark-paste")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = $("mark-paste-menu");
      const btn = $("mark-paste");
      if (!menu || btn?.hidden) return;
      const opening = menu.hidden;
      menu.hidden = !opening;
      btn?.setAttribute("aria-expanded", String(opening));
    });
    $("mark-paste-menu")?.addEventListener("click", (e) => {
      const choice = e.target.closest("[data-mark-paste]");
      if (!choice) return;
      const menu = $("mark-paste-menu");
      if (menu) menu.hidden = true;
      $("mark-paste")?.setAttribute("aria-expanded", "false");
      markPaste(choice.dataset.markPaste === "replace" ? "replace" : "add");
    });
    $("mark-layout-trigger")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = $("mark-layout-menu");
      if (!menu) return;
      const opening = menu.hidden;
      menu.hidden = !opening;
      $("mark-layout-trigger")?.setAttribute("aria-expanded", String(opening));
    });
    $("mark-layout-menu")?.addEventListener("click", (e) => {
      const option = e.target.closest("[data-mark-feed-choice]");
      const node = markNode();
      if (!option || !node || !session.mark) return;
      const value = option.dataset.markFeedChoice;
      if (value === COMMON_VIEW) session.mark.view = COMMON_VIEW;
      else {
        session.mark.view = "";
        session.mark.feed = value;
        session.mark.surface = "floor";
        session.mark.sel = "";
      }
      $("mark-layout-menu").hidden = true;
      $("mark-layout-trigger")?.setAttribute("aria-expanded", "false");
      markCommit(true);
    });
    $("mark-modal")?.addEventListener("click", (e) => {
      if (!e.target.closest(".mark-paste-wrap")) {
        const pasteMenu = $("mark-paste-menu");
        if (pasteMenu) pasteMenu.hidden = true;
        $("mark-paste")?.setAttribute("aria-expanded", "false");
      }
      if (e.target.closest("#mark-layout-control")) return;
      const menu = $("mark-layout-menu");
      if (menu) menu.hidden = true;
      $("mark-layout-trigger")?.setAttribute("aria-expanded", "false");
    });
    bindCommonStage("mark-common", () => markNode(), () => markCommit(true));
    bindCommonDrag("mark-side", () => markNode(), () => markCommit(true));
    $("mark-title")?.addEventListener("input", (e) => {
      const node = markNode();
      if (!node) return;
      node.name = String(e.target.value || "").trim().slice(0, 48);
      const card = document.querySelector(`[data-mark-title="${cssEsc(node.id)}"]`);
      if (card) card.value = node.name;
    });
    $("mark-title")?.addEventListener("change", () => markCommit(false));
    $("mark-canvas")?.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const ctx = markContext();
      const canvas = $("mark-canvas");
      if (!ctx || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      const hit = markHit(ctx, e.clientX - rect.left, e.clientY - rect.top);
      markShowMenu(e.clientX, e.clientY, hit);
    });
    $("mark-canvas")?.addEventListener("wheel", (e) => {
      const ctx = markContext();
      const canvas = $("mark-canvas");
      if (!ctx || !canvas || !session.mark) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const view = markViewOf(canvas, ctx);
      const world = view?.kind === "wall" ? view.from(sx, sy) : view?.view.from(sx, sy);
      if (!world) return;
      const cam = markCamera();
      cam.k = Math.max(0.2, Math.min(12, cam.k * (e.deltaY > 0 ? 1 / 1.12 : 1.12)));
      const next = markViewOf(canvas, ctx);
      const spot = next.kind === "wall" ? next.toAlong(world.along, world.rise) : next.view.to(world);
      cam.x += sx - spot.x;
      cam.y += sy - spot.y;
      markDraw();
    }, { passive: false });
    $("mark-canvas")?.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      const ctx = markContext();
      const canvas = $("mark-canvas");
      if (!ctx || !canvas || !session.mark) return;
      markHideMenu();
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = markHit(ctx, x, y);
      if (e.button === 1 || (!hit && e.button === 0)) {
        const cam = markCamera();
        session.mark.drag = { pan: true, x: e.clientX, y: e.clientY, ox: cam.x, oy: cam.y };
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = "grabbing";
        return;
      }
      if (e.button !== 0) return;
      session.mark.sel = hit || "";
      if (hit && ctx.node.type === "openings") {
        const hole = ctx.node.holes.find((item) => item.id === hit);
        const live = hole ? resolveHole(hole, ctx.base, ctx.node, ctx.graph.values) : null;
        const box = live ? markHoleScreen(live, session.mark.view) : null;
        const edge = box ? markEdgeAt(box, x, y) : "";
        const world = markWorld(x, y);
        if (edge && world && hole) {
          session.mark.drag = {
            id: hit,
            mode: edge,
            pointer: world,
            along: hole.along,
            rise: hole.rise,
            w: hole.w,
            h: hole.h,
            x: hole.x,
            y: hole.y,
            d: hole.d,
          };
          markDraw();
          return;
        }
      }
      if (hit) {
        session.mark.drag = { id: hit, x: e.clientX, y: e.clientY };
        markDraw();
      } else markFill();
    });
    $("mark-canvas")?.addEventListener("pointermove", (e) => {
      const drag = session.mark?.drag;
      const node = markNode();
      if (drag?.pan && session.mark) {
        const cam = markCamera();
        cam.x = drag.ox + (e.clientX - drag.x);
        cam.y = drag.oy + (e.clientY - drag.y);
        markDraw();
        return;
      }
      if (!drag || !node) return;
      const canvas = $("mark-canvas");
      const rect = canvas.getBoundingClientRect();
      const world = markWorld(e.clientX - rect.left, e.clientY - rect.top);
      if (!world) return;
      if (node.type === "openings") {
        const hole = node.holes.find((item) => item.id === drag.id);
        if (!hole) return;
        if (drag.mode) {
          markResize(hole, drag, world);
          markDraw();
          return;
        }
        if (hole.surface === "wall") {
          if (hole.shape === "circle") {
            hole.along = world.along;
            hole.rise = world.rise;
          } else {
            hole.along = world.along - hole.w / 2;
            hole.rise = world.rise - hole.h / 2;
          }
        } else if (hole.shape === "circle") {
          hole.x = world.x;
          hole.y = world.y;
        } else {
          hole.x = world.x - hole.w / 2;
          hole.y = world.y - hole.h / 2;
        }
      } else {
        const fix = node.fixtures.find((item) => item.id === drag.id);
        if (!fix) return;
        if (fix.surface === "wall") {
          fix.along = world.along;
          fix.rise = world.rise;
        } else {
          fix.x = world.x;
          fix.y = world.y;
        }
      }
      const view = session.mark.view;
      const movedHole = node.type === "openings" ? node.holes.find((item) => item.id === drag.id) : null;
      const movedFix = node.type === "electrics" ? node.fixtures.find((item) => item.id === drag.id) : null;
      if (movedHole) {
        session.mark.guides = view.kind === "wall"
          ? { x: movedHole.shape === "circle" ? movedHole.along : movedHole.along + movedHole.w / 2, y: movedHole.shape === "circle" ? movedHole.rise : movedHole.rise + movedHole.h / 2 }
          : { x: movedHole.shape === "circle" ? movedHole.x : movedHole.x + movedHole.w / 2, y: movedHole.shape === "circle" ? movedHole.y : movedHole.y + movedHole.h / 2 };
      } else if (movedFix) {
        session.mark.guides = view.kind === "wall"
          ? { x: movedFix.along, y: movedFix.rise }
          : { x: movedFix.x, y: movedFix.y };
      }
      markDraw();
    });
    window.addEventListener("pointerup", () => {
      if (!session.mark?.drag) return;
      const wasPan = !!session.mark.drag.pan;
      session.mark.drag = null;
      session.mark.guides = null;
      const canvas = $("mark-canvas");
      if (canvas) canvas.style.cursor = "";
      if (wasPan) markDraw();
      else markCommit(true);
    });
    $("mark-menu")?.addEventListener("contextmenu", (e) => e.preventDefault());
    $("mark-arrows")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-dir]");
      const menu = session.mark?.menu;
      if (!btn || !menu?.hitId || !session.mark) return;
      session.mark.nudgeDir = btn.dataset.dir;
      $("mark-arrows")?.querySelectorAll("[data-dir]").forEach((el) => el.classList.toggle("is-on", el === btn));
      const box = $("mark-nudge-box");
      if (box) {
        box.hidden = false;
        $("mark-nudge-input")?.focus();
      }
    });
    $("mark-nudge-box")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const node = markNode();
      const menu = session.mark?.menu;
      const dir = session.mark?.nudgeDir;
      const value = plannerDraft($("mark-nudge-input")?.value);
      const ok = !!(node && menu?.hitId && dir && value != null && markShift(node, menu.hitId, dir, value));
      $("mark-nudge-box")?.classList.toggle("is-bad", !ok);
      if (ok) markCommit(true);
    });
    $("mark-menu-card")?.addEventListener("click", (e) => {
      const delCustom = e.target.closest("[data-del-custom]");
      if (delCustom) {
        dropPreset(delCustom.dataset.delCustom === "light" ? "light" : "socket", delCustom.dataset.customId);
        markCommit(true);
        return;
      }
      const btn = e.target.closest("[data-mark-act]");
      const node = markNode();
      const menu = session.mark?.menu;
      if (!btn || !node || !menu) return;
      const act = btn.dataset.markAct;
      if (act === "flip") {
        const fix = node.fixtures.find((item) => item.id === menu.hitId);
        if (fix && fix.kind !== "light") fix.orient = fix.orient === "v" ? "h" : "v";
        markShowMenu(menu.x + $("mark-canvas").getBoundingClientRect().left, menu.y + $("mark-canvas").getBoundingClientRect().top, menu.hitId);
        markCommit(true);
        return;
      }
      if (act === "spin" || act === "angle") {
        const fix = node.fixtures.find((item) => item.id === menu.hitId);
        if (fix && lightRotates(lightById(fix.light)?.shape)) {
          if (act === "spin") fix.angle = (lightAngle(fix) + 45) % 360;
          else {
            const value = plannerDraft(btn.parentElement?.querySelector("[data-menu-angle]")?.value);
            if (value == null) return;
            fix.angle = lightAngle({ angle: value });
          }
        }
        markShowMenu(menu.x + $("mark-canvas").getBoundingClientRect().left, menu.y + $("mark-canvas").getBoundingClientRect().top, menu.hitId);
        markCommit(true);
        return;
      }
      if (act === "orient") {
        session.mark.orient = btn.dataset.orient === "v" ? "v" : "h";
        if (menu.hitId) {
          const fix = node.fixtures.find((item) => item.id === menu.hitId);
          if (fix && fix.kind !== "light") fix.orient = session.mark.orient;
        }
        markShowMenu(menu.x + $("mark-canvas").getBoundingClientRect().left, menu.y + $("mark-canvas").getBoundingClientRect().top, menu.hitId);
        if (menu.hitId) markCommit(true);
        return;
      }
      if (act === "sec") {
        const fix = menu.hitId ? node.fixtures.find((item) => item.id === menu.hitId) : null;
        const step = Number(btn.dataset.step || 0);
        if (fix && fix.kind !== "light" && session.mark.hitCell != null) {
          const next = plannerClamp(fix.cells.length + step, 1, 6);
          while (fix.cells.length < next) fix.cells.push(fix.cells[fix.cells.length - 1] || "socket");
          while (fix.cells.length > next) fix.cells.pop();
          if (session.mark.hitCell >= fix.cells.length) session.mark.hitCell = fix.cells.length - 1;
          markShowMenu(menu.x + $("mark-canvas").getBoundingClientRect().left, menu.y + $("mark-canvas").getBoundingClientRect().top, menu.hitId);
          markCommit(true);
          return;
        }
        session.mark.section = plannerClamp((session.mark.section || 1) + step, 1, 6);
        markShowMenu(menu.x + $("mark-canvas").getBoundingClientRect().left, menu.y + $("mark-canvas").getBoundingClientRect().top, menu.hitId);
        return;
      }
      if (act === "swap") {
        const fix = node.fixtures.find((item) => item.id === menu.hitId);
        const index = session.mark.hitCell;
        if (fix && index != null && fix.cells[index] != null) fix.cells[index] = btn.dataset.type;
        markHideMenu();
        markCommit(true);
        return;
      }
      if (act === "swap-light") {
        const fix = node.fixtures.find((item) => item.id === menu.hitId);
        if (fix) {
          fix.light = btn.dataset.type || fix.light;
          const shape = lightById(fix.light)?.shape;
          if (shape === "rect" && !(fix.lw > 0)) fix.lw = 0.6;
          if (shape === "line" && !(fix.ll > 0.2)) fix.ll = 1.2;
        }
        markHideMenu();
        markCommit(true);
        return;
      }
      if (act === "presets") {
        const body = $("mark-preset-body");
        if (body) body.innerHTML = markPresetHtml();
        $("mark-preset-modal")?.classList.add("open");
        markHideMenu();
        return;
      }
      if (act === "rect") markPlace(node, menu.world, { shape: "rect" });
      else if (act === "circle") markPlace(node, menu.world, { shape: "circle", d: 0.11 });
      else if (act === "dia") markPlace(node, menu.world, { shape: "circle", d: Number(btn.dataset.mm) / 1000 });
      else if (act === "socket") markPlace(node, menu.world, { kind: "socket", type: btn.dataset.type });
      else if (act === "light") markPlace(node, menu.world, { kind: "light", light: btn.dataset.type });
      markHideMenu();
      markCommit(true);
    });
    $("mark-film")?.addEventListener("wheel", (e) => {
      const film = e.currentTarget;
      if (!(film instanceof HTMLElement) || film.scrollWidth <= film.clientWidth + 4) return;
      e.preventDefault();
      film.scrollLeft += e.deltaY + e.deltaX;
    }, { passive: false });
    $("mark-film")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-mark-surface]");
      const node = markNode();
      if (!btn || !node || !session.mark) return;
      const ctx = markContext();
      session.mark.surface = markSurfaceOk(ctx?.base, btn.dataset.markSurface);
      node.view = session.mark.surface;
      session.mark.sel = "";
      markHideMenu();
      markCommit(true);
    });
    $("mark-side")?.addEventListener("click", (e) => {
      const node = markNode();
      if (!node) return;
      const hit = handleCommonClick(e, node);
      if (hit === "stay") return;
      if (hit) {
        markCommit(true);
        return;
      }
      const pickBtn = e.target.closest(".mark-select-btn");
      if (pickBtn) {
        e.preventDefault();
        placeMarkList(pickBtn);
        return;
      }
      const opt = e.target.closest(".mark-opt");
      if (opt) {
        const box = opt.closest(".mark-select");
        const hidden = box?.querySelector('input[type="hidden"]');
        const value = opt.dataset.opt || "";
        if (hidden) hidden.value = value;
        box?.querySelectorAll(".mark-select-list").forEach((el) => {
          el.hidden = true;
        });
        const variable = opt.dataset.holeVar;
        if (variable && node.type === "openings") {
          const field = opt.dataset.bind;
          const port = `b:${variable}:${field}`;
          if (!value) disconnectInput(node.id, port);
          else {
            const [from, fromPort] = value.split("\t");
            connect(from, fromPort, node.id, port);
          }
          markFill();
          return;
        }
        const orient = opt.dataset.orient;
        if (orient) {
          const fix = node.fixtures.find((item) => item.id === orient);
          if (fix) fix.orient = value === "v" ? "v" : "h";
          markCommit(true);
          return;
        }
        const cell = opt.dataset.cell;
        if (cell) {
          const fix = node.fixtures.find((item) => item.id === cell);
          const index = Number(opt.dataset.cellI);
          if (fix && fix.cells[index] != null) fix.cells[index] = value;
          markCommit(true);
          return;
        }
        const light = opt.dataset.light;
        if (light) {
          const fix = node.fixtures.find((item) => item.id === light);
          if (fix) fix.light = value;
          markCommit(true);
        }
        return;
      }
      if (!e.target.closest(".mark-select")) {
        document.querySelectorAll("#mark-side .mark-select-list").forEach((el) => {
          el.hidden = true;
        });
      }
      const bulk = e.target.closest("[data-mark-bulk]");
      if (bulk && node.type === "openings") {
        const plan = markContext()?.base;
        const walls = plan ? plannerWalls(plan) : [];
        const on = bulk.dataset.markBulk.endsWith("on");
        if (!node.outOn) node.outOn = {};
        const feed = markContext()?.feed || node.feeds?.[0];
        if (!feed) return;
        if (bulk.dataset.markBulk.startsWith("walls")) walls.forEach((wall) => { node.outOn[feedKey(feed, "wall", wall.id)] = on; });
        else ["pick", "door", "window", "pipe", "hatch"].forEach((key) => { node.outOn[feedKey(feed, "count", key)] = on; });
        markCommit(true);
        return;
      }
      const ownAdd = e.target.closest("[data-own-add]");
      if (ownAdd && node.type === "openings") {
        if (!Array.isArray(node.owns)) node.owns = [];
        node.owns.push({ id: uid(), name: "Свой", holes: [] });
        markCommit(true);
        return;
      }
      const ownDel = e.target.closest("[data-own-del]");
      if (ownDel && node.type === "openings") {
        node.owns = (node.owns || []).filter((own) => own.id !== ownDel.dataset.ownDel);
        markCommit(true);
        return;
      }
      const ownGroupToggle = e.target.closest("[data-own-group-toggle]");
      if (ownGroupToggle && node.type === "openings") {
        const own = (node.owns || []).find((item) => item.id === ownGroupToggle.dataset.ownGroupOwn);
        if (!own) return;
        if (!Array.isArray(own.holes)) own.holes = [];
        const groupKey = ownGroupToggle.dataset.ownGroupKey;
        const ctx = markContext();
        if (!ctx?.base || !ctx.graph) return;
        const groupIds = node.holes.filter((hole) => {
          if (ctx.feed && hole.feed !== ctx.feed.id) return false;
          const live = resolveHole(hole, ctx.base, node, ctx.graph.values);
          const key = live.surface === "wall" ? `wall:${live.wallId}` : live.surface;
          return key === groupKey;
        }).map((hole) => hole.id);
        const hasAny = groupIds.some((id) => own.holes.includes(id));
        own.holes = hasAny
          ? own.holes.filter((id) => !groupIds.includes(id))
          : [...new Set(own.holes.concat(groupIds))];
        markCommit(true);
        return;
      }
      const ownBox = e.target.closest("[data-own-hole]");
      if (ownBox && node.type === "openings") {
        const own = (node.owns || []).find((item) => item.id === ownBox.dataset.own);
        if (!own) return;
        if (!Array.isArray(own.holes)) own.holes = [];
        const id = ownBox.dataset.ownHole;
        own.holes = ownBox.checked ? own.holes.concat(own.holes.includes(id) ? [] : [id]) : own.holes.filter((item) => item !== id);
        markCommit(true);
        return;
      }
      const mmBtn = e.target.closest("[data-hole-mm]");
      if (mmBtn && node.type === "openings") {
        const hole = node.holes.find((item) => item.id === mmBtn.dataset.holeMm);
        if (hole && !hole.bind?.d) {
          hole.d = plannerRound(Number(mmBtn.dataset.mm) / 1000);
          hole.shape = "circle";
          markCommit(true);
        }
        return;
      }
      const delHole = e.target.closest("[data-hole-del]");
      if (delHole && node.type === "openings") {
        const id = delHole.dataset.holeDel;
        node.holes = node.holes.filter((hole) => hole.id !== id);
        const bp = activeBlueprint();
        if (bp) bp.links = (bp.links || []).filter((link) => !(link.to === node.id && String(link.toPort || "").startsWith(`b:${id}:`)));
        markCommit(true);
        return;
      }
      const full = e.target.closest("[data-hole-full]");
      if (full && node.type === "openings") {
        const ctx = markContext();
        const hole = node.holes.find((item) => item.id === full.dataset.holeFull);
        const wall = ctx?.base ? plannerWalls(ctx.base).find((item) => item.id === hole?.wallId) : null;
        if (hole && wall) {
          hole.along = 0;
          hole.rise = 0;
          hole.w = plannerRound(wall.len);
          hole.shape = "rect";
          markCommit(true);
        }
        return;
      }
      const spin = e.target.closest("[data-light-spin]");
      if (spin && node.type === "electrics") {
        const fix = node.fixtures.find((item) => item.id === spin.dataset.lightSpin);
        if (fix) fix.angle = (lightAngle(fix) + 45) % 360;
        markCommit(true);
        return;
      }
      const delFix = e.target.closest("[data-fix-del]");
      if (delFix) {
        node.fixtures = node.fixtures.filter((item) => item.id !== delFix.dataset.fixDel);
        markCommit(true);
        return;
      }
      const addCell = e.target.closest("[data-cell-add]");
      if (addCell) {
        const fix = node.fixtures.find((item) => item.id === addCell.dataset.cellAdd);
        if (fix && fix.cells.length < 6) {
          fix.cells.push(fix.cells[fix.cells.length - 1] || "socket");
          markCommit(true);
        }
        return;
      }
      const delCustom = e.target.closest("[data-del-custom]");
      if (delCustom) {
        dropPreset(delCustom.dataset.delCustom === "light" ? "light" : "socket", delCustom.dataset.customId);
        markCommit(true);
      }
    });
    $("mark-side")?.addEventListener("change", (e) => {
      const node = markNode();
      const bp = activeBlueprint();
      if (!node || !bp) return;
      if (e.target?.dataset?.commonName) {
        markCommit(false);
        return;
      }
      if (handleCommonChange(e, node)) {
        markCommit(!!e.target?.dataset?.commonOn);
        return;
      }
      const out = e.target.dataset?.markOut;
      if (out) {
        const linked = linkedFromPorts(node.id, bp.links);
        if (linked.has(out)) {
          e.target.checked = true;
          return;
        }
        node.outOn[out] = !!e.target.checked;
        markCommit(false);
        return;
      }
      const bind = e.target.dataset?.holeBind;
      if (bind && node.type === "openings") {
        const hole = node.holes.find((item) => item.id === bind);
        const field = e.target.dataset.bind;
        if (!hole || !field) return;
        if (!hole.bind) hole.bind = { w: false, h: false, d: false };
        hole.bind[field] = !!e.target.checked;
        if (!e.target.checked) bp.links = bp.links.filter((link) => !(link.to === node.id && link.toPort === `b:${hole.id}:${field}`));
        markCommit(true);
        return;
      }
      const variable = e.target.dataset?.holeVar;
      if (variable && node.type === "openings") {
        const field = e.target.dataset.bind;
        const port = `b:${variable}:${field}`;
        const raw = String(e.target.value || "");
        if (!raw) disconnectInput(node.id, port);
        else {
          const [from, fromPort] = raw.split("\t");
          connect(from, fromPort, node.id, port);
        }
        markFill();
        return;
      }
      const orient = e.target.dataset?.orient;
      if (orient) {
        const fix = node.fixtures.find((item) => item.id === orient);
        if (fix) fix.orient = e.target.value === "v" ? "v" : "h";
        markCommit(true);
        return;
      }
      const cell = e.target.dataset?.cell;
      if (cell) {
        const fix = node.fixtures.find((item) => item.id === cell);
        const index = Number(e.target.dataset.cellI);
        if (fix && fix.cells[index] != null) fix.cells[index] = e.target.value;
        markCommit(true);
        return;
      }
      const light = e.target.dataset?.light;
      if (light) {
        const fix = node.fixtures.find((item) => item.id === light);
        if (fix) fix.light = e.target.value;
        markCommit(true);
      }
    });
    $("mark-side")?.addEventListener("input", (e) => {
      const named = markNode();
      if (named && handleCommonInput(e, named)) return;
      if (e.target.dataset?.counterName) {
        const node = markNode();
        if (!node || node.type !== "openings") return;
        if (!node.counterNames || typeof node.counterNames !== "object" || Array.isArray(node.counterNames)) node.counterNames = {};
        const key = e.target.dataset.counterName;
        const allowed = new Set(["pick", "doors", "windows", "pipes", "hatches"]);
        if (!allowed.has(key)) return;
        node.counterNames[key] = String(e.target.value || "").trim().slice(0, 48);
        markCommit(false);
        return;
      }
      if (e.target.dataset?.cardName) {
        const node = markNode();
        if (!node) return;
        const id = e.target.dataset.cardName;
        const fallback = e.target.dataset.labelFallback || "";
        const value = String(e.target.value || "").trim().slice(0, 48);
        const list = e.target.dataset.cardKind === "hole" ? node.holes : node.fixtures;
        const item = (list || []).find((row) => row.id === id);
        if (item) item.name = !value || value === fallback ? "" : value;
        if (item && e.target.dataset.cardKind === "hole") {
          const title = item.name || fallback;
          $("mark-side")?.querySelectorAll(`[data-own-title="${cssEsc(id)}"]`).forEach((el) => { el.textContent = title; });
        }
        markCommit(false);
        return;
      }
      const lightAngleId = e.target.dataset?.lightAngle;
      if (lightAngleId) {
        const node = markNode();
        const fix = node?.fixtures?.find((item) => item.id === lightAngleId);
        const value = plannerDraft(e.target.value);
        if (fix && value != null) {
          fix.angle = lightAngle({ angle: value });
          markCommit(false);
        }
        return;
      }
      const lightW = e.target.dataset?.lightW;
      const lightL = e.target.dataset?.lightL;
      if (lightW || lightL) {
        const node = markNode();
        const fix = node?.fixtures?.find((item) => item.id === (lightW || lightL));
        const value = plannerDraft(e.target.value);
        if (fix && value != null) {
          if (lightW) fix.lw = plannerRound(plannerClamp(value, 0.05, 8));
          else fix.ll = plannerRound(plannerClamp(value, 0.05, 12));
          markCommit(false);
        }
        return;
      }
      const node = markNode();
      if (!node || node.type !== "openings") return;
      const map = [
        ["holeW", "w", 0.05, 500],
        ["holeH", "h", 0.05, 30],
        ["holeD", "d", 5, 2000],
      ];
      for (const [data, field, lo, hi] of map) {
        const id = e.target.dataset?.[data];
        if (!id) continue;
        const hole = node.holes.find((item) => item.id === id);
        const value = plannerDraft(e.target.value);
        if (!hole || value == null || hole.bind?.[field]) return;
        if (field === "d") hole.d = plannerRound(plannerClamp(value / 1000, 0.005, 2));
        else hole[field] = plannerRound(plannerClamp(value, lo, hi));
        markCommit(false);
        return;
      }
      const ownName = e.target.dataset?.ownName;
      if (ownName) {
        const own = (node.owns || []).find((item) => item.id === ownName);
        if (own) own.name = String(e.target.value || "").trim().slice(0, 48) || "Свой";
        markCommit(false);
        return;
      }
      const pick = e.target.dataset?.holePick;
      if (pick) {
        const hole = node.holes.find((item) => item.id === pick);
        if (hole) hole.picked = !!e.target.checked;
        markCommit(true);
      }
    });
    $("mark-menu-card")?.addEventListener("submit", onMarkCustom);
    $("mark-side")?.addEventListener("submit", onMarkCustom);
    function onMarkCustom(e) {
      const form = e.target.closest?.("[data-custom]") || (e.target.dataset?.custom ? e.target : null);
      if (!form) return;
      e.preventDefault();
      const calc = ensureState();
      if (!calc) return;
      const data = new FormData(form);
      const name = String(data.get("name") || "").trim().slice(0, 32);
      if (!name) return;
      if (form.dataset.custom === "light") {
        if (!Array.isArray(calc.lightTypes)) calc.lightTypes = [];
        calc.lightTypes.push({
          id: `c-${uid()}`,
          name,
          shape: ["square", "diamond", "rect", "line", "circle"].includes(String(data.get("shape"))) ? String(data.get("shape")) : "circle",
          color: markHex(data.get("color"), "#facc15"),
          size: Math.round(plannerClamp(plannerNum(data.get("size"), 120), 20, 800)),
        });
      } else {
        const letters = markLetters(data.get("letters"));
        if (!letters) {
          api?.toast?.("Нужны буквы, от одной до трёх");
          return;
        }
        if (!Array.isArray(calc.socketTypes)) calc.socketTypes = [];
        calc.socketTypes.push({
          id: `c-${uid()}`,
          name,
          letters,
          color: markHex(data.get("color"), "#a78bfa"),
          size: Math.round(plannerClamp(plannerNum(data.get("size"), 80), 20, 400)),
        });
      }
      const old = form.closest("#mark-menu-card")?.querySelector("[data-presets]");
      if (old) old.outerHTML = markPresetHtml();
      const body = $("mark-preset-body");
      if (body && $("mark-preset-modal")?.classList.contains("open")) body.innerHTML = markPresetHtml();
      markCommit(true);
    }
    window.addEventListener("resize", () => {
      if (session.mark?.id) markDraw();
    });
  }

  function addNode(type, point, extra) {
    const bp = activeBlueprint();
    if (!bp) return;
    const at = point || viewCenter(bp);
    session.place += 1;
    const node = { id: uid(), type, x: at.x, y: at.y };
    if (type === "math") node.op = "+";
    if (type === "result") {
      node.op = "result";
      node.name = "Результат";
      node.priority = nextResultPriority(bp);
      node.visible = true;
    }
    if (type === "percent") node.op = "percent";
    if (type === "const") node.value = 0;
    if (type === "scheme") node.blueprintId = extra?.blueprintId || "";
    if (type === "formula") {
      node.inputs = [
        { id: uid(), name: "A" },
        { id: uid(), name: "B" },
      ];
      node.outputs = [
        { id: uid(), name: "C", expr: "A+B" },
        { id: uid(), name: "D", expr: "(-40+A)*B" },
      ];
    }
    if (type === "order") node.orderId = extra?.orderId || "";
    if (type === "filter") {
      node.customers = [];
      node.orderIds = [];
      node.period = "all";
      node.payFilters = [];
      node.payStatusFilters = [];
      node.statuses = [];
      node.orderTypes = [];
      node.products = [];
      node.dateFrom = "";
      node.dateTo = "";
    }
    if (type === "dashboard") {
      node.customers = [];
      node.orderIds = [];
      node.period = "all";
      node.payFilters = [];
      node.payStatusFilters = [];
      node.statuses = [];
      node.orderTypes = [];
      node.products = [];
      node.dateFrom = "";
      node.dateTo = "";
      node.openPorts = DASH_DEFAULT.slice();
    }
    if (type === "planner") {
      const ids = [uid(), uid(), uid(), uid()];
      node.name = "Планировщик";
      node.color = GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)];
      node.height = 2.7;
      node.heightOut = false;
      node.points = [
        { id: ids[0], x: 0, y: 0 },
        { id: ids[1], x: 4, y: 0 },
        { id: ids[2], x: 4, y: 3 },
        { id: ids[3], x: 0, y: 3 },
      ];
      node.outs = [
        { id: "floor", kind: "floor", name: "Пол", on: true },
        ...ids.map((id) => ({ id: `w:${id}`, kind: "wall", name: "", on: false })),
        { id: uid(), kind: "sum", name: "Стены", on: true, parts: ids.map((id) => `w:${id}`) },
      ];
    }
    if (type === "openings") {
      node.name = "Проёмы";
      node.color = GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)];
      node.holes = [];
      node.outOn = {};
      node.owns = [];
      node.view = "floor";
    }
    if (type === "electrics") {
      node.name = "Электрика";
      node.color = GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)];
      node.fixtures = [];
      node.outOn = {};
      node.view = "floor";
    }
    if (type === "present") {
      node.pageId = extra?.pageId || "";
      node.blockId = extra?.blockId || "";
      node.blockType = extra?.blockType || "metric";
      node.title = extra?.title || "Блок";
    }
    if (type === "group") {
      node.name = "Группа";
      node.color = GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)];
      node.w = 320;
      node.h = 220;
    }
    if (type === "comment") node.text = "";
    bp.nodes.push(node);
    session.selected = node.id;
    dirty();
    render();
  }

  function removeNode(id) {
    const bp = activeBlueprint();
    if (!bp) return;
    bp.nodes = bp.nodes.filter((node) => node.id !== id);
    bp.links = bp.links.filter((link) => link.from !== id && link.to !== id);
    if (session.selected === id) session.selected = "";
    dirty();
    render();
  }

  function duplicateNode(id) {
    const bp = activeBlueprint();
    if (!bp || !id) return;
    const src = (bp.nodes || []).find((node) => node.id === id);
    if (!src) return;
    let clone;
    try {
      clone = JSON.parse(JSON.stringify(src));
    } catch {
      return;
    }
    clone.id = uid();
    clone.x = (Number(src.x) || 0) + 48;
    clone.y = (Number(src.y) || 0) + 48;
    if (clone.type === "formula") {
      (clone.inputs || []).forEach((port) => {
        port.id = uid();
      });
      (clone.outputs || []).forEach((port) => {
        port.id = uid();
      });
    }
    if (clone.type === "result") {
      clone.priority = nextResultPriority(bp);
    }
    bp.nodes.push(clone);
    session.selected = clone.id;
    dirty();
    render();
  }

  function pruneOrphanNodes() {
    const bp = activeBlueprint();
    if (!bp) return 0;
    const linked = new Set();
    (bp.links || []).forEach((link) => {
      if (link.from) linked.add(link.from);
      if (link.to) linked.add(link.to);
    });
    const before = (bp.nodes || []).length;
    bp.nodes = (bp.nodes || []).filter((node) => node.type === "scheme" || node.type === "group" || node.type === "comment" || linked.has(node.id));
    const removed = before - bp.nodes.length;
    if (!removed) return 0;
    const keep = new Set(bp.nodes.map((node) => node.id));
    bp.links = (bp.links || []).filter((link) => keep.has(link.from) && keep.has(link.to));
    if (session.selected && !keep.has(session.selected)) session.selected = "";
    dirty();
    render();
    return removed;
  }

  function usedInputPorts(nodeId, links) {
    const used = new Set();
    (links || []).forEach((link) => {
      if (link.to === nodeId) used.add(link.toPort);
    });
    return used;
  }

  function firstFreeMathPort(nodeId, links) {
    const used = usedInputPorts(nodeId, links);
    for (let i = 1; i <= MATH_MAX; i += 1) {
      if (!used.has(`in${i}`)) return `in${i}`;
    }
    return "";
  }

  function resolveToPort(dst, requested, links) {
    if (dst.type === "math") {
      if (/^in([1-9]|1[0-9]|20)$/.test(requested || "")) return requested;
      return firstFreeMathPort(dst.id, links);
    }
    if (dst.type === "order") {
      const parsed = parseLinePort(requested);
      if (parsed?.input && parsed.field) {
        const order = api.findOrder(dst.orderId);
        const line = (order?.lines || []).find((item) => item.id === parsed.lineId);
        if (lineInputFieldOptions(line, order).some((item) => item.id === parsed.field)) {
          ensureOpenField(dst, parsed.lineId, parsed.field);
          return lineInPortId(parsed.lineId, parsed.field);
        }
        return "";
      }
    }
    const inputs = nodeInputs(dst, links);
    if (requested && inputs.some((port) => port.id === requested)) return requested;
    return inputs[0]?.id || "";
  }

  function matchPortId(wanted, ids) {
    if (!wanted) return "";
    if (ids.includes(wanted)) return wanted;
    const hits = ids.filter((id) => id.startsWith(wanted) || wanted.startsWith(id));
    return hits.length === 1 ? hits[0] : "";
  }

  function healLinks(bp) {
    if (!bp) return false;
    let changed = false;
    // Убрать устаревшие текстовые порты «за что» / product
    (bp.nodes || []).forEach((node) => {
      if (node.type !== "order" || !node.openFields) return;
      Object.keys(node.openFields).forEach((lineId) => {
        const list = node.openFields[lineId] || [];
        const next = list.filter((f) => f !== "product");
        if (next.length === list.length) return;
        changed = true;
        if (next.length) node.openFields[lineId] = next;
        else delete node.openFields[lineId];
      });
    });
    const beforeLinks = (bp.links || []).length;
    bp.links = (bp.links || []).filter((link) => {
      const to = parseLinePort(link.toPort);
      const from = parseLinePort(link.fromPort);
      if (to?.field === "product" || from?.field === "product") return false;
      return true;
    });
    if ((bp.links || []).length !== beforeLinks) changed = true;
    (bp.links || []).forEach((link) => {
      const src = (bp.nodes || []).find((node) => node.id === link.from);
      const dst = (bp.nodes || []).find((node) => node.id === link.to);
      if (src?.type === "order") {
        const ids = nodeOutputs(src, api.findOrder(src.orderId), bp.links).map((port) => port.id);
        const hit = matchPortId(link.fromPort, ids);
        if (hit && hit !== link.fromPort) {
          link.fromPort = hit;
          changed = true;
        }
      }
      if (dst?.type === "order") {
        const ids = nodeInputs(dst, bp.links).map((port) => port.id);
        const hit = matchPortId(link.toPort, ids);
        if (hit && hit !== link.toPort) {
          link.toPort = hit;
          changed = true;
        }
      }
    });
    return changed;
  }

  function connect(from, fromPort, to, toPort) {
    const bp = activeBlueprint();
    if (!bp || from === to) return false;
    const src = bp.nodes.find((node) => node.id === from);
    const dst = bp.nodes.find((node) => node.id === to);
    if (!src || !dst) return false;
    const srcIds = nodeOutputs(src, api.findOrder(src.orderId), bp.links).map((port) => port.id);
    const fromHit = matchPortId(fromPort, srcIds);
    if (!fromHit) return false;
    const port = resolveToPort(dst, toPort, bp.links);
    if (!port) return false;
    if (portSignal(src, fromHit) !== portSignal(dst, port)) {
      api?.toast?.("Чертёж соединяется только с чертежом");
      return false;
    }
    if (dst.type === "present" && dst.blockId) {
      const owner = presentOwner(dst.blockId, port, bp.id);
      if (owner) {
        api?.toast?.(`Вход занят схемой «${owner.blueprint.name || "Схема"}»`);
        return false;
      }
    }
    if (dst.type === "order") {
      const parsed = parseLinePort(port);
      if (parsed?.input && parsed.field) {
        const order = api.findOrder(dst.orderId);
        const line = (order?.lines || []).find((item) => item.id === parsed.lineId);
        const allowed = lineInputFieldOptions(line, order).some((item) => item.id === parsed.field);
        if (!allowed) {
          api?.toast?.("Это поле нельзя подать на вход этой позиции");
          return false;
        }
        const owner = orderFieldOwner(dst.orderId, parsed.lineId, parsed.field);
        // Разрешаем только замену связи на том же порту той же ноды
        if (owner && !(owner.blueprint.id === bp.id && owner.node.id === dst.id && owner.link.toPort === port)) {
          api?.toast?.(orderFieldOwnerReason(owner, line, order, parsed.field));
          return false;
        }
        ensureOpenField(dst, parsed.lineId, parsed.field);
      }
    }
    const replaced = (bp.links || []).filter((link) => link.to === to && link.toPort === port);
    bp.links = bp.links.filter((link) => !(link.to === to && link.toPort === port));
    bp.links.push({ id: uid(), from, fromPort: fromHit, to, toPort: port });
    replaced.forEach((link) => releaseOrderField(bp, link.from, link.fromPort));
    dirty();
    render();
    if (dst.type === "order") api?.refreshOrders?.();
    return true;
  }

  function releaseOrderField(bp, nodeId, fromPort) {
    const parsed = parseLinePort(fromPort);
    if (parsed?.field && !parsed.input) {
      const still = (bp.links || []).some((link) => link.from === nodeId && link.fromPort === fromPort);
      if (still) return;
      const inStill = (bp.links || []).some(
        (link) => link.to === nodeId && link.toPort === lineInPortId(parsed.lineId, parsed.field)
      );
      if (inStill) return;
      const node = (bp.nodes || []).find((item) => item.id === nodeId && item.type === "order");
      if (node) dropOpenField(node, parsed.lineId, parsed.field);
      return;
    }
    const typed = parseTypePort(fromPort);
    if (!typed?.field) return;
    const stillType = (bp.links || []).some((link) => link.from === nodeId && link.fromPort === fromPort);
    if (stillType) return;
    const orderNode = (bp.nodes || []).find((item) => item.id === nodeId && item.type === "order");
    if (orderNode) dropOpenTypeField(orderNode, typed.typeName, typed.field);
  }

  function releaseOrderInputField(bp, nodeId, toPort) {
    const parsed = parseLinePort(toPort);
    if (!parsed?.input || !parsed.field) return;
    const stillIn = (bp.links || []).some((link) => link.to === nodeId && link.toPort === toPort);
    if (stillIn) return;
    const stillOut = (bp.links || []).some(
      (link) => link.from === nodeId && link.fromPort === `line:${parsed.lineId}:${parsed.field}`
    );
    if (stillOut) return;
    const node = (bp.nodes || []).find((item) => item.id === nodeId && item.type === "order");
    if (!node) return;
    const open = openFieldsFor(node, parsed.lineId);
    // Не снимаем поле с ноды автоматически при обрыве только входа — оставляем, если явно открыто.
    if (!open.includes(parsed.field)) return;
  }

  function removeLink(id) {
    const bp = activeBlueprint();
    if (!bp || !id) return;
    const gone = bp.links.find((link) => link.id === id);
    const before = bp.links.length;
    bp.links = bp.links.filter((link) => link.id !== id);
    if (bp.links.length !== before) {
      if (session.selectedLink === id) session.selectedLink = "";
      if (gone) {
        releaseOrderField(bp, gone.from, gone.fromPort);
        releaseOrderInputField(bp, gone.to, gone.toPort);
      }
      dirty();
      render();
      api?.refreshOrders?.();
    }
  }

  function finishLink(from, fromPort, to, toPort) {
    session.linking = null;
    setLinkingClass();
    return connect(from, fromPort, to, toPort);
  }

  function disconnectInput(nodeId, portId) {
    const bp = activeBlueprint();
    if (!bp) return;
    const gone = (bp.links || []).filter((link) => link.to === nodeId && link.toPort === portId);
    const before = bp.links.length;
    bp.links = bp.links.filter((link) => !(link.to === nodeId && link.toPort === portId));
    if (bp.links.length !== before) {
      gone.forEach((link) => {
        releaseOrderField(bp, link.from, link.fromPort);
        releaseOrderInputField(bp, link.to, link.toPort);
      });
      dirty();
      render();
      api?.refreshOrders?.();
    }
  }

  function renderTabs(calc) {
    const host = $("calc-tabs");
    if (!host) return;
    const left = host.scrollLeft;
    host.innerHTML = calc.blueprints
      .map(
        (bp) => `<div class="calc-tab ${bp.id === calc.active ? "active" : ""}" data-bp="${esc(bp.id)}" draggable="true" title="${esc(bp.name)}">
          <span class="calc-tab-label">${esc(bp.name)}</span>
          ${calc.blueprints.length > 1 ? `<button type="button" class="calc-tab-x" data-del-bp="${esc(bp.id)}" title="Закрыть схему" draggable="false">×</button>` : ""}
        </div>`
      )
      .join("");
    host.scrollLeft = left;
    const on = host.querySelector(".calc-tab.active");
    if (on) on.scrollIntoView({ inline: "nearest", block: "nearest" });
  }

  function reorderBlueprint(fromId, toId, placeAfter) {
    const calc = ensureState();
    if (!calc || !fromId || !toId || fromId === toId) return false;
    const from = calc.blueprints.findIndex((bp) => bp.id === fromId);
    let to = calc.blueprints.findIndex((bp) => bp.id === toId);
    if (from < 0 || to < 0) return false;
    const [item] = calc.blueprints.splice(from, 1);
    to = calc.blueprints.findIndex((bp) => bp.id === toId);
    if (to < 0) {
      calc.blueprints.push(item);
    } else {
      calc.blueprints.splice(placeAfter ? to + 1 : to, 0, item);
    }
    dirty();
    render();
    return true;
  }

  function renderTitle(bp) {
    const field = $("calc-bp-name");
    if (!field || !bp) return;
    if (document.activeElement === field) return;
    field.value = bp.name || "Схема";
  }

  function orderStamp(order) {
    let best = "";
    for (const line of order?.lines || []) {
      const day = String(line.order_date || "").slice(0, 10);
      if (day.length >= 10 && day > best) best = day;
    }
    if (best) return best;
    return String(order?.created_at || "").slice(0, 10);
  }

  function calcToolButton(type, label, icon) {
    return `<button type="button" class="btn calc-tool" data-add-node="${type}" draggable="true"><svg class="calc-tool-ico" viewBox="0 0 16 16" aria-hidden="true">${icon}</svg>${label}</button>`;
  }

  function renderSide(bp) {
    const host = $("calc-side");
    if (!host) return;
    const calc = ensureState();
    const q = session.search.trim().toLowerCase();
    const src = api.orders() || [];
    const orders = src
      .map((order, index) => ({ order, index }))
      .filter(({ order }) => {
        if (!q) return true;
        const blob = `${order.number || ""} ${order.name || ""} ${order.customer || ""}`.toLowerCase();
        return blob.includes(q);
      })
      .sort((a, b) => {
        const da = orderStamp(a.order);
        const db = orderStamp(b.order);
        if (db !== da) return db.localeCompare(da);
        return b.index - a.index;
      })
      .map((item) => item.order);
    const usedOrders = new Set(
      (bp?.nodes || []).filter((node) => node.type === "order" && node.orderId).map((node) => node.orderId)
    );
    const schemes = (calc?.blueprints || []).filter((item) => item.id !== bp?.id);
    host.innerHTML = `
      <details class="calc-fold" data-fold="nodes" ${foldOpen("nodes") ? "open" : ""}>
        <summary class="calc-tools-label">Ноды</summary>
        <div class="calc-tools">
          ${calcToolButton("math", "Оператор", `<path d="M8 3.2v9.6M3.2 8h9.6"/>`)}
          ${calcToolButton("formula", "Формула", `<path d="M5.6 3.2c-1.7.3-2.4 1.3-2.4 2.3 0 1.5 1.1 2.1 2.3 2.3-1.5.5-2.5 1.5-2.5 3 0 1.4 1.1 2.2 2.6 2.2M9.1 4.4l3.8 7.2M9.4 8.2h3.2"/>`)}
          ${calcToolButton("percent", "Процент", `<circle cx="5" cy="4.8" r="1.45" fill="currentColor" stroke="none"/><circle cx="11" cy="11.2" r="1.45" fill="currentColor" stroke="none"/><path d="M12.3 3.4 3.7 12.6"/>`)}
          ${calcToolButton("const", "Константа", `<rect x="3" y="3" width="10" height="10" rx="2"/><path d="M8 5.4v5.2"/>`)}
          ${calcToolButton("filter", "Фильтр", `<path d="M2.6 3.2h10.8L9.4 8.2v4.2l-2.8 1.2V8.2z"/>`)}
          ${calcToolButton("dashboard", "Дашборд", `<path d="M3 13V8.4M8 13V3.6M13 13V6.4M2.2 13h11.6"/>`)}
          ${calcToolButton("planner", "Планировщик", `<path d="M3 3.2h10v9.6H3zM3 7.4h4.2"/>`)}
          ${calcToolButton("openings", "Проёмы", `<path d="M3 3.2h10v9.6H3zM6.2 12.8V7.2h3.6v5.6M4.2 6.2h2.2v2.4H4.2z"/>`)}
          ${calcToolButton("electrics", "Электрика", `<path d="M8 2.8v3.2M6.2 6h3.6v2.4L8 13.2 6.2 8.4V6z"/>`)}
          ${calcToolButton("result", "Результат", `<path d="M2.6 5.2h6.4M2.6 10.8h6.4M10.2 8h3.4M11.6 6.2 13.8 8l-2.2 1.8"/>`)}
          ${calcToolButton("group", "Группа", `<rect x="3" y="3" width="10" height="10" rx="1.5" stroke-dasharray="2.2 1.5"/>`)}
          ${calcToolButton("comment", "Комментарий", `<path d="M3 2.8h6.6L13 6.2v7H3zM9.4 2.9V6h3.2M5 8.2h6M5 10.6h4"/>`)}
        </div>
      </details>
      <details class="calc-fold" data-fold="schemes" ${foldOpen("schemes") ? "open" : ""}>
        <summary class="calc-tools-label">Схемы</summary>
        <div class="calc-orders calc-schemes">
          <div class="calc-order-list calc-scheme-list">
            ${
              schemes.length
                ? schemes
                    .map((item) => {
                      const n = (item.nodes || []).filter((node) => node.type === "result" && resultVisible(node)).length;
                      return `<button type="button" class="calc-order" draggable="true" data-blueprint="${esc(item.id)}">
                        <b>${esc(item.name || "Схема")}</b>
                        <span>${n ? `${n} рез.` : "нет результатов"}</span>
                      </button>`;
                    })
                    .join("")
                : `<div class="calc-empty">Другая схема станет нодой: её выходы — ноды «Результат»</div>`
            }
          </div>
        </div>
      </details>
      <details class="calc-fold" data-fold="orders" ${foldOpen("orders") ? "open" : ""}>
        <summary class="calc-tools-label">Заказы</summary>
        <div class="calc-orders">
          <div class="calc-search${session.search ? " has-value" : ""}">
            <input type="search" id="calc-order-search" placeholder="Номер, название…" value="${esc(session.search)}" autocomplete="off" />
            <button type="button" class="search-clear" data-search-clear="calc-order-search" title="Очистить" aria-label="Очистить поиск">×</button>
          </div>
          <div class="calc-order-list">
            ${
              orders.length
                ? orders
                    .map((order) => {
                      const n = orderLines(order).length;
                      const used = usedOrders.has(order.id);
                      const label = `${order.number || "—"} — ${order.name || order.customer || "Без названия"}`;
                      const tip = used ? `${label} · на схеме` : label;
                      return `<button type="button" class="calc-order${used ? " is-used" : ""}" draggable="true" data-order="${esc(order.id)}" title="${esc(tip)}">
                        <b>${esc(order.number || "—")}</b>
                        <span>${esc(order.name || order.customer || "Без названия")}</span>
                        <small>${used ? "на схеме" : `${n} поз.`}</small>
                      </button>`;
                    })
                    .join("")
                : `<div class="calc-empty">Нет заказов</div>`
            }
          </div>
        </div>
      </details>`;
  }

  function hidePortMenu() {
    document.querySelectorAll(".calc-port-menu").forEach((el) => el.remove());
  }

  function showDashPortMenu(clientX, clientY, nodeId) {
    hidePortMenu();
    const bp = activeBlueprint();
    const node = bp?.nodes.find((item) => item.id === nodeId && item.type === "dashboard");
    if (!bp || !node) return;
    const open = new Set(openDashPorts(node));
    const linked = linkedFromPorts(node.id, bp.links);
    const menu = document.createElement("div");
    menu.className = "calc-port-menu";
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    DASH_PORTS.forEach((port) => {
      const shown = open.has(port.id) || linked.has(port.id);
      const locked = linked.has(port.id);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = port.name;
      if (shown) {
        btn.className = "is-shown";
        btn.title = locked ? "Порт занят связью" : "Убрать с ноды";
      } else {
        btn.title = "Добавить на ноду";
      }
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (locked) return;
        if (shown) dropDashPort(node, port.id);
        else ensureDashPort(node, port.id);
        hidePortMenu();
        dirty();
        render();
      });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    const place = () => {
      const rect = menu.getBoundingClientRect();
      let left = clientX;
      let top = clientY;
      if (left + rect.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - rect.width - 8);
      if (top + rect.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - rect.height - 8);
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    };
    place();
    const close = (e) => {
      if (e.target.closest?.(".calc-port-menu")) return;
      hidePortMenu();
      document.removeEventListener("pointerdown", close, true);
    };
    setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
  }

  function showLinePortMenu(clientX, clientY, nodeId, lineId) {
    hidePortMenu();
    const bp = activeBlueprint();
    const node = bp?.nodes.find((item) => item.id === nodeId && item.type === "order");
    const order = api.findOrder(node?.orderId);
    const line = (order?.lines || []).find((item) => item.id === lineId);
    if (!bp || !node || !line) return;
    const byId = new Map();
    lineFieldOptions(line, order).forEach((field) => byId.set(field.id, { ...field, canOut: true, canIn: false }));
    lineInputFieldOptions(line, order).forEach((field) => {
      const prev = byId.get(field.id) || { id: field.id, name: field.name, canOut: false, canIn: false };
      prev.canIn = true;
      prev.name = field.name;
      byId.set(field.id, prev);
    });
    const options = [...byId.values()];
    if (!options.length) return;
    const open = new Set(openFieldsFor(node, lineId));
    const linkedOut = linkedFromPorts(node.id, bp.links);
    const linkedIn = usedInputPorts(node.id, bp.links);
    const menu = document.createElement("div");
    menu.className = "calc-port-menu";
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    options.forEach((field) => {
      const outId = `line:${lineId}:${field.id}`;
      const inId = lineInPortId(lineId, field.id);
      const shown = open.has(field.id) || linkedOut.has(outId) || linkedIn.has(inId);
      const lockedElsewhere = field.canIn && !!orderFieldOwner(node.orderId, lineId, field.id, null, node.id);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = field.name + (field.canIn ? " ↔" : " →");
      if (lockedElsewhere && !shown) {
        btn.className = "is-locked";
        btn.title = orderFieldOwnerReason(
          orderFieldOwner(node.orderId, lineId, field.id),
          line,
          order,
          field.id
        );
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          api?.toast?.(btn.title);
        });
      } else if (shown) {
        btn.className = "is-shown";
        btn.title = linkedOut.has(outId) || linkedIn.has(inId) ? "Порт занят связью" : "Убрать с ноды";
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (linkedOut.has(outId) || linkedIn.has(inId)) {
            api?.toast?.("Сначала удалите связь");
            return;
          }
          dropOpenField(node, lineId, field.id);
          hidePortMenu();
          dirty();
          render();
        });
      } else {
        btn.title = field.canIn ? "Показать вход и выход" : "Показать выход";
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          ensureOpenField(node, lineId, field.id);
          hidePortMenu();
          dirty();
          render();
        });
      }
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    const onDoc = (e) => {
      if (e.target.closest?.(".calc-port-menu")) return;
      hidePortMenu();
      document.removeEventListener("pointerdown", onDoc, true);
    };
    setTimeout(() => document.addEventListener("pointerdown", onDoc, true), 0);
  }

  function freeOrderFieldPort(orderId, lineId, field) {
    const calc = ensureState();
    const want = lineInPortId(lineId, field);
    let changed = false;
    (calc.blueprints || []).forEach((bp) => {
      const before = (bp.links || []).length;
      bp.links = (bp.links || []).filter((link) => {
        if (link.toPort !== want) return true;
        const dst = (bp.nodes || []).find((item) => item.id === link.to);
        if (!dst || dst.type !== "order" || dst.orderId !== orderId) return true;
        return false;
      });
      if (bp.links.length !== before) changed = true;
    });
    if (changed) {
      dirty();
      render();
      api?.refreshOrders?.();
    }
    return changed;
  }

  function showOrderInputPortMenu(clientX, clientY, nodeId, portId) {
    hidePortMenu();
    const bp = activeBlueprint();
    const node = bp?.nodes.find((item) => item.id === nodeId && item.type === "order");
    const parsed = parseLinePort(portId);
    if (!bp || !node || !parsed?.input || !parsed.field) return;
    const owner = orderFieldOwner(node.orderId, parsed.lineId, parsed.field);
    if (!owner || owner.node.id === node.id) return;
    const order = api.findOrder(node.orderId);
    const line = (order?.lines || []).find((item) => item.id === parsed.lineId);
    const menu = document.createElement("div");
    menu.className = "calc-port-menu";
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    const info = document.createElement("div");
    info.className = "calc-port-menu-empty";
    info.textContent = orderFieldOwnerReason(owner, line, order, parsed.field);
    menu.appendChild(info);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Освободить порт";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      freeOrderFieldPort(node.orderId, parsed.lineId, parsed.field);
      hidePortMenu();
    });
    menu.appendChild(btn);
    document.body.appendChild(menu);
    placePortMenu(menu, clientX, clientY);
    bindPortMenuClose(menu);
  }

  function placePortMenu(menu, clientX, clientY) {
    const rect = menu.getBoundingClientRect();
    let left = clientX;
    let top = clientY;
    if (left + rect.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - rect.width - 8);
    if (top + rect.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - rect.height - 8);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function bindPortMenuClose(menu) {
    const onDoc = (e) => {
      if (e.target.closest?.(".calc-port-menu")) return;
      hidePortMenu();
      document.removeEventListener("pointerdown", onDoc, true);
    };
    setTimeout(() => document.addEventListener("pointerdown", onDoc, true), 0);
  }

  function showOrderTypeMenu(clientX, clientY, nodeId) {
    hidePortMenu();
    const bp = activeBlueprint();
    const node = bp?.nodes.find((item) => item.id === nodeId && item.type === "order");
    const order = api.findOrder(node?.orderId);
    if (!bp || !node || !order) return;
    const names = orderTypeNames(order);
    const open = new Set(openTypesFor(node));
    const linked = linkedFromPorts(node.id, bp.links);
    const menu = document.createElement("div");
    menu.className = "calc-port-menu";
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    if (!names.length) {
      const empty = document.createElement("div");
      empty.className = "calc-port-menu-empty";
      empty.textContent = "Нет типов в заказе";
      menu.appendChild(empty);
    }
    names.forEach((typeName) => {
      const portId = typePortId(typeName);
      const childLinked = typeFieldOptions(order, typeName).some((field) => linked.has(typePortId(typeName, field.id)));
      const shown = open.has(typeName) || linked.has(portId) || childLinked;
      const locked = linked.has(portId) || childLinked;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = typeName;
      if (shown) {
        btn.className = "is-shown";
        btn.title = locked ? "Порт занят связью" : "Убрать с ноды";
      } else {
        btn.title = "Добавить сумму типа";
      }
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (locked) return;
        if (shown) dropOpenType(node, typeName);
        else ensureOpenType(node, typeName);
        hidePortMenu();
        dirty();
        render();
      });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    placePortMenu(menu, clientX, clientY);
    bindPortMenuClose(menu);
  }

  function showTypePortMenu(clientX, clientY, nodeId, typeName) {
    hidePortMenu();
    const bp = activeBlueprint();
    const node = bp?.nodes.find((item) => item.id === nodeId && item.type === "order");
    const order = api.findOrder(node?.orderId);
    if (!bp || !node || !order) return;
    const options = typeFieldOptions(order, typeName);
    if (!options.length) return;
    const open = new Set(openTypeFieldsFor(node, typeName));
    const linked = linkedFromPorts(node.id, bp.links);
    const menu = document.createElement("div");
    menu.className = "calc-port-menu";
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    options.forEach((field) => {
      const portId = typePortId(typeName, field.id);
      const shown = open.has(field.id) || linked.has(portId);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = field.name;
      if (shown) {
        btn.className = "is-shown";
        btn.title = "Убрать с ноды";
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropOpenTypeField(node, typeName, field.id);
          bp.links = (bp.links || []).filter((link) => !(link.from === nodeId && link.fromPort === portId));
          hidePortMenu();
          dirty();
          render();
        });
      } else {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          ensureOpenType(node, typeName);
          ensureOpenTypeField(node, typeName, field.id);
          hidePortMenu();
          dirty();
          render();
        });
      }
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    placePortMenu(menu, clientX, clientY);
    bindPortMenuClose(menu);
  }

  function orderNodeHtml(node, order, graph, bp) {
    const missing = !order;
    const ports = nodeOutputs(node, order, bp?.links);
    const linkedIn = usedInputPorts(node.id, bp?.links || []);
    return `<article class="calc-node is-order ${missing ? "is-error" : ""} ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span title="${esc(missing ? "Заказ удалён" : (order.number || "—"))}">${missing ? "Заказ удалён" : esc(order.number || "—")}</span>
        <button type="button" class="calc-mini calc-order-types" data-order-types="${esc(node.id)}" title="Суммы по типам" ${missing ? "disabled" : ""}>Σ</button>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <div class="calc-node-sub" title="${esc(missing ? "" : (order.name || order.customer || ""))}">${missing ? "" : esc(order.name || order.customer || "")}</div>
      <div class="calc-ports">
        ${ports
          .map((port) => {
            const value = graph.values[`${node.id}:${port.id}`];
            const tone = port.tone || "income";
            const child = port.child ? " is-child" : "";
            const fieldCls = port.child && port.field ? ` is-field-${port.field}` : "";
            const isType = port.kind === "type";
            if (port.child && port.hasInput && port.field && port.line) {
              const inId = lineInPortId(port.line.id, port.field);
              const owner = orderFieldOwner(node.orderId, port.line.id, port.field);
              const locked = !!owner && owner.node.id !== node.id;
              const linked = linkedIn.has(inId);
              const tip = locked
                ? `${orderFieldOwnerReason(owner, port.line, order, port.field)} · ПКМ — освободить`
                : `${esc(port.name)} · вход задаёт значение в заказе`;
              const jumped = session.jump?.nodeId === node.id && session.jump?.portId === inId;
              return `<div class="calc-row both is-${tone}${child}${fieldCls}${locked ? " is-locked" : ""}${jumped ? " is-jump" : ""}" title="${esc(tip)}">
              <i class="calc-port in ${locked ? "is-locked" : ""}" data-port="${esc(inId)}" data-io="in" data-line="${esc(port.line.id)}" data-field="${esc(port.field)}" data-order-lock="${locked ? "1" : ""}" title="${esc(tip)}"></i>
              <span class="calc-row-name" title="${esc(tip)}">${esc(port.name)}</span>
              <b>${esc(fmtShort(value))}</b>
              ${linked ? `<button type="button" class="calc-mini" data-del-in-link="${esc(inId)}" title="Удалить связь">×</button>` : ""}
              <i class="calc-port out" data-port="${esc(port.id)}" data-io="out" data-line="${esc(port.line.id)}" data-child="1" title="${esc(port.name)}"></i>
            </div>`;
            }
            const kindTip =
              tone === "tax" ? "Налог" : tone === "cost" ? "Затрата" : tone === "frozen" ? "Заморожено" : "";
            const tip = port.child
              ? esc(port.name)
              : isType
                ? `${esc(port.name)}${kindTip ? ` · ${kindTip}` : ""} · ПКМ — поля типа`
                : port.id === "total"
                  ? esc(port.name)
                  : `${esc(port.name)}${kindTip ? ` · ${kindTip}` : ""} · ПКМ — поля позиции`;
            return `<div class="calc-row out is-${tone}${child}${fieldCls}${isType ? " is-type-sum" : ""}">
              <span class="calc-row-name" title="${tip}">${esc(port.name)}</span>
              <b>${esc(fmtShort(value))}</b>
              <i class="calc-port out" data-port="${esc(port.id)}" data-io="out" data-line="${esc(port.line?.id || "")}" data-type="${esc(port.typeName || "")}" data-child="${port.child ? "1" : "0"}" title="${tip}"></i>
            </div>`;
          })
          .join("")}
      </div>
    </article>`;
  }

  function mathNodeHtml(node, bp, graph) {
    const ports = nodeInputs(node, bp.links);
    const linked = usedInputPorts(node.id, bp.links);
    const value = graph.values[`${node.id}:out`];
    return `<article class="calc-node is-math ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>Оператор</span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <div class="calc-ops">
        ${OPS.map((op) => `<button type="button" class="calc-op ${node.op === op.id ? "on" : ""}" data-op="${op.id}">${op.label}</button>`).join("")}
      </div>
      ${screenHtml(value, "Выход")}
      <div class="calc-ports">
        ${ports
          .map(
            (port) => `<div class="calc-row in">
              <i class="calc-port in" data-port="${esc(port.id)}" data-io="in"></i>
              <span>вход ${esc(port.name)}</span>
              ${linked.has(port.id) ? `<button type="button" class="calc-mini" data-del-in-link="${esc(port.id)}" title="Удалить связь">×</button>` : ""}
            </div>`
          )
          .join("")}
        <div class="calc-row out">
          <span>выход</span>
          <i class="calc-port out" data-port="out" data-io="out"></i>
        </div>
      </div>
    </article>`;
  }

  const LS_FORMULA_PROFILES = "finmaster.formulaProfiles";
  let formulaProfilesMem = null;
  let formulaProfileNodeId = "";

  function loadFormulaProfiles() {
    if (formulaProfilesMem) return formulaProfilesMem;
    const fromApi = api?.formulaProfiles?.();
    const raw = Array.isArray(fromApi) ? fromApi : [];
    const cleaned = raw
      .map((item) => {
        const name = String(item?.name || "").trim().replace(/\s+/g, " ").slice(0, 40);
        const inputs = (Array.isArray(item?.inputs) ? item.inputs : [])
          .map((letter) => String(letter || "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1))
          .filter(Boolean)
          .slice(0, 26);
        const outputs = (Array.isArray(item?.outputs) ? item.outputs : [])
          .map((out) => ({
            name: String(out?.name || "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1),
            expr: String(out?.expr || "0").slice(0, 200),
          }))
          .filter((out) => out.name)
          .slice(0, MATH_MAX);
        if (!name || !inputs.length || !outputs.length) return null;
        return { name, inputs, outputs };
      })
      .filter(Boolean)
      .slice(0, 40);
    formulaProfilesMem = cleaned;
    return cleaned;
  }

  function storeFormulaProfiles(list) {
    formulaProfilesMem = list.slice();
    try {
      localStorage.setItem(LS_FORMULA_PROFILES, JSON.stringify(formulaProfilesMem));
    } catch {
      /* ignore */
    }
    api?.saveFormulaProfiles?.(formulaProfilesMem);
  }

  function formulaSnapshot(node) {
    return {
      inputs: (node.inputs || []).map((port) => String(port.name || "").trim()),
      outputs: (node.outputs || []).map((port) => ({
        name: String(port.name || "").trim(),
        expr: String(port.expr || "0"),
      })),
    };
  }

  function formulaProfileKey(profile) {
    return JSON.stringify({
      inputs: profile.inputs,
      outputs: profile.outputs.map((out) => ({ name: out.name, expr: out.expr })),
    });
  }

  function formulaProfilesHtml(node) {
    const list = loadFormulaProfiles();
    const current = formulaProfileKey(formulaSnapshot(node));
    const selected = list.findIndex((profile) => formulaProfileKey(profile) === current);
    const empty = !list.length;
    const options = empty
      ? `<option value="">Создайте профиль</option>`
      : `<option value="" hidden ${selected < 0 ? "selected" : ""}></option>${list
          .map(
            (profile, i) =>
              `<option value="${i}" ${i === selected ? "selected" : ""}>${esc(profile.name)}</option>`
          )
          .join("")}`;
    return `<div class="calc-fprof">
      <select data-formula-profile aria-label="Профили формулы" title="${empty ? "Профилей пока нет. Создайте новый кнопкой +" : "Подставить сохранённую формулу"}"${empty ? " disabled" : ""}>
        ${options}
      </select>
      <button type="button" class="calc-mini" data-formula-profile-save title="Сохранить текущую формулу как профиль">+</button>
      <button type="button" class="calc-mini" data-formula-profile-del title="Удалить профили">×</button>
    </div>`;
  }

  function applyFormulaProfile(node, bp, profile) {
    const oldIn = new Set((node.inputs || []).map((port) => port.id));
    const oldOut = new Set((node.outputs || []).map((port) => port.id));
    bp.links = (bp.links || []).filter((link) => {
      if (link.to === node.id && oldIn.has(link.toPort)) return false;
      if (link.from === node.id && oldOut.has(link.fromPort)) return false;
      return true;
    });
    const used = new Set();
    const take = (raw) => {
      let letter = String(raw || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z]/g, "")
        .slice(0, 1);
      if (!letter || used.has(letter)) letter = nextLetter(used) || "A";
      used.add(letter);
      return letter;
    };
    node.inputs = profile.inputs.slice(0, 26).map((name) => ({ id: uid(), name: take(name) }));
    if (!node.inputs.length) node.inputs = [{ id: uid(), name: take("A") }];
    node.outputs = profile.outputs.slice(0, MATH_MAX).map((out) => ({
      id: uid(),
      name: take(out.name),
      expr: sanitizeFormulaExpr(String(out.expr || "0")).slice(0, 200) || "0",
    }));
    if (!node.outputs.length) node.outputs = [{ id: uid(), name: take("C"), expr: "0" }];
  }

  function openFormulaProfileSave(node) {
    formulaProfileNodeId = node.id;
    const modal = $("formula-profile-modal");
    const input = $("formula-profile-name");
    if (!modal || !input) return;
    input.value = "";
    modal.classList.add("open");
    setTimeout(() => input.focus(), 30);
  }

  function closeFormulaProfileSave() {
    $("formula-profile-modal")?.classList.remove("open");
    formulaProfileNodeId = "";
  }

  function commitFormulaProfileSave() {
    const node = formulaNode(formulaProfileNodeId);
    const input = $("formula-profile-name");
    const name = String(input?.value || "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (!node) {
      closeFormulaProfileSave();
      return;
    }
    if (!name) {
      api?.toast?.("Введите название профиля");
      input?.focus();
      return;
    }
    const list = loadFormulaProfiles().slice();
    const key = name.toLocaleLowerCase("ru");
    const idx = list.findIndex((profile) => profile.name.toLocaleLowerCase("ru") === key);
    const entry = { name, ...formulaSnapshot(node) };
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
    storeFormulaProfiles(list);
    closeFormulaProfileSave();
    render();
    api?.toast?.(idx >= 0 ? `Профиль «${name}» обновлён` : `Профиль «${name}» сохранён`);
  }

  function openFormulaProfileDelete() {
    const modal = $("formula-profile-del-modal");
    const box = $("formula-profile-del-list");
    if (!modal || !box) return;
    const list = loadFormulaProfiles();
    box.innerHTML = list.length
      ? list
          .map(
            (profile, i) =>
              `<label class="formula-profile-pick"><input type="checkbox" data-formula-del="${i}" /> <span>${esc(profile.name)}</span></label>`
          )
          .join("")
      : `<p class="formula-profile-empty">Сохранённых профилей пока нет.</p>`;
    const ok = $("formula-profile-del-ok");
    if (ok) ok.disabled = !list.length;
    modal.classList.add("open");
  }

  function closeFormulaProfileDelete() {
    $("formula-profile-del-modal")?.classList.remove("open");
  }

  async function commitFormulaProfileDelete() {
    const picked = [...document.querySelectorAll("#formula-profile-del-list [data-formula-del]:checked")].map((el) =>
      Number(el.dataset.formulaDel)
    );
    if (!picked.length) {
      api?.toast?.("Отметьте профили, которые нужно удалить");
      return;
    }
    const list = loadFormulaProfiles();
    const names = picked.map((i) => list[i]?.name).filter(Boolean);
    const ok = api?.askConfirm
      ? await api.askConfirm({
          title: names.length === 1 ? "Удалить профиль?" : "Удалить профили?",
          text:
            names.length === 1
              ? `Профиль «${names[0]}» будет удалён. Текущая формула не изменится.`
              : `Будут удалены: ${names.map((name) => `«${name}»`).join(", ")}. Текущая формула не изменится.`,
          ok: "Удалить",
          danger: true,
        })
      : false;
    if (!ok) return;
    const drop = new Set(picked);
    storeFormulaProfiles(list.filter((_, i) => !drop.has(i)));
    closeFormulaProfileDelete();
    render();
    api?.toast?.(names.length === 1 ? `Профиль «${names[0]}» удалён` : `Удалено профилей: ${names.length}`);
  }

  function bindFormulaProfileModals() {
    $("formula-profile-cancel")?.addEventListener("click", closeFormulaProfileSave);
    $("formula-profile-ok")?.addEventListener("click", commitFormulaProfileSave);
    $("formula-profile-name")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitFormulaProfileSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeFormulaProfileSave();
      }
    });
    $("formula-profile-modal")?.addEventListener("click", (e) => {
      if (e.target === $("formula-profile-modal")) closeFormulaProfileSave();
    });
    $("formula-profile-del-cancel")?.addEventListener("click", closeFormulaProfileDelete);
    $("formula-profile-del-ok")?.addEventListener("click", () => {
      commitFormulaProfileDelete();
    });
    $("formula-profile-del-modal")?.addEventListener("click", (e) => {
      if (e.target === $("formula-profile-del-modal")) closeFormulaProfileDelete();
    });
  }

  function formulaBadTitle(kind, bad) {
    if (kind === "expr") return bad ? "Ошибка в этом выражении" : "Цифры, знаки и заглавные латинские буквы";
    return bad ? "Ошибка: буква неверная или уже занята" : "Одна заглавная латинская буква";
  }

  function paintFormulaErrors(host, graph) {
    if (!host) return;
    host.querySelectorAll(".calc-node.is-formula").forEach((el) => {
      const nodeId = el.dataset.node;
      if (!nodeId) return;
      const fields = new Set((graph.fields && graph.fields[nodeId]) || []);
      el.classList.toggle("is-error", !!graph.errors?.has(nodeId));
      el.querySelectorAll("[data-in-name]").forEach((input) => {
        const on = fields.has(`in:${input.dataset.inName}`);
        input.classList.toggle("is-bad", on);
        input.title = formulaBadTitle("letter", on);
      });
      el.querySelectorAll("[data-out-name]").forEach((input) => {
        const on = fields.has(`out:${input.dataset.outName}`);
        input.classList.toggle("is-bad", on);
        input.title = formulaBadTitle("letter", on);
      });
      el.querySelectorAll("[data-out-expr]").forEach((input) => {
        const on = fields.has(`expr:${input.dataset.outExpr}`);
        input.classList.toggle("is-bad", on);
        input.title = formulaBadTitle("expr", on);
      });
    });
  }

  function formulaNodeHtml(node, bp, graph) {
    const bad = graph.errors.has(node.id);
    const badFields = new Set((graph.fields && graph.fields[node.id]) || []);
    const linked = usedInputPorts(node.id, bp.links);
    const w = formulaWidth(node);
    const mark = (key) => (badFields.has(key) ? " is-bad" : "");
    return `<article class="calc-node is-formula ${bad ? "is-error" : ""} ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px;width:${w}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>Формула</span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      ${formulaProfilesHtml(node)}
      <div class="calc-ports">
        <div class="calc-sec">Входы</div>
        ${(node.inputs || [])
          .map(
            (port) => `<div class="calc-row in">
              <i class="calc-port in" data-port="${esc(port.id)}" data-io="in"></i>
              <input class="calc-pname${mark(`in:${port.id}`)}" data-in-name="${esc(port.id)}" value="${esc(port.name)}" maxlength="1" spellcheck="false" title="${esc(formulaBadTitle("letter", badFields.has(`in:${port.id}`)))}" />
              ${linked.has(port.id) ? `<button type="button" class="calc-mini" data-del-in-link="${esc(port.id)}" title="Удалить связь">×</button>` : ""}
              <button type="button" class="calc-mini" data-del-in="${esc(port.id)}" title="Убрать вход">−</button>
            </div>`
          )
          .join("")}
        <button type="button" class="btn small calc-add" data-add-in="1">+ вход</button>
        <div class="calc-sec">Выходы</div>
        ${(node.outputs || [])
          .map((port) => {
            const value = graph.values[`${node.id}:${port.id}`];
            const raw = String(port.expr || "");
            const expr = sanitizeFormulaExpr(raw.includes("=") ? splitAssign(raw).expr : raw);
            const exprBad = badFields.has(`expr:${port.id}`);
            const nameBad = badFields.has(`out:${port.id}`);
            return `<div class="calc-row out formula">
              <input class="calc-expr${mark(`expr:${port.id}`)}" data-out-expr="${esc(port.id)}" value="${esc(expr)}" spellcheck="false" title="${esc(formulaBadTitle("expr", exprBad))}" />
              <span class="calc-eq">=</span>
              <input class="calc-pname${mark(`out:${port.id}`)}" data-out-name="${esc(port.id)}" value="${esc(port.name)}" maxlength="1" spellcheck="false" title="${esc(formulaBadTitle("letter", nameBad))}" />
              <b class="calc-out-val">${esc(fmtShort(value))}</b>
              <i class="calc-port out" data-port="${esc(port.id)}" data-io="out"></i>
              <button type="button" class="calc-mini" data-del-out="${esc(port.id)}" title="Убрать выход">−</button>
            </div>`;
          })
          .join("")}
        <button type="button" class="btn small calc-add" data-add-out="1">+ выход</button>
      </div>
      <i class="calc-resize calc-resize-w" data-resize-formula="${esc(node.id)}" title="Ширина"></i>
    </article>`;
  }

  function constNodeHtml(node, graph) {
    const value = graph.values[`${node.id}:out`];
    const raw = Number.isFinite(Number(node.value)) ? String(node.value) : "0";
    return `<article class="calc-node is-const ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>Константа</span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <input class="calc-const-val" data-const-value="${esc(node.id)}" value="${esc(raw)}" inputmode="decimal" spellcheck="false" title="Число" />
      <textarea class="calc-const-note" data-const-note="${esc(node.id)}" rows="1" maxlength="500" placeholder="Комментарий…" title="Комментарий: что это за число и откуда оно">${esc(node.note || "")}</textarea>
      <div class="calc-ports">
        <div class="calc-row out">
          <span>${esc(fmtShort(value))}</span>
          <i class="calc-port out" data-port="out" data-io="out" title="Выход"></i>
        </div>
      </div>
    </article>`;
  }

  function resultNodeHtml(node, bp, graph) {
    const value = graph.values[`${node.id}:out`];
    const linked = usedInputPorts(node.id, bp.links);
    const prio = Number.isFinite(Number(node.priority)) ? Number(node.priority) : nextResultPriority(bp);
    const shown = resultVisible(node);
    return `<article class="calc-node is-result ${shown ? "" : "is-scheme-off"} ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <input class="calc-result-prio" data-result-prio="${esc(node.id)}" type="number" min="0" max="9999" step="1" value="${prio}" title="Приоритет на схеме (меньше — выше)" aria-label="Приоритет" />
        <input class="calc-pname calc-result-name" data-result-name="${esc(node.id)}" value="${esc(resultName(node))}" maxlength="48" spellcheck="false" title="${esc(resultName(node))}" aria-label="Имя результата" />
        <button type="button" class="calc-eye ${shown ? "" : "is-off"}" data-result-eye="${esc(node.id)}" title="${shown ? "Скрыть из ноды схемы" : "Показать в ноде схемы"}" aria-label="${shown ? "Скрыть из ноды схемы" : "Показать в ноде схемы"}" aria-pressed="${shown ? "true" : "false"}">${resultEyeIcon(shown)}</button>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      ${screenHtml(value, "Значение связи")}
      <div class="calc-ports">
        <div class="calc-row in">
          <i class="calc-port in" data-port="in" data-io="in"></i>
          <span>вход</span>
          ${linked.has("in") ? `<button type="button" class="calc-mini" data-del-in-link="in" title="Удалить связь">×</button>` : ""}
        </div>
        <div class="calc-row out">
          <span>выход</span>
          <i class="calc-port out" data-port="out" data-io="out" title="Выход"></i>
        </div>
      </div>
    </article>`;
  }

  function percentNodeHtml(node, bp, graph) {
    const value = graph.values[`${node.id}:out`];
    const linked = usedInputPorts(node.id, bp.links);
    return `<article class="calc-node is-percent ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>Процент</span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      ${screenHtml(value, "Число × % / 100")}
      <div class="calc-ports">
        ${nodeInputs(node)
          .map(
            (port) => `<div class="calc-row in">
              <i class="calc-port in" data-port="${esc(port.id)}" data-io="in" title="Вход"></i>
              <span>${esc(port.name)}</span>
              ${linked.has(port.id) ? `<button type="button" class="calc-mini" data-del-in-link="${esc(port.id)}" title="Удалить связь">×</button>` : ""}
            </div>`
          )
          .join("")}
        <div class="calc-row out">
          <span>выход</span>
          <i class="calc-port out" data-port="out" data-io="out" title="Выход"></i>
        </div>
      </div>
    </article>`;
  }

  function schemeNodeHtml(node, graph) {
    const other = findBlueprint(node.blueprintId);
    const missing = !other;
    const ports = nodeOutputs(node);
    return `<article class="calc-node is-scheme ${missing ? "is-error" : ""} ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span title="${esc(missing ? "Схема удалена" : (other.name || "Схема"))}">${missing ? "Схема удалена" : esc(other.name || "Схема")}</span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <div class="calc-ports">
        ${
          ports.length
            ? ports
                .map((port) => {
                  const value = graph.values[`${node.id}:${port.id}`];
                  return `<div class="calc-row">
                    <span class="calc-row-name" title="${esc(port.name)}">${esc(port.name)}</span>
                    <b>${esc(fmtShort(value))}</b>
                    <i class="calc-port out" data-port="${esc(port.id)}" data-io="out" title="Выход"></i>
                  </div>`;
                })
                .join("")
            : `<div class="calc-empty">Нет нод «Результат»</div>`
        }
      </div>
    </article>`;
  }

  function groupNodeHtml(node, zIndex) {
    const w = Math.max(160, node.w || 320);
    const h = Math.max(120, node.h || 220);
    const color = String(node.color || "#14b8a6");
    const z = Number.isFinite(zIndex) ? zIndex : 0;
    return `<article class="calc-node is-group ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px;width:${w}px;height:${h}px;z-index:${z};--group-color:${esc(color)}"></article>`;
  }

  function groupChromeHtml(node, zIndex) {
    const w = Math.max(160, node.w || 320);
    const h = Math.max(120, node.h || 220);
    const color = String(node.color || "#14b8a6");
    const name = String(node.name || "").trim() || "Группа";
    const z = Number.isFinite(zIndex) ? zIndex : 0;
    return `<div class="calc-group-chrome ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px;width:${w}px;height:${h}px;z-index:${z};--group-color:${esc(color)}">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить группу · Shift — только рамка"></i>
      <header class="calc-node-h calc-group-h">
        <input class="calc-pname calc-group-name" data-group-name="${esc(node.id)}" value="${esc(name)}" maxlength="48" spellcheck="false" title="${esc(name)}" aria-label="Имя группы" />
        <input class="calc-group-color" data-group-color="${esc(node.id)}" type="color" value="${esc(color)}" title="Цвет группы" />
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <i class="calc-resize" data-resize-group="${esc(node.id)}" title="Изменить размер"></i>
    </div>`;
  }

  function commentNodeHtml(node) {
    return `<article class="calc-node is-comment ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>Комментарий</span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <textarea class="calc-comment" data-comment-text="${esc(node.id)}" rows="4" maxlength="2000" placeholder="Напишите комментарий…" spellcheck="true">${esc(node.text || "")}</textarea>
    </article>`;
  }

  function filterNodeHtml(node, graph) {
    return `<article class="calc-node is-filter ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>Фильтр</span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      ${filterFieldsHtml(node)}
      <div class="calc-ports">
        ${statsPortsHtml(node, FILTER_PORTS, graph)}
      </div>
    </article>`;
  }

  function plannerThumb(points, film, color) {
    const pts = Array.isArray(points) ? points : [];
    if (pts.length < 3) return "";
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    pts.forEach((p) => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    const spanX = Math.max(0.05, maxX - minX);
    const spanY = Math.max(0.05, maxY - minY);
    const size = 64;
    const pad = 3;
    const scale = Math.min((size - pad * 2) / spanX, (size - pad * 2) / spanY);
    const ox = (size - spanX * scale) / 2 - minX * scale;
    const oy = (size - spanY * scale) / 2 - minY * scale;
    const d = pts
      .map((p, i) => `${i ? "L" : "M"}${(ox + p.x * scale).toFixed(1)} ${(oy + p.y * scale).toFixed(1)}`)
      .join("") + "Z";
    const cls = film ? "calc-film-thumb" : "calc-planner-thumb";
    const tone = film && color ? ` style="--film-tone:${esc(color)}"` : "";
    return `<svg class="${cls}"${tone} viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><path d="${d}"/></svg>`;
  }

  function plannerPortRow(node, port, graph) {
    if (port.signal === "plan") {
      return `<div class="calc-row out calc-plan-head">
        <span class="calc-row-name">${esc(port.name)}</span>
        <b class="calc-plan-tag">чертёж</b>
        <i class="calc-port out" data-port="${esc(port.id)}" data-io="out" data-signal="plan" title="${esc(port.name)}"></i>
      </div>`;
    }
    const value = graph.values[`${node.id}:${port.id}`];
    const shown = value != null && Number.isFinite(value) ? value : (port.value ?? port.area);
    const unit = port.unit || (port.common ? "" : "м²");
    const tip = `${port.name} · ${fmtShort(shown)}${unit ? ` ${unit}` : ""}`;
    return `<div class="calc-row out">
      <span class="calc-row-name" title="${esc(tip)}">${esc(port.name)}</span>
      <b>${esc(fmtShort(shown))}${unit ? ` <small>${esc(unit)}</small>` : ""}</b>
      <i class="calc-port out" data-port="${esc(port.id)}" data-io="out" title="${esc(tip)}"></i>
    </div>`;
  }

  function plannerNodeHtml(node, bp, graph) {
    ensurePlanner(node);
    const model = plannerModel(node);
    const ports = plannerOutputs(node, bp.links);
    const sub = `пол ${fmtShort(model.floor)} м² · ${model.walls.length} стен · h ${fmtShort(model.height)} м`;

    const film = node.layouts.map((layout) => `<div class="calc-film-card ${layout.id === node.layoutId ? "is-on" : ""}" data-planner-layout="${esc(layout.id)}" title="${esc(layout.name)}"><span class="calc-film-name">${esc(layout.name)}</span>${plannerThumb(layout.points, true, layout.color)}<button type="button" class="calc-film-delete" data-del-planner-layout="${esc(layout.id)}" title="Удалить планировку" aria-label="Удалить планировку ${esc(layout.name)}" ${node.layouts.length <= 1 ? "disabled" : ""}>×</button></div>`).join("");
    const groups = node.layouts.map((layout) => {
      const rows = ports.filter((port) => port.layoutId === layout.id && !port.common);
      return `<div class="calc-plan-group" style="--planner-color:${esc(layout.color)}">${rows.map((port) => plannerPortRow(node, port, graph)).join("")}</div>`;
    }).join("");
    const commons = ports.filter((port) => port.common);
    return `<article class="calc-node is-planner ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px;--planner-color:${esc(node.color || "#65a30d")}">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <input class="calc-pname calc-planner-name" data-planner-title="${esc(node.id)}" value="${esc(plannerName(node))}" maxlength="48" spellcheck="false" title="${esc(plannerName(node))}" aria-label="Имя планировщика" />
        <input class="calc-planner-color" type="color" data-planner-color="${esc(node.id)}" value="${esc(node.color || "#65a30d")}" title="Цвет текущей планировки" aria-label="Цвет текущей планировки" />
        <button type="button" class="calc-text-btn" data-planner-edit="${esc(node.id)}" title="План пола и площади">Редактор</button>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <div class="calc-film calc-film-top">${film}</div>
      <div class="calc-node-sub">${esc(sub)}</div>
      <div class="calc-ports">${groups || `<div class="calc-empty">Включите выходы в редакторе</div>`}${commonBlockHtml(node, commons, graph, (port) => plannerPortRow(node, port, graph))}</div>
    </article>`;
  }

  function dashboardNodeHtml(node, bp, graph) {
    const ports = nodeOutputs(node, null, bp.links).map((port) => port.id);
    return `<article class="calc-node is-dashboard ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>Дашборд</span>
        <button type="button" class="calc-mini calc-dash-ports" data-dash-ports="${esc(node.id)}" title="Порты метрик">+</button>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      ${filterFieldsHtml(node)}
      <div class="calc-ports">
        ${statsPortsHtml(node, ports, graph, "ПКМ / + — выбрать порты")}
      </div>
    </article>`;
  }

  function presentNodeHtml(node, bp, graph) {
    const found = window.FinPresent?.findBlock?.(node.blockId);
    const title = found?.block?.title || node.title || "Блок";
    const pageName = found?.page?.name || "Страница";
    const meta = window.FinPresent?.blockMeta?.(node.blockType || found?.block?.type || "metric");
    const linked = usedInputPorts(node.id, bp.links);
    const ports = presentPorts(node);
    return `<article class="calc-node is-present ${session.selected === node.id ? "is-on" : ""} ${session.presentHover && session.presentHover === node.blockId ? "is-present-hl" : ""}" data-node="${esc(node.id)}" data-present-block-id="${esc(node.blockId || "")}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span title="${esc(pageName)} · ${esc(title)}"><span class="pres-tool-ico" aria-hidden="true">${esc(meta?.ico || "▣")}</span><span class="pres-tool-name">${esc(title)}</span></span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <div class="calc-node-sub">${esc(pageName)} · ${esc(meta?.name || node.blockType || "")}</div>
      <div class="calc-ports">
        ${
          ports.length
            ? ports
                .map((port) => {
                  const value = graph.values[`${node.id}:${port.id}`];
                  const owner = presentOwner(node.blockId, port.id, bp.id);
                  const locked = !!owner && !linked.has(port.id);
                  const tip = locked
                    ? `Занято схемой «${owner.blueprint.name || "Схема"}». ПКМ — освободить.`
                    : port.name;
                  return `<div class="calc-row in ${locked ? "is-locked" : ""}" title="${esc(tip)}">
                    <i class="calc-port in ${locked ? "is-locked" : ""}" data-port="${esc(port.id)}" data-io="in" data-present-lock="${locked ? "1" : ""}" title="${esc(tip)}"></i>
                    <span>${esc(port.name)}</span>
                    <b>${esc(fmtShort(value))}</b>
                    ${linked.has(port.id) ? `<button type="button" class="calc-mini" data-del-in-link="${esc(port.id)}" title="Удалить связь">×</button>` : ""}
                  </div>`;
                })
                .join("")
            : `<div class="calc-empty">Нет входов</div>`
        }
      </div>
    </article>`;
  }

  function fitScreenNodes() {
    const host = nodesRoot();
    if (!host) return;
    host.querySelectorAll(".calc-node.is-math, .calc-node.is-result, .calc-node.is-percent, .calc-node.is-const").forEach((el) => {
      el.style.width = "";
      const screen = el.querySelector(".calc-screen-val, .calc-const-val");
      if (!screen) return;
      const btn = el.querySelector(".calc-screen-copy");
      const pad = 16 + (btn ? btn.offsetWidth + 8 : 0);
      const need = Math.ceil(Math.max(screen.scrollWidth, screen.offsetWidth) + pad);
      const isResult = el.classList.contains("is-result");
      const minW = isResult ? 376 : 188;
      const maxW = isResult ? 1040 : 520;
      const width = Math.min(maxW, Math.max(minW, need));
      el.style.width = `${width}px`;
    });
  }

  function patchGraphLive() {
    const bp = activeBlueprint();
    if (!bp || session.busy) return;
    rebuildPresentValues();
    const graph = computeGraph(bp);
    flushOrderWrites();
    const host = nodesRoot();
    if (!host) return;
    host.querySelectorAll(".calc-node").forEach((el) => {
      const nodeId = el.dataset.node;
      if (!nodeId) return;
      el.querySelectorAll(".calc-out-val").forEach((box) => {
        const expr = box.closest(".calc-row")?.querySelector("[data-out-expr]");
        if (!expr) return;
        box.textContent = fmtShort(graph.values[`${nodeId}:${expr.dataset.outExpr}`]);
      });
      el.querySelectorAll(".calc-row.out > b:not(.calc-out-val), .calc-row.both > b:not(.calc-out-val), .calc-row.in > b:not(.calc-out-val)").forEach((box) => {
        const row = box.closest(".calc-row");
        if (!row) return;
        const outPort = row.querySelector(".calc-port.out");
        const inPort = row.querySelector(".calc-port.in");
        const portId = outPort?.dataset.port || inPort?.dataset.port;
        if (!portId) return;
        const value = graph.values[`${nodeId}:${portId}`];
        box.textContent = fmtShort(value);
      });
      el.querySelectorAll(".calc-row.out > span").forEach((box) => {
        if (box.classList.contains("calc-row-name")) return;
        const port = box.closest(".calc-row")?.querySelector(".calc-port.out");
        if (!port) return;
        box.textContent = fmtShort(graph.values[`${nodeId}:${port.dataset.port}`]);
      });
      const screen = el.querySelector(".calc-screen-val");
      if (screen) {
        const value = graph.values[`${nodeId}:out`];
        screen.textContent = fmtShort(value);
        const btn = el.querySelector(".calc-screen-copy");
        if (btn) {
          const copy = fmtCopy(value);
          btn.dataset.copy = copy || "";
          btn.classList.toggle("is-off", !copy);
          btn.disabled = !copy;
        }
      }
    });
    paintFormulaErrors(host, graph);
    fitScreenNodes();
    requestAnimationFrame(() => {
      drawWires(bp, graph);
      drawMinimap(bp);
    });
  }

