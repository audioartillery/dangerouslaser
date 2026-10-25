/**
 * Dangerous Laser - SVG Parser & Vector Path Extractor
 * Fully self-contained, no external dependencies.
 * Converts SVG elements (path, rect, circle, ellipse, line, polyline, polygon)
 * into sequences of 2D line segments suitable for CNC laser toolpaths.
 */

const SVGParser = (function() {
  'use strict';

  // 2D Affine Matrix utilities [a, c, e; b, d, f; 0, 0, 1]
  const Matrix = {
    identity: () => [1, 0, 0, 1, 0, 0],
    multiply: (m1, m2) => [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ],
    translate: (tx, ty) => [1, 0, 0, 1, tx, ty],
    scale: (sx, sy) => [sx, 0, 0, sy, 0, 0],
    rotate: (rad) => {
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      return [cos, sin, -sin, cos, 0, 0];
    },
    skewX: (rad) => [1, 0, Math.tan(rad), 1, 0, 0],
    skewY: (rad) => [1, Math.tan(rad), 0, 1, 0, 0],
    transformPoint: (m, x, y) => ({
      x: m[0] * x + m[2] * y + m[4],
      y: m[1] * x + m[3] * y + m[5]
    })
  };

  /**
   * Parse SVG transform attribute string into a 2D affine matrix
   */
  function parseTransform(str) {
    if (!str || typeof str !== 'string') return Matrix.identity();
    let currentMatrix = Matrix.identity();

    const transformRegex = /([a-zA-Z]+)\s*\(([^)]+)\)/g;
    let match;

    while ((match = transformRegex.exec(str)) !== null) {
      const type = match[1].trim().toLowerCase();
      const args = match[2].trim().split(/[\s,]+/).map(parseFloat);

      let step = Matrix.identity();
      if (type === 'matrix' && args.length === 6) {
        step = args;
      } else if (type === 'translate') {
        step = Matrix.translate(args[0] || 0, args[1] || 0);
      } else if (type === 'scale') {
        step = Matrix.scale(args[0] || 1, args[1] !== undefined ? args[1] : (args[0] || 1));
      } else if (type === 'rotate') {
        const rad = ((args[0] || 0) * Math.PI) / 180;
        if (args.length >= 3) {
          const cx = args[1];
          const cy = args[2];
          const t1 = Matrix.translate(cx, cy);
          const r = Matrix.rotate(rad);
          const t2 = Matrix.translate(-cx, -cy);
          step = Matrix.multiply(t1, Matrix.multiply(r, t2));
        } else {
          step = Matrix.rotate(rad);
        }
      } else if (type === 'skewx') {
        step = Matrix.skewX(((args[0] || 0) * Math.PI) / 180);
      } else if (type === 'skewy') {
        step = Matrix.skewY(((args[0] || 0) * Math.PI) / 180);
      }
      currentMatrix = Matrix.multiply(currentMatrix, step);
    }
    return currentMatrix;
  }

  /**
   * Convert length with units to pixels/internal units (assuming 96 DPI CSS standard)
   */
  function parseLength(val, defaultVal = 0) {
    if (val === null || val === undefined || val === '') return defaultVal;
    if (typeof val === 'number') return val;
    val = String(val).trim();
    const num = parseFloat(val);
    if (isNaN(num)) return defaultVal;

    if (val.endsWith('mm')) return (num * 96) / 25.4;
    if (val.endsWith('cm')) return (num * 10 * 96) / 25.4;
    if (val.endsWith('in')) return num * 96;
    if (val.endsWith('pt')) return (num * 96) / 72;
    if (val.endsWith('pc')) return (num * 96 * 12) / 72;
    return num; // Default px
  }

  /**
   * Robust SVG Path Data Tokenizer
   */
  function tokenizePathData(d) {
    if (!d) return [];
    const tokens = [];
    // Match commands or numbers (including scientific notation e.g. -1.2e-4)
    const regex = /([a-df-z])|([-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)/gi;
    let match;
    while ((match = regex.exec(d)) !== null) {
      if (match[1]) {
        tokens.push({ type: 'cmd', val: match[1] });
      } else if (match[2]) {
        tokens.push({ type: 'num', val: parseFloat(match[2]) });
      }
    }
    return tokens;
  }

  /**
   * De Casteljau subdivision for Cubic Bézier
   */
  function subdivideCubicBezier(p0, p1, p2, p3, tolerance = 0.2, maxDepth = 8) {
    const points = [];

    function recurse(p0, p1, p2, p3, depth) {
      // Distance from p1 and p2 to chord p0->p3
      const dx = p3.x - p0.x;
      const dy = p3.y - p0.y;
      const lenSq = dx * dx + dy * dy;

      let d1 = 0, d2 = 0;
      if (lenSq > 1e-6) {
        d1 = Math.abs((p1.y - p0.y) * dx - (p1.x - p0.x) * dy) / Math.sqrt(lenSq);
        d2 = Math.abs((p2.y - p0.y) * dx - (p2.x - p0.x) * dy) / Math.sqrt(lenSq);
      } else {
        d1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        d2 = Math.hypot(p2.x - p0.x, p2.y - p0.y);
      }

      if ((d1 + d2 <= tolerance) || depth >= maxDepth) {
        points.push(p3);
        return;
      }

      // Midpoints
      const m01 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      const m12 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const m23 = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };

      const m012 = { x: (m01.x + m12.x) / 2, y: (m01.y + m12.y) / 2 };
      const m123 = { x: (m12.x + m23.x) / 2, y: (m12.y + m23.y) / 2 };

      const m0123 = { x: (m012.x + m123.x) / 2, y: (m012.y + m123.y) / 2 };

      recurse(p0, m01, m012, m0123, depth + 1);
      recurse(m0123, m123, m23, p3, depth + 1);
    }

    recurse(p0, p1, p2, p3, 0);
    return points;
  }

  /**
   * Quadratic Bézier to Cubic conversion
   */
  function quadToCubic(p0, p1, p2) {
    return [
      p0,
      { x: p0.x + (2 / 3) * (p1.x - p0.x), y: p0.y + (2 / 3) * (p1.y - p0.y) },
      { x: p2.x + (2 / 3) * (p1.x - p2.x), y: p2.y + (2 / 3) * (p1.y - p2.y) },
      p2
    ];
  }

  /**
   * Convert SVG Arc to line segments using W3C center parameterization
   */
  function arcToSegments(p0, rx, ry, xAxisRotationDeg, largeArcFlag, sweepFlag, p1, tolerance = 0.2) {
    if (p0.x === p1.x && p0.y === p1.y) return [];
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    if (rx === 0 || ry === 0) return [p1];

    const phi = (xAxisRotationDeg * Math.PI) / 180;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);

    // Step 1: Compute (x1', y1')
    const dx = (p0.x - p1.x) / 2;
    const dy = (p0.y - p1.y) / 2;
    const x1p = cosPhi * dx + sinPhi * dy;
    const y1p = -sinPhi * dx + cosPhi * dy;

    // Correct radii if too small
    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) {
      const sqrtLambda = Math.sqrt(lambda);
      rx *= sqrtLambda;
      ry *= sqrtLambda;
    }

    // Step 2: Compute (cx', cy')
    const sign = (largeArcFlag === sweepFlag) ? -1 : 1;
    const num = Math.max(0, (rx * rx * ry * ry) - (rx * rx * y1p * y1p) - (ry * ry * x1p * x1p));
    const den = (rx * rx * y1p * y1p) + (ry * ry * x1p * x1p);
    const coef = sign * Math.sqrt(num / (den || 1e-9));
    const cxp = coef * ((rx * y1p) / ry);
    const cyp = coef * -((ry * x1p) / rx);

    // Step 3: Compute (cx, cy) from (cx', cy')
    const cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p1.x) / 2;
    const cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p1.y) / 2;

    // Step 4: Compute theta1 and deltaTheta
    function angle(u, v) {
      const dot = u.x * v.x + u.y * v.y;
      const len = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
      let ang = Math.acos(Math.max(-1, Math.min(1, dot / (len || 1e-9))));
      if (u.x * v.y - u.y * v.x < 0) ang = -ang;
      return ang;
    }

    const u = { x: (x1p - cxp) / rx, y: (y1p - cyp) / ry };
    const v = { x: (-x1p - cxp) / rx, y: (-y1p - cyp) / ry };
    let theta1 = angle({ x: 1, y: 0 }, u);
    let deltaTheta = angle(u, v);

    if (!sweepFlag && deltaTheta > 0) deltaTheta -= 2 * Math.PI;
    if (sweepFlag && deltaTheta < 0) deltaTheta += 2 * Math.PI;

    // Discretize arc based on radius and high-precision tolerance
    const maxR = Math.max(rx, ry);
    const numSteps = Math.max(32, Math.ceil(Math.abs(deltaTheta) / (2 * Math.acos(Math.max(-1, 1 - 0.02 / maxR)))));
    const step = deltaTheta / numSteps;

    const points = [];
    for (let i = 1; i < numSteps; i++) {
      const th = theta1 + i * step;
      const cosTh = Math.cos(th);
      const sinTh = Math.sin(th);
      const px = cosPhi * rx * cosTh - sinPhi * ry * sinTh + cx;
      const py = sinPhi * rx * cosTh + cosPhi * ry * sinTh + cy;
      points.push({ x: px, y: py });
    }
    points.push(p1);
    return points;
  }

  /**
   * Parse SVG path 'd' string into an array of subpaths (each subpath is an array of points)
   */
  function parsePathD(d) {
    const tokens = tokenizePathData(d);
    if (!tokens.length) return [];

    const subpaths = [];
    let currentSubpath = null;

    let cursor = { x: 0, y: 0 };
    let subpathStart = { x: 0, y: 0 };
    let lastControl = null; // for S and T reflection
    let lastCommand = '';

    let i = 0;
    let currentCmd = '';

    while (i < tokens.length) {
      if (tokens[i].type === 'cmd') {
        currentCmd = tokens[i].val;
        i++;
      } else if (!currentCmd) {
        i++;
        continue;
      }

      const isRel = currentCmd === currentCmd.toLowerCase();
      const cmdUpper = currentCmd.toUpperCase();

      switch (cmdUpper) {
        case 'M': {
          if (i + 1 >= tokens.length || tokens[i].type !== 'num' || tokens[i + 1].type !== 'num') break;
          const x = isRel ? cursor.x + tokens[i].val : tokens[i].val;
          const y = isRel ? cursor.y + tokens[i + 1].val : tokens[i + 1].val;
          i += 2;

          cursor = { x, y };
          subpathStart = { x, y };
          currentSubpath = [{ x, y }];
          subpaths.push(currentSubpath);
          lastControl = null;
          lastCommand = currentCmd;

          // Subsequent coordinates after M/m are treated as L/l
          currentCmd = isRel ? 'l' : 'L';
          break;
        }

        case 'L': {
          if (i + 1 >= tokens.length || tokens[i].type !== 'num' || tokens[i + 1].type !== 'num') break;
          const x = isRel ? cursor.x + tokens[i].val : tokens[i].val;
          const y = isRel ? cursor.y + tokens[i + 1].val : tokens[i + 1].val;
          i += 2;

          cursor = { x, y };
          if (!currentSubpath) {
            currentSubpath = [{ x, y }];
            subpaths.push(currentSubpath);
          } else {
            currentSubpath.push({ x, y });
          }
          lastControl = null;
          lastCommand = currentCmd;
          break;
        }

        case 'H': {
          if (i >= tokens.length || tokens[i].type !== 'num') break;
          const x = isRel ? cursor.x + tokens[i].val : tokens[i].val;
          i += 1;

          cursor = { x, y: cursor.y };
          if (!currentSubpath) {
            currentSubpath = [{ x: cursor.x, y: cursor.y }];
            subpaths.push(currentSubpath);
          } else {
            currentSubpath.push({ x: cursor.x, y: cursor.y });
          }
          lastControl = null;
          lastCommand = currentCmd;
          break;
        }

        case 'V': {
          if (i >= tokens.length || tokens[i].type !== 'num') break;
          const y = isRel ? cursor.y + tokens[i].val : tokens[i].val;
          i += 1;

          cursor = { x: cursor.x, y };
          if (!currentSubpath) {
            currentSubpath = [{ x: cursor.x, y: cursor.y }];
            subpaths.push(currentSubpath);
          } else {
            currentSubpath.push({ x: cursor.x, y: cursor.y });
          }
          lastControl = null;
          lastCommand = currentCmd;
          break;
        }

        case 'C': {
          if (i + 5 >= tokens.length) { i = tokens.length; break; }
          const p1 = {
            x: isRel ? cursor.x + tokens[i].val : tokens[i].val,
            y: isRel ? cursor.y + tokens[i + 1].val : tokens[i + 1].val
          };
          const p2 = {
            x: isRel ? cursor.x + tokens[i + 2].val : tokens[i + 2].val,
            y: isRel ? cursor.y + tokens[i + 3].val : tokens[i + 3].val
          };
          const p3 = {
            x: isRel ? cursor.x + tokens[i + 4].val : tokens[i + 4].val,
            y: isRel ? cursor.y + tokens[i + 5].val : tokens[i + 5].val
          };
          i += 6;

          const segments = subdivideCubicBezier(cursor, p1, p2, p3);
          if (!currentSubpath) {
            currentSubpath = [{ ...cursor }];
            subpaths.push(currentSubpath);
          }
          for (const pt of segments) currentSubpath.push(pt);

          cursor = p3;
          lastControl = p2;
          lastCommand = currentCmd;
          break;
        }

        case 'S': {
          if (i + 3 >= tokens.length) { i = tokens.length; break; }
          let p1;
          if (lastControl && (lastCommand === 'C' || lastCommand === 'c' || lastCommand === 'S' || lastCommand === 's')) {
            p1 = { x: 2 * cursor.x - lastControl.x, y: 2 * cursor.y - lastControl.y };
          } else {
            p1 = { ...cursor };
          }
          const p2 = {
            x: isRel ? cursor.x + tokens[i].val : tokens[i].val,
            y: isRel ? cursor.y + tokens[i + 1].val : tokens[i + 1].val
          };
          const p3 = {
            x: isRel ? cursor.x + tokens[i + 2].val : tokens[i + 2].val,
            y: isRel ? cursor.y + tokens[i + 3].val : tokens[i + 3].val
          };
          i += 4;

          const segments = subdivideCubicBezier(cursor, p1, p2, p3);
          if (!currentSubpath) {
            currentSubpath = [{ ...cursor }];
            subpaths.push(currentSubpath);
          }
          for (const pt of segments) currentSubpath.push(pt);

          cursor = p3;
          lastControl = p2;
          lastCommand = currentCmd;
          break;
        }

        case 'Q': {
          if (i + 3 >= tokens.length) { i = tokens.length; break; }
          const p1 = {
            x: isRel ? cursor.x + tokens[i].val : tokens[i].val,
            y: isRel ? cursor.y + tokens[i + 1].val : tokens[i + 1].val
          };
          const p2 = {
            x: isRel ? cursor.x + tokens[i + 2].val : tokens[i + 2].val,
            y: isRel ? cursor.y + tokens[i + 3].val : tokens[i + 3].val
          };
          i += 4;

          const cubic = quadToCubic(cursor, p1, p2);
          const segments = subdivideCubicBezier(cubic[0], cubic[1], cubic[2], cubic[3]);
          if (!currentSubpath) {
            currentSubpath = [{ ...cursor }];
            subpaths.push(currentSubpath);
          }
          for (const pt of segments) currentSubpath.push(pt);

          cursor = p2;
          lastControl = p1;
          lastCommand = currentCmd;
          break;
        }

        case 'T': {
          if (i + 1 >= tokens.length) { i = tokens.length; break; }
          let p1;
          if (lastControl && (lastCommand === 'Q' || lastCommand === 'q' || lastCommand === 'T' || lastCommand === 't')) {
            p1 = { x: 2 * cursor.x - lastControl.x, y: 2 * cursor.y - lastControl.y };
          } else {
            p1 = { ...cursor };
          }
          const p2 = {
            x: isRel ? cursor.x + tokens[i].val : tokens[i].val,
            y: isRel ? cursor.y + tokens[i + 1].val : tokens[i + 1].val
          };
          i += 2;

          const cubic = quadToCubic(cursor, p1, p2);
          const segments = subdivideCubicBezier(cubic[0], cubic[1], cubic[2], cubic[3]);
          if (!currentSubpath) {
            currentSubpath = [{ ...cursor }];
            subpaths.push(currentSubpath);
          }
          for (const pt of segments) currentSubpath.push(pt);

          cursor = p2;
          lastControl = p1;
          lastCommand = currentCmd;
          break;
        }

        case 'A': {
          if (i + 6 >= tokens.length) { i = tokens.length; break; }
          const rx = tokens[i].val;
          const ry = tokens[i + 1].val;
          const xAxisRot = tokens[i + 2].val;
          const largeArc = tokens[i + 3].val !== 0;
          const sweep = tokens[i + 4].val !== 0;
          const p1 = {
            x: isRel ? cursor.x + tokens[i + 5].val : tokens[i + 5].val,
            y: isRel ? cursor.y + tokens[i + 6].val : tokens[i + 6].val
          };
          i += 7;

          const segments = arcToSegments(cursor, rx, ry, xAxisRot, largeArc, sweep, p1);
          if (!currentSubpath) {
            currentSubpath = [{ ...cursor }];
            subpaths.push(currentSubpath);
          }
          for (const pt of segments) currentSubpath.push(pt);

          cursor = p1;
          lastControl = null;
          lastCommand = currentCmd;
          break;
        }

        case 'Z': {
          if (currentSubpath && currentSubpath.length > 0) {
            currentSubpath.push({ x: subpathStart.x, y: subpathStart.y });
            cursor = { x: subpathStart.x, y: subpathStart.y };
          }
          lastControl = null;
          lastCommand = currentCmd;
          currentCmd = ''; // Finished this command
          break;
        }

        default:
          i++;
          break;
      }
    }

    return subpaths.filter(sp => sp && sp.length >= 2);
  }

  /**
   * Simplify a polyline using Ramer-Douglas-Peucker algorithm
   */
  function simplifyPolyline(pts, tolerance = 0.2) {
    if (!pts || pts.length <= 2) return pts;
    const sqTol = tolerance * tolerance;
    const keep = new Uint8Array(pts.length);
    keep[0] = 1;
    keep[pts.length - 1] = 1;

    const stack = [[0, pts.length - 1]];
    while (stack.length > 0) {
      const [first, last] = stack.pop();
      let maxSqDist = 0;
      let index = -1;

      const p1 = pts[first];
      const p2 = pts[last];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const lenSq = dx * dx + dy * dy;

      for (let i = first + 1; i < last; i++) {
        const p = pts[i];
        let t = 0;
        if (lenSq > 1e-12) {
          t = ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / lenSq;
          t = Math.max(0, Math.min(1, t));
        }
        const projX = p1.x + t * dx;
        const projY = p1.y + t * dy;
        const distSq = (p.x - projX) * (p.x - projX) + (p.y - projY) * (p.y - projY);
        if (distSq > maxSqDist) {
          maxSqDist = distSq;
          index = i;
        }
      }

      if (maxSqDist > sqTol && index !== -1) {
        keep[index] = 1;
        stack.push([first, index], [index, last]);
      }
    }

    const result = [];
    for (let i = 0; i < pts.length; i++) {
      if (keep[i]) result.push(pts[i]);
    }
    return result;
  }

  /**
   * High-precision contour tracer for rasterized glyph bitmaps.
   * Extracts directed pixel-boundary loops, preserves true 90-degree corners,
   * smooths pixel staircases along diagonals/curves, and simplifies with RDP.
   */
  function traceGlyphContours(binaryBuffer, width, height) {
    const isSolid = (x, y) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return false;
      return binaryBuffer[y * width + x] === 0;
    };

    // Directed boundary edges keeping solid pixel to the right in screen coords (CW outer, CCW inner)
    const edges = [];
    const outMap = new Map();
    const ptKey = (x, y) => (y * (width + 2) + x);

    function addDirectedEdge(x1, y1, x2, y2) {
      const idx = edges.length;
      edges.push({ x1, y1, x2, y2, used: false });
      const k = ptKey(x1, y1);
      let list = outMap.get(k);
      if (!list) {
        list = [];
        outMap.set(k, list);
      }
      list.push(idx);
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!isSolid(x, y)) continue;
        if (!isSolid(x, y - 1)) addDirectedEdge(x, y, x + 1, y);         // Top
        if (!isSolid(x + 1, y)) addDirectedEdge(x + 1, y, x + 1, y + 1); // Right
        if (!isSolid(x, y + 1)) addDirectedEdge(x + 1, y + 1, x, y + 1); // Bottom
        if (!isSolid(x - 1, y)) addDirectedEdge(x, y + 1, x, y);         // Left
      }
    }

    if (!edges.length) return [];

    const loops = [];
    for (let i = 0; i < edges.length; i++) {
      if (edges[i].used) continue;

      const ring = [];
      let curEdge = edges[i];
      curEdge.used = true;
      ring.push({ x: curEdge.x1, y: curEdge.y1 });

      let cx = curEdge.x2;
      let cy = curEdge.y2;
      let guard = 0;

      while (guard++ <= edges.length) {
        if (cx === ring[0].x && cy === ring[0].y) break;
        ring.push({ x: cx, y: cy });

        const candidates = outMap.get(ptKey(cx, cy));
        if (!candidates) break;
        let nextIdx = -1;
        for (let c = 0; c < candidates.length; c++) {
          if (!edges[candidates[c]].used) {
            nextIdx = candidates[c];
            break;
          }
        }
        if (nextIdx === -1) break;
        edges[nextIdx].used = true;
        cx = edges[nextIdx].x2;
        cy = edges[nextIdx].y2;
      }

      const M = ring.length;
      if (M < 4) continue;

      // Detect true axis-aligned corners (where a straight run of >= 4px meets an orthogonal run of >= 4px)
      const isCorner = new Uint8Array(M);
      const look = 4;
      if (M >= look * 2) {
        for (let j = 0; j < M; j++) {
          const pPrev = ring[(j - look + M) % M];
          const pCurr = ring[j];
          const pNext = ring[(j + look) % M];
          const dx1 = pCurr.x - pPrev.x;
          const dy1 = pCurr.y - pPrev.y;
          const dx2 = pNext.x - pCurr.x;
          const dy2 = pNext.y - pCurr.y;
          const ortho1 = (dy1 === 0 && Math.abs(dx1) === look) && (dx2 === 0 && Math.abs(dy2) === look);
          const ortho2 = (dx1 === 0 && Math.abs(dy1) === look) && (dy2 === 0 && Math.abs(dx2) === look);
          if (ortho1 || ortho2) {
            isCorner[j] = 1;
          }
        }
      }

      // Smooth pixel staircases (4 iterations of corner-preserving Laplacian smoothing)
      let current = ring;
      const passes = 4;
      for (let pass = 0; pass < passes; pass++) {
        const next = new Array(M);
        for (let j = 0; j < M; j++) {
          if (isCorner[j]) {
            next[j] = { x: current[j].x, y: current[j].y };
          } else {
            const prevPt = current[(j - 1 + M) % M];
            const currPt = current[j];
            const nextPt = current[(j + 1) % M];
            next[j] = {
              x: 0.25 * prevPt.x + 0.5 * currPt.x + 0.25 * nextPt.x,
              y: 0.25 * prevPt.y + 0.5 * currPt.y + 0.25 * nextPt.y
            };
          }
        }
        current = next;
      }

      // Close ring and simplify
      const closed = [...current, { x: current[0].x, y: current[0].y }];
      const simplified = simplifyPolyline(closed, 0.18);
      if (simplified.length >= 3) {
        loops.push(simplified);
      }
    }

    return loops;
  }

  /**
   * Read an inline style property or XML attribute from an element or its ancestors
   */
  function getInheritedStyleOrAttr(elem, propName, defaultVal = '') {
    let cur = elem;
    const regex = new RegExp(`(?:^|;)\\s*${propName}\\s*:\\s*([^;]+)`, 'i');
    while (cur && cur.nodeType === 1) {
      const styleAttr = cur.getAttribute('style');
      if (styleAttr) {
        const m = styleAttr.match(regex);
        if (m && m[1]) return m[1].trim();
      }
      if (cur.hasAttribute(propName)) {
        const val = cur.getAttribute(propName);
        if (val !== null && val !== '') return val.trim();
      }
      if (cur.tagName && cur.tagName.toLowerCase() === 'svg') break;
      cur = cur.parentElement || (cur.parentNode && cur.parentNode.nodeType === 1 ? cur.parentNode : null);
    }
    return defaultVal;
  }

  /**
   * Convert SVG text string into vector outline subpaths using offscreen canvas & contour tracing
   */
  function textToPaths(opts) {
    const {
      text,
      x = 0,
      y = 0,
      fontSize = 16,
      fontFamily = 'sans-serif',
      fontWeight = 'normal',
      fontStyle = 'normal',
      letterSpacing = 0,
      textAnchor = 'start',
      svgStartPos = null,
      svgTextLength = null
    } = opts;

    if (!text || !text.trim()) return [];
    const validFontSize = Math.max(1e-4, fontSize);

    // Always render at high fixed pixel size (128px) for crisp glyph shapes regardless of SVG user unit scale
    const renderFontSize = 128;
    const scale = renderFontSize / validFontSize;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const safeStyle = (fontStyle === 'italic' || fontStyle === 'oblique') ? fontStyle : 'normal';
    const safeWeight = fontWeight ? String(fontWeight).trim() : 'normal';
    const fontSpec = `${safeStyle} ${safeWeight} ${renderFontSize}px ${fontFamily || 'sans-serif'}`;

    ctx.font = fontSpec;
    if (letterSpacing && 'letterSpacing' in ctx) {
      ctx.letterSpacing = `${letterSpacing * scale}px`;
    }

    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;
    if (textWidth <= 0) return [];

    const ascent = metrics.actualBoundingBoxAscent || renderFontSize * 0.85;
    const descent = metrics.actualBoundingBoxDescent || renderFontSize * 0.3;
    const leftOverhang = Math.max(0, metrics.actualBoundingBoxLeft || 0);
    const rightOverhang = Math.max(0, (metrics.actualBoundingBoxRight || textWidth) - textWidth);

    const pad = 16;
    const w = Math.ceil(textWidth + leftOverhang + rightOverhang + pad * 2);
    const h = Math.ceil(ascent + descent + pad * 2);

    canvas.width = w;
    canvas.height = h;

    ctx.font = fontSpec;
    if (letterSpacing && 'letterSpacing' in ctx) {
      ctx.letterSpacing = `${letterSpacing * scale}px`;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    const drawX = pad + leftOverhang;
    const drawY = pad + ascent;
    ctx.fillText(text, drawX, drawY);

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const bin = new Uint8Array(w * h);

    for (let i = 0; i < data.length; i += 4) {
      const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      bin[i / 4] = luminance < 128 ? 0 : 1;
    }

    const loops = traceGlyphContours(bin, w, h);
    if (!loops || !loops.length) return [];

    // Determine exact baseline start position in SVG local user coordinates
    let originX = x;
    let originY = y;
    const canvasAdvanceUser = textWidth / scale;

    if (svgStartPos && !isNaN(svgStartPos.x) && !isNaN(svgStartPos.y)) {
      originX = svgStartPos.x;
      originY = svgStartPos.y;
    } else {
      const effectiveWidth = (svgTextLength && svgTextLength > 0) ? svgTextLength : canvasAdvanceUser;
      if (textAnchor === 'middle') {
        originX -= effectiveWidth / 2;
      } else if (textAnchor === 'end') {
        originX -= effectiveWidth;
      }
    }

    // Match horizontal advance width to SVG native text layout if available
    const widthRatio = (svgTextLength && svgTextLength > 0 && canvasAdvanceUser > 0)
      ? (svgTextLength / canvasAdvanceUser)
      : 1.0;

    const result = [];
    for (const loop of loops) {
      const mapped = loop.map(pt => ({
        x: originX + ((pt.x - drawX) / scale) * widthRatio,
        y: originY + (pt.y - drawY) / scale
      }));
      if (mapped.length >= 3) {
        result.push(mapped);
      }
    }

    return result;
  }

  let nextFillGroupId = 1;

  /**
   * Determine if an SVG element has a non-transparent fill
   */
  function hasNonTransparentFill(elem) {
    if (!elem || elem.nodeType !== 1) return false;
    const tag = elem.tagName ? elem.tagName.toLowerCase() : '';
    if (tag === 'line') return false;

    const rawFillOpacity = getInheritedStyleOrAttr(elem, 'fill-opacity', '');
    if (rawFillOpacity !== '' && parseFloat(rawFillOpacity) <= 0) return false;

    const rawOpacity = getInheritedStyleOrAttr(elem, 'opacity', '');
    if (rawOpacity !== '' && parseFloat(rawOpacity) <= 0) return false;

    const rawFill = getInheritedStyleOrAttr(elem, 'fill', '');
    if (rawFill) {
      const rf = rawFill.toLowerCase().trim();
      if (rf === 'none' || rf === 'transparent' || rf === 'rgba(0,0,0,0)' || rf === 'rgba(0, 0, 0, 0)') {
        return false;
      }
      return true;
    }

    if (tag === 'polyline') {
      return false;
    }

    // Only consult getComputedStyle if the SVG contains a <style> stylesheet and no inline/attr fill was set
    const ownerDoc = elem.ownerDocument;
    const hasStyleTag = ownerDoc && ownerDoc.querySelector && ownerDoc.querySelector('style');
    if (hasStyleTag && typeof window !== 'undefined' && window.getComputedStyle && elem.isConnected) {
      const cs = window.getComputedStyle(elem);
      if (cs) {
        const cf = (cs.fill || '').toLowerCase().trim();
        if (cf === 'none' || cf === 'transparent' || cf === 'rgba(0, 0, 0, 0)' || cf === 'rgba(0,0,0,0)') {
          return false;
        }
        if (cs.fillOpacity !== undefined && cs.fillOpacity !== '' && parseFloat(cs.fillOpacity) <= 0) {
          return false;
        }
        if (cs.opacity !== undefined && cs.opacity !== '' && parseFloat(cs.opacity) <= 0) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Traverse SVG element tree and collect all vector strokes
   */
  function extractPathsFromElement(elem, parentMatrix, paths, inheritedPower = undefined) {
    if (!elem || elem.nodeType !== 1) return;

    const tagName = elem.tagName ? elem.tagName.toLowerCase() : '';
    if (['defs', 'style', 'metadata', 'title', 'desc', 'clippath', 'mask', 'pattern', 'lineargradient', 'radialgradient', 'symbol', 'marker'].includes(tagName)) {
      return;
    }

    // Check display or visibility
    const style = elem.getAttribute('style') || '';
    if (style.includes('display:none') || style.includes('visibility:hidden')) return;
    if (elem.getAttribute('display') === 'none' || elem.getAttribute('visibility') === 'hidden') return;

    const elemTransform = parseTransform(elem.getAttribute('transform'));
    const currentMatrix = Matrix.multiply(parentMatrix, elemTransform);

    const powerAttr = elem.getAttribute('data-power');
    const currentPower = (powerAttr !== null && powerAttr !== '' && !isNaN(parseFloat(powerAttr)))
      ? parseFloat(powerAttr)
      : inheritedPower;

    const elemIsFilled = hasNonTransparentFill(elem);
    const elemFillGroupId = elemIsFilled ? (nextFillGroupId++) : 0;

    function addSubpaths(subpaths, overridePower = currentPower, isFilledOverride = elemIsFilled, groupIdOverride = elemFillGroupId) {
      for (const sp of subpaths) {
        if (!sp || sp.length < 2) continue;
        const transformedPath = sp.map(pt => {
          const tpt = Matrix.transformPoint(currentMatrix, pt.x, pt.y);
          if (overridePower !== undefined) tpt.power = overridePower;
          return tpt;
        });
        if (overridePower !== undefined) transformedPath.power = overridePower;
        if (isFilledOverride) {
          transformedPath.isFilled = true;
          transformedPath.fillGroupId = groupIdOverride;
        }
        paths.push(transformedPath);
      }
    }

    switch (tagName) {
      case 'path': {
        const d = elem.getAttribute('d');
        if (d) {
          addSubpaths(parsePathD(d));
        }
        break;
      }

      case 'rect': {
        const x = parseLength(elem.getAttribute('x'), 0);
        const y = parseLength(elem.getAttribute('y'), 0);
        const w = parseLength(elem.getAttribute('width'), 0);
        const h = parseLength(elem.getAttribute('height'), 0);
        let rx = parseLength(elem.getAttribute('rx'), 0);
        let ry = parseLength(elem.getAttribute('ry'), 0);
        if (rx === 0 && ry > 0) rx = ry;
        if (ry === 0 && rx > 0) ry = rx;

        if (w > 0 && h > 0) {
          if (rx === 0 && ry === 0) {
            addSubpaths([[
              { x, y },
              { x: x + w, y },
              { x: x + w, y: y + h },
              { x, y: y + h },
              { x, y }
            ]]);
          } else {
            rx = Math.min(rx, w / 2);
            ry = Math.min(ry, h / 2);
            const d = `M ${x + rx} ${y} ` +
              `H ${x + w - rx} ` +
              `A ${rx} ${ry} 0 0 1 ${x + w} ${y + ry} ` +
              `V ${y + h - ry} ` +
              `A ${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} ` +
              `H ${x + rx} ` +
              `A ${rx} ${ry} 0 0 1 ${x} ${y + h - ry} ` +
              `V ${y + ry} ` +
              `A ${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`;
            addSubpaths(parsePathD(d));
          }
        }
        break;
      }

      case 'circle': {
        const cx = parseLength(elem.getAttribute('cx'), 0);
        const cy = parseLength(elem.getAttribute('cy'), 0);
        const r = parseLength(elem.getAttribute('r'), 0);
        if (r > 0) {
          const center = Matrix.transformPoint(currentMatrix, cx, cy);
          const scale = Math.hypot(currentMatrix[0], currentMatrix[1]);
          const scaledR = r * scale;

          // Generate smooth 64-step circle points for preview / simulation
          const circlePts = [];
          const steps = 64;
          for (let s = 0; s <= steps; s++) {
            const angle = (s / steps) * Math.PI * 2;
            circlePts.push({
              x: center.x + scaledR * Math.cos(angle),
              y: center.y + scaledR * Math.sin(angle)
            });
          }
          circlePts.isCircle = true;
          circlePts.cx = center.x;
          circlePts.cy = center.y;
          circlePts.r = scaledR;
          if (currentPower !== undefined) circlePts.power = currentPower;
          if (elemIsFilled) {
            circlePts.isFilled = true;
            circlePts.fillGroupId = elemFillGroupId;
          }
          paths.push(circlePts);
        }
        break;
      }

      case 'ellipse': {
        const cx = parseLength(elem.getAttribute('cx'), 0);
        const cy = parseLength(elem.getAttribute('cy'), 0);
        const rx = parseLength(elem.getAttribute('rx'), 0);
        const ry = parseLength(elem.getAttribute('ry'), 0);
        if (rx > 0 && ry > 0) {
          const d = `M ${cx - rx} ${cy} ` +
            `A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} ` +
            `A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
          addSubpaths(parsePathD(d));
        }
        break;
      }

      case 'line': {
        const x1 = parseLength(elem.getAttribute('x1'), 0);
        const y1 = parseLength(elem.getAttribute('y1'), 0);
        const x2 = parseLength(elem.getAttribute('x2'), 0);
        const y2 = parseLength(elem.getAttribute('y2'), 0);
        addSubpaths([[{ x: x1, y: y1 }, { x: x2, y: y2 }]]);
        break;
      }

      case 'polyline':
      case 'polygon': {
        const pointsStr = elem.getAttribute('points') || '';
        const coords = pointsStr.trim().split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n));
        const pts = [];
        for (let i = 0; i < coords.length - 1; i += 2) {
          pts.push({ x: coords[i], y: coords[i + 1] });
        }
        if (pts.length >= 2) {
          if (tagName === 'polygon') {
            pts.push({ x: pts[0].x, y: pts[0].y });
          }
          addSubpaths([pts]);
        }
        break;
      }

      case 'text': {
        function processTextNodeElement(targetEl, localMatrix, powerVal) {
          const txt = (targetEl.textContent || '').replace(/[\r\n\t ]+/g, ' ').trim();
          if (!txt) return;

          const cs = (typeof window !== 'undefined' && window.getComputedStyle && targetEl.isConnected)
            ? window.getComputedStyle(targetEl)
            : null;

          const xAttr = targetEl.getAttribute('x') !== null ? targetEl.getAttribute('x') : elem.getAttribute('x');
          const yAttr = targetEl.getAttribute('y') !== null ? targetEl.getAttribute('y') : elem.getAttribute('y');
          const dxAttr = targetEl.getAttribute('dx') !== null ? targetEl.getAttribute('dx') : elem.getAttribute('dx');
          const dyAttr = targetEl.getAttribute('dy') !== null ? targetEl.getAttribute('dy') : elem.getAttribute('dy');

          const x = parseLength(xAttr, 0) + parseLength(dxAttr, 0);
          const y = parseLength(yAttr, 0) + parseLength(dyAttr, 0);

          const rawFontSize = getInheritedStyleOrAttr(targetEl, 'font-size', '');
          let fontSize = rawFontSize
            ? parseLength(rawFontSize, 16)
            : ((cs && cs.fontSize && !isNaN(parseFloat(cs.fontSize))) ? parseFloat(cs.fontSize) : 16);

          const fontFamily = getInheritedStyleOrAttr(targetEl, 'font-family', '') || (cs && cs.fontFamily) || 'sans-serif';
          const fontWeight = getInheritedStyleOrAttr(targetEl, 'font-weight', '') || (cs && cs.fontWeight) || 'normal';
          const fontStyle = getInheritedStyleOrAttr(targetEl, 'font-style', '') || (cs && cs.fontStyle) || 'normal';
          const textAnchor = getInheritedStyleOrAttr(targetEl, 'text-anchor', '') || (cs && cs.textAnchor) || 'start';

          let letterSpacing = 0;
          const rawLetterSpacing = getInheritedStyleOrAttr(targetEl, 'letter-spacing', '');
          if (rawLetterSpacing && rawLetterSpacing !== 'normal') {
            letterSpacing = parseLength(rawLetterSpacing, 0);
          } else if (cs && cs.letterSpacing && cs.letterSpacing !== 'normal') {
            letterSpacing = parseFloat(cs.letterSpacing) || 0;
          }

          let svgStartPos = null;
          let svgTextLength = null;

          if (targetEl.isConnected && typeof targetEl.getNumberOfChars === 'function') {
            try {
              const nChars = targetEl.getNumberOfChars();
              if (nChars > 0) {
                const rawPreserved = (targetEl.textContent || '').replace(/[\r\n\t]/g, ' ');
                const firstNonSpace = rawPreserved.search(/\S/);
                if (nChars === rawPreserved.length && firstNonSpace >= 0) {
                  let lastNonSpace = rawPreserved.length - 1;
                  while (lastNonSpace > firstNonSpace && /\s/.test(rawPreserved[lastNonSpace])) {
                    lastNonSpace--;
                  }
                  const count = lastNonSpace - firstNonSpace + 1;
                  const p0 = targetEl.getStartPositionOfChar(firstNonSpace);
                  svgStartPos = { x: p0.x, y: p0.y };
                  svgTextLength = targetEl.getSubStringLength(firstNonSpace, count);
                } else {
                  const p0 = targetEl.getStartPositionOfChar(0);
                  svgStartPos = { x: p0.x, y: p0.y };
                  svgTextLength = targetEl.getComputedTextLength();
                }
              }
            } catch (err) {
              // Fallback to attribute coordinates if SVG text geometry API throws
            }
          }

          const textSubpaths = textToPaths({
            text: txt,
            x,
            y,
            fontSize,
            fontFamily,
            fontWeight,
            fontStyle,
            letterSpacing,
            textAnchor,
            svgStartPos,
            svgTextLength
          });

          const textIsFilled = hasNonTransparentFill(targetEl);
          const textGroupId = textIsFilled ? (nextFillGroupId++) : 0;

          for (const sp of textSubpaths) {
            if (!sp || sp.length < 2) continue;
            const transformedPath = sp.map(pt => {
              const tpt = Matrix.transformPoint(localMatrix, pt.x, pt.y);
              if (powerVal !== undefined) tpt.power = powerVal;
              return tpt;
            });
            if (powerVal !== undefined) transformedPath.power = powerVal;
            if (textIsFilled) {
              transformedPath.isFilled = true;
              transformedPath.fillGroupId = textGroupId;
            }
            paths.push(transformedPath);
          }
        }

        const tspans = elem.querySelectorAll('tspan');
        if (tspans && tspans.length > 0) {
          for (let i = 0; i < tspans.length; i++) {
            const tspan = tspans[i];
            // Only process leaf tspans to avoid duplicating nested tspans
            if (tspan.querySelector('tspan')) continue;
            const tspanTransform = parseTransform(tspan.getAttribute('transform'));
            const tspanMatrix = Matrix.multiply(currentMatrix, tspanTransform);
            const tspanPowerAttr = tspan.getAttribute('data-power');
            const tspanPower = (tspanPowerAttr !== null && tspanPowerAttr !== '' && !isNaN(parseFloat(tspanPowerAttr)))
              ? parseFloat(tspanPowerAttr)
              : currentPower;
            processTextNodeElement(tspan, tspanMatrix, tspanPower);
          }
        } else {
          processTextNodeElement(elem, currentMatrix, currentPower);
        }
        return; // Don't traverse child elements (like tspan) again
      }

      default:
        break;
    }

    // Traverse children (for <g>, <svg>, etc.)
    for (let i = 0; i < elem.children.length; i++) {
      extractPathsFromElement(elem.children[i], currentMatrix, paths, currentPower);
    }
  }

  /**
   * Main function: parse an SVG string and extract raw vector paths and dimensions
   */
  function parseSVG(svgString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      throw new Error('Invalid SVG: ' + parserError.textContent);
    }

    const svgElem = doc.documentElement;
    if (!svgElem || svgElem.tagName.toLowerCase() !== 'svg') {
      throw new Error('Root element is not <svg>');
    }

    // Calculate dimensions
    let viewBox = null;
    const vbAttr = svgElem.getAttribute('viewBox');
    if (vbAttr) {
      const parts = vbAttr.trim().split(/[\s,]+/).map(parseFloat);
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
        viewBox = { minX: parts[0], minY: parts[1], width: parts[2], height: parts[3] };
      }
    }

    const widthAttr = svgElem.getAttribute('width');
    const heightAttr = svgElem.getAttribute('height');
    let width = (widthAttr && !widthAttr.trim().endsWith('%')) ? parseLength(widthAttr) : (viewBox ? viewBox.width : 300);
    let height = (heightAttr && !heightAttr.trim().endsWith('%')) ? parseLength(heightAttr) : (viewBox ? viewBox.height : 150);

    // Initial transform matrix: if viewBox differs from width/height
    let rootMatrix = Matrix.identity();
    if (viewBox && width > 0 && height > 0) {
      const sx = width / viewBox.width;
      const sy = height / viewBox.height;
      rootMatrix = Matrix.multiply(Matrix.scale(sx, sy), Matrix.translate(-viewBox.minX, -viewBox.minY));
    }

    const paths = [];
    let hostDiv = null;
    try {
      let targetRoot = svgElem;
      if (typeof document !== 'undefined' && document.body) {
        hostDiv = document.createElement('div');
        hostDiv.style.cssText = `position:fixed;left:-99999px;top:-99999px;width:${width}px;height:${height}px;overflow:hidden;opacity:0;pointer-events:none;font-family:serif;font-size:16px;font-weight:normal;font-style:normal;`;
        targetRoot = document.importNode ? document.importNode(svgElem, true) : svgElem;
        hostDiv.appendChild(targetRoot);
        document.body.appendChild(hostDiv);
      }
      extractPathsFromElement(targetRoot, rootMatrix, paths);
    } finally {
      if (hostDiv && hostDiv.parentNode) {
        hostDiv.parentNode.removeChild(hostDiv);
      }
    }

    // Compute bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of paths) {
      for (const pt of p) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
    }

    if (minX === Infinity) {
      minX = 0; minY = 0; maxX = width; maxY = height;
    }

    return {
      paths,
      width: maxX - minX,
      height: maxY - minY,
      bounds: { minX, minY, maxX, maxY },
      originalWidth: width,
      originalHeight: height
    };
  }

  return {
    parseSVG,
    parseTransform,
    parseLength
  };
})();
