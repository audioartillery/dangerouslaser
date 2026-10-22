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
      textAnchor = 'start'
    } = opts;

    if (!text || !text.trim()) return [];

    // Scale up for high resolution contour tracing
    const scale = Math.max(2, Math.min(40, Math.ceil(64 / Math.max(0.5, fontSize))));
    const renderFontSize = Math.round(fontSize * scale);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.font = `${fontStyle} ${fontWeight} ${renderFontSize}px ${fontFamily}`;

    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;
    const ascent = metrics.actualBoundingBoxAscent || renderFontSize * 0.8;
    const descent = metrics.actualBoundingBoxDescent || renderFontSize * 0.25;

    const pad = 12;
    const w = Math.ceil(textWidth + pad * 2);
    const h = Math.ceil(ascent + descent + pad * 2);

    canvas.width = w;
    canvas.height = h;

    ctx.font = `${fontStyle} ${fontWeight} ${renderFontSize}px ${fontFamily}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    const drawX = pad;
    const drawY = pad + ascent;
    ctx.fillText(text, drawX, drawY);

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const bin = new Uint8Array(w * h);

    for (let i = 0; i < data.length; i += 4) {
      const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      bin[i / 4] = luminance < 140 ? 0 : 1;
    }

    // Trace contours
    const loops = RasterEngine.traceContours(bin, w, h, w, h);
    if (!loops || !loops.length) return [];

    let anchorShiftX = 0;
    if (textAnchor === 'middle') {
      anchorShiftX = -(textWidth / scale) / 2;
    } else if (textAnchor === 'end') {
      anchorShiftX = -(textWidth / scale);
    }

    const result = [];
    for (const loop of loops) {
      const mapped = loop.map(pt => ({
        x: x + anchorShiftX + (pt.x - drawX) / scale,
        y: y + (pt.y - drawY) / scale
      }));
      if (mapped.length >= 3) {
        result.push(mapped);
      }
    }

    return result;
  }

  /**
   * Traverse SVG element tree and collect all vector strokes
   */
  function extractPathsFromElement(elem, parentMatrix, paths, inheritedPower = undefined) {
    if (!elem || elem.nodeType !== 1) return;

    // Check display or visibility
    const style = elem.getAttribute('style') || '';
    if (style.includes('display:none') || style.includes('visibility:hidden')) return;
    if (elem.getAttribute('display') === 'none' || elem.getAttribute('visibility') === 'hidden') return;

    const elemTransform = parseTransform(elem.getAttribute('transform'));
    const currentMatrix = Matrix.multiply(parentMatrix, elemTransform);
    const tagName = elem.tagName.toLowerCase();

    const powerAttr = elem.getAttribute('data-power');
    const currentPower = (powerAttr !== null && powerAttr !== '' && !isNaN(parseFloat(powerAttr)))
      ? parseFloat(powerAttr)
      : inheritedPower;

    function addSubpaths(subpaths, overridePower = currentPower) {
      for (const sp of subpaths) {
        if (!sp || sp.length < 2) continue;
        const transformedPath = sp.map(pt => {
          const tpt = Matrix.transformPoint(currentMatrix, pt.x, pt.y);
          if (overridePower !== undefined) tpt.power = overridePower;
          return tpt;
        });
        if (overridePower !== undefined) transformedPath.power = overridePower;
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
        const tspans = elem.querySelectorAll('tspan');
        if (tspans && tspans.length > 0) {
          for (let i = 0; i < tspans.length; i++) {
            const tspan = tspans[i];
            const txt = (tspan.textContent || '').trim();
            if (!txt) continue;
            const x = parseLength(tspan.getAttribute('x') || elem.getAttribute('x'), 0);
            const y = parseLength(tspan.getAttribute('y') || elem.getAttribute('y'), 0);
            const fontSizeAttr = tspan.getAttribute('font-size') || elem.getAttribute('font-size') || '16';
            const fontSize = parseLength(fontSizeAttr, 16);
            const fontFamily = tspan.getAttribute('font-family') || elem.getAttribute('font-family') || 'sans-serif';
            const fontWeight = tspan.getAttribute('font-weight') || elem.getAttribute('font-weight') || 'normal';
            const fontStyle = tspan.getAttribute('font-style') || elem.getAttribute('font-style') || 'normal';
            const textAnchor = tspan.getAttribute('text-anchor') || elem.getAttribute('text-anchor') || 'start';

            const tspanPowerAttr = tspan.getAttribute('data-power');
            const tspanPower = (tspanPowerAttr !== null && tspanPowerAttr !== '' && !isNaN(parseFloat(tspanPowerAttr)))
              ? parseFloat(tspanPowerAttr)
              : currentPower;

            const textSubpaths = textToPaths({
              text: txt,
              x,
              y,
              fontSize,
              fontFamily,
              fontWeight,
              fontStyle,
              textAnchor
            });
            addSubpaths(textSubpaths, tspanPower);
          }
        } else {
          const textContent = (elem.textContent || '').trim();
          if (textContent) {
            const x = parseLength(elem.getAttribute('x'), 0);
            const y = parseLength(elem.getAttribute('y'), 0);
            const fontSizeAttr = elem.getAttribute('font-size') || '16';
            const fontSize = parseLength(fontSizeAttr, 16);
            const fontFamily = elem.getAttribute('font-family') || 'sans-serif';
            const fontWeight = elem.getAttribute('font-weight') || 'normal';
            const fontStyle = elem.getAttribute('font-style') || 'normal';
            const textAnchor = elem.getAttribute('text-anchor') || 'start';

            const textSubpaths = textToPaths({
              text: textContent,
              x,
              y,
              fontSize,
              fontFamily,
              fontWeight,
              fontStyle,
              textAnchor
            });
            addSubpaths(textSubpaths, currentPower);
          }
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
    let width = widthAttr ? parseLength(widthAttr) : (viewBox ? viewBox.width : 300);
    let height = heightAttr ? parseLength(heightAttr) : (viewBox ? viewBox.height : 150);

    // Initial transform matrix: if viewBox differs from width/height
    let rootMatrix = Matrix.identity();
    if (viewBox && width > 0 && height > 0) {
      const sx = width / viewBox.width;
      const sy = height / viewBox.height;
      rootMatrix = Matrix.multiply(Matrix.scale(sx, sy), Matrix.translate(-viewBox.minX, -viewBox.minY));
    }

    const paths = [];
    extractPathsFromElement(svgElem, rootMatrix, paths);

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
