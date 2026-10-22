/**
 * Turning an AI design into pages.
 *
 * The designer returns each page as SVG. Here it becomes two things: a
 * picture to preview (an <img> of the SVG, which can't run anything), and,
 * when the teacher adds it, a vector PDF the notebook keeps like any upload.
 * Before either, the SVG goes through an allowlist — the server already
 * refuses anything active, and this is the second lock on the same door.
 */

export interface AiAnswer { x: number; y: number; w: number; h: number; kind: "text" | "checkbox"; label: string }
export interface AiPage { svg: string; answers: AiAnswer[] }
export interface AiDesign { title: string; pages: AiPage[] }

const ELEMENTS = new Set([
  "svg", "g", "rect", "line", "circle", "ellipse", "polyline", "polygon", "path",
  "text", "tspan", "defs", "clipPath", "title",
]);
const ATTRIBUTES = new Set([
  "xmlns", "width", "height", "viewBox", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
  "d", "points", "dx", "dy", "transform", "id", "clip-path", "fill", "fill-opacity", "fill-rule",
  "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "stroke-opacity", "opacity",
  "font-family", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline", "letter-spacing",
  "text-decoration", "preserveAspectRatio",
]);

/** The page as a clean SVG element, or an error when it isn't one. */
export function cleanSvg(source: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName !== "svg" || doc.getElementsByTagName("parsererror").length) {
    throw new Error("The design came back in a form Notesanity can't use. Try again.");
  }
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (!ELEMENTS.has(child.nodeName)) child.remove();
      else walk(child);
    }
    for (const attr of Array.from(el.attributes)) {
      const v = attr.value;
      const bad = !ATTRIBUTES.has(attr.name) || /javascript:|url\(\s*["']?(?!#)/i.test(v);
      if (bad) el.removeAttribute(attr.name);
    }
  };
  walk(root);
  return root as unknown as SVGSVGElement;
}

/** The page's size in points, from its own viewBox. */
export function svgSize(svg: SVGSVGElement): { width: number; height: number } {
  const vb = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  const width = vb.length === 4 && vb[2] > 0 ? vb[2] : Number(svg.getAttribute("width")) || 612;
  const height = vb.length === 4 && vb[3] > 0 ? vb[3] : Number(svg.getAttribute("height")) || 792;
  return { width, height };
}

/** A data: URL for previewing a page in an <img>, and the page's size. */
export function previewOf(source: string): { url: string; width: number; height: number } {
  const svg = cleanSvg(source);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
  return { url, ...svgSize(svg) };
}

/**
 * One PDF holding every page of the design, at each page's own size.
 * svg2pdf draws into jsPDF as vectors, so the text stays sharp at any zoom and
 * can be read aloud and searched like any typed worksheet.
 */
export async function designToPdf(design: AiDesign): Promise<{ pdf: Blob; sizes: { width: number; height: number }[] }> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  let doc: InstanceType<typeof jsPDF> | null = null;
  const sizes: { width: number; height: number }[] = [];
  // svg2pdf measures text through the live DOM, so each page is mounted out
  // of sight while it's drawn.
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:0;height:0;overflow:hidden";
  document.body.appendChild(host);
  try {
    for (const page of design.pages) {
      const svg = cleanSvg(page.svg);
      const size = svgSize(svg);
      sizes.push(size);
      const orientation = size.width > size.height ? "landscape" : "portrait";
      if (!doc) doc = new jsPDF({ orientation, unit: "pt", format: [size.width, size.height], compress: true });
      else doc.addPage([size.width, size.height], orientation);
      host.replaceChildren(svg);
      await svg2pdf(svg, doc, { x: 0, y: 0, width: size.width, height: size.height });
    }
  } finally {
    host.remove();
  }
  if (!doc) throw new Error("The design has no pages.");
  return { pdf: doc.output("blob"), sizes };
}

/** A file as base64 for the designer, shrinking photos so they travel light. */
export async function sourceFileFor(file: File): Promise<{ mediaType: string; data: string }> {
  if (file.type === "application/pdf") {
    if (file.size > 10 * 1024 * 1024) throw new Error("That PDF is over 10MB. Attach a shorter one, or paste the text.");
    return { mediaType: "application/pdf", data: await base64Of(file) };
  }
  if (!file.type.startsWith("image/")) throw new Error("Attach a PDF or a photo.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { mediaType: "image/jpeg", data: canvas.toDataURL("image/jpeg", 0.85).split(",")[1] };
}

/** A rendered canvas as the designer's source: the page the teacher is on. */
export function sourceFromCanvas(canvas: HTMLCanvasElement) {
  return { mediaType: "image/jpeg", data: canvas.toDataURL("image/jpeg", 0.85).split(",")[1] };
}

async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
