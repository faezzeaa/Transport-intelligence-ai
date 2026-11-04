import os
import sys
import time
import subprocess
from pathlib import Path

root_dir = Path(__file__).resolve().parent
backend_dir = root_dir / "backend"
frontend_dir = root_dir / "frontend"
python_exe = backend_dir / ".venv" / "Scripts" / "python.exe"

print(f"[Transport AI] Starting Backend Server (FastAPI on http://127.0.0.1:8000)...")
backend_proc = subprocess.Popen(
    [str(python_exe), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
    cwd=str(backend_dir),
)

print(f"[Transport AI] Starting Frontend Server (Vite on http://127.0.0.1:5173)...")
frontend_proc = subprocess.Popen(
    "npm run dev",
    shell=True,
    cwd=str(frontend_dir),
)

print(f"[Transport AI] Both services launched successfully.")
print(f"  - Frontend: http://127.0.0.1:5173")
print(f"  - Backend:  http://127.0.0.1:8000")
print(f"  - API Docs: http://127.0.0.1:8000/docs")

try:
    while True:
        # Monitor child processes
        b_code = backend_proc.poll()
        f_code = frontend_proc.poll()
        if b_code is not None:
            print(f"[Transport AI] Backend process exited unexpectedly with code {b_code}")
            break
        if f_code is not None:
            print(f"[Transport AI] Frontend process exited unexpectedly with code {f_code}")
            break
        time.sleep(1)
except KeyboardInterrupt:
    print("[Transport AI] Shutting down services...")
finally:
    try:
        backend_proc.terminate()
        frontend_proc.terminate()
    except Exception:
        pass

