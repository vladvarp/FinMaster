/* bundle-seam */
(() => {
  /* ==== Словарь запросов: одно окно на бота и поиск ==== */

  let dictionaryBook = null;
  let dictionaryCatalog = null;
  let dictionarySaved = "";
  let dictionaryBroken = false;
  let dictionaryPick = { kind: "commands", id: "" };
  let dictionaryProbeSurface = "desk";
  let dictionaryProbeTimer = 0;
  let askHintItems = [];
  let askHintIndex = 0;
  let askHintMoved = false;

  function dictNorm(text) {
    return String(text || "")
      .toLowerCase()
      .replaceAll("ё", "е")
      .replace(/[^0-9a-zа-я]+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function dictId(prefix) {
    return `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
  }

  function dictionaryDirty() {
    return JSON.stringify(dictionaryBook || {}) !== dictionarySaved;
  }

  function dictionaryIsOpen() {
    return Boolean($("dictionary-layer")?.classList.contains("open"));
  }

  function dictionaryTextUndo(event) {
    if (!dictionaryIsOpen()) return false;
    const el = event.target;
    if (!el?.closest?.("#dictionary-layer") || el.closest?.(".dictionary-md")) return false;
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName === "INPUT") {
      const type = String(el.type || "text").toLowerCase();
      return type === "text" || type === "search" || type === "";
    }
    return false;
  }

  function selectedEntry() {
    const list = dictionaryBook?.[dictionaryPick.kind] || [];
    return list.find((item) => item.id === dictionaryPick.id) || null;
  }

  async function loadDictionary() {
    const data = await apiGet("/api/dictionary");
    dictionaryBook = data.book;
    dictionaryCatalog = data.catalog;
    dictionaryBroken = Boolean(data.broken);
    dictionarySaved = JSON.stringify(dictionaryBook);
    const banner = $("dictionary-broken");
    if (banner) banner.hidden = !dictionaryBroken;
    if (!selectedEntry()) {
      const first = (dictionaryBook.commands || [])[0];
      dictionaryPick = { kind: "commands", id: first?.id || "" };
    }
    renderDictionary();
  }

  function renderDictionary() {
    if (!dictionaryBook) return;
    paintDictionaryLists();
    renderDictionaryEditor();
    refreshDictionaryProbe();
  }

  function paintDictionaryLists() {
    renderDictionaryList("synonyms", $("dictionary-synonyms"), (item) => ({
      title: (item.words || []).join(", "),
      sub: (item.values || []).join(", "),
    }));
    renderDictionaryList("commands", $("dictionary-commands"), (item) => {
      const phrases = item.phrases || [];
      const extra = phrases.length > 1 ? ` · ещё ${phrases.length - 1}` : "";
      const kind = (dictionaryCatalog?.answers || []).find((row) => row.id === item.answer);
      return {
        title: `${phrases[0] || "без названия"}${extra}`,
        sub: kind?.title || item.answer || "",
        tip: phrases.join(", "),
      };
    });
    renderDictionaryList("keywords", $("dictionary-keywords"), (item) => {
      const action = (dictionaryCatalog?.actions || []).find((row) => row.id === item.action);
      return {
        title: action?.title || item.action || "ключевое слово",
        sub: (item.words || []).join(", ") || "нет слов",
        tip: "Слова одного действия. Новое слово добавляется в эту карточку, а не отдельной записью.",
      };
    });
  }

  function refreshDictionaryProbe() {
    if (String($("dictionary-probe-query")?.value || "").trim()) scheduleProbe();
  }

  function noteDictionaryEdit() {
    paintDictionaryLists();
    refreshDictionaryProbe();
  }

  function renderDictionaryList(kind, box, label) {
    if (!box) return;
    const needle = dictNorm($("dictionary-filter")?.value || "");
    box.replaceChildren();
    for (const item of dictionaryBook[kind] || []) {
      const text = label(item);
      const blob = dictNorm(`${text.title} ${text.sub}`);
      if (needle && !blob.includes(needle)) continue;
      const row = document.createElement("div");
      row.className = "dictionary-row";
      row.tabIndex = 0;
      if (!item.enabled) row.classList.add("is-off");
      if (dictionaryPick.kind === kind && dictionaryPick.id === item.id) row.classList.add("on");
      const body = document.createElement("div");
      body.className = "dictionary-row-body";
      const title = document.createElement("strong");
      title.textContent = text.title || "без названия";
      const sub = document.createElement("span");
      sub.textContent = text.sub || "";
      body.append(title, sub);
      const sampleKind = kind === "keywords" ? "keywords" : "commands";
      if (kind !== "synonyms" && factorySample(sampleKind, item.id)) {
        const mark = document.createElement("em");
        mark.textContent = sameFactory(kind, item) ? "заводская" : "изменённая";
        body.append(mark);
      }
      row.append(body);
      const tools = cardTools(kind, item);
      if (tools) row.append(tools);
      if (text.tip) row.title = text.tip;
      const open = () => {
        dictionaryPick = { kind, id: item.id };
        renderDictionary();
      };
      row.addEventListener("click", open);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter") open();
      });
      box.append(row);
    }
    if (!box.childElementCount) {
      const empty = document.createElement("p");
      empty.className = "dictionary-empty";
      empty.textContent = needle ? "В этом списке ничего не нашлось." : "Пока пусто. Кнопка «Добавить» над списком создаёт карточку.";
      box.append(empty);
    }
  }

  function cardSwitch(item, key, caption, tip) {
    const mark = document.createElement("label");
    mark.className = "dictionary-switch";
    mark.title = tip;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(item[key]);
    input.title = tip;
    mark.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("change", () => {
      item[key] = input.checked;
      renderDictionary();
    });
    const name = document.createElement("span");
    name.textContent = caption;
    mark.append(input, toggleTrack(), name);
    return mark;
  }

  function toggleTrack() {
    const track = document.createElement("span");
    track.className = "dictionary-toggle";
    track.setAttribute("aria-hidden", "true");
    return track;
  }

  function cardTools(kind, item) {
    if (kind === "keywords") return null;
    const bar = document.createElement("div");
    bar.className = "dictionary-card-tools";
    bar.append(cardSwitch(item, "enabled", "вкл", "Карточка включена. Выключенная не участвует в запросах."));
    if (kind !== "synonyms") {
      bar.append(cardSwitch(item, "bot", "бот", "Бот. Включено — карточка работает в Telegram."));
      bar.append(cardSwitch(item, "desk", "поиск", "Поиск на компьютере. Включено — карточка работает в окне Shift+Enter."));
    }
    if (kind === "commands" && factorySample("commands", item.id)) {
      return bar;
    }
    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "dictionary-card-x";
    drop.textContent = "×";
    drop.title = "Удалить эту карточку";
    drop.setAttribute("aria-label", "Удалить эту карточку");
    drop.addEventListener("click", async (event) => {
      event.stopPropagation();
      const list = dictionaryBook?.[kind];
      if (!list) return;
      const index = list.findIndex((row) => row.id === item.id);
      if (index < 0) return;
      const yes = await askConfirm({
        title: "Удалить карточку?",
        text: "Эта карточка исчезнет из словаря. Свою карточку вернуть нельзя. Заводскую вернёт кнопка «Заводской словарь» в шапке.",
        ok: "Удалить",
        cancel: "Отмена",
        danger: true,
      });
      if (!yes) return;
      list.splice(index, 1);
      if (dictionaryPick.kind === kind && dictionaryPick.id === item.id) dictionaryPick.id = list[0]?.id || "";
      renderDictionary();
    });
    bar.append(drop);
    return bar;
  }

  function field(label, node) {
    const wrap = document.createElement("div");
    wrap.className = "dictionary-field";
    const name = document.createElement("span");
    name.textContent = label;
    wrap.append(name, node);
    return wrap;
  }

  function factorySample(kind, id) {
    const list = dictionaryCatalog?.factory?.[kind] || [];
    return list.find((row) => row.id === id) || null;
  }

  function sameFactory(kind, item) {
    const sample = factorySample(kind === "commands" ? "commands" : "keywords", item.id);
    if (!sample) return false;
    const keys = kind === "keywords"
      ? ["words", "action", "enabled", "bot", "desk"]
      : ["phrases", "answer", "slices", "metrics", "template", "action", "snapKind", "snapHide", "delivery", "enabled", "bot", "desk"];
    return keys.every((key) => JSON.stringify(item[key] ?? "") === JSON.stringify(sample[key] ?? ""));
  }

  function synonymDupes() {
    const seen = new Map();
    for (const row of dictionaryBook?.synonyms || []) {
      const keys = new Set();
      for (const value of [...(row.words || []), ...(row.values || [])]) {
        const key = dictNorm(value);
        if (key) keys.add(key);
      }
      for (const key of keys) seen.set(key, (seen.get(key) || 0) + 1);
    }
    return seen;
  }

  function keywordTaken(word, exceptId) {
    const key = dictNorm(word);
    if (!key) return "";
    for (const row of dictionaryBook?.keywords || []) {
      if (row.id === exceptId) continue;
      if ((row.words || []).some((value) => dictNorm(value) === key)) {
        const action = (dictionaryCatalog?.actions || []).find((item) => item.id === row.action);
        return action?.title || row.action || "другой карточке";
      }
    }
    return "";
  }

  function keywordDupes(item) {
    const map = new Map();
    const local = new Map();
    for (const value of item.words || []) {
      const key = dictNorm(value);
      if (!key) continue;
      local.set(key, (local.get(key) || 0) + 1);
      if (keywordTaken(value, item.id) || local.get(key) > 1) map.set(key, 2);
    }
    return map;
  }

  function commandPhraseOwner(word, exceptId) {
    const key = dictNorm(word);
    if (!key) return "";
    for (const row of dictionaryBook?.commands || []) {
      if (row.id === exceptId) continue;
      if ((row.phrases || []).some((value) => dictNorm(value) === key)) {
        return (row.phrases || []).find((value) => String(value).trim()) || "другой команде";
      }
    }
    return "";
  }

  function commandPhraseDupes(item) {
    const map = new Map();
    const local = new Map();
    for (const value of item.phrases || []) {
      const key = dictNorm(value);
      if (!key) continue;
      local.set(key, (local.get(key) || 0) + 1);
      if (commandPhraseOwner(value, item.id) || local.get(key) > 1) map.set(key, 2);
    }
    return map;
  }

  function chips(values, onChange, dupes, placeholder, accept) {
    const box = document.createElement("div");
    box.className = "dictionary-chips";
    const seen = dupes || new Map();
    if (!dupes) {
      for (const value of values) {
        const key = dictNorm(value);
        if (!key) continue;
        seen.set(key, (seen.get(key) || 0) + 1);
      }
    }
    const draw = () => {
      box.replaceChildren();
      values.forEach((value, index) => {
        const chip = document.createElement("span");
        chip.className = "dictionary-chip";
        const key = dictNorm(value);
        if (key && seen.get(key) > 1) chip.classList.add("is-dup");
        const word = document.createElement("span");
        word.textContent = value;
        const drop = document.createElement("button");
        drop.type = "button";
        drop.textContent = "×";
        drop.title = "Убрать это слово из карточки";
        drop.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          values.splice(index, 1);
          onChange();
        });
        chip.append(word, drop);
        box.append(chip);
      });
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = placeholder || "добавить и Enter";
      input.title = "Enter добавляет это слово в карточку";
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        const next = input.value.trim();
        if (!next) return;
        if (accept && accept(next) === false) return;
        values.push(next);
        onChange();
      });
      box.append(input);
    };
    draw();
    return box;
  }

  function pickMenu(value, rows, onPick, title) {
    const wrap = document.createElement("div");
    wrap.className = "dictionary-menu";
    const current = rows.find((row) => row.id === value) || rows[0];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dictionary-menu-btn";
    btn.textContent = current?.title || "выберите";
    btn.title = title || "Открыть список";
    const list = document.createElement("div");
    list.className = "dictionary-menu-list";
    list.hidden = true;
    for (const row of rows) {
      const option = document.createElement("button");
      option.type = "button";
      option.textContent = row.title;
      if (row.id === value) option.classList.add("on");
      option.addEventListener("click", (event) => {
        event.stopPropagation();
        list.hidden = true;
        onPick(row.id);
      });
      list.append(option);
    }
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const wasClosed = list.hidden;
      document.querySelectorAll(".dictionary-menu-list").forEach((node) => {
        node.hidden = true;
      });
      list.hidden = !wasClosed;
    });
    wrap.append(btn, list);
    return wrap;
  }

  function renderDictionaryEditor() {
    const box = $("dictionary-editor");
    const item = selectedEntry();
    if (!box) return;
    box.replaceChildren();
    if (!item) {
      box.textContent = "Выберите запись слева.";
      return;
    }
    const redraw = () => renderDictionary();
    if (dictionaryPick.kind === "synonyms") {
      const dupes = synonymDupes();
      const hint = document.createElement("p");
      hint.className = "dictionary-note";
      hint.textContent = "Слева — как слово стоит в заказе: ст, п, эт. Справа — как вы пишете в запросе: строение, подъезд, этаж. Ищутся оба.";
      box.append(
        hint,
        field("Как в отчёте", chips(item.words, redraw, dupes, "ст и Enter")),
        field("Как в запросе", chips(item.values, redraw, dupes, "строение и Enter")),
      );
    } else if (dictionaryPick.kind === "keywords") {
      item.words = item.words || [];
      const action = (dictionaryCatalog?.actions || []).find((row) => row.id === item.action);
      const name = document.createElement("p");
      name.className = "dictionary-note";
      name.textContent = `«${action?.title || item.action}» работает только в боте. Слово, которое уже есть в другой карточке, сюда не добавляется.`;
      box.append(name, field("Слова для бота", chips(item.words, redraw, keywordDupes(item), "новое слово и Enter", (next) => {
        const owner = keywordTaken(next, item.id);
        if (owner) {
          toast(`«${next}» уже есть в карточке «${owner}»`);
          return false;
        }
        if ((item.words || []).some((value) => dictNorm(value) === dictNorm(next))) {
          toast(`«${next}» уже есть в этой карточке`);
          return false;
        }
        return true;
      })));
    } else {
      box.append(field("Фразы", chips(item.phrases, redraw, commandPhraseDupes(item), "фраза и Enter", (next) => {
        const owner = commandPhraseOwner(next, item.id);
        if (owner) {
          toast(`«${next}» уже есть в команде «${owner}»`);
          return false;
        }
        if ((item.phrases || []).some((value) => dictNorm(value) === dictNorm(next))) {
          toast(`«${next}» уже есть в этой команде`);
          return false;
        }
        return true;
      })));
      const answers = [...(dictionaryCatalog?.answers || [])];
      if (item.answer && !answers.some((row) => row.id === item.answer)) {
        answers.unshift({ id: item.answer, title: item.answer });
      }
      const kind = pickMenu(
        item.answer,
        answers.map((answer) => ({ id: answer.id, title: answer.title })),
        (id) => {
          item.answer = id;
          renderDictionary();
        },
        "Какой ответ собрать: срезы, показатели, шаблон, действие или снимок",
      );
      box.append(field("Ответ", kind), answerEditor(item));
    }
    const factoryKind = dictionaryPick.kind === "keywords" ? "keywords" : "commands";
    if (factorySample(factoryKind, item.id) && !sameFactory(dictionaryPick.kind, item)) {
      const back = document.createElement("button");
      back.type = "button";
      back.className = "btn small";
      back.textContent = "Вернуть эту карточку";
      back.title = "Заводские фразы и ответ только этой карточки. Остальной словарь не меняется";
      back.addEventListener("click", async () => {
        const yes = await askConfirm({
          title: "Вернуть эту карточку?",
          text: dictionaryPick.kind === "keywords"
            ? "Слова этой карточки станут заводскими. Остальной словарь не изменится."
            : "Фразы, ответ и тумблеры этой карточки станут заводскими. Остальной словарь не изменится. Текущую правку карточки вернуть будет нельзя.",
          ok: "Вернуть",
          cancel: "Отмена",
          danger: true,
        });
        if (!yes) return;
        const data = await apiPost("/api/dictionary/reset", { ...dictionaryPick, book: dictionaryBook });
        dictionaryBook = data.book;
        dictionarySaved = JSON.stringify(dictionaryBook);
        renderDictionary();
      });
      box.append(back);
    }
  }

  function answerEditor(item) {
    const box = document.createElement("div");
    if (item.answer === "slices") {
      const list = document.createElement("div");
      list.className = "dictionary-checks";
      for (const slice of dictionaryCatalog?.slices || []) {
        const mark = document.createElement("label");
        mark.className = "dictionary-check";
        mark.title = `Включить срез «${slice.title}» в ответ этой команды`;
        const input = document.createElement("input");
        input.type = "checkbox";
        input.title = mark.title;
        input.checked = (item.slices || []).includes(slice.id);
        input.addEventListener("change", () => {
          const set = new Set(item.slices || []);
          if (input.checked) set.add(slice.id);
          else set.delete(slice.id);
          item.slices = (dictionaryCatalog.slices || []).map((row) => row.id).filter((id) => set.has(id));
          noteDictionaryEdit();
        });
        mark.append(input, toggleTrack(), document.createTextNode(slice.title));
        list.append(mark);
      }
      box.append(list);
    } else if (item.answer === "metrics") {
      box.append(metricEditor(item));
    } else if (item.answer === "template") {
      box.append(templateEditor(item));
    } else if (item.answer === "help") {
      box.append(helpPreview());
    } else if (item.answer === "action") {
      box.append(pickMenu(
        item.action,
        (dictionaryCatalog?.nav || []).map((act) => ({ id: act.id, title: act.title })),
        (id) => {
          item.action = id;
          noteDictionaryEdit();
          renderDictionaryEditor();
        },
        "Куда перейти по этой команде",
      ));
    } else if (item.answer === "snap") {
      box.append(pickMenu(
        item.snapKind,
        ["png", "pdf", "txt"].map((kind) => ({ id: kind, title: kind })),
        (id) => {
          item.snapKind = id;
          noteDictionaryEdit();
          renderDictionaryEditor();
        },
        "Формат снимка",
      ));
      const hide = document.createElement("input");
      hide.type = "checkbox";
      hide.checked = Boolean(item.snapHide);
      hide.addEventListener("change", () => {
        item.snapHide = hide.checked;
        noteDictionaryEdit();
      });
      const hideMark = document.createElement("label");
      hideMark.className = "dictionary-check";
      hideMark.append(hide, toggleTrack(), document.createTextNode("скрыть цены"));
      box.append(hideMark);
    }
    const deliveryRows = [{ id: "", title: "как в фразе" }];
    for (const row of dictionaryCatalog?.deliveries || []) {
      if (!row.id) continue;
      deliveryRows.push({ id: row.id, title: row.title });
    }
    const delivery = pickMenu(
      item.delivery || "",
      deliveryRows,
      (id) => {
        item.delivery = id;
        noteDictionaryEdit();
        renderDictionaryEditor();
      },
      "Как отдавать ответ, если в самой фразе нет слова pdf, текст, фото или md",
    );
    if (item.answer !== "help") box.append(field("Отдача по умолчанию", delivery));
    return box;
  }

  function helpPreview() {
    const box = document.createElement("div");
    box.className = "dictionary-help-preview";
    const note = document.createElement("p");
    note.className = "dictionary-note";
    note.textContent = "Список собирается из включённых команд. «Что умеешь» в него не входит. Слова бота — только в колонке бота.";
    const grid = document.createElement("div");
    grid.className = "dictionary-help-columns";
    for (const [surface, title] of [["bot", "Как бот"], ["desk", "Как поиск"]]) {
      const column = document.createElement("div");
      const head = document.createElement("span");
      head.className = "dictionary-note";
      head.textContent = title;
      const list = document.createElement("div");
      list.className = "dictionary-probe-out";
      const lines = [];
      for (const cmd of dictionaryBook?.commands || []) {
        if (!cmd.enabled || cmd.answer === "help" || cmd.id === "help") continue;
        if (surface === "bot" ? !cmd.bot : !cmd.desk) continue;
        const phrases = (cmd.phrases || []).filter((phrase) => String(phrase).trim());
        if (phrases.length) lines.push(phrases.join(", "));
      }
      if (surface === "bot") {
        for (const row of dictionaryBook?.keywords || []) {
          const words = (row.words || []).filter((word) => String(word).trim());
          if (!words.length) continue;
          const action = (dictionaryCatalog?.actions || []).find((item) => item.id === row.action);
          lines.push(`${words.join(", ")} — ${action?.title || row.action}`);
        }
      }
      list.textContent = lines.join("\n") || "Для этой стороны команд нет.";
      column.append(head, list);
      grid.append(column);
    }
    box.append(note, grid);
    return box;
  }

  function metricEditor(item) {
    item.metrics = item.metrics || [];
    const formats = [
      { id: "money", title: "деньги" },
      { id: "number", title: "число" },
      { id: "percent", title: "проценты" },
      { id: "text", title: "текст" },
    ];
    const box = document.createElement("div");
    box.className = "dictionary-metrics";
    const note = document.createElement("p");
    note.className = "dictionary-note";
    note.textContent = "Нажмите показатель — он попадёт в ответ этой команды. Ниже у него подпись, вид числа и крестик, который убирает его из ответа. Стрелки меняют порядок.";
    const pickLabel = document.createElement("span");
    pickLabel.className = "dictionary-note";
    pickLabel.textContent = "Добавить в ответ";
    const catalog = document.createElement("div");
    catalog.className = "dictionary-metric-catalog";
    const chosen = new Set(item.metrics.map((row) => row.key));
    for (const metric of dictionaryCatalog?.metrics || []) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "dictionary-metric-add";
      chip.textContent = metric.title;
      if (chosen.has(metric.id)) {
        chip.classList.add("on");
        chip.disabled = true;
        chip.title = "Уже в ответе. Убрать можно крестиком в списке ниже";
      } else {
        chip.title = `Добавить «${metric.title}» в ответ`;
        chip.addEventListener("click", () => {
          item.metrics.push({
            key: metric.id,
            label: metric.title,
            format: metric.format || "money",
            hideZero: false,
          });
          noteDictionaryEdit();
          renderDictionaryEditor();
        });
      }
      catalog.append(chip);
    }
    const answerLabel = document.createElement("span");
    answerLabel.className = "dictionary-note";
    answerLabel.textContent = "В ответе, сверху вниз";
    const list = document.createElement("div");
    list.className = "dictionary-metric-list";
    if (!item.metrics.length) {
      const empty = document.createElement("p");
      empty.className = "dictionary-note";
      empty.textContent = "Пока пусто. Нажмите показатель выше.";
      list.append(empty);
    }
    item.metrics.forEach((row, index) => {
      const line = document.createElement("div");
      line.className = "dictionary-metric";
      const label = document.createElement("input");
      label.value = row.label || "";
      label.placeholder = "подпись в ответе";
      label.title = "Как показатель называется в ответе";
      label.addEventListener("input", () => {
        row.label = label.value;
        noteDictionaryEdit();
      });
      const format = pickMenu(
        row.format,
        formats,
        (id) => {
          row.format = id;
          noteDictionaryEdit();
          renderDictionaryEditor();
        },
        "Как показать число: деньги, число, проценты или текст",
      );
      const hide = document.createElement("label");
      hide.className = "dictionary-check";
      const hideInput = document.createElement("input");
      hideInput.type = "checkbox";
      hideInput.checked = Boolean(row.hideZero);
      hideInput.title = "Не показывать этот показатель, если он равен нулю";
      hideInput.addEventListener("change", () => {
        row.hideZero = hideInput.checked;
        noteDictionaryEdit();
      });
      hide.append(hideInput, toggleTrack(), document.createTextNode("скрыть 0"));
      const shift = (delta) => {
        const next = index + delta;
        if (next < 0 || next >= item.metrics.length) return;
        const [moved] = item.metrics.splice(index, 1);
        item.metrics.splice(next, 0, moved);
        noteDictionaryEdit();
        renderDictionaryEditor();
      };
      const up = document.createElement("button");
      up.type = "button";
      up.className = "dictionary-card-x";
      up.textContent = "↑";
      up.title = "Выше в ответе";
      up.disabled = index === 0;
      up.addEventListener("click", () => shift(-1));
      const down = document.createElement("button");
      down.type = "button";
      down.className = "dictionary-card-x";
      down.textContent = "↓";
      down.title = "Ниже в ответе";
      down.disabled = index === item.metrics.length - 1;
      down.addEventListener("click", () => shift(1));
      const drop = document.createElement("button");
      drop.type = "button";
      drop.className = "dictionary-card-x";
      drop.textContent = "×";
      drop.title = "Убрать показатель из ответа";
      drop.addEventListener("click", () => {
        item.metrics.splice(index, 1);
        noteDictionaryEdit();
        renderDictionaryEditor();
      });
      line.append(label, format, hide, up, down, drop);
      list.append(line);
    });
    box.append(note, pickLabel, catalog, answerLabel, list);
    return box;
  }

  function templateEditor(item) {
    const box = document.createElement("div");
    const pairs = [
      ["b", "Ж", "Жирный"],
      ["i", "К", "Курсив"],
      ["h", "З", "Заголовок"],
      ["li", "•", "Список"],
      ["q", "«", "Цитата"],
      ["code", "⟨⟩", "Код"],
    ];
    const glyphOf = Object.fromEntries([
      ...pairs,
      ["table", "⊞", "Таблица"],
      ["th", "Ш", "Шапка"],
      ["td", "Я", "Ячейка"],
    ].map((row) => [row[0], row]));
    const pairKind = new Set([...pairs.map((row) => row[0]), "table", "th", "td"]);
    const editor = document.createElement("div");
    editor.className = "dictionary-md";
    editor.contentEditable = "true";
    editor.spellcheck = false;
    editor.setAttribute("role", "textbox");
    editor.setAttribute("aria-label", "Шаблон ответа");
    const panel = document.createElement("div");
    panel.className = "dictionary-md-panel";
    panel.hidden = true;
    let quiet = false;
    let snapshot = "";
    const undoStack = [];
    const redoStack = [];
    let dragChip = null;
    let panelChip = null;

    const chipNode = (token, kind, role, pair, glyph, num, label) => {
      const chip = document.createElement("span");
      chip.className = `dictionary-md-chip${role === "close" ? " is-close" : ""}${kind === "sep" ? " is-sep" : ""}`;
      chip.contentEditable = "false";
      chip.draggable = true;
      chip.dataset.token = token;
      chip.dataset.kind = kind;
      if (pair) chip.dataset.pair = pair;
      if (role) chip.dataset.role = role;
      const mark = document.createElement("b");
      mark.textContent = glyph || label || kind;
      chip.append(mark);
      if (num) {
        const index = document.createElement("sup");
        index.textContent = num;
        chip.append(index);
      }
      if (label && !role && kind !== "sep") {
        const name = document.createElement("span");
        name.textContent = label;
        chip.append(name);
      }
      const drop = document.createElement("button");
      drop.type = "button";
      drop.className = "dictionary-md-x";
      drop.textContent = "×";
      drop.title = kind === "sep" ? "Убрать разделитель" : pair ? "Убрать. Второй значок тоже пропадёт" : "Убрать";
      chip.append(drop);
      const tip = role === "open" ? "начало" : role === "close" ? "конец" : "перетащите в нужное место";
      chip.title = `${label || glyph || kind}, ${tip}`;
      return chip;
    };
    const pushText = (value) => {
      const parts = String(value || "").split("\n");
      parts.forEach((part, index) => {
        if (part) editor.append(document.createTextNode(part));
        if (index < parts.length - 1) editor.append(document.createElement("br"));
      });
    };
    const paintTemplate = (text) => {
      editor.replaceChildren();
      const open = {};
      const re = /\{\{([^}]+)\}\}/g;
      let cursor = 0;
      let match = re.exec(text || "");
      while (match) {
        pushText((text || "").slice(cursor, match.index));
        cursor = match.index + match[0].length;
        const token = match[1].trim();
        const raw = match[0];
        if (token === "|") {
          editor.append(chipNode(raw, "sep", "", "", "|", "", "Разделитель"));
        } else if (token.startsWith("/")) {
          const kind = token.slice(1);
          const pile = open[kind] || [];
          const pair = pile.pop() || `p${kind}`;
          editor.append(chipNode(raw, kind, "close", pair, glyphOf[kind]?.[1] || kind, "2", glyphOf[kind]?.[2] || ""));
        } else if (pairKind.has(token)) {
          const pair = `p${token}${cursor}`;
          open[token] = open[token] || [];
          open[token].push(pair);
          editor.append(chipNode(raw, token, "open", pair, glyphOf[token][1], "1", glyphOf[token][2]));
        } else if (token.startsWith("slice:")) {
          const key = token.slice(6).split(":")[0];
          const row = (dictionaryCatalog?.slices || []).find((item) => item.id === key);
          editor.append(chipNode(raw, "slice", "", "", "▣", "", row?.title || key));
        } else if (token.startsWith("metric:")) {
          const key = token.slice(7);
          const row = (dictionaryCatalog?.metrics || []).find((entry) => entry.id === key);
          editor.append(chipNode(raw, "metric", "", "", "#", "", row?.title || key));
        } else {
          pushText(raw);
        }
        match = re.exec(text || "");
      }
      pushText((text || "").slice(cursor));
    };
    const serialize = () => {
      let out = "";
      const walk = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) out += child.textContent || "";
          else if (child.dataset?.token) out += child.dataset.token;
          else if (child.tagName === "BR") out += "\n";
          else if (child.tagName === "DIV" || child.tagName === "P") {
            if (out && !out.endsWith("\n")) out += "\n";
            walk(child);
          } else walk(child);
        }
      };
      walk(editor);
      item.template = out;
      noteDictionaryEdit();
      runPreview();
    };
    const heal = () => {
      const counts = new Map();
      editor.querySelectorAll(".dictionary-md-chip[data-pair]").forEach((chip) => {
        counts.set(chip.dataset.pair, (counts.get(chip.dataset.pair) || 0) + 1);
      });
      editor.querySelectorAll(".dictionary-md-chip[data-pair]").forEach((chip) => {
        if (counts.get(chip.dataset.pair) < 2) chip.remove();
      });
    };
    const remember = () => {
      if (quiet) return;
      heal();
      const html = editor.innerHTML;
      if (html === snapshot) return;
      undoStack.push(snapshot);
      if (undoStack.length > 80) undoStack.shift();
      redoStack.length = 0;
      snapshot = html;
    };
    const restore = (html) => {
      quiet = true;
      editor.innerHTML = html;
      heal();
      snapshot = editor.innerHTML;
      quiet = false;
      panel.hidden = true;
      serialize();
    };
    const insertHtml = (html) => {
      editor.focus();
      const sel = document.getSelection();
      let range = null;
      if (sel && sel.rangeCount) {
        const live = sel.getRangeAt(0);
        if (editor.contains(live.startContainer) && editor.contains(live.endContainer)) range = live;
      }
      if (!range) {
        range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
      }
      range.deleteContents();
      const holder = document.createElement("template");
      holder.innerHTML = html;
      const frag = document.createDocumentFragment();
      let last = null;
      for (const node of [...holder.content.childNodes]) {
        last = node;
        frag.append(node);
      }
      range.insertNode(frag);
      if (last) {
        const after = document.createRange();
        after.setStartAfter(last);
        after.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(after);
      }
      remember();
      serialize();
    };
    const pairHtml = (kind) => {
      const info = glyphOf[kind];
      const pair = `p${Date.now().toString(36)}`;
      const open = chipNode(`{{${kind}}}`, kind, "open", pair, info[1], "1", info[2]);
      const close = chipNode(`{{/${kind}}}`, kind, "close", pair, info[1], "2", info[2]);
      return open.outerHTML + close.outerHTML;
    };
    const preview = document.createElement("div");
    preview.className = "dictionary-probe-out";
    const previewTitle = document.createElement("span");
    previewTitle.className = "dictionary-note";
    previewTitle.textContent = "Как увидит пользователь";
    let previewTimer = 0;
    const runPreview = () => {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(async () => {
        const phrase = (item.phrases || []).find((value) => String(value).trim());
        if (!phrase) {
          preview.textContent = "Добавьте фразу команды — здесь появится ответ по открытому отчёту.";
          return;
        }
        try {
          const data = await apiPost("/api/dictionary/probe", {
            query: phrase,
            surface: item.desk === false && item.bot ? "bot" : "desk",
            doc: state.doc || null,
            book: dictionaryBook,
          });
          paintAnswer(preview, data);
        } catch (err) {
          preview.textContent = err.message || "Просмотр не вышел";
        }
      }, 280);
    };
    const lineItems = (node) => {
      if (!node) return [];
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent ? [{ type: "text", text: node.textContent, node }] : [];
      }
      if (node.classList?.contains("dictionary-md-chip")) return [{ type: "chip", node }];
      if (node.tagName === "BR") return [];
      const items = [];
      for (const child of node.childNodes || []) items.push(...lineItems(child));
      return items;
    };
    const editorLines = () => {
      const children = [...editor.childNodes];
      const blocked = children.some((node) => node.nodeType === 1 && (node.tagName === "DIV" || node.tagName === "P"));
      if (!blocked) {
        const lines = [[]];
        for (const child of children) {
          if (child.tagName === "BR") lines.push([]);
          else lines[lines.length - 1].push(...lineItems(child));
        }
        return lines;
      }
      const lines = children.map((child) => (child.tagName === "BR" ? [] : lineItems(child)));
      return lines.length ? lines : [[]];
    };
    const caretLineIndex = (lines) => {
      const sel = document.getSelection();
      if (!sel?.rangeCount || !editor.contains(sel.anchorNode)) return Math.max(0, lines.length - 1);
      const children = [...editor.childNodes];
      const blocked = children.some((node) => node.nodeType === 1 && (node.tagName === "DIV" || node.tagName === "P"));
      if (!blocked) {
        let index = 0;
        for (const child of children) {
          if (child === sel.anchorNode || child.contains?.(sel.anchorNode)) {
            if (child.nodeType === Node.TEXT_NODE) index += (child.textContent || "").slice(0, sel.anchorOffset).split("\n").length - 1;
            return Math.max(0, Math.min(index, lines.length - 1));
          }
          if (child.tagName === "BR") index += 1;
        }
        return Math.max(0, Math.min(index, lines.length - 1));
      }
      const anchor = sel.anchorNode;
      const index = children.findIndex((child) => child === anchor || child.contains?.(anchor));
      return index >= 0 ? index : Math.max(0, lines.length - 1);
    };
    const isEmptyLine = (line) => !line?.some((item) => item.type === "chip" || (item.type === "text" && item.text.trim()));
    const tableItems = (line) => (line || []).filter((item) => item.type === "chip" && (item.node.dataset.kind === "table" || item.node.dataset.kind === "sep"));
    const caretInsideTable = (line) => {
      const sel = document.getSelection();
      if (!sel?.rangeCount) return false;
      const range = sel.getRangeAt(0);
      const chips = tableItems(line).filter((item) => item.node.dataset.kind === "table");
      return chips.some((open) => {
        if (open.node.dataset.role !== "open") return false;
        const close = chips.find((item) => item.node.dataset.role === "close" && item.node.dataset.pair === open.node.dataset.pair);
        if (!close) return false;
        const afterOpen = document.createRange();
        afterOpen.setStartAfter(open.node);
        afterOpen.collapse(true);
        const beforeClose = document.createRange();
        beforeClose.setStartBefore(close.node);
        beforeClose.collapse(true);
        return afterOpen.compareBoundaryPoints(Range.START_TO_START, range) <= 0
          && range.compareBoundaryPoints(Range.START_TO_START, beforeClose) <= 0;
      });
    };
    const sepHtml = () => chipNode("{{|}}", "sep", "", "", "|", "", "Разделитель").outerHTML;
    const cloneTableIcons = (line) => {
      const pair = `p${Date.now().toString(36)}`;
      return tableItems(line).map((item) => {
        if (item.node.dataset.kind === "sep") return sepHtml();
        const role = item.node.dataset.role === "close" ? "close" : "open";
        const token = role === "close" ? "{{/table}}" : "{{table}}";
        return chipNode(token, "table", role, pair, "⊞", role === "close" ? "2" : "1", "Таблица").outerHTML;
      }).join("");
    };
    const insertTablePair = () => {
      const pair = `p${Date.now().toString(36)}`;
      insertHtml(
        chipNode("{{table}}", "table", "open", pair, "⊞", "1", "Таблица").outerHTML
        + chipNode("{{/table}}", "table", "close", pair, "⊞", "2", "Таблица").outerHTML,
      );
      const open = editor.querySelector(`[data-pair="${pair}"][data-role="open"]`);
      if (!open) return;
      const range = document.createRange();
      range.setStartAfter(open);
      range.collapse(true);
      const sel = document.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    };
    const onTable = () => {
      editor.focus();
      const lines = editorLines();
      const index = caretLineIndex(lines);
      const line = lines[index] || [];
      if (isEmptyLine(line)) {
        const neighbor = [lines[index - 1], lines[index + 1]].find((item) => tableItems(item).length);
        if (neighbor) {
          insertHtml(cloneTableIcons(neighbor));
          return;
        }
      } else if (caretInsideTable(line)) {
        insertHtml(sepHtml());
        return;
      }
      insertTablePair();
    };
    const tools = document.createElement("div");
    tools.className = "dictionary-tools";
    for (const [kind, , label] of pairs) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn small";
      button.textContent = label;
      button.title = "Два значка: 1 — начало, 2 — конец. Их можно перетащить";
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => insertHtml(pairHtml(kind)));
      tools.append(button);
    }
    const tableButton = document.createElement("button");
    tableButton.type = "button";
    tableButton.className = "btn small";
    tableButton.textContent = "Таблица";
    tableButton.title = "Сначала два края. Повтор между ними — разделитель. На пустой строке рядом с таблицей — столько же значков, сколько в соседней строке";
    tableButton.addEventListener("mousedown", (event) => event.preventDefault());
    tableButton.addEventListener("click", onTable);
    tools.append(tableButton);
    const metric = pickMenu(
      "",
      [
        { id: "", title: "Вставить показатель" },
        ...(dictionaryCatalog?.metrics || []).map((row) => ({ id: row.id, title: row.title })),
      ],
      (id) => {
        if (!id) return;
        const row = (dictionaryCatalog?.metrics || []).find((entry) => entry.id === id);
        insertHtml(chipNode(`{{metric:${id}}}`, "metric", "", "", "#", "", row?.title || id).outerHTML);
      },
      "Вставить показатель в шаблон",
    );
    const sliceFields = (key) => {
      if ((dictionaryCatalog?.columnSlices || ["orders", "lines"]).includes(key)) return dictionaryCatalog?.columns || [];
      return dictionaryCatalog?.slicePicks?.[key] || [];
    };
    const sliceToken = (key, ids, fields) => {
      const defaults = (dictionaryCatalog?.columnSlices || []).includes(key)
        ? (dictionaryCatalog?.sliceColumns || [])
        : fields.map((field) => field.id);
      const same = ids.length === defaults.length && defaults.every((id) => ids.includes(id));
      return same || !ids.length ? `{{slice:${key}}}` : `{{slice:${key}:${ids.join(",")}}}`;
    };
    const openSlicePanel = (chip) => {
      panelChip = chip;
      panel.replaceChildren();
      const raw = String(chip.dataset.token || "");
      const body = raw.slice(2, -2).replace(/^slice:/, "");
      const [key, cols] = body.split(":");
      const fields = sliceFields(key);
      const note = document.createElement("p");
      note.className = "dictionary-note";
      if (!fields.length) {
        note.textContent = "Этот срез показывается целиком.";
        panel.append(note);
      } else {
        note.textContent = "Отметьте, что показать. Номер и название — шапка, остальные поля — строки.";
        const list = document.createElement("div");
        list.className = "dictionary-checks";
        const picked = new Set(cols ? cols.split(",").filter(Boolean) : (
          (dictionaryCatalog?.columnSlices || []).includes(key) ? dictionaryCatalog?.sliceColumns || [] : fields.map((field) => field.id)
        ));
        for (const field of fields) {
          const label = document.createElement("label");
          label.className = "dictionary-check";
          const input = document.createElement("input");
          input.type = "checkbox";
          input.checked = picked.has(field.id);
          input.addEventListener("change", () => {
            const ids = [...list.querySelectorAll("input")].flatMap((boxInput, index) => (boxInput.checked ? [fields[index].id] : []));
            if (!ids.length) {
              input.checked = true;
              toast("Оставьте хотя бы одно поле");
              return;
            }
            chip.dataset.token = sliceToken(key, ids, fields);
            remember();
            serialize();
          });
          const caption = document.createElement("span");
          caption.textContent = field.title;
          label.append(input, toggleTrack(), caption);
          list.append(label);
        }
        panel.append(note, list);
      }
      panel.hidden = false;
    };
    const slice = pickMenu(
      "",
      [
        { id: "", title: "Вставить срез" },
        ...(dictionaryCatalog?.slices || []).map((row) => ({ id: row.id, title: row.title })),
      ],
      (id) => {
        if (!id) return;
        const row = (dictionaryCatalog?.slices || []).find((entry) => entry.id === id);
        insertHtml(chipNode(`{{slice:${id}}}`, "slice", "", "", "▣", "", row?.title || id).outerHTML);
      },
      "Вставить срез в шаблон",
    );
    editor.addEventListener("input", () => {
      remember();
      serialize();
    });
    editor.addEventListener("paste", (event) => {
      event.preventDefault();
      document.execCommand("insertText", false, event.clipboardData?.getData("text/plain") || "");
    });
    editor.addEventListener("keydown", (event) => {
      const ctrl = event.ctrlKey || event.metaKey;
      if (!ctrl) return;
      if (event.code === "KeyZ" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        const prev = undoStack.pop();
        if (prev == null) return;
        redoStack.push(snapshot);
        restore(prev);
      } else if (event.code === "KeyY" || (event.code === "KeyZ" && event.shiftKey)) {
        event.preventDefault();
        event.stopPropagation();
        const next = redoStack.pop();
        if (next == null) return;
        undoStack.push(snapshot);
        restore(next);
      }
    });
    editor.addEventListener("click", (event) => {
      const chip = event.target.closest?.(".dictionary-md-chip");
      if (!chip || !editor.contains(chip)) return;
      if (event.target.closest(".dictionary-md-x")) {
        event.preventDefault();
        const pair = chip.dataset.pair;
        if (pair) editor.querySelectorAll(`[data-pair="${pair}"]`).forEach((node) => node.remove());
        else chip.remove();
        if (panelChip === chip) panel.hidden = true;
        remember();
        serialize();
        return;
      }
      if (chip.dataset.kind === "slice") openSlicePanel(chip);
    });
    editor.addEventListener("dragstart", (event) => {
      const chip = event.target.closest?.(".dictionary-md-chip");
      if (!chip) return;
      dragChip = chip;
      event.dataTransfer?.setData("text/plain", "chip");
      event.dataTransfer.effectAllowed = "move";
    });
    editor.addEventListener("dragover", (event) => {
      if (!dragChip) return;
      event.preventDefault();
    });
    editor.addEventListener("drop", (event) => {
      if (!dragChip) return;
      event.preventDefault();
      const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
      if (range && editor.contains(range.startContainer)) {
        let host = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
        const over = host?.closest?.(".dictionary-md-chip");
        if (over) range.setStartAfter(over);
        range.collapse(true);
        range.insertNode(dragChip);
      }
      dragChip = null;
      remember();
      serialize();
    });
    editor.addEventListener("dragend", () => { dragChip = null; });
    paintTemplate(item.template || "");
    snapshot = editor.innerHTML;
    runPreview();
    box.append(tools, metric, slice, editor, panel, previewTitle, preview);
    return box;
  }

  async function openDictionary() {
    $("dictionary-layer").hidden = false;
    $("dictionary-layer").classList.add("open");
    try {
      await loadDictionary();
    } catch (err) {
      toast(err.message || "Словарь не открылся");
    }
  }

  async function closeDictionary() {
    if (dictionaryDirty()) {
      const save = await askConfirm({
        title: "Сохранить словарь?",
        text: "В словаре есть несохранённая правка.",
        ok: "Сохранить",
        cancel: "Не сохранять",
      });
      if (save) {
        const ok = await saveDictionary();
        if (!ok) return;
      } else {
        await loadDictionary();
      }
    }
    const layer = $("dictionary-layer");
    layer.classList.remove("open");
    layer.hidden = true;
  }

  async function saveDictionary() {
    try {
      const data = await apiPost("/api/dictionary", { book: dictionaryBook });
      dictionaryBook = data.book;
      dictionaryBroken = false;
      dictionarySaved = JSON.stringify(dictionaryBook);
      $("dictionary-broken").hidden = true;
      renderDictionary();
      toast("Словарь сохранён");
      return true;
    } catch (err) {
      toast(err.message || "Не сохранилось");
      return false;
    }
  }

  function addDictionaryEntry(kind) {
    kind = kind || dictionaryPick.kind || "commands";
    let item;
    if (kind === "synonyms") {
      item = { id: dictId("syn"), words: [], values: [], enabled: true, builtin: false };
    } else if (kind === "keywords") {
      const used = new Set((dictionaryBook.keywords || []).map((row) => row.action));
      const free = (dictionaryCatalog?.actions || []).find((row) => !used.has(row.id));
      if (!free) {
        toast("Все действия уже есть. Новое слово пишется в карточку и добавляется клавишей Enter.");
        return;
      }
      item = { id: `kw-${free.id}`, words: [], action: free.id, enabled: true, builtin: false, bot: true, desk: false };
    } else {
      item = {
        id: dictId("cmd"),
        phrases: [],
        enabled: true,
        builtin: false,
        bot: true,
        desk: true,
        answer: "slices",
        slices: [],
        metrics: [],
        template: "",
        action: "",
        snapKind: "png",
        snapHide: false,
        delivery: "",
      };
    }
    dictionaryBook[kind].unshift(item);
    dictionaryPick = { kind, id: item.id };
    renderDictionary();
  }

  async function acceptDictionaryFile(path) {
    let info;
    try {
      info = await apiPost("/api/dictionary/inspect", { path });
    } catch (err) {
      toast(err.message || "Файл не открылся");
      return;
    }
    await openDictionary();
    if (info.working) return;
    if (!info.ok) {
      toast(info.error || "Это не словарь FinMaster.");
      return;
    }
    const yes = await askConfirm({
      title: "Заменить словарь?",
      text: "Открытый отчёт останется. Рабочий словарь будет заменён этим файлом.",
      ok: "Заменить",
      cancel: "Отмена",
    });
    if (!yes) return;
    dictionaryBook = info.book;
    await saveDictionary();
  }

  function localHintRows(query) {
    const q = dictNorm(query);
    if (!q || !dictionaryBook) return [];
    const rows = [];
    const push = (title, sub, score) => rows.push({ title, sub, score });
    for (const cmd of dictionaryBook.commands || []) {
      if (!cmd.enabled || (!cmd.bot && !cmd.desk)) continue;
      for (const phrase of cmd.phrases || []) {
        const mark = dictNorm(phrase);
        if (mark.startsWith(q)) push(phrase, "команда", mark === q ? 50 : 40);
      }
    }
    for (const kw of dictionaryBook.keywords || []) {
      if (!kw.enabled) continue;
      for (const word of kw.words || []) {
        const mark = dictNorm(word);
        if (mark.startsWith(q)) push(word, kw.action, mark === q ? 50 : 35);
      }
    }
    return rows.sort((a, b) => b.score - a.score).slice(0, 8);
  }

  function dictionaryPaletteItems(query) {
    return localHintRows(query).slice(0, 5).map((item) => ({
      group: "Отчёт",
      ico: "✦",
      title: item.title,
      sub: item.sub,
      run: () => openAskModal(item.title),
    }));
  }

  function paintAskHints(hints) {
    askHintItems = Array.isArray(hints)
      ? hints.map((item) => (typeof item === "string" ? { title: item, sub: "" } : item))
      : [];
    if (!askHintMoved) askHintIndex = 0;
    const box = $("ask-hints");
    if (!box) return;
    box.hidden = !askHintItems.length;
    box.replaceChildren();
    askHintItems.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `ask-suggest${index === askHintIndex ? " on" : ""}`;
      button.textContent = item.sub ? `${item.title} — ${item.sub}` : item.title;
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => runAskHint(index));
      box.append(button);
    });
  }

  function runAskHint(index) {
    const item = askHintItems[index];
    if (!item) return;
    const input = $("ask-query");
    input.value = item.title;
    askHintMoved = false;
    scheduleAsk(0);
  }

  function paintProbeSwitch() {
    $("dictionary-probe-bot")?.classList.toggle("primary", dictionaryProbeSurface === "bot");
    $("dictionary-probe-desk")?.classList.toggle("primary", dictionaryProbeSurface === "desk");
  }

  function probeText(data) {
    if (!data) return "";
    const lines = [];
    if (data.lead) lines.push(data.lead);
    for (const section of data.sections || []) {
      if (section.title) lines.push(section.title);
      for (const row of section.rows || []) {
        if (row.title) lines.push(row.meta ? `${row.title} · ${row.meta}` : row.title);
        if (row.text) lines.push(row.text);
        else if (row.items) lines.push(row.items.join(" · "));
      }
    }
    return lines.join("\n");
  }

  function askHtmlNode(html) {
    const root = document.createElement("div");
    root.className = "dictionary-rich";
    const source = document.createElement("template");
    source.innerHTML = String(html || "").replace(/\n/g, "<br>");
    const allow = new Set(["B", "I", "CODE", "BR", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH"]);
    const copy = (from, to) => {
      for (const node of from.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          to.append(document.createTextNode(node.textContent || ""));
        } else if (node.nodeType === Node.ELEMENT_NODE && allow.has(node.tagName)) {
          const el = document.createElement(node.tagName.toLowerCase());
          if (node.tagName !== "BR") copy(node, el);
          to.append(el);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          copy(node, to);
        }
      }
    };
    copy(source.content, root);
    return root;
  }

  function paintAnswer(box, data) {
    if (!box) return;
    box.replaceChildren();
    if (!data) return;
    if (data.html) {
      box.append(askHtmlNode(data.html));
      return;
    }
    box.textContent = probeText(data);
  }

  function paintProbe(data) {
    paintAnswer($("dictionary-probe-out"), data);
  }

  function scheduleProbe() {
    clearTimeout(dictionaryProbeTimer);
    dictionaryProbeTimer = setTimeout(async () => {
      const query = $("dictionary-probe-query")?.value || "";
      if (!query.trim()) {
        paintProbe(null);
        return;
      }
      try {
        const data = await apiPost("/api/dictionary/probe", {
          query,
          surface: dictionaryProbeSurface,
          doc: state.doc || null,
          book: dictionaryBook,
        });
        paintProbe(data);
      } catch (err) {
        paintProbe({ lead: err.message || "Проба не вышла" });
      }
    }, 220);
  }

  function bindDictionaryTest() {
    const panel = $("dictionary-test");
    const handle = $("dictionary-test-resizer");
    if (!panel || panel.dataset.bound) return;
    panel.dataset.bound = "1";
    const stored = Number(localStorage.getItem("finmaster.dictionary.testWidth"));
    if (stored >= 240) panel.style.width = `${stored}px`;
    if (localStorage.getItem("finmaster.dictionary.testOpen") === "0") panel.classList.add("is-closed");
    const paintTestToggle = () => {
      const btn = $("dictionary-test-toggle");
      if (!btn) return;
      const closed = panel.classList.contains("is-closed");
      btn.textContent = closed ? "‹" : "›";
      btn.title = closed ? "Открыть тест словаря" : "Скрыть тест словаря";
      btn.setAttribute("aria-label", btn.title);
    };
    const toggleTest = () => {
      panel.classList.toggle("is-closed");
      localStorage.setItem("finmaster.dictionary.testOpen", panel.classList.contains("is-closed") ? "0" : "1");
      paintTestToggle();
    };
    paintTestToggle();
    $("dictionary-test-toggle")?.addEventListener("click", toggleTest);
    handle?.addEventListener("pointerdown", (event) => {
      if (panel.classList.contains("is-closed")) return;
      event.preventDefault();
      const startX = event.clientX;
      const startW = panel.getBoundingClientRect().width;
      const move = (pointer) => {
        const next = Math.max(240, Math.min(window.innerWidth * 0.7, startW + (startX - pointer.clientX)));
        panel.style.width = `${Math.round(next)}px`;
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        localStorage.setItem("finmaster.dictionary.testWidth", String(Math.round(panel.getBoundingClientRect().width)));
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  }

  function bindDictionary() {
    document.addEventListener("click", () => {
      document.querySelectorAll(".dictionary-menu-list").forEach((node) => {
        node.hidden = true;
      });
    });
    $("dictionary-open")?.addEventListener("click", () => openDictionary());
    $("dictionary-close")?.addEventListener("click", () => closeDictionary());
    $("dictionary-filter")?.addEventListener("input", () => renderDictionary());
    $("dictionary-add-synonyms")?.addEventListener("click", () => addDictionaryEntry("synonyms"));
    $("dictionary-add-commands")?.addEventListener("click", () => addDictionaryEntry("commands"));
    $("dictionary-restore-all")?.addEventListener("click", async () => {
      const yes = await askConfirm({
        title: "Вернуть заводской словарь?",
        text: "Команды и ключевые слова станут как при установке. Свои карточки и все правки пропадут. Это нельзя отменить.",
        ok: "Вернуть",
        cancel: "Отмена",
        danger: true,
      });
      if (!yes) return;
      const data = await apiPost("/api/dictionary/reset", { all: true });
      dictionaryBook = data.book;
      dictionarySaved = JSON.stringify(dictionaryBook);
      dictionaryBroken = false;
      $("dictionary-broken").hidden = true;
      renderDictionary();
    });
    $("dictionary-save")?.addEventListener("click", () => saveDictionary());
    $("dictionary-cancel")?.addEventListener("click", async () => {
      if (dictionaryDirty()) {
        const yes = await askConfirm({
          title: "Отменить правки?",
          text: "Несохранённые изменения всего словаря пропадут.",
          ok: "Отменить правки",
          cancel: "Остаться",
          danger: true,
        });
        if (!yes) return;
      }
      loadDictionary().catch((err) => toast(err.message));
    });
    $("dictionary-export")?.addEventListener("click", async () => {
      if (dictionaryDirty()) await saveDictionary();
      const data = await apiPost("/api/dictionary/export", {});
      if (data.path) toast("Словарь экспортирован");
    });
    $("dictionary-import")?.addEventListener("click", async () => {
      const picked = await apiPost("/api/dictionary/pick", {});
      if (picked.path) await acceptDictionaryFile(picked.path);
    });
    $("dictionary-probe-query")?.addEventListener("input", () => scheduleProbe());
    $("dictionary-probe-bot")?.addEventListener("click", () => {
      dictionaryProbeSurface = "bot";
      paintProbeSwitch();
      scheduleProbe();
    });
    $("dictionary-probe-desk")?.addEventListener("click", () => {
      dictionaryProbeSurface = "desk";
      paintProbeSwitch();
      scheduleProbe();
    });
    paintProbeSwitch();
    bindDictionaryTest();
    $("ask-query")?.addEventListener("input", () => {
      askHintMoved = false;
      const rows = localHintRows($("ask-query").value);
      const exact = rows.some((item) => dictNorm(item.title) === dictNorm($("ask-query").value));
      if (rows.length && !exact) {
        paintAskHints(rows);
        fillAskModal({
          title: "Варианты",
          lead: "Похожие запросы",
          chips: [],
          sections: [{ title: "Варианты", rows: rows.map((item) => ({ kind: "item", text: item.title, meta: item.sub })) }],
        });
      }
    });
    $("ask-query")?.addEventListener("keydown", (event) => {
      if (!askHintItems.length || $("ask-hints")?.hidden) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        askHintMoved = true;
        askHintIndex = event.key === "ArrowDown"
          ? (askHintIndex + 1) % askHintItems.length
          : (askHintIndex - 1 + askHintItems.length) % askHintItems.length;
        paintAskHints(askHintItems);
      } else if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        runAskHint(askHintIndex);
      }
    });
    apiGet("/api/dictionary").then((data) => {
      dictionaryBook = data.book;
    }).catch(() => {});
  }

  bindDictionary();
})();
