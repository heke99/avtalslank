import React, { useEffect, useRef, useState } from "react";
import type { PageViewport, PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";
import { bounded } from "./session";
import { supabase } from "./client";

type Box = { x: number; y: number; width: number; height: number };
export type PageGeometry = { viewport: PageViewport; width: number; height: number };

function viewportBox(field: Box, { viewport, width, height }: PageGeometry) {
  const [x1, y1] = viewport.convertToViewportPoint(field.x * width, (1 - field.y - field.height) * height);
  const [x2, y2] = viewport.convertToViewportPoint((field.x + field.width) * width, (1 - field.y) * height);
  return {
    x: Math.min(x1, x2) / viewport.width,
    y: Math.min(y1, y2) / viewport.height,
    width: Math.abs(x2 - x1) / viewport.width,
    height: Math.abs(y2 - y1) / viewport.height,
  };
}

export function fieldOverlay(field: Box, geometry: PageGeometry) {
  const box = viewportBox(field, geometry);
  return { left: box.x * 100 + "%", top: box.y * 100 + "%", width: box.width * 100 + "%", height: box.height * 100 + "%" };
}

export function fieldPosition(field: Box, geometry: PageGeometry, x: number, y: number) {
  const { viewport, width, height } = geometry;
  const overlay = viewportBox(field, geometry);
  const [x1, y1] = viewport.convertToPdfPoint(x * viewport.width, y * viewport.height);
  const [x2, y2] = viewport.convertToPdfPoint(
    (x + overlay.width) * viewport.width,
    (y + overlay.height) * viewport.height,
  );
  const round = (value: number) => Math.round(value * 10000) / 10000;
  const maxStart = (size: number) => Math.floor((1-size)*10000+1e-9)/10000;
  return {
    x: Math.min(maxStart(field.width), Math.max(0, round(Math.min(x1, x2) / width))),
    y: Math.min(maxStart(field.height), Math.max(0, round(1 - Math.max(y1, y2) / height))),
  };
}

export function PdfFieldPage({ path, source, page, onRendered }: {
  path?: string;
  source?: Blob;
  page: number;
  onRendered: (geometry: PageGeometry | undefined) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [preview, setPreview] = useState<{ pdf: Awaited<PDFDocumentLoadingTask["promise"]>; sizes: { width: number; height: number }[] }>();
  const [loadError, setLoadError] = useState(false);
  const [renderError, setRenderError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [renderedPage, setRenderedPage] = useState<number>();
  useEffect(() => {
    let active = true;
    let task: PDFDocumentLoadingTask | undefined;
    onRendered(undefined);
    setLoadError(false);
    setPreview(undefined);
    async function load() {
      let data=source;
      if (!data) {
        if (!path) throw Error("DOCUMENT_REQUIRED");
        const result=await bounded(supabase.storage.from("al-documents").download(path));
        if (result.error) throw result.error;
        data=result.data;
      }
      const [pdfjs, { PDFDocument }, bytes] = await Promise.all([
        import("pdfjs-dist"),
        import("pdf-lib"),
        data.arrayBuffer(),
      ]);
      const original = await PDFDocument.load(bytes);
      if (!active) return;
      const assets = "/assets/pdfjs-" + pdfjs.version + "/";
      pdfjs.GlobalWorkerOptions.workerSrc = assets + "pdf.worker.min.mjs";
      task = pdfjs.getDocument({
        data: bytes,
        cMapUrl: assets + "cmaps/",
        standardFontDataUrl: assets + "standard_fonts/",
        wasmUrl: assets + "wasm/",
        iccUrl: assets + "iccs/",
      });
      const pdf = await task.promise;
      if (active) setPreview({ pdf, sizes: original.getPages().map(item => item.getSize()) });
    }
    void load().catch(() => { if (active) setLoadError(true); });
    return () => { active = false; void task?.destroy().catch(() => {}); };
  }, [path, source, attempt, onRendered]);
  useEffect(() => {
    let active = true;
    let render: RenderTask | undefined;
    setRenderedPage(undefined);
    setRenderError(false);
    if (!preview || !canvas.current) return;
    const target = canvas.current;
    async function draw() {
      if (!preview) return;
      const source = await preview.pdf.getPage(page + 1);
      if (!active) return;
      const base = source.getViewport({ scale: 1 });
      const viewport = source.getViewport({ scale: 1400 / Math.max(base.width, base.height) });
      target.width = Math.ceil(viewport.width);
      target.height = Math.ceil(viewport.height);
      render = source.render({ canvas: target, viewport });
      await render.promise;
      if (active) {
        onRendered({ viewport, ...preview.sizes[page] });
        setRenderedPage(page);
      }
    }
    void draw().catch(() => { if (active) setRenderError(true); });
    return () => { active = false; render?.cancel(); };
  }, [preview, page, onRendered]);
  return <>
    <canvas key={page} ref={canvas} hidden={renderedPage !== page} aria-label={"PDF-sida " + (page + 1)} />
    {renderedPage !== page && !loadError && !renderError && <p className="pdf-field-error" role="status">Visar PDF-sidan…</p>}
    {(loadError || renderError) && <div className="pdf-field-error" role="alert">
      <p>PDF-sidan kunde inte visas.</p>
      <button className="secondary" type="button" onClick={() => setAttempt(n => n + 1)}>Försök öppna PDF igen</button>
    </div>}
  </>;
}
