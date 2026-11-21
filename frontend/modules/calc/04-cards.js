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
        <button type="button" class="planner-common-toggle" id="mark-common-toggle" aria-label="Открыть общий вывод" aria-pressed="false" title="Общий вывод">Σ</button>
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
              <div id="mark-edge" class="mark-edge" hidden></div>
              <form id="mark-nudge-box" class="planner-nudge-box" hidden>
                <input id="mark-nudge-input" inputmode="decimal" autocomplete="off" placeholder="0" aria-label="Сдвиг, сантиметры" />
                <span>см</span>
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
              : node.type === "tiles"
                ? "Типы плитки и раскладка этой ноды будут сброшены."
                : "Все добавленные розетки, рамки и светильники будут удалены.",
            ok: "Сбросить",
            danger: true,
          })
        : true;
      if (!ok || !markNode()) return;
      if (node.type === "openings") {
        node.holes = [];
        node.owns = [];
      } else if (node.type === "tiles") {
        node.tiles = [];
        node.lays = [];
        node.outOn = {};
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
    $("mark-common-toggle")?.addEventListener("click", () => {
      if (!session.mark) return;
      session.mark.view = session.mark.view === COMMON_VIEW ? "" : COMMON_VIEW;
      const menu = $("mark-layout-menu");
      if (menu) menu.hidden = true;
      $("mark-layout-trigger")?.setAttribute("aria-expanded", "false");
      markCommit(true);
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
      if (ctx.node.type === "tiles" && e.button === 0) {
        const piece = tilePieceAt(x, y);
        session.mark.tileSel = piece && session.mark.tileSel === piece.id ? "" : (piece?.id || "");
        tileTipHide();
        markDraw();
        if (piece) return;
      }
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
      if (!drag && markNode()?.type === "tiles") {
        const canvas = $("mark-canvas");
        const rect = canvas.getBoundingClientRect();
        const piece = tilePieceAt(e.clientX - rect.left, e.clientY - rect.top);
        canvas.style.cursor = piece ? "pointer" : "";
      }
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
    $("mark-canvas")?.addEventListener("pointerleave", () => {
      tileTipHide();
      const canvas = $("mark-canvas");
      if (canvas && !session.mark?.drag) canvas.style.cursor = "";
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
      const ok = !!(node && menu?.hitId && dir && value != null && markShift(node, menu.hitId, dir, value / 100));
      $("mark-nudge-box")?.classList.toggle("is-bad", !ok);
      if (ok) {
        markCommit(false);
        markEdgeHtml(node, menu.hitId);
      }
    });
    $("mark-edge")?.addEventListener("click", (e) => {
      const pickBtn = e.target.closest(".mark-select-btn");
      if (pickBtn) {
        e.preventDefault();
        e.stopPropagation();
        placeMarkList(pickBtn);
        return;
      }
      const opt = e.target.closest(".mark-opt");
      if (!opt || !("edgeFrom" in opt.dataset)) return;
      const node = markNode();
      const hit = session.mark?.menu?.hitId;
      const hole = node?.holes?.find((item) => item.id === hit);
      if (!hole) return;
      hole.edgeFrom = opt.dataset.opt || "";
      document.querySelectorAll(".mark-select-list").forEach((el) => { el.hidden = true; });
      markEdgeHtml(node, hit);
      markCommit(false);
    });
    $("mark-edge")?.addEventListener("change", (e) => {
      const node = markNode();
      const hit = session.mark?.menu?.hitId;
      if (!node || !hit) return;
      if (e.target.matches("[data-edge-center]")) {
        const hole = node.holes.find((item) => item.id === hit);
        if (hole) hole.fromCenter = !!e.target.checked;
        markEdgeHtml(node, hit);
        markCommit(false);
        return;
      }
      const side = e.target.dataset?.edge;
      if (!side) return;
      const cm = plannerDraft(e.target.value);
      if (cm == null || !markApplyEdge(node, hit, side, cm)) return;
      markCommit(false);
      markEdgeHtml(node, hit);
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
    $("mark-side")?.addEventListener("toggle", (e) => {
      if (!(e.target instanceof HTMLDetailsElement) || !e.target.classList.contains("tile-types-collapse")) return;
      try { window.localStorage.setItem("finmaster.tilePreview.cardsOpen", e.target.open ? "true" : "false"); } catch { /* storage may be unavailable */ }
    }, true);
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
        if (node.type === "tiles" && opt.dataset.tilePattern) {
          const tile = node.tiles.find((item) => item.id === opt.dataset.tilePattern);
          if (tile && TILE_PATTERNS.some((item) => item[0] === value)) {
            tile.pattern = value;
            tileFitRatio(tile);
          }
          markCommit(true);
          return;
        }
        if (node.type === "tiles" && opt.dataset.tileUse) {
          const face = tileFaceOf(markContext()?.base, session.mark?.surface || "floor");
          const host = markContext();
          if (host?.feed && face) tileLayWrite(node, host.feed.id, face.surface, face.wall?.id || "", { tileId: value });
          markCommit(true);
          return;
        }
        if (node.type === "tiles" && opt.dataset.tileDir) {
          const dir = [0, 90, 180, 270].includes(Number(value)) ? Number(value) : 0;
          const host = markContext();
          const face = tileFaceOf(host?.base, session.mark?.surface || "floor");
          if (host?.feed && face) tileLayWrite(node, host.feed.id, face.surface, face.wall?.id || "", { dir });
          markCommit(true);
          return;
        }
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
      const tileDimMode = e.target.closest("[data-tile-dim-mode]");
      if (tileDimMode && node.type === "tiles") {
        const mode = tileDimMode.dataset.tileDimMode;
        if (!["tile", "cuts", "holes", "offsets"].includes(mode)) return;
        try { window.localStorage.setItem("finmaster.tilePreview.dimMode", mode); } catch { /* storage may be unavailable */ }
        markDraw();
        return;
      }
      const tileAdd = e.target.closest("[data-tile-add]");
      if (tileAdd && node.type === "tiles") {
        if (node.tiles.length >= 16) return;
        const n = node.tiles.length + 1;
        const colors = ["#d6c4a8", "#94a3b8", "#c4b5a0", "#a8a29e", "#d6d3d1", "#e7e5e4"];
        const id = uid();
        node.tiles.push({ id, name: `Плитка ${n}`, pattern: "rect", w: 0.6, h: 0.6, color: colors[(n - 1) % colors.length], gap: 0.001, bond: 0, bondRows: 1, noPairs: false, grout: "#a8a29e" });
        if (!node.outOn || typeof node.outOn !== "object") node.outOn = {};
        (node.feeds || []).forEach((feed) => { node.outOn[feedKey(feed, "tile", id)] = true; });
        markCommit(true);
        return;
      }
      const tileDel = e.target.closest("[data-tile-del]");
      if (tileDel && node.type === "tiles") {
        const id = tileDel.dataset.tileDel;
        node.tiles = node.tiles.filter((item) => item.id !== id);
        node.lays.forEach((lay) => {
          if (lay.tileId === id) lay.tileId = "";
        });
        Object.keys(node.outOn || {}).forEach((key) => {
          if (key.includes(id)) delete node.outOn[key];
        });
        markCommit(true);
        return;
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
      if (e.target?.dataset?.commonName || e.target?.dataset?.commonInputName) {
        markCommit(false);
        return;
      }
      if (handleCommonChange(e, node)) {
        markCommit(!!e.target?.dataset?.commonOn);
        return;
      }
      if (e.target?.dataset && "tileOpen" in e.target.dataset && node.type === "tiles") {
        const host = markContext();
        const face = tileFaceOf(host?.base, session.mark?.surface || "floor");
        if (host?.feed && face) tileLayWrite(node, host.feed.id, face.surface, face.wall?.id || "", { openings: !!e.target.checked });
        markCommit(true);
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
      if (node?.type === "tiles") {
        const named = e.target.dataset?.tileName;
        if (named) {
          const tile = node.tiles.find((item) => item.id === named);
          const value = String(e.target.value || "").trim().slice(0, 48);
          if (tile && value) {
            tile.name = value;
            $("mark-side")?.querySelectorAll(".mark-opt[data-tile-use]").forEach((option) => {
              if (option.dataset.opt !== named) return;
              option.textContent = value;
              if (option.classList.contains("is-on")) {
                const button = option.closest(".mark-select")?.querySelector(".mark-select-btn");
                if (button) button.textContent = value;
              }
            });
          }
          markCommit(false);
          return;
        }
        const widthId = e.target.dataset?.tileW;
        const heightId = e.target.dataset?.tileH;
        if (widthId || heightId) {
          const tile = node.tiles.find((item) => item.id === (widthId || heightId));
          const value = tileFromCm(e.target.value, null, 0.02, 3);
          if (tile && value != null) {
            const linked = tile.pattern === "quad" || tile.pattern === "honeycomb";
            if (tile.pattern === "quad") {
              if (widthId) {
                tile.w = value;
                tile.h = plannerRound(plannerClamp(value * 2, 0.02, 3));
              } else {
                tile.h = value;
                tile.w = plannerRound(plannerClamp(value / 2, 0.02, 3));
              }
            } else if (tile.pattern === "honeycomb") {
              tile.w = value;
              tileFitRatio(tile);
            } else if (widthId) tile.w = value;
            else tile.h = value;
            markCommit(linked);
          }
          return;
        }
        const colorId = e.target.dataset?.tileColor;
        const groutId = e.target.dataset?.tileGrout;
        if (colorId || groutId) {
          const tile = node.tiles.find((item) => item.id === (colorId || groutId));
          if (tile) {
            if (colorId) tile.color = markHex(e.target.value, tile.color);
            else tile.grout = markHex(e.target.value, tile.grout || "#a8a29e");
          }
          markCommit(false);
          return;
        }
        const noPairsId = e.target.dataset?.tileNoPairs;
        if (noPairsId) {
          const tile = node.tiles.find((item) => item.id === noPairsId);
          if (tile) tile.noPairs = !!e.target.checked;
          markCommit(false);
          return;
        }
        const bondId = e.target.dataset?.tileBond;
        if (bondId) {
          const tile = node.tiles.find((item) => item.id === bondId);
          const cm = plannerDraft(e.target.value);
          if (tile && cm != null && tile.w > 0) {
            const offset = ((cm / 100) % tile.w + tile.w) % tile.w;
            tile.bond = plannerRound(offset / tile.w);
          }
          markCommit(false);
          return;
        }
        const bondRowsId = e.target.dataset?.tileBondRows;
        if (bondRowsId) {
          const tile = node.tiles.find((item) => item.id === bondRowsId);
          const rows = plannerDraft(e.target.value);
          if (tile && rows != null) tile.bondRows = Math.round(plannerClamp(rows, 1, 30));
          markCommit(false);
          return;
        }
        const gapId = e.target.dataset?.tileGap;
        if (gapId) {
          const tile = node.tiles.find((item) => item.id === gapId);
          const mm = plannerDraft(e.target.value);
          if (tile && mm != null) tile.gap = plannerRound(plannerClamp(mm / 1000, 0, 0.03));
          markCommit(false);
          return;
        }
        if ("tileTurn" in (e.target.dataset || {})) {
          const deg = plannerDraft(e.target.value);
          if (deg != null) {
            const host = markContext();
            const face = tileFaceOf(host?.base, session.mark?.surface || "floor");
            const turn = plannerRound(((deg % 360) + 360) % 360);
            if (host?.feed && face) tileLayWrite(node, host.feed.id, face.surface, face.wall?.id || "", { turn });
            markCommit(false);
          }
          return;
        }
        const field = e.target.dataset?.tileField;
        if (field) {
          const shift = field === "shiftX" || field === "shiftY";
          const tol = field === "tolW" || field === "tolH";
          const value = tileFromCm(e.target.value, null, shift ? -5 : 0, shift ? 5 : tol ? 0.3 : 5);
          if (value != null) {
            const host = markContext();
            const face = tileFaceOf(host?.base, session.mark?.surface || "floor");
            if (host?.feed && face) tileLayWrite(node, host.feed.id, face.surface, face.wall?.id || "", { [field]: value });
            markCommit(false);
          }
        }
        return;
      }
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

  function blankNode(type, extra) {
    const node = { id: uid(), type, x: 0, y: 0 };
    const color = GROUP_COLORS[0];
    if (type === "math") node.op = "+";
    if (type === "result") {
      node.op = "result";
      node.name = "Результат";
      node.priority = 1;
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
    if (type === "filter" || type === "dashboard") {
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
    if (type === "dashboard") node.openPorts = DASH_DEFAULT.slice();
    if (type === "planner") {
      const ids = [uid(), uid(), uid(), uid()];
      node.name = "Планировщик";
      node.color = color;
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
      node.color = color;
      node.holes = [];
      node.outOn = {};
      node.owns = [];
      node.view = "floor";
    }
    if (type === "electrics") {
      node.name = "Электрика";
      node.color = color;
      node.fixtures = [];
      node.outOn = {};
      node.view = "floor";
    }
    if (type === "tiles") {
      node.name = "Плитка";
      node.color = color;
      node.tiles = [];
      node.lays = [];
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
      node.color = color;
      node.w = 320;
      node.h = 220;
    }
    if (type === "comment") node.text = "";
    if (type === "joint" || type === "teleport") {
      node.signal = "num";
      node.tone = "";
    }
    if (type === "teleport") {
      node.label = "";
      node.labelSet = false;
      node.title = "";
    }
    if (type === "teleout") {
      node.title = "";
      node.ports = extra?.source ? [{ id: uid(), source: extra.source }] : [];
    }
    if (type === "bus") node.lanes = [{ id: uid(), signal: "num", tone: "" }];
    return node;
  }

  function fitGroupAroundSelection(node) {
    const bp = activeBlueprint();
    const nodes = (bp?.nodes || []).filter((item) => selectionIds().has(item.id));
    if (!nodes.length) return false;
    const padX = 24;
    const padTop = 48;
    const padBottom = 24;
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    nodes.forEach((item) => {
      const rect = nodeRect(item);
      x1 = Math.min(x1, rect.x);
      y1 = Math.min(y1, rect.y);
      x2 = Math.max(x2, rect.x + rect.w);
      y2 = Math.max(y2, rect.y + rect.h);
    });
    let x = x1 - padX;
    let y = y1 - padTop;
    let w = Math.max(160, x2 - x1 + padX * 2);
    let h = Math.max(120, y2 - y1 + padTop + padBottom);
    if (w > x2 - x1 + padX * 2) x -= (w - (x2 - x1 + padX * 2)) / 2;
    if (h > y2 - y1 + padTop + padBottom) y -= (h - (y2 - y1 + padTop + padBottom)) / 2;
    if (session.wireSnap) {
      const right = x + w;
      const bottom = y + h;
      x = Math.floor(x / SNAP) * SNAP;
      y = Math.floor(y / SNAP) * SNAP;
      w = Math.max(160, Math.ceil(right / SNAP) * SNAP - x);
      h = Math.max(120, Math.ceil(bottom / SNAP) * SNAP - y);
    }
    node.x = x;
    node.y = y;
    node.w = w;
    node.h = h;
    return true;
  }

  function addNode(type, point, extra) {
    const bp = activeBlueprint();
    if (!bp) return;
    if (type === "teleout" && !teleportHost(bp, extra?.source)) return;
    const at = point || viewCenter(bp);
    session.place += 1;
    const node = blankNode(type, extra);
    loadWirePrefs();
    const wrapped = type === "group" && !point && fitGroupAroundSelection(node);
    if (!wrapped) {
      node.x = session.wireSnap ? snapCoord(at.x) : at.x;
      node.y = session.wireSnap ? snapCoord(at.y) : at.y;
    }
    if (type === "result") node.priority = nextResultPriority(bp);
    if (type === "planner" || type === "openings" || type === "electrics" || type === "tiles" || type === "group") {
      node.color = GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)];
    }
    bp.nodes.push(node);
    session.selected = node.id;
    dirty();
    render();
  }

  function removeNode(id) {
    removeNodes(id ? [id] : []);
  }

  function jointOuts(bp, id) {
    return (bp.links || []).filter((link) => link.from === id && link.fromPort === "out");
  }

  function bridgeJoint(bp, id, keep) {
    const incoming = (bp.links || []).find((link) => link.to === id && link.toPort === "in");
    bp.links = (bp.links || []).filter((link) => link.from !== id && link.to !== id);
    if (incoming && keep) {
      const same = bp.links.some((link) => link.from === incoming.from && link.fromPort === incoming.fromPort && link.to === keep.to && link.toPort === keep.toPort);
      if (!same) bp.links.push({ id: uid(), from: incoming.from, fromPort: incoming.fromPort, to: keep.to, toPort: keep.toPort });
    }
    bp.nodes = (bp.nodes || []).filter((node) => node.id !== id);
    session.picked?.delete(id);
    if (session.selected === id) {
      session.selected = "";
      session.picked = new Set();
    }
    session.jointCut = "";
    session.busy = false;
    session.linking = null;
    syncPassNodes(bp);
    dirty();
    render();
  }

  function takeJointDelete(bp, id) {
    const node = (bp.nodes || []).find((item) => item.id === id);
    if (!node || node.type !== "joint") return false;
    const outs = jointOuts(bp, id);
    if (outs.length > 1 && session.jointCut !== id) {
      session.jointCut = id;
      session.selected = id;
      session.selectedLink = "";
      drawWires(bp, computeGraph(bp));
      return true;
    }
    bridgeJoint(bp, id, outs[0] || null);
    return true;
  }

  function teleportSourcesIn(bp, drop) {
    const sources = new Set();
    (bp.nodes || []).forEach((node) => {
      if (drop.has(node.id) && node.type === "teleport") teleportEntries(node).forEach((port) => sources.add(port.id));
    });
    return sources;
  }

  function teleportHasOutlets(bp, sources) {
    if (!sources.size) return false;
    return (bp.nodes || []).some((node) => node.type === "teleout" && (node.ports || []).some((port) => sources.has(port.source)));
  }

  function stripTeleportPorts(bp, drop) {
    const sources = teleportSourcesIn(bp, drop);
    if (!sources.size) return;
    (bp.nodes || []).forEach((node) => {
      if (node.type !== "teleout" || drop.has(node.id)) return;
      const gone = (node.ports || []).filter((port) => sources.has(port.source));
      if (!gone.length) return;
      const ids = new Set(gone.map((port) => `out:${port.id}`));
      node.ports = (node.ports || []).filter((port) => !sources.has(port.source));
      bp.links = (bp.links || []).filter((link) => !(link.from === node.id && ids.has(link.fromPort)));
      if (!node.ports.length) drop.add(node.id);
    });
  }

  function finishRemove(bp, drop) {
    stripTeleportPorts(bp, drop);
    if (session.jointCut) session.jointCut = "";
    bp.nodes = (bp.nodes || []).filter((node) => !drop.has(node.id));
    bp.links = (bp.links || []).filter((link) => !drop.has(link.from) && !drop.has(link.to));
    drop.forEach((nid) => session.picked?.delete(nid));
    if (!session.selected || drop.has(session.selected)) session.selected = [...(session.picked || [])].find((nid) => !drop.has(nid)) || "";
    if (!session.selected) session.picked = new Set();
    dirty();
    render();
  }

  function removeNodes(ids) {
    const bp = activeBlueprint();
    const drop = new Set((ids || []).filter(Boolean));
    if (!bp || !drop.size) return;
    if (drop.size === 1 && takeJointDelete(bp, [...drop][0])) return;
    const sources = teleportSourcesIn(bp, drop);
    if (teleportHasOutlets(bp, sources)) {
      const ask = api?.confirm || api?.askConfirm;
      if (!ask) {
        finishRemove(bp, drop);
        return;
      }
      void ask({
        title: "Удалить телепорт?",
        text: "Вместе с ним пропадут его выходы на этой схеме.",
        ok: "Удалить",
        danger: true,
      }).then((ok) => {
        if (!ok || activeBlueprint() !== bp) return;
        finishRemove(bp, drop);
      });
      return;
    }
    finishRemove(bp, drop);
  }

  let nodeClip = null;

  function nodeSnapshot(ids) {
    const bp = activeBlueprint();
    const idSet = new Set(ids || []);
    if (!bp || !idSet.size) return null;
    const nodes = [];
    idSet.forEach((srcId) => {
      const src = (bp.nodes || []).find((node) => node.id === srcId);
      if (!src) return;
      try {
        nodes.push(JSON.parse(JSON.stringify(src)));
      } catch {
        /* битую ноду в буфер не кладём */
      }
    });
    if (!nodes.length) return null;
    const links = (bp.links || [])
      .filter((link) => idSet.has(link.from) || idSet.has(link.to))
      .map((link) => ({ from: link.from, fromPort: link.fromPort, to: link.to, toPort: link.toPort }));
    return { nodes, links, fromBp: bp.id };
  }

  function placeNodeCopies(sources, links, shiftX, shiftY) {
    const bp = activeBlueprint();
    if (!bp || !sources?.length) return;
    const map = new Map();
    const portMap = new Map();
    const sourceMap = new Map();
    const clones = [];
    const have = new Set((bp.nodes || []).map((node) => node.id));
    sources.forEach((src) => {
      let clone;
      try {
        clone = JSON.parse(JSON.stringify(src));
      } catch {
        return;
      }
      const prev = src.id;
      clone.id = uid();
      clone.x = (Number(src.x) || 0) + (shiftX || 0);
      clone.y = (Number(src.y) || 0) + (shiftY || 0);
      const ports = {};
      if (clone.type === "formula") {
        (clone.inputs || []).forEach((port) => {
          const next = uid();
          ports[port.id] = next;
          port.id = next;
        });
        (clone.outputs || []).forEach((port) => {
          const next = uid();
          ports[port.id] = next;
          port.id = next;
        });
      }
      if (clone.type === "teleport") {
        if (Array.isArray(clone.ports) && clone.ports.length) {
          clone.ports.forEach((port) => {
            const next = port.id === prev ? clone.id : uid();
            sourceMap.set(port.id, next);
            ports[`in:${port.id}`] = `in:${next}`;
            if (port.id === prev) ports.in = `in:${next}`;
            port.id = next;
          });
        } else sourceMap.set(prev, clone.id);
      }
      if (clone.type === "teleout") {
        (clone.ports || []).forEach((port) => {
          const next = uid();
          ports[`out:${port.id}`] = `out:${next}`;
          port.id = next;
        });
      }
      map.set(prev, clone.id);
      portMap.set(prev, ports);
      clones.push(clone);
    });
    clones.forEach((clone) => {
      if (clone.type !== "teleout") return;
      clone.ports = (clone.ports || []).map((port) => ({
        ...port,
        source: sourceMap.get(port.source) || map.get(port.source) || (have.has(port.source) ? port.source : ""),
      })).filter((port) => port.source);
    });
    const kept = clones.filter((clone) => clone.type !== "teleout" || (clone.ports || []).length);
    if (!kept.length) return;
    bp.nodes.push(...kept);
    kept.forEach((clone) => {
      if (clone.type === "result") clone.priority = nextResultPriority(bp);
    });
    const takenOrder = new Set();
    const takenPort = new Set();
    (bp.links || []).forEach((link) => takenPort.add(`${link.to}|${link.toPort}`));
    const remapPort = (nodeId, portId) => portMap.get(nodeId)?.[portId] || portId;
    const extra = [];
    (links || []).forEach((link) => {
      if (!map.has(link.from) && !map.has(link.to)) return;
      const from = map.get(link.from) || (have.has(link.from) ? link.from : "");
      const to = map.get(link.to) || (have.has(link.to) ? link.to : "");
      if (!from || !to || from === to) return;
      const fromPort = remapPort(link.from, link.fromPort);
      const toPort = remapPort(link.to, link.toPort);
      const dst = (bp.nodes || []).find((node) => node.id === to);
      if (dst?.type === "order") {
        const parsed = parseLinePort(toPort);
        if (parsed?.input && parsed.field) {
          const key = `${dst.orderId}|${parsed.lineId}|${parsed.field}`;
          if (takenOrder.has(key) || orderFieldOwner(dst.orderId, parsed.lineId, parsed.field)) return;
          takenOrder.add(key);
        }
      }
      if (dst?.type === "present" && dst.blockId && presentOwner(dst.blockId, toPort)) return;
      const portKey = `${to}|${toPort}`;
      if (takenPort.has(portKey)) return;
      takenPort.add(portKey);
      extra.push({ id: uid(), from, fromPort, to, toPort });
    });
    const liveIds = new Set((bp.nodes || []).map((node) => node.id));
    bp.links.push(...extra.filter((link) => liveIds.has(link.from) && liveIds.has(link.to)));
    selectNodes(kept.map((node) => node.id), kept[0].id);
    dirty();
    render();
    if (extra.some((link) => (bp.nodes || []).some((node) => node.id === link.to && node.type === "order"))) api?.refreshOrders?.();
  }

  function duplicateNode(id) {
    const picked = [...selectionIds()];
    const ids = picked.length && (!id || picked.includes(id)) ? picked : id ? [id] : [];
    const snap = nodeSnapshot(ids);
    if (!snap) return;
    placeNodeCopies(snap.nodes, snap.links, 48, 48);
  }

  function copyNodes(cut) {
    const snap = nodeSnapshot([...selectionIds()]);
    if (!snap) return;
    nodeClip = { ...snap, sameGen: 0, crossBp: "", crossGen: 0, cross: null };
    if (cut) removeNodes(snap.nodes.map((node) => node.id));
  }

  function pasteNodes() {
    const clip = nodeClip;
    const bp = activeBlueprint();
    if (!clip?.nodes?.length || !bp) return;
    let shiftX = 0;
    let shiftY = 0;
    if (clip.fromBp === bp.id) {
      clip.sameGen += 1;
      shiftX = 48 * clip.sameGen;
      shiftY = shiftX;
    } else {
      if (clip.crossBp !== bp.id) {
        const xs = clip.nodes.map((node) => Number(node.x) || 0);
        const ys = clip.nodes.map((node) => Number(node.y) || 0);
        const center = viewCenter(bp);
        clip.cross = {
          x: center.x - (Math.min(...xs) + Math.max(...xs)) / 2,
          y: center.y - (Math.min(...ys) + Math.max(...ys)) / 2,
        };
        clip.crossBp = bp.id;
        clip.crossGen = 0;
      }
      clip.crossGen += 1;
      shiftX = clip.cross.x + 48 * (clip.crossGen - 1);
      shiftY = clip.cross.y + 48 * (clip.crossGen - 1);
    }
    placeNodeCopies(clip.nodes, clip.links, shiftX, shiftY);
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
    bp.nodes = (bp.nodes || []).filter((node) => node.type === "scheme" || node.type === "group" || node.type === "comment" || node.type === "teleport" || linked.has(node.id));
    const removed = before - bp.nodes.length;
    if (!removed) return 0;
    const keep = new Set(bp.nodes.map((node) => node.id));
    bp.links = (bp.links || []).filter((link) => keep.has(link.from) && keep.has(link.to));
    if (session.picked) [...session.picked].forEach((nid) => { if (!keep.has(nid)) session.picked.delete(nid); });
    if (session.selected && !keep.has(session.selected)) session.selected = [...(session.picked || [])][0] || "";
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
    if (!passSignalOk(src, fromHit, dst, port, bp.links)) {
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
    syncPassNodes(bp);
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
      syncPassNodes(bp);
      dirty();
      render();
      api?.refreshOrders?.();
    }
  }

  function finishLink(from, fromPort, to, toPort) {
    session.linking = null;
    session.busy = false;
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
      syncPassNodes(bp);
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

  function calcToolButton(type, label, icon, peek) {
    return `<button type="button" class="btn calc-tool" data-add-node="${esc(type)}" data-peek="${esc(peek || type)}"><svg class="calc-tool-ico" viewBox="0 0 16 16" aria-hidden="true">${icon}</svg>${label}</button>`;
  }

  function calcGroupButton(id, label, icon) {
    return `<button type="button" class="btn calc-tool calc-group-btn" data-palette="${esc(id)}" title="${esc(label)}"><svg class="calc-tool-ico" viewBox="0 0 16 16" aria-hidden="true">${icon}</svg><span class="calc-tool-name">${esc(label)}</span></button>`;
  }

  const FOLD_ICONS = {
    nodes: `<rect x="2.2" y="2.2" width="4.8" height="4.8" rx="1"/><rect x="9" y="2.2" width="4.8" height="4.8" rx="1"/><rect x="2.2" y="9" width="4.8" height="4.8" rx="1"/><rect x="9" y="9" width="4.8" height="4.8" rx="1"/>`,
    orders: `<path d="M3.2 2.6h6.2L12.6 5.6v7.8H3.2z"/><path d="M5 7.4h5M5 9.6h3.4"/>`,
  };

  const PALETTE_ICONS = {
    logic: `<path d="M4 4.2h3.2M8.8 4.2H12M8 4.2v3.2M4.6 11.2h2.4M9 11.2h2.4M8 7.4 5.8 11.2M8 7.4l2.2 3.8"/>`,
    summary: `<path d="M3 13V8.4M8 13V3.6M13 13V6.4M2.2 13h11.6"/>`,
    plan: `<path d="M3 3.2h10v9.6H3zM3 7.4h4.2"/>`,
    marks: `<rect x="3" y="3.2" width="10" height="9.6" rx="1.6" stroke-dasharray="2.2 1.4"/>`,
    schemes: `<path d="M12.6 3.2H3.6L8.4 8 3.6 12.8h9"/>`,
    present: `<path d="M3 3.2h10v9.6H3zM5.2 10.2V7.4M8 10.2V5.2M10.8 10.2V8"/>`,
    week: `<circle cx="8" cy="8" r="4.8"/><path d="M8 5.6V8l1.8 1.2"/>`,
    month: `<path d="M3.2 4.2h9.6v8.6H3.2zM3.2 7h9.6M6 3v2.2M10 3v2.2"/>`,
    quarter: `<path d="M3 3.2h4.4v4.4H3zM8.6 3.2H13v4.4H8.6zM3 8.4h4.4V12.8H3zM8.6 8.4H13v4.4H8.6z"/>`,
    year: `<path d="M3.2 4.2h9.6v8.6H3.2zM3.2 7h9.6M6 3v2.2M10 3v2.2M8 9.2v2"/>`,
  };

  let paletteKey = "";
  let paletteModel = { nodes: [], orders: [] };

  function dayStart(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function orderBuckets(orders) {
    const today = dayStart(new Date());
    const week = new Date(today);
    week.setDate(week.getDate() - 6);
    const month = new Date(today);
    month.setDate(month.getDate() - 29);
    const quarter = new Date(today);
    quarter.setDate(quarter.getDate() - 89);
    const buckets = [
      { id: "order:week", name: "Недавние", icon: PALETTE_ICONS.week, items: [] },
      { id: "order:month", name: "За месяц", icon: PALETTE_ICONS.month, items: [] },
      { id: "order:quarter", name: "За квартал", icon: PALETTE_ICONS.quarter, items: [] },
    ];
    const years = new Map();
    orders.forEach((order) => {
      const stamp = orderStamp(order);
      const day = stamp ? dayStart(new Date(`${stamp}T00:00:00`)) : null;
      const ok = day && !Number.isNaN(day.getTime());
      if (ok && day >= week) buckets[0].items.push(order);
      else if (ok && day >= month) buckets[1].items.push(order);
      else if (ok && day >= quarter) buckets[2].items.push(order);
      else {
        const key = ok ? String(day.getFullYear()) : "none";
        if (!years.has(key)) years.set(key, []);
        years.get(key).push(order);
      }
    });
    const named = [...years.keys()].sort((a, b) => {
      if (a === "none") return 1;
      if (b === "none") return -1;
      return b.localeCompare(a);
    });
    return [
      ...buckets.filter((bucket) => bucket.items.length),
      ...named.map((key) => ({
        id: `order:${key}`,
        name: key === "none" ? "Без даты" : `${key} г`,
        icon: PALETTE_ICONS.year,
        items: years.get(key),
      })),
    ];
  }

  function paletteItemButton(item) {
    if (item.orderId) {
      return `<button type="button" class="calc-order${item.used ? " is-used" : ""}" data-order="${esc(item.orderId)}" data-peek="order:${esc(item.orderId)}" title="${esc(item.tip)}"><b>${esc(item.number)}</b><span>${esc(item.sub)}</span><small>${esc(item.meta)}</small></button>`;
    }
    if (item.blueprintId) {
      return `<button type="button" class="calc-order" data-blueprint="${esc(item.blueprintId)}" data-peek="scheme:${esc(item.blueprintId)}"><b>${esc(item.name)}</b><span>${esc(item.meta)}</span></button>`;
    }
    if (item.presentBlock) {
      return `<button type="button" class="calc-order${item.used ? " is-used" : ""}" data-present-block="${esc(item.presentBlock)}" data-present-page="${esc(item.presentPage || "")}" data-present-used="${item.onScheme ? "1" : "0"}" data-peek="present:${esc(item.presentBlock)}" title="${esc(item.tip || "")}"><b>${esc(item.name)}</b><span>${esc(item.sub || "")}</span><small>${esc(item.meta || "")}</small></button>`;
    }
    if (item.teleportId) {
      return `<button type="button" class="calc-order" data-teleport="${esc(item.teleportId)}" data-peek="teleout:${esc(item.teleportId)}" title="Поставить выход телепорта"><b>${esc(item.name)}</b><span>${esc(item.meta || "")}</span></button>`;
    }
    return calcToolButton(item.type, item.label, item.icon, item.type);
  }

  function nodePeekHtml(kind, ref) {
    const bp = activeBlueprint() || { links: [], nodes: [] };
    const graph = { values: {}, errors: new Set() };
    const presentItem = kind === "present"
      ? (paletteModel.nodes.find((group) => group.id === "present")?.items || []).find((entry) => entry.presentBlock === ref)
      : null;
    const extra = kind === "order" ? { orderId: ref } : kind === "scheme" ? { blueprintId: ref } : kind === "present" ? { pageId: presentItem?.presentPage || "", blockId: ref, blockType: presentItem?.blockType || "metric", title: presentItem?.name || "Блок" } : null;
    const node = blankNode(kind, extra);
    if (!node) return "";
    node.id = "peek";
    node.x = 0;
    node.y = 0;
    if (kind === "math") return mathNodeHtml(node, bp, graph);
    if (kind === "percent") return percentNodeHtml(node, bp, graph);
    if (kind === "const") return constNodeHtml(node, graph);
    if (kind === "result") return resultNodeHtml(node, bp, graph);
    if (kind === "formula") return formulaNodeHtml(node, bp, graph);
    if (kind === "comment") return commentNodeHtml(node);
    if (kind === "joint") return jointNodeHtml(node);
    if (kind === "teleport") return teleportNodeHtml(node, bp);
    if (kind === "teleout") {
      node.ports = [{ id: "peek", source: ref }];
      return teleoutNodeHtml(node, bp);
    }
    if (kind === "bus") return busNodeHtml(node, bp, graph);
    if (kind === "scheme") return schemeNodeHtml(node, graph);
    if (kind === "filter") return filterNodeHtml(node, graph);
    if (kind === "dashboard") return dashboardNodeHtml(node, bp, graph);
    if (kind === "planner") return plannerNodeHtml(node, bp, graph);
    if (kind === "openings") return openingsNodeHtml(node, bp, graph);
    if (kind === "electrics") return electricsNodeHtml(node, bp, graph);
    if (kind === "group") {
      const w = Math.max(160, node.w || 320);
      const h = Math.max(120, node.h || 220);
      return `<div class="calc-peek-group" style="width:${w}px;height:${h}px">${groupNodeHtml(node, 1)}${groupChromeHtml(node, 2)}</div>`;
    }
    if (kind === "order") return orderNodeHtml(node, api.findOrder(ref), graph, bp);
    if (kind === "present") return presentNodeHtml(node, bp, graph);
    return "";
  }

  function ensureFlyout() {
    let fly = document.getElementById("calc-palette");
    if (fly) return fly;
    fly = document.createElement("div");
    fly.id = "calc-palette";
    fly.className = "calc-palette";
    fly.hidden = true;
    document.body.appendChild(fly);
    return fly;
  }

  function ensurePeek() {
    let peek = document.getElementById("calc-peek");
    if (peek) return peek;
    peek = document.createElement("div");
    peek.id = "calc-peek";
    peek.className = "calc-peek";
    peek.hidden = true;
    document.body.appendChild(peek);
    return peek;
  }

  function hidePeek() {
    const peek = document.getElementById("calc-peek");
    if (!peek) return;
    peek.hidden = true;
    peek.classList.remove("is-on", "is-glide", "is-follow");
    peek.style.transform = "";
  }

  function placePeekRest() {
    const peek = document.getElementById("calc-peek");
    const fly = document.getElementById("calc-palette");
    if (!peek || peek.hidden || peek.classList.contains("is-follow") || peek.classList.contains("is-glide")) return;
    const anchor = fly && !fly.hidden ? fly.getBoundingClientRect() : $("calc-side")?.getBoundingClientRect();
    if (!anchor) return;
    const width = peek.offsetWidth || 230;
    let left = anchor.right + 14;
    if (left + width > window.innerWidth - 8) left = Math.max(8, anchor.left - width - 14);
    peek.style.left = `${Math.round(left)}px`;
    peek.style.top = `${Math.round(Math.max(8, Math.min(anchor.top, window.innerHeight - peek.offsetHeight - 8)))}px`;
  }

  function showPeek(token) {
    if (session.palette?.moved) return;
    const text = String(token || "");
    const split = text.indexOf(":");
    const kind = split < 0 ? text : text.slice(0, split);
    const ref = split < 0 ? "" : text.slice(split + 1);
    const html = nodePeekHtml(kind, ref);
    if (!html) {
      hidePeek();
      return;
    }
    const peek = ensurePeek();
    const card = peek.querySelector(".calc-node");
    const prev = card ? { w: card.offsetWidth, h: card.offsetHeight } : null;
    const first = peek.hidden;
    peek.hidden = false;
    peek.classList.add("is-on");
    peek.innerHTML = html;
    placePeekRest();
    const next = peek.querySelector(".calc-node");
    if (prev && next) {
      requestAnimationFrame(() => {
        const w = next.offsetWidth;
        const h = next.offsetHeight;
        if (prev.w === w && prev.h === h) return;
        next.animate(
          [
            { width: `${prev.w}px`, height: `${prev.h}px` },
            { width: `${w}px`, height: `${h}px` },
          ],
          { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" }
        );
      });
    } else if (first) {
      peek.animate(
        [
          { opacity: 0, transform: "translateX(-8px) scale(0.96)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" }
      );
    }
  }

  function closePalette() {
    paletteKey = "";
    const fly = document.getElementById("calc-palette");
    if (fly) {
      fly.hidden = true;
      fly.classList.remove("is-on");
    }
    document.querySelectorAll(".calc-group-btn.is-open").forEach((btn) => btn.classList.remove("is-open"));
    if (!session.palette?.moved) hidePeek();
  }

  function paletteGroup(key) {
    return [...paletteModel.nodes, ...paletteModel.orders].find((group) => group.id === key) || null;
  }

  function layoutFlyout(btn) {
    const fly = ensureFlyout();
    const rect = btn.getBoundingClientRect();
    const prevH = fly.offsetHeight || rect.height;
    const prevTop = fly.getBoundingClientRect().top || rect.top;
    fly.style.transition = "none";
    fly.style.overflowY = "hidden";
    fly.style.height = "auto";
    const natural = fly.offsetHeight;
    const max = window.innerHeight - 16;
    const want = Math.min(natural, max);
    fly.dataset.scroll = natural > max + 1 ? "1" : "";
    const top = Math.max(8, Math.min(rect.top - 6, window.innerHeight - want - 8));
    fly.style.height = `${prevH}px`;
    fly.style.top = `${prevTop}px`;
    fly.style.left = `${Math.round(rect.right + 8)}px`;
    void fly.offsetHeight;
    fly.style.transition = "";
    fly.hidden = false;
    fly.classList.add("is-on");
    fly.style.overflowY = fly.dataset.scroll ? "auto" : "hidden";
    fly.style.height = `${want}px`;
    fly.style.top = `${Math.round(top)}px`;
  }

  function openPalette(btn) {
    const key = btn?.dataset.palette || "";
    const group = paletteGroup(key);
    if (!group) {
      closePalette();
      return;
    }
    const fly = ensureFlyout();
    const same = paletteKey === key && fly.classList.contains("is-on") && !fly.hidden;
    paletteKey = key;
    document.querySelectorAll(".calc-group-btn.is-open").forEach((el) => el.classList.toggle("is-open", el === btn));
    if (same) return;
    fly.innerHTML = group.items.map(paletteItemButton).join("");
    const rect = btn.getBoundingClientRect();
    if (fly.hidden || !fly.classList.contains("is-on")) {
      fly.hidden = false;
      fly.style.left = `${Math.round(rect.right + 8)}px`;
      fly.style.top = `${Math.round(rect.top)}px`;
      fly.style.height = `${Math.round(rect.height)}px`;
      fly.classList.add("is-on");
    }
    requestAnimationFrame(() => layoutFlyout(btn));
  }

  function syncPalette() {
    if (!paletteKey) return;
    const btn = document.querySelector(`.calc-group-btn[data-palette="${paletteKey}"]`);
    const group = paletteGroup(paletteKey);
    if (!btn || !group) {
      closePalette();
      return;
    }
    const fly = ensureFlyout();
    fly.innerHTML = group.items.map(paletteItemButton).join("");
    document.querySelectorAll(".calc-group-btn.is-open").forEach((el) => el.classList.toggle("is-open", el === btn));
    layoutFlyout(btn);
  }

  function foldSummary(key, label, extra = "") {
    return `<summary class="calc-tools-label"><svg class="calc-fold-ico" viewBox="0 0 16 16" aria-hidden="true">${FOLD_ICONS[key] || ""}</svg><span class="calc-fold-name">${esc(label)}</span>${extra}</summary>`;
  }

  function renderSide(bp) {
    const host = $("calc-side");
    if (!host) return;
    const calc = ensureState();
    const rail = !sideOpen();
    host.classList.toggle("is-rail", rail);
    host.closest(".calc-layout")?.classList.toggle("is-rail", rail);
    const q = session.search.trim().toLowerCase();
    const searchPop = rail && session.searchOpen;
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
    const nodeGroups = [
      {
        id: "logic",
        name: "Логика",
        icon: PALETTE_ICONS.logic,
        items: [
          { type: "math", label: "Оператор", icon: `<path d="M8 3.2v9.6M3.2 8h9.6"/>` },
          { type: "formula", label: "Формула", icon: `<path d="M5.6 3.2c-1.7.3-2.4 1.3-2.4 2.3 0 1.5 1.1 2.1 2.3 2.3-1.5.5-2.5 1.5-2.5 3 0 1.4 1.1 2.2 2.6 2.2M9.1 4.4l3.8 7.2M9.4 8.2h3.2"/>` },
          { type: "percent", label: "Процент", icon: `<circle cx="5" cy="4.8" r="1.45" fill="currentColor" stroke="none"/><circle cx="11" cy="11.2" r="1.45" fill="currentColor" stroke="none"/><path d="M12.3 3.4 3.7 12.6"/>` },
          { type: "const", label: "Константа", icon: `<rect x="3" y="3" width="10" height="10" rx="2"/><path d="M8 5.4v5.2"/>` },
        ],
      },
      {
        id: "summary",
        name: "Сводка",
        icon: PALETTE_ICONS.summary,
        items: [
          { type: "filter", label: "Фильтр", icon: `<path d="M2.6 3.2h10.8L9.4 8.2v4.2l-2.8 1.2V8.2z"/>` },
          { type: "dashboard", label: "Дашборд", icon: `<path d="M3 13V8.4M8 13V3.6M13 13V6.4M2.2 13h11.6"/>` },
        ],
      },
      {
        id: "plan",
        name: "Планировка",
        icon: PALETTE_ICONS.plan,
        items: [
          { type: "planner", label: "Планировщик", icon: `<path d="M3 3.2h10v9.6H3zM3 7.4h4.2"/>` },
          { type: "openings", label: "Проёмы", icon: `<path d="M3 3.2h10v9.6H3zM6.2 12.8V7.2h3.6v5.6M4.2 6.2h2.2v2.4H4.2z"/>` },
          { type: "electrics", label: "Электрика", icon: `<path d="M8 2.8v3.2M6.2 6h3.6v2.4L8 13.2 6.2 8.4V6z"/>` },
          { type: "tiles", label: "Плитка", icon: `<path d="M2.4 2.4h5.2v5.2H2.4zM8.4 2.4h5.2v5.2H8.4zM2.4 8.4h5.2v5.2H2.4zM8.4 8.4h5.2v5.2H8.4z"/>` },
        ],
      },
      {
        id: "marks",
        name: "Разметка",
        icon: PALETTE_ICONS.marks,
        items: [
          { type: "result", label: "Результат", icon: `<path d="M2.6 5.2h6.4M2.6 10.8h6.4M10.2 8h3.4M11.6 6.2 13.8 8l-2.2 1.8"/>` },
          { type: "group", label: "Группа", icon: `<rect x="3" y="3" width="10" height="10" rx="1.5" stroke-dasharray="2.2 1.5"/>` },
          { type: "comment", label: "Комментарий", icon: `<path d="M3 2.8h6.6L13 6.2v7H3zM9.4 2.9V6h3.2M5 8.2h6M5 10.6h4"/>` },
          { type: "joint", label: "Точка", icon: `<circle cx="8" cy="8" r="3.1"/>` },
          { type: "teleport", label: "Телепорт", icon: `<path d="M3.2 4.2c2.4 1.6 2.4 6 0 7.6M12.8 4.2c-2.4 1.6-2.4 6 0 7.6M6.4 8h3.2"/>` },
          { type: "bus", label: "Канал", icon: `<circle cx="3.2" cy="8" r="1.45" fill="currentColor" stroke="none"/><circle cx="12.8" cy="8" r="1.45" fill="currentColor" stroke="none"/><path d="M5 8h6"/>` },
        ],
      },
    ];
    const teleportItems = [];
    (bp?.nodes || []).forEach((node) => {
      if (node.type !== "teleport") return;
      teleportEntries(node).forEach((port) => {
        teleportItems.push({ teleportId: port.id, name: teleportPortName(bp, node, port) || "Без названия", meta: "выход" });
      });
    });
    if (teleportItems.length) {
      nodeGroups.push({
        id: "teleports",
        name: "Телепорты",
        icon: `<path d="M3.2 4.2c2.4 1.6 2.4 6 0 7.6M12.8 4.2c-2.4 1.6-2.4 6 0 7.6M6.4 8h3.2"/>`,
        items: teleportItems,
      });
    }
    if (schemes.length) {
      nodeGroups.push({
        id: "schemes",
        name: "Схемы",
        icon: PALETTE_ICONS.schemes,
        items: schemes.map((item) => {
          const n = (item.nodes || []).filter((node) => node.type === "result" && resultVisible(node)).length;
          return { blueprintId: item.id, name: item.name || "Схема", meta: n ? `${n} рез.` : "нет результатов" };
        }),
      });
    }
    const presentSkip = new Set(["title", "note", "spacer"]);
    const presentItems = [];
    (window.FinPresent?.pages?.() || []).forEach((page) => {
      (page.blocks || []).forEach((block) => {
        if (presentSkip.has(block.type)) return;
        const meta = window.FinPresent?.blockMeta?.(block.type) || { name: block.type, ports: [] };
        const usage = presentUsage(block.id);
        const onScheme = usage.onActive > 0;
        const onOther = !onScheme && usage.onOther > 0;
        let metaText = "Не на схеме";
        let tip = "Добавить ноду на схему";
        if (onScheme) {
          metaText = "На схеме";
          tip = "Уже на этой схеме — наведите, чтобы подсветить";
        } else if (onOther) {
          metaText = "Другая схема";
          tip = `Есть на: ${usage.otherNames.slice(0, 3).join(", ") || "другой схеме"}`;
        }
        presentItems.push({
          presentBlock: block.id,
          presentPage: page.id,
          blockType: block.type,
          name: block.title || meta.name || "Блок",
          sub: `${page.name || "Страница"} · ${meta.name || block.type}`,
          meta: metaText,
          tip,
          used: onScheme || onOther,
          onScheme,
        });
      });
    });
    if (presentItems.length) {
      nodeGroups.push({
        id: "present",
        name: "Презентация",
        icon: PALETTE_ICONS.present,
        items: presentItems,
      });
    }
    const orderGroups = orderBuckets(orders).map((bucket) => ({
      ...bucket,
      items: bucket.items.map((order) => {
        const n = orderLines(order).length;
        const used = usedOrders.has(order.id);
        const label = `${order.number || "—"} — ${order.name || order.customer || "Без названия"}`;
        return {
          orderId: order.id,
          used,
          number: order.number || "—",
          sub: order.name || order.customer || "Без названия",
          meta: used ? "на схеме" : `${n} поз.`,
          tip: used ? `${label} · на схеме` : label,
        };
      }),
    }));
    paletteModel = { nodes: nodeGroups, orders: orderGroups };
    const railBtn = `<button type="button" class="calc-rail-btn" data-calc-rail title="${rail ? "Развернуть меню нодов" : "Свернуть меню нодов"}" aria-label="${rail ? "Развернуть меню нодов" : "Свернуть меню нодов"}" aria-pressed="${rail ? "true" : "false"}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M9.2 4.5v15" stroke="currentColor" stroke-width="1.8"/></svg></button>`;
    host.innerHTML = `
      ${rail ? railBtn : ""}
      <details class="calc-fold" data-fold="nodes" ${foldOpen("nodes") ? "open" : ""}>
        ${foldSummary("nodes", "Ноды", rail ? "" : railBtn)}
        <div class="calc-tools">
          ${nodeGroups.map((group) => calcGroupButton(group.id, group.name, group.icon)).join("")}
        </div>
      </details>
      <details class="calc-fold" data-fold="orders" ${foldOpen("orders") ? "open" : ""}>
        ${foldSummary("orders", "Заказы")}
        <div class="calc-orders">
          ${
            rail
              ? `<button type="button" class="calc-search-btn${session.search ? " has-value" : ""}" data-search-open title="Поиск заказов" aria-label="Поиск заказов" aria-expanded="${searchPop ? "true" : "false"}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5" stroke="currentColor" stroke-width="1.8"/><path d="M15 15l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>`
              : `<div class="calc-search is-field${session.search ? " has-value" : ""}">
            <svg class="calc-search-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5" stroke="currentColor" stroke-width="1.8"/><path d="M15 15l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            <input type="search" id="calc-order-search" placeholder="Номер, название…" value="${esc(session.search)}" autocomplete="off" />
            <button type="button" class="search-clear" data-search-clear="calc-order-search" title="Очистить" aria-label="Очистить поиск">×</button>
          </div>`
          }
          <div class="calc-tools calc-order-groups">
            ${
              orderGroups.length
                ? orderGroups.map((group) => calcGroupButton(group.id, group.name, group.icon)).join("")
                : `<div class="calc-empty">${orders.length ? "Нет заказов в группах" : "Нет заказов"}</div>`
            }
          </div>
        </div>
      </details>`;
    syncRailSearch();
    syncPalette();
  }

  function syncRailSearch() {
    const host = $("calc-side");
    const btn = host?.classList.contains("is-rail") && session.searchOpen ? host.querySelector("[data-search-open]") : null;
    let pop = document.getElementById("calc-order-pop");
    if (!btn) {
      pop?.remove();
      return;
    }
    if (!pop) {
      pop = document.createElement("div");
      pop.id = "calc-order-pop";
      pop.className = "calc-search";
      pop.innerHTML = `<input type="search" id="calc-order-search" placeholder="Номер, название…" autocomplete="off" /><button type="button" class="search-clear" data-search-clear="calc-order-search" title="Очистить" aria-label="Очистить поиск">×</button>`;
      document.body.appendChild(pop);
    }
    pop.classList.toggle("has-value", !!session.search);
    const input = pop.querySelector("input");
    if (input && document.activeElement !== input && input.value !== session.search) input.value = session.search;
    const rect = btn.getBoundingClientRect();
    pop.style.top = `${Math.round(rect.top)}px`;
    pop.style.left = `${Math.round(rect.right + 8)}px`;
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
    return `<article class="calc-node is-order ${missing ? "is-error" : ""} ${nodeSelected(node.id) ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
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
    return `<article class="calc-node is-math ${nodeSelected(node.id) ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
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
    return `<article class="calc-node is-formula ${bad ? "is-error" : ""} ${nodeSelected(node.id) ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px;width:${w}px">
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
    return `<article class="calc-node is-const ${nodeSelected(node.id) ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
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

  function resultFilmHtml(plan) {
    const tones = markTones(null, plan.color);
    const cards = filmItems(plan)
      .map((item) => `<div class="calc-film-card" title="${esc(item.name)}"><span class="calc-film-name">${esc(item.name)}</span>${surfaceThumb(plan, item, plan.openings || [], [], tones)}</div>`)
      .join("");
    return `<div class="calc-film calc-film-top">${cards}</div>`;
  }

  function resultNodeHtml(node, bp, graph) {
    const value = graph.values[`${node.id}:out`];
    const linked = usedInputPorts(node.id, bp.links);
    const plan = upstreamPlan(node, bp, [], graph.values, "in");
    const prio = Number.isFinite(Number(node.priority)) ? Number(node.priority) : nextResultPriority(bp);
    const shown = resultVisible(node);
    const signal = plan ? ` data-signal="plan"` : "";
    const pass = linked.has("in") ? "" : ` data-pass="any"`;
    return `<article class="calc-node is-result ${plan ? "is-plan" : ""} ${shown ? "" : "is-scheme-off"} ${nodeSelected(node.id) ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <input class="calc-result-prio" data-result-prio="${esc(node.id)}" type="number" min="0" max="9999" step="1" value="${prio}" title="Приоритет на схеме (меньше — выше)" aria-label="Приоритет" />
        <input class="calc-pname calc-result-name" data-result-name="${esc(node.id)}" value="${esc(resultName(node))}" maxlength="48" spellcheck="false" title="${esc(resultName(node))}" aria-label="Имя результата" />
        <button type="button" class="calc-eye ${shown ? "" : "is-off"}" data-result-eye="${esc(node.id)}" title="${shown ? "Скрыть из ноды схемы" : "Показать в ноде схемы"}" aria-label="${shown ? "Скрыть из ноды схемы" : "Показать в ноде схемы"}" aria-pressed="${shown ? "true" : "false"}">${resultEyeIcon(shown)}</button>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      ${plan ? resultFilmHtml(plan) : screenHtml(value, "Значение связи")}
      <div class="calc-ports">
        <div class="calc-row in">
          <i class="calc-port in" data-port="in" data-io="in"${signal}${pass}></i>
          <span>вход</span>
          ${linked.has("in") ? `<button type="button" class="calc-mini" data-del-in-link="in" title="Удалить связь">×</button>` : ""}
        </div>
        <div class="calc-row out">
          <span>выход</span>
          <i class="calc-port out" data-port="out" data-io="out"${signal}${pass} title="${plan ? "Чертёж" : "Выход"}"></i>
        </div>
      </div>
    </article>`;
  }

  function percentNodeHtml(node, bp, graph) {
    const value = graph.values[`${node.id}:out`];
    const linked = usedInputPorts(node.id, bp.links);
    return `<article class="calc-node is-percent ${nodeSelected(node.id) ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
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
    return `<article class="calc-node is-scheme ${missing ? "is-error" : ""} ${nodeSelected(node.id) ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
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
                  if (port.signal === "plan") {
                    const drawn = emitPlan(node, blueprintOf(node) || activeBlueprint(), [], graph.values, port.id);
                    const thumb = drawn
                      ? surfaceThumb(drawn, { id: "floor", name: "Пол" }, drawn.openings || [], [], markTones(null, drawn.color))
                      : "";
                    return `<div class="calc-row">
                    <span class="calc-row-name" title="${esc(port.name)}">${esc(port.name)}</span>
                    <span class="calc-port-thumb" title="Чертёж">${thumb}</span>
                    <i class="calc-port out" data-port="${esc(port.id)}" data-io="out" data-signal="plan" title="Чертёж"></i>
                  </div>`;
                  }
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
    return `<article class="calc-node is-group ${nodeSelected(node.id) ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px;width:${w}px;height:${h}px;z-index:${z};--group-color:${esc(color)}"></article>`;
  }

  function groupChromeHtml(node, zIndex) {
    const w = Math.max(160, node.w || 320);
    const h = Math.max(120, node.h || 220);
    const color = String(node.color || "#14b8a6");
    const name = String(node.name || "").trim() || "Группа";
    const z = Number.isFinite(zIndex) ? zIndex : 0;
    return `<div class="calc-group-chrome ${nodeSelected(node.id) ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px;width:${w}px;height:${h}px;z-index:${z};--group-color:${esc(color)}">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить группу · Shift — только рамка"></i>
      <header class="calc-node-h calc-group-h">
        <input class="calc-pname calc-group-name" data-group-name="${esc(node.id)}" value="${esc(name)}" maxlength="48" spellcheck="false" title="${esc(name)}" aria-label="Имя группы" />
        <input class="calc-group-color" data-group-color="${esc(node.id)}" type="color" value="${esc(color)}" title="Цвет группы" />
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <i class="calc-resize" data-resize-group="${esc(node.id)}" title="Изменить размер"></i>
    </div>`;
  }

  function busLanes(node) {
    if (!node) return [];
    if (!Array.isArray(node.lanes) || !node.lanes.length) node.lanes = [{ id: uid(), signal: "num", tone: "" }];
    return node.lanes;
  }

  function laneIdOf(portId) {
    const id = String(portId || "");
    if (id.startsWith("in:")) return id.slice(3);
    if (id.startsWith("out:")) return id.slice(4);
    return "";
  }

  function laneOf(node, portId) {
    const id = laneIdOf(portId);
    return (node?.lanes || []).find((item) => item.id === id) || null;
  }

  function laneIncoming(bp, node, lane) {
    return (bp.links || []).find((link) => link.to === node.id && link.toPort === `in:${lane.id}`) || null;
  }

  function passSignalOk(src, fromPort, dst, toPort, links) {
    if (portSignal(src, fromPort) === portSignal(dst, toPort)) return true;
    const list = links || [];
    if (dst?.type === "result" && String(toPort) === "in") return true;
    if (src?.type === "result" && String(fromPort) === "out") {
      const home = blueprintOf(src);
      const fed = (home?.links || []).some((link) => link.to === src.id && link.toPort === "in");
      if (!fed) return true;
    }
    if (dst?.type === "joint" && String(toPort) === "in") return true;
    if (dst?.type === "teleport" && (String(toPort) === "in" || String(toPort).startsWith("in:"))) return true;
    if (src?.type === "joint" && String(fromPort) === "out") {
      const incoming = list.some((link) => link.to === src.id && link.toPort === "in");
      return !incoming && !src.tone;
    }
    if (src?.type === "teleport" && String(fromPort) === "out") {
      const incoming = list.some((link) => link.to === src.id && link.toPort === "in");
      return !incoming && !src.tone;
    }
    if (src?.type === "teleout") {
      const row = teleoutPort(src, fromPort);
      return !!row && !row.tone;
    }
    if (dst?.type === "bus") {
      const lane = laneOf(dst, toPort);
      return !!lane && String(toPort).startsWith("in:");
    }
    if (src?.type === "bus") {
      const lane = laneOf(src, fromPort);
      if (!lane) return false;
      const incoming = list.some((link) => link.to === src.id && link.toPort === `in:${lane.id}`);
      return !incoming && !lane.tone;
    }
    return false;
  }

  function applyPassTone(node, lane, signal, tone) {
    const target = lane || node;
    const nextSignal = signal === "plan" ? "plan" : "num";
    const nextTone = nextSignal === "plan" ? "plan" : (tone || "");
    const changed = target.signal !== nextSignal || target.tone !== nextTone;
    target.signal = nextSignal;
    target.tone = nextTone;
    return changed;
  }

  function dropMismatchedOuts(bp, nodeId, portId, signal) {
    bp.links = (bp.links || []).filter((link) => {
      if (link.from !== nodeId || link.fromPort !== portId) return true;
      const dst = (bp.nodes || []).find((item) => item.id === link.to);
      if (!dst) return false;
      if (dst.type === "joint" || dst.type === "teleport" || dst.type === "result" || (dst.type === "bus" && !laneOf(dst, link.toPort)?.tone)) return true;
      return portSignal(dst, link.toPort) === signal;
    });
  }

  function syncPassNodes(bp) {
    if (!bp) return;
    for (let pass = 0; pass < 32; pass += 1) syncPassNodesOnce(bp);
    const empty = (bp.nodes || []).filter((node) => node.type === "teleout" && !(node.ports || []).length).map((node) => node.id);
    if (!empty.length) return;
    const drop = new Set(empty);
    bp.nodes = (bp.nodes || []).filter((node) => !drop.has(node.id));
    bp.links = (bp.links || []).filter((link) => !drop.has(link.from) && !drop.has(link.to));
  }

  function syncResultOuts(bp) {
    (bp.nodes || []).forEach((node) => {
      if (node.type !== "result") return;
      const incoming = (bp.links || []).find((link) => link.to === node.id && link.toPort === "in");
      if (!incoming) return;
      const src = (bp.nodes || []).find((item) => item.id === incoming.from);
      if (!src) return;
      const signal = portSignal(src, incoming.fromPort) === "plan" ? "plan" : "num";
      dropMismatchedOuts(bp, node.id, "out", signal);
    });
  }

  function syncPassNodesOnce(bp) {
    (bp.nodes || []).forEach((node) => {
      if (node.type === "joint") {
        const incoming = (bp.links || []).find((link) => link.to === node.id && link.toPort === "in");
        if (incoming) {
          const src = (bp.nodes || []).find((item) => item.id === incoming.from);
          if (src) {
            const signal = portSignal(src, incoming.fromPort) === "plan" ? "plan" : "num";
            if (applyPassTone(node, null, signal, wireKind(src, incoming.fromPort))) dropMismatchedOuts(bp, node.id, "out", signal);
          }
          return;
        }
        const outgoing = (bp.links || []).find((link) => link.from === node.id && link.fromPort === "out");
        if (!outgoing) {
          node.signal = "num";
          node.tone = "";
          return;
        }
        if (!node.tone) {
          const dst = (bp.nodes || []).find((item) => item.id === outgoing.to);
          if (portSignal(dst, outgoing.toPort) === "plan") applyPassTone(node, null, "plan", "plan");
        }
        return;
      }
      if (node.type === "teleport") {
        teleportEntries(node).forEach((port) => {
          const stored = teleportWritable(node, port.id) || node;
          const lane = stored !== node ? stored : null;
          const incoming = (bp.links || []).find((link) => link.to === node.id && (link.toPort === teleportInId(node, port) || link.toPort === `in:${port.id}` || (link.toPort === "in" && port.id === node.id)));
          if (incoming) {
            const src = (bp.nodes || []).find((item) => item.id === incoming.from);
            if (src) {
              const signal = portSignal(src, incoming.fromPort) === "plan" ? "plan" : "num";
              if (applyPassTone(node, lane, signal, wireKind(src, incoming.fromPort))) dropTeleportOuts(bp, port.id, signal);
            }
            return;
          }
          stored.signal = "num";
          stored.tone = "";
        });
        return;
      }
      if (node.type === "teleout") {
        const live = (node.ports || []).filter((port) => teleportHost(bp, port.source));
        if (live.length !== (node.ports || []).length) {
          const gone = new Set((node.ports || []).filter((port) => !live.includes(port)).map((port) => `out:${port.id}`));
          node.ports = live;
          bp.links = (bp.links || []).filter((link) => !(link.from === node.id && gone.has(link.fromPort)));
        }
        (node.ports || []).forEach((port) => {
          const host = teleportHost(bp, port.source);
          const entry = host && teleportEntry(host, port.source);
          port.signal = entry?.signal === "plan" ? "plan" : "num";
          port.tone = entry?.tone || "";
        });
        return;
      }
      if (node.type !== "bus") return;
      const lanes = busLanes(node);
      lanes.forEach((lane) => {
        const incoming = laneIncoming(bp, node, lane);
        if (incoming) {
          const src = (bp.nodes || []).find((item) => item.id === incoming.from);
          if (src) {
            const signal = portSignal(src, incoming.fromPort) === "plan" ? "plan" : "num";
            if (applyPassTone(node, lane, signal, wireKind(src, incoming.fromPort))) dropMismatchedOuts(bp, node.id, `out:${lane.id}`, signal);
          }
          return;
        }
        if (!lane.tone) {
          const outgoing = (bp.links || []).find((link) => link.from === node.id && link.fromPort === `out:${lane.id}`);
          if (!outgoing) return;
          const dst = (bp.nodes || []).find((item) => item.id === outgoing.to);
          if (portSignal(dst, outgoing.toPort) === "plan") applyPassTone(node, lane, "plan", "plan");
        }
      });
      const used = new Set();
      (bp.links || []).forEach((link) => {
        if (link.to === node.id) used.add(laneIdOf(link.toPort));
        if (link.from === node.id) used.add(laneIdOf(link.fromPort));
      });
      const kept = lanes.filter((lane) => used.has(lane.id));
      if (kept.length >= 30) {
        node.lanes = kept.slice(0, 30);
        return;
      }
      const spare = lanes.find((lane) => !used.has(lane.id)) || { id: uid(), signal: "num", tone: "" };
      spare.signal = "num";
      spare.tone = "";
      node.lanes = kept.concat(spare);
    });
    syncResultOuts(bp);
  }

  const TONE_COLOR = {
    order: "#0d9488",
    income: "#0d9488",
    total: "#0d9488",
    tax: "#d97706",
    cost: "#e11d48",
    frozen: "#64748b",
    "field-qty": "#0ea5e9",
    "field-price": "#8b5cf6",
    "field-discount": "#eab308",
    "field-paid": "#22c55e",
    "field-unpaid": "#f97316",
    "field-percent": "#ec4899",
    math: "#f97316",
    formula: "#a855f7",
    percent: "#f43f5e",
    const: "#64748b",
    result: "#06b6d4",
    scheme: "#eab308",
    filter: "#0ea5e9",
    dashboard: "#14b8a6",
    planner: "#65a30d",
    plan: "#7c3aed",
    openings: "#0284c7",
    electrics: "#d97706",
    present: "#8b5cf6",
  };

  function toneColor(tone) {
    return TONE_COLOR[tone] || "";
  }

  function planCaption(bp, link, seen) {
    if (!bp || !link) return "";
    const guard = seen || new Set();
    if (guard.has(link.id)) return "";
    guard.add(link.id);
    const src = (bp.nodes || []).find((item) => item.id === link.from);
    if (!src) return "";
    if (src.type === "joint" || src.type === "teleport") {
      const port = src.type === "teleport" ? (teleportPortOf(src, link.fromPort) || teleportEntries(src)[0]) : null;
      const incoming = port
        ? (bp.links || []).find((item) => item.to === src.id && (item.toPort === teleportInId(src, port) || item.toPort === `in:${port.id}` || (item.toPort === "in" && port.id === src.id)))
        : (bp.links || []).find((item) => item.to === src.id && item.toPort === "in");
      return planCaption(bp, incoming, guard);
    }
    if (src.type === "teleout") {
      const row = teleoutPort(src, link.fromPort);
      const host = teleportHost(bp, row?.source);
      const entry = host && teleportEntry(host, row.source);
      if (!host || !entry) return "";
      return planCaption(bp, (bp.links || []).find((item) => item.to === host.id && (item.toPort === teleportInId(host, entry) || item.toPort === `in:${entry.id}` || (item.toPort === "in" && entry.id === host.id))), guard);
    }
    if (src.type === "bus") return planCaption(bp, (bp.links || []).find((item) => item.to === src.id && item.toPort === `in:${laneIdOf(link.fromPort)}`), guard);
    if (src.type === "result") return planCaption(bp, (bp.links || []).find((item) => item.to === src.id && item.toPort === "in"), guard);
    if (src.type === "scheme") {
      const other = findBlueprint(src.blueprintId);
      const resultId = String(link.fromPort || "").startsWith("result:") ? link.fromPort.slice(7) : "";
      const result = (other?.nodes || []).find((item) => item.id === resultId && item.type === "result");
      if (!other || !result) return "";
      return planCaption(other, (other.links || []).find((item) => item.to === result.id && item.toPort === "in"), guard);
    }
    const ports = nodeOutputs(src, api.findOrder?.(src.orderId), bp.links);
    return ports.find((port) => port.id === link.fromPort)?.name || "";
  }

  function teleoutPort(node, portId) {
    const id = String(portId || "");
    const pid = id.startsWith("out:") ? id.slice(4) : id;
    return (node?.ports || []).find((port) => port.id === pid) || null;
  }

  function dropTeleportOuts(bp, sourceId, signal) {
    bp.links = (bp.links || []).filter((link) => {
      const src = (bp.nodes || []).find((item) => item.id === link.from);
      if (src?.type !== "teleout") return true;
      const row = teleoutPort(src, link.fromPort);
      if (!row || row.source !== sourceId) return true;
      const dst = (bp.nodes || []).find((item) => item.id === link.to);
      if (!dst) return false;
      if (dst.type === "joint" || dst.type === "teleport" || dst.type === "result") return true;
      if (dst.type === "bus" && !laneOf(dst, link.toPort)?.tone) return true;
      return portSignal(dst, link.toPort) === signal;
    });
  }

  function teleportEntries(node) {
    if (!node || node.type !== "teleport") return [];
    if (Array.isArray(node.ports) && node.ports.length) return node.ports;
    return [{
      id: node.id,
      signal: node.signal === "plan" ? "plan" : "num",
      tone: node.tone || "",
      label: node.label || "",
      labelSet: !!node.labelSet,
    }];
  }

  function teleportWritable(node, portId) {
    if (!node || node.type !== "teleport") return null;
    if (Array.isArray(node.ports) && node.ports.length) return node.ports.find((port) => port.id === portId) || null;
    return portId === node.id ? node : null;
  }

  function teleportHost(bp, sourceId) {
    if (!bp || !sourceId) return null;
    return (bp.nodes || []).find((node) => node.type === "teleport" && teleportEntries(node).some((port) => port.id === sourceId)) || null;
  }

  function teleportEntry(node, sourceId) {
    return teleportEntries(node).find((port) => port.id === sourceId) || null;
  }

  function teleportInId(node, port) {
    if (!port) return "in";
    if (!(node?.ports || []).length && port.id === node.id) return "in";
    return `in:${port.id}`;
  }

  function teleportLinkHits(node, port, toPort) {
    const id = String(toPort || "");
    if (!port) return false;
    if (id === teleportInId(node, port) || id === `in:${port.id}`) return true;
    return id === "in" && port.id === node.id;
  }

  function teleportPortOf(node, portId) {
    const id = String(portId || "");
    const entries = teleportEntries(node);
    if (id.startsWith("in:")) return entries.find((port) => port.id === id.slice(3)) || null;
    if (id.startsWith("out:")) return entries.find((port) => port.id === id.slice(4)) || null;
    if (id === "in" || id === "out") return entries.find((port) => port.id === node.id) || entries[0] || null;
    return entries.find((port) => port.id === id) || null;
  }

  function teleportTitle(node) {
    const text = String(node?.title || "").trim().slice(0, 48);
    return text || "Телепорт";
  }

  function teleportPencil(portId) {
    return `<button type="button" class="calc-tele-pencil" data-tele-rename="${esc(portId)}" title="Переименовать" aria-label="Переименовать"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.1 2.9 13.1 6.9 5.6 14.4H1.6v-4z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 4 12 8" stroke="currentColor" stroke-width="1.4"/></svg></button>`;
  }

  function teleportHeadHtml(node) {
    const title = teleportTitle(node);
    return `<header class="calc-node-h"><input class="calc-pname calc-tele-title" data-tele-head="${esc(node.id)}" value="${esc(title)}" maxlength="48" spellcheck="false" title="${esc(title)}" aria-label="Заголовок" /><button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button></header>`;
  }

  function materializeTeleport(bp, node) {
    if (!node || node.type !== "teleport") return [];
    if (Array.isArray(node.ports) && node.ports.length) return node.ports;
    node.ports = [{
      id: node.id,
      signal: node.signal === "plan" ? "plan" : "num",
      tone: node.tone || "",
      label: node.label || "",
      labelSet: !!node.labelSet,
    }];
    (bp?.links || []).forEach((link) => {
      if (link.to === node.id && link.toPort === "in") link.toPort = `in:${node.id}`;
    });
    return node.ports;
  }

  function paintTeleportNames(bp, node, portId) {
    if (!bp || !node || node.type !== "teleport") return;
    const entry = teleportEntry(node, portId) || teleportEntries(node)[0];
    if (!entry) return;
    const name = teleportPortName(bp, node, entry);
    const menu = name || "Без названия";
    const port = name || "Выход";
    const listed = paletteModel?.nodes?.find((group) => group.id === "teleports")?.items?.find((item) => item.teleportId === entry.id);
    if (listed) listed.name = menu;
    document.querySelectorAll(`[data-teleport="${cssEsc(entry.id)}"] > b`).forEach((el) => {
      el.textContent = menu;
    });
    document.querySelectorAll(`[data-tele-source="${cssEsc(entry.id)}"]`).forEach((el) => {
      el.textContent = port;
    });
  }

  function teleportPortName(bp, node, port, seen) {
    if (!node || node.type !== "teleport") return "";
    let entry = port;
    let guard = seen;
    if (port instanceof Set) {
      entry = null;
      guard = port;
    }
    entry = entry?.id ? entry : teleportEntries(node)[0];
    if (!entry) return "";
    const stored = teleportWritable(node, entry.id) || entry;
    if (stored.labelSet) return String(stored.label || "").trim().slice(0, 48);
    return teleportAutoName(bp, node, entry, guard);
  }

  function teleportAutoName(bp, node, port, seen) {
    const entry = port?.id ? port : teleportEntries(node)[0];
    const guard = seen instanceof Set ? seen : new Set();
    const key = `${node?.id || ""}:${entry?.id || ""}`;
    if (!bp || !node || !entry || guard.has(key)) return "";
    guard.add(key);
    const link = (bp.links || []).find((item) => item.to === node.id && teleportLinkHits(node, entry, item.toPort));
    if (!link) return "";
    const src = (bp.nodes || []).find((item) => item.id === link.from);
    if (!src) return "";
    if (src.type === "teleport") return teleportPortName(bp, src, teleportPortOf(src, link.fromPort), guard);
    if (src.type === "teleout") {
      const originId = teleoutPort(src, link.fromPort)?.source;
      const host = teleportHost(bp, originId);
      const origin = host && teleportEntry(host, originId);
      return origin ? teleportPortName(bp, host, origin, guard) : "";
    }
    if (portSignal(src, link.fromPort) === "plan") {
      const name = planCaption(bp, link);
      return name && name !== "Чертёж" ? `Чертёж ${name}` : "Чертёж";
    }
    const ports = nodeOutputs(src, api.findOrder?.(src.orderId), bp.links);
    const hit = ports.find((item) => item.id === link.fromPort);
    const raw = String(hit?.name || "").trim();
    if (raw && raw !== "out") return raw.slice(0, 48);
    return String(src.name || "").trim().slice(0, 48);
  }

  function teleportNodeHtml(node, bp) {
    const rows = teleportEntries(node).map((port) => {
      const signal = port.signal === "plan" ? ` data-signal="plan"` : "";
      const name = teleportPortName(bp, node, port);
      return `<div class="calc-row tele">
        <i class="calc-port in" data-port="${esc(teleportInId(node, port))}" data-io="in"${signal} data-pass="any" title="Вход"></i>
        <span class="calc-tele-name" data-tele-in="${esc(port.id)}" title="Потянуть, чтобы перенести">${esc(name)}</span>
        ${teleportPencil(port.id)}
      </div>`;
    }).join("");
    return `<article class="calc-node is-teleport ${nodeSelected(node.id) ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      ${teleportHeadHtml(node)}
      <div class="calc-ports">${rows}</div>
    </article>`;
  }

  function teleoutNodeHtml(node, bp) {
    const rows = (node.ports || []).map((port) => {
      const host = teleportHost(bp, port.source);
      const entry = host && teleportEntry(host, port.source);
      const signal = port.signal === "plan" ? ` data-signal="plan"` : "";
      const pass = port.tone ? "" : ` data-pass="any"`;
      const color = toneColor(port.tone);
      const paint = color && port.signal !== "plan" ? ` style="background:${color}"` : "";
      const name = (host && entry && teleportPortName(bp, host, entry)) || "Выход";
      return `<div class="calc-row tele out">
        <span class="calc-tele-name" data-tele-split="${esc(port.id)}" data-tele-source="${esc(port.source || "")}" title="Потянуть, чтобы отделить">${esc(name)}</span>
        <i class="calc-port out" data-port="out:${esc(port.id)}" data-io="out"${signal}${pass}${paint} title="Выход"></i>
      </div>`;
    }).join("");
    return `<article class="calc-node is-teleout ${nodeSelected(node.id) ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      ${teleportHeadHtml(node)}
      <div class="calc-ports">${rows}</div>
    </article>`;
  }

  function splitTeleout(bp, nodeId, portId) {
    const node = (bp.nodes || []).find((item) => item.id === nodeId && item.type === "teleout");
    if (!node || (node.ports || []).length < 2) return "";
    const port = (node.ports || []).find((item) => item.id === portId);
    if (!port) return "";
    const born = { id: uid(), type: "teleout", x: node.x || 0, y: node.y || 0, title: node.title || "", ports: [port] };
    node.ports = (node.ports || []).filter((item) => item.id !== port.id);
    (bp.links || []).forEach((link) => {
      if (link.from === node.id && link.fromPort === `out:${port.id}`) link.from = born.id;
    });
    bp.nodes.push(born);
    return born.id;
  }

  function mergeTeleout(bp, fromId) {
    const from = (bp.nodes || []).find((item) => item.id === fromId && item.type === "teleout");
    if (!from || !(from.ports || []).length) return false;
    const box = nodeRect(from);
    let host = null;
    let best = 0;
    (bp.nodes || []).forEach((item) => {
      if (item.type !== "teleout" || item.id === from.id) return;
      const area = overlapArea(box, nodeRect(item));
      if (area > best) {
        best = area;
        host = item;
      }
    });
    if (!host) return false;
    const room = 30 - (host.ports || []).length;
    if (room <= 0) return false;
    const moving = (from.ports || []).slice(0, room);
    const stay = (from.ports || []).slice(room);
    moving.forEach((port) => {
      host.ports = (host.ports || []).concat(port);
      (bp.links || []).forEach((link) => {
        if (link.from === from.id && link.fromPort === `out:${port.id}`) link.from = host.id;
      });
    });
    from.ports = stay;
    if (!stay.length) {
      bp.nodes = (bp.nodes || []).filter((item) => item.id !== from.id);
      bp.links = (bp.links || []).filter((link) => link.from !== from.id && link.to !== from.id);
    }
    session.selected = host.id;
    session.picked = new Set([host.id]);
    return true;
  }

  function splitTeleport(bp, nodeId, portId) {
    const node = (bp.nodes || []).find((item) => item.id === nodeId && item.type === "teleport");
    if (!node || teleportEntries(node).length < 2) return "";
    materializeTeleport(bp, node);
    const port = (node.ports || []).find((item) => item.id === portId);
    if (!port) return "";
    const born = {
      id: uid(),
      type: "teleport",
      x: node.x || 0,
      y: node.y || 0,
      title: node.title || "",
      signal: port.signal === "plan" ? "plan" : "num",
      tone: port.tone || "",
      label: port.label || "",
      labelSet: !!port.labelSet,
      ports: [port],
    };
    node.ports = (node.ports || []).filter((item) => item.id !== port.id);
    (bp.links || []).forEach((link) => {
      if (link.to === node.id && link.toPort === `in:${port.id}`) link.to = born.id;
    });
    bp.nodes.push(born);
    return born.id;
  }

  function mergeTeleport(bp, fromId) {
    const from = (bp.nodes || []).find((item) => item.id === fromId && item.type === "teleport");
    if (!from) return false;
    materializeTeleport(bp, from);
    if (!(from.ports || []).length) return false;
    const box = nodeRect(from);
    let host = null;
    let best = 0;
    (bp.nodes || []).forEach((item) => {
      if (item.type !== "teleport" || item.id === from.id) return;
      const area = overlapArea(box, nodeRect(item));
      if (area > best) {
        best = area;
        host = item;
      }
    });
    if (!host) return false;
    materializeTeleport(bp, host);
    const room = 30 - (host.ports || []).length;
    if (room <= 0) return false;
    const moving = (from.ports || []).slice(0, room);
    const stay = (from.ports || []).slice(room);
    moving.forEach((port) => {
      host.ports = (host.ports || []).concat(port);
      (bp.links || []).forEach((link) => {
        if (link.to === from.id && link.toPort === `in:${port.id}`) link.to = host.id;
      });
    });
    from.ports = stay;
    if (!stay.length) {
      bp.nodes = (bp.nodes || []).filter((item) => item.id !== from.id);
      bp.links = (bp.links || []).filter((link) => link.from !== from.id && link.to !== from.id);
    }
    session.selected = host.id;
    session.picked = new Set([host.id]);
    return true;
  }

  function jointNodeHtml(node) {
    const color = toneColor(node.tone);
    const signal = node.signal === "plan" ? ` data-signal="plan"` : "";
    const pass = node.tone ? "" : ` data-pass="any"`;
    return `<article class="calc-node is-joint ${nodeSelected(node.id) ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px${color ? `;--joint:${color}` : ""}">
      <i class="calc-port in" data-port="in" data-io="in"${signal} data-pass="any" title="Вход"></i>
      <i class="calc-grip calc-joint-dot" data-drag-node="${esc(node.id)}" title="Точка"></i>
      <i class="calc-port out" data-port="out" data-io="out"${signal}${pass} title="Выход"></i>
      <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
    </article>`;
  }

  function busLaneText(node, lane, bp, graph) {
    if (lane.signal === "plan") {
      const link = (bp?.links || []).find((item) => item.to === node.id && item.toPort === `in:${lane.id}`)
        || (bp?.links || []).find((item) => item.from === node.id && item.fromPort === `out:${lane.id}`);
      const name = planCaption(bp, link);
      return name && name !== "Чертёж" ? `Чертёж ${name}` : "Чертёж";
    }
    const value = graph?.values?.[`${node.id}:out:${lane.id}`];
    return value == null ? "" : formatCalcNumber(value);
  }

  function busNodeHtml(node, bp, graph) {
    const rows = busLanes(node).map((lane) => {
      const signal = lane.signal === "plan" ? ` data-signal="plan"` : "";
      const pass = lane.tone ? "" : ` data-pass="any"`;
      const color = toneColor(lane.tone);
      const paint = color && lane.signal !== "plan" ? ` style="background:${color}"` : "";
      return `<div class="calc-row bus">
        <i class="calc-port in" data-port="in:${esc(lane.id)}" data-io="in"${signal} data-pass="any"${paint} title="Вход"></i>
        <span>${esc(busLaneText(node, lane, bp, graph))}</span>
        <i class="calc-port out" data-port="out:${esc(lane.id)}" data-io="out"${signal}${pass}${paint} title="Выход"></i>
      </div>`;
    }).join("");
    return `<article class="calc-node is-bus ${nodeSelected(node.id) ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>Канал</span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <div class="calc-ports">${rows}</div>
    </article>`;
  }

  function commentNodeHtml(node) {
    return `<article class="calc-node is-comment ${nodeSelected(node.id) ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>Комментарий</span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <textarea class="calc-comment" data-comment-text="${esc(node.id)}" rows="4" maxlength="2000" placeholder="Напишите комментарий…" spellcheck="true">${esc(node.text || "")}</textarea>
    </article>`;
  }

  function filterNodeHtml(node, graph) {
    return `<article class="calc-node is-filter ${nodeSelected(node.id) ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
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
    const activeLayout = (node.layouts || []).find((item) => item.id === node.layoutId) || node.layouts?.[0];
    const globalHeight = graph?.values?.[`${node.id}:height-global-in`] ?? graph?.values?.[`${node.id}:height-in`];
    const activeIndividualHeight = activeLayout ? graph?.values?.[`${node.id}:height-in:${activeLayout.id}`] : null;
    const incomingHeight = Number.isFinite(activeIndividualHeight) ? activeIndividualHeight : globalHeight;
    const model = plannerModel(node, Number.isFinite(incomingHeight) ? incomingHeight : null);
    const ports = plannerOutputs(node, bp.links, graph?.values);
    const sub = `пол ${fmtShort(model.floor)} м² · ${model.walls.length} стен · h ${fmtShort(model.height)} м`;

    const film = node.layouts.map((layout) => `<div class="calc-film-card ${layout.id === node.layoutId ? "is-on" : ""}" data-planner-layout="${esc(layout.id)}" title="${esc(layout.name)}"><span class="calc-film-name">${esc(layout.name)}</span>${plannerThumb(layout.points, true, layout.color)}<button type="button" class="calc-film-delete" data-del-planner-layout="${esc(layout.id)}" title="Удалить планировку" aria-label="Удалить планировку ${esc(layout.name)}" ${node.layouts.length <= 1 ? "disabled" : ""}>×</button></div>`).join("");
    const groups = node.layouts.map((layout) => {
      const rows = ports.filter((port) => port.layoutId === layout.id && !port.common);
      const inputId = `height-in:${layout.id}`;
      const inputOn = (node.heightInputLayouts || []).includes(layout.id) || (bp.links || []).some((link) => link.to === node.id && link.toPort === inputId);
      const inputValue = graph?.values?.[`${node.id}:${inputId}`];
      const input = inputOn ? `<div class="calc-row in"><i class="calc-port in" data-port="${esc(inputId)}" data-io="in" title="Индивидуальная высота стен · ${esc(layout.name)}"></i><span>Высота · ${esc(layout.name)}</span><b>${Number.isFinite(inputValue) ? esc(fmtShort(inputValue)) + " м" : "—"}</b><button type="button" class="calc-height-port-delete" data-del-planner-height="${esc(inputId)}" title="Удалить вход высоты" aria-label="Удалить вход высоты для ${esc(layout.name)}">×</button></div>` : "";
      return `<div class="calc-plan-group" style="--planner-color:${esc(layout.color)}">${input}${rows.map((port) => plannerPortRow(node, port, graph)).join("")}</div>`;
    }).join("");
    const commons = ports.filter((port) => port.common);
    const globalInputOn = !!node.heightGlobalInputEnabled || (bp.links || []).some((link) => link.to === node.id && (link.toPort === "height-global-in" || link.toPort === "height-in"));
    const globalInputValue = graph?.values?.[`${node.id}:height-global-in`] ?? graph?.values?.[`${node.id}:height-in`];
    const legacyGlobalInput = (bp.links || []).some((link) => link.to === node.id && link.toPort === "height-in") && !(bp.links || []).some((link) => link.to === node.id && link.toPort === "height-global-in");
    const globalInputPort = legacyGlobalInput ? "height-in" : "height-global-in";
    const globalHeightInput = globalInputOn ? `<div class="calc-row in"><i class="calc-port in" data-port="${globalInputPort}" data-io="in" title="Глобальная высота стен"></i><span>Глобальная высота стен</span><b>${Number.isFinite(globalInputValue) ? esc(fmtShort(globalInputValue)) + " м" : "—"}</b><button type="button" class="calc-height-port-delete" data-del-planner-height="${globalInputPort}" title="Удалить глобальный вход высоты" aria-label="Удалить глобальный вход высоты">×</button></div>` : "";
    return `<article class="calc-node is-planner ${nodeSelected(node.id) ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px;--planner-color:${esc(node.color || "#65a30d")}">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <input class="calc-pname calc-planner-name" data-planner-title="${esc(node.id)}" value="${esc(plannerName(node))}" maxlength="48" spellcheck="false" title="${esc(plannerName(node))}" aria-label="Имя планировщика" />
        <input class="calc-planner-color" type="color" data-planner-color="${esc(node.id)}" value="${esc(node.color || "#65a30d")}" title="Цвет текущей планировки" aria-label="Цвет текущей планировки" />
        <button type="button" class="calc-text-btn" data-planner-edit="${esc(node.id)}" title="План пола и площади">Редактор</button>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <div class="calc-film calc-film-top">${film}</div>
      <div class="calc-node-sub">${esc(sub)}</div>
      <div class="calc-ports">${groups || `<div class="calc-empty">Включите выходы в редакторе</div>`}${globalHeightInput}${commonBlockHtml(node, commons, graph, (port) => plannerPortRow(node, port, graph))}${commonInputBlockHtml(node, graph, bp.links)}</div>
    </article>`;
  }

  function dashboardNodeHtml(node, bp, graph) {
    const ports = nodeOutputs(node, null, bp.links).map((port) => port.id);
    return `<article class="calc-node is-dashboard ${nodeSelected(node.id) ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
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
    return `<article class="calc-node is-present ${nodeSelected(node.id) ? "is-on" : ""} ${session.presentHover && session.presentHover === node.blockId ? "is-present-hl" : ""}" data-node="${esc(node.id)}" data-present-block-id="${esc(node.blockId || "")}" style="left:${node.x}px;top:${node.y}px">
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

