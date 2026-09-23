"""Dual-stack launcher.

Binds port 8000 on both IPv4 and IPv6 (localhost may resolve to either).
Run with:  python run.py
"""
import socket

import uvicorn


def build_socket() -> socket.socket:
    sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    if hasattr(socket, "IPV6_V6ONLY"):
        sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
    sock.bind(("::", 8000))
    sock.listen(2048)
    return sock


if __name__ == "__main__":
    sock = build_socket()
    config = uvicorn.Config("app.main:app", log_level="info")
    server = uvicorn.Server(config)
    server.run(sockets=[sock])