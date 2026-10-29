"""Aperçu automatique des liens : on va chercher l'image du produit (balises og:image).

Sécurité : on ne suit que des adresses http(s) publiques (pas d'adresse interne au
serveur), avec un délai court et une taille de page limitée.
"""

import ipaddress
import re
import socket
from html import unescape
from urllib.parse import urljoin, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

TIMEOUT = 4
MAX_BYTES = 800_000
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0 Safari/537.36")

META_PATTERNS = [
    r'<meta[^>]+(?:property|name)=["\'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["\'][^>]*content=["\']([^"\']+)',
    r'<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:property|name)=["\'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["\']',
    r'<link[^>]+rel=["\']image_src["\'][^>]*href=["\']([^"\']+)',
    r'"image"\s*:\s*\[?\s*"(https?://[^"]+)"',  # données structurées JSON-LD
]


def _is_public(host):
    try:
        infos = socket.getaddrinfo(host, None)
    except (socket.gaierror, UnicodeError):
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            return False
    return True


def _safe_url(url):
    p = urlparse(url)
    return p.scheme in ("http", "https") and p.hostname and _is_public(p.hostname)


class _SafeRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not _safe_url(newurl):
            return None
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def find_image(html, base_url):
    for pattern in META_PATTERNS:
        m = re.search(pattern, html, re.I)
        if m:
            img = urljoin(base_url, unescape(m.group(1).strip()))
            if img.startswith(("http://", "https://")):
                return img[:800]
    return ""


def fetch_preview(url):
    """Renvoie l'adresse de l'image du produit, ou "" si introuvable. Ne lève jamais d'erreur."""
    try:
        if not url or not _safe_url(url):
            return ""
        opener = build_opener(_SafeRedirect)
        req = Request(url, headers={"User-Agent": UA, "Accept": "text/html", "Accept-Language": "fr-FR,fr;q=0.9"})
        with opener.open(req, timeout=TIMEOUT) as resp:
            if "html" not in resp.headers.get("Content-Type", "html"):
                return ""
            raw = resp.read(MAX_BYTES)
            charset = resp.headers.get_content_charset() or "utf-8"
            final_url = resp.geturl()
        return find_image(raw.decode(charset, errors="replace"), final_url)
    except Exception:  # site indisponible, bloqué, trop lent… : pas d'aperçu, ce n'est pas grave
        return ""
