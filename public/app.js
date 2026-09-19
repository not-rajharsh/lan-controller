/**
 * app.js — mobile controller logic
 * ---------------------------------------------------------------------
 * LATENCY NOTES:
 * - touchstart/touchmove/touchend only (never `click`) — `click` on
 *   mobile browsers historically waits ~300ms to rule out a double-tap
 *   zoom gesture. touch-action: none in CSS + these raw handlers give
 *   input the instant the finger moves, no synthetic delay.
 * - Every handler calls e.preventDefault() immediately to stop the
 *   browser doing anything else (scrolling, zoom, ghost clicks).
 * - WASD/buttons/scroll packets are edge-triggered (sent only on state
 *   change or on each discrete "notch"), never on a fixed timer. Look-
 *   around deltas are sent per touchmove since they're continuous data,
 *   naturally rate-limited by the device's own touch sampling rate.
 * - Joystick visuals update via translate3d()/requestAnimationFrame so
 *   rendering never blocks input handling.
 *
 * LAYOUT SYSTEM:
 * - Every control (joystick, 3 buttons, scroll wheel) has a position
 *   (xPct/yPct — % of viewport, since the elements are position:fixed)
 *   and a size, stored in `layout` and persisted to localStorage.
 * - Toggling "Edit Layout" in settings puts the page in edit mode:
 *   dragging a control moves it, dragging its blue corner dot resizes
 *   it. Normal game-input handling is disabled while in edit mode.
 * ---------------------------------------------------------------------
 */

const socket = io({
  transports: ['websocket'],
  upgrade: false,
  reconnectionDelay: 300,
  reconnectionDelayMax: 1000,
});

const statusEl = document.getElementById('status');
socket.on('connect', () => {
  statusEl.textContent = 'Connected';
  statusEl.className = 'status connected';
});
socket.on('disconnect', () => {
  statusEl.textContent = 'Disconnected';
  statusEl.className = 'status disconnected';
});

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// =======================================================================
// LAYOUT (positions/sizes) + SETTINGS — persisted locally
// =======================================================================

const DEFAULT_LAYOUT = {
  joystick: { xPct: 20, yPct: 62, size: 220 },
  jump:     { xPct: 76, yPct: 78, size: 68 },
  use:      { xPct: 84, yPct: 62, size: 68 },
  attack:   { xPct: 93, yPct: 78, size: 68 },
  scroll:   { xPct: 97, yPct: 45, width: 40, height: 150, enabled: true },
};

const DEFAULT_SETTINGS = {
  lookSensitivity: 1.8,
};

function loadJSON(key, fallback) {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    return saved ? { ...fallback, ...saved } : { ...fallback };
  } catch (_) {
    return { ...fallback };
  }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* ignore */ }
}

let layout = loadJSON('controllerLayout', DEFAULT_LAYOUT);
// Merge per-control defaults too, in case a saved layout predates a new field
for (const key of Object.keys(DEFAULT_LAYOUT)) {
  layout[key] = { ...DEFAULT_LAYOUT[key], ...(layout[key] || {}) };
}
let settings = loadJSON('controllerSettings', DEFAULT_SETTINGS);

let editMode = false;

// ---- DOM refs ----
const joystickBase = document.getElementById('joystickBase');
const joystickStick = document.getElementById('joystickStick');
const btnJump = document.getElementById('btnJump');
const btnUse = document.getElementById('btnUse');
const btnAttack = document.getElementById('btnAttack');
const scrollWheel = document.getElementById('scrollWheel');
const scrollTrack = document.getElementById('scrollTrack');
const lookZone = document.getElementById('lookZone');
const lookHint = document.getElementById('lookHint');

const CONTROLS = [
  { el: joystickBase, key: 'joystick', shape: 'circle', min: 140, max: 320 },
  { el: btnJump,       key: 'jump',    shape: 'circle', min: 44,  max: 110 },
  { el: btnUse,        key: 'use',     shape: 'circle', min: 44,  max: 110 },
  { el: btnAttack,     key: 'attack',  shape: 'circle', min: 44,  max: 110 },
  { el: scrollWheel,   key: 'scroll',  shape: 'rect',   minW: 28, maxW: 90, minH: 80, maxH: 300 },
];

function applyLayoutStyles() {
  for (const { el, key, shape } of CONTROLS) {
    const cfg = layout[key];
    el.style.left = `${cfg.xPct}%`;
    el.style.top = `${cfg.yPct}%`;
    if (shape === 'circle') {
      el.style.width = `${cfg.size}px`;
      el.style.height = `${cfg.size}px`;
    } else {
      el.style.width = `${cfg.width}px`;
      el.style.height = `${cfg.height}px`;
    }
  }
  scrollWheel.style.display = layout.scroll.enabled ? 'flex' : 'none';
}
applyLayoutStyles();

function saveLayout() {
  saveJSON('controllerLayout', layout);
}

// =======================================================================
// SETTINGS PANEL
// =======================================================================

const settingsToggle = document.getElementById('settingsToggle');
const settingsPanel = document.getElementById('settingsPanel');
const settingsClose = document.getElementById('settingsClose');
const editToggle = document.getElementById('editToggle');
const resetLayoutBtn = document.getElementById('resetLayout');
const lookSensitivitySlider = document.getElementById('lookSensitivity');
const scrollEnabledToggle = document.getElementById('scrollEnabledToggle');

lookSensitivitySlider.value = settings.lookSensitivity;
scrollEnabledToggle.checked = layout.scroll.enabled;

settingsToggle.addEventListener('touchstart', (e) => {
  e.preventDefault();
  settingsPanel.classList.toggle('hidden');
});
settingsClose.addEventListener('touchstart', (e) => {
  e.preventDefault();
  settingsPanel.classList.add('hidden');
});

lookSensitivitySlider.addEventListener('input', () => {
  settings.lookSensitivity = Number(lookSensitivitySlider.value);
  saveJSON('controllerSettings', settings);
});

scrollEnabledToggle.addEventListener('change', () => {
  layout.scroll.enabled = scrollEnabledToggle.checked;
  applyLayoutStyles();
  saveLayout();
});

function setEditMode(on) {
  editMode = on;
  document.body.classList.toggle('edit-mode', editMode);
  editToggle.textContent = editMode ? 'Done Editing' : 'Edit Layout';
  editToggle.classList.toggle('active', editMode);
  if (editMode) {
    // Show scroll wheel while editing even if hidden, so it can be
    // repositioned/resized; restore its saved visibility on exit.
    scrollWheel.style.display = 'flex';
  } else {
    applyLayoutStyles();
  }
}

editToggle.addEventListener('touchstart', (e) => {
  e.preventDefault();
  setEditMode(!editMode);
});

resetLayoutBtn.addEventListener('touchstart', (e) => {
  e.preventDefault();
  layout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
  scrollEnabledToggle.checked = layout.scroll.enabled;
  applyLayoutStyles();
  saveLayout();
});

// =======================================================================
// GENERIC DRAG-TO-MOVE / DRAG-TO-RESIZE (edit mode only)
// =======================================================================

function bindDraggable(el, key) {
  let touchId = null;
  let startTouchX = 0, startTouchY = 0, startXPct = 0, startYPct = 0;

  el.addEventListener('touchstart', (e) => {
    if (!editMode) return;
    if (e.target.classList.contains('resize-handle')) return; // handled separately
    e.preventDefault();
    e.stopPropagation();
    if (touchId !== null) return;
    const t = e.changedTouches[0];
    touchId = t.identifier;
    startTouchX = t.clientX;
    startTouchY = t.clientY;
    startXPct = layout[key].xPct;
    startYPct = layout[key].yPct;
  }, { passive: false });

  el.addEventListener('touchmove', (e) => {
    if (!editMode || touchId === null) return;
    e.preventDefault();
    e.stopPropagation();
    for (const t of e.changedTouches) {
      if (t.identifier === touchId) {
        const dxPct = ((t.clientX - startTouchX) / window.innerWidth) * 100;
        const dyPct = ((t.clientY - startTouchY) / window.innerHeight) * 100;
        layout[key].xPct = clamp(startXPct + dxPct, 3, 97);
        layout[key].yPct = clamp(startYPct + dyPct, 5, 95);
        applyLayoutStyles();
        break;
      }
    }
  }, { passive: false });

  function endDrag(e) {
    if (touchId === null) return;
    for (const t of e.changedTouches) {
      if (t.identifier === touchId) {
        touchId = null;
        saveLayout();
        break;
      }
    }
  }
  el.addEventListener('touchend', endDrag, { passive: false });
  el.addEventListener('touchcancel', endDrag, { passive: false });
}

function bindResizable(el, key, opts) {
  const handle = el.querySelector('.resize-handle');
  if (!handle) return;
  let touchId = null;
  let centerX = 0, centerY = 0;

  handle.addEventListener('touchstart', (e) => {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    if (touchId !== null) return;
    const t = e.changedTouches[0];
    touchId = t.identifier;
    const rect = el.getBoundingClientRect();
    centerX = rect.left + rect.width / 2;
    centerY = rect.top + rect.height / 2;
  }, { passive: false });

  handle.addEventListener('touchmove', (e) => {
    if (!editMode || touchId === null) return;
    e.preventDefault();
    e.stopPropagation();
    for (const t of e.changedTouches) {
      if (t.identifier === touchId) {
        if (opts.shape === 'circle') {
          const dist = Math.hypot(t.clientX - centerX, t.clientY - centerY);
          layout[key].size = clamp(Math.round(dist * 2), opts.min, opts.max);
        } else {
          layout[key].width = clamp(Math.round((t.clientX - centerX) * 2), opts.minW, opts.maxW);
          layout[key].height = clamp(Math.round((t.clientY - centerY) * 2), opts.minH, opts.maxH);
        }
        applyLayoutStyles();
        break;
      }
    }
  }, { passive: false });

  function endResize(e) {
    if (touchId === null) return;
    for (const t of e.changedTouches) {
      if (t.identifier === touchId) {
        touchId = null;
        saveLayout();
        break;
      }
    }
  }
  handle.addEventListener('touchend', endResize, { passive: false });
  handle.addEventListener('touchcancel', endResize, { passive: false });
}

for (const control of CONTROLS) {
  bindDraggable(control.el, control.key);
  bindResizable(control.el, control.key, control);
}

// =======================================================================
// JOYSTICK -> WASD
// =======================================================================
// Relative-drag design: direction is computed from how far you've moved
// FROM YOUR TOUCH-DOWN POINT, not from the base's fixed geometric center
// — avoids firing an unintended direction the instant you touch down.
// Hysteresis (separate ENGAGE/RELEASE thresholds) stops flicker when the
// stick sits right at a boundary.

let stickTouchId = null;
let anchorX = 0, anchorY = 0;
let maxRadius = 0;
let activeDirs = new Set();
let pendingDx = 0, pendingDy = 0;
let rafScheduled = false;

const ENGAGE = 0.35;
const RELEASE = 0.20;

function sendKeyChange(newDirs) {
  for (const dir of newDirs) {
    if (!activeDirs.has(dir)) socket.emit('key-down', dir);
  }
  for (const dir of activeDirs) {
    if (!newDirs.has(dir)) socket.emit('key-up', dir);
  }
  activeDirs = newDirs;
}

function updateStickVisual() {
  rafScheduled = false;
  joystickStick.style.transform = `translate3d(${pendingDx}px, ${pendingDy}px, 0)`;
}
function scheduleStickVisual() {
  if (!rafScheduled) {
    rafScheduled = true;
    requestAnimationFrame(updateStickVisual);
  }
}

function applyAxisHysteresis(newDirs, value, negKey, posKey) {
  if (value < -ENGAGE) {
    newDirs.add(negKey); newDirs.delete(posKey);
  } else if (value > ENGAGE) {
    newDirs.add(posKey); newDirs.delete(negKey);
  } else if (value > -RELEASE && value < RELEASE) {
    newDirs.delete(negKey); newDirs.delete(posKey);
  }
}

function handleStickDrag(rawDx, rawDy) {
  const dist = Math.hypot(rawDx, rawDy);
  let dx = rawDx, dy = rawDy;
  if (dist > maxRadius) {
    const scale = maxRadius / dist;
    dx *= scale; dy *= scale;
  }
  pendingDx = dx; pendingDy = dy;
  scheduleStickVisual();

  const nx = dx / maxRadius;
  const ny = dy / maxRadius;
  const newDirs = new Set(activeDirs);
  applyAxisHysteresis(newDirs, ny, 'w', 's');
  applyAxisHysteresis(newDirs, nx, 'a', 'd');
  sendKeyChange(newDirs);
}

function resetStick() {
  pendingDx = 0; pendingDy = 0;
  scheduleStickVisual();
  joystickStick.classList.remove('active');
  sendKeyChange(new Set());
}

joystickBase.addEventListener('touchstart', (e) => {
  if (editMode) return; // let bindDraggable handle it instead
  e.preventDefault();
  if (stickTouchId !== null) return;
  const touch = e.changedTouches[0];
  stickTouchId = touch.identifier;
  anchorX = touch.clientX;
  anchorY = touch.clientY;
  maxRadius = joystickBase.getBoundingClientRect().width / 2;
  joystickStick.classList.add('active');
  handleStickDrag(0, 0);
}, { passive: false });

joystickBase.addEventListener('touchmove', (e) => {
  if (editMode) return;
  e.preventDefault();
  for (const touch of e.changedTouches) {
    if (touch.identifier === stickTouchId) {
      handleStickDrag(touch.clientX - anchorX, touch.clientY - anchorY);
      break;
    }
  }
}, { passive: false });

function endStickTouch(e) {
  if (editMode) return;
  e.preventDefault();
  for (const touch of e.changedTouches) {
    if (touch.identifier === stickTouchId) {
      stickTouchId = null;
      resetStick();
      break;
    }
  }
}
joystickBase.addEventListener('touchend', endStickTouch, { passive: false });
joystickBase.addEventListener('touchcancel', endStickTouch, { passive: false });

// =======================================================================
// LOOK-AROUND PAD (right side) -> relative mouse movement
// =======================================================================

let lookTouchId = null;
let lastLookX = 0, lastLookY = 0;

lookZone.addEventListener('touchstart', (e) => {
  if (editMode) return;
  e.preventDefault();
  if (lookTouchId !== null) return;
  const touch = e.changedTouches[0];
  lookTouchId = touch.identifier;
  lastLookX = touch.clientX;
  lastLookY = touch.clientY;
  if (lookHint) lookHint.style.display = 'none';
}, { passive: false });

lookZone.addEventListener('touchmove', (e) => {
  if (editMode) return;
  e.preventDefault();
  for (const touch of e.changedTouches) {
    if (touch.identifier === lookTouchId) {
      const dx = (touch.clientX - lastLookX) * settings.lookSensitivity;
      const dy = (touch.clientY - lastLookY) * settings.lookSensitivity;
      lastLookX = touch.clientX;
      lastLookY = touch.clientY;
      socket.emit('mouse-move', { dx, dy });
      break;
    }
  }
}, { passive: false });

function endLookTouch(e) {
  if (editMode) return;
  for (const touch of e.changedTouches) {
    if (touch.identifier === lookTouchId) {
      lookTouchId = null;
      break;
    }
  }
}
lookZone.addEventListener('touchend', endLookTouch, { passive: false });
lookZone.addEventListener('touchcancel', endLookTouch, { passive: false });

// =======================================================================
// ACTION BUTTONS -> Attack (LMB) / Use (RMB) / Jump (Space)
// =======================================================================

function bindActionButton(el) {
  const action = el.dataset.action;

  const press = (e) => {
    if (editMode) return;
    e.preventDefault();
    e.stopPropagation();
    el.classList.add('pressed');
    if (action === 'space') socket.emit('key-down', 'space');
    else if (action === 'mouse-left') socket.emit('mouse-down', 'left');
    else if (action === 'mouse-right') socket.emit('mouse-down', 'right');
  };
  const release = (e) => {
    if (editMode) return;
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('pressed');
    if (action === 'space') socket.emit('key-up', 'space');
    else if (action === 'mouse-left') socket.emit('mouse-up', 'left');
    else if (action === 'mouse-right') socket.emit('mouse-up', 'right');
  };

  el.addEventListener('touchstart', press, { passive: false });
  el.addEventListener('touchend', release, { passive: false });
  el.addEventListener('touchcancel', release, { passive: false });
}
[btnJump, btnUse, btnAttack].forEach(bindActionButton);

// =======================================================================
// SCROLL WHEEL -> mouse wheel notches
// =======================================================================
// Swiping up/down accumulates pixel distance and emits one discrete
// 'scroll' event per STEP pixels crossed, like real wheel notches,
// rather than flooding the socket with continuous deltas.

const SCROLL_STEP = 26; // px of swipe per wheel notch

let scrollTouchId = null;
let lastScrollY = 0;
let scrollAccum = 0;

scrollTrack.addEventListener('touchstart', (e) => {
  if (editMode) return;
  e.preventDefault();
  e.stopPropagation();
  if (scrollTouchId !== null) return;
  const t = e.changedTouches[0];
  scrollTouchId = t.identifier;
  lastScrollY = t.clientY;
  scrollAccum = 0;
  scrollTrack.classList.add('active');
}, { passive: false });

scrollTrack.addEventListener('touchmove', (e) => {
  if (editMode) return;
  e.preventDefault();
  e.stopPropagation();
  for (const t of e.changedTouches) {
    if (t.identifier === scrollTouchId) {
      const dy = t.clientY - lastScrollY;
      lastScrollY = t.clientY;
      scrollAccum += dy;
      while (Math.abs(scrollAccum) >= SCROLL_STEP) {
        const direction = scrollAccum > 0 ? 'down' : 'up';
        socket.emit('scroll', { direction });
        scrollAccum += scrollAccum > 0 ? -SCROLL_STEP : SCROLL_STEP;
      }
      break;
    }
  }
}, { passive: false });

function endScrollTouch(e) {
  if (editMode) return;
  for (const t of e.changedTouches) {
    if (t.identifier === scrollTouchId) {
      scrollTouchId = null;
      scrollTrack.classList.remove('active');
      break;
    }
  }
}
scrollTrack.addEventListener('touchend', endScrollTouch, { passive: false });
scrollTrack.addEventListener('touchcancel', endScrollTouch, { passive: false });

// =======================================================================
// SAFETY: if the tab is hidden/backgrounded, release everything so keys
// never get stuck held down in-game.
// =======================================================================
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    sendKeyChange(new Set());
    [btnJump, btnUse, btnAttack].forEach((el) => {
      if (!el.classList.contains('pressed')) return;
      el.classList.remove('pressed');
      const action = el.dataset.action;
      if (action === 'space') socket.emit('key-up', 'space');
      else if (action === 'mouse-left') socket.emit('mouse-up', 'left');
      else if (action === 'mouse-right') socket.emit('mouse-up', 'right');
    });
  }
});
