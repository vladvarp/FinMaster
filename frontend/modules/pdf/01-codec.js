/* Минимальный генератор PDF: каждая страница — JPEG-картинка на весь лист. */
(function () {
  "use strict";

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

  function num(n) {
    return (Math.round(Number(n) * 100) / 100).toString();
  }

  function pdfDate(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }


/* bundle-seam */
})();
