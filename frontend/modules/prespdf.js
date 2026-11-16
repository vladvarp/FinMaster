/* PDF презентации: векторные страницы в пропорциях холста, без картинок. */
(function () {
  "use strict";

  const THEMES = [
    { id: "current", name: "Текущий вид", family: "Segoe UI", file: "segoe", page: "#f7fafc", card: "#ffffff", ink: "#0f172a", muted: "#64748b", accent: "#14b8a6", line: "#dbe3ec", grid: "#dbe3ec", up: "#059669", down: "#dc2626", track: "#e2e8f0", radius: null },
    { id: "white", name: "Белый", family: "Segoe UI", file: "segoe", page: "#ffffff", card: "#f8fafc", ink: "#111827", muted: "#4b5563", accent: "#0f766e", line: "#d1d5db", grid: "#e5e7eb", up: "#047857", down: "#b91c1c", track: "#e5e7eb", radius: null },
    { id: "black", name: "Чёрный", family: "Segoe UI", file: "segoe", page: "#0b0f14", card: "#161d27", ink: "#f8fafc", muted: "#94a3b8", accent: "#5eead4", line: "#334155", grid: "#1e293b", up: "#6ee7b7", down: "#fca5a5", track: "#1e293b", radius: null },
    { id: "mono", name: "Чёрно-белый", family: "Segoe UI", file: "segoe", page: "#ffffff", card: "#ffffff", ink: "#000000", muted: "#222222", accent: "#000000", line: "#000000", grid: "#d4d4d4", up: "#000000", down: "#000000", track: "#e5e5e5", radius: null },
    { id: "news", name: "Газета", family: "Times New Roman", file: "times", page: "#f3efe4", card: "#f7f4ec", ink: "#1c1c1c", muted: "#3a3a3a", accent: "#1c1c1c", line: "#1c1c1c", grid: "#e3dccb", up: "#1c1c1c", down: "#1c1c1c", track: "#e7e0d2", radius: 0 },
    { id: "blueprint", name: "Блюпринт", family: "Segoe UI", file: "segoe", page: "#0c3d6e", card: "#0c3d6e", ink: "#e7f3ff", muted: "#b7d4f2", accent: "#ffffff", line: "#8ec0ea", grid: "#1d5c96", up: "#ffffff", down: "#d6ebff", track: "#1d5c96", radius: 0, hollow: true, gridForce: true },
    { id: "aged", name: "Старая газета", family: "Times New Roman", file: "times", page: "#e4cf9a", card: "#edd7a4", ink: "#3a2914", muted: "#6a4b28", accent: "#5c3b1e", line: "#8a6840", grid: "#d8c08a", up: "#3a2914", down: "#3a2914", track: "#dcc48a", radius: 2, frame: true },
  ];
  const FILES = {
    segoe: { regular: "segoeui.ttf", bold: "segoeuib.ttf" },
    times: { regular: "times.ttf", bold: "timesbd.ttf" },
  };
  const fontCache = new Map();
  let themeId = "current";
  let modal = null;
  let measure2d = null;

  try {
    const stored = localStorage.getItem("finmaster.pres.pdfTheme");
    if (THEMES.some((item) => item.id === stored)) themeId = stored;
  } catch {
    /* ignore */
  }

  function themeById(id) {
    return THEMES.find((item) => item.id === id) || THEMES[0];
  }

  function n(value) {
    return (Math.round(Number(value) * 100) / 100).toString();
  }

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function latin1(text) {
    const s = String(text);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }

  function utf16Hex(text) {
    let hex = "FEFF";
    const s = String(text || "");
    for (let i = 0; i < s.length; i += 1) hex += s.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
    return hex;
  }

  function pdfDate(d) {
    const p = (v) => String(v).padStart(2, "0");
    return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  function rgb(hex) {
    let h = String(hex || "").trim();
    if (h.startsWith("#")) h = h.slice(1);
    if (h.length === 3) h = h.split("").map((ch) => ch + ch).join("");
    const value = Number.parseInt(h, 16);
    if (!Number.isFinite(value) || h.length !== 6) return "0 0 0";
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
      .map((c) => (Math.round(c * 10000) / 10000).toString())
      .join(" ");
  }

  function measure() {
    if (!measure2d) measure2d = document.createElement("canvas").getContext("2d");
    return measure2d;
  }

  function fontCss(theme, size, bold) {
    return `${bold ? 700 : 400} ${size}px "${theme.family}", sans-serif`;
  }

  function textWidth(theme, size, bold, text) {
    const ctx = measure();
    ctx.font = fontCss(theme, size, bold);
    return ctx.measureText(String(text || "")).width;
  }

  function wrapText(theme, size, bold, text, maxW) {
    const raw = String(text || "").replace(/\s+/g, " ").trim();
    if (!raw) return [];
    const words = raw.split(" ");
    const lines = [];
    let line = "";
    words.forEach((word) => {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(theme, size, bold, next) > maxW && line) {
        lines.push(line);
        line = word;
      } else line = next;
    });
    if (line) lines.push(line);
    return lines;
  }

  function radiusOf(theme, block) {
    if (theme.radius != null) return theme.radius;
    return Math.max(0, block.radius || 0);
  }

  function paintPage(page, theme) {
    const paper = theme.id === "current" && page.paper ? page.paper : theme.page;
    const grid = theme.id === "current" && page.gridColor ? page.gridColor : theme.grid;
    const ops = [{ t: "round", x: 0, y: 0, w: page.w, h: page.h, r: 0, fill: paper }];
    const step = theme.gridForce ? 40 : 10;
    if (page.grid || theme.gridForce) {
      for (let x = step; x < page.w; x += step) ops.push({ t: "line", x1: x, y1: 0, x2: x, y2: page.h, color: grid, sw: theme.gridForce ? 0.6 : 0.4 });
      for (let y = step; y < page.h; y += step) ops.push({ t: "line", x1: 0, y1: y, x2: page.w, y2: y, color: grid, sw: theme.gridForce ? 0.6 : 0.4 });
    }
    (page.blocks || []).forEach((block) => paintBlock(ops, block, theme));
    if (theme.frame) {
      ops.push({ t: "round", x: 14, y: 14, w: page.w - 28, h: page.h - 28, r: 0, stroke: theme.line, sw: 1.2 });
      ops.push({ t: "round", x: 20, y: 20, w: page.w - 40, h: page.h - 40, r: 0, stroke: theme.line, sw: 0.4 });
    }
    return ops;
  }

  function paintBlock(ops, block, theme) {
    const tone = theme.id === "current" && block.look ? { ...theme, ...block.look } : theme;
    const hollow = theme.id === "current" ? !!block.look?.hollow : theme.hollow || block.hollow;
    const r = radiusOf(theme, block);
    ops.push({
      t: "round",
      x: block.x,
      y: block.y,
      w: block.w,
      h: block.h,
      r,
      fill: hollow ? "" : tone.card,
      stroke: tone.line,
      sw: hollow ? Math.max(1.2, tone.sw || 1.4) : tone.sw || 0.8,
      opacity: block.opacity,
    });
    const em = 13 * (block.fs || 1);
    const padX = em * (block.pad || 1);
    const padY = em * 0.85 * (block.pad || 1);
    const innerW = Math.max(8, block.w - padX * 2);
    const anchor = (width) => {
      if (block.align === "center") return block.x + (block.w - width) / 2;
      if (block.align === "end") return block.x + block.w - padX - width;
      return block.x + padX;
    };
    const put = (text, y, size, color, bold) => {
      const width = textWidth(theme, size, bold, text);
      ops.push({ t: "text", x: anchor(width), y, size, text, color, bold, opacity: block.opacity });
    };
    const labelSize = em * 0.85;
    const valueSize = em * (block.type === "title" ? 2 : 2.15);
    let y = block.y + padY + labelSize * 0.8;
    if (block.type === "kpi" || block.type === "metric" || block.type === "delta") {
      const bits = [];
      if (block.label) bits.push(labelSize);
      bits.push(valueSize);
      if (block.sub) bits.push(em * 0.92);
      if (block.delta) bits.push(em * 1.1);
      const stack = bits.reduce((sum, size) => sum + size * 1.25, 0);
      y = block.y + Math.max(padY, (block.h - stack) / 2) + labelSize * 0.8;
    }
    if (block.label && block.type !== "title") {
      put(block.label.toUpperCase(), y, labelSize, tone.muted, true);
      y += labelSize * 1.35;
    }
    if (block.type === "title" || block.type === "note") {
      const size = block.type === "title" ? valueSize : em;
      const color = block.type === "note" ? tone.muted : tone.ink;
      wrapText(theme, size, block.bold || block.type === "title", block.text, innerW).forEach((line) => {
        put(line, y, size, color, block.bold || block.type === "title");
        y += size * (block.type === "note" ? 1.4 : 1.15);
      });
      return;
    }
    if (block.pair) {
      const col = innerW / 2;
      block.pair.forEach((part, index) => {
        const x0 = block.x + padX + index * col;
        ops.push({ t: "text", x: x0, y, size: em * 0.85, text: part.k, color: tone.muted, bold: false, opacity: block.opacity });
        ops.push({ t: "text", x: x0, y: y + em * 1.7, size: em * 1.55, text: part.v, color: tone.ink, bold: true, opacity: block.opacity });
      });
      return;
    }
    if (block.type === "bars" && block.bars) {
      const top = y;
      const bottom = block.y + block.h - padY - em;
      const area = Math.max(12, bottom - top);
      const gap = 8;
      const colW = Math.max(6, (innerW - gap * (block.bars.length - 1)) / Math.max(1, block.bars.length));
      block.bars.forEach((bar, index) => {
        const bh = (area * bar.h) / 100;
        const x = block.x + padX + index * (colW + gap);
        ops.push({ t: "round", x, y: bottom - bh, w: colW, h: bh, r: 2, fill: tone.accent, opacity: block.opacity });
        ops.push({ t: "text", x, y: bottom + em * 0.85, size: em * 0.75, text: bar.k, color: tone.muted, bold: false, opacity: block.opacity });
      });
      return;
    }
    if (block.progress != null && block.type === "progress") {
      put(block.text, y, em * 1.35, tone.ink, true);
      const maxW = textWidth(theme, em * 0.9, false, block.sub);
      ops.push({ t: "text", x: block.x + block.w - padX - maxW, y, size: em * 0.9, text: block.sub, color: tone.muted, bold: false, opacity: block.opacity });
      const barY = block.y + block.h - padY - 8;
      ops.push({ t: "round", x: block.x + padX, y: barY, w: innerW, h: 8, r: 4, fill: tone.track, opacity: block.opacity });
      ops.push({ t: "round", x: block.x + padX, y: barY, w: innerW * (block.progress / 100), h: 8, r: 4, fill: tone.accent, opacity: block.opacity });
      return;
    }
    if (block.share != null && block.type === "share") {
      const cx = block.x + block.w / 2;
      const cy = block.y + block.h / 2 + (block.label ? em * 0.35 : 0);
      const radius = Math.max(10, Math.min(block.w, block.h) * 0.28);
      ops.push({ t: "ring", cx, cy, r: radius, pct: block.share, track: tone.track, ink: tone.accent, sw: Math.max(3, radius * 0.16), opacity: block.opacity });
      const size = em * 1.15;
      const width = textWidth(theme, size, true, block.text);
      ops.push({ t: "text", x: cx - width / 2, y: cy + size * 0.32, size, text: block.text, color: tone.ink, bold: true, opacity: block.opacity });
      return;
    }
    if (block.text) {
      put(block.text, y, valueSize, tone.ink, true);
      y += valueSize * 1.2;
    }
    if (block.sub) {
      put(block.sub, y, em * 0.92, tone.muted, false);
      y += em * 1.2;
    }
    if (block.delta) put(block.delta, y, em * 1.1, block.up ? tone.up : tone.down, true);
  }

  function svgOf(page, theme) {
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(page.w)} ${n(page.h)}" role="img">`];
    paintPage(page, theme).forEach((op) => {
      const opacity = op.opacity != null && op.opacity < 0.999 ? ` opacity="${n(op.opacity)}"` : "";
      if (op.t === "round") {
        const rr = Math.max(0, Math.min(op.r || 0, op.w / 2, op.h / 2));
        parts.push(`<rect x="${n(op.x)}" y="${n(op.y)}" width="${n(op.w)}" height="${n(op.h)}" rx="${n(rr)}"${op.fill ? ` fill="${op.fill}"` : ` fill="none"`}${op.stroke ? ` stroke="${op.stroke}" stroke-width="${n(op.sw || 1)}"` : ""}${opacity}/>`);
      } else if (op.t === "line") {
        parts.push(`<line x1="${n(op.x1)}" y1="${n(op.y1)}" x2="${n(op.x2)}" y2="${n(op.y2)}" stroke="${op.color}" stroke-width="${n(op.sw || 0.5)}"/>`);
      } else if (op.t === "text") {
        parts.push(`<text x="${n(op.x)}" y="${n(op.y)}" fill="${op.color}" font-family="${esc(theme.family)}, sans-serif" font-size="${n(op.size)}" font-weight="${op.bold ? 700 : 400}"${opacity}>${esc(op.text)}</text>`);
      } else if (op.t === "ring") {
        parts.push(`<circle cx="${n(op.cx)}" cy="${n(op.cy)}" r="${n(op.r)}" fill="none" stroke="${op.track}" stroke-width="${n(op.sw)}"${opacity}/>`);
        if (op.pct > 0.5) {
          const a0 = -Math.PI / 2;
          const a1 = a0 + (Math.min(op.pct, 99.99) / 100) * Math.PI * 2;
          const x0 = op.cx + op.r * Math.cos(a0);
          const y0 = op.cy + op.r * Math.sin(a0);
          const x1 = op.cx + op.r * Math.cos(a1);
          const y1 = op.cy + op.r * Math.sin(a1);
          const large = op.pct > 50 ? 1 : 0;
          parts.push(`<path d="M ${n(x0)} ${n(y0)} A ${n(op.r)} ${n(op.r)} 0 ${large} 1 ${n(x1)} ${n(y1)}" fill="none" stroke="${op.ink}" stroke-width="${n(op.sw)}" stroke-linecap="round"${opacity}/>`);
        }
      }
    });
    parts.push("</svg>");
    return parts.join("");
  }

  function u32(v) {
    return v >>> 0;
  }

  function hex4(v) {
    return (v & 0xffff).toString(16).padStart(4, "0").toUpperCase();
  }

  function sumBytes(bytes) {
    let sum = 0;
    for (let i = 0; i < bytes.length; i += 4) {
      const v = (((bytes[i] || 0) << 24) | ((bytes[i + 1] || 0) << 16) | ((bytes[i + 2] || 0) << 8) | (bytes[i + 3] || 0)) >>> 0;
      sum = u32(sum + v);
    }
    return sum;
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
      const count = view.getUint32(best.sub + 12);
      return (code) => {
        let lo = 0;
        let hi = count - 1;
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
    if (!head || !maxp || !hhea || !hmtx || !tables.glyf || !tables.loca || !tables.cmap) throw new Error("Шрифт повреждён");
    const glyphCount = view.getUint16(maxp.off + 4);
    const longLoca = view.getInt16(head.off + 50) !== 0;
    const loca = [];
    for (let i = 0; i <= glyphCount; i += 1) {
      loca.push(longLoca ? view.getUint32(tables.loca.off + i * 4) : view.getUint16(tables.loca.off + i * 2) * 2);
    }
    return {
      bytes,
      view,
      tables,
      glyphCount,
      loca,
      hMetrics: view.getUint16(hhea.off + 34),
      upem: view.getUint16(head.off + 18) || 2048,
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
    const length = 16 + segCount * 8;
    const bytes = new Uint8Array(length);
    const view = new DataView(bytes.buffer);
    put16(view, 0, 4);
    put16(view, 2, length);
    put16(view, 6, segX2);
    put16(view, 8, searchRange);
    put16(view, 10, entrySelector);
    put16(view, 12, segX2 - searchRange);
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
    const count = tags.length;
    let searchRange = 16;
    let entrySelector = 0;
    while (searchRange * 2 <= count * 16) {
      searchRange *= 2;
      entrySelector += 1;
    }
    const headerLen = 12 + count * 16;
    let cursor = headerLen;
    const records = tags.map((tag) => {
      const raw = tables[tag];
      const padded = pad4(raw);
      const rec = { tag, off: cursor, len: raw.length, sum: sumBytes(padded), data: padded };
      cursor += padded.length;
      return rec;
    });
    const header = new Uint8Array(headerLen);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, 0x00010000);
    put16(hv, 4, count);
    put16(hv, 6, searchRange);
    put16(hv, 8, entrySelector);
    put16(hv, 10, count * 16 - searchRange);
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
    const chunks = [header, ...records.map((rec) => rec.data)];
    let total = 0;
    chunks.forEach((chunk) => {
      total += chunk.length;
    });
    const file = new Uint8Array(total);
    let pos = 0;
    chunks.forEach((chunk) => {
      file.set(chunk, pos);
      pos += chunk.length;
    });
    const headRec = records.find((rec) => rec.tag === "head");
    new DataView(file.buffer).setUint32(headRec.off + 8, u32(0xb1b0afba - sumBytes(file)));
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
      const slice = pad4(rewriteComposite(glyphSlice(font, gid), map));
      glyphs.push(slice);
      cursor += slice.length;
      loca.push(cursor);
    });
    const glyf = new Uint8Array(cursor);
    let at = 0;
    glyphs.forEach((glyph) => {
      glyf.set(glyph, at);
      at += glyph.length;
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
      hmtxView.setUint16(index * 4, adv);
      hmtxView.setInt16(index * 4 + 2, font.view.getInt16(font.tables.hmtx.off + lsbIndex * 4 + 2));
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
    const tables = { cmap: wrapCmap(buildCmap4(pairs)), glyf, head, hhea, hmtx, loca: locaBytes, maxp, post };
    if (font.tables["OS/2"]) tables["OS/2"] = new Uint8Array(font.bytes.subarray(font.tables["OS/2"].off, font.tables["OS/2"].off + font.tables["OS/2"].len));
    if (font.tables.name) tables.name = new Uint8Array(font.bytes.subarray(font.tables.name.off, font.tables.name.off + font.tables.name.len));
    return { bytes: buildTtf(tables), codeToGid, advances, upem: font.upem, ascender: font.ascender, descender: font.descender, bbox: font.bbox };
  }

  async function loadFace(file) {
    if (fontCache.has(file)) return fontCache.get(file);
    const res = await fetch(`/api/pdf-font/${file}`);
    if (!res.ok) throw new Error("Не удалось прочитать шрифт");
    const font = parseTtf(new Uint8Array(await res.arrayBuffer()));
    fontCache.set(file, font);
    return font;
  }

  function roundPdf(op, pageH) {
    const x = op.x;
    const y = pageH - op.y - op.h;
    const w = op.w;
    const h = op.h;
    const rr = Math.max(0, Math.min(op.r || 0, w / 2, h / 2));
    const k = rr * 0.5522847498;
    if (!rr) return `${n(x)} ${n(y)} ${n(w)} ${n(h)} re`;
    return [
      `${n(x + rr)} ${n(y)} m`,
      `${n(x + w - rr)} ${n(y)} l`,
      `${n(x + w - rr + k)} ${n(y)} ${n(x + w)} ${n(y + rr - k)} ${n(x + w)} ${n(y + rr)} c`,
      `${n(x + w)} ${n(y + h - rr)} l`,
      `${n(x + w)} ${n(y + h - rr + k)} ${n(x + w - rr + k)} ${n(y + h)} ${n(x + w - rr)} ${n(y + h)} c`,
      `${n(x + rr)} ${n(y + h)} l`,
      `${n(x + rr - k)} ${n(y + h)} ${n(x)} ${n(y + h - rr + k)} ${n(x)} ${n(y + h - rr)} c`,
      `${n(x)} ${n(y + rr)} l`,
      `${n(x)} ${n(y + rr - k)} ${n(x + rr - k)} ${n(y)} ${n(x + rr)} ${n(y)} c`,
      "h",
    ].join("\n");
  }

  function arcPdf(cx, cy, radius, a0, a1, pageH) {
    const lines = [];
    let a = a0;
    let first = true;
    while (a1 - a > 1e-4) {
      const b = Math.min(a1, a + Math.PI / 2);
      const alpha = (4 / 3) * Math.tan((b - a) / 4);
      const p = (ang, dx, dy) => {
        const x = cx + radius * (Math.cos(ang) + dx);
        const y = pageH - (cy + radius * (Math.sin(ang) + dy));
        return `${n(x)} ${n(y)}`;
      };
      const start = p(a, 0, 0);
      if (first) lines.push(`${start} m`);
      lines.push(`${p(a, -alpha * Math.sin(a), alpha * Math.cos(a))} ${p(b, alpha * Math.sin(b), -alpha * Math.cos(b))} ${p(b, 0, 0)} c`);
      first = false;
      a = b;
    }
    return lines.join("\n");
  }

  function textPdf(op, pageH, faces, theme) {
    const face = op.bold && faces.bold ? faces.bold : faces.regular;
    const fontName = op.bold && faces.bold ? "/Fb" : "/Fr";
    const chars = Array.from(String(op.text || ""));
    if (!chars.length) return "";
    const ctx = measure();
    ctx.font = fontCss(theme, op.size, op.bold);
    let prev = 0;
    let acc = "";
    const parts = [];
    chars.forEach((ch, index) => {
      acc += ch;
      const width = ctx.measureText(acc).width;
      const advance = width - prev;
      prev = width;
      const gid = face.codeToGid.get(ch.codePointAt(0)) || 0;
      const fw = ((face.advances[gid] || 0) * op.size) / face.upem;
      parts.push(`<${hex4(gid)}>`);
      if (index < chars.length - 1) {
        const adj = Math.round(((fw - advance) / op.size) * 1000);
        if (adj) parts.push(String(adj));
      }
    });
    const y = pageH - op.y;
    return `BT\n${rgb(op.color)} rg\n${fontName} ${n(op.size)} Tf\n1 0 0 1 ${n(op.x)} ${n(y)} Tm\n[${parts.join(" ")}] TJ\nET`;
  }

  function pageStream(page, theme, faces) {
    const lines = [];
    const gs = new Set();
    const paint = (body, opacity) => {
      if (opacity != null && opacity < 0.999) {
        const key = Math.round(opacity * 100);
        gs.add(key);
        lines.push("q", `/GS${key} gs`, body, "Q");
      } else lines.push(body);
    };
    paintPage(page, theme).forEach((op) => {
      if (op.t === "round") {
        const path = roundPdf(op, page.h);
        const bits = [];
        if (op.fill) bits.push(`${rgb(op.fill)} rg`, path, "f");
        if (op.stroke) bits.push("q", `${n(op.sw || 1)} w`, `${rgb(op.stroke)} RG`, path, "S", "Q");
        paint(bits.join("\n"), op.opacity);
      } else if (op.t === "line") {
        paint(["q", `${n(op.sw || 0.5)} w`, `${rgb(op.color)} RG`, `${n(op.x1)} ${n(page.h - op.y1)} m`, `${n(op.x2)} ${n(page.h - op.y2)} l`, "S", "Q"].join("\n"), op.opacity);
      } else if (op.t === "text") paint(textPdf(op, page.h, faces, theme), op.opacity);
      else if (op.t === "ring") {
        const track = arcPdf(op.cx, op.cy, op.r, -Math.PI / 2, Math.PI * 1.5, page.h);
        const bits = ["q", `${n(op.sw)} w`, "1 J", `${rgb(op.track)} RG`, track, "S", "Q"];
        if (op.pct > 0.5) {
          const a0 = -Math.PI / 2;
          const a1 = a0 + (Math.min(op.pct, 99.99) / 100) * Math.PI * 2;
          bits.push("q", `${n(op.sw)} w`, "1 J", `${rgb(op.ink)} RG`, arcPdf(op.cx, op.cy, op.r, a0, a1, page.h), "S", "Q");
        }
        paint(bits.join("\n"), op.opacity);
      }
    });
    return { stream: lines.join("\n"), gs: [...gs] };
  }

  function collectCodes(sheet, theme) {
    const regular = new Set();
    const bold = new Set();
    (sheet.pages || []).forEach((page) => {
      paintPage(page, theme).forEach((op) => {
        if (op.t !== "text") return;
        const bag = op.bold ? bold : regular;
        Array.from(String(op.text || "")).forEach((ch) => {
          const code = ch.codePointAt(0);
          if (code <= 0xffff) bag.add(code);
        });
      });
    });
    return { regular, bold };
  }

  function fontObjects(face, name, pushObj) {
    const fileId = pushObj(() => [`<< /Length ${face.bytes.length} >>\nstream\n`, face.bytes, "\nendstream"]);
    const pairs = [...face.codeToGid.entries()].filter(([, gid]) => gid);
    const uniId = pushObj(() => {
      const body = latin1(toUnicode(pairs));
      return [`<< /Length ${body.length} >>\nstream\n`, body, "\nendstream"];
    });
    const descId = pushObj(() => latin1(`<< /Type /FontDescriptor /FontName /${name} /Flags 32 /FontBBox [${face.bbox.join(" ")}] /ItalicAngle 0 /Ascent ${face.ascender} /Descent ${face.descender} /CapHeight ${face.ascender} /StemV 80 /FontFile2 ${fileId} 0 R >>`));
    const widths = [];
    for (let gid = 1; gid < face.advances.length; gid += 1) widths.push(`${gid} [${Math.round((face.advances[gid] * 1000) / face.upem)}]`);
    const cidId = pushObj(() => latin1(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descId} 0 R /DW 500 /W [${widths.join(" ")}] /CIDToGIDMap /Identity >>`));
    return pushObj(() => latin1(`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${cidId} 0 R] /ToUnicode ${uniId} 0 R >>`));
  }

  function toUnicode(pairs) {
    const lines = [" /CIDInit /ProcSet findresource begin", "12 dict begin", "begincmap", "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def", "/CMapName /Adobe-Identity-UCS def", "/CMapType 2 def", "1 begincodespacerange", "<0000> <FFFF>", "endcodespacerange"];
    for (let i = 0; i < pairs.length; i += 100) {
      const chunk = pairs.slice(i, i + 100);
      lines.push(`${chunk.length} beginbfchar`);
      chunk.forEach(([code, gid]) => lines.push(`<${hex4(gid)}> <${hex4(code)}>`));
      lines.push("endbfchar");
    }
    lines.push("endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end");
    return lines.join("\n");
  }

  async function build(sheet, theme) {
    if (!sheet?.pages?.length) throw new Error("Нет страниц презентации");
    const files = FILES[theme.file] || FILES.segoe;
    const used = collectCodes(sheet, theme);
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
    const regularId = fontObjects(faces.regular, "PresRegular", pushObj);
    const boldId = faces.bold ? fontObjects(faces.bold, "PresBold", pushObj) : 0;
    const drawn = sheet.pages.map((page) => pageStream(page, theme, faces));
    const gsKeys = [...new Set(drawn.flatMap((item) => item.gs))];
    const gsIds = new Map(gsKeys.map((key) => [key, pushObj(() => latin1(`<< /Type /ExtGState /ca ${n(key / 100)} /CA ${n(key / 100)} >>`))]));
    const pageIds = sheet.pages.map((page, index) => {
      const data = latin1(drawn[index].stream);
      const contentId = pushObj(() => [`<< /Length ${data.length} >>\nstream\n`, data, "\nendstream"]);
      const fonts = [`/Fr ${regularId} 0 R`];
      if (boldId) fonts.push(`/Fb ${boldId} 0 R`);
      const gs = drawn[index].gs.length ? ` /ExtGState << ${drawn[index].gs.map((key) => `/GS${key} ${gsIds.get(key)} 0 R`).join(" ")} >>` : "";
      const group = drawn[index].gs.length ? " /Group << /Type /Group /S /Transparency /CS /DeviceRGB >>" : "";
      return pushObj(() => latin1(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n(page.w)} ${n(page.h)}] /Resources << /Font << ${fonts.join(" ")} >>${gs} /ProcSet [/PDF /Text] >> /Contents ${contentId} 0 R${group} >>`));
    });
    bodies[pagesId] = latin1(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
    const catalogId = pushObj(() => latin1(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`));
    const infoId = pushObj(() => latin1(`<< /Producer <${utf16Hex("FinMaster")}> /Title <${utf16Hex(sheet.title || "Презентация")}> /CreationDate (${pdfDate(new Date())}) >>`));
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

  function sheetNow() {
    return window.FinPresent?.sheet?.() || null;
  }

  function renderPreview() {
    const host = modal?.querySelector("[data-pres-pdf-view]");
    const note = modal?.querySelector("[data-pres-pdf-note]");
    if (!host) return;
    const sheet = sheetNow();
    const theme = themeById(themeId);
    modal.querySelectorAll("[data-pres-pdf-theme]").forEach((btn) => btn.classList.toggle("is-on", btn.dataset.presPdfTheme === theme.id));
    if (!sheet?.pages?.length) {
      host.innerHTML = "";
      if (note) note.textContent = "Откройте отчёт, чтобы сохранить презентацию.";
      return;
    }
    host.innerHTML = sheet.pages
      .map((page) => `<div class="pres-pdf-page" style="width:min(100%, ${Math.round(page.w * (520 / page.h))}px);aspect-ratio:${page.w} / ${page.h}">${svgOf(page, theme)}</div>`)
      .join("");
    if (note) note.textContent = `Страниц: ${sheet.pages.length}. Размер листа совпадает с холстом.`;
  }

  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal pres-pdf-modal";
    modal.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="pres-pdf-title">
      <div class="pres-pdf-head"><h3 id="pres-pdf-title">PDF презентации</h3><button type="button" class="btn" data-pres-pdf-close>Закрыть</button></div>
      <div class="pres-pdf-styles"><span>Стили</span><div class="pres-pdf-themes">${THEMES.map((item) => `<button type="button" data-pres-pdf-theme="${item.id}">${item.name}</button>`).join("")}</div></div>
      <div class="pres-pdf-view" data-pres-pdf-view></div>
      <div class="pres-pdf-foot"><p data-pres-pdf-note></p><div class="pres-pdf-actions"><button type="button" class="btn primary" data-pres-pdf-save>Сохранить PDF</button></div></div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal || e.target.closest("[data-pres-pdf-close]")) close();
      const pick = e.target.closest("[data-pres-pdf-theme]");
      if (pick) {
        themeId = pick.dataset.presPdfTheme;
        try { localStorage.setItem("finmaster.pres.pdfTheme", themeId); } catch { /* ignore */ }
        renderPreview();
      }
      if (e.target.closest("[data-pres-pdf-save]")) save();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.classList.contains("open")) close();
    });
    return modal;
  }

  function open() {
    ensureModal().classList.add("open");
    renderPreview();
  }

  function close() {
    modal?.classList.remove("open");
  }

  async function post(url, body) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Не удалось сохранить PDF");
    return data;
  }

  function bytesToBase64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  async function save() {
    const btn = modal?.querySelector("[data-pres-pdf-save]");
    const note = modal?.querySelector("[data-pres-pdf-note]");
    const sheet = sheetNow();
    const theme = themeById(themeId);
    if (!sheet?.pages?.length) {
      if (note) note.textContent = "Откройте отчёт, чтобы сохранить презентацию.";
      return;
    }
    const name = `${sheet.title.slice(0, 80)}.pdf`.replace(/[\\/:*?"<>|]+/g, "_");
    try {
      if (btn) btn.disabled = true;
      if (note) note.textContent = "Собираю PDF…";
      let path = "";
      if (window.pywebview) {
        const picked = await post("/api/dialog/pdf", { suggested: name });
        if (picked.cancelled || !picked.path) {
          if (note) note.textContent = `Страниц: ${sheet.pages.length}. Размер листа совпадает с холстом.`;
          return;
        }
        path = picked.path;
      }
      const bytes = await build(sheet, theme);
      if (path) {
        await post("/api/write-bytes", { path, base64: bytesToBase64(bytes) });
        if (note) note.textContent = `PDF сохранён · страниц: ${sheet.pages.length}`;
        return;
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      if (note) note.textContent = `PDF скачан · страниц: ${sheet.pages.length}`;
    } catch (err) {
      if (note) note.textContent = `Не удалось сохранить PDF: ${err.message || err}`;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  document.getElementById("pres-pdf-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    open();
  });

  window.FinPresPdf = { open, build, themes: THEMES };
})();
