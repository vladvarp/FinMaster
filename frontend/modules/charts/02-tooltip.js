  /* ============ tooltip ============ */

  function tipEl(inst) {
    const host = inst.canvas.parentElement;
    if (!host) return null;
    if (inst.tip && inst.tip.isConnected) return inst.tip;
    const el = document.createElement("div");
    el.className = "fin-tip";
    host.appendChild(el);
    inst.tip = el;
    return el;
  }

  function showTip(inst, html, x, y) {
    const el = tipEl(inst);
    if (!el) return;
    el.innerHTML = html;
    el.classList.add("show");
    const host = inst.canvas.parentElement;
    const hw = host.clientWidth;
    const left = clamp(x - el.offsetWidth / 2, 6, Math.max(6, hw - el.offsetWidth - 6));
    const top = Math.max(6, y - el.offsetHeight - 14);
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  function hideTip(inst) {
    inst.tip?.classList.remove("show");
  }

  function tipRow(color, label, value) {
    return `<div class="fin-tip-row"><i style="background:${color}"></i><span>${label}</span><b>${value}</b></div>`;
  }

