/**
 * Swissdgets-style bento grid: non-overlapping blocks on a cols×rows lattice.
 */

const state = {
  cols: 6,
  rows: 5,
  gap: 8,
  maxSpan: 3,
  minSpan: 1,
  layoutGridMode: false,
  shapesPerRow: 4,
  shapesPerCol: 3,
  canvasPadding: 0,
  exportScale: 2,
  sizeVariance: 35,
  shapeMode: "mix",
  rTL: 12,
  rTR: 12,
  rBR: 12,
  rBL: 12,
  layoutSeed: (Math.random() * 0xffffffff) >>> 0,
  shapeSeed: (Math.random() * 0xffffffff) >>> 0,
  blocks: [],
  /** @type {number | null} index into `blocks` */
  selectedIndex: null,
  canvasBg: "#ffffff",
  shapeColor: "#221f20",
  accentColor: "#ff7aac",
};

function normalizeHex(hex) {
  if (!hex || typeof hex !== "string") return "#000000";
  const s = hex.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const r = s[1],
      g = s[2],
      b = s[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return "#221f20";
}

function syncCssColors() {
  document.documentElement.style.setProperty("--shape-ink", normalizeHex(state.shapeColor));
  document.documentElement.style.setProperty("--accent", normalizeHex(state.accentColor));
}

const SHAPE_MODES = [
  { value: "mix", label: "Mix (Swiss)" },
  { value: "rect", label: "Rectangle" },
  { value: "pill", label: "Pill" },
  { value: "circle", label: "Circle" },
  { value: "circle-outline", label: "Circle (outline)" },
  { value: "triangle", label: "Triangle (outline)" },
  { value: "semicircle", label: "Semicircle (random dir)" },
  { value: "frame", label: "Outline frame" },
  { value: "dot", label: "Dot (logo anchor)" },
];

const SEM_KEYS = ["semicircle-n", "semicircle-s", "semicircle-e", "semicircle-w"];

/** Rounded triangle from `triangle.svg` — keep `d` in sync with that file. */
const TRIANGLE_PATH_D =
  "M81 37.6212C91.6667 43.7797 91.6667 59.1757 81 65.3341L30 94.7785C19.3334 100.937 6.00031 93.2395 6 80.923L6 22.0324C6.00033 9.71583 19.3335 2.01858 30 8.17691L81 37.6212Z";

const MIX_SHAPE_POOL = [
  "rect",
  "rect",
  "pill",
  "circle",
  "circle",
  "circle-outline",
  ...SEM_KEYS,
  "frame",
  "triangle",
  "triangle",
  "dot",
];

const MIX_SHAPE_POOL_NO_TRIANGLE = MIX_SHAPE_POOL.filter((s) => s !== "triangle");

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Split `total` cells into `parts` slice widths (sum = total). */
function distributeSizes(total, parts) {
  const p = Math.max(1, Math.min(parts, total));
  const base = Math.floor(total / p);
  const extra = total % p;
  const out = [];
  for (let i = 0; i < p; i++) out.push(base + (i < extra ? 1 : 0));
  return out;
}

/** Rectangular grid of exactly `across × down` blocks covering cols×rows cells. */
function generateGridLayout(cols, rows, shapesAcross, shapesDown) {
  const across = Math.max(1, Math.min(shapesAcross, cols));
  const down = Math.max(1, Math.min(shapesDown, rows));
  const colWidths = distributeSizes(cols, across);
  const rowHeights = distributeSizes(rows, down);
  const blocks = [];
  let r0 = 0;
  for (let ri = 0; ri < down; ri++) {
    let c0 = 0;
    const h = rowHeights[ri];
    for (let ci = 0; ci < across; ci++) {
      const w = colWidths[ci];
      blocks.push({ r0, c0, w, h });
      c0 += w;
    }
    r0 += h;
  }
  return blocks;
}

function pickFromMixPool(rng) {
  return MIX_SHAPE_POOL[Math.floor(rng() * MIX_SHAPE_POOL.length)];
}

function pickNonTriangleMixShape(rng) {
  const pool = MIX_SHAPE_POOL_NO_TRIANGLE;
  return pool[Math.floor(rng() * pool.length)];
}

/** Triangle only allowed on square blocks (1×1, 2×2, … cells); never on rectangles like 1×4. */
function pickShapeForBlock(rng, mode, block) {
  const square = block.w === block.h;
  if (mode === "mix") {
    /* Draw from no-triangle pool on non-square tiles so triangle rolls aren’t wasted */
    if (square) return pickFromMixPool(rng);
    return pickNonTriangleMixShape(rng);
  }
  if (mode === "triangle") {
    return square ? "triangle" : "blank";
  }
  if (mode === "semicircle") return SEM_KEYS[Math.floor(rng() * SEM_KEYS.length)];
  return mode;
}

function generateBlocks(cols, rows, maxSpan, minSpan, variance, rng) {
  const occ = Array.from({ length: rows }, () => Array(cols).fill(false));
  const blocks = [];
  const minCell = Math.max(1, Math.min(minSpan, maxSpan));

  const isFree = (r0, c0, h, w) => {
    for (let r = r0; r < r0 + h; r++) {
      for (let c = c0; c < c0 + w; c++) {
        if (r >= rows || c >= cols || occ[r][c]) return false;
      }
    }
    return true;
  };

  const mark = (r0, c0, h, w) => {
    for (let r = r0; r < r0 + h; r++) {
      for (let c = c0; c < c0 + w; c++) occ[r][c] = true;
    }
  };

  const hasEmpty = () => occ.some((row) => row.some((cell) => !cell));

  let guard = 0;
  while (hasEmpty() && guard++ < cols * rows * 100) {
    let placed = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      const r0 = Math.floor(rng() * rows);
      const c0 = Math.floor(rng() * cols);
      if (occ[r0][c0]) continue;

      const bias = variance / 100;
      const maxW = Math.min(maxSpan, cols - c0);
      const maxH = Math.min(maxSpan, rows - r0);
      const minW = Math.min(minCell, maxW);
      const minH = Math.min(minCell, maxH);
      let w = minW + Math.floor(rng() * (maxW - minW + 1));
      let h = minH + Math.floor(rng() * (maxH - minH + 1));
      if (rng() > bias) w = Math.max(minW, Math.floor(w * (0.35 + rng() * 0.65)));
      if (rng() > bias) h = Math.max(minH, Math.floor(h * (0.35 + rng() * 0.65)));
      w = Math.max(minW, Math.min(w, maxW));
      h = Math.max(minH, Math.min(h, maxH));

      if (!isFree(r0, c0, h, w)) continue;

      mark(r0, c0, h, w);
      blocks.push({ r0, c0, w, h });
      placed = true;
      break;
    }
    if (!placed) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (!occ[r][c]) {
            mark(r, c, 1, 1);
            blocks.push({ r0: r, c0: c, w: 1, h: 1 });
          }
        }
      }
    }
  }

  return blocks;
}

function applyShapesToBlocks() {
  const rng = mulberry32(state.shapeSeed >>> 0);
  for (const b of state.blocks) {
    b.shape = pickShapeForBlock(rng, state.shapeMode, b);
  }
}

function rebuildLayout() {
  const {
    cols,
    rows,
    maxSpan,
    minSpan,
    sizeVariance,
    layoutSeed,
    layoutGridMode,
    shapesPerRow,
    shapesPerCol,
  } = state;
  if (layoutGridMode) {
    const across = Math.max(1, Math.min(shapesPerRow, cols));
    const down = Math.max(1, Math.min(shapesPerCol, rows));
    state.blocks = generateGridLayout(cols, rows, across, down);
  } else {
    const rng = mulberry32(layoutSeed >>> 0);
    state.blocks = generateBlocks(cols, rows, maxSpan, minSpan, sizeVariance, rng);
  }
  state.selectedIndex = null;
  applyShapesToBlocks();
}

function render() {
  const canvas = document.getElementById("canvas");
  if (!canvas) return;

  syncCssColors();

  const {
    cols,
    rows,
    gap,
    canvasBg,
    canvasPadding,
    rTL,
    rTR,
    rBR,
    rBL,
    blocks,
  } = state;

  if (!blocks.length) rebuildLayout();

  if (
    state.selectedIndex != null &&
    (state.selectedIndex < 0 || state.selectedIndex >= state.blocks.length)
  ) {
    state.selectedIndex = null;
  }

  canvas.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  canvas.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  canvas.style.gap = `${gap}px`;
  canvas.style.backgroundColor = normalizeHex(canvasBg);
  canvas.style.padding = `${canvasPadding}px`;

  const frag = document.createDocumentFragment();
  const { selectedIndex } = state;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const shell = document.createElement("div");
    shell.className = "widget-shell";
    if (selectedIndex === i) shell.classList.add("widget-shell--selected");
    shell.dataset.index = String(i);
    shell.style.gridColumn = `${b.c0 + 1} / span ${b.w}`;
    shell.style.gridRow = `${b.r0 + 1} / span ${b.h}`;

    const inner = document.createElement("div");
    const shape = b.shape ?? "rect";
    inner.className = "widget";
    inner.dataset.shape = shape;

    inner.style.setProperty("--r-tl", `${rTL}px`);
    inner.style.setProperty("--r-tr", `${rTR}px`);
    inner.style.setProperty("--r-br", `${rBR}px`);
    inner.style.setProperty("--r-bl", `${rBL}px`);

    if (shape === "triangle") {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 95 103");
      svg.setAttribute("class", "widget__triangle-svg");
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", TRIANGLE_PATH_D);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("vector-effect", "non-scaling-stroke");
      svg.appendChild(path);
      inner.appendChild(svg);
    }

    shell.appendChild(inner);
    frag.appendChild(shell);
  }

  canvas.replaceChildren(frag);
}

function refreshMinSpanSlider() {
  const el = document.getElementById("ctrl-minspan");
  const out = document.getElementById("ctrl-minspan-val");
  if (!el) return;
  el.max = String(Math.max(1, state.maxSpan));
  state.minSpan = Math.max(1, Math.min(state.minSpan, state.maxSpan));
  el.value = String(state.minSpan);
  if (out) out.textContent = String(state.minSpan);
}

function refreshBlockGridSliders() {
  const sr = document.getElementById("ctrl-shapes-per-row-grid");
  const sc = document.getElementById("ctrl-shapes-per-col-grid");
  const outR = document.getElementById("ctrl-shapes-per-row-grid-val");
  const outC = document.getElementById("ctrl-shapes-per-col-grid-val");
  if (sr) {
    sr.max = String(Math.max(1, state.cols));
    state.shapesPerRow = Math.max(1, Math.min(state.shapesPerRow, state.cols));
    sr.value = String(state.shapesPerRow);
    if (outR) outR.textContent = String(state.shapesPerRow);
  }
  if (sc) {
    sc.max = String(Math.max(1, state.rows));
    state.shapesPerCol = Math.max(1, Math.min(state.shapesPerCol, state.rows));
    sc.value = String(state.shapesPerCol);
    if (outC) outC.textContent = String(state.shapesPerCol);
  }
}

function closeExportPopover() {
  const pop = document.getElementById("export-popover");
  const toggle = document.getElementById("btn-export-toggle");
  if (pop) pop.hidden = true;
  if (toggle) toggle.setAttribute("aria-expanded", "false");
}

function refreshLayoutModeUI() {
  const gridBtn = document.getElementById("btn-layout-grid");
  if (gridBtn) {
    gridBtn.setAttribute("aria-checked", String(state.layoutGridMode));
    gridBtn.classList.toggle("toggle--on", state.layoutGridMode);
  }
  document.querySelectorAll("[data-disable-when-grid]").forEach((el) => {
    const on = state.layoutGridMode;
    el.disabled = on;
    el.closest(".control")?.classList.toggle("control--muted", on);
  });
  document.querySelectorAll("[data-disable-when-bento]").forEach((el) => {
    const on = !state.layoutGridMode;
    el.disabled = on;
    el.closest(".control")?.classList.toggle("control--muted", on);
  });
}

function bindColorInput(id, key) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = normalizeHex(state[key]);
  el.addEventListener("input", () => {
    state[key] = normalizeHex(el.value);
    syncCssColors();
    render();
  });
}

function fallbackDownloadPng(blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "swissdgets.png";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * html2canvas does not rasterize mask-composite rings reliably; redraw them as border rings
 * on the cloned DOM only (screen UI unchanged).
 */
function rewriteMaskRingsForExport(clonedDoc) {
  const win = clonedDoc.defaultView;
  if (!win) return;
  clonedDoc.querySelectorAll('.widget[data-shape="frame"], .widget[data-shape="circle-outline"]').forEach((node) => {
    const cs = win.getComputedStyle(node);
    const ring = cs.paddingTop;
    if (!ring || ring === "0px") return;
    const color = cs.backgroundColor;
    node.style.setProperty("-webkit-mask", "none", "important");
    node.style.setProperty("mask", "none", "important");
    node.style.setProperty("mask-composite", "none", "important");
    node.style.setProperty("-webkit-mask-composite", "none", "important");
    node.style.setProperty("mask-clip", "border-box", "important");
    node.style.setProperty("-webkit-mask-clip", "border-box", "important");
    node.style.setProperty("padding", "0", "important");
    node.style.setProperty("background", "transparent", "important");
    node.style.setProperty("box-sizing", "border-box", "important");
    node.style.setProperty("border", `${ring} solid ${color}`, "important");
  });
}

async function exportPatternPng() {
  const toggle = document.getElementById("btn-export-toggle");
  const save = document.getElementById("btn-export-save");
  const el = document.getElementById("canvas");
  const h2c = window.html2canvas;
  if (!el || typeof h2c !== "function") {
    window.alert(
      "Could not load the export library. Check your network connection and reload the page."
    );
    return;
  }

  const scaleEl = document.getElementById("export-scale-range");
  if (scaleEl)
    state.exportScale = Math.max(1, Math.min(4, Number(scaleEl.value) || state.exportScale));

  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  if (toggle) {
    toggle.disabled = true;
    toggle.setAttribute("aria-busy", "true");
  }
  if (save) save.disabled = true;

  try {
    const scale = Math.max(1, Math.min(4, Math.round(state.exportScale)));
    const out = await h2c(el, {
      backgroundColor: normalizeHex(state.canvasBg),
      scale,
      logging: false,
      useCORS: true,
      onclone(clonedDoc) {
        rewriteMaskRingsForExport(clonedDoc);
      },
    });
    const blob = await new Promise((res) => {
      out.toBlob((b) => res(b), "image/png", 1);
    });
    if (!blob) throw new Error("Empty PNG");

    if (typeof window.showSaveFilePicker === "function") {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: "swissdgets.png",
          types: [
            {
              description: "PNG image",
              accept: { "image/png": [".png"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } catch (err) {
        if (err && err.name !== "AbortError") fallbackDownloadPng(blob);
      }
    } else {
      fallbackDownloadPng(blob);
    }
  } catch (e) {
    console.warn(e);
    window.alert(
      "Export failed. Try lowering PNG scale or check whether an extension is blocking canvas capture."
    );
  } finally {
    closeExportPopover();
    if (toggle) {
      toggle.disabled = false;
      toggle.removeAttribute("aria-busy");
    }
    if (save) save.disabled = false;
  }
}

function bindControls() {
  const bindRange = (id, key, { onInput, displaySuffix = "" } = {}) => {
    const el = document.getElementById(id);
    const out = document.getElementById(`${id}-val`);
    if (!el) return;
    const sync = () => {
      state[key] = Number(el.value);
      if (out) out.textContent = `${state[key]}${displaySuffix}`;
      if (onInput) onInput();
      else render();
    };
    el.addEventListener("input", sync);
    el.value = String(state[key]);
    if (out) out.textContent = `${state[key]}${displaySuffix}`;
  };

  const relayout = () => {
    rebuildLayout();
    render();
  };

  const afterColsRows = () => {
    refreshBlockGridSliders();
    relayout();
  };

  bindRange("ctrl-cols", "cols", { onInput: afterColsRows });
  bindRange("ctrl-rows", "rows", { onInput: afterColsRows });
  bindRange("ctrl-gap", "gap");
  bindRange("ctrl-maxspan", "maxSpan", {
    onInput: () => {
      refreshMinSpanSlider();
      relayout();
    },
  });

  const minSpanEl = document.getElementById("ctrl-minspan");
  if (minSpanEl) {
    minSpanEl.addEventListener("input", () => {
      state.minSpan = Number(minSpanEl.value);
      refreshMinSpanSlider();
      relayout();
    });
  }

  bindRange("ctrl-variance", "sizeVariance", { onInput: relayout });
  bindRange("ctrl-canvas-pad", "canvasPadding", { displaySuffix: "px" });

  document.getElementById("btn-layout-grid")?.addEventListener("click", () => {
    state.layoutGridMode = !state.layoutGridMode;
    refreshLayoutModeUI();
    refreshBlockGridSliders();
    relayout();
  });

  const spr = document.getElementById("ctrl-shapes-per-row-grid");
  if (spr) {
    spr.addEventListener("input", () => {
      state.shapesPerRow = Number(spr.value);
      refreshBlockGridSliders();
      if (state.layoutGridMode) relayout();
    });
  }

  const spc = document.getElementById("ctrl-shapes-per-col-grid");
  if (spc) {
    spc.addEventListener("input", () => {
      state.shapesPerCol = Number(spc.value);
      refreshBlockGridSliders();
      if (state.layoutGridMode) relayout();
    });
  }

  bindColorInput("ctrl-color-bg", "canvasBg");
  bindColorInput("ctrl-color-ink", "shapeColor");
  bindColorInput("ctrl-color-accent", "accentColor");

  bindRange("ctrl-rtl", "rTL", { displaySuffix: "px" });
  bindRange("ctrl-rtr", "rTR", { displaySuffix: "px" });
  bindRange("ctrl-rbr", "rBR", { displaySuffix: "px" });
  bindRange("ctrl-rbl", "rBL", { displaySuffix: "px" });

  const shape = document.getElementById("ctrl-shape");
  if (shape) {
    shape.innerHTML = SHAPE_MODES.map(
      (o) => `<option value="${o.value}">${o.label}</option>`
    ).join("");
    if (!SHAPE_MODES.some((m) => m.value === state.shapeMode)) {
      state.shapeMode = "mix";
    }
    shape.value = state.shapeMode;
    shape.addEventListener("change", () => {
      state.shapeMode = shape.value;
      state.shapeSeed = (Math.random() * 0xffffffff) >>> 0;
      applyShapesToBlocks();
      render();
    });
  }

  document.getElementById("btn-shuffle")?.addEventListener("click", () => {
    state.layoutSeed = (Math.random() * 0xffffffff) >>> 0;
    relayout();
  });

  document.getElementById("btn-reshuffle-shapes")?.addEventListener("click", () => {
    state.shapeSeed = (Math.random() * 0xffffffff) >>> 0;
    applyShapesToBlocks();
    render();
  });

  const canvas = document.getElementById("canvas");
  canvas?.addEventListener("click", (e) => {
    const shell = e.target.closest(".widget-shell");
    if (!shell || !canvas.contains(shell)) {
      state.selectedIndex = null;
      render();
      return;
    }
    const idx = Number(shell.dataset.index);
    if (Number.isNaN(idx)) return;
    state.selectedIndex = state.selectedIndex === idx ? null : idx;
    render();
  });

  const exportWrap = document.querySelector(".header__export-wrap");
  const exportToggle = document.getElementById("btn-export-toggle");
  const exportPop = document.getElementById("export-popover");
  const exportScaleRange = document.getElementById("export-scale-range");
  const exportScaleVal = document.getElementById("export-scale-val");

  if (exportScaleRange) {
    const syncScale = () => {
      state.exportScale = Math.max(1, Math.min(4, Number(exportScaleRange.value)));
      exportScaleRange.value = String(state.exportScale);
      if (exportScaleVal) exportScaleVal.textContent = `${state.exportScale}×`;
    };
    exportScaleRange.addEventListener("input", syncScale);
    syncScale();
  }

  exportToggle?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!exportPop || !exportToggle) return;
    exportPop.hidden = !exportPop.hidden;
    exportToggle.setAttribute("aria-expanded", String(!exportPop.hidden));
    if (!exportPop.hidden && exportScaleRange) {
      exportScaleRange.value = String(Math.max(1, Math.min(4, state.exportScale)));
      if (exportScaleVal) exportScaleVal.textContent = `${state.exportScale}×`;
    }
  });

  document.getElementById("btn-export-save")?.addEventListener("click", (e) => {
    e.stopPropagation();
    exportPatternPng();
  });

  document.addEventListener("click", (e) => {
    if (!exportWrap || exportWrap.contains(e.target)) return;
    closeExportPopover();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const pop = document.getElementById("export-popover");
    if (pop && !pop.hidden) closeExportPopover();
  });

  refreshMinSpanSlider();
  refreshBlockGridSliders();
  refreshLayoutModeUI();
}

document.addEventListener("DOMContentLoaded", () => {
  syncCssColors();
  rebuildLayout();
  bindControls();
  render();
});
