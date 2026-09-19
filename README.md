# 📱 LAN Game Controller

Turn your **phone into a wireless game controller** for your PC.

This project creates a browser-based controller that connects your phone to your laptop over the **local Wi-Fi/LAN** and translates touch controls into real keyboard and mouse input.

No internet or cloud service is required.

## ✨ Features

- 🎮 Virtual joystick for **W/A/S/D**
- 🖱️ Touch-based mouse/look control
- ⚔️ Attack button → left mouse click
- 🖐️ Use button → right mouse click
- 🦘 Jump button → Space
- 🔄 Vertical scroll wheel
- ⚡ WebSocket-only communication for low latency
- 📱 Designed for mobile landscape mode
- 🎛️ Fully customizable controller layout
- 💾 Layout settings saved locally on the phone
- 🔧 Adjustable look sensitivity
- 🔌 Automatically releases held keys when the phone disconnects
- 🌐 Works entirely over your local network

---

## 🖥️ How It Works

```text
┌────────────────────┐
│       📱 Phone     │
│                    │
│  🎮 Touch Controls │
└─────────┬──────────┘
          │
          │ WebSocket
          │ Local Wi-Fi
          ▼
┌────────────────────┐
│      💻 Laptop     │
│                    │
│  Node.js Server    │
│        ↓           │
│      nut.js        │
│        ↓           │
│  Keyboard / Mouse  │
└─────────┬──────────┘
          │
          ▼
       🎮 Game
```

The phone sends small control events to the Node.js server.

The server then converts those events into real operating-system keyboard and mouse inputs using `@nut-tree-fork/nut-js`.

---

## 🛠️ Tech Stack

- **Node.js**
- **Express**
- **Socket.IO**
- **@nut-tree-fork/nut-js**
- **HTML**
- **CSS**
- **JavaScript**

---

## 📁 Project Structure

```text
phone-controller/
│
├── public/
│   ├── index.html       # Controller interface
│   ├── style.css        # UI styling
│   └── app.js           # Touch controls & Socket.IO logic
│
├── server.js            # Node.js server & OS input handling
├── package.json
├── package-lock.json
└── README.md
```

---

## ⚙️ Requirements

- Node.js **18 or newer**
- A laptop/PC
- A smartphone
- Both devices connected to the **same Wi-Fi/LAN**

Node.js 22+ is recommended.

---

## 🚀 Installation

Clone the repository:

```bash
git clone https://github.com/not-rajharsh/phone-controller.git
cd phone-controller
```

Install dependencies:

```bash
npm install
```

---

## ▶️ Start the Server

Run:

```bash
npm start
```

The server will display something similar to:

```text
=== LAN Game Controller Server ===

Local:   http://localhost:3000
Network (Wi-Fi): http://192.168.1.42:3000
```

---

## 📱 Connect Your Phone

1. Connect your phone and laptop to the **same Wi-Fi network**.
2. Start the server with `npm start`.
3. Find the LAN address printed in the terminal.
4. Open that address on your phone.

For example:

```text
http://192.168.1.42:3000
```

5. Rotate your phone into **landscape mode**.
6. Open your game on the laptop.
7. Make sure the game window has focus.
8. Use your phone as the controller.

---

## 🎮 Controls

| Phone Control | PC Input |
|---|---|
| Joystick Up | `W` |
| Joystick Left | `A` |
| Joystick Down | `S` |
| Joystick Right | `D` |
| Jump | `Space` |
| Attack | Left Mouse Button |
| Use | Right Mouse Button |
| Look Pad | Mouse Movement |
| Scroll Wheel | Mouse Wheel |

---

## 🎛️ Custom Layout

The controller includes an editing mode that allows you to:

- Move controls
- Resize controls
- Change look sensitivity
- Enable/disable the scroll wheel
- Reset the layout

Your customized layout is stored in the phone's browser using:

```text
localStorage
```

The layout is therefore preserved when you reopen the controller.

---

## ⚡ Low-Latency Design

The project was designed specifically for responsive game controls.

### WebSocket-only communication

Socket.IO is configured to use:

```javascript
transports: ['websocket']
```

instead of starting with HTTP long-polling.

### No unnecessary compression

Small controller packets don't benefit much from compression, so per-message compression is disabled.

### Edge-triggered controls

Keyboard and mouse events are only sent when their state changes.

For example:

```text
Touch joystick
      ↓
Direction changes
      ↓
key-down
      ↓
W pressed
```

The application doesn't continuously spam `W` packets every frame.

### Disconnect safety

If the phone disconnects while holding a button, the server releases the corresponding keyboard/mouse inputs.

This prevents situations where a game continues receiving a stuck key after the phone loses connection.

---

## 🌐 Improving Latency

For the best experience:

### 1. Use Ethernet for the laptop

```text
Router ─── Ethernet ─── Laptop
   │
   └────── Wi-Fi ───── Phone
```

This reduces wireless jitter on the laptop side.

### 2. Use 5 GHz / 6 GHz Wi-Fi

Prefer 5 GHz or 6 GHz instead of 2.4 GHz when possible.

### 3. Stay close to the router

Distance and obstacles can increase packet loss and latency.

### 4. Avoid heavy network traffic

Pause large downloads, uploads, or streaming on the same network while playing.

### 5. Disable unnecessary Wi-Fi power saving

Power-saving features can sometimes introduce additional latency.

---

## 🧠 Interesting Implementation Details

### Relative joystick

The joystick calculates direction based on where the user's thumb initially touches rather than requiring the thumb to land exactly in the center.

### Joystick hysteresis

The controller uses different thresholds for engaging and releasing a direction.

This helps prevent rapid switching when the thumb is near a directional boundary.

### Relative mouse movement

The look pad sends movement deltas rather than absolute cursor positions:

```text
Swipe → ΔX, ΔY
          ↓
      Node.js
          ↓
   Current cursor
          ↓
   New cursor position
```

### Scroll conversion

Vertical swipes are converted into discrete mouse-wheel events rather than continuous scrolling.

---

## 🔧 Customizing Controls

Keyboard mappings are defined in:

```text
server.js
```

The main mapping is:

```javascript
const KEY_MAP = {
  w: Key.W,
  a: Key.A,
  s: Key.S,
  d: Key.D,
  space: Key.Space,
};
```

You can modify this mapping to change the keyboard controls.

Button actions can be customized through:

```text
public/index.html
public/app.js
```

---

## 🖥️ OS Support

### Windows

Works without additional accessibility permissions.

### macOS

Node.js may require **Accessibility** permission.

Go to:

```text
System Settings
→ Privacy & Security
→ Accessibility
```

and allow the terminal/Node process.

### Linux

The project currently requires an **X11** environment for OS-level input simulation.

---

## ⚠️ Troubleshooting

### Phone cannot connect

Check:

- Both devices are on the same network.
- The server is running.
- You're using the laptop's LAN IP rather than `localhost`.
- Port `3000` isn't blocked by your firewall.

Example:

```text
http://192.168.1.42:3000
```

### Keyboard/mouse doesn't respond

Make sure:

- The game window has focus.
- The Node.js process has the required OS permissions.
- `npm install` completed successfully.

### `npm install` fails

On Windows, you may need:

- Python
- Visual Studio Build Tools
- Desktop C++ workload

On Debian/Ubuntu:

```bash
sudo apt install build-essential libx11-dev libxtst-dev libpng-dev
```

---

## 🔮 Possible Future Improvements

Some ideas for future versions:

- 🎮 Multiple controller profiles
- 🎯 Game-specific layouts
- 📡 Connection/latency indicator
- 🔐 Optional pairing/authentication
- 🎨 Custom themes
- 🎤 Voice/chat controls
- 🕹️ Analog joystick support
- 📱 PWA installation
- 🔄 Automatic device discovery
- 📊 Real-time latency statistics

---

## 📄 License

Add your preferred license here.

---

## 👨‍💻 Author

**Harsh Raj**

Computer Science student interested in:

- Cybersecurity
- AI/ML
- AI-assisted problem solving
- Systems & networking
- Building practical projects

GitHub:  
https://github.com/not-rajharsh
