/**
 * Dangerous Laser - Application Controller
 * Connects UI controls, SVG parser, Raster engine, G-code generator, and Canvas viewer.
 */

(function() {
  'use strict';

  // Application State
  const state = {
    units: 'standard', // 'standard' (in) is the default; 'metric' (mm)
    theme: 'default',  // 'default' (orange), 'cold-war' (green terminal), 'cool' (bright blue)
    fileType: null,    // 'svg' or 'raster'
    fileName: 'laser_project',

    // Source Mode & Custom Text Options
    sourceMode: 'file', // 'file' or 'text'
    customText: 'DANGEROUS\nLASER',
    customTextFont: 'Arial',
    customTextSize: 0.5, // in current units (0.5 in default)
    customTextJustify: 'center', // 'left', 'center', 'right'
    customTextBold: false,
    customTextItalic: false,
    svgFillSolid: false,

    // Raw loaded data
    svgString: null,
    rawSvgData: null,   // { paths, width, height, bounds, originalWidth, originalHeight }
    rawDocWidthPx: 384, // document width in px (96 DPI)
    rawDocHeightPx: 384,
    rasterImg: null,    // Image element
    processedRaster: null,

    // Dimensions & Transform (default standard inches)
    rawWidth: 4.0,      // in inches
    rawHeight: 4.0,     // in inches
    targetWidth: 4.0,   // in current units
    targetHeight: 4.0,  // in current units
    aspectRatio: 1.0,
    lockAspect: true,
    scalePercent: 100,

    rotationDeg: 0,
    flipH: false,
    flipV: false,
    originAlign: 'center', // Center is the default machine zero
    offsetX: 0,
    offsetY: 0,

    // Laser & Feeds (default standard in/min)
    laserPower: 100,    // 1 to 100 (%)
    maxPwm: 100,        // Max PWM S value (100 default, user configurable)
    cutFeedrate: 40,    // in/min
    rapidFeedrate: 120, // in/min

    // Raster options (default standard inches)
    rasterMode: 'grayscale', // 'dither', 'atkinson', 'grayscale', 'contour'
    lineInterval: 0.008,     // in (~0.2 mm)
    bidirectional: true,
    contrast: 0,
    brightness: 0,
    invert: false,

    // Post processing
    postDelimiter: 'percent', // 'percent' (% default) or 'none'
    linuxCNC: true,           // true when postDelimiter === 'percent'
    prefixGcode: 'G90 (Absolute coordinates)\nG20 (Standard inches)\nG17 (XY plane)\nG94 (Feed per minute)\nM5 (Laser off)',
    postfixGcode: 'M5 (Laser off)\nG0 X0 Y0 (Return home)\nM2 (Program End)',

    // Results
    transformedPaths: [],
    currentGcode: '',
    lineCharRanges: null,
    stats: null
  };

  // DOM Elements
  const DOM = {
    // Header & User Preferences
    fileStatusBadge: document.getElementById('file-status-badge'),
    unitsSelect: document.getElementById('units-select'),
    themeSelect: document.getElementById('theme-select'),

    // File Loading & Custom Text Source
    sourceModeFile: document.getElementById('source-mode-file'),
    sourceModeText: document.getElementById('source-mode-text'),
    sourceFilePanel: document.getElementById('source-file-panel'),
    sourceTextPanel: document.getElementById('source-text-panel'),
    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    samplePicker: document.getElementById('sample-picker'),
    customTextInput: document.getElementById('custom-text-input'),
    customTextFont: document.getElementById('custom-text-font'),
    customTextSize: document.getElementById('custom-text-size'),
    customTextJustify: document.getElementById('custom-text-justify'),
    btnTextBold: document.getElementById('btn-text-bold'),
    btnTextItalic: document.getElementById('btn-text-italic'),
    svgFillOptionRow: document.getElementById('svg-fill-option-row'),
    svgFillSolid: document.getElementById('svg-fill-solid'),

    // Laser & Speeds
    laserPower: document.getElementById('laser-power'),
    laserPowerVal: document.getElementById('laser-power-val'),
    laserPowerHint: document.getElementById('laser-power-hint'),
    maxPwm: document.getElementById('max-pwm'),
    cutFeedrate: document.getElementById('cut-feedrate'),
    rapidFeedrate: document.getElementById('rapid-feedrate'),
    unitSpeedLabels: document.querySelectorAll('.unit-speed-label'),

    // Dimensions
    dimWidth: document.getElementById('dim-width'),
    dimHeight: document.getElementById('dim-height'),
    lockAspect: document.getElementById('lock-aspect'),
    scalePercent: document.getElementById('scale-percent'),
    scalePercentVal: document.getElementById('scale-percent-val'),
    scaleChips: document.querySelectorAll('.btn-chip'),
    unitDimLabels: document.querySelectorAll('.unit-dim-label'),

    // Transform
    rotateDeg: document.getElementById('rotate-deg'),
    rotateDegVal: document.getElementById('rotate-deg-val'),
    btnRot0: document.getElementById('btn-rot-0'),
    btnRot90: document.getElementById('btn-rot-90'),
    btnRot180: document.getElementById('btn-rot-180'),
    btnRot270: document.getElementById('btn-rot-270'),
    btnFlipH: document.getElementById('btn-flip-h'),
    btnFlipV: document.getElementById('btn-flip-v'),
    originAlign: document.getElementById('origin-align'),
    originOffsetX: document.getElementById('origin-offset-x'),
    originOffsetY: document.getElementById('origin-offset-y'),

    // Raster Section
    rasterOptionsSection: document.getElementById('raster-options-section'),
    rasterMode: document.getElementById('raster-mode'),
    lineInterval: document.getElementById('line-interval'),
    rasterBidirectional: document.getElementById('raster-bidirectional'),
    rasterContrast: document.getElementById('raster-contrast'),
    rasterContrastVal: document.getElementById('raster-contrast-val'),
    rasterBrightness: document.getElementById('raster-brightness'),
    rasterBrightnessVal: document.getElementById('raster-brightness-val'),
    rasterInvert: document.getElementById('raster-invert'),

    // Post processing
    postDelimiter: document.getElementById('post-delimiter'),
    gcodePrefix: document.getElementById('gcode-prefix'),
    gcodePostfix: document.getElementById('gcode-postfix'),
    btnGenerateGcode: document.getElementById('btn-generate-gcode'),

    // Center Viewport & Canvas Controls
    toggleLayerImage: document.getElementById('toggle-layer-image'),
    layerImageOpacity: document.getElementById('layer-image-opacity'),
    layerImageOpacityVal: document.getElementById('layer-image-opacity-val'),
    toggleLayerToolpaths: document.getElementById('toggle-layer-toolpaths'),
    toggleLayerRapids: document.getElementById('toggle-layer-rapids'),
    btnZoomIn: document.getElementById('btn-zoom-in'),
    btnZoomOut: document.getElementById('btn-zoom-out'),
    btnFitView: document.getElementById('btn-fit-view'),

    // Simulation
    btnSimPlay: document.getElementById('btn-sim-play'),
    btnSimReset: document.getElementById('btn-sim-reset'),
    simPlayIcon: document.getElementById('sim-play-icon'),
    simPauseIcon: document.getElementById('sim-pause-icon'),
    simBtnText: document.getElementById('sim-btn-text'),
    simSpeedButtons: document.querySelectorAll('.btn-speed'),

    // Right Pane G-Code Output
    gcodeOutput: document.getElementById('gcode-output'),
    gcodeLineBadge: document.getElementById('gcode-line-badge'),
    btnCopyGcode: document.getElementById('btn-copy-gcode'),
    btnDownloadGcode: document.getElementById('btn-download-gcode'),
    copyToast: document.getElementById('copy-toast'),

    // Stats
    statTime: document.getElementById('stat-time'),
    statCutDist: document.getElementById('stat-cut-dist'),
    statRapidDist: document.getElementById('stat-rapid-dist'),
    statWorkSize: document.getElementById('stat-work-size')
  };

  // Initialize Canvas Viewer
  const viewer = new CanvasViewer.Viewer('canvas-container');
  window.viewer = viewer;
  window.state = state;

  // Debounced update for smooth slider interactions
  let debounceTimer = null;
  function triggerUpdate(delay = 120) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      processAndGenerate();
    }, delay);
  }

  /**
   * Initialize Event Listeners
   */
  function initEvents() {
    // 1. User Preferences: Units & Theme Dropdowns
    if (DOM.unitsSelect) {
      DOM.unitsSelect.addEventListener('change', (e) => {
        setUnits(e.target.value);
      });
    }

    if (DOM.themeSelect) {
      DOM.themeSelect.addEventListener('change', (e) => {
        setTheme(e.target.value);
      });
    }

    // 2. Source Mode Switcher (File / Sample vs Enter Text)
    if (DOM.sourceModeFile && DOM.sourceModeText) {
      DOM.sourceModeFile.addEventListener('click', () => {
        setSourceMode('file');
      });
      DOM.sourceModeText.addEventListener('click', () => {
        setSourceMode('text');
      });
    }

    // Drop Zone & File Input
    DOM.dropZone.addEventListener('click', () => DOM.fileInput.click());
    DOM.fileInput.addEventListener('change', handleFileInput);

    DOM.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      DOM.dropZone.classList.add('dragover');
    });
    DOM.dropZone.addEventListener('dragleave', () => {
      DOM.dropZone.classList.remove('dragover');
    });
    DOM.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      DOM.dropZone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        loadFile(e.dataTransfer.files[0]);
      }
    });

    // Sample Picker
    DOM.samplePicker.addEventListener('change', (e) => {
      const val = e.target.value;
      if (!val) return;
      loadSample(val);
      e.target.value = ''; // Reset select
    });

    // Custom Text Controls
    let textDebounceTimer = null;
    const triggerTextRegen = (delay = 120) => {
      if (textDebounceTimer) clearTimeout(textDebounceTimer);
      textDebounceTimer = setTimeout(() => {
        if (state.sourceMode === 'text') {
          generateCustomTextDesign();
        }
      }, delay);
    };

    if (DOM.customTextInput) {
      DOM.customTextInput.addEventListener('input', (e) => {
        state.customText = e.target.value;
        triggerTextRegen(120);
      });
    }

    if (DOM.customTextFont) {
      DOM.customTextFont.addEventListener('change', (e) => {
        state.customTextFont = e.target.value;
        triggerTextRegen(20);
      });
    }

    if (DOM.customTextSize) {
      const onTextSizeChange = (e) => {
        const val = parseFloat(e.target.value);
        if (val > 0) {
          state.customTextSize = val;
          triggerTextRegen(40);
        }
      };
      DOM.customTextSize.addEventListener('input', onTextSizeChange);
      DOM.customTextSize.addEventListener('change', onTextSizeChange);
    }

    if (DOM.customTextJustify) {
      DOM.customTextJustify.addEventListener('change', (e) => {
        state.customTextJustify = e.target.value;
        triggerTextRegen(20);
      });
    }

    if (DOM.btnTextBold) {
      DOM.btnTextBold.addEventListener('click', () => {
        state.customTextBold = !state.customTextBold;
        DOM.btnTextBold.classList.toggle('active', state.customTextBold);
        DOM.btnTextBold.setAttribute('aria-pressed', state.customTextBold);
        triggerTextRegen(20);
      });
    }

    if (DOM.btnTextItalic) {
      DOM.btnTextItalic.addEventListener('click', () => {
        state.customTextItalic = !state.customTextItalic;
        DOM.btnTextItalic.classList.toggle('active', state.customTextItalic);
        DOM.btnTextItalic.setAttribute('aria-pressed', state.customTextItalic);
        triggerTextRegen(20);
      });
    }

    if (DOM.svgFillSolid) {
      DOM.svgFillSolid.checked = state.svgFillSolid;
      DOM.svgFillSolid.addEventListener('change', (e) => {
        state.svgFillSolid = e.target.checked;
        triggerUpdate(20);
      });
    }

    // 3. Laser Power, Max PWM & Speeds
    const updateLaserPowerDisplay = () => {
      const effectiveS = Math.round((state.laserPower / 100) * state.maxPwm);
      DOM.laserPowerVal.textContent = `${state.laserPower}% (S${effectiveS})`;
      if (DOM.laserPowerHint) {
        DOM.laserPowerHint.textContent = `Range: 1% to 100% (S${state.maxPwm} = 100% full power)`;
      }
    };

    DOM.laserPower.addEventListener('input', (e) => {
      state.laserPower = parseInt(e.target.value, 10);
      updateLaserPowerDisplay();
      triggerUpdate(50);
    });

    if (DOM.maxPwm) {
      DOM.maxPwm.value = state.maxPwm;
      const onMaxPwmChange = (e) => {
        const val = parseInt(e.target.value, 10);
        if (val >= 1) {
          state.maxPwm = val;
          updateLaserPowerDisplay();
          triggerUpdate(20);
        }
      };
      DOM.maxPwm.addEventListener('input', onMaxPwmChange);
      DOM.maxPwm.addEventListener('change', onMaxPwmChange);
    }

    DOM.cutFeedrate.addEventListener('change', (e) => {
      state.cutFeedrate = Math.max(1, parseFloat(e.target.value) || 40);
      triggerUpdate(10);
    });

    DOM.rapidFeedrate.addEventListener('change', (e) => {
      state.rapidFeedrate = Math.max(1, parseFloat(e.target.value) || 120);
      triggerUpdate(10);
    });

    // 4. Dimensions & Scaling
    DOM.dimWidth.addEventListener('input', () => {
      const val = parseFloat(DOM.dimWidth.value);
      if (val > 0) {
        state.targetWidth = val;
        if (state.lockAspect && state.aspectRatio > 0) {
          state.targetHeight = val / state.aspectRatio;
          DOM.dimHeight.value = Number(state.targetHeight).toFixed(state.units === 'standard' ? 3 : 1);
        }
        triggerUpdate();
      }
    });

    DOM.dimHeight.addEventListener('input', () => {
      const val = parseFloat(DOM.dimHeight.value);
      if (val > 0) {
        state.targetHeight = val;
        if (state.lockAspect && state.aspectRatio > 0) {
          state.targetWidth = val * state.aspectRatio;
          DOM.dimWidth.value = Number(state.targetWidth).toFixed(state.units === 'standard' ? 3 : 1);
        }
        triggerUpdate();
      }
    });

    DOM.lockAspect.addEventListener('change', (e) => {
      state.lockAspect = e.target.checked;
      if (state.lockAspect && state.targetHeight > 0) {
        state.aspectRatio = state.targetWidth / state.targetHeight;
      }
    });

    DOM.scalePercent.addEventListener('input', (e) => {
      const p = parseInt(e.target.value, 10);
      state.scalePercent = p;
      DOM.scalePercentVal.textContent = `${p}%`;
      applyScalePercentage(p);
      triggerUpdate();
    });

    DOM.scaleChips.forEach(chip => {
      chip.addEventListener('click', () => {
        DOM.scaleChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const p = parseInt(chip.dataset.scale, 10);
        state.scalePercent = p;
        DOM.scalePercent.value = p;
        DOM.scalePercentVal.textContent = `${p}%`;
        applyScalePercentage(p);
        triggerUpdate();
      });
    });

    // 5. Transformations
    DOM.rotateDeg.addEventListener('input', (e) => {
      state.rotationDeg = parseInt(e.target.value, 10);
      DOM.rotateDegVal.textContent = `${state.rotationDeg}°`;
      triggerUpdate(50);
    });

    DOM.btnRot0.addEventListener('click', () => setRotation(0));
    DOM.btnRot90.addEventListener('click', () => setRotation((state.rotationDeg + 90) % 360));
    DOM.btnRot180.addEventListener('click', () => setRotation(180));
    DOM.btnRot270.addEventListener('click', () => setRotation(270));

    DOM.btnFlipH.addEventListener('click', () => {
      state.flipH = !state.flipH;
      DOM.btnFlipH.classList.toggle('active', state.flipH);
      DOM.btnFlipH.setAttribute('aria-pressed', state.flipH);
      triggerUpdate(10);
    });

    DOM.btnFlipV.addEventListener('click', () => {
      state.flipV = !state.flipV;
      DOM.btnFlipV.classList.toggle('active', state.flipV);
      DOM.btnFlipV.setAttribute('aria-pressed', state.flipV);
      triggerUpdate(10);
    });

    DOM.originAlign.value = state.originAlign;
    DOM.originAlign.addEventListener('change', (e) => {
      state.originAlign = e.target.value;
      triggerUpdate(10);
    });

    if (DOM.originOffsetX) {
      DOM.originOffsetX.value = state.offsetX;
      const onOffsetX = (e) => {
        const val = parseFloat(e.target.value);
        state.offsetX = isNaN(val) ? 0 : val;
        triggerUpdate(20);
      };
      DOM.originOffsetX.addEventListener('input', onOffsetX);
      DOM.originOffsetX.addEventListener('change', onOffsetX);
    }

    if (DOM.originOffsetY) {
      DOM.originOffsetY.value = state.offsetY;
      const onOffsetY = (e) => {
        const val = parseFloat(e.target.value);
        state.offsetY = isNaN(val) ? 0 : val;
        triggerUpdate(20);
      };
      DOM.originOffsetY.addEventListener('input', onOffsetY);
      DOM.originOffsetY.addEventListener('change', onOffsetY);
    }

    // 6. Raster Controls
    DOM.rasterMode.value = state.rasterMode;
    DOM.rasterMode.addEventListener('change', (e) => {
      state.rasterMode = e.target.value;
      triggerUpdate(10);
    });

    DOM.lineInterval.value = state.lineInterval;
    DOM.lineInterval.addEventListener('change', (e) => {
      state.lineInterval = Math.max(0.001, parseFloat(e.target.value) || 0.008);
      triggerUpdate(20);
    });

    DOM.rasterBidirectional.addEventListener('change', (e) => {
      state.bidirectional = e.target.checked;
      triggerUpdate(10);
    });

    DOM.rasterContrast.addEventListener('input', (e) => {
      state.contrast = parseInt(e.target.value, 10);
      DOM.rasterContrastVal.textContent = `${state.contrast}`;
      triggerUpdate(80);
    });

    DOM.rasterBrightness.addEventListener('input', (e) => {
      state.brightness = parseInt(e.target.value, 10);
      DOM.rasterBrightnessVal.textContent = `${state.brightness}`;
      triggerUpdate(80);
    });

    DOM.rasterInvert.addEventListener('change', (e) => {
      state.invert = e.target.checked;
      triggerUpdate(10);
    });

    // 7. Post Processing & Start/End Delimiter
    if (DOM.postDelimiter) {
      DOM.postDelimiter.value = state.postDelimiter;
      DOM.postDelimiter.addEventListener('change', (e) => {
        state.postDelimiter = e.target.value;
        state.linuxCNC = (state.postDelimiter === 'percent');
        triggerUpdate(10);
      });
    }

    DOM.gcodePrefix.value = state.prefixGcode;
    DOM.gcodePrefix.addEventListener('change', (e) => {
      state.prefixGcode = e.target.value;
      triggerUpdate(10);
    });

    DOM.gcodePostfix.value = state.postfixGcode;
    DOM.gcodePostfix.addEventListener('change', (e) => {
      state.postfixGcode = e.target.value;
      triggerUpdate(10);
    });

    DOM.btnGenerateGcode.addEventListener('click', () => {
      processAndGenerate(true);
    });

    // 8. Canvas Viewport Layer Controls
    DOM.toggleLayerImage.addEventListener('change', (e) => {
      viewer.setImageVisibility(e.target.checked);
    });

    DOM.layerImageOpacity.addEventListener('input', (e) => {
      const op = parseInt(e.target.value, 10) / 100;
      DOM.layerImageOpacityVal.textContent = `${Math.round(op * 100)}%`;
      viewer.setImageOpacity(op);
    });

    DOM.toggleLayerToolpaths.addEventListener('change', (e) => {
      viewer.setToolpathVisibility(e.target.checked);
    });

    DOM.toggleLayerRapids.addEventListener('change', (e) => {
      viewer.setRapidsVisibility(e.target.checked);
    });

    // View Navigation Buttons
    DOM.btnZoomIn.addEventListener('click', () => {
      viewer.zoom = Math.min(50000, viewer.zoom * 1.35);
      viewer.render();
    });
    DOM.btnZoomOut.addEventListener('click', () => {
      viewer.zoom = Math.max(0.05, viewer.zoom / 1.35);
      viewer.render();
    });
    DOM.btnFitView.addEventListener('click', () => {
      viewer.fitToView();
    });

    // 9. Simulation Controls
    DOM.btnSimPlay.addEventListener('click', toggleSimulation);
    if (DOM.btnSimReset) {
      DOM.btnSimReset.addEventListener('click', resetSimulation);
    }

    DOM.simSpeedButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        DOM.simSpeedButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const spd = parseFloat(btn.dataset.speed);
        viewer.setSimulationSpeed(spd);
      });
    });

    // 10. G-Code Copy & Download Actions
    DOM.btnCopyGcode.addEventListener('click', copyGcodeToClipboard);
    DOM.btnDownloadGcode.addEventListener('click', downloadGcodeFile);
  }

  function setTheme(newTheme) {
    state.theme = newTheme;
    document.documentElement.setAttribute('data-theme', newTheme);
    if (DOM.themeSelect && DOM.themeSelect.value !== newTheme) {
      DOM.themeSelect.value = newTheme;
    }
    viewer.setTheme(newTheme);
  }

  function setRotation(deg) {
    state.rotationDeg = deg;
    DOM.rotateDeg.value = deg;
    DOM.rotateDegVal.textContent = `${deg}°`;
    triggerUpdate(10);
  }

  function applyScalePercentage(p) {
    const factor = p / 100;
    state.targetWidth = state.rawWidth * factor;
    state.targetHeight = state.rawHeight * factor;

    DOM.dimWidth.value = Number(state.targetWidth).toFixed(state.units === 'standard' ? 3 : 1);
    DOM.dimHeight.value = Number(state.targetHeight).toFixed(state.units === 'standard' ? 3 : 1);
  }

  function setUnits(newUnits) {
    if (state.units === newUnits) return;
    state.units = newUnits;

    // Update labels in UI
    const isStandard = newUnits === 'standard';
    const dimLabel = isStandard ? 'in' : 'mm';
    const speedLabel = isStandard ? 'in/min' : 'mm/min';

    DOM.unitDimLabels.forEach(el => el.textContent = dimLabel);
    DOM.unitSpeedLabels.forEach(el => el.textContent = speedLabel);

    if (DOM.unitsSelect && DOM.unitsSelect.value !== newUnits) {
      DOM.unitsSelect.value = newUnits;
    }

    // Convert dimensions
    if (isStandard) {
      // mm to inches
      state.rawWidth = state.rawWidth / 25.4;
      state.rawHeight = state.rawHeight / 25.4;
      state.targetWidth = state.targetWidth / 25.4;
      state.targetHeight = state.targetHeight / 25.4;
      state.offsetX = Number((state.offsetX / 25.4).toFixed(3));
      state.offsetY = Number((state.offsetY / 25.4).toFixed(3));
      state.customTextSize = Number((state.customTextSize / 25.4).toFixed(3));
      state.cutFeedrate = Math.max(1, Math.round(state.cutFeedrate / 25.4));
      state.rapidFeedrate = Math.max(1, Math.round(state.rapidFeedrate / 25.4));
      state.lineInterval = Number((state.lineInterval / 25.4).toFixed(3));
      // Update prefix template
      state.prefixGcode = state.prefixGcode.replace('G21', 'G20').replace('Metric mm', 'Standard inches');
    } else {
      // inches to mm
      state.rawWidth = state.rawWidth * 25.4;
      state.rawHeight = state.rawHeight * 25.4;
      state.targetWidth = state.targetWidth * 25.4;
      state.targetHeight = state.targetHeight * 25.4;
      state.offsetX = Number((state.offsetX * 25.4).toFixed(2));
      state.offsetY = Number((state.offsetY * 25.4).toFixed(2));
      state.customTextSize = Number((state.customTextSize * 25.4).toFixed(2));
      state.cutFeedrate = Math.round(state.cutFeedrate * 25.4);
      state.rapidFeedrate = Math.round(state.rapidFeedrate * 25.4);
      state.lineInterval = Number((state.lineInterval * 25.4).toFixed(2));
      // Update prefix template
      state.prefixGcode = state.prefixGcode.replace('G20', 'G21').replace('Standard inches', 'Metric mm');
    }

    DOM.dimWidth.value = Number(state.targetWidth).toFixed(isStandard ? 3 : 1);
    DOM.dimHeight.value = Number(state.targetHeight).toFixed(isStandard ? 3 : 1);
    if (DOM.originOffsetX) DOM.originOffsetX.value = state.offsetX;
    if (DOM.originOffsetY) DOM.originOffsetY.value = state.offsetY;
    if (DOM.customTextSize) DOM.customTextSize.value = state.customTextSize;
    DOM.cutFeedrate.value = state.cutFeedrate;
    DOM.rapidFeedrate.value = state.rapidFeedrate;
    DOM.lineInterval.value = state.lineInterval;
    DOM.gcodePrefix.value = state.prefixGcode;

    viewer.units = newUnits;
    processAndGenerate(true);
  }

  /**
   * Handle user file selection
   */
  function handleFileInput(e) {
    if (e.target.files && e.target.files.length > 0) {
      loadFile(e.target.files[0]);
    }
  }

  function loadFile(file) {
    state.fileName = file.name.replace(/\.[^/.]+$/, "");
    DOM.fileStatusBadge.textContent = file.name;

    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.svg')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        loadSvgString(e.target.result);
      };
      reader.readAsText(file);
    } else {
      // Raster image (PNG, JPG, BMP, WebP)
      const reader = new FileReader();
      reader.onload = (e) => {
        loadRasterDataUrl(e.target.result);
      };
      reader.readAsDataURL(file);
    }
  }

  /**
   * Force all SVG elements to render in pure white (#ffffff)
   * Color of SVG elements will be ignored and always drawn the same regardless of color
   */
  function makeSvgWhite(svgText, docW, docH) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgText, 'image/svg+xml');
      if (doc.querySelector('parsererror')) return svgText;

      const svgRoot = doc.documentElement;
      if (svgRoot && docW > 0 && docH > 0) {
        const wAttr = svgRoot.getAttribute('width');
        const hAttr = svgRoot.getAttribute('height');
        if (!wAttr || wAttr.trim().endsWith('%')) {
          svgRoot.setAttribute('width', `${docW}px`);
        }
        if (!hAttr || hAttr.trim().endsWith('%')) {
          svgRoot.setAttribute('height', `${docH}px`);
        }
      }

      const allElements = doc.querySelectorAll('*');
      allElements.forEach(el => {
        const tag = el.tagName.toLowerCase();
        if (tag === 'svg' || tag === 'defs' || tag === 'metadata') return;
        if (tag === 'style') {
          if (el.textContent) {
            el.textContent = el.textContent
              .replace(/(^|[;{\s])stroke\s*:\s*(?!none\b)[^;}\n]+/gi, '$1stroke: #ffffff')
              .replace(/(^|[;{\s])fill\s*:\s*(?!none\b)[^;}\n]+/gi, '$1fill: #ffffff');
          }
          return;
        }

        // Force stroke to white if stroked
        if (el.hasAttribute('stroke')) {
          const s = el.getAttribute('stroke').trim();
          if (s !== 'none') el.setAttribute('stroke', '#ffffff');
        }

        // Force fill to white if filled
        if (el.hasAttribute('fill')) {
          const f = el.getAttribute('fill').trim();
          if (f !== 'none') el.setAttribute('fill', '#ffffff');
        }

        // If neither fill nor stroke is set on a shape element
        if (!el.hasAttribute('fill') && !el.hasAttribute('stroke')) {
          if (['path', 'rect', 'circle', 'ellipse', 'polygon', 'text', 'tspan'].includes(tag)) {
            el.setAttribute('fill', '#ffffff');
          } else if (['line', 'polyline'].includes(tag)) {
            el.setAttribute('stroke', '#ffffff');
          }
        }

        // Override inline styles
        const style = el.getAttribute('style');
        if (style) {
          let updatedStyle = style
            .replace(/(^|;\s*)stroke\s*:\s*(?!none\b)[^;]+/gi, '$1stroke: #ffffff')
            .replace(/(^|;\s*)fill\s*:\s*(?!none\b)[^;]+/gi, '$1fill: #ffffff');
          el.setAttribute('style', updatedStyle);
        }
      });

      const serializer = new XMLSerializer();
      return serializer.serializeToString(doc);
    } catch (e) {
      console.warn('makeSvgWhite error:', e);
      return svgText;
    }
  }

  function loadSvgString(svgText) {
    try {
      const parsed = SVGParser.parseSVG(svgText);
      state.fileType = 'svg';
      state.svgString = svgText;
      state.rawSvgData = parsed;

      // Extract document canvas dimensions in pixels (96 DPI)
      const docW = parsed.originalWidth || parsed.width || 100;
      const docH = parsed.originalHeight || parsed.height || 100;
      state.rawDocWidthPx = docW;
      state.rawDocHeightPx = docH;

      const pxToIn = 1 / 96;
      const pxToMm = 25.4 / 96;

      if (state.units === 'standard') {
        state.rawWidth = docW * pxToIn;
        state.rawHeight = docH * pxToIn;
      } else {
        state.rawWidth = docW * pxToMm;
        state.rawHeight = docH * pxToMm;
      }

      state.scalePercent = 100;
      DOM.scalePercent.value = 100;
      DOM.scalePercentVal.textContent = '100%';
      DOM.scaleChips.forEach(c => c.classList.toggle('active', c.dataset.scale === '100'));

      state.targetWidth = state.rawWidth;
      state.targetHeight = state.rawHeight;

      state.aspectRatio = state.targetHeight > 0 ? (state.targetWidth / state.targetHeight) : 1.0;
      DOM.dimWidth.value = Number(state.targetWidth).toFixed(state.units === 'standard' ? 3 : 1);
      DOM.dimHeight.value = Number(state.targetHeight).toFixed(state.units === 'standard' ? 3 : 1);

      // Create a pure white preview image from SVG
      const whiteSvgText = makeSvgWhite(svgText, docW, docH);
      const svgBlob = new Blob([whiteSvgText], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        // Also draw onto offscreen canvas with source-in #ffffff to guarantee 100% white pixels across all browsers
        const offCanvas = document.createElement('canvas');
        const w = Math.max(1, Math.round(state.rawDocWidthPx || img.width || 384));
        const h = Math.max(1, Math.round(state.rawDocHeightPx || img.height || 384));
        offCanvas.width = w;
        offCanvas.height = h;
        const offCtx = offCanvas.getContext('2d');
        offCtx.drawImage(img, 0, 0, w, h);
        offCtx.globalCompositeOperation = 'source-in';
        offCtx.fillStyle = '#ffffff';
        offCtx.fillRect(0, 0, w, h);

        state.rasterImg = offCanvas;
        DOM.rasterOptionsSection.style.display = 'none';
        if (DOM.svgFillOptionRow) DOM.svgFillOptionRow.style.display = 'flex';
        processAndGenerate(true);
      };
      img.src = url;

      DOM.rasterOptionsSection.style.display = 'none';
      if (DOM.svgFillOptionRow) DOM.svgFillOptionRow.style.display = 'flex';
      processAndGenerate(true);
    } catch (err) {
      alert('Error parsing SVG file: ' + err.message);
    }
  }

  function loadRasterDataUrl(dataUrl) {
    const img = new Image();
    img.onload = () => {
      state.fileType = 'raster';
      state.rasterImg = img;
      state.rawDocWidthPx = img.width;
      state.rawDocHeightPx = img.height;

      // Default physical size at 96 DPI (e.g. 192x192 px = 2.0" x 2.0" cube fit)
      const pxToIn = 1 / 96;
      const pxToMm = 25.4 / 96;

      if (state.units === 'standard') {
        state.rawWidth = Math.min(6.0, Math.max(0.5, img.width * pxToIn));
        state.rawHeight = (state.rawWidth / img.width) * img.height;
      } else {
        state.rawWidth = Math.min(150, Math.max(12.7, img.width * pxToMm));
        state.rawHeight = (state.rawWidth / img.width) * img.height;
      }

      // Reset scale percent to 100% on new load so 2" sample is 2.0" x 2.0" by default
      state.scalePercent = 100;
      DOM.scalePercent.value = 100;
      DOM.scalePercentVal.textContent = '100%';
      DOM.scaleChips.forEach(c => c.classList.toggle('active', c.dataset.scale === '100'));

      state.targetWidth = state.rawWidth;
      state.targetHeight = state.rawHeight;

      state.aspectRatio = state.targetHeight > 0 ? (state.targetWidth / state.targetHeight) : 1.0;
      DOM.dimWidth.value = Number(state.targetWidth).toFixed(state.units === 'standard' ? 3 : 1);
      DOM.dimHeight.value = Number(state.targetHeight).toFixed(state.units === 'standard' ? 3 : 1);

      DOM.rasterOptionsSection.style.display = 'block';
      if (DOM.svgFillOptionRow) DOM.svgFillOptionRow.style.display = 'none';
      processAndGenerate(true);
    };
    img.src = dataUrl;
  }

  function escapeXml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function setSourceMode(mode) {
    state.sourceMode = mode;
    const isText = mode === 'text';

    if (DOM.sourceModeFile) {
      DOM.sourceModeFile.classList.toggle('active', !isText);
      DOM.sourceModeFile.setAttribute('aria-pressed', !isText);
    }
    if (DOM.sourceModeText) {
      DOM.sourceModeText.classList.toggle('active', isText);
      DOM.sourceModeText.setAttribute('aria-pressed', isText);
    }
    if (DOM.sourceFilePanel) {
      DOM.sourceFilePanel.style.display = isText ? 'none' : 'block';
    }
    if (DOM.sourceTextPanel) {
      DOM.sourceTextPanel.style.display = isText ? 'flex' : 'none';
    }

    if (isText) {
      generateCustomTextDesign();
    }
  }

  function generateCustomTextDesign() {
    resetSimulation();
    const rawText = (DOM.customTextInput ? DOM.customTextInput.value : state.customText) || '';
    state.customText = rawText;

    const lines = rawText.split(/\r?\n/);
    const nonEmptyCount = lines.filter(l => l.trim().length > 0).length;
    if (nonEmptyCount === 0) return;

    const fontFamily = state.customTextFont || 'Arial';
    const fontWeight = state.customTextBold ? 'bold' : 'normal';
    const fontStyle = state.customTextItalic ? 'italic' : 'normal';
    const justify = state.customTextJustify || 'center';

    // Convert user font size (in inches or mm) to 96 DPI SVG user units (px)
    const sizeVal = Math.max(0.01, parseFloat(state.customTextSize) || 0.5);
    const fontSizePx = state.units === 'standard' ? (sizeVal * 96) : (sizeVal * 96 / 25.4);

    // Measure lines on an offscreen canvas to determine tight SVG document dimensions
    const measureCanvas = document.createElement('canvas');
    const mCtx = measureCanvas.getContext('2d');
    mCtx.font = `${fontStyle} ${fontWeight} ${fontSizePx}px "${fontFamily}"`;

    let maxLineWidth = fontSizePx * 0.5;
    for (let i = 0; i < lines.length; i++) {
      const w = mCtx.measureText(lines[i]).width;
      if (w > maxLineWidth) maxLineWidth = w;
    }

    const lineHeight = fontSizePx * 1.25;
    const pad = Math.max(4, Math.ceil(fontSizePx * 0.25));
    const svgW = Math.ceil(maxLineWidth + pad * 2);
    const svgH = Math.ceil(pad * 2 + fontSizePx + Math.max(0, lines.length - 1) * lineHeight + fontSizePx * 0.3);

    let anchor = 'middle';
    let textX = svgW / 2;
    if (justify === 'left') {
      anchor = 'start';
      textX = pad;
    } else if (justify === 'right') {
      anchor = 'end';
      textX = svgW - pad;
    }

    const escapedFont = escapeXml(fontFamily);
    const textElements = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const textY = pad + fontSizePx + i * lineHeight;
      textElements.push(
        `  <text x="${textX.toFixed(2)}" y="${textY.toFixed(2)}" font-family="${escapedFont}" font-size="${fontSizePx.toFixed(2)}" font-weight="${fontWeight}" font-style="${fontStyle}" text-anchor="${anchor}" xml:space="preserve" fill="#000000">${escapeXml(lines[i])}</text>`
      );
    }

    const defsBlock = (fontFamily === 'Army Stencil' && SampleData.armyStencilFontCss)
      ? `  <defs><style>${SampleData.armyStencilFontCss}</style></defs>\n`
      : '';

    const svgString = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}px" height="${svgH}px">\n` +
      defsBlock +
      textElements.join('\n') + `\n</svg>`;

    state.fileName = 'custom_text';
    DOM.fileStatusBadge.textContent = 'Custom Text';
    loadSvgString(svgString);
  }

  function loadSample(key) {
    resetSimulation();
    if (key === 'warning') {
      state.fileName = 'warning_laser';
      DOM.fileStatusBadge.textContent = 'Laser Warning Sign (Sample SVG)';
      loadSvgString(SampleData.warningLaserSVG);
    } else if (key === 'calibration') {
      state.fileName = 'power_calibration_10_100';
      DOM.fileStatusBadge.textContent = 'Power Calibration 10%-100% (SVG)';
      loadSvgString(SampleData.powerCalibrationSVG);
    } else if (key === 'svg_test') {
      state.fileName = 'test';
      DOM.fileStatusBadge.textContent = 'SVG Test';
      loadSvgString(SampleData.svgTestSVG);
    } else if (key === 'raster') {
      state.fileName = 'grayscale_print_test';
      DOM.fileStatusBadge.textContent = 'Grayscale Print Test (2" Sample)';
      const canvas = SampleData.generateTestRasterCanvas();
      loadRasterDataUrl(canvas.toDataURL());
    }
  }

  /**
   * Main Processing & G-Code Generation Pipeline
   */
  function processAndGenerate(autoFit = false) {
    if (!state.fileType) return;

    let rawPaths = [];
    let isVariablePower = false;
    let docW = state.targetWidth;
    let docH = state.targetHeight;

    if (state.fileType === 'svg' && state.rawSvgData) {
      // Raw SVG paths in original document pixel coordinates
      rawPaths = state.rawSvgData.paths;
      docW = state.rawDocWidthPx;
      docH = state.rawDocHeightPx;
    } else if (state.fileType === 'raster' && state.rasterImg) {
      // Calculate raster pixel resolution based on line interval
      const targetW_mm = state.units === 'standard' ? (state.targetWidth * 25.4) : state.targetWidth;
      const targetH_mm = state.units === 'standard' ? (state.targetHeight * 25.4) : state.targetHeight;
      const interval_mm = state.units === 'standard' ? (state.lineInterval * 25.4) : state.lineInterval;

      // Lines count in height
      const numLines = Math.max(10, Math.min(1000, Math.round(targetH_mm / interval_mm)));
      const numCols = Math.max(10, Math.min(1000, Math.round(targetW_mm / interval_mm)));

      // Process raster image
      const processed = RasterEngine.processImageData(state.rasterImg, {
        targetWidthPx: numCols,
        targetHeightPx: numLines,
        brightness: state.brightness,
        contrast: state.contrast,
        invert: state.invert,
        mode: state.rasterMode === 'atkinson' ? 'dither' : state.rasterMode,
        ditherAlgo: state.rasterMode === 'atkinson' ? 'atkinson' : 'floyd-steinberg'
      });

      state.processedRaster = processed;

      if (state.rasterMode === 'dither' || state.rasterMode === 'atkinson') {
        const strokes = RasterEngine.generateDitherScanlines(
          processed.binaryBuffer,
          processed.width,
          processed.height,
          state.targetWidth,
          state.targetHeight,
          { bidirectional: state.bidirectional, maxPower: state.laserPower }
        );
        rawPaths = strokes.map(s => [s.p1, s.p2]);
      } else if (state.rasterMode === 'grayscale') {
        isVariablePower = true;
        rawPaths = RasterEngine.generateGrayscaleScanlines(
          processed.grayBuffer,
          processed.width,
          processed.height,
          state.targetWidth,
          state.targetHeight,
          { bidirectional: state.bidirectional, minPower: 0, maxPower: state.laserPower }
        );
      } else if (state.rasterMode === 'contour') {
        rawPaths = RasterEngine.traceContours(
          processed.binaryBuffer,
          processed.width,
          processed.height,
          state.targetWidth,
          state.targetHeight
        );
      }
      docW = state.targetWidth;
      docH = state.targetHeight;
    }

    // 2. Apply Geometric Transformations (Scale, Rotate, Flip, Origin Align, Offsets, SVG Solid Fill)
    const transformed = GcodeGenerator.transformPaths(rawPaths, {
      targetWidth: state.targetWidth,
      targetHeight: state.targetHeight,
      docWidth: docW,
      docHeight: docH,
      rotationDeg: state.rotationDeg,
      flipH: state.flipH,
      flipV: state.flipV,
      originAlign: state.originAlign,
      offsetX: state.offsetX,
      offsetY: state.offsetY,
      fillSolid: state.fileType === 'svg' && state.svgFillSolid,
      lineInterval: state.lineInterval
    });

    state.transformedPaths = transformed.paths;

    // 3. Generate G-Code Output
    const gcodeResult = GcodeGenerator.generateGcode(transformed.paths, {
      units: state.units,
      laserPower: state.laserPower,
      maxPwm: state.maxPwm,
      cutFeedrate: state.cutFeedrate,
      rapidFeedrate: state.rapidFeedrate,
      linuxCNC: state.linuxCNC,
      prefixGcode: state.prefixGcode,
      postfixGcode: state.postfixGcode,
      optimizeTravel: state.fileType === 'svg', // Optimize SVG vectors
      variablePower: isVariablePower
    });

    state.currentGcode = gcodeResult.gcode;
    state.lineCharRanges = gcodeResult.lineCharRanges;
    state.transformedPaths = gcodeResult.orderedPaths || transformed.paths;
    state.stats = gcodeResult.stats;

    // 4. Update Right Pane UI
    DOM.gcodeOutput.value = state.currentGcode;
    DOM.gcodeLineBadge.textContent = `${gcodeResult.lineCount.toLocaleString()} Lines`;

    // Update Stats
    const unitText = state.units === 'standard' ? 'in' : 'mm';
    DOM.statCutDist.textContent = `${Number(gcodeResult.stats.totalCutDist).toFixed(1)} ${unitText}`;
    DOM.statRapidDist.textContent = `${Number(gcodeResult.stats.totalRapidDist).toFixed(1)} ${unitText}`;
    DOM.statWorkSize.textContent = `${Number(transformed.bounds.width).toFixed(1)} × ${Number(transformed.bounds.height).toFixed(1)} ${unitText}`;

    // Format runtime (MM:SS or HH:MM:SS)
    const totalSecs = Math.round(gcodeResult.stats.estTimeMinutes * 60);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    const timeFormatted = hrs > 0
      ? `${hrs}h ${mins.toString().padStart(2, '0')}m`
      : `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    DOM.statTime.textContent = timeFormatted;

    // 5. Update Center Canvas Viewer
    viewer.setData({
      imageElement: (state.fileType === 'raster' && state.processedRaster) ? state.processedRaster.canvas : state.rasterImg,
      imageTransform: {
        centerX: transformed.center.x,
        centerY: transformed.center.y,
        width: state.targetWidth,
        height: state.targetHeight,
        rotation: state.rotationDeg,
        flipH: state.flipH,
        flipV: state.flipV
      },
      toolpaths: gcodeResult.orderedPaths || transformed.paths,
      bounds: transformed.bounds,
      units: state.units,
      cutFeedrate: state.cutFeedrate,
      rapidFeedrate: state.rapidFeedrate
    });

    if (autoFit) {
      viewer.fitToView();
    }
  }

  /**
   * Highlight active G-Code line in right pane and auto-scroll so it stays in the middle
   * User requirement: "I would expect the highlighted instruction to always be in the middle of the window except when it gets to either end"
   */
  function highlightGcodeLine(lineIdx) {
    if (lineIdx === undefined || lineIdx === null || !state.lineCharRanges || !state.lineCharRanges[lineIdx]) return;
    const range = state.lineCharRanges[lineIdx];
    const textarea = DOM.gcodeOutput;

    // Highlight text
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(range.start, range.end);

    // Dynamic padding and line height directly from computed CSS styles
    const cs = window.getComputedStyle(textarea);
    const paddingTop = parseFloat(cs.paddingTop) || 12;
    const lineHeight = parseFloat(cs.lineHeight) || 17.25;

    // Exact vertical center of this instruction line inside the scrollable content
    const lineCenter = paddingTop + (lineIdx + 0.5) * lineHeight;

    // Center the line in the middle of the window, clamped at either end
    const maxScroll = Math.max(0, textarea.scrollHeight - textarea.clientHeight);
    const targetScrollTop = Math.max(0, Math.min(maxScroll, lineCenter - textarea.clientHeight / 2));
    textarea.scrollTop = targetScrollTop;
  }

  /**
   * Toolpath Simulation Play/Pause & Reset
   * User requirement: The simulate button should always be labeled "Simulate".
   */
  function toggleSimulation() {
    if (viewer.isSimulating) {
      viewer.pauseSimulation();
      DOM.simPlayIcon.style.display = 'block';
      DOM.simPauseIcon.style.display = 'none';
      DOM.simBtnText.textContent = 'Simulate';
    } else {
      if (viewer.simProgress >= 1.0) {
        viewer.setSimulationProgress(0);
      }
      DOM.simPlayIcon.style.display = 'none';
      DOM.simPauseIcon.style.display = 'block';
      DOM.simBtnText.textContent = 'Simulate'; // ALWAYS 'Simulate'

      viewer.startSimulation((progress, isRunning, lineIdx) => {
        if (lineIdx !== undefined) {
          highlightGcodeLine(lineIdx);
        }
        if (!isRunning) {
          DOM.simPlayIcon.style.display = 'block';
          DOM.simPauseIcon.style.display = 'none';
          DOM.simBtnText.textContent = 'Simulate'; // ALWAYS 'Simulate'
        }
      });
    }
  }

  function resetSimulation() {
    viewer.pauseSimulation();
    viewer.setSimulationProgress(0);
    DOM.simPlayIcon.style.display = 'block';
    DOM.simPauseIcon.style.display = 'none';
    DOM.simBtnText.textContent = 'Simulate';
    if (DOM.gcodeOutput) {
      DOM.gcodeOutput.setSelectionRange(0, 0);
      DOM.gcodeOutput.scrollTop = 0;
    }
  }

  /**
   * Copy G-Code to Clipboard
   */
  function copyGcodeToClipboard() {
    if (!state.currentGcode) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(state.currentGcode).then(showCopyToast).catch(() => fallbackCopy());
    } else {
      fallbackCopy();
    }
  }

  function fallbackCopy() {
    DOM.gcodeOutput.select();
    document.execCommand('copy');
    showCopyToast();
  }

  function showCopyToast() {
    DOM.copyToast.classList.add('show');
    setTimeout(() => {
      DOM.copyToast.classList.remove('show');
    }, 2000);
  }

  /**
   * Download .gcode / .ngc File
   */
  function downloadGcodeFile() {
    if (!state.currentGcode) return;

    const ext = state.linuxCNC ? '.ngc' : '.gcode';
    const filename = `${state.fileName || 'dangerous_laser'}${ext}`;
    const blob = new Blob([state.currentGcode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  window.loadSvgString = loadSvgString;
  window.loadRasterDataUrl = loadRasterDataUrl;
  window.highlightGcodeLine = highlightGcodeLine;
  window.resetSimulation = resetSimulation;
  window.setTheme = setTheme;

  // Self-initialization
  initEvents();
  setTheme('default');

  // Preload embedded offline Army Stencil font faces into browser memory
  if (document.fonts && document.fonts.load) {
    document.fonts.load('400 16px "Army Stencil"').catch(() => {});
    document.fonts.load('700 16px "Army Stencil"').catch(() => {});
  }

  // Load default sample on launch so the user is immediately greeted with an active laser design
  loadSample('warning');

})();
