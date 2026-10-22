/**
 * Dangerous Laser - Sample Test Patterns & SVGs
 * Built-in ready-to-use vector & raster assets for instant testing:
 * 1. Laser Warning Sign (SVG)
 * 2. Power Calibration 10%-100% (9 vertical 1" lines spaced by 0.5" with matching power text labels)
 * 3. Compact 2"x2" Grayscale Laser Printer Test Pattern (Raster)
 */

const SampleData = {
  // Dangerous Laser Warning Emblem (SVG)
  warningLaserSVG: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100mm" height="100mm">
  <!-- Outer Triangle -->
  <polygon points="50,6 94,88 6,88" fill="none" stroke="#000000" stroke-width="3" stroke-linejoin="round"/>
  <!-- Inner Triangle Border -->
  <polygon points="50,14 88,84 12,84" fill="none" stroke="#000000" stroke-width="1.5" stroke-linejoin="round"/>
  <!-- Laser Beam Star / Hazard Burst -->
  <circle cx="50" cy="52" r="6" fill="none" stroke="#000000" stroke-width="2"/>
  <line x1="50" y1="36" x2="50" y2="44" stroke="#000000" stroke-width="2"/>
  <line x1="50" y1="60" x2="50" y2="68" stroke="#000000" stroke-width="2"/>
  <line x1="34" y1="52" x2="42" y2="52" stroke="#000000" stroke-width="2"/>
  <line x1="58" y1="52" x2="66" y2="52" stroke="#000000" stroke-width="2"/>
  <line x1="39" y1="41" x2="44" y2="46" stroke="#000000" stroke-width="2"/>
  <line x1="56" y1="58" x2="61" y2="63" stroke="#000000" stroke-width="2"/>
  <line x1="61" y1="41" x2="56" y2="46" stroke="#000000" stroke-width="2"/>
  <line x1="44" y1="58" x2="39" y2="63" stroke="#000000" stroke-width="2"/>
  <!-- Exclamation Mark / Danger text -->
  <rect x="48" y="70" width="4" height="4" fill="#000000"/>
  <text x="50" y="82" font-size="5.5" font-family="sans-serif" font-weight="bold" text-anchor="middle" fill="#000000">DANGER</text>
</svg>`,

  // Power Calibration Program (9 vertical 1" lines spaced by 0.5", ranging from 10% to 100% power with matching power labels)
  // At 96 DPI: 1.0" = 96px, 0.5" = 48px. ViewBox 432x132 = 4.5" x 1.375"
  powerCalibrationSVG: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 432 132" width="4.5in" height="1.375in">
  <g data-power="10">
    <text x="24" y="20" font-size="11" font-family="sans-serif" font-weight="bold" text-anchor="middle" fill="#000000">10%</text>
    <line x1="24" y1="28" x2="24" y2="124" stroke="#000000" stroke-width="2"/>
  </g>
  <g data-power="20">
    <text x="72" y="20" font-size="11" font-family="sans-serif" font-weight="bold" text-anchor="middle" fill="#000000">20%</text>
    <line x1="72" y1="28" x2="72" y2="124" stroke="#000000" stroke-width="2"/>
  </g>
  <g data-power="30">
    <text x="120" y="20" font-size="11" font-family="sans-serif" font-weight="bold" text-anchor="middle" fill="#000000">30%</text>
    <line x1="120" y1="28" x2="120" y2="124" stroke="#000000" stroke-width="2"/>
  </g>
  <g data-power="40">
    <text x="168" y="20" font-size="11" font-family="sans-serif" font-weight="bold" text-anchor="middle" fill="#000000">40%</text>
    <line x1="168" y1="28" x2="168" y2="124" stroke="#000000" stroke-width="2"/>
  </g>
  <g data-power="50">
    <text x="216" y="20" font-size="11" font-family="sans-serif" font-weight="bold" text-anchor="middle" fill="#000000">50%</text>
    <line x1="216" y1="28" x2="216" y2="124" stroke="#000000" stroke-width="2"/>
  </g>
  <g data-power="60">
    <text x="264" y="20" font-size="11" font-family="sans-serif" font-weight="bold" text-anchor="middle" fill="#000000">60%</text>
    <line x1="264" y1="28" x2="264" y2="124" stroke="#000000" stroke-width="2"/>
  </g>
  <g data-power="75">
    <text x="312" y="20" font-size="11" font-family="sans-serif" font-weight="bold" text-anchor="middle" fill="#000000">75%</text>
    <line x1="312" y1="28" x2="312" y2="124" stroke="#000000" stroke-width="2"/>
  </g>
  <g data-power="90">
    <text x="360" y="20" font-size="11" font-family="sans-serif" font-weight="bold" text-anchor="middle" fill="#000000">90%</text>
    <line x1="360" y1="28" x2="360" y2="124" stroke="#000000" stroke-width="2"/>
  </g>
  <g data-power="100">
    <text x="408" y="20" font-size="11" font-family="sans-serif" font-weight="bold" text-anchor="middle" fill="#000000">100%</text>
    <line x1="408" y1="28" x2="408" y2="124" stroke="#000000" stroke-width="2"/>
  </g>
</svg>`,

  /**
   * Generates a compact 2"x2" (192x192 px at 96 DPI) Grayscale Laser Printer Test Page
   * Features:
   * - Rectangular area with a continuous grayscale gradient & stepped density strip
   * - Circle, Square, and Diamond test targets
   */
  generateTestRasterCanvas: function() {
    const canvas = document.createElement('canvas');
    // 192x192 pixels = 2.0" x 2.0" at 96 DPI (fits inside a 2" cube by default)
    canvas.width = 192;
    canvas.height = 192;
    const ctx = canvas.getContext('2d');

    // 1. Pure white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 192, 192);

    // 2. Outer registration frame
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.strokeRect(6, 6, 180, 180);

    // 3. Rectangular area with continuous grayscale gradient (top half)
    const gradRectX = 16;
    const gradRectY = 16;
    const gradRectW = 160;
    const gradRectH = 54;

    const linGrad = ctx.createLinearGradient(gradRectX, 0, gradRectX + gradRectW, 0);
    linGrad.addColorStop(0.0, '#000000');
    linGrad.addColorStop(0.25, '#404040');
    linGrad.addColorStop(0.5, '#808080');
    linGrad.addColorStop(0.75, '#bfbfbf');
    linGrad.addColorStop(1.0, '#ffffff');

    ctx.fillStyle = linGrad;
    ctx.fillRect(gradRectX, gradRectY, gradRectW, gradRectH);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(gradRectX, gradRectY, gradRectW, gradRectH);

    // 8-step halftone calibration strip right below the gradient rectangle
    const stepY = 76;
    const stepH = 16;
    const steps = 8;
    const stepW = gradRectW / steps;
    for (let i = 0; i < steps; i++) {
      const v = Math.round((i / (steps - 1)) * 255);
      ctx.fillStyle = `rgb(${v}, ${v}, ${v})`;
      ctx.fillRect(gradRectX + i * stepW, stepY, stepW, stepH);
    }
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(gradRectX, stepY, gradRectW, stepH);

    // 4. Geometric Shapes Row: Circle, Square, and Diamond
    const shapesCenterY = 140;

    // (A) CIRCLE (Left: center at x=42, y=140, radius=24)
    const circleGrad = ctx.createRadialGradient(36, 134, 2, 42, shapesCenterY, 24);
    circleGrad.addColorStop(0, '#d0d0d0');
    circleGrad.addColorStop(0.6, '#505050');
    circleGrad.addColorStop(1, '#000000');
    ctx.fillStyle = circleGrad;
    ctx.beginPath();
    ctx.arc(42, shapesCenterY, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000000';
    ctx.stroke();

    // (B) SQUARE (Center: x=74..118, y=116..164, 44x44 px)
    const sqX = 74;
    const sqY = shapesCenterY - 22;
    const sqSize = 44;
    const sqGrad = ctx.createLinearGradient(sqX, sqY, sqX + sqSize, sqY + sqSize);
    sqGrad.addColorStop(0, '#000000');
    sqGrad.addColorStop(0.5, '#666666');
    sqGrad.addColorStop(1, '#cccccc');
    ctx.fillStyle = sqGrad;
    ctx.fillRect(sqX, sqY, sqSize, sqSize);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000000';
    ctx.strokeRect(sqX, sqY, sqSize, sqSize);

    // (C) DIAMOND (Right: center at x=150, y=140, radius=25)
    const diaX = 150;
    const diaY = shapesCenterY;
    const diaR = 25;
    const diaGrad = ctx.createLinearGradient(diaX - diaR, diaY, diaX + diaR, diaY);
    diaGrad.addColorStop(0, '#1a1a1a');
    diaGrad.addColorStop(0.5, '#888888');
    diaGrad.addColorStop(1, '#1a1a1a');
    ctx.fillStyle = diaGrad;
    ctx.beginPath();
    ctx.moveTo(diaX, diaY - diaR);
    ctx.lineTo(diaX + diaR, diaY);
    ctx.lineTo(diaX, diaY + diaR);
    ctx.lineTo(diaX - diaR, diaY);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000000';
    ctx.stroke();

    // Inner solid diamond core for crisp detail check
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.moveTo(diaX, diaY - 9);
    ctx.lineTo(diaX + 9, diaY);
    ctx.lineTo(diaX, diaY + 9);
    ctx.lineTo(diaX - 9, diaY);
    ctx.closePath();
    ctx.fill();

    return canvas;
  }
};
