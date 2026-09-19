/**
 * server.js
 * -----------------------------------------------------------------------
 * LAN Game Controller Server
 *
 * - Serves the mobile controller UI (public/) over HTTP.
 * - Opens a Socket.IO connection restricted to WebSocket transport only
 *   (no HTTP long-polling) to minimize handshake and per-message overhead.
 * - Translates incoming controller events into real OS-level keyboard /
 *   mouse events using @nut-tree-fork/nut-js, so any game on the laptop
 *   sees genuine hardware input (works with DirectInput/raw-input games,
 *   unlike some virtual-input approaches).
 *
 * NETWORK LATENCY TIPS (read these!):
 *   1. Connect your laptop to the router via ETHERNET CABLE if possible.
 *      Wi-Fi adds 5-20ms+ of jitter that a cable avoids entirely.
 *   2. Put your phone on the 5GHz (or 6GHz) Wi-Fi band, NOT 2.4GHz.
 *      2.4GHz is slower and far more congested by neighboring networks
 *      and household devices (microwaves, Bluetooth, etc).
 *   3. Use a router with low DFS/AP interference, and keep the phone
 *      close to the access point during play.
 *   4. Disable Wi-Fi power-saving mode on the phone (Android: Settings >
 *      Wi-Fi > Advanced > Wi-Fi power saving; iOS has less control here,
 *      but Low Power Mode should be OFF).
 *   5. Close bandwidth-heavy background apps/downloads on the same LAN.
 *   6. If your router supports it, enable QoS / gaming mode and prioritize
 *      the laptop + phone's traffic.
 * -----------------------------------------------------------------------
 */

const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { Server } = require('socket.io');
const { keyboard, mouse, screen, Key, Button } = require('@nut-tree-fork/nut-js');

// nut-js adds small artificial delays between synthetic key presses by
// default (meant for human-like typing). We want ZERO extra delay since
// we are simulating held-down game input, not typing text.
keyboard.config.autoDelayMs = 0;
mouse.config.autoDelayMs = 0;

// Cache the screen resolution once at startup so look-around mouse
// movement can be clamped to the screen bounds (stops the cursor from
// "getting lost" off-screen). Falls back to a common resolution if
// detection fails for any reason.
let screenWidth = 1920;
let screenHeight = 1080;
(async () => {
  try {
    screenWidth = await screen.width();
    screenHeight = await screen.height();
    console.log(`Detected screen resolution: ${screenWidth}x${screenHeight}`);
  } catch (err) {
    console.warn('Could not detect screen resolution, defaulting to 1920x1080');
  }
})();

const app = express();
const server = http.createServer(app);

// ---- Socket.IO: tuned for minimum latency -------------------------------
const io = new Server(server, {
  // Force pure WebSocket only. Without this, Socket.IO's default transport
  // list is ['polling', 'websocket'], meaning EVERY connection starts on
  // slow HTTP long-polling and only upgrades afterwards, adding real
  // latency to the first moments of every session/reconnect.
  transports: ['websocket'],
  // Disable the built-in per-message-deflate compression. Compression
  // trades CPU + latency for bandwidth; our payloads are a few bytes each,
  // so compression only adds overhead here.
  perMessageDeflate: false,
  // Keep heartbeats tight so dead connections (e.g. phone screen locked,
  // Wi-Fi drop) are detected and cleaned up quickly rather than silently
  // leaving keys "stuck" held down.
  pingInterval: 2000,
  pingTimeout: 5000,
  // Not strictly required for LAN use, restrict if you want to be safe
  // on shared networks.
  cors: { origin: '*' },
});

app.use(express.static(path.join(__dirname, 'public')));

// ---- Input mapping --------------------------------------------------------
// Maps the string identifiers sent from the phone to nut-js Key/Button enums.
const KEY_MAP = {
  w: Key.W,
  a: Key.A,
  s: Key.S,
  d: Key.D,
  space: Key.Space,
};

// Track currently-held keys/buttons PER SOCKET so that if a phone
// disconnects mid-press (Wi-Fi drop, app backgrounded, etc.) we can
// release everything and never leave a key "stuck" down in-game.
function createInputState() {
  return {
    keys: new Set(),   // currently held keyboard keys (string ids)
    mouse: new Set(),  // currently held mouse buttons ('left' | 'right')
    mouseMoveBusy: false, // true while an async mouse.setPosition() is in flight
    pendingDx: 0,       // accumulated look-around delta waiting to be applied
    pendingDy: 0,
  };
}

io.on('connection', (socket) => {
  console.log(`[+] Controller connected: ${socket.id} (${socket.handshake.address})`);
  const state = createInputState();

  // ---- Keyboard (joystick -> WASD, jump -> space) ----
  socket.on('key-down', async (key) => {
    const mapped = KEY_MAP[key];
    if (!mapped || state.keys.has(key)) return; // ignore unknown / repeat
    state.keys.add(key);
    try {
      await keyboard.pressKey(mapped);
    } catch (err) {
      console.error('keyboard.pressKey error:', err.message);
    }
  });

  socket.on('key-up', async (key) => {
    const mapped = KEY_MAP[key];
    if (!mapped || !state.keys.has(key)) return;
    state.keys.delete(key);
    try {
      await keyboard.releaseKey(mapped);
    } catch (err) {
      console.error('keyboard.releaseKey error:', err.message);
    }
  });

  // ---- Mouse (Attack -> left click, Use -> right click) ----
  socket.on('mouse-down', async (button) => {
    if (state.mouse.has(button)) return;
    state.mouse.add(button);
    const btn = button === 'right' ? Button.RIGHT : Button.LEFT;
    try {
      await mouse.pressButton(btn);
    } catch (err) {
      console.error('mouse.pressButton error:', err.message);
    }
  });

  socket.on('mouse-up', async (button) => {
    if (!state.mouse.has(button)) return;
    state.mouse.delete(button);
    const btn = button === 'right' ? Button.RIGHT : Button.LEFT;
    try {
      await mouse.releaseButton(btn);
    } catch (err) {
      console.error('mouse.releaseButton error:', err.message);
    }
  });

  // ---- Look-around (right-side swipe pad -> relative mouse movement) ----
  // We accumulate incoming deltas and apply them with mouse.setPosition()
  // (a direct teleport, not an eased/animated move) so there's no added
  // smoothing latency. A "busy" flag serializes the async get/set position
  // calls so rapid touchmove events can't race each other and corrupt the
  // cursor position — anything that arrives mid-flight is simply added to
  // the pending accumulator and applied on the next tick.
  socket.on('mouse-move', (delta) => {
    if (!delta) return;
    state.pendingDx += delta.dx || 0;
    state.pendingDy += delta.dy || 0;
    flushMouseMove(state);
  });

  async function flushMouseMove(inputState) {
    if (inputState.mouseMoveBusy) return;
    if (inputState.pendingDx === 0 && inputState.pendingDy === 0) return;

    inputState.mouseMoveBusy = true;
    const dx = inputState.pendingDx;
    const dy = inputState.pendingDy;
    inputState.pendingDx = 0;
    inputState.pendingDy = 0;

    try {
      const pos = await mouse.getPosition();
      const nx = Math.max(0, Math.min(screenWidth - 1, Math.round(pos.x + dx)));
      const ny = Math.max(0, Math.min(screenHeight - 1, Math.round(pos.y + dy)));
      await mouse.setPosition({ x: nx, y: ny });
    } catch (err) {
      console.error('mouse move error:', err.message);
    }

    inputState.mouseMoveBusy = false;
    // Handle anything that accumulated while the above await was in flight.
    flushMouseMove(inputState);
  }

  // ---- Scroll wheel (vertical swipe pad -> mouse wheel notches) ----
  socket.on('scroll', async (data) => {
    const direction = data && data.direction === 'up' ? 'up' : 'down';
    try {
      if (direction === 'up') await mouse.scrollUp(1);
      else await mouse.scrollDown(1);
    } catch (err) {
      console.error('mouse scroll error:', err.message);
    }
  });

  // ---- Safety net: release everything on disconnect ----
  socket.on('disconnect', async () => {
    console.log(`[-] Controller disconnected: ${socket.id}`);
    for (const key of state.keys) {
      try { await keyboard.releaseKey(KEY_MAP[key]); } catch (_) {}
    }
    for (const button of state.mouse) {
      try { await mouse.releaseButton(button === 'right' ? Button.RIGHT : Button.LEFT); } catch (_) {}
    }
  });
});

// ---- Helper: print LAN IP addresses on boot so it's easy to connect ------
function getLocalIPs() {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push({ name, address: net.address });
      }
    }
  }
  return results;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n=== LAN Game Controller Server ===');
  console.log(`Local:   http://localhost:${PORT}`);
  const ips = getLocalIPs();
  if (ips.length === 0) {
    console.log('No LAN IPv4 address found — check your network connection.');
  } else {
    ips.forEach(({ name, address }) => {
      console.log(`Network (${name}): http://${address}:${PORT}  <-- open this on your phone`);
    });
  }
  console.log('===================================\n');
});
