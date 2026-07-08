"""
stats.py — minimal system stats for NetWidget
Auto-installs psutil if missing, then reads NDIS net counters + PDH CPU.
Outputs one JSON line per second to stdout.
"""
import sys
import subprocess

# Auto-install psutil if not present
try:
    import psutil
except ImportError:
    subprocess.check_call(
        [sys.executable, "-m", "pip", "install", "--quiet", "psutil"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    import psutil

import time
import json
import socket

# Line-buffered stdout so Node gets each line immediately
sys.stdout.reconfigure(line_buffering=True)

def get_active_interface_name():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # Low-level connectionless connect to determine routing interface
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        
        for name, addrs in psutil.net_if_addrs().items():
            for addr in addrs:
                if addr.address == ip:
                    return name
    except Exception:
        pass
    return None

def net_bytes(active_nic=None):
    try:
        counters = psutil.net_io_counters(pernic=True)
        if active_nic and active_nic in counters:
            c = counters[active_nic]
            return c.bytes_recv, c.bytes_sent
    except Exception:
        return 0, 0

    # Fallback to total excluding loopback
    rb = sb = 0
    try:
        for name, c in counters.items():
            lname = name.lower()
            if "loopback" in lname or lname == "lo":
                continue
            rb += c.bytes_recv
            sb += c.bytes_sent
    except Exception:
        pass
    return rb, sb

# Prime CPU counter (first call always returns 0.0)
try:
    psutil.cpu_percent(interval=None)
except Exception:
    pass

# Determine initial active interface
active_nic = get_active_interface_name()
nic_check_counter = 0

# Prime net snapshot
prev_rb, prev_sb = net_bytes(active_nic)
prev_t = time.monotonic()

ema_dn = 0.0
ema_up = 0.0

while True:
    time.sleep(1)

    now = time.monotonic()
    dt  = now - prev_t or 1e-9

    # Periodically refresh the active interface to handle network switches (e.g. Wi-Fi to Ethernet)
    nic_check_counter += 1
    if nic_check_counter >= 10:
        nic_check_counter = 0
        new_nic = get_active_interface_name()
        if new_nic and new_nic != active_nic:
            active_nic = new_nic
            # Reset baseline when adapter changes to prevent massive speed spikes
            prev_rb, prev_sb = net_bytes(active_nic)

    rb, sb = net_bytes(active_nic)

    raw_dn = max(0.0, (rb - prev_rb) / dt)
    raw_up = max(0.0, (sb - prev_sb) / dt)
    prev_rb, prev_sb, prev_t = rb, sb, now

    ema_dn = 0.7 * raw_dn + 0.3 * ema_dn
    ema_up = 0.7 * raw_up + 0.3 * ema_up

    cpu = 0.0
    try:
        cpu = psutil.cpu_percent(interval=None)
    except Exception:
        pass

    sys.stdout.write(json.dumps({
        "dn":  round(ema_dn / 125_000, 2),
        "up":  round(ema_up / 125_000, 2),
        "cpu": round(cpu, 1),
    }) + "\n")
