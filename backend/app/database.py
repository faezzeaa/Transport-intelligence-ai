import os
from pathlib import Path
from typing import Generator, Dict, Any
from urllib.parse import urlparse
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from app.config import get_settings

settings = get_settings()

def get_normalized_database_url(raw_url: str) -> str:
    """Normalize database connection string for SQLAlchemy compatibility."""
    if not raw_url:
        raise ValueError("DATABASE_URL is empty or not configured.")

    # SQLAlchemy 2.0 requires 'postgresql://' or 'postgresql+psycopg2://' instead of legacy 'postgres://'
    if raw_url.startswith("postgres://"):
        return "postgresql+psycopg2://" + raw_url[len("postgres://"):]
    
    if raw_url.startswith("postgresql://") and not raw_url.startswith("postgresql+"):
        return "postgresql+psycopg2://" + raw_url[len("postgresql://"):]

    if raw_url.startswith("sqlite"):
        prefix = "sqlite:///"
        if raw_url.startswith(prefix):
            raw_path = raw_url[len(prefix):]
            if not os.path.isabs(raw_path):
                clean_rel = raw_path.lstrip("./\\")
                backend_dir = Path(__file__).resolve().parent.parent
                canonical_db_path = (backend_dir / clean_rel).resolve()
                return f"sqlite:///{canonical_db_path.as_posix()}"
        return raw_url

    return raw_url


def _resolve_neon_hostaddr(hostname: str) -> Optional[str]:
    """
    Lightweight DNS resolver for Neon PostgreSQL endpoints when local Windows or ISP DNS
    returns RCODE_REFUSED for *.neon.tech domains. Queries public DNS (8.8.8.8 / 1.1.1.1)
    over UDP port 53.
    """
    target = "c-6.us-east-2.aws.neon.tech" if "c-6.us-east-2" in hostname else hostname
    known_ips = ["52.14.39.200", "52.95.251.153", "77.112.100.143"]

    import socket
    import struct

    for dns_ip in ("8.8.8.8", "1.1.1.1"):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.settimeout(2.0)
            header = struct.pack(">HHHHHH", 0x2468, 0x0100, 1, 0, 0, 0)
            question = b""
            for part in target.split("."):
                question += bytes([len(part)]) + part.encode("ascii")
            question += b"\x00" + struct.pack(">HH", 1, 1)
            sock.sendto(header + question, (dns_ip, 53))
            data, _ = sock.recvfrom(1024)
            sock.close()

            offset = 12
            while offset < len(data) and data[offset] != 0:
                if (data[offset] & 0xC0) == 0xC0:
                    offset += 2
                    break
                offset += data[offset] + 1
            else:
                offset += 1
            offset += 4
            while offset < len(data):
                if (data[offset] & 0xC0) == 0xC0:
                    offset += 2
                else:
                    while offset < len(data) and data[offset] != 0:
                        offset += data[offset] + 1
                    offset += 1
                if offset + 10 > len(data):
                    break
                rtype, rclass, ttl, rdlength = struct.unpack(">HHIH", data[offset : offset + 10])
                offset += 10
                if rtype == 1 and rdlength == 4:
                    return ".".join(str(b) for b in data[offset : offset + 4])
                offset += rdlength
        except Exception:
            continue

    return known_ips[0] if "c-6.us-east-2" in hostname else None


def create_app_engine(database_url: str):
    """Create SQLAlchemy engine with appropriate connection parameters per dialect."""
    norm_url = get_normalized_database_url(database_url)
    is_sqlite = norm_url.startswith("sqlite")
    is_postgres = "postgresql" in norm_url

    if is_sqlite:
        return create_engine(
            norm_url,
            connect_args={"check_same_thread": False},
            echo=False,
            future=True,
        )
    elif is_postgres:
        connect_args: Dict[str, Any] = {}
        parsed = urlparse(norm_url)
        hostname = parsed.hostname or ""

        # Enforce SSL for PostgreSQL
        if "sslmode" not in (parsed.query or ""):
            connect_args["sslmode"] = "require"

        # Neon DNS resolution resilience:
        # If local system DNS fails to resolve Neon hostname (common with ISP DNS blocking .tech or aws.neon.tech),
        # resolve via public DNS (8.8.8.8 / 1.1.1.1) and supply hostaddr in connect_args.
        if "neon.tech" in hostname:
            try:
                import socket
                socket.gethostbyname(hostname)
            except Exception:
                resolved_ip = _resolve_neon_hostaddr(hostname)
                if resolved_ip:
                    connect_args["hostaddr"] = resolved_ip

        return create_engine(
            norm_url,
            connect_args=connect_args,
            pool_pre_ping=True,      # Vital for Neon serverless idle connection recovery
            pool_recycle=300,        # Recycle idle connections every 5 minutes
            pool_size=5,
            max_overflow=10,
            echo=False,
            future=True,
        )
    else:
        # Generic fallback for other valid SQLAlchemy database URLs
        return create_engine(
            norm_url,
            pool_pre_ping=True,
            echo=False,
            future=True,
        )


db_url = get_normalized_database_url(settings.DATABASE_URL)
engine = create_app_engine(settings.DATABASE_URL)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    future=True,
)

Base = declarative_base()


def get_db_info(raw_url: str | None = None) -> Dict[str, Any]:
    """Safe diagnostic metadata about the current active database engine (no credentials exposed)."""
    target_url = raw_url or get_settings().DATABASE_URL
    norm_url = get_normalized_database_url(target_url)
    if norm_url.startswith("sqlite"):
        return {
            "dialect": "sqlite",
            "is_postgres": False,
            "engine": "SQLite (Local Development / Isolated Tests)",
            "ssl": "N/A",
        }
    parsed = urlparse(norm_url)
    is_neon = "neon.tech" in (parsed.hostname or "")
    return {
        "dialect": "postgresql",
        "is_postgres": True,
        "is_neon": is_neon,
        "engine": f"Neon PostgreSQL ({parsed.hostname})" if is_neon else "PostgreSQL Server",
        "ssl": "require",
    }


def get_db() -> Generator[Session, None, None]:
    """Dependency for providing database sessions to request handlers."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

