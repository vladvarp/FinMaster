/* bundle-seam */
(function () {
  const FONT_FILES = {
    segoe: { regular: "segoeui.ttf", bold: "segoeuib.ttf" },
    arial: { regular: "arial.ttf", bold: "arialbd.ttf" },
    calibri: { regular: "calibri.ttf", bold: "calibrib.ttf" },
    georgia: { regular: "georgia.ttf", bold: "georgiab.ttf" },
    times: { regular: "times.ttf", bold: "timesbd.ttf" },
  };
  const fontBytes = new Map();
  let measureCanvas = null;
  let measure2d = null;

  function u32(n) {
    return n >>> 0;
  }

  function hex4(n) {
    return (n & 0xffff).toString(16).padStart(4, "0").toUpperCase();
  }

  function colorOf(hex) {
    let h = String(hex || "").trim();
    if (h.startsWith("#")) h = h.slice(1);
    if (h.length === 3) h = h.split("").map((ch) => ch + ch).join("");
    const value = Number.parseInt(h, 16);
    if (!Number.isFinite(value) || h.length !== 6) return [0, 0, 0];
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
  }

  function colorStr(hex) {
    return colorOf(hex)
      .map((c) => (Math.round(c * 10000) / 10000).toString())
      .join(" ");
  }

  function parsePaintFont(spec) {
    const match = String(spec || "").match(/(?:^|\s)(\d{3})\s+([\d.]+)px/);
    return { bold: match ? Number(match[1]) >= 600 : false, size: match ? Number(match[2]) : 10 };
  }

  function measureCtx() {
    if (!measure2d) {
      measureCanvas = document.createElement("canvas");
      measure2d = measureCanvas.getContext("2d");
    }
    return measure2d;
  }

  function baselineShift(fontCss) {
    const ctx = measureCtx();
    ctx.font = fontCss;
    ctx.textBaseline = "alphabetic";
    const alph = ctx.measureText("Аy").fontBoundingBoxAscent || 0;
    ctx.textBaseline = "middle";
    const mid = ctx.measureText("Аy").fontBoundingBoxAscent || 0;
    const shift = alph - mid;
    if (shift) return shift;
    const size = parsePaintFont(fontCss).size || 10;
    return size * 0.25;
  }

  function charAdvances(fontCss, text) {
    const ctx = measureCtx();
    ctx.font = fontCss;
    ctx.textBaseline = "middle";
    const chars = Array.from(text);
    const out = [];
    let prev = 0;
    let acc = "";
    chars.forEach((ch) => {
      acc += ch;
      const width = ctx.measureText(acc).width;
      out.push(width - prev);
      prev = width;
    });
    return out;
  }

  function sumBytes(bytes) {
    let sum = 0;
    for (let i = 0; i < bytes.length; i += 4) {
      const v = (((bytes[i] || 0) << 24) | ((bytes[i + 1] || 0) << 16) | ((bytes[i + 2] || 0) << 8) | (bytes[i + 3] || 0)) >>> 0;
      sum = u32(sum + v);
    }
    return sum;
  }

  function readLoca(view, locaOff, count, longFmt) {
    const loca = [];
    for (let i = 0; i <= count; i += 1) {
      loca.push(longFmt ? view.getUint32(locaOff + i * 4) : view.getUint16(locaOff + i * 2) * 2);
    }
    return loca;
  }

  function cmapLookup(view, tableOff) {
    const groups = view.getUint16(tableOff + 2);
    let best = null;
    for (let i = 0; i < groups; i += 1) {
      const rec = tableOff + 4 + i * 8;
      const plat = view.getUint16(rec);
      const enc = view.getUint16(rec + 2);
      const sub = tableOff + view.getUint32(rec + 4);
      const format = view.getUint16(sub);
      let score = 0;
      if (format === 12 && ((plat === 3 && enc === 10) || plat === 0)) score = 4;
      else if (format === 4 && ((plat === 3 && enc === 1) || plat === 0)) score = 2;
      if (!best || score > best.score) best = { score, format, sub };
    }
    if (!best || !best.score) throw new Error("В шрифте нет юникода");
    if (best.format === 12) {
      const n = view.getUint32(best.sub + 12);
      return (code) => {
        let lo = 0;
        let hi = n - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const rec = best.sub + 16 + mid * 12;
          const start = view.getUint32(rec);
          const end = view.getUint32(rec + 4);
          if (code < start) hi = mid - 1;
          else if (code > end) lo = mid + 1;
          else return view.getUint32(rec + 8) + (code - start);
        }
        return 0;
      };
    }
    const segCount = view.getUint16(best.sub + 6) / 2;
    const endOff = best.sub + 14;
    const startOff = endOff + segCount * 2 + 2;
    const deltaOff = startOff + segCount * 2;
    const rangeOff = deltaOff + segCount * 2;
    return (code) => {
      for (let i = 0; i < segCount; i += 1) {
        const end = view.getUint16(endOff + i * 2);
        if (code > end) continue;
        const start = view.getUint16(startOff + i * 2);
        if (code < start) return 0;
        const delta = view.getInt16(deltaOff + i * 2);
        const range = view.getUint16(rangeOff + i * 2);
        if (!range) return (code + delta) & 0xffff;
        const gid = view.getUint16(rangeOff + i * 2 + range + (code - start) * 2);
        return gid ? (gid + delta) & 0xffff : 0;
      }
      return 0;
    };
  }

  function parseTtf(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const numTables = view.getUint16(4);
    const tables = {};
    for (let i = 0; i < numTables; i += 1) {
      const rec = 12 + i * 16;
      const tag = String.fromCharCode(bytes[rec], bytes[rec + 1], bytes[rec + 2], bytes[rec + 3]);
      tables[tag] = { off: view.getUint32(rec + 8), len: view.getUint32(rec + 12) };
    }
    const head = tables.head;
    const maxp = tables.maxp;
    const hhea = tables.hhea;
    const hmtx = tables.hmtx;
    const glyf = tables.glyf;
    const loca = tables.loca;
    if (!head || !maxp || !hhea || !hmtx || !glyf || !loca || !tables.cmap) throw new Error("Шрифт повреждён");
    const glyphCount = view.getUint16(maxp.off + 4);
    const longLoca = view.getInt16(head.off + 50) !== 0;
    const locaList = readLoca(view, loca.off, glyphCount, longLoca);
    const hMetrics = view.getUint16(hhea.off + 34);
    const upem = view.getUint16(head.off + 18) || 2048;
    return {
      bytes,
      view,
      tables,
      glyphCount,
      loca: locaList,
      hMetrics,
      upem,
      ascender: view.getInt16(hhea.off + 4),
      descender: view.getInt16(hhea.off + 6),
      bbox: [view.getInt16(head.off + 36), view.getInt16(head.off + 38), view.getInt16(head.off + 40), view.getInt16(head.off + 42)],
      lookup: cmapLookup(view, tables.cmap.off),
    };
  }

  function glyphSlice(font, gid) {
    const start = font.loca[gid] || 0;
    const end = font.loca[gid + 1] || start;
    if (end <= start) return new Uint8Array(0);
    return font.bytes.subarray(font.tables.glyf.off + start, font.tables.glyf.off + end);
  }

  function componentIds(slice) {
    if (slice.length < 10) return [];
    const view = new DataView(slice.buffer, slice.byteOffset, slice.byteLength);
    if (view.getInt16(0) >= 0) return [];
    const ids = [];
    let p = 10;
    let flags = 0;
    while (p + 4 <= slice.length) {
      flags = view.getUint16(p);
      ids.push(view.getUint16(p + 2));
      p += 4;
      p += flags & 1 ? 4 : 2;
      if (flags & 8) p += 2;
      else if (flags & 64) p += 4;
      else if (flags & 128) p += 8;
      if (!(flags & 32)) break;
    }
    return ids;
  }

  function rewriteComposite(slice, map) {
    const data = new Uint8Array(slice);
    if (data.length < 10) return data;
    const view = new DataView(data.buffer);
    if (view.getInt16(0) >= 0) return data;
    let p = 10;
    let flags = 0;
    while (p + 4 <= data.length) {
      flags = view.getUint16(p);
      const next = map.get(view.getUint16(p + 2));
      if (next != null) view.setUint16(p + 2, next);
      p += 4;
      p += flags & 1 ? 4 : 2;
      if (flags & 8) p += 2;
      else if (flags & 64) p += 4;
      else if (flags & 128) p += 8;
      if (!(flags & 32)) break;
    }
    return data;
  }

  function advanceOf(font, gid) {
    const index = gid < font.hMetrics ? gid : font.hMetrics - 1;
    return font.view.getUint16(font.tables.hmtx.off + index * 4);
  }

  function pad4(bytes) {
    const extra = (4 - (bytes.length % 4)) % 4;
    if (!extra) return bytes;
    const out = new Uint8Array(bytes.length + extra);
    out.set(bytes);
    return out;
  }

  function put16(view, off, value) {
    view.setUint16(off, value & 0xffff);
  }

  function buildCmap4(pairs) {
    const segs = pairs.map(([code, gid]) => ({ start: code, end: code, gid }));
    segs.push({ start: 0xffff, end: 0xffff, gid: 0 });
    const segCount = segs.length;
    const segX2 = segCount * 2;
    let searchRange = 2;
    let entrySelector = 0;
    while (searchRange * 2 <= segX2) {
      searchRange *= 2;
      entrySelector += 1;
    }
    const rangeShift = segX2 - searchRange;
    const length = 16 + segCount * 8;
    const bytes = new Uint8Array(length);
    const view = new DataView(bytes.buffer);
    put16(view, 0, 4);
    put16(view, 2, length);
    put16(view, 6, segX2);
    put16(view, 8, searchRange);
    put16(view, 10, entrySelector);
    put16(view, 12, rangeShift);
    segs.forEach((seg, i) => put16(view, 14 + i * 2, seg.end));
    const startOff = 14 + segCount * 2 + 2;
    segs.forEach((seg, i) => put16(view, startOff + i * 2, seg.start));
    const deltaOff = startOff + segCount * 2;
    segs.forEach((seg, i) => {
      const delta = seg.end === 0xffff ? 1 : (seg.gid - seg.start) & 0xffff;
      view.setInt16(deltaOff + i * 2, delta > 0x7fff ? delta - 0x10000 : delta);
    });
    return bytes;
  }

  function wrapCmap(format4) {
    const bytes = new Uint8Array(12 + format4.length);
    const view = new DataView(bytes.buffer);
    put16(view, 0, 0);
    put16(view, 2, 1);
    put16(view, 4, 3);
    put16(view, 6, 1);
    view.setUint32(8, 12);
    bytes.set(format4, 12);
    return bytes;
  }

  function buildTtf(tables) {
    const tags = Object.keys(tables).sort();
    const n = tags.length;
    let searchRange = 16;
    let entrySelector = 0;
    while (searchRange * 2 <= n * 16) {
      searchRange *= 2;
      entrySelector += 1;
    }
    const rangeShift = n * 16 - searchRange;
    const headerLen = 12 + n * 16;
    const chunks = [];
    let cursor = headerLen;
    const records = tags.map((tag) => {
      const raw = tables[tag];
      const padded = pad4(raw);
      const rec = { tag, off: cursor, len: raw.length, sum: sumBytes(padded), data: padded };
      cursor += padded.length;
      return rec;
    });
    const headRec = records.find((rec) => rec.tag === "head");
    const header = new Uint8Array(headerLen);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, 0x00010000);
    put16(hv, 4, n);
    put16(hv, 6, searchRange);
    put16(hv, 8, entrySelector);
    put16(hv, 10, rangeShift);
    records.forEach((rec, i) => {
      const at = 12 + i * 16;
      header[at] = rec.tag.charCodeAt(0);
      header[at + 1] = rec.tag.charCodeAt(1);
      header[at + 2] = rec.tag.charCodeAt(2);
      header[at + 3] = rec.tag.charCodeAt(3);
      hv.setUint32(at + 4, rec.sum);
      hv.setUint32(at + 8, rec.off);
      hv.setUint32(at + 12, rec.len);
    });
    chunks.push(header, ...records.map((rec) => rec.data));
    let total = 0;
    chunks.forEach((c) => {
      total += c.length;
    });
    const file = new Uint8Array(total);
    let pos = 0;
    chunks.forEach((c) => {
      file.set(c, pos);
      pos += c.length;
    });
    const adj = u32(0xb1b0afba - sumBytes(file));
    const headDataOff = headRec.off + 8;
    new DataView(file.buffer).setUint32(headDataOff, adj);
    return file;
  }

  function subsetFont(font, codes) {
    const needed = new Set([0]);
    const add = (gid) => {
      if (gid == null || needed.has(gid) || gid < 0 || gid >= font.glyphCount) return;
      needed.add(gid);
      componentIds(glyphSlice(font, gid)).forEach(add);
    };
    codes.forEach((code) => add(font.lookup(code) || 0));
    const order = [0, ...[...needed].filter((gid) => gid !== 0).sort((a, b) => a - b)];
    const map = new Map(order.map((gid, index) => [gid, index]));
    const glyphs = [];
    const loca = [0];
    let cursor = 0;
    order.forEach((gid) => {
      const slice = rewriteComposite(glyphSlice(font, gid), map);
      const padded = pad4(slice);
      glyphs.push(padded);
      cursor += padded.length;
      loca.push(cursor);
    });
    const glyf = new Uint8Array(cursor);
    let at = 0;
    glyphs.forEach((g) => {
      glyf.set(g, at);
      at += g.length;
    });
    const locaBytes = new Uint8Array((order.length + 1) * 4);
    const locaView = new DataView(locaBytes.buffer);
    loca.forEach((off, i) => locaView.setUint32(i * 4, off));
    const hmtx = new Uint8Array(order.length * 4);
    const hmtxView = new DataView(hmtx.buffer);
    const advances = [];
    order.forEach((gid, index) => {
      const adv = advanceOf(font, gid);
      const lsbIndex = gid < font.hMetrics ? gid : font.hMetrics - 1;
      const lsb = font.view.getInt16(font.tables.hmtx.off + lsbIndex * 4 + 2);
      hmtxView.setUint16(index * 4, adv);
      hmtxView.setInt16(index * 4 + 2, lsb);
      advances.push(adv);
    });
    const head = new Uint8Array(font.bytes.subarray(font.tables.head.off, font.tables.head.off + font.tables.head.len));
    new DataView(head.buffer).setInt16(50, 1);
    new DataView(head.buffer).setUint32(8, 0);
    const maxp = new Uint8Array(font.bytes.subarray(font.tables.maxp.off, font.tables.maxp.off + font.tables.maxp.len));
    new DataView(maxp.buffer).setUint16(4, order.length);
    const hhea = new Uint8Array(font.bytes.subarray(font.tables.hhea.off, font.tables.hhea.off + font.tables.hhea.len));
    new DataView(hhea.buffer).setUint16(34, order.length);
    const pairs = [];
    const codeToGid = new Map();
    codes.forEach((code) => {
      if (code > 0xffff) return;
      const gid = map.get(font.lookup(code) || 0) || 0;
      codeToGid.set(code, gid);
      if (gid) pairs.push([code, gid]);
    });
    pairs.sort((a, b) => a[0] - b[0]);
    const post = new Uint8Array(32);
    new DataView(post.buffer).setUint32(0, 0x00030000);
    const tables = {
      cmap: wrapCmap(buildCmap4(pairs)),
      glyf,
      head,
      hhea,
      hmtx,
      loca: locaBytes,
      maxp,
      post,
    };
    if (font.tables["OS/2"]) {
      tables["OS/2"] = new Uint8Array(font.bytes.subarray(font.tables["OS/2"].off, font.tables["OS/2"].off + font.tables["OS/2"].len));
    }
    if (font.tables.name) {
      tables.name = new Uint8Array(font.bytes.subarray(font.tables.name.off, font.tables.name.off + font.tables.name.len));
    }
    return {
      bytes: buildTtf(tables),
      codeToGid,
      advances,
      upem: font.upem,
      ascender: font.ascender,
      descender: font.descender,
      bbox: font.bbox,
    };
  }

  async function loadFace(file) {
    if (fontBytes.has(file)) return fontBytes.get(file);
    const res = await fetch(`/api/pdf-font/${file}`);
    if (!res.ok) throw new Error("Не удалось прочитать шрифт для PDF");
    const font = parseTtf(new Uint8Array(await res.arrayBuffer()));
    fontBytes.set(file, font);
    return font;
  }

  function roundRect(x, yTop, w, h, r, pageH) {
    const y = pageH - yTop - h;
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    const k = rr * 0.5522847498;
    return [
      `${num(x + rr)} ${num(y)} m`,
      `${num(x + w - rr)} ${num(y)} l`,
      `${num(x + w - rr + k)} ${num(y)} ${num(x + w)} ${num(y + rr - k)} ${num(x + w)} ${num(y + rr)} c`,
      `${num(x + w)} ${num(y + h - rr)} l`,
      `${num(x + w)} ${num(y + h - rr + k)} ${num(x + w - rr + k)} ${num(y + h)} ${num(x + w - rr)} ${num(y + h)} c`,
      `${num(x + rr)} ${num(y + h)} l`,
      `${num(x + rr - k)} ${num(y + h)} ${num(x)} ${num(y + h - rr + k)} ${num(x)} ${num(y + h - rr)} c`,
      `${num(x)} ${num(y + rr)} l`,
      `${num(x)} ${num(y + rr - k)} ${num(x + rr - k)} ${num(y)} ${num(x + rr)} ${num(y)} c`,
      "h",
    ].join("\n");
  }

  function textOps(item, pageH, faces) {
    const text = String(item.text ?? "");
    if (!text) return "";
    const paint = parsePaintFont(item.font);
    const face = paint.bold && faces.bold ? faces.bold : faces.regular;
    const fontName = paint.bold && faces.bold ? "/Fb" : "/Fr";
    const chars = Array.from(text);
    const advances = charAdvances(item.font, text);
    const width = advances.reduce((sum, w) => sum + w, 0);
    let x = item.x;
    if (item.align === "right") x -= width;
    else if (item.align === "center") x -= width / 2;
    const pdfY = pageH - (item.y + baselineShift(item.font));
    const parts = [];
    chars.forEach((ch, i) => {
      const code = ch.codePointAt(0);
      const gid = face.codeToGid.get(code) || 0;
      const fw = ((face.advances[gid] || 0) * paint.size) / face.upem;
      parts.push(`<${hex4(gid)}>`);
      if (i < chars.length - 1) {
        const adj = Math.round(((fw - advances[i]) / paint.size) * 1000);
        if (adj) parts.push(String(adj));
      }
    });
    const alpha = item.alpha != null && item.alpha < 0.999;
    return `${alpha ? "q\n/GSa gs\n" : ""}BT\n${colorStr(item.color)} rg\n${fontName} ${num(paint.size)} Tf\n1 0 0 1 ${num(x)} ${num(pdfY)} Tm\n[${parts.join(" ")}] TJ\nET${alpha ? "\nQ" : ""}`;
  }

  function pageContent(layout, page, faces) {
    const pageH = page.h || layout.H;
    const lines = [`${colorStr(layout.bg || "#ffffff")} rg`, `0 0 ${num(layout.W)} ${num(pageH)} re`, "f"];
    const shadings = [];
    (page.ops || []).forEach((item) => {
      if (item.t === "rect" && item.fill) {
        const y = pageH - item.y - item.h;
        lines.push(`${colorStr(item.fill)} rg`, `${num(item.x)} ${num(y)} ${num(item.w)} ${num(item.h)} re`, "f");
      } else if (item.t === "line") {
        lines.push(
          "q",
          `${num(item.width || 0.6)} w`,
          `${colorStr(item.color)} RG`,
          `${num(item.x1)} ${num(pageH - item.y1)} m`,
          `${num(item.x2)} ${num(pageH - item.y2)} l`,
          "S",
          "Q"
        );
      } else if (item.t === "band") {
        const same = colorOf(item.c0).join() === colorOf(item.c1).join();
        const path = roundRect(item.x, item.y, item.w, item.h, 6, pageH);
        if (same) lines.push(`${colorStr(item.c0)} rg`, path, "f");
        else {
          const name = `S${shadings.length}`;
          const y = pageH - (item.y + item.h / 2);
          shadings.push({ name, c0: item.c0, c1: item.c1, x0: item.x, x1: item.x + item.w, y });
          lines.push("q", path, "W n", `/${name} sh`, "Q");
        }
        if (item.accent) {
          const y = pageH - (item.y + item.h);
          lines.push("q", "1.2 w", `${colorStr(item.accent)} RG`, `${num(item.x)} ${num(y)} m`, `${num(item.x + item.w)} ${num(y)} l`, "S", "Q");
        }
      } else if (item.t === "card") {
        const path = roundRect(item.x, item.y, item.w, item.h, 6, pageH);
        lines.push(`${colorStr(item.fill)} rg`, path, "f", "q", "0.6 w", `${colorStr(item.stroke)} RG`, path, "S", "Q");
        const y = pageH - (item.y + 7) - (item.h - 14);
        lines.push(`${colorStr(item.accent)} rg`, `${num(item.x)} ${num(y)} 2.4 ${num(item.h - 14)} re`, "f");
      } else if (item.t === "text") lines.push(textOps(item, pageH, faces));
    });
    return { stream: lines.filter(Boolean).join("\n"), shadings };
  }

  function toUnicode(pairs) {
    const lines = [
      "/CIDInit /ProcSet findresource begin",
      "12 dict begin",
      "begincmap",
      "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
      "/CMapName /Adobe-Identity-UCS def",
      "/CMapType 2 def",
      "1 begincodespacerange",
      "<0000> <FFFF>",
      "endcodespacerange",
    ];
    for (let i = 0; i < pairs.length; i += 100) {
      const chunk = pairs.slice(i, i + 100);
      lines.push(`${chunk.length} beginbfchar`);
      chunk.forEach(([code, gid]) => lines.push(`<${hex4(gid)}> <${hex4(code)}>`));
      lines.push("endbfchar");
    }
    lines.push("endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end");
    return lines.join("\n");
  }

  function fontObjects(face, name, pushObj) {
    const fileId = pushObj((id) => [
      `<< /Length ${face.bytes.length} >>\nstream\n`,
      face.bytes,
      "\nendstream",
    ]);
    const pairs = [...face.codeToGid.entries()].filter(([, gid]) => gid);
    const uniId = pushObj(() => {
      const body = latin1(toUnicode(pairs));
      return [`<< /Length ${body.length} >>\nstream\n`, body, "\nendstream"];
    });
    const descId = pushObj(
      () =>
        latin1(
          `<< /Type /FontDescriptor /FontName /${name} /Flags 32 /FontBBox [${face.bbox.join(" ")}] /ItalicAngle 0 /Ascent ${face.ascender} /Descent ${face.descender} /CapHeight ${face.ascender} /StemV 80 /FontFile2 ${fileId} 0 R >>`
        )
    );
    const widths = [];
    for (let gid = 1; gid < face.advances.length; gid += 1) {
      widths.push(`${gid} [${Math.round((face.advances[gid] * 1000) / face.upem)}]`);
    }
    const cidId = pushObj(
      () =>
        latin1(
          `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descId} 0 R /DW ${Math.round((face.advances[0] * 1000) / face.upem) || 500} /W [${widths.join(" ")}] /CIDToGIDMap /Identity >>`
        )
    );
    const fontId = pushObj(
      () => latin1(`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${cidId} 0 R] /ToUnicode ${uniId} 0 R >>`)
    );
    return fontId;
  }

  async function build(layout, meta = {}) {
    const pages = layout?.pages;
    if (!pages?.length) throw new Error("Нет страниц для PDF");
    const files = FONT_FILES[layout.fontKey] || FONT_FILES.segoe;
    const used = { regular: new Set(), bold: new Set() };
    pages.forEach((page) => {
      (page.ops || []).forEach((item) => {
        if (item.t !== "text" || !item.text) return;
        const bag = parsePaintFont(item.font).bold ? used.bold : used.regular;
        Array.from(String(item.text)).forEach((ch) => {
          const code = ch.codePointAt(0);
          if (code <= 0xffff) bag.add(code);
        });
      });
    });
    const regularFont = await loadFace(files.regular);
    const boldFont = used.bold.size ? await loadFace(files.bold) : null;
    const faces = {
      regular: subsetFont(regularFont, used.regular),
      bold: boldFont ? subsetFont(boldFont, used.bold) : null,
    };
    const bodies = [null];
    const pushObj = (factory) => {
      const id = bodies.length;
      bodies.push(null);
      bodies[id] = factory(id);
      return id;
    };
    const pagesId = pushObj(() => latin1("<< /Type /Pages >>"));
    const regularId = fontObjects(faces.regular, "FinRegular", pushObj);
    const boldId = faces.bold ? fontObjects(faces.bold, "FinBold", pushObj) : 0;
    let gsId = 0;
    const pageIds = [];
    pages.forEach((page) => {
      const drawn = pageContent(layout, page, faces);
      if (!gsId && drawn.stream.includes("/GSa")) {
        gsId = pushObj(() => latin1("<< /Type /ExtGState /ca 0.85 /CA 0.85 >>"));
      }
      const shadeIds = drawn.shadings.map((shade) =>
        pushObj(() =>
          latin1(
            `<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [${num(shade.x0)} ${num(shade.y)} ${num(shade.x1)} ${num(shade.y)}] /Function << /FunctionType 2 /Domain [0 1] /C0 [${colorStr(shade.c0)}] /C1 [${colorStr(shade.c1)}] /N 1 >> /Extend [true true] >>`
          )
        )
      );
      const contentId = pushObj(() => {
        const data = latin1(drawn.stream);
        return [`<< /Length ${data.length} >>\nstream\n`, data, "\nendstream"];
      });
      const pageH = page.h || layout.H;
      const fonts = [`/Fr ${regularId} 0 R`];
      if (boldId) fonts.push(`/Fb ${boldId} 0 R`);
      const shading = shadeIds.length ? ` /Shading << ${drawn.shadings.map((shade, i) => `/${shade.name} ${shadeIds[i]} 0 R`).join(" ")} >>` : "";
      const gs = gsId ? ` /ExtGState << /GSa ${gsId} 0 R >>` : "";
      const group = gsId ? " /Group << /Type /Group /S /Transparency /CS /DeviceRGB >>" : "";
      const pageId = pushObj(
        () =>
          latin1(
            `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(layout.W)} ${num(pageH)}] /Resources << /Font << ${fonts.join(" ")} >>${gs}${shading} /ProcSet [/PDF /Text] >> /Contents ${contentId} 0 R${group} >>`
          )
      );
      pageIds.push(pageId);
    });
    bodies[pagesId] = latin1(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
    const catalogId = pushObj(() => latin1(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`));
    const infoId = pushObj(() => latin1(`<< /Producer <${utf16Hex("FinMaster")}> /Title <${utf16Hex(meta.title || layout.title || "FinMaster")}> /CreationDate (${pdfDate(new Date())}) >>`));

    const chunks = [];
    const offsets = [];
    let offset = 0;
    const push = (data) => {
      const bytes = typeof data === "string" ? latin1(data) : data;
      chunks.push(bytes);
      offset += bytes.length;
    };
    push("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n");
    for (let id = 1; id < bodies.length; id += 1) {
      offsets[id] = offset;
      push(`${id} 0 obj\n`);
      const body = bodies[id];
      (Array.isArray(body) ? body : [body]).forEach(push);
      push("\nendobj\n");
    }
    const xref = offset;
    push(`xref\n0 ${bodies.length}\n0000000000 65535 f \n`);
    for (let id = 1; id < bodies.length; id += 1) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
    push(`trailer\n<< /Size ${bodies.length} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(offset);
    let pos = 0;
    chunks.forEach((chunk) => {
      out.set(chunk, pos);
      pos += chunk.length;
    });
    return out;
  }

  window.FinPdf = { build };
})();
