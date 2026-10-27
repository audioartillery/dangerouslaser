/**
 * Dangerous Laser - G-Code Generator & Toolpath Transformer
 * Handles:
 * - 2D geometric transformations: Scale, Rotate, Flip H/V, Origin alignment
 * - Toolpath sequencing & nearest-neighbor travel optimization
 * - G-code formatting (G0, G1, M3, M5, S, F, G20/G21)
 * - LinuxCNC '%' wrapper and custom prefix/postfix injection
 * - Distance, bounding box, and machining time estimation
 */

const GcodeGenerator = (function() {
  'use strict';

  /**
   * Apply Scale, Rotate, Flip, and Origin alignment to a set of raw 2D paths
   * Raw paths are Array of Array of {x, y}
   */
  function transformPaths(rawPaths, options) {
    if (!rawPaths || !rawPaths.length) return { paths: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 }, center: { x: 0, y: 0 } };

    const {
      targetWidth,       // In target units (mm or in)
      targetHeight,      // In target units
      docWidth,          // original document width
      docHeight,         // original document height
      docMinX = 0,
      docMinY = 0,
      rotationDeg = 0,   // degrees
      flipH = false,
      flipV = false,
      originAlign = 'center', // 'center' (default), 'bottom-left', 'top-left', 'bottom-right', 'top-right'
      offsetX = 0,
      offsetY = 0,
      fillSolid = false,
      lineInterval = 0.008
    } = options;

    // 1. Determine reference center and dimensions for scaling
    let docW = docWidth;
    let docH = docHeight;
    let centerX = docMinX + (docWidth ? docWidth / 2 : 0);
    let centerY = docMinY + (docHeight ? docHeight / 2 : 0);

    if (!docW || !docH) {
      // Calculate from raw path bounds if document dimensions not provided
      let rawMinX = Infinity, rawMinY = Infinity, rawMaxX = -Infinity, rawMaxY = -Infinity;
      for (const path of rawPaths) {
        for (const pt of path) {
          if (pt.x < rawMinX) rawMinX = pt.x;
          if (pt.y < rawMinY) rawMinY = pt.y;
          if (pt.x > rawMaxX) rawMaxX = pt.x;
          if (pt.y > rawMaxY) rawMaxY = pt.y;
        }
      }
      docW = rawMaxX - rawMinX || 1;
      docH = rawMaxY - rawMinY || 1;
      centerX = (rawMinX + rawMaxX) / 2;
      centerY = (rawMinY + rawMaxY) / 2;
    }

    // 2. Normalized coordinates (-0.5 to 0.5) centered at (0,0)
    const rad = (rotationDeg * Math.PI) / 180;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);

    const transformedPaths = [];

    // Scale to target dimensions, invert Y for CNC coordinates, flip, and rotate
    for (const path of rawPaths) {
      const newPath = [];
      for (const pt of path) {
        // u from -0.5 (left) to +0.5 (right)
        let u = (pt.x - centerX) / docW;
        // v from -0.5 (bottom) to +0.5 (top) - inverting Y so SVG top (small Y) is top (+Y in CNC)
        let v = (centerY - pt.y) / docH;

        // Flip
        if (flipH) u = -u;
        if (flipV) v = -v;

        // Scale to physical target dimensions centered at 0
        const cx = u * targetWidth;
        const cy = v * targetHeight;

        // Rotate around center
        const rx = cx * cosR - cy * sinR;
        const ry = cx * sinR + cy * cosR;

        newPath.push({ x: rx, y: ry, power: pt.power });
      }

      if (path.isCircle) {
        let u = (path.cx - centerX) / docW;
        let v = (centerY - path.cy) / docH;
        if (flipH) u = -u;
        if (flipV) v = -v;
        const cx = u * targetWidth;
        const cy = v * targetHeight;
        const rx = cx * cosR - cy * sinR;
        const ry = cx * sinR + cy * cosR;

        const scaleFactor = targetWidth / docW;
        newPath.isCircle = true;
        newPath.cx = rx;
        newPath.cy = ry;
        newPath.r = path.r * scaleFactor;
      }

      if (path.power !== undefined) {
        newPath.power = path.power;
      }
      if (path.isFilled) {
        newPath.isFilled = true;
        newPath.fillGroupId = path.fillGroupId;
      }

      transformedPaths.push(newPath);
    }

    // 3. Find bounds after rotation
    let rotMinX = Infinity, rotMinY = Infinity, rotMaxX = -Infinity, rotMaxY = -Infinity;
    for (const path of transformedPaths) {
      for (const pt of path) {
        if (pt.x < rotMinX) rotMinX = pt.x;
        if (pt.y < rotMinY) rotMinY = pt.y;
        if (pt.x > rotMaxX) rotMaxX = pt.x;
        if (pt.y > rotMaxY) rotMaxY = pt.y;
      }
    }

    const rotW = rotMaxX - rotMinX;
    const rotH = rotMaxY - rotMinY;

    // 4. Align according to Origin choice and add user offset
    let shiftX = 0;
    let shiftY = 0;

    switch (originAlign) {
      case 'bottom-left': // Standard CNC origin: (0,0) at bottom-left of bounds
        shiftX = -rotMinX + offsetX;
        shiftY = -rotMinY + offsetY;
        break;
      case 'top-left':
        shiftX = -rotMinX + offsetX;
        shiftY = -rotMaxY + offsetY;
        break;
      case 'center':
        shiftX = -(rotMinX + rotMaxX) / 2 + offsetX;
        shiftY = -(rotMinY + rotMaxY) / 2 + offsetY;
        break;
      case 'bottom-right':
        shiftX = -rotMaxX + offsetX;
        shiftY = -rotMinY + offsetY;
        break;
      case 'top-right':
        shiftX = -rotMaxX + offsetX;
        shiftY = -rotMaxY + offsetY;
        break;
      default:
        shiftX = -rotMinX + offsetX;
        shiftY = -rotMinY + offsetY;
    }

    const finalPaths = [];
    let finalMinX = Infinity, finalMinY = Infinity, finalMaxX = -Infinity, finalMaxY = -Infinity;

    for (const path of transformedPaths) {
      const finalPath = [];
      for (const pt of path) {
        const x = pt.x + shiftX;
        const y = pt.y + shiftY;
        finalPath.push({ x, y, power: pt.power });
        if (x < finalMinX) finalMinX = x;
        if (y < finalMinY) finalMinY = y;
        if (x > finalMaxX) finalMaxX = x;
        if (y > finalMaxY) finalMaxY = y;
      }

      if (path.isCircle) {
        finalPath.isCircle = true;
        finalPath.cx = path.cx + shiftX;
        finalPath.cy = path.cy + shiftY;
        finalPath.r = path.r;
      }

      if (path.power !== undefined) {
        finalPath.power = path.power;
      }
      if (path.isFilled) {
        finalPath.isFilled = true;
        finalPath.fillGroupId = path.fillGroupId;
      }

      finalPaths.push(finalPath);
    }

    let outputPaths = finalPaths;
    if (fillSolid) {
      outputPaths = expandSolidFills(finalPaths, lineInterval);
    }

    return {
      paths: outputPaths,
      bounds: {
        minX: finalMinX,
        minY: finalMinY,
        maxX: finalMaxX,
        maxY: finalMaxY,
        width: rotW,
        height: rotH
      },
      center: {
        x: shiftX,
        y: shiftY
      }
    };
  }

  /**
   * Convert filled SVG element loops into bidirectional horizontal laser scanlines
   * using the Even-Odd interior rule across each element's fillGroupId, while preserving
   * the outer/interior boundary stroke contours.
   */
  function expandSolidFills(paths, lineInterval) {
    const stepY = Math.max(1e-4, parseFloat(lineInterval) || 0.008);
    const result = [];
    const fillGroups = new Map();
    const groupOrder = [];

    for (const p of paths) {
      if (!p || p.length < 2) continue;
      // Keep all paths (outlines/strokes)
      result.push(p);

      if (p.isFilled) {
        const gid = p.fillGroupId || 1;
        if (!fillGroups.has(gid)) {
          fillGroups.set(gid, []);
          groupOrder.push(gid);
        }
        fillGroups.get(gid).push(p);
      }
    }

    for (const gid of groupOrder) {
      const loops = fillGroups.get(gid);
      if (!loops || !loops.length) continue;

      const groupPower = loops[0].power;
      let gMinY = Infinity;
      let gMaxY = -Infinity;

      // Collect closed edge segments for all loops in this filled element
      const segments = [];
      for (const loop of loops) {
        const n = loop.length;
        if (n < 2) continue;
        for (let i = 0; i < n; i++) {
          const p1 = loop[i];
          const p2 = (i + 1 < n) ? loop[i + 1] : loop[0];
          if (p1.y < gMinY) gMinY = p1.y;
          if (p1.y > gMaxY) gMaxY = p1.y;
          if (Math.abs(p1.y - p2.y) > 1e-9) {
            segments.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
          }
        }
      }

      if (!segments.length || gMinY >= gMaxY) continue;

      // Inset top and bottom by stepY so scanlines terminate inside the shape by line spacing
      const insetMinY = gMinY + stepY;
      const insetMaxY = gMaxY - stepY;
      if (insetMinY > insetMaxY) continue;

      const scanYs = [];
      for (let y = insetMaxY; y >= insetMinY - 1e-6; y -= stepY) {
        scanYs.push(y);
      }
      if (scanYs.length === 0) {
        scanYs.push((insetMinY + insetMaxY) * 0.5);
      }

      for (let rowIdx = 0; rowIdx < scanYs.length; rowIdx++) {
        const y = scanYs[rowIdx];
        const xInts = [];

        for (let s = 0; s < segments.length; s++) {
          const seg = segments[s];
          if ((seg.y1 <= y && seg.y2 > y) || (seg.y2 <= y && seg.y1 > y)) {
            const t = (y - seg.y1) / (seg.y2 - seg.y1);
            xInts.push(seg.x1 + t * (seg.x2 - seg.x1));
          }
        }

        if (xInts.length < 2) continue;
        xInts.sort((a, b) => a - b);

        const intervals = [];
        for (let k = 0; k + 1 < xInts.length; k += 2) {
          // Terminate inside the shape by line spacing (stepY) on both ends
          const x1 = xInts[k] + stepY;
          const x2 = xInts[k + 1] - stepY;
          if (x2 - x1 > 1e-5) {
            intervals.push([x1, x2]);
          }
        }

        if (rowIdx % 2 === 1) {
          intervals.reverse();
          for (let m = 0; m < intervals.length; m++) {
            const [x1, x2] = intervals[m];
            const scanPath = [
              { x: x2, y, power: groupPower },
              { x: x1, y, power: groupPower }
            ];
            if (groupPower !== undefined) scanPath.power = groupPower;
            scanPath.isFillScanline = true;
            scanPath.fillGroupId = gid;
            result.push(scanPath);
          }
        } else {
          for (let m = 0; m < intervals.length; m++) {
            const [x1, x2] = intervals[m];
            const scanPath = [
              { x: x1, y, power: groupPower },
              { x: x2, y, power: groupPower }
            ];
            if (groupPower !== undefined) scanPath.power = groupPower;
            scanPath.isFillScanline = true;
            scanPath.fillGroupId = gid;
            result.push(scanPath);
          }
        }
      }
    }

    return result;
  }

  /**
   * Nearest-Neighbor Path Optimization to minimize rapid travel.
   * If paths have explicit distinct power levels (e.g. calibration columns),
   * optimizes within each power group in ascending order while carrying head position across groups.
   */
  function optimizePathOrder(paths) {
    if (!paths || paths.length <= 1) return paths;

    // Find top-left starting anchor so left-to-right designs begin cleanly on the left
    let minX = Infinity, maxY = -Infinity;
    for (const p of paths) {
      if (!p || !p.length) continue;
      for (const pt of p) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
    }
    let currentPos = (minX !== Infinity) ? { x: minX, y: maxY } : { x: 0, y: 0 };

    // Partition by explicit power if multiple distinct power levels exist
    const powerGroups = new Map();
    for (const p of paths) {
      if (!p || p.length < 2) continue;
      const pwr = p.power !== undefined ? p.power : (p[0].power !== undefined ? p[0].power : -1);
      if (!powerGroups.has(pwr)) powerGroups.set(pwr, []);
      powerGroups.get(pwr).push(p);
    }

    const sortedKeys = Array.from(powerGroups.keys()).sort((a, b) => a - b);
    const ordered = [];

    for (const key of sortedKeys) {
      const groupPaths = powerGroups.get(key);
      const outlineRemaining = [];
      const fillBlocksMap = new Map();
      const fillBlocks = [];

      for (const p of groupPaths) {
        if (p.isFillScanline) {
          const gid = p.fillGroupId || 1;
          if (!fillBlocksMap.has(gid)) {
            const block = [];
            fillBlocksMap.set(gid, block);
            fillBlocks.push(block);
          }
          fillBlocksMap.get(gid).push(p);
        } else {
          outlineRemaining.push(p);
        }
      }

      while (outlineRemaining.length > 0) {
        let bestIdx = 0;
        let bestDist = Infinity;
        let shouldReverse = false;

        for (let i = 0; i < outlineRemaining.length; i++) {
          const p = outlineRemaining[i];
          const start = p[0];
          const end = p[p.length - 1];

          const distStart = Math.hypot(start.x - currentPos.x, start.y - currentPos.y);
          const distEnd = Math.hypot(end.x - currentPos.x, end.y - currentPos.y);

          if (distStart < bestDist) {
            bestDist = distStart;
            bestIdx = i;
            shouldReverse = false;
          }
          if (!p.isCircle && distEnd < bestDist) {
            bestDist = distEnd;
            bestIdx = i;
            shouldReverse = true;
          }
        }

        const chosen = outlineRemaining.splice(bestIdx, 1)[0];
        if (shouldReverse) {
          chosen.reverse();
        }
        ordered.push(chosen);
        currentPos = chosen[chosen.length - 1];
      }

      // Append filled scanline blocks in nearest-neighbor block order without scrambling internal scanlines
      while (fillBlocks.length > 0) {
        let bestBlockIdx = 0;
        let bestBlockDist = Infinity;
        for (let b = 0; b < fillBlocks.length; b++) {
          const firstScan = fillBlocks[b][0];
          const startPt = firstScan[0];
          const d = Math.hypot(startPt.x - currentPos.x, startPt.y - currentPos.y);
          if (d < bestBlockDist) {
            bestBlockDist = d;
            bestBlockIdx = b;
          }
        }
        const chosenBlock = fillBlocks.splice(bestBlockIdx, 1)[0];
        for (let s = 0; s < chosenBlock.length; s++) {
          ordered.push(chosenBlock[s]);
        }
        const lastScan = chosenBlock[chosenBlock.length - 1];
        currentPos = lastScan[lastScan.length - 1];
      }
    }

    return ordered;
  }

  /**
   * Generate G-code from transformed paths
   */
  function generateGcode(paths, options) {
    const {
      units = 'metric',       // 'metric' (mm) or 'standard' (inches)
      laserPower = 100,       // 1 to 100 (%)
      maxPwm = 100,           // Max S value corresponding to 100% power (default 100)
      cutFeedrate = 1000,     // mm/min or in/min
      rapidFeedrate = 3000,   // mm/min or in/min
      linuxCNC = false,       // wrap in '%'
      prefixGcode = '',
      postfixGcode = '',
      optimizeTravel = true,
      laserOnCmd = 'M3',      // M3
      laserOffCmd = 'M5',     // M5
      laserMode = 'discrete', // 'discrete' (M3 Sxxx / M5 per stroke) or 'inline' (G1 ... Sxxx)
      variablePower = false   // if true, pt.power overrides laserPower
    } = options;

    const precision = units === 'standard' ? 4 : 3;
    const fmt = n => Number(n).toFixed(precision);
    const toPwm = pct => Math.max(0, Math.min(maxPwm, Math.round((pct / 100) * maxPwm)));

    // Optimize paths order
    const orderedPaths = optimizeTravel ? optimizePathOrder(paths) : paths;

    const gcodeLines = [];

    // 1. LinuxCNC start marker
    if (linuxCNC) {
      gcodeLines.push('%');
    }

    // 2. Header comment
    gcodeLines.push(`(Dangerous Laser G-Code)`);
    gcodeLines.push(`(Units: ${units === 'standard' ? 'Inches G20' : 'Millimeters G21'})`);
    gcodeLines.push(`(Cut Feedrate: ${cutFeedrate} | Rapid Feedrate: ${rapidFeedrate} | Power: ${laserPower}% | Max PWM: S${maxPwm})`);

    // 3. User prefix
    if (prefixGcode && prefixGcode.trim()) {
      gcodeLines.push(`(--- Custom Prefix Start ---)`);
      const prefixLines = prefixGcode.trim().split('\n');
      for (const line of prefixLines) {
        gcodeLines.push(line.trim());
      }
      gcodeLines.push(`(--- Custom Prefix End ---)`);
    } else {
      // Sensible default safety & setup header
      gcodeLines.push('G90 (Absolute coordinates)');
      gcodeLines.push(units === 'standard' ? 'G20 (Inches)' : 'G21 (Metric mm)');
      gcodeLines.push('G17 (XY plane selection)');
      gcodeLines.push('G94 (Feed per minute mode)');
      gcodeLines.push(`${laserOffCmd} (Ensure laser is off)`);
    }

    // Tracking stats
    let totalCutDist = 0;
    let totalRapidDist = 0;
    let currentX = 0;
    let currentY = 0;
    let laserIsOn = false;
    let currentFeed = 0;
    let currentS = 0;

    // 4. Toolpath execution
    for (let pathIdx = 0; pathIdx < orderedPaths.length; pathIdx++) {
      const path = orderedPaths[pathIdx];
      if (!path || path.length < 2) continue;

      const startPt = path.isCircle ? { x: path.cx - path.r, y: path.cy } : path[0];

      // Rapid move to start of path (ensure laser is OFF)
      if (laserIsOn) {
        gcodeLines.push(laserOffCmd);
        laserIsOn = false;
      }

      const rapidDist = Math.hypot(startPt.x - currentX, startPt.y - currentY);
      if (rapidDist > 1e-5) {
        totalRapidDist += rapidDist;
        path.rapidLineIdx = gcodeLines.length;
        gcodeLines.push(`G0 X${fmt(startPt.x)} Y${fmt(startPt.y)}`);
        currentX = startPt.x;
        currentY = startPt.y;
      } else {
        path.rapidLineIdx = gcodeLines.length - 1;
      }

      // Determine power for this stroke (supports per-element SVG data-power and raster PWM)
      const explicitPower = (path[1] && path[1].power !== undefined)
        ? path[1].power
        : (startPt.power !== undefined ? startPt.power : path.power);
      const pathPowerPct = (explicitPower !== undefined) ? explicitPower : laserPower;
      const pathPwmS = toPwm(pathPowerPct);

      // Turn laser ON
      if (!laserIsOn || currentS !== pathPwmS) {
        gcodeLines.push(`${laserOnCmd} S${pathPwmS}`);
        laserIsOn = true;
        currentS = pathPwmS;
      }

      path.cutLineIdx = gcodeLines.length;

      // Handle true CNC circular arc
      if (path.isCircle) {
        const cX = path.cx;
        const cY = path.cy;
        const r = path.r;

        // Two 180-deg G2 circular arcs (standard CNC circle)
        path.arc1LineIdx = gcodeLines.length;
        let line1 = `G2 X${fmt(cX + r)} Y${fmt(cY)} I${fmt(r)} J${fmt(0)}`;
        if (currentFeed !== cutFeedrate) {
          line1 += ` F${cutFeedrate}`;
          currentFeed = cutFeedrate;
        }
        gcodeLines.push(line1);

        path.arc2LineIdx = gcodeLines.length;
        gcodeLines.push(`G2 X${fmt(cX - r)} Y${fmt(cY)} I${fmt(-r)} J${fmt(0)}`);

        currentX = cX - r;
        currentY = cY;
        totalCutDist += 2 * Math.PI * r;

        gcodeLines.push(laserOffCmd);
        laserIsOn = false;
        continue;
      }

      // Cut along path
      for (let i = 1; i < path.length; i++) {
        const pt = path[i];
        const ptDist = Math.hypot(pt.x - currentX, pt.y - currentY);
        if (ptDist > 1e-5) {
          totalCutDist += ptDist;

          let line = `G1 X${fmt(pt.x)} Y${fmt(pt.y)}`;
          if (currentFeed !== cutFeedrate) {
            line += ` F${cutFeedrate}`;
            currentFeed = cutFeedrate;
          }

          // In variable power scanline mode, power can change per segment
          if (variablePower && pt.power !== undefined) {
            const segPwmS = toPwm(pt.power);
            if (segPwmS !== currentS) {
              line += ` S${segPwmS}`;
              currentS = segPwmS;
            }
          }

          pt.gcodeLineIdx = gcodeLines.length;
          gcodeLines.push(line);
          currentX = pt.x;
          currentY = pt.y;
        }
      }

      // Laser OFF after stroke
      gcodeLines.push(laserOffCmd);
      laserIsOn = false;
    }

    // Ensure laser is off at end
    if (laserIsOn) {
      gcodeLines.push(laserOffCmd);
      laserIsOn = false;
    }

    // 5. User postfix
    if (postfixGcode && postfixGcode.trim()) {
      gcodeLines.push(`(--- Custom Postfix Start ---)`);
      const postfixLines = postfixGcode.trim().split('\n');
      for (const line of postfixLines) {
        gcodeLines.push(line.trim());
      }
      gcodeLines.push(`(--- Custom Postfix End ---)`);
    } else {
      gcodeLines.push(`${laserOffCmd} (Laser off)`);
      gcodeLines.push('G0 X0 Y0 (Return to origin)');
      gcodeLines.push('M2 (Program End)');
    }

    // 6. LinuxCNC end marker
    if (linuxCNC) {
      gcodeLines.push('%');
    }

    // Time estimate in minutes
    const cutTimeMin = cutFeedrate > 0 ? (totalCutDist / cutFeedrate) : 0;
    const rapidTimeMin = rapidFeedrate > 0 ? (totalRapidDist / rapidFeedrate) : 0;
    // Add small acceleration penalty: ~0.05 sec per path pierce
    const piercesTimeMin = (orderedPaths.length * 0.05) / 60;
    const totalEstTimeMin = cutTimeMin + rapidTimeMin + piercesTimeMin;

    const lineCharRanges = [];
    let charOffset = 0;
    for (const line of gcodeLines) {
      lineCharRanges.push({ start: charOffset, end: charOffset + line.length });
      charOffset += line.length + 1;
    }

    return {
      gcode: gcodeLines.join('\n'),
      lineCount: gcodeLines.length,
      lineCharRanges,
      orderedPaths,
      stats: {
        totalCutDist,
        totalRapidDist,
        totalPaths: orderedPaths.length,
        estTimeMinutes: totalEstTimeMin,
        units
      }
    };
  }

  return {
    transformPaths,
    optimizePathOrder,
    generateGcode
  };
})();
