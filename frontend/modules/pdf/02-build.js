/* bundle-seam */
(function () {
  async function canvasToJpeg(canvas, quality) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error("Не удалось подготовить страницу PDF");
    return new Uint8Array(await blob.arrayBuffer());
  }

  /**
   * pages: [{ canvas, widthPt, heightPt }]
   * Возвращает Uint8Array с содержимым PDF.
   */
  async function build(pages, meta = {}) {
    if (!pages?.length) throw new Error("Нет страниц для PDF");
    const images = [];
    for (const page of pages) {
      images.push({
        jpeg: await canvasToJpeg(page.canvas, meta.quality || 0.92),
        pxW: page.canvas.width,
        pxH: page.canvas.height,
        wPt: page.widthPt,
        hPt: page.heightPt,
      });
    }

    const chunks = [];
    const offsets = [];
    let offset = 0;
    const push = (data) => {
      const bytes = typeof data === "string" ? latin1(data) : data;
      chunks.push(bytes);
      offset += bytes.length;
    };
    const obj = (id, body) => {
      offsets[id] = offset;
      push(`${id} 0 obj\n`);
      body();
      push("\nendobj\n");
    };

    push("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n");
    const pageIds = images.map((_, i) => 3 + i * 3);
    obj(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
    obj(2, () => push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${images.length} >>`));
    images.forEach((img, i) => {
      const pageId = pageIds[i];
      const contentId = pageId + 1;
      const imageId = pageId + 2;
      obj(pageId, () =>
        push(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(img.wPt)} ${num(img.hPt)}] ` +
            `/Resources << /XObject << /Im${i} ${imageId} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${contentId} 0 R >>`
        )
      );
      const content = `q ${num(img.wPt)} 0 0 ${num(img.hPt)} 0 0 cm /Im${i} Do Q`;
      obj(contentId, () => {
        push(`<< /Length ${content.length} >>\nstream\n`);
        push(content);
        push("\nendstream");
      });
      obj(imageId, () => {
        push(
          `<< /Type /XObject /Subtype /Image /Width ${img.pxW} /Height ${img.pxH} ` +
            `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`
        );
        push(img.jpeg);
        push("\nendstream");
      });
    });
    const infoId = 3 + images.length * 3;
    obj(infoId, () =>
      push(`<< /Producer <${utf16Hex("FinMaster")}> /Title <${utf16Hex(meta.title || "FinMaster")}> /CreationDate (${pdfDate(new Date())}) >>`)
    );

    const xref = offset;
    const size = infoId + 1;
    push(`xref\n0 ${size}\n0000000000 65535 f \n`);
    for (let id = 1; id < size; id += 1) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
    push(`trailer\n<< /Size ${size} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

    const out = new Uint8Array(offset);
    let pos = 0;
    chunks.forEach((c) => {
      out.set(c, pos);
      pos += c.length;
    });
    return out;
  }

  window.FinPdf = { build };
})();
