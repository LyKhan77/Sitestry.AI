/**
 * Sitestry.AI — Backend API Client & Client-Side Fallback Blueprint Generator
 * Communicates with FastAPI endpoints (/api/samples, /api/load-sample, /api/pdf-info,
 * /api/pdf-to-image, /api/detect-grid, /api/extract-layout) and includes a rich
 * client-side fallback generator for zero-server testing.
 */

export class SitestryAPI {
  constructor(baseUrl = "") {
    this.baseUrl = baseUrl;
  }

  async loadSample(sampleId, pageNumber = null) {
    try {
      const res = await fetch(`${this.baseUrl}/api/load-sample`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sample_id: sampleId, page_number: pageNumber }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn("[SitestryAPI] Backend unreachable, generating synthetic fallback blueprint:", err);
      return this.generateFallbackSample(sampleId);
    }
  }

  // ==================== SINGLE WORKSPACE ====================
  async _workspaceFetch(path, options = {}) {
    const res = await fetch(`${this.baseUrl}/api/workspace${path}`, options);
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        detail = (await res.json()).detail || detail;
      } catch (_err) {
        /* body was not JSON */
      }
      throw new Error(detail);
    }
    return res;
  }

  async getWorkspace() {
    return (await this._workspaceFetch("")).json();
  }

  async createWorkspaceSource({ file = null, sampleId = null, meta = {} } = {}) {
    const fd = new FormData();
    if (file) fd.append("file", file);
    if (sampleId) fd.append("sample_id", sampleId);
    fd.append("meta_json", JSON.stringify(meta));
    return (await this._workspaceFetch("/source", { method: "POST", body: fd })).json();
  }

  async getWorkspaceSource() {
    const res = await this._workspaceFetch("/source");
    const header = res.headers.get("X-Source-Filename");
    return { blob: await res.blob(), filename: header ? decodeURIComponent(header) : "source" };
  }

  async getWorkspaceProject() {
    return (await this._workspaceFetch("/project")).json();
  }

  async saveWorkspaceProject({ project, meta }) {
    return (
      await this._workspaceFetch("/project", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, meta }),
      })
    ).json();
  }

  async patchWorkspaceMeta(meta) {
    return (
      await this._workspaceFetch("/meta", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(meta),
      })
    ).json();
  }

  async deleteWorkspace() {
    return (await this._workspaceFetch("", { method: "DELETE" })).json();
  }

  async inspectPdf(file) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${this.baseUrl}/api/pdf-info`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) throw new Error(`Failed to inspect PDF: HTTP ${res.status}`);
    return await res.json();
  }

  async renderPdfPage(file, pageNumber = 1) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("page_number", String(pageNumber));
    const res = await fetch(`${this.baseUrl}/api/pdf-to-image`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) throw new Error(`Failed to render PDF page: HTTP ${res.status}`);
    return await res.json();
  }

  async detectGridScale({ file = null, sampleId = null, pageNumber = 1, roiPx = null }) {
    try {
      const fd = new FormData();
      if (file) fd.append("file", file);
      if (sampleId) fd.append("sample_id", sampleId);
      fd.append("page_number", String(pageNumber));
      if (roiPx) fd.append("roi_json", JSON.stringify(roiPx));

      const res = await fetch(`${this.baseUrl}/api/detect-grid`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      return {
        scale_px_per_meter: sampleId === "ancol_p13" ? 18.5 : 30.68,
        reference_m: 6.0,
        method: "offline_fallback_calibration",
        confidence: 0.9,
      };
    }
  }

  async fetchBlueprintGuides({
    sampleId = null,
    file = null,
    pageNumber = 1,
    roiPx = null,
    scalePxPerMeter = 30.68,
    signal = null,
  }) {
    const fd = new FormData();
    if (sampleId) fd.append("sample_id", sampleId);
    if (file) fd.append("file", file);
    fd.append("page_number", String(pageNumber));
    if (roiPx) fd.append("roi_json", JSON.stringify(roiPx));
    fd.append("scale_px_per_meter", String(scalePxPerMeter));
    const res = await fetch(`${this.baseUrl}/api/blueprint-guides`, {
      method: "POST",
      body: fd,
      signal,
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const payload = await res.json();
        detail = payload?.detail?.message || payload?.detail || detail;
      } catch (err) {
        // Keep the HTTP status when the error body is not JSON.
      }
      throw new Error(`Blueprint guides failed: ${detail}`);
    }
    return await res.json();
  }

  async extractLayout({ file = null, sampleId = null, pageNumber = 1, scalePxPerMeter = 30.68, roiPx = null }) {
    // True when the server failed and the layout below is a client-generated stand-in, not a real extraction.
    this.lastExtractionFallback = false;
    try {
      const fd = new FormData();
      if (file) fd.append("file", file);
      if (sampleId) fd.append("sample_id", sampleId);
      fd.append("page_number", String(pageNumber));
      fd.append("scale_px_per_meter", String(scalePxPerMeter));
      if (roiPx) fd.append("roi_json", JSON.stringify(roiPx));

      const res = await fetch(`${this.baseUrl}/api/extract-layout`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn("[SitestryAPI] Using client-side fallback layout extractor:", err);
      this.lastExtractionFallback = true;
      const layout = this.generateFallbackLayout(sampleId, scalePxPerMeter, roiPx);
      // Per-result marker (non-enumerable, so it never reaches project JSON): overlapping requests cannot mix flags.
      Object.defineProperty(layout, "extractionFallback", { value: true });
      return layout;
    }
  }

  generateFallbackSample(sampleId = "gatsu_p4") {
    const canvas = document.createElement("canvas");
    canvas.width = 1584;
    canvas.height = 1224;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw CAD Frame & Title Block
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2;
    ctx.strokeRect(30, 30, 1524, 1164);
    ctx.strokeRect(1260, 30, 294, 1164);

    ctx.fillStyle = "#003473";
    ctx.font = "bold 20px monospace";
    ctx.fillText("INDOSAT OOREDOO HUTCHISON", 1275, 95);
    ctx.font = "15px monospace";
    ctx.fillText(sampleId === "ancol_p13" ? "WP1 APD ANCOL HAL. 13" : "MSC GATSU LANTAI 1 (HAL. 4)", 1275, 130);

    // Draw structural grid lines (A-F, 1-3)
    const gx = [206.4, 390.5, 574.6, 697.2, 881.4, 1065.5];
    const gy = [354.7, 538.8, 722.9];
    ctx.strokeStyle = "#e879f9";
    ctx.setLineDash([8, 6]);
    gx.forEach((x) => {
      ctx.beginPath();
      ctx.moveTo(x, 300);
      ctx.lineTo(x, 820);
      ctx.stroke();
    });
    gy.forEach((y) => {
      ctx.beginPath();
      ctx.moveTo(140, y);
      ctx.lineTo(1140, y);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // Draw double-line perimeter
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.strokeRect(203, 351, 866, 375);
    ctx.strokeRect(209, 358, 854, 361);

    return {
      sample_id: sampleId,
      title: sampleId === "ancol_p13" ? "WP1 APD Ancol (Hal. 13)" : "MSC Gatsu Lantai 1 (Hal. 4)",
      filename: `${sampleId}.pdf`,
      source_type: "pdf_vector",
      page_number: sampleId === "ancol_p13" ? 13 : 4,
      total_pages: sampleId === "ancol_p13" ? 28 : 11,
      image_width_px: 1584,
      image_height_px: 1224,
      scale_px_per_meter: sampleId === "ancol_p13" ? 18.5 : 30.68,
      roi_px: { x: 63.4, y: 73.4, width: 1172.2, height: 1052.6 },
      image_data_url: canvas.toDataURL("image/png"),
    };
  }

  generateFallbackLayout(sampleId = "gatsu_p4", scale = 30.68, roiPx = null) {
    return {
      project_id: `fallback_${sampleId}`,
      project_name: "MSC Gatsu Lantai 1 (Offline Fallback)",
      metadata: {
        source_type: "pdf_vector",
        page_number: 4,
        image_width_px: 1584,
        image_height_px: 1224,
        scale_px_per_meter: scale,
        default_wall_height_m: 3.8,
        raised_floor_grid_m: 0.6,
        roi_px: roiPx || { x: 63.4, y: 73.4, width: 1172.2, height: 1052.6 },
      },
      nodes: [
        { id: "n1", x_px: 206.4, y_px: 354.7 },
        { id: "n2", x_px: 1065.5, y_px: 354.7 },
        { id: "n3", x_px: 1065.5, y_px: 722.9 },
        { id: "n4", x_px: 206.4, y_px: 722.9 },
      ],
      walls: [
        { id: "w1", start_node: "n1", end_node: "n2", thickness_m: 0.24, height_m: 3.8, type: "solid", label: "North Wall" },
        { id: "w2", start_node: "n2", end_node: "n3", thickness_m: 0.24, height_m: 3.8, type: "solid", label: "East Wall" },
        { id: "w3", start_node: "n3", end_node: "n4", thickness_m: 0.24, height_m: 3.8, type: "solid", label: "South Wall" },
        { id: "w4", start_node: "n4", end_node: "n1", thickness_m: 0.24, height_m: 3.8, type: "solid", label: "West Wall" },
      ],
      columns: [],
      openings: [],
      rooms: [],
      equipments: [],
      cable_trays: [],
      stairs: [],
    };
  }
}

export const api = new SitestryAPI();
