const { app, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

const W = 320;
const H = 68;
const WIN_H = 120; // tall enough for pill + confirm tooltip below it

let win = null;
let pillX = 0;
let pillY = 0;
let shown = false;
let hideTimer = null;
let pollTimer = null;
let statsProc = null;
let confirmShowing = false;
let isDraggingWindow = false;
let dragTimer = null;

let _up = 0,
  _dn = 0,
  _cpu = 0;

// ── stats ─────────────────────────────────────────────────────────────────────
function launchStats(exe) {
  const script = app.isPackaged
    ? path.join(process.resourcesPath, "stats.py")
    : path.join(__dirname, "stats.py");

  const proc = spawn(exe, [script], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
  });

  let buf = "";
  proc.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line[0] !== "{") continue;
      try {
        const s = JSON.parse(line);
        if (s.dn != null) _dn = s.dn;
        if (s.up != null) _up = s.up;
        if (s.cpu != null) _cpu = s.cpu;
      } catch (_) {}
    }
  });

  proc.on("error", (err) => {
    statsProc = null;
    if (err.code === "ENOENT" && exe === "pythonw") launchStats("python");
    else setTimeout(startStats, 4000);
  });

  proc.on("exit", () => {
    statsProc = null;
    setTimeout(startStats, 4000);
  });

  return proc;
}

function startStats() {
  statsProc = launchStats(process.platform === "win32" ? "pythonw" : "python3");
}

function offscreenY() {
  return screen.getPrimaryDisplay().workArea.y - H - 10;
}

function show() {
  if (shown) return;
  shown = true;
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  // Only change Y — pass X through from getBounds untouched to avoid DPI drift
  const b = win.getBounds();
  pillX = b.x;
  win.setBounds({ x: b.x, y: pillY, width: b.width, height: b.height });
  win.setIgnoreMouseEvents(false);
}

function hide() {
  shown = false;
  hideTimer = null;
  // Only change Y — preserve exact X to avoid rightward drift
  const b = win.getBounds();
  pillX = b.x;
  win.setBounds({ x: b.x, y: offscreenY(), width: b.width, height: b.height });
  win.setIgnoreMouseEvents(true, { forward: true });
}

function scheduleHide() {
  if (!shown || hideTimer) return;
  hideTimer = setTimeout(hide, 1200);
}

function cancelHide() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function startPoll() {
  pollTimer = setInterval(() => {
    if (isDraggingWindow) {
      cancelHide();
      return;
    }

    const { x, y } = screen.getCursorScreenPoint();
    const inCorner = x <= 4 && y <= 10;

    if (!shown) {
      if (inCorner) show();
      return;
    }

    const pad = 14;
    const currentH = confirmShowing ? WIN_H : H;
    const overPill =
      x >= pillX - pad &&
      x <= pillX + W + pad &&
      y >= pillY - pad &&
      y <= pillY + currentH + pad;

    if (overPill || inCorner) {
      cancelHide();
      if (overPill) {
        win.setIgnoreMouseEvents(false);
      } else {
        win.setIgnoreMouseEvents(true, { forward: true });
      }
    } else {
      scheduleHide();
    }
  }, 150);
}

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.handle("stats", () => ({ up: _up, dn: _dn, cpu: _cpu }));

ipcMain.handle("do-quit", async () => {
  if (statsProc) {
    try {
      statsProc.kill();
    } catch (_) {}
    statsProc = null;
  }
  if (win && !win.isDestroyed() && win.webContents && win.webContents.session) {
    try {
      const p = win.webContents.session.flushStorageData();
      if (p && typeof p.catch === "function") {
        p.catch(() => {});
      }
    } catch (_) {}
  }
  setTimeout(() => app.exit(0), 50);
});

ipcMain.on("drag-status", (event, status) => {
  isDraggingWindow = status;
});

ipcMain.on("set-window-position", (event, { x }) => {
  if (!win) return;

  const { bounds } = screen.getPrimaryDisplay();
  const visibleMargin = 50; // Keep at least 50px of the window visible on screen
  const minX = bounds.x - W + visibleMargin;
  const maxX = bounds.x + bounds.width - visibleMargin;

  let nextX = x;

  if (nextX < minX) nextX = minX;
  if (nextX > maxX) nextX = maxX;

  const rounded = Math.round(nextX);
  if (rounded === pillX) return;

  pillX = rounded;
  win.setPosition(pillX, pillY, false);
});

ipcMain.on("confirm-status", (event, status) => {
  confirmShowing = status;
});

ipcMain.on("reset-position", () => {
  if (!win) return;
  const wa = screen.getPrimaryDisplay().workArea;
  pillX = wa.x + Math.round((wa.width - W) / 2) - 15;
  pillY = wa.y;
  console.log(`[MAIN RESET] reset pillX to ${pillX}`);
  if (shown) win.setPosition(pillX, pillY, false);
});

// ── bootstrap ─────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  app.setAppUserModelId("com.netwidget.app");

  const wa = screen.getPrimaryDisplay().workArea;
  // Always centered horizontally, top of workarea
  pillX = wa.x + Math.round((wa.width - W) / 2) - 15;
  pillY = wa.y;

  win = new BrowserWindow({
    width: W,
    height: WIN_H,
    x: pillX,
    y: offscreenY(),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  win.setIgnoreMouseEvents(true, { forward: true });
  win.setAlwaysOnTop(true, "screen-saver", 1);
  win.loadFile("index.html");

  win.webContents.once("did-finish-load", () => {
    startStats();
    startPoll();
  });

  app.setLoginItemSettings({ openAtLogin: true, name: "NetWidget" });
});

app.on("window-all-closed", () => {
  if (pollTimer) clearInterval(pollTimer);
  if (statsProc) {
    try {
      statsProc.kill();
    } catch (_) {}
  }
  app.exit(0);
});
