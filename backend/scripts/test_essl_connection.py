"""
test_essl_connection.py — verify the backend can talk to the eSSL device.

Connects to the device over TCP, prints firmware / serial / user count /
attendance-log count. Read-only — never mutates the device.

Usage (from the backend directory):
    .\\venv\\Scripts\\python.exe -m scripts.test_essl_connection

Reads config from environment (or .env). Defaults match the X2008 on
192.168.0.201.

Env vars:
    ESSL_DEVICE_IP     default 192.168.0.201
    ESSL_DEVICE_PORT   default 4370
    ESSL_COMM_KEY      default 0 (numeric — 0 for "no password" or
                       the numeric COMM KEY from the device's Comm menu)

Exit codes:
    0 = connected + printed device info
    1 = generic failure (see stderr)
    2 = pyzk not installed
"""

import os
import sys
from datetime import datetime


def main() -> int:

    try:
        from zk import ZK
    except ImportError:
        print(
            "pyzk not installed. Run:\n"
            "    .\\venv\\Scripts\\pip install pyzk==0.9",
            file=sys.stderr
        )
        return 2

    # Best-effort .env load so this can be run standalone.
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except Exception:
        pass

    ip   = os.getenv("ESSL_DEVICE_IP",   "192.168.0.201")
    port = int(os.getenv("ESSL_DEVICE_PORT", "4370"))
    key  = int(os.getenv("ESSL_COMM_KEY", "0"))

    print(f"→ Connecting to eSSL device at {ip}:{port} "
          f"(comm_key={key}) ...")

    zk = ZK(
        ip,
        port=port,
        password=key,
        timeout=10,
        force_udp=False,
        ommit_ping=False,
    )

    conn = None

    try:

        conn = zk.connect()

        print(f"✓ Connected.")
        print()
        print(f"  Firmware version   : {conn.get_firmware_version()}")
        print(f"  Serial number      : {conn.get_serialnumber()}")
        print(f"  Device name        : {conn.get_device_name()}")
        print(f"  Platform           : {conn.get_platform()}")
        print(f"  Device time        : {conn.get_time()}")
        print(f"  Server time        : {datetime.now()}")
        print()

        users = conn.get_users()
        print(f"  Enrolled users     : {len(users)}")

        # Show first 5 users so we can eyeball the ID format
        for u in users[:5]:
            print(f"    - user_id={u.user_id!r}  "
                  f"name={u.name!r}  "
                  f"privilege={u.privilege}  "
                  f"card={u.card!r}")

        if len(users) > 5:
            print(f"    ... ({len(users) - 5} more)")

        print()

        logs = conn.get_attendance()
        print(f"  Attendance logs on device: {len(logs)}")

        for l in logs[-5:]:
            print(f"    - user_id={l.user_id!r}  "
                  f"time={l.timestamp}  "
                  f"punch={l.punch}  "
                  f"status={l.status}")

        print()
        print("Everything looks good — you can now proceed to writing the")
        print("bridge service (backend/app/services/essl_bridge.py).")

        return 0

    except Exception as e:

        print(f"✗ FAILED: {type(e).__name__}: {e}", file=sys.stderr)
        print(file=sys.stderr)
        print("Common causes:", file=sys.stderr)
        print("  • Device unreachable — ping test:", file=sys.stderr)
        print(f"        ping {ip}", file=sys.stderr)
        print("  • TCP port blocked — try:", file=sys.stderr)
        print(f"        Test-NetConnection {ip} -Port {port}", file=sys.stderr)
        print("  • Wrong comm key — check device menu:", file=sys.stderr)
        print("        Menu → Comm → Network → COMM Key", file=sys.stderr)
        print("  • Device on a different subnet — server must be on", file=sys.stderr)
        print("    the same LAN as the device (192.168.0.x)", file=sys.stderr)

        return 1

    finally:

        if conn:
            try:
                conn.disconnect()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
