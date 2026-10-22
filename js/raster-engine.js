/**
 * Dangerous Laser - Raster Image Processing Engine
 * Converts raster images (PNG, JPEG, WebP, BMP) into laser toolpaths:
 * - Scanline Dithering (Floyd-Steinberg, Atkinson, Threshold)
 * - Variable Power PWM Grayscale Scanline
 * - Vector Outline Trace (Contour boundary extraction)
 */

const RasterEngine = (function() {
  'use strict';

  /**
   * Process raw image element onto canvas and get processed grayscale / dithered data
   */
  function processImageData(img, options) {
    const {
      targetWidthPx,
      targetHeightPx,
      brightness = 0,    // -100 to 100
      contrast = 0,      // -100 to 100
      invert = false,
      mode = 'grayscale', // 'grayscale' (default), 'dither', 'threshold', 'contour'
      ditherAlgo = 'floyd-steinberg', // 'floyd-steinberg', 'atkinson', 'threshold'
      thresholdVal = 128 // 0 to 255
    } = options;

    const canvas = document.createElement('canvas');
    canvas.width = targetWidthPx;
    canvas.height = targetHeightPx;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Fill white background (handles transparent PNGs)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetWidthPx, targetHeightPx);

    // Draw image scaled
    ctx.drawImage(img, 0, 0, targetWidthPx, targetHeightPx);

    const imgData = ctx.getImageData(0, 0, targetWidthPx, targetHeightPx);
    const data = imgData.data;
    const width = targetWidthPx;
    const height = targetHeightPx;

    // 1. Grayscale, Brightness, Contrast, Invert
    // Contrast factor: F = (259 * (C + 255)) / (255 * (259 - C))
    const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast) || 1);
    const grayBuffer = new Float32Array(width * height);

    for (let i = 0; i < data.length; i += 4) {
      // Standard luminance
      let gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

      // Brightness (-100 to 100) -> -255 to 255
      gray += (brightness * 2.55);

      // Contrast
      gray = contrastFactor * (gray - 128) + 128;

      // Clamp
      gray = Math.max(0, Math.min(255, gray));

      // Invert
      if (invert) {
        gray = 255 - gray;
      }

      grayBuffer[i / 4] = gray;
    }

    // 2. Binary buffer for dithered/thresholded modes (0 = black/laser on, 1 = white/laser off)
    const binaryBuffer = new Uint8Array(width * height);

    if (mode === 'dither') {
      // Clone for error diffusion
      const diff = new Float32Array(grayBuffer);

      if (ditherAlgo === 'atkinson') {
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const oldVal = diff[idx];
            const newVal = oldVal < thresholdVal ? 0 : 255;
            binaryBuffer[idx] = newVal === 0 ? 0 : 1;
            const err = (oldVal - newVal) / 8;

            if (x + 1 < width) diff[idx + 1] += err;
            if (x + 2 < width) diff[idx + 2] += err;
            if (y + 1 < height) {
              if (x - 1 >= 0) diff[idx + width - 1] += err;
              diff[idx + width] += err;
              if (x + 1 < width) diff[idx + width + 1] += err;
            }
            if (y + 2 < height) {
              diff[idx + 2 * width] += err;
            }
          }
        }
      } else if (ditherAlgo === 'threshold') {
        for (let i = 0; i < grayBuffer.length; i++) {
          binaryBuffer[i] = grayBuffer[i] < thresholdVal ? 0 : 1;
        }
      } else {
        // Floyd-Steinberg default
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const oldVal = diff[idx];
            const newVal = oldVal < thresholdVal ? 0 : 255;
            binaryBuffer[idx] = newVal === 0 ? 0 : 1;
            const err = oldVal - newVal;

            if (x + 1 < width) diff[idx + 1] += err * (7 / 16);
            if (y + 1 < height) {
              if (x - 1 >= 0) diff[idx + width - 1] += err * (3 / 16);
              diff[idx + width] += err * (5 / 16);
              if (x + 1 < width) diff[idx + width + 1] += err * (1 / 16);
            }
          }
        }
      }
    } else if (mode === 'threshold' || mode === 'contour') {
      for (let i = 0; i < grayBuffer.length; i++) {
        binaryBuffer[i] = grayBuffer[i] < thresholdVal ? 0 : 1;
      }
    }

    // Render back to canvas for visual preview of processed raster
    const previewImgData = ctx.createImageData(width, height);
    const pData = previewImgData.data;

    if (mode === 'grayscale') {
      for (let i = 0; i < grayBuffer.length; i++) {
        const v = Math.round(grayBuffer[i]);
        const pi = i * 4;
        pData[pi] = v;
        pData[pi + 1] = v;
        pData[pi + 2] = v;
        pData[pi + 3] = 255;
      }
    } else {
      for (let i = 0; i < binaryBuffer.length; i++) {
        const v = binaryBuffer[i] === 0 ? 0 : 255;
        const pi = i * 4;
        pData[pi] = v;
        pData[pi + 1] = v;
        pData[pi + 2] = v;
        pData[pi + 3] = 255;
      }
    }

    ctx.putImageData(previewImgData, 0, 0);

    return {
      canvas,
      width,
      height,
      grayBuffer,
      binaryBuffer
    };
  }

  /**
   * Generate scanline segments from dithered/thresholded binary buffer
   * Groups contiguous burn pixels into continuous laser strokes to minimize G-code size
   */
  function generateDitherScanlines(binaryBuffer, width, height, targetPhysicalWidth, targetPhysicalHeight, options = {}) {
    const {
      bidirectional = true, // zig-zag
      maxPower = 100,
      overscan = 0 // lead-in/lead-out in physical units
    } = options;

    const pixelWidth = targetPhysicalWidth / width;
    const pixelHeight = targetPhysicalHeight / height;

    const strokes = []; // Array of { isLaser: boolean, p1: {x,y}, p2: {x,y}, power: number }

    for (let y = 0; y < height; y++) {
      // Standard image coordinate (y=0 is top, y=height-1 is bottom)
      const physicalY = (y + 0.5) * pixelHeight;
      const isReverse = bidirectional && (y % 2 === 1);

      let inBurn = false;
      let burnStartX = 0;

      const startX = isReverse ? width - 1 : 0;
      const endX = isReverse ? -1 : width;
      const stepX = isReverse ? -1 : 1;

      for (let x = startX; x !== endX; x += stepX) {
        const idx = y * width + x;
        const isBlack = (binaryBuffer[idx] === 0);

        if (isBlack) {
          if (!inBurn) {
            inBurn = true;
            burnStartX = x;
          }
        } else {
          if (inBurn) {
            // End of burn run
            const burnEndX = x - stepX;
            const x1 = isReverse ? (burnStartX + 0.5) * pixelWidth : (burnStartX - 0.5) * pixelWidth;
            const x2 = isReverse ? (burnEndX - 0.5) * pixelWidth : (burnEndX + 0.5) * pixelWidth;

            strokes.push({
              power: maxPower,
              p1: { x: Math.max(0, Math.min(targetPhysicalWidth, x1)), y: physicalY },
              p2: { x: Math.max(0, Math.min(targetPhysicalWidth, x2)), y: physicalY }
            });
            inBurn = false;
          }
        }
      }

      // If line ended while burning
      if (inBurn) {
        const burnEndX = isReverse ? 0 : width - 1;
        const x1 = isReverse ? (burnStartX + 0.5) * pixelWidth : (burnStartX - 0.5) * pixelWidth;
        const x2 = isReverse ? 0 : targetPhysicalWidth;
        strokes.push({
          power: maxPower,
          p1: { x: Math.max(0, Math.min(targetPhysicalWidth, x1)), y: physicalY },
          p2: { x: Math.max(0, Math.min(targetPhysicalWidth, x2)), y: physicalY }
        });
      }
    }

    return strokes;
  }

  /**
   * Generate variable-power PWM scanlines for grayscale engraving.
   * Chains contiguous non-zero pixels along each scanline into continuous multi-segment paths
   * so the laser modulates PWM power (Sxxx) inline during G1 moves without unnecessary M5/M3 stops.
   */
  function generateGrayscaleScanlines(grayBuffer, width, height, targetPhysicalWidth, targetPhysicalHeight, options = {}) {
    const {
      bidirectional = true,
      minPower = 0,
      maxPower = 100,
      powerTolerance = 2 // merge adjacent pixels if power delta <= tolerance
    } = options;

    const pixelWidth = targetPhysicalWidth / width;
    const pixelHeight = targetPhysicalHeight / height;

    const paths = []; // Array of continuous scanline paths: [{x, y, power}, ...]

    for (let y = 0; y < height; y++) {
      const physicalY = (y + 0.5) * pixelHeight;
      const isReverse = bidirectional && (y % 2 === 1);

      const startX = isReverse ? width - 1 : 0;
      const endX = isReverse ? -1 : width;
      const stepX = isReverse ? -1 : 1;

      let activePath = null;
      let runPower = 0;
      let runEndX = 0;

      for (let x = startX; x !== endX; x += stepX) {
        const idx = y * width + x;
        const gray = grayBuffer[idx]; // 0 (black) to 255 (white)
        // 0 -> maxPower, 255 -> minPower
        const darkness = (255 - gray) / 255;
        const power = Math.round(minPower + darkness * (maxPower - minPower));

        const xLeading = isReverse ? (x + 1) * pixelWidth : x * pixelWidth;
        const xTrailing = isReverse ? x * pixelWidth : (x + 1) * pixelWidth;

        if (power <= 0) {
          // White pixel / laser off -> finish current contiguous scanline path
          if (activePath) {
            activePath.push({ x: runEndX, y: physicalY, power: runPower });
            paths.push(activePath);
            activePath = null;
          }
        } else {
          if (!activePath) {
            activePath = [{ x: xLeading, y: physicalY, power: power }];
            runPower = power;
            runEndX = xTrailing;
          } else if (Math.abs(runPower - power) > powerTolerance) {
            // Power level changed -> commit previous segment endpoint and continue path with new power
            activePath.push({ x: xLeading, y: physicalY, power: runPower });
            runPower = power;
            runEndX = xTrailing;
          } else {
            // Same power within tolerance -> extend current segment
            runEndX = xTrailing;
          }
        }
      }

      if (activePath) {
        activePath.push({ x: runEndX, y: physicalY, power: runPower });
        paths.push(activePath);
      }
    }

    return paths;
  }

  /**
   * Vector Outline Extraction (Contour Tracing / Marching Squares)
   * Traces closed loops around black pixels from binary buffer
   */
  function traceContours(binaryBuffer, width, height, targetPhysicalWidth, targetPhysicalHeight) {
    const pixelWidth = targetPhysicalWidth / width;
    const pixelHeight = targetPhysicalHeight / height;

    // Boundary edge flags: horizontal edges and vertical edges
    // hEdges[y * width + x] = 1 if edge between (x, y-1) and (x, y)
    // vEdges[y * (width + 1) + x] = 1 if edge between (x-1, y) and (x, y)
    const isSolid = (x, y) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return false;
      return binaryBuffer[y * width + x] === 0; // 0 is black
    };

    const edgeSegments = [];

    // Find all boundary edges between solid and empty pixels
    for (let y = 0; y <= height; y++) {
      for (let x = 0; x <= width; x++) {
        // Horizontal edge between (x, y-1) and (x, y)
        if (x < width) {
          const top = isSolid(x, y - 1);
          const bottom = isSolid(x, y);
          if (top !== bottom) {
            edgeSegments.push({
              x1: x, y1: y,
              x2: x + 1, y2: y
            });
          }
        }
        // Vertical edge between (x-1, y) and (x, y)
        if (y < height) {
          const left = isSolid(x - 1, y);
          const right = isSolid(x, y);
          if (left !== right) {
            edgeSegments.push({
              x1: x, y1: y,
              x2: x, y2: y + 1
            });
          }
        }
      }
    }

    if (!edgeSegments.length) return [];

    // Chain segments into continuous paths
    const pointKey = (x, y) => `${x},${y}`;
    const adjMap = new Map();

    for (let i = 0; i < edgeSegments.length; i++) {
      const seg = edgeSegments[i];
      const k1 = pointKey(seg.x1, seg.y1);
      const k2 = pointKey(seg.x2, seg.y2);

      if (!adjMap.has(k1)) adjMap.set(k1, []);
      if (!adjMap.has(k2)) adjMap.set(k2, []);

      adjMap.get(k1).push({ x: seg.x2, y: seg.y2, used: false, segIdx: i });
      adjMap.get(k2).push({ x: seg.x1, y: seg.y1, used: false, segIdx: i });
    }

    const usedSegs = new Uint8Array(edgeSegments.length);
    const loops = [];

    for (let i = 0; i < edgeSegments.length; i++) {
      if (usedSegs[i]) continue;

      const path = [];
      let cur = { x: edgeSegments[i].x1, y: edgeSegments[i].y1 };
      path.push({ ...cur });

      let currentSegIdx = i;
      usedSegs[currentSegIdx] = 1;
      cur = { x: edgeSegments[i].x2, y: edgeSegments[i].y2 };
      path.push({ ...cur });

      let guard = 0;
      while (guard++ < edgeSegments.length * 2) {
        const k = pointKey(cur.x, cur.y);
        const neighbors = adjMap.get(k) || [];
        const nextEdge = neighbors.find(e => !usedSegs[e.segIdx]);

        if (!nextEdge) break;

        usedSegs[nextEdge.segIdx] = 1;
        cur = { x: nextEdge.x, y: nextEdge.y };
        path.push({ ...cur });

        // If loop closed
        if (cur.x === path[0].x && cur.y === path[0].y) {
          break;
        }
      }

      if (path.length >= 3) {
        // Simplify straight colinear segments to reduce point count
        const simplified = [path[0]];
        for (let j = 1; j < path.length - 1; j++) {
          const prev = simplified[simplified.length - 1];
          const curr = path[j];
          const next = path[j + 1];

          const dx1 = curr.x - prev.x;
          const dy1 = curr.y - prev.y;
          const dx2 = next.x - curr.x;
          const dy2 = next.y - curr.y;

          if (dx1 * dy2 !== dy1 * dx2) {
            simplified.push(curr);
          }
        }
        simplified.push(path[path.length - 1]);

        // Convert to physical coordinates (y=0 at top)
        const physicalPath = simplified.map(p => ({
          x: p.x * pixelWidth,
          y: p.y * pixelHeight
        }));

        loops.push(physicalPath);
      }
    }

    return loops;
  }

  return {
    processImageData,
    generateDitherScanlines,
    generateGrayscaleScanlines,
    traceContours
  };
})();
