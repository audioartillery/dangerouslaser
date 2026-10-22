/**
 * Dangerous Laser - Interactive Center Canvas Viewport
 * Features:
 * - High-DPI sharp rendering
 * - Pan and Zoom (smooth wheel zoom at cursor with deep zoom support, drag pan, fit to view)
 * - Dynamic rulers & grid matching Metric (mm) or Standard (in)
 * - Machine Origin (0,0) with CNC axis indicators
 * - Original Image Layer with opacity slider and visibility toggle
 * - Toolpath Layer with G0 (rapid, dashed) & G1 (laser cut, theme-colored glow)
 * - Toolpath Laser Head Simulation (animated play/reset)
 */

const CanvasViewer = (function() {
  'use strict';

  const THEME_PALETTES = {
    'default': {
      bg: '#12141a',
      minorGrid: '#1a1f2c',
      majorGrid: '#252c3d',
      rulerBg: '#0f1218',
      rulerBorder: '#272d3d',
      rulerText: '#8b9bb4',
      rulerTick: '#3e4860',
      unitCorner: '#ff6b00',
      cutGlow: '#ff6b00',
      cutStroke: '#fb923c',
      cutCore: '#fff7ed',
      pierceDot: '#fbbf24',
      rapidStroke: 'rgba(56, 189, 248, 0.45)',
      simGlowMid: '#ff6b00',
      simGlowOuter: 'rgba(255, 107, 0, 0.4)',
      simGlowZero: 'rgba(255, 107, 0, 0)',
      simReticleOn: '#ff6b00',
      simReticleOff: '#38bdf8'
    },
    'cold-war': {
      bg: '#030905',
      minorGrid: '#07170d',
      majorGrid: '#0e2b18',
      rulerBg: '#020604',
      rulerBorder: '#143d22',
      rulerText: '#4ea868',
      rulerTick: '#1d5932',
      unitCorner: '#33ff66',
      cutGlow: '#00ff55',
      cutStroke: '#33ff66',
      cutCore: '#e5ffeb',
      pierceDot: '#a3e635',
      rapidStroke: 'rgba(45, 212, 191, 0.42)',
      simGlowMid: '#33ff66',
      simGlowOuter: 'rgba(51, 255, 102, 0.4)',
      simGlowZero: 'rgba(51, 255, 102, 0)',
      simReticleOn: '#33ff66',
      simReticleOff: '#2dd4bf'
    },
    'cool': {
      bg: '#101520',
      minorGrid: '#172030',
      majorGrid: '#212e45',
      rulerBg: '#0c1018',
      rulerBorder: '#24324a',
      rulerText: '#8ca2c0',
      rulerTick: '#3b5070',
      unitCorner: '#00a8ff',
      cutGlow: '#00a8ff',
      cutStroke: '#38bdf8',
      cutCore: '#f0f9ff',
      pierceDot: '#facc15',
      rapidStroke: 'rgba(167, 139, 250, 0.45)',
      simGlowMid: '#00a8ff',
      simGlowOuter: 'rgba(0, 168, 255, 0.4)',
      simGlowZero: 'rgba(0, 168, 255, 0)',
      simReticleOn: '#38bdf8',
      simReticleOff: '#a78bfa'
    }
  };

  class Viewer {
    constructor(canvasContainerId) {
      this.container = document.getElementById(canvasContainerId);
      if (!this.container) throw new Error(`Container #${canvasContainerId} not found`);

      this.canvas = document.createElement('canvas');
      this.canvas.className = 'viewport-canvas';
      this.container.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');

      // State
      this.units = 'standard'; // 'standard' (in) default or 'metric' (mm)
      this.theme = 'default';
      this.zoom = 60; // screen pixels per unit (e.g. 60 px per inch)
      this.panX = 120; // canvas pixel offset of (0,0)
      this.panY = 400;

      // Layers visibility & opacity
      this.showImage = true;
      this.imageOpacity = 0.5;
      this.showToolpaths = true;
      this.showRapids = true;
      this.showGrid = true;
      this.showOrigin = true;

      // Data references
      this.imageElement = null; // HTMLImageElement or Canvas
      this.imageTransform = null; // { x, y, width, height, rotation, flipH, flipV }
      this.toolpaths = []; // Array of Array of {x, y, power}
      this.bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100 };

      // Simulation state
      this.isSimulating = false;
      this.simProgress = 0; // 0.0 to 1.0
      this.simSpeed = 1; // 1x, 5x, 20x
      this.simAnimFrame = null;
      this.cutFeedrate = 40; // units/min
      this.rapidFeedrate = 120; // units/min
      this.totalCutDistance = 0;
      this.totalSimTime = 0; // total estimated runtime in seconds
      this.flattenedStrokes = []; // linear segments for quick simulation lookup
      this.onSimProgressCallback = null;

      // Interaction
      this.isDragging = false;
      this.dragStartX = 0;
      this.dragStartY = 0;

      this.initEvents();
      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    getPalette() {
      return THEME_PALETTES[this.theme] || THEME_PALETTES['default'];
    }

    setTheme(themeName) {
      if (THEME_PALETTES[themeName]) {
        this.theme = themeName;
        this.render();
      }
    }

    resize() {
      const rect = this.container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.width = rect.width;
      this.height = rect.height;

      this.canvas.width = Math.floor(rect.width * dpr);
      this.canvas.height = Math.floor(rect.height * dpr);
      this.canvas.style.width = `${rect.width}px`;
      this.canvas.style.height = `${rect.height}px`;

      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.scale(dpr, dpr);
      this.render();
    }

    initEvents() {
      // Mouse down -> start pan
      this.canvas.addEventListener('mousedown', (e) => {
        if (e.button === 0 || e.button === 1) { // Left or middle click
          this.isDragging = true;
          this.dragStartX = e.clientX - this.panX;
          this.dragStartY = e.clientY - this.panY;
          this.canvas.style.cursor = 'grabbing';
        }
      });

      // Mouse move -> pan or coordinates update
      window.addEventListener('mousemove', (e) => {
        if (this.isDragging) {
          this.panX = e.clientX - this.dragStartX;
          this.panY = e.clientY - this.dragStartY;
          this.render();
        }
      });

      // Mouse up -> end pan
      window.addEventListener('mouseup', () => {
        if (this.isDragging) {
          this.isDragging = false;
          this.canvas.style.cursor = 'crosshair';
        }
      });

      // Wheel zoom towards cursor (supports deep zoom in up to 50,000 px/unit)
      this.canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Coordinates in CNC space before zoom
        const cncX = (mouseX - this.panX) / this.zoom;
        const cncY = -(mouseY - this.panY) / this.zoom; // Y goes up

        const zoomFactor = e.deltaY < 0 ? 1.18 : (1 / 1.18);
        const newZoom = Math.max(0.05, Math.min(50000, this.zoom * zoomFactor));

        // Adjust pan to keep cnc coordinate under mouse
        this.zoom = newZoom;
        this.panX = mouseX - cncX * this.zoom;
        this.panY = mouseY + cncY * this.zoom;

        this.render();
      }, { passive: false });
    }

    /**
     * Convert CNC coordinates (Y up, units) to Canvas Screen coordinates (Y down, px)
     */
    toScreen(x, y) {
      return {
        x: this.panX + x * this.zoom,
        y: this.panY - y * this.zoom
      };
    }

    /**
     * Convert Screen coordinates to CNC coordinates
     */
    toCNC(screenX, screenY) {
      return {
        x: (screenX - this.panX) / this.zoom,
        y: -(screenY - this.panY) / this.zoom
      };
    }

    /**
     * Auto-fit view to current bounding box
     */
    fitToView() {
      if (!this.bounds || this.bounds.width <= 0 || this.bounds.height <= 0) {
        this.panX = this.width * 0.5;
        this.panY = this.height * 0.5;
        this.zoom = this.units === 'standard' ? 100 : 4;
        this.render();
        return;
      }

      const padding = 60; // px
      const availW = Math.max(100, this.width - padding * 2);
      const availH = Math.max(100, this.height - padding * 2);

      const bW = Math.max(0.1, this.bounds.width);
      const bH = Math.max(0.1, this.bounds.height);

      const zoomX = availW / bW;
      const zoomY = availH / bH;
      const maxZoomCap = this.units === 'standard' ? 1200 : 50;
      this.zoom = Math.min(zoomX, zoomY, maxZoomCap);

      // Center the design in the viewport
      const centerCNCX = (this.bounds.minX + this.bounds.maxX) / 2;
      const centerCNCY = (this.bounds.minY + this.bounds.maxY) / 2;

      this.panX = this.width / 2 - centerCNCX * this.zoom;
      this.panY = this.height / 2 + centerCNCY * this.zoom;

      this.render();
    }

    /**
     * Update data and recalculate simulation geometry
     */
    setData({ imageElement, imageTransform, toolpaths, bounds, units, cutFeedrate, rapidFeedrate }) {
      if (imageElement !== undefined) this.imageElement = imageElement;
      if (imageTransform !== undefined) this.imageTransform = imageTransform;
      if (bounds !== undefined) this.bounds = bounds;
      if (units !== undefined) this.units = units;
      if (cutFeedrate !== undefined) this.cutFeedrate = cutFeedrate;
      if (rapidFeedrate !== undefined) this.rapidFeedrate = rapidFeedrate;
      if (toolpaths !== undefined) {
        this.toolpaths = toolpaths;
      }
      if (toolpaths !== undefined || cutFeedrate !== undefined || rapidFeedrate !== undefined) {
        this.prepareSimulationStrokes();
      }

      this.render();
    }

    prepareSimulationStrokes() {
      this.flattenedStrokes = [];
      let totalDist = 0;
      let totalTime = 0;
      let curX = 0, curY = 0;

      const cutRatePerSec = Math.max(1e-4, (this.cutFeedrate || 40) / 60);
      const rapidRatePerSec = Math.max(1e-4, (this.rapidFeedrate || 120) / 60);
      const pierceDelaySec = 0.05;

      for (let i = 0; i < this.toolpaths.length; i++) {
        const path = this.toolpaths[i];
        if (!path || path.length < 2) continue;

        // Rapid move to start
        const start = path.isCircle ? { x: path.cx - path.r, y: path.cy } : path[0];
        const rapidDist = Math.hypot(start.x - curX, start.y - curY);
        if (rapidDist > 1e-4) {
          const dur = rapidDist / rapidRatePerSec;
          this.flattenedStrokes.push({
            type: 'rapid',
            p1: { x: curX, y: curY },
            p2: { x: start.x, y: start.y },
            dist: rapidDist,
            cumDist: totalDist,
            duration: dur,
            cumTime: totalTime,
            gcodeLineIdx: path.rapidLineIdx !== undefined ? path.rapidLineIdx : 0
          });
          totalDist += rapidDist;
          totalTime += dur;
          curX = start.x;
          curY = start.y;
        }

        let addedPierce = false;

        // True CNC circle
        if (path.isCircle) {
          const half = Math.floor(path.length / 2);
          for (let j = 1; j < path.length; j++) {
            const pt = path[j];
            const cutDist = Math.hypot(pt.x - curX, pt.y - curY);
            if (cutDist > 1e-4) {
              const dur = (cutDist / cutRatePerSec) + (!addedPierce ? pierceDelaySec : 0);
              addedPierce = true;
              const lineIdx = j <= half ? (path.arc1LineIdx !== undefined ? path.arc1LineIdx : path.cutLineIdx) : (path.arc2LineIdx !== undefined ? path.arc2LineIdx : path.cutLineIdx);
              this.flattenedStrokes.push({
                type: 'cut',
                p1: { x: curX, y: curY },
                p2: { x: pt.x, y: pt.y },
                power: path.power !== undefined ? path.power : 100,
                dist: cutDist,
                cumDist: totalDist,
                duration: dur,
                cumTime: totalTime,
                gcodeLineIdx: lineIdx !== undefined ? lineIdx : 0
              });
              totalDist += cutDist;
              totalTime += dur;
              curX = pt.x;
              curY = pt.y;
            }
          }
          continue;
        }

        // Cut moves
        for (let j = 1; j < path.length; j++) {
          const pt = path[j];
          const cutDist = Math.hypot(pt.x - curX, pt.y - curY);
          if (cutDist > 1e-4) {
            const dur = (cutDist / cutRatePerSec) + (!addedPierce ? pierceDelaySec : 0);
            addedPierce = true;
            this.flattenedStrokes.push({
              type: 'cut',
              p1: { x: curX, y: curY },
              p2: { x: pt.x, y: pt.y },
              power: pt.power !== undefined ? pt.power : (path.power !== undefined ? path.power : 100),
              dist: cutDist,
              cumDist: totalDist,
              duration: dur,
              cumTime: totalTime,
              gcodeLineIdx: pt.gcodeLineIdx !== undefined ? pt.gcodeLineIdx : (path.cutLineIdx !== undefined ? path.cutLineIdx : 0)
            });
            totalDist += cutDist;
            totalTime += dur;
            curX = pt.x;
            curY = pt.y;
          }
        }
      }

      this.totalCutDistance = totalDist;
      this.totalSimTime = Math.max(0.001, totalTime);
    }

    getActiveStroke(progress) {
      if (!this.flattenedStrokes.length) return null;
      const targetTime = progress * this.totalSimTime;
      for (const stroke of this.flattenedStrokes) {
        if (targetTime >= stroke.cumTime && targetTime <= stroke.cumTime + stroke.duration) {
          return stroke;
        }
      }
      return this.flattenedStrokes[this.flattenedStrokes.length - 1];
    }

    /**
     * Set Layer controls
     */
    setImageVisibility(show) {
      this.showImage = show;
      this.render();
    }

    setImageOpacity(opacity) {
      this.imageOpacity = Math.max(0, Math.min(1, opacity));
      this.render();
    }

    setToolpathVisibility(show) {
      this.showToolpaths = show;
      this.render();
    }

    setRapidsVisibility(show) {
      this.showRapids = show;
      this.render();
    }

    /**
     * Laser simulation controls
     */
    startSimulation(onProgress) {
      this.onSimProgressCallback = onProgress;
      this.isSimulating = true;
      let lastTime = performance.now();

      const loop = (now) => {
        if (!this.isSimulating) return;
        const dt = (now - lastTime) / 1000;
        lastTime = now;

        // Advance simulation in exact proportion to physical runtime (1x = real-time estimated duration)
        const totalDurationSec = Math.max(0.1, this.totalSimTime);
        this.simProgress += (dt * this.simSpeed) / totalDurationSec;

        if (this.simProgress >= 1.0) {
          this.simProgress = 1.0;
          this.isSimulating = false;
          const lastStroke = this.getActiveStroke(1.0);
          const lastLineIdx = lastStroke ? lastStroke.gcodeLineIdx : 0;
          if (this.onSimProgressCallback) this.onSimProgressCallback(1.0, false, lastLineIdx);
          this.render();
          return;
        }

        const activeStroke = this.getActiveStroke(this.simProgress);
        const lineIdx = activeStroke ? activeStroke.gcodeLineIdx : 0;
        if (this.onSimProgressCallback) this.onSimProgressCallback(this.simProgress, true, lineIdx);
        this.render();
        this.simAnimFrame = requestAnimationFrame(loop);
      };

      this.simAnimFrame = requestAnimationFrame(loop);
    }

    pauseSimulation() {
      this.isSimulating = false;
      if (this.simAnimFrame) {
        cancelAnimationFrame(this.simAnimFrame);
        this.simAnimFrame = null;
      }
      this.render();
    }

    setSimulationProgress(p) {
      this.simProgress = Math.max(0, Math.min(1, p));
      this.render();
      const activeStroke = this.getActiveStroke(this.simProgress);
      return activeStroke ? activeStroke.gcodeLineIdx : 0;
    }

    setSimulationSpeed(speed) {
      this.simSpeed = speed;
    }

    /**
     * Main Render Loop
     */
    render() {
      const ctx = this.ctx;
      const w = this.width;
      const h = this.height;
      const pal = this.getPalette();

      // 1. Clear background
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, w, h);

      // 2. Draw CNC Grid and Coordinates
      if (this.showGrid) {
        this.drawGrid(ctx, w, h, pal);
      }

      // 3. Draw Machine Origin (0,0) and axes
      if (this.showOrigin) {
        this.drawOrigin(ctx);
      }

      // 4. Draw Original Image Layer (if enabled and opacity > 0)
      if (this.showImage && this.imageOpacity > 0 && this.imageElement && this.imageTransform) {
        this.drawImageLayer(ctx);
      }

      // 5. Draw Toolpath Layer (if enabled)
      if (this.showToolpaths && this.toolpaths.length > 0) {
        this.drawToolpathLayer(ctx, pal);
      }

      // 6. Draw Simulation Head (if active or progress > 0)
      if (this.flattenedStrokes.length > 0 && (this.isSimulating || this.simProgress > 0)) {
        this.drawSimulationHead(ctx, pal);
      }

      // 7. Draw Rulers along top & left
      this.drawRulers(ctx, w, h, pal);
    }

    /**
     * Choose adaptive grid step so major grid lines stay ~50-160px apart at any zoom
     */
    getAdaptiveStep() {
      const targetPx = 90;
      const idealStep = targetPx / this.zoom;
      const steps = this.units === 'standard'
        ? [10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001]
        : [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];

      let chosen = steps[steps.length - 1];
      for (const s of steps) {
        if (s * this.zoom >= 45) {
          chosen = s;
        }
      }
      return chosen;
    }

    drawGrid(ctx, w, h, pal) {
      const rawStep = this.getAdaptiveStep();
      const stepPx = rawStep * this.zoom;
      const subDivs = 5;
      const subStep = rawStep / subDivs;
      const subStepPx = stepPx / subDivs;

      // Determine visible CNC bounds
      const minCNC = this.toCNC(0, h);
      const maxCNC = this.toCNC(w, 0);

      const startX = Math.floor(minCNC.x / rawStep) * rawStep;
      const endX = Math.ceil(maxCNC.x / rawStep) * rawStep;
      const startY = Math.floor(minCNC.y / rawStep) * rawStep;
      const endY = Math.ceil(maxCNC.y / rawStep) * rawStep;

      // Draw minor grid
      if (subStepPx > 8) {
        ctx.strokeStyle = pal.minorGrid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = startX; x <= endX + subStep * 0.5; x += subStep) {
          const s = this.toScreen(x, 0);
          ctx.moveTo(Math.round(s.x) + 0.5, 0);
          ctx.lineTo(Math.round(s.x) + 0.5, h);
        }
        for (let y = startY; y <= endY + subStep * 0.5; y += subStep) {
          const s = this.toScreen(0, y);
          ctx.moveTo(0, Math.round(s.y) + 0.5);
          ctx.lineTo(w, Math.round(s.y) + 0.5);
        }
        ctx.stroke();
      }

      // Draw major grid
      ctx.strokeStyle = pal.majorGrid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = startX; x <= endX + rawStep * 0.5; x += rawStep) {
        const s = this.toScreen(x, 0);
        ctx.moveTo(Math.round(s.x) + 0.5, 0);
        ctx.lineTo(Math.round(s.x) + 0.5, h);
      }
      for (let y = startY; y <= endY + rawStep * 0.5; y += rawStep) {
        const s = this.toScreen(0, y);
        ctx.moveTo(0, Math.round(s.y) + 0.5);
        ctx.lineTo(w, Math.round(s.y) + 0.5);
      }
      ctx.stroke();
    }

    drawOrigin(ctx) {
      const o = this.toScreen(0, 0);
      const axisLen = 50; // px

      ctx.save();
      ctx.lineWidth = 2;

      // X Axis (Red)
      ctx.strokeStyle = '#ef4444';
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(o.x + axisLen, o.y);
      ctx.stroke();
      // Arrowhead X
      ctx.beginPath();
      ctx.moveTo(o.x + axisLen, o.y);
      ctx.lineTo(o.x + axisLen - 8, o.y - 4);
      ctx.lineTo(o.x + axisLen - 8, o.y + 4);
      ctx.fill();

      // Y Axis (Green)
      ctx.strokeStyle = '#22c55e';
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(o.x, o.y - axisLen);
      ctx.stroke();
      // Arrowhead Y
      ctx.beginPath();
      ctx.moveTo(o.x, o.y - axisLen);
      ctx.lineTo(o.x - 4, o.y - axisLen + 8);
      ctx.lineTo(o.x + 4, o.y - axisLen + 8);
      ctx.fill();

      // Labels + Origin circle
      ctx.font = '10px monospace';
      ctx.fillStyle = '#ef4444';
      ctx.fillText('+X', o.x + axisLen + 4, o.y + 4);
      ctx.fillStyle = '#22c55e';
      ctx.fillText('+Y', o.x - 6, o.y - axisLen - 6);

      ctx.strokeStyle = '#ffffff';
      ctx.fillStyle = '#1e293b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(o.x, o.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.restore();
    }

    drawImageLayer(ctx) {
      const t = this.imageTransform;
      const img = this.imageElement;
      if (!t || !img) return;

      ctx.save();
      ctx.globalAlpha = this.imageOpacity;

      // Center of design in screen coords
      const centerScreen = this.toScreen(t.centerX, t.centerY);

      ctx.translate(centerScreen.x, centerScreen.y);
      // Invert rotation because CNC Y is up while screen Y is down
      ctx.rotate((-t.rotation * Math.PI) / 180);
      ctx.scale(t.flipH ? -1 : 1, t.flipV ? -1 : 1);

      const renderW = t.width * this.zoom;
      const renderH = t.height * this.zoom;

      ctx.drawImage(img, -renderW / 2, -renderH / 2, renderW, renderH);

      // Bounding box dashed border
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(-renderW / 2, -renderH / 2, renderW, renderH);

      ctx.restore();
    }

    drawToolpathLayer(ctx, pal) {
      ctx.save();

      // 1. Draw Rapid Moves (Laser OFF) in dashed cyan/accent
      if (this.showRapids && this.toolpaths.length > 1) {
        ctx.strokeStyle = pal.rapidStroke;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();

        let curPos = { x: 0, y: 0 };
        for (let i = 0; i < this.toolpaths.length; i++) {
          const path = this.toolpaths[i];
          if (!path || path.length < 2) continue;
          const s = this.toScreen(curPos.x, curPos.y);
          const e = this.toScreen(path[0].x, path[0].y);

          ctx.moveTo(s.x, s.y);
          ctx.lineTo(e.x, e.y);

          curPos = path[path.length - 1];
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 2. Draw Laser Cut Moves (Laser ON) in theme-accent glow
      let totalSegments = 0;
      for (const path of this.toolpaths) {
        if (path && path.length >= 2) totalSegments += (path.length - 1);
      }
      const isDenseRaster = this.toolpaths.length > 400 || totalSegments > 1500;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (isDenseRaster) {
        // High-density raster scanlines: render power-modulated segments cleanly
        ctx.shadowBlur = 0;
        ctx.lineWidth = Math.max(1.0, Math.min(2.5, this.zoom * 0.012));
        ctx.strokeStyle = pal.cutStroke;
        for (const path of this.toolpaths) {
          if (!path || path.length < 2) continue;
          let prev = this.toScreen(path[0].x, path[0].y);
          for (let i = 1; i < path.length; i++) {
            const pt = this.toScreen(path[i].x, path[i].y);
            const pwr = path[i].power !== undefined ? path[i].power : (path[0].power !== undefined ? path[0].power : 100);
            ctx.globalAlpha = Math.max(0.14, Math.min(1.0, pwr / 100));
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(pt.x, pt.y);
            ctx.stroke();
            prev = pt;
          }
        }
        ctx.globalAlpha = 1.0;
      } else {
        // Vector / moderate toolpaths: full double-pass laser glow + core (with per-path power support)
        const glowWidth = Math.max(1.5, Math.min(3.5, this.zoom * 0.02));
        for (const path of this.toolpaths) {
          if (!path || path.length < 2) continue;
          const pwr = path.power !== undefined ? path.power : (path[0].power !== undefined ? path[0].power : 100);
          const alpha = 0.25 + 0.75 * (Math.max(1, Math.min(100, pwr)) / 100);
          ctx.globalAlpha = alpha;

          // Glow pass
          ctx.shadowColor = pal.cutGlow;
          ctx.shadowBlur = 6;
          ctx.strokeStyle = pal.cutStroke;
          ctx.lineWidth = glowWidth;
          ctx.beginPath();
          if (path.isCircle) {
            const c = this.toScreen(path.cx, path.cy);
            const r = path.r * this.zoom;
            ctx.moveTo(c.x + r, c.y);
            ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
          } else {
            const start = this.toScreen(path[0].x, path[0].y);
            ctx.moveTo(start.x, start.y);
            for (let i = 1; i < path.length; i++) {
              const pt = this.toScreen(path[i].x, path[i].y);
              ctx.lineTo(pt.x, pt.y);
            }
          }
          ctx.stroke();

          // Sharp core pass
          ctx.shadowBlur = 0;
          ctx.strokeStyle = pal.cutCore;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.globalAlpha = 1.0;

        // 3. Draw start/end pierce points for vector paths
        ctx.fillStyle = pal.pierceDot;
        for (let i = 0; i < this.toolpaths.length; i++) {
          const path = this.toolpaths[i];
          if (!path || path.length < 2) continue;
          const pt = path.isCircle ? this.toScreen(path.cx - path.r, path.cy) : this.toScreen(path[0].x, path[0].y);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();
    }

    drawSimulationHead(ctx, pal) {
      if (!this.flattenedStrokes.length) return;

      const targetTime = this.simProgress * this.totalSimTime;
      let curStroke = this.flattenedStrokes[0];
      let headPos = curStroke.p1;
      let isLaserOn = curStroke.type === 'cut';

      for (const stroke of this.flattenedStrokes) {
        if (targetTime >= stroke.cumTime && targetTime <= stroke.cumTime + stroke.duration) {
          curStroke = stroke;
          const strokeProgress = stroke.duration > 0 ? (targetTime - stroke.cumTime) / stroke.duration : 0;
          headPos = {
            x: stroke.p1.x + (stroke.p2.x - stroke.p1.x) * strokeProgress,
            y: stroke.p1.y + (stroke.p2.y - stroke.p1.y) * strokeProgress
          };
          isLaserOn = stroke.type === 'cut';
          break;
        }
      }

      const screenPt = this.toScreen(headPos.x, headPos.y);

      ctx.save();

      // If laser is ON, draw intense laser beam dot and burn circle
      if (isLaserOn) {
        const grad = ctx.createRadialGradient(screenPt.x, screenPt.y, 1, screenPt.x, screenPt.y, 14);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.3, pal.simGlowMid);
        grad.addColorStop(0.7, pal.simGlowOuter);
        grad.addColorStop(1, pal.simGlowZero);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(screenPt.x, screenPt.y, 14, 0, Math.PI * 2);
        ctx.fill();
      }

      // Reticle / Laser Head Crosshair
      ctx.strokeStyle = isLaserOn ? pal.simReticleOn : pal.simReticleOff;
      ctx.lineWidth = 1.5;

      // Outer ring
      ctx.beginPath();
      ctx.arc(screenPt.x, screenPt.y, 8, 0, Math.PI * 2);
      ctx.stroke();

      // Crosshairs
      ctx.beginPath();
      ctx.moveTo(screenPt.x - 12, screenPt.y);
      ctx.lineTo(screenPt.x - 4, screenPt.y);
      ctx.moveTo(screenPt.x + 4, screenPt.y);
      ctx.lineTo(screenPt.x + 12, screenPt.y);

      ctx.moveTo(screenPt.x, screenPt.y - 12);
      ctx.lineTo(screenPt.x, screenPt.y - 4);
      ctx.moveTo(screenPt.x, screenPt.y + 4);
      ctx.lineTo(screenPt.x, screenPt.y + 12);
      ctx.stroke();

      ctx.restore();
    }

    drawRulers(ctx, w, h, pal) {
      const rulerSize = 22; // px
      const unit = this.units;
      const unitLabel = unit === 'standard' ? 'in' : 'mm';

      // Ruler backgrounds
      ctx.fillStyle = pal.rulerBg;
      ctx.fillRect(0, 0, w, rulerSize);
      ctx.fillRect(0, 0, rulerSize, h);

      // Border lines
      ctx.strokeStyle = pal.rulerBorder;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, rulerSize + 0.5);
      ctx.lineTo(w, rulerSize + 0.5);
      ctx.moveTo(rulerSize + 0.5, 0);
      ctx.lineTo(rulerSize + 0.5, h);
      ctx.stroke();

      // Corner label
      ctx.fillStyle = pal.unitCorner;
      ctx.font = 'bold 9px monospace';
      ctx.fillText(unitLabel, 4, 15);

      const step = this.getAdaptiveStep();
      const decimals = step < 0.01 ? 3 : (step < 0.1 ? 2 : (step < 1 ? 1 : 0));

      ctx.fillStyle = pal.rulerText;
      ctx.font = '8px monospace';
      ctx.strokeStyle = pal.rulerTick;

      const minCNC = this.toCNC(0, h);
      const maxCNC = this.toCNC(w, 0);

      // Top X Ruler
      const startX = Math.floor(minCNC.x / step) * step;
      const endX = Math.ceil(maxCNC.x / step) * step;

      ctx.beginPath();
      for (let x = startX; x <= endX + step * 0.5; x += step) {
        const s = this.toScreen(x, 0);
        if (s.x > rulerSize) {
          ctx.moveTo(s.x, rulerSize - 8);
          ctx.lineTo(s.x, rulerSize);
          const cleanVal = Math.abs(x) < 1e-9 ? 0 : x;
          ctx.fillText(Number(cleanVal).toFixed(decimals), s.x + 2, rulerSize - 10);
        }
      }
      ctx.stroke();

      // Left Y Ruler
      const startY = Math.floor(minCNC.y / step) * step;
      const endY = Math.ceil(maxCNC.y / step) * step;

      ctx.beginPath();
      for (let y = startY; y <= endY + step * 0.5; y += step) {
        const s = this.toScreen(0, y);
        if (s.y > rulerSize) {
          ctx.moveTo(rulerSize - 8, s.y);
          ctx.lineTo(rulerSize, s.y);
          ctx.save();
          ctx.translate(rulerSize - 10, s.y + 3);
          ctx.rotate(-Math.PI / 2);
          const cleanVal = Math.abs(y) < 1e-9 ? 0 : y;
          ctx.fillText(Number(cleanVal).toFixed(decimals), 0, 0);
          ctx.restore();
        }
      }
      ctx.stroke();
    }
  }

  return { Viewer };
})();
