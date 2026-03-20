import os
import re
import json
import time
import sqlite3
import urllib.request
import urllib.error
import threading
import hashlib
import math
import copy
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import feedparser
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ✅ Load backend/.env automatically
try:
    from dotenv import load_dotenv  # type: ignore

    load_dotenv()
except Exception:
    pass

# ----------------------------
# App
# ----------------------------
app = FastAPI(title="News Aggregator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # MVP / Codespaces
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------
# Regions / source config
# Canonical model:
#   region -> subdivision
#
# Transitional compatibility:
#   "country" remains accepted for Mercosur and existing frontend calls.
# ----------------------------
REGIONS: Dict[str, Dict[str, Any]] = {
    "mercosur": {
        "key": "mercosur",
        "name": "Mercosur",
        "status": "live",
        "subdivision_label": "Country",
        "default_subdivision": "uy",
        "default_country": "uy",  # backward compatibility
        "aliases": ["mercosur"],
        "subdivisions": {
            "all": {"code": "ALL", "name": "All Mercosur", "flag_url": ""},
            "mp": {"code": "MP", "name": "MercoPress", "flag_url": ""},
            "uy": {"code": "UY", "name": "Uruguay", "flag_url": "https://flagcdn.com/w40/uy.png"},
            "ar": {"code": "AR", "name": "Argentina", "flag_url": "https://flagcdn.com/w40/ar.png"},
            "br": {"code": "BR", "name": "Brazil", "flag_url": "https://flagcdn.com/w40/br.png"},
            "py": {"code": "PY", "name": "Paraguay", "flag_url": "https://flagcdn.com/w40/py.png"},
            "bo": {"code": "BO", "name": "Bolivia", "flag_url": "https://flagcdn.com/w40/bo.png"},
        },
    },
    "mexico": {
        "key": "mexico",
        "name": "Mexico",
        "status": "live",
        "subdivision_label": "State",
        "default_subdivision": "all",
        "default_country": "all",  # transitional compatibility only
        "aliases": ["mexico", "mx"],
        "subdivisions": {
            "all": {"code": "ALL", "name": "All Mexico", "flag_url": ""},
            "cdmx": {"code": "CDMX", "name": "CDMX", "flag_url": ""},
            "jalisco": {"code": "JAL", "name": "Jalisco", "flag_url": ""},
            "nuevo-leon": {"code": "NL", "name": "Nuevo León", "flag_url": ""},
            "edomex": {"code": "MEX", "name": "Estado de México", "flag_url": ""},
            "yucatan": {"code": "YUC", "name": "Yucatán", "flag_url": ""},
        },
    },
    "central-america": {
        "key": "central-america",
        "name": "Central America",
        "status": "live",
        "subdivision_label": "Country",
        "default_subdivision": "all",
        "default_country": "all",  # transitional compatibility only
        "aliases": ["central-america", "central", "central_america", "centralamerica"],
        "subdivisions": {
            "all": {"code": "ALL", "name": "All Central America", "flag_url": ""},
            "gt": {"code": "GT", "name": "Guatemala", "flag_url": "https://flagcdn.com/w40/gt.png"},
            "cr": {"code": "CR", "name": "Costa Rica", "flag_url": "https://flagcdn.com/w40/cr.png"},
            "pa": {"code": "PA", "name": "Panama", "flag_url": "https://flagcdn.com/w40/pa.png"},
            "sv": {"code": "SV", "name": "El Salvador", "flag_url": "https://flagcdn.com/w40/sv.png"},
            "hn": {"code": "HN", "name": "Honduras", "flag_url": "https://flagcdn.com/w40/hn.png"},
            "ni": {"code": "NI", "name": "Nicaragua", "flag_url": "https://flagcdn.com/w40/ni.png"},
            "bz": {"code": "BZ", "name": "Belize", "flag_url": "https://flagcdn.com/w40/bz.png"},
        },
    },
}

# Mercosur bloc (requested): UY, AR, BR, PY, BO + MercoPress ("mp") + "all"
# Keep SOURCES as the master feed list. Additional regions can be appended here later.
SOURCES: List[Dict[str, Any]] = [
    # --- Uruguay (UY) ---
    {
        "id": "montevideo_portal",
        "name": "Montevideo Portal",
        "region_key": "mercosur",
        "subdivision_key": "uy",
        "country_key": "uy",  # backward compatibility
        "subdivision_code": "UY",
        "country_code": "UY",  # backward compatibility
        "subdivision_flag_url": "https://flagcdn.com/w40/uy.png",
        "country_flag_url": "https://flagcdn.com/w40/uy.png",  # backward compatibility
        "source_logo": "https://www.montevideo.com.uy/favicon.ico",
        "feed_url": "https://www.montevideo.com.uy/anxml.aspx?59",
    },
    {
        "id": "el_observador_uy",
        "name": "El Observador (UY)",
        "region_key": "mercosur",
        "subdivision_key": "uy",
        "country_key": "uy",
        "subdivision_code": "UY",
        "country_code": "UY",
        "subdivision_flag_url": "https://flagcdn.com/w40/uy.png",
        "country_flag_url": "https://flagcdn.com/w40/uy.png",
        "source_logo": "https://www.elobservador.com.uy/favicon.ico",
        "feed_url": "https://www.elobservador.com.uy/rss/pages/home.xml",
    },
    # --- Argentina (AR) ---
    {
        "id": "lanacion_ar",
        "name": "La Nación (AR)",
        "region_key": "mercosur",
        "subdivision_key": "ar",
        "country_key": "ar",
        "subdivision_code": "AR",
        "country_code": "AR",
        "subdivision_flag_url": "https://flagcdn.com/w40/ar.png",
        "country_flag_url": "https://flagcdn.com/w40/ar.png",
        "source_logo": "https://www.lanacion.com.ar/favicon.ico",
        "feed_url": "https://www.lanacion.com.ar/arc/outboundfeeds/rss/?outputType=xml",
    },
    {
        "id": "clarin_ar_lo_ultimo",
        "name": "Clarín (AR) - Lo Último",
        "region_key": "mercosur",
        "subdivision_key": "ar",
        "country_key": "ar",
        "subdivision_code": "AR",
        "country_code": "AR",
        "subdivision_flag_url": "https://flagcdn.com/w40/ar.png",
        "country_flag_url": "https://flagcdn.com/w40/ar.png",
        "source_logo": "https://www.clarin.com/favicon.ico",
        "feed_url": "https://www.clarin.com/rss/lo-ultimo/",
    },
    # --- Brazil (BR) ---
    {
        "id": "g1_br",
        "name": "G1 (BR)",
        "region_key": "mercosur",
        "subdivision_key": "br",
        "country_key": "br",
        "subdivision_code": "BR",
        "country_code": "BR",
        "subdivision_flag_url": "https://flagcdn.com/w40/br.png",
        "country_flag_url": "https://flagcdn.com/w40/br.png",
        "source_logo": "https://g1.globo.com/favicon.ico",
        "feed_url": "https://g1.globo.com/rss/g1/",
    },
    {
        "id": "uol_br",
        "name": "UOL (BR)",
        "region_key": "mercosur",
        "subdivision_key": "br",
        "country_key": "br",
        "subdivision_code": "BR",
        "country_code": "BR",
        "subdivision_flag_url": "https://flagcdn.com/w40/br.png",
        "country_flag_url": "https://flagcdn.com/w40/br.png",
        "source_logo": "https://www.uol.com.br/favicon.ico",
        "feed_url": "https://rss.uol.com.br/feed/noticias.xml",
    },
    # --- Paraguay (PY) ---
    {
        "id": "abccolor_py",
        "name": "ABC Color (PY)",
        "region_key": "mercosur",
        "subdivision_key": "py",
        "country_key": "py",
        "subdivision_code": "PY",
        "country_code": "PY",
        "subdivision_flag_url": "https://flagcdn.com/w40/py.png",
        "country_flag_url": "https://flagcdn.com/w40/py.png",
        "source_logo": "https://www.abc.com.py/favicon.ico",
        "feed_url": "https://www.abc.com.py/arc/outboundfeeds/rss/nacionales/",
    },
    # --- Bolivia (BO) ---
    {
        "id": "radiofides_bo",
        "name": "Radio Fides (BO)",
        "region_key": "mercosur",
        "subdivision_key": "bo",
        "country_key": "bo",
        "subdivision_code": "BO",
        "country_code": "BO",
        "subdivision_flag_url": "https://flagcdn.com/w40/bo.png",
        "country_flag_url": "https://flagcdn.com/w40/bo.png",
        "source_logo": "https://radiofides.com/es/favicon.ico",
        "feed_url": "https://radiofides.com/es/feed/",
    },
    {
        "id": "radiofides_bo_nacional",
        "name": "Radio Fides - Nacional (BO)",
        "region_key": "mercosur",
        "subdivision_key": "bo",
        "country_key": "bo",
        "subdivision_code": "BO",
        "country_code": "BO",
        "subdivision_flag_url": "https://flagcdn.com/w40/bo.png",
        "country_flag_url": "https://flagcdn.com/w40/bo.png",
        "source_logo": "https://radiofides.com/es/favicon.ico",
        "feed_url": "https://radiofides.com/es/category/nacional/feed/",
    },
    {
        "id": "lapatria_bo",
        "name": "La Patria (BO)",
        "region_key": "mercosur",
        "subdivision_key": "bo",
        "country_key": "bo",
        "subdivision_code": "BO",
        "country_code": "BO",
        "subdivision_flag_url": "https://flagcdn.com/w40/bo.png",
        "country_flag_url": "https://flagcdn.com/w40/bo.png",
        "source_logo": "https://lapatria.bo/favicon.ico",
        "feed_url": "https://lapatria.bo/feed/",
    },
    # --- MercoPress ---
    {
        "id": "mercopress_mercosur",
        "name": "MercoPress (Mercosur)",
        "region_key": "mercosur",
        "subdivision_key": "mp",
        "country_key": "mp",
        "subdivision_code": "MP",
        "country_code": "MP",
        "subdivision_flag_url": None,
        "country_flag_url": None,
        "source_logo": "https://en.mercopress.com/favicon.ico",
        "feed_url": "https://en.mercopress.com/rss/mercosur",
    },

    # --- Mexico (MX) - cleaned live launch feeds only ---
    {
        "id": "la_jornada_mx_estados",
        "name": "La Jornada - Estados (MX)",
        "region_key": "mexico",
        "subdivision_key": "all",
        "country_key": "all",
        "subdivision_code": "ALL",
        "country_code": "ALL",
        "subdivision_flag_url": "https://flagcdn.com/w40/mx.png",
        "country_flag_url": "https://flagcdn.com/w40/mx.png",
        "source_logo": "https://www.jornada.com.mx/favicon.ico",
        "feed_url": "https://www.jornada.com.mx/rss/estados.xml?v=1",
    },
    {
        "id": "la_jornada_mx_cdmx_capital",
        "name": "La Jornada - Capital (CDMX)",
        "region_key": "mexico",
        "subdivision_key": "cdmx",
        "country_key": "cdmx",
        "subdivision_code": "CDMX",
        "country_code": "CDMX",
        "subdivision_flag_url": "https://flagcdn.com/w40/mx.png",
        "country_flag_url": "https://flagcdn.com/w40/mx.png",
        "source_logo": "https://www.jornada.com.mx/favicon.ico",
        "feed_url": "https://www.jornada.com.mx/rss/capital.xml?v=1",
    },
    {
        "id": "la_jornada_mx_politica",
        "name": "La Jornada - Política (MX)",
        "region_key": "mexico",
        "subdivision_key": "all",
        "country_key": "all",
        "subdivision_code": "ALL",
        "country_code": "ALL",
        "subdivision_flag_url": "https://flagcdn.com/w40/mx.png",
        "country_flag_url": "https://flagcdn.com/w40/mx.png",
        "source_logo": "https://www.jornada.com.mx/favicon.ico",
        "feed_url": "https://www.jornada.com.mx/rss/politica.xml?v=1",
    },
    {
        "id": "la_jornada_mx_economia",
        "name": "La Jornada - Economía (MX)",
        "region_key": "mexico",
        "subdivision_key": "all",
        "country_key": "all",
        "subdivision_code": "ALL",
        "country_code": "ALL",
        "subdivision_flag_url": "https://flagcdn.com/w40/mx.png",
        "country_flag_url": "https://flagcdn.com/w40/mx.png",
        "source_logo": "https://www.jornada.com.mx/favicon.ico",
        "feed_url": "https://www.jornada.com.mx/rss/economia.xml?v=1",
    },
    # --- National feeds (ALL Mexico) ---
    {
        "id": "el_financiero_mx",
        "name": "El Financiero (MX)",
        "region_key": "mexico",
        "subdivision_key": "all",
        "country_key": "all",
        "subdivision_code": "ALL",
        "country_code": "ALL",
        "subdivision_flag_url": "https://flagcdn.com/w40/mx.png",
        "country_flag_url": "https://flagcdn.com/w40/mx.png",
        "source_logo": "https://www.elfinanciero.com.mx/favicon.ico",
        "feed_url": "https://www.elfinanciero.com.mx/arc/outboundfeeds/rss/?outputType=xml",
    },
    {
        "id": "el_universal_mx",
        "name": "El Universal (MX)",
        "region_key": "mexico",
        "subdivision_key": "all",
        "country_key": "all",
        "subdivision_code": "ALL",
        "country_code": "ALL",
        "subdivision_flag_url": "https://flagcdn.com/w40/mx.png",
        "country_flag_url": "https://flagcdn.com/w40/mx.png",
        "source_logo": "https://www.eluniversal.com.mx/favicon.ico",
        "feed_url": "https://www.eluniversal.com.mx/arc/outboundfeeds/rss/?outputType=xml",
    },
    {
        "id": "excelsior_mx",
        "name": "Excélsior (MX)",
        "region_key": "mexico",
        "subdivision_key": "all",
        "country_key": "all",
        "subdivision_code": "ALL",
        "country_code": "ALL",
        "subdivision_flag_url": "https://flagcdn.com/w40/mx.png",
        "country_flag_url": "https://flagcdn.com/w40/mx.png",
        "source_logo": "https://www.excelsior.com.mx/favicon.ico",
        "feed_url": "https://www.excelsior.com.mx/rss/nacional",
    },
    {
        "id": "el_sol_de_mexico_mx",
        "name": "El Sol de México",
        "region_key": "mexico",
        "subdivision_key": "all",
        "country_key": "all",
        "subdivision_code": "ALL",
        "country_code": "ALL",
        "subdivision_flag_url": "https://flagcdn.com/w40/mx.png",
        "country_flag_url": "https://flagcdn.com/w40/mx.png",
        "source_logo": "https://www.elsoldemexico.com.mx/favicon.ico",
        "feed_url": "https://www.elsoldemexico.com.mx/rss.xml",
    },
    {
        "id": "expansion_mx",
        "name": "Expansión (MX)",
        "region_key": "mexico",
        "subdivision_key": "all",
        "country_key": "all",
        "subdivision_code": "ALL",
        "country_code": "ALL",
        "subdivision_flag_url": "https://flagcdn.com/w40/mx.png",
        "country_flag_url": "https://flagcdn.com/w40/mx.png",
        "source_logo": "https://expansion.mx/favicon.ico",
        "feed_url": "https://expansion.mx/rss",
    },
    {
        "id": "reforma_mx",
        "name": "Reforma (MX)",
        "region_key": "mexico",
        "subdivision_key": "all",
        "country_key": "all",
        "subdivision_code": "ALL",
        "country_code": "ALL",
        "subdivision_flag_url": "https://flagcdn.com/w40/mx.png",
        "country_flag_url": "https://flagcdn.com/w40/mx.png",
        "source_logo": "https://www.reforma.com/favicon.ico",
        "feed_url": "https://www.reforma.com/rss/portada.xml",
    },
    # --- State feeds ---
    {
        "id": "informador_jalisco",
        "name": "El Informador (Jalisco)",
        "region_key": "mexico",
        "subdivision_key": "jalisco",
        "country_key": "jalisco",
        "subdivision_code": "JAL",
        "country_code": "JAL",
        "subdivision_flag_url": "https://flagcdn.com/w40/mx.png",
        "country_flag_url": "https://flagcdn.com/w40/mx.png",
        "source_logo": "https://www.informador.mx/favicon.ico",
        "feed_url": "https://www.informador.mx/rss/jalisco.xml",
    },
    {
        "id": "el_norte_nuevo_leon",
        "name": "El Norte (Nuevo León)",
        "region_key": "mexico",
        "subdivision_key": "nuevo-leon",
        "country_key": "nuevo-leon",
        "subdivision_code": "NL",
        "country_code": "NL",
        "subdivision_flag_url": "https://flagcdn.com/w40/mx.png",
        "country_flag_url": "https://flagcdn.com/w40/mx.png",
        "source_logo": "https://www.elnorte.com/favicon.ico",
        "feed_url": "https://www.elnorte.com/rss/portada.xml",
    },
    {
        "id": "el_sol_de_toluca_edomex",
        "name": "El Sol de Toluca (Edomex)",
        "region_key": "mexico",
        "subdivision_key": "edomex",
        "country_key": "edomex",
        "subdivision_code": "MEX",
        "country_code": "MEX",
        "subdivision_flag_url": "https://flagcdn.com/w40/mx.png",
        "country_flag_url": "https://flagcdn.com/w40/mx.png",
        "source_logo": "https://oem.com.mx/elsoldetoluca/favicon.ico",
        "feed_url": "https://oem.com.mx/elsoldetoluca/rss.xml",
    },
    {
        "id": "diario_de_yucatan",
        "name": "Diario de Yucatán",
        "region_key": "mexico",
        "subdivision_key": "yucatan",
        "country_key": "yucatan",
        "subdivision_code": "YUC",
        "country_code": "YUC",
        "subdivision_flag_url": "https://flagcdn.com/w40/mx.png",
        "country_flag_url": "https://flagcdn.com/w40/mx.png",
        "source_logo": "https://www.yucatan.com.mx/favicon.ico",
        "feed_url": "https://www.yucatan.com.mx/feed/",
    },

    # =====================================================================
    # --- Central America ---
    # =====================================================================

    # --- Guatemala (GT) ---
    {
        "id": "prensa_libre_gt",
        "name": "Prensa Libre (GT)",
        "region_key": "central-america",
        "subdivision_key": "gt",
        "country_key": "gt",
        "subdivision_code": "GT",
        "country_code": "GT",
        "subdivision_flag_url": "https://flagcdn.com/w40/gt.png",
        "country_flag_url": "https://flagcdn.com/w40/gt.png",
        "source_logo": "https://www.prensalibre.com/favicon.ico",
        "feed_url": "https://www.prensalibre.com/feed/",
    },
    {
        "id": "la_hora_gt",
        "name": "La Hora (GT)",
        "region_key": "central-america",
        "subdivision_key": "gt",
        "country_key": "gt",
        "subdivision_code": "GT",
        "country_code": "GT",
        "subdivision_flag_url": "https://flagcdn.com/w40/gt.png",
        "country_flag_url": "https://flagcdn.com/w40/gt.png",
        "source_logo": "https://lahora.gt/favicon.ico",
        "feed_url": "https://lahora.gt/feed/",
    },
    {
        "id": "republica_gt",
        "name": "República (GT)",
        "region_key": "central-america",
        "subdivision_key": "gt",
        "country_key": "gt",
        "subdivision_code": "GT",
        "country_code": "GT",
        "subdivision_flag_url": "https://flagcdn.com/w40/gt.png",
        "country_flag_url": "https://flagcdn.com/w40/gt.png",
        "source_logo": "https://republica.gt/favicon.ico",
        "feed_url": "https://republica.gt/feed",
    },
    {
        "id": "emisoras_unidas_gt",
        "name": "Emisoras Unidas (GT)",
        "region_key": "central-america",
        "subdivision_key": "gt",
        "country_key": "gt",
        "subdivision_code": "GT",
        "country_code": "GT",
        "subdivision_flag_url": "https://flagcdn.com/w40/gt.png",
        "country_flag_url": "https://flagcdn.com/w40/gt.png",
        "source_logo": "https://emisorasunidas.com/favicon.ico",
        "feed_url": "https://emisorasunidas.com/feed/",
    },

    # --- Costa Rica (CR) ---
    {
        "id": "la_nacion_cr",
        "name": "La Nación (CR)",
        "region_key": "central-america",
        "subdivision_key": "cr",
        "country_key": "cr",
        "subdivision_code": "CR",
        "country_code": "CR",
        "subdivision_flag_url": "https://flagcdn.com/w40/cr.png",
        "country_flag_url": "https://flagcdn.com/w40/cr.png",
        "source_logo": "https://www.nacion.com/favicon.ico",
        "feed_url": "https://www.nacion.com/arc/outboundfeeds/rss/?outputType=xml",
    },
    {
        "id": "delfino_cr",
        "name": "Delfino (CR)",
        "region_key": "central-america",
        "subdivision_key": "cr",
        "country_key": "cr",
        "subdivision_code": "CR",
        "country_code": "CR",
        "subdivision_flag_url": "https://flagcdn.com/w40/cr.png",
        "country_flag_url": "https://flagcdn.com/w40/cr.png",
        "source_logo": "https://delfino.cr/favicon.ico",
        "feed_url": "https://delfino.cr/feed",
    },
    {
        "id": "semanario_ucr_cr",
        "name": "Semanario Universidad (CR)",
        "region_key": "central-america",
        "subdivision_key": "cr",
        "country_key": "cr",
        "subdivision_code": "CR",
        "country_code": "CR",
        "subdivision_flag_url": "https://flagcdn.com/w40/cr.png",
        "country_flag_url": "https://flagcdn.com/w40/cr.png",
        "source_logo": "https://semanariouniversidad.com/favicon.ico",
        "feed_url": "https://semanariouniversidad.com/feed/",
    },
    {
        "id": "elmundo_cr",
        "name": "El Mundo (CR)",
        "region_key": "central-america",
        "subdivision_key": "cr",
        "country_key": "cr",
        "subdivision_code": "CR",
        "country_code": "CR",
        "subdivision_flag_url": "https://flagcdn.com/w40/cr.png",
        "country_flag_url": "https://flagcdn.com/w40/cr.png",
        "source_logo": "https://www.elmundo.cr/favicon.ico",
        "feed_url": "https://www.elmundo.cr/feed/",
    },
    {
        "id": "diarioextra_cr",
        "name": "Diario Extra (CR)",
        "region_key": "central-america",
        "subdivision_key": "cr",
        "country_key": "cr",
        "subdivision_code": "CR",
        "country_code": "CR",
        "subdivision_flag_url": "https://flagcdn.com/w40/cr.png",
        "country_flag_url": "https://flagcdn.com/w40/cr.png",
        "source_logo": "https://www.diarioextra.com/favicon.ico",
        "feed_url": "https://www.diarioextra.com/rss",
    },

    # --- El Salvador (SV) ---
    {
        "id": "elsalvador_com_sv",
        "name": "ElSalvador.com (SV)",
        "region_key": "central-america",
        "subdivision_key": "sv",
        "country_key": "sv",
        "subdivision_code": "SV",
        "country_code": "SV",
        "subdivision_flag_url": "https://flagcdn.com/w40/sv.png",
        "country_flag_url": "https://flagcdn.com/w40/sv.png",
        "source_logo": "https://www.elsalvador.com/favicon.ico",
        "feed_url": "https://www.elsalvador.com/feed/",
    },
    {
        "id": "contrapunto_sv",
        "name": "Contrapunto (SV)",
        "region_key": "central-america",
        "subdivision_key": "sv",
        "country_key": "sv",
        "subdivision_code": "SV",
        "country_code": "SV",
        "subdivision_flag_url": "https://flagcdn.com/w40/sv.png",
        "country_flag_url": "https://flagcdn.com/w40/sv.png",
        "source_logo": "https://www.contrapunto.com.sv/favicon.ico",
        "feed_url": "https://www.contrapunto.com.sv/feed/",
    },
    {
        "id": "diario_co_latino_sv",
        "name": "Diario Co Latino (SV)",
        "region_key": "central-america",
        "subdivision_key": "sv",
        "country_key": "sv",
        "subdivision_code": "SV",
        "country_code": "SV",
        "subdivision_flag_url": "https://flagcdn.com/w40/sv.png",
        "country_flag_url": "https://flagcdn.com/w40/sv.png",
        "source_logo": "https://www.diariocolatino.com/favicon.ico",
        "feed_url": "https://www.diariocolatino.com/feed/",
    },

    # --- Honduras (HN) ---
    {
        "id": "conexihon_hn",
        "name": "Conexihon (HN)",
        "region_key": "central-america",
        "subdivision_key": "hn",
        "country_key": "hn",
        "subdivision_code": "HN",
        "country_code": "HN",
        "subdivision_flag_url": "https://flagcdn.com/w40/hn.png",
        "country_flag_url": "https://flagcdn.com/w40/hn.png",
        "source_logo": "https://www.conexihon.hn/favicon.ico",
        "feed_url": "https://www.conexihon.hn/feed/",
    },
    {
        "id": "criterio_hn",
        "name": "Criterio (HN)",
        "region_key": "central-america",
        "subdivision_key": "hn",
        "country_key": "hn",
        "subdivision_code": "HN",
        "country_code": "HN",
        "subdivision_flag_url": "https://flagcdn.com/w40/hn.png",
        "country_flag_url": "https://flagcdn.com/w40/hn.png",
        "source_logo": "https://criterio.hn/favicon.ico",
        "feed_url": "https://criterio.hn/feed/",
    },
    {
        "id": "hondudiario_hn",
        "name": "Hondudiario (HN)",
        "region_key": "central-america",
        "subdivision_key": "hn",
        "country_key": "hn",
        "subdivision_code": "HN",
        "country_code": "HN",
        "subdivision_flag_url": "https://flagcdn.com/w40/hn.png",
        "country_flag_url": "https://flagcdn.com/w40/hn.png",
        "source_logo": "https://hondudiario.com/favicon.ico",
        "feed_url": "https://hondudiario.com/feed/",
    },

    # --- Nicaragua (NI) ---
    {
        "id": "confidencial_ni",
        "name": "Confidencial (NI)",
        "region_key": "central-america",
        "subdivision_key": "ni",
        "country_key": "ni",
        "subdivision_code": "NI",
        "country_code": "NI",
        "subdivision_flag_url": "https://flagcdn.com/w40/ni.png",
        "country_flag_url": "https://flagcdn.com/w40/ni.png",
        "source_logo": "https://confidencial.digital/favicon.ico",
        "feed_url": "https://confidencial.digital/feed/",
    },
    {
        "id": "nicaragua_investiga_ni",
        "name": "Nicaragua Investiga (NI)",
        "region_key": "central-america",
        "subdivision_key": "ni",
        "country_key": "ni",
        "subdivision_code": "NI",
        "country_code": "NI",
        "subdivision_flag_url": "https://flagcdn.com/w40/ni.png",
        "country_flag_url": "https://flagcdn.com/w40/ni.png",
        "source_logo": "https://nicaraguainvestiga.com/favicon.ico",
        "feed_url": "https://nicaraguainvestiga.com/feed/",
    },

    # --- Panama (PA) ---
    {
        "id": "newsroom_pa",
        "name": "Newsroom Panama (PA)",
        "region_key": "central-america",
        "subdivision_key": "pa",
        "country_key": "pa",
        "subdivision_code": "PA",
        "country_code": "PA",
        "subdivision_flag_url": "https://flagcdn.com/w40/pa.png",
        "country_flag_url": "https://flagcdn.com/w40/pa.png",
        "source_logo": "https://newsroompanama.com/favicon.ico",
        "feed_url": "https://newsroompanama.com/feed",
    },

    # --- Belize (BZ) ---
    {
        "id": "breaking_belize_news_bz",
        "name": "Breaking Belize News (BZ)",
        "region_key": "central-america",
        "subdivision_key": "bz",
        "country_key": "bz",
        "subdivision_code": "BZ",
        "country_code": "BZ",
        "subdivision_flag_url": "https://flagcdn.com/w40/bz.png",
        "country_flag_url": "https://flagcdn.com/w40/bz.png",
        "source_logo": "https://www.breakingbelizenews.com/favicon.ico",
        "feed_url": "https://www.breakingbelizenews.com/feed/",
    },
    {
        "id": "amandala_bz",
        "name": "Amandala (BZ)",
        "region_key": "central-america",
        "subdivision_key": "bz",
        "country_key": "bz",
        "subdivision_code": "BZ",
        "country_code": "BZ",
        "subdivision_flag_url": "https://flagcdn.com/w40/bz.png",
        "country_flag_url": "https://flagcdn.com/w40/bz.png",
        "source_logo": "https://amandala.com.bz/news/favicon.ico",
        "feed_url": "https://amandala.com.bz/news/feed/",
    },
    {
        "id": "love_fm_bz",
        "name": "Love FM (BZ)",
        "region_key": "central-america",
        "subdivision_key": "bz",
        "country_key": "bz",
        "subdivision_code": "BZ",
        "country_code": "BZ",
        "subdivision_flag_url": "https://flagcdn.com/w40/bz.png",
        "country_flag_url": "https://flagcdn.com/w40/bz.png",
        "source_logo": "https://lovefm.com/favicon.ico",
        "feed_url": "https://lovefm.com/feed/",
    },
]

DEFAULT_REGION_KEY = "mercosur"
LIVE_REGION_KEYS = {k for k, v in REGIONS.items() if v.get("status") == "live"}

REGION_ALIASES: Dict[str, str] = {}
for region_key, region_cfg in REGIONS.items():
    REGION_ALIASES[region_key] = region_key
    for alias in (region_cfg.get("aliases") or []):
        ak = (alias or "").strip().lower()
        if ak:
            REGION_ALIASES[ak] = region_key

# ----------------------------
# SQLite cache
# ----------------------------
DB_PATH = os.path.join(os.path.dirname(__file__), "cache.db")


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db() -> None:
    with _db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS enrich_cache (
              link TEXT PRIMARY KEY,
              title_en TEXT,
              summary_en TEXT,
              created_utc TEXT NOT NULL
            )
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS cluster_enrich_cache (
              cluster_id TEXT PRIMARY KEY,
              title_en TEXT,
              summary_en TEXT,
              created_utc TEXT NOT NULL
            )
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS cluster_meta_cache (
              cluster_id TEXT PRIMARY KEY,
              keywords_json TEXT,
              entities_json TEXT,
              confidence REAL,
              created_utc TEXT NOT NULL
            )
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS top_cache (
              cache_key TEXT PRIMARY KEY,
              payload_json TEXT NOT NULL,
              created_utc TEXT NOT NULL
            )
            """
        )

        conn.execute("CREATE INDEX IF NOT EXISTS idx_enrich_created ON enrich_cache(created_utc)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_cluster_enrich_created ON cluster_enrich_cache(created_utc)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_cluster_meta_created ON cluster_meta_cache(created_utc)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_top_cache_created ON top_cache(created_utc)")
        conn.commit()


_init_db()

# ----------------------------
# Helpers
# ----------------------------
_TAG_RE = re.compile(r"<[^>]+>")


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _strip_html(s: str) -> str:
    if not s:
        return ""
    s = _TAG_RE.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _clean_text_any(s: str, max_chars: int = 700) -> str:
    s = _strip_html(s)
    if len(s) > max_chars:
        s = s[: max_chars - 1].rstrip() + "…"
    return s


def _range_to_since(range_str: str) -> datetime:
    r = (range_str or "24h").strip().lower()
    if r == "24h":
        delta = timedelta(hours=24)
    elif r == "3d":
        delta = timedelta(days=3)
    elif r == "7d":
        delta = timedelta(days=7)
    elif r == "30d":
        delta = timedelta(days=30)
    else:
        delta = timedelta(hours=24)
    return datetime.now(timezone.utc) - delta


def _parse_date(entry: Dict[str, Any]) -> Optional[datetime]:
    dt_struct = entry.get("published_parsed") or entry.get("updated_parsed")
    if dt_struct:
        try:
            return datetime(*dt_struct[:6], tzinfo=timezone.utc)
        except Exception:
            pass

    for key in ("published", "updated"):
        val = entry.get(key)
        if isinstance(val, str) and val.strip():
            try:
                parsed = feedparser._parse_date(val)
                if parsed:
                    return datetime(*parsed[:6], tzinfo=timezone.utc)
            except Exception:
                pass

    return None


def _matches_q(article: Dict[str, Any], q: str) -> bool:
    if not q:
        return True
    qn = q.strip().lower()
    if not qn:
        return True
    hay = " ".join(
        [
            str(article.get("title", "")),
            str(article.get("snippet_text", "")),
            str(article.get("source", "")),
            str(article.get("title_en", "")),
            str(article.get("summary_en", "")),
        ]
    ).lower()
    return qn in hay


def _strip_internal_fields(obj: Any) -> Any:
    if isinstance(obj, dict):
        cleaned: Dict[str, Any] = {}
        for k, v in obj.items():
            if isinstance(k, str) and k.startswith("_"):
                continue
            cleaned[k] = _strip_internal_fields(v)
        return cleaned
    if isinstance(obj, list):
        return [_strip_internal_fields(x) for x in obj]
    return obj


def _normalize_region(region: Optional[str]) -> str:
    raw = (region or DEFAULT_REGION_KEY).strip().lower()
    if not raw:
        raw = DEFAULT_REGION_KEY

    resolved = REGION_ALIASES.get(raw)
    if not resolved or resolved not in REGIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid region. Use one of: {','.join(REGIONS.keys())}",
        )
    return resolved


def _require_live_region(region: str) -> str:
    r = _normalize_region(region)
    if r not in LIVE_REGION_KEYS:
        raise HTTPException(status_code=404, detail=f"Region '{r}' is not live yet.")
    return r


def _region_cfg(region: str) -> Dict[str, Any]:
    r = _normalize_region(region)
    cfg = REGIONS.get(r)
    if not cfg:
        raise HTTPException(status_code=400, detail=f"Invalid region '{r}'.")
    return cfg


def _region_subdivision_label(region: str) -> str:
    cfg = _region_cfg(region)
    return str(cfg.get("subdivision_label") or "Subdivision")


def _region_subdivision_meta(region: str) -> Dict[str, Dict[str, str]]:
    cfg = _region_cfg(region)
    subdivisions = cfg.get("subdivisions") or {}
    if subdivisions:
        return subdivisions

    countries = cfg.get("countries") or {}
    return countries


def _region_country_meta(region: str) -> Dict[str, Dict[str, str]]:
    # Backward compatibility wrapper
    return _region_subdivision_meta(region)


def _valid_subdivision_keys_for_region(region: str) -> set:
    meta = _region_subdivision_meta(region)
    return set(meta.keys())


def _valid_country_keys_for_region(region: str) -> set:
    # Backward compatibility wrapper
    return _valid_subdivision_keys_for_region(region)


def _default_subdivision_for_region(region: str) -> str:
    cfg = _region_cfg(region)
    default_subdivision = (cfg.get("default_subdivision") or "").strip().lower()
    valid = _valid_subdivision_keys_for_region(region)
    if default_subdivision and default_subdivision in valid:
        return default_subdivision

    default_country = (cfg.get("default_country") or "").strip().lower()
    if default_country and default_country in valid:
        return default_country

    if valid:
        return sorted(valid)[0]
    return ""


def _default_country_for_region(region: str) -> str:
    # Backward compatibility wrapper
    return _default_subdivision_for_region(region)


def _normalize_subdivision_for_region(region: str, subdivision: Optional[str]) -> str:
    r = _require_live_region(region)
    raw = (subdivision or "").strip().lower()
    if not raw:
        raw = _default_subdivision_for_region(r)

    valid = _valid_subdivision_keys_for_region(r)
    if raw not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid subdivision for region '{r}'.")
    return raw


def _normalize_country_for_region(region: str, country: Optional[str]) -> str:
    # Backward compatibility wrapper
    return _normalize_subdivision_for_region(region, country)


def _resolve_subdivision_param(subdivision: Optional[str], country: Optional[str]) -> Optional[str]:
    raw_subdivision = (subdivision or "").strip()
    if raw_subdivision:
        return raw_subdivision
    raw_country = (country or "").strip()
    if raw_country:
        return raw_country
    return None


def _sources_for_region(region: str) -> List[Dict[str, Any]]:
    r = _normalize_region(region)
    return [s for s in SOURCES if (s.get("region_key") or "").strip().lower() == r]


# ----------------------------
# Robust feed fetch (timeout + UA)
# ----------------------------
DEFAULT_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)


# In-memory feed cache: avoids re-fetching the same RSS URL within a short window
_FEED_CACHE: Dict[str, Dict[str, Any]] = {}
_FEED_CACHE_LOCK = threading.Lock()

def _feed_cache_ttl_s() -> int:
    try:
        return int((os.getenv("FEED_CACHE_TTL_S") or "300").strip())
    except Exception:
        return 300  # 5 minutes default

def _fetch_feed(feed_url: str, timeout_s: int = 12) -> feedparser.FeedParserDict:
    ttl = _feed_cache_ttl_s()
    now = time.time()

    # Check cache first
    with _FEED_CACHE_LOCK:
        cached = _FEED_CACHE.get(feed_url)
        if cached and (now - cached["ts"]) < ttl:
            return cached["data"]

    req = urllib.request.Request(
        feed_url,
        headers={
            "User-Agent": DEFAULT_UA,
            "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            raw = resp.read()
        parsed = feedparser.parse(raw)

        # Store in cache
        with _FEED_CACHE_LOCK:
            _FEED_CACHE[feed_url] = {"ts": now, "data": parsed}
            # Evict old entries if cache grows too large
            if len(_FEED_CACHE) > 200:
                cutoff = now - ttl
                stale = [k for k, v in _FEED_CACHE.items() if v["ts"] < cutoff]
                for k in stale:
                    _FEED_CACHE.pop(k, None)

        return parsed
    except urllib.error.URLError as e:
        raise RuntimeError(f"URL error: {e}")
    except Exception as e:
        raise RuntimeError(f"Fetch failed: {e}")


# ----------------------------
# Cache helpers (link-based enrichment)
# ----------------------------
def _get_cached_enrich(link: str) -> Optional[Dict[str, Any]]:
    with _db() as conn:
        row = conn.execute(
            "SELECT title_en, summary_en, created_utc FROM enrich_cache WHERE link = ?",
            (link,),
        ).fetchone()
        if not row:
            return None
        return {
            "title_en": row["title_en"],
            "summary_en": row["summary_en"],
            "created_utc": row["created_utc"],
        }


def _set_cached_enrich(link: str, title_en: str, summary_en: str) -> None:
    with _db() as conn:
        conn.execute(
            """
            INSERT INTO enrich_cache (link, title_en, summary_en, created_utc)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(link) DO UPDATE SET
              title_en=excluded.title_en,
              summary_en=excluded.summary_en,
              created_utc=excluded.created_utc
            """,
            (link, title_en, summary_en, _now_utc_iso()),
        )
        conn.commit()


# ----------------------------
# Cluster enrichment cache helpers
# ----------------------------
def _cluster_enrich_ttl_s() -> int:
    try:
        return int((os.getenv("CLUSTER_ENRICH_TTL_S") or "86400").strip())
    except Exception:
        return 86400


def _iso_is_fresh(created_utc: str, ttl_s: int) -> bool:
    if not created_utc:
        return False
    try:
        dt = datetime.fromisoformat(created_utc)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        age = datetime.now(timezone.utc) - dt.astimezone(timezone.utc)
        return age.total_seconds() <= float(ttl_s)
    except Exception:
        return False


def _parse_iso_utc(s: str) -> Optional[datetime]:
    raw = (s or "").strip()
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _get_cached_cluster_enrich(cluster_id: str) -> Optional[Dict[str, Any]]:
    cid = (cluster_id or "").strip()
    if not cid:
        return None
    with _db() as conn:
        row = conn.execute(
            "SELECT title_en, summary_en, created_utc FROM cluster_enrich_cache WHERE cluster_id = ?",
            (cid,),
        ).fetchone()
        if not row:
            return None
        return {"title_en": row["title_en"], "summary_en": row["summary_en"], "created_utc": row["created_utc"]}


def _get_fresh_cluster_enrich(cluster_id: str) -> Optional[Dict[str, Any]]:
    cached = _get_cached_cluster_enrich(cluster_id)
    if not cached:
        return None
    if not cached.get("title_en") or not cached.get("summary_en"):
        return None
    if not _iso_is_fresh(cached.get("created_utc") or "", _cluster_enrich_ttl_s()):
        return None
    return cached


def _set_cached_cluster_enrich(cluster_id: str, title_en: str, summary_en: str) -> None:
    cid = (cluster_id or "").strip()
    if not cid:
        return
    with _db() as conn:
        conn.execute(
            """
            INSERT INTO cluster_enrich_cache (cluster_id, title_en, summary_en, created_utc)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(cluster_id) DO UPDATE SET
              title_en=excluded.title_en,
              summary_en=excluded.summary_en,
              created_utc=excluded.created_utc
            """,
            (cid, title_en, summary_en, _now_utc_iso()),
        )
        conn.commit()


# ----------------------------
# Cluster meta cache helpers
# ----------------------------
def _set_cluster_meta(cluster_id: str, keywords: List[str], entities: List[str], confidence: float) -> None:
    cid = (cluster_id or "").strip()
    if not cid:
        return
    try:
        keywords_json = json.dumps(keywords, ensure_ascii=False)
        entities_json = json.dumps(entities, ensure_ascii=False)
    except Exception:
        keywords_json = "[]"
        entities_json = "[]"

    conf = float(confidence)
    if conf < 0.0:
        conf = 0.0
    if conf > 1.0:
        conf = 1.0

    with _db() as conn:
        conn.execute(
            """
            INSERT INTO cluster_meta_cache (cluster_id, keywords_json, entities_json, confidence, created_utc)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(cluster_id) DO UPDATE SET
              keywords_json=excluded.keywords_json,
              entities_json=excluded.entities_json,
              confidence=excluded.confidence,
              created_utc=excluded.created_utc
            """,
            (cid, keywords_json, entities_json, conf, _now_utc_iso()),
        )
        conn.commit()


# ----------------------------
# /top payload cache
# ----------------------------
def _top_ttl_s() -> int:
    try:
        return int((os.getenv("TOP_TTL_S") or "120").strip())
    except Exception:
        return 120


def _top_cache_max_rows() -> int:
    try:
        return int((os.getenv("TOP_CACHE_MAX_ROWS") or "300").strip())
    except Exception:
        return 300


def _top_cache_key(region: str, subdivision: str, range: str, q: str, limit: int) -> str:
    rg = (region or "").strip().lower()
    sd = (subdivision or "").strip().lower()
    r = (range or "").strip().lower()
    qq = (q or "").strip().lower()
    lim = int(limit)
    return f"top|region={rg}|subdivision={sd}|range={r}|q={qq}|limit={lim}"


def _top_cache_get(cache_key: str) -> Optional[Tuple[Dict[str, Any], int]]:
    ttl = _top_ttl_s()
    if ttl <= 0:
        return None

    with _db() as conn:
        row = conn.execute(
            "SELECT payload_json, created_utc FROM top_cache WHERE cache_key = ?",
            (cache_key,),
        ).fetchone()

    if not row:
        return None

    created = row["created_utc"] or ""
    if not _iso_is_fresh(created, ttl):
        return None

    try:
        payload = json.loads(row["payload_json"] or "{}")
    except Exception:
        return None

    try:
        dt = datetime.fromisoformat(created)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        age_s = int((datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds())
        if age_s < 0:
            age_s = 0
    except Exception:
        age_s = 0

    return payload, age_s


def _top_cache_set(cache_key: str, payload: Dict[str, Any]) -> None:
    ttl = _top_ttl_s()
    if ttl <= 0:
        return

    payload_json = json.dumps(payload, ensure_ascii=False)
    now = _now_utc_iso()

    with _db() as conn:
        conn.execute(
            """
            INSERT INTO top_cache (cache_key, payload_json, created_utc)
            VALUES (?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET
              payload_json=excluded.payload_json,
              created_utc=excluded.created_utc
            """,
            (cache_key, payload_json, now),
        )
        conn.commit()

        max_rows = _top_cache_max_rows()
        if max_rows > 0:
            count_row = conn.execute("SELECT COUNT(*) AS n FROM top_cache").fetchone()
            n = int(count_row["n"]) if count_row and count_row["n"] is not None else 0
            if n > max_rows:
                to_delete = n - max_rows
                keys = conn.execute(
                    """
                    SELECT cache_key FROM top_cache
                    ORDER BY created_utc ASC
                    LIMIT ?
                    """,
                    (to_delete,),
                ).fetchall()
                for r in keys:
                    conn.execute("DELETE FROM top_cache WHERE cache_key = ?", (r["cache_key"],))
                conn.commit()


def _inject_cluster_cache_into_payload(payload: Dict[str, Any]) -> None:
    try:
        clusters = payload.get("clusters") or []
        if not isinstance(clusters, list):
            return

        for cobj in clusters:
            if not isinstance(cobj, dict):
                continue
            cid = (cobj.get("cluster_id") or "").strip()
            if not cid:
                continue
            best_item = cobj.get("best_item")
            if not isinstance(best_item, dict):
                continue

            if best_item.get("title_en") and best_item.get("summary_en"):
                continue

            cached_cluster = _get_fresh_cluster_enrich(cid)
            if not cached_cluster:
                continue

            best_item["title_en"] = cached_cluster.get("title_en") or ""
            best_item["summary_en"] = cached_cluster.get("summary_en") or ""
            best_item["has_cached_summary"] = True
    except Exception:
        return


# ----------------------------
# /news TTL cache
# ----------------------------
_NEWS_CACHE_LOCK = threading.Lock()
_NEWS_CACHE: Dict[str, Dict[str, Any]] = {}


def _news_ttl_s() -> int:
    try:
        return int((os.getenv("NEWS_TTL_S") or "120").strip())
    except Exception:
        return 120


def _news_cache_max_keys() -> int:
    try:
        return int((os.getenv("NEWS_CACHE_MAX_KEYS") or "200").strip())
    except Exception:
        return 200


def _news_cache_get(key: str) -> Optional[Tuple[Dict[str, Any], int]]:
    ttl = _news_ttl_s()
    if ttl <= 0:
        return None

    now = time.time()
    with _NEWS_CACHE_LOCK:
        entry = _NEWS_CACHE.get(key)
        if not entry:
            return None
        age = int(now - float(entry.get("ts", 0.0)))
        if age < 0:
            age = 0
        if age > ttl:
            _NEWS_CACHE.pop(key, None)
            return None

        payload = copy.deepcopy(entry.get("payload", {}))
        return payload, age


def _news_cache_set(key: str, payload: Dict[str, Any]) -> None:
    ttl = _news_ttl_s()
    if ttl <= 0:
        return

    now = time.time()
    with _NEWS_CACHE_LOCK:
        _NEWS_CACHE[key] = {"ts": now, "payload": copy.deepcopy(payload)}

        max_keys = _news_cache_max_keys()
        if max_keys > 0 and len(_NEWS_CACHE) > max_keys:
            items = list(_NEWS_CACHE.items())
            items.sort(key=lambda kv: float(kv[1].get("ts", 0.0)))
            for k, _v in items[: max(1, len(_NEWS_CACHE) - max_keys)]:
                _NEWS_CACHE.pop(k, None)


# ----------------------------
# Simple rate limit
# ----------------------------
_RATE_LOCK = threading.Lock()
_RATE_BUCKETS: Dict[str, List[float]] = {}


def _env_bool(key: str, default: bool = False) -> bool:
    v = (os.getenv(key) or "").strip().lower()
    if v in ("1", "true", "yes", "on"):
        return True
    if v in ("0", "false", "no", "off"):
            return False
    return default


def _env_int(key: str, default: int) -> int:
    try:
        return int((os.getenv(key) or "").strip())
    except Exception:
        return default


def _env_float(key: str, default: float) -> float:
    try:
        return float((os.getenv(key) or "").strip())
    except Exception:
        return default


def _client_ip(req: Request) -> str:
    try:
        if req.client and req.client.host:
            return str(req.client.host)
    except Exception:
        pass
    return "unknown"


def _rate_limit_check(req: Request) -> None:
    if not _env_bool("ENRICH_RATE_LIMIT_ENABLED", default=True):
        return

    rpm = _env_int("ENRICH_RPM", 30)
    window_s = _env_int("ENRICH_WINDOW_S", 60)

    if rpm <= 0:
        return
    if window_s <= 0:
        window_s = 60

    ip = _client_ip(req)
    now = time.time()
    cutoff = now - float(window_s)

    with _RATE_LOCK:
        bucket = _RATE_BUCKETS.get(ip) or []
        bucket = [t for t in bucket if t >= cutoff]

        if len(bucket) >= rpm:
            retry_after = 5
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded for /enrich. Try again in a few seconds.",
                headers={"Retry-After": str(retry_after)},
            )

        bucket.append(now)
        _RATE_BUCKETS[ip] = bucket


# ----------------------------
# Source category extraction + mapping
# ----------------------------
def _extract_entry_categories(entry: Dict[str, Any]) -> List[str]:
    cats: List[str] = []

    tags = entry.get("tags")
    if isinstance(tags, list):
        for t in tags:
            try:
                if isinstance(t, dict):
                    term = (t.get("term") or t.get("label") or "").strip()
                    if term:
                        cats.append(term)
                else:
                    s = str(t).strip()
                    if s:
                        cats.append(s)
            except Exception:
                continue

    cat = entry.get("category")
    if isinstance(cat, str) and cat.strip():
        cats.append(cat.strip())

    categories = entry.get("categories")
    if isinstance(categories, list):
        for c in categories:
            try:
                if isinstance(c, str) and c.strip():
                    cats.append(c.strip())
                elif isinstance(c, dict):
                    term = (c.get("term") or c.get("label") or "").strip()
                    if term:
                        cats.append(term)
                else:
                    s = str(c).strip()
                    if s:
                        cats.append(s)
            except Exception:
                continue

    seen = set()
    out: List[str] = []
    for c in cats:
        cc = c.strip()
        if not cc:
            continue
        key = cc.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(cc)
    return out


def _norm_cat(s: str) -> str:
    t = (s or "").strip().lower()
    t = unicodedata.normalize("NFKD", t)
    t = "".join(ch for ch in t if not unicodedata.combining(ch))
    t = re.sub(r"\s+", " ", t)
    return t


def _map_source_category_to_topic(cat: str) -> Optional[str]:
    c = _norm_cat(cat)
    if not c:
        return None

    if any(x in c for x in ["conflicto", "guerra", "invasion", "invasión", "tension", "tensión"]):
        if any(
            x in c
            for x in [
                "medio oriente",
                "oriente medio",
                "israel",
                "gaza",
                "palest",
                "iran",
                "irán",
                "teheran",
                "teherán",
                "ucrania",
                "rusia",
                "otan",
                "onu",
                "china",
                "eeuu",
                "estados unidos",
                "union europea",
                "unión europea",
            ]
        ):
            return "World"
        return "World"

    if any(
        x in c
        for x in [
            "medio oriente",
            "oriente medio",
            "israel",
            "gaza",
            "palest",
            "iran",
            "irán",
            "ucrania",
            "rusia",
            "onu",
            "otan",
            "union europea",
            "unión europea",
            "eeuu",
            "estados unidos",
        ]
    ):
        return "World"

    if any(x in c for x in ["clima", "meteorolog", "meteorologí", "tiempo", "pronostico", "pronóstico", "inumet"]):
        return "Environment"

    if any(
        x in c
        for x in [
            "deporte",
            "deportes",
            "sports",
            "futbol",
            "fútbol",
            "futebol",
            "tenis",
            "rugby",
            "basquet",
            "básquet",
            "basket",
        ]
    ):
        return "Sports"

    if any(
        x in c
        for x in [
            "politica",
            "política",
            "gobierno",
            "parlamento",
            "elecciones",
            "estado",
            "congreso",
            "senado",
        ]
    ):
        return "Politics"

    if (
        "mercado" in c
        or "markets" in c
        or "bolsa" in c
        or "acciones" in c
        or "bonos" in c
        or "finanzas" in c
        or "trading" in c
    ):
        return "Markets"
    if "empresa" in c or "empresas" in c or "negocio" in c or "negocios" in c or "industria" in c or "corporat" in c:
        return "Business"
    if "econom" in c or "inflacion" in c or "inflación" in c or "pib" in c or "macro" in c:
        return "Economy"

    if any(x in c for x in ["internacional", "internacionales", "mundo", "world", "exterior", "global"]):
        return "World"

    if any(
        x in c
        for x in [
            "sociedad",
            "social",
            "comunidad",
            "local",
            "locales",
            "ciudad",
            "ciudades",
            "interes general",
            "interés general",
            "actualidad",
            "cotidiano",
        ]
    ):
        return "Society"

    if any(x in c for x in ["educacion", "educación", "escuela", "liceo", "universidad", "udelar", "ensenanza", "enseñanza"]):
        return "Education"

    if any(x in c for x in ["salud", "health", "hospital", "medicina", "covid", "dengue"]):
        return "Health"

    if any(x in c for x in ["ciencia", "science", "investigacion", "investigación", "laboratorio", "espacio", "astronomia", "astronomía"]):
        return "Science"

    if any(
        x in c
        for x in [
            "tecnologia",
            "tecnología",
            "technology",
            "tech",
            "ciberseguridad",
            "internet",
            "software",
            "inteligencia artificial",
            "inteligencia",
            "artificial",
            "ia",
            "ai",
        ]
    ):
        return "Technology"

    if any(x in c for x in ["energia", "energía", "petroleo", "petróleo", "gas", "ute", "ancap", "combustible", "renovable", "eolica", "eólica", "solar"]):
        return "Energy"

    if any(
        x in c
        for x in [
            "ambiente",
            "medio ambiente",
            "environment",
            "clima",
            "climate",
            "inundacion",
            "inundación",
            "sequia",
            "sequía",
            "contaminacion",
            "contaminación",
        ]
    ):
        return "Environment"

    if any(
        x in c
        for x in [
            "seguridad",
            "policial",
            "policiales",
            "policia",
            "policía",
            "crimen",
            "judicial",
            "tribunales",
            "narcotrafico",
            "narcotráfico",
            "delito",
            "delitos",
        ]
    ):
        return "Security"

    if any(x in c for x in ["cultura", "culture", "arte", "artes", "cine", "teatro", "musica", "música", "festival", "literatura"]):
        return "Culture"

    if any(x in c for x in ["nacional", "nacionales", "pais", "país", "uruguay", "argentina", "brasil", "paraguay", "bolivia", "mexico", "méxico"]):
        return "Society"

    return None


def _topic_from_source_categories(a: Dict[str, Any]) -> Optional[str]:
    cats = a.get("source_categories") or []
    if not isinstance(cats, list) or not cats:
        return None

    for c in cats:
        try:
            mapped = _map_source_category_to_topic(str(c))
            if mapped:
                return mapped
        except Exception:
            continue

    return None


# ----------------------------
# Article builder
# ----------------------------
def _build_article(source: Dict[str, Any], entry: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    link = (entry.get("link") or "").strip()
    title = (entry.get("title") or "").strip()
    if not link or not title:
        return None

    published_dt = _parse_date(entry)
    published_utc = published_dt.isoformat() if published_dt else None

    snippet = ""
    if entry.get("summary"):
        snippet = entry["summary"]
    elif entry.get("description"):
        snippet = entry["description"]
    elif entry.get("content") and isinstance(entry["content"], list) and entry["content"]:
        snippet = entry["content"][0].get("value", "") or ""

    snippet_text = _clean_text_any(snippet, max_chars=700)

    source_categories = _extract_entry_categories(entry)
    source_category_primary = source_categories[0] if source_categories else None

    article: Dict[str, Any] = {
        "title": title,
        "link": link,
        "published": entry.get("published") or entry.get("updated") or (published_dt.isoformat() if published_dt else ""),
        "published_utc": published_utc,
        "source": source["name"],
        "region_key": source.get("region_key"),
        "subdivision_key": source.get("subdivision_key") or source.get("country_key"),
        "country_key": source.get("country_key") or source.get("subdivision_key"),  # compatibility
        "subdivision_code": source.get("subdivision_code") or source.get("country_code"),
        "country_code": source.get("country_code") or source.get("subdivision_code"),  # compatibility
        "subdivision_flag_url": source.get("subdivision_flag_url") or source.get("country_flag_url"),
        "country_flag_url": source.get("country_flag_url") or source.get("subdivision_flag_url"),  # compatibility
        "source_logo": source.get("source_logo"),
        "snippet_text": snippet_text,
        "has_cached_summary": False,
        "source_categories": source_categories,
        "source_category_primary": source_category_primary,
    }

    cached = _get_cached_enrich(link)
    if cached and cached.get("summary_en"):
        article["title_en"] = cached.get("title_en") or ""
        article["summary_en"] = cached.get("summary_en") or ""
        article["has_cached_summary"] = True

    return article


# ----------------------------
# Deduplication
# ----------------------------
_NON_WORD = re.compile(r"[^a-z0-9\s]")


def _norm_title(s: str) -> str:
    s = (s or "").strip().lower()
    s = _NON_WORD.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _day_bucket(published_utc: Optional[str]) -> str:
    if not published_utc:
        return "unknown"
    try:
        dt = datetime.fromisoformat(published_utc)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).date().isoformat()
    except Exception:
        return "unknown"


def _sig(article: Dict[str, Any]) -> str:
    sk = (article.get("subdivision_key") or article.get("country_key") or "").lower() or "x"
    day = _day_bucket(article.get("published_utc"))
    nt = _norm_title(article.get("title") or "")
    raw = f"{sk}|{day}|{nt[:180]}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _quality_score(a: Dict[str, Any]) -> Tuple[int, int, str]:
    has_en = 1 if (a.get("title_en") and a.get("summary_en")) else 0
    has_cached = 1 if a.get("has_cached_summary") else 0
    snip_len = len((a.get("snippet_text") or "").strip())
    has_snip = 1 if snip_len >= 60 else 0
    pu = a.get("published_utc") or ""
    return (has_en * 3 + has_cached * 2 + has_snip, snip_len, pu)


def _dedupe(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    best: Dict[str, Dict[str, Any]] = {}
    counts: Dict[str, int] = {}

    for a in items:
        s = _sig(a)
        counts[s] = counts.get(s, 0) + 1
        if s not in best:
            best[s] = a
            continue
        if _quality_score(a) > _quality_score(best[s]):
            best[s] = a

    out = list(best.values())
    for a in out:
        s = _sig(a)
        c = counts.get(s, 1)
        if c > 1:
            a["duplicates_count"] = c
    return out


# ----------------------------
# Smarter clustering v2
# ----------------------------
_STOPWORDS = set(
    [
        "de", "la", "el", "los", "las", "y", "o", "u", "a", "en", "por", "para", "con", "sin",
        "del", "al", "un", "una", "unos", "unas", "que", "se", "su", "sus", "ya", "como", "más",
        "menos", "también", "pero", "tras", "ante", "sobre", "entre", "desde", "hasta",
        "de", "da", "do", "das", "dos", "e", "ou", "a", "o", "os", "as", "em", "por", "para",
        "com", "sem", "um", "uma", "uns", "umas", "que", "se", "sua", "suas", "seu", "seus",
        "como", "mais", "menos", "tambem", "mas", "entre", "desde", "ate",
        "the", "and", "or", "to", "in", "on", "for", "with", "without", "of", "a", "an", "as",
        "is", "are", "was", "were", "be", "been", "by", "from", "at", "this", "that", "these", "those",
    ]
)

_TOKEN_RE = re.compile(r"[a-z0-9áéíóúüñçãõâêîôûàèìòù]+", re.IGNORECASE)
_ENTITY_SEQ_RE = re.compile(
    r"\b([A-ZÁÉÍÓÚÜÑÇ][\wÁÉÍÓÚÜÑÇáéíóúüñçãõâêîôûàèìòù\-]+(?:\s+[A-ZÁÉÍÓÚÜÑÇ][\wÁÉÍÓÚÜÑÇáéíóúüñçãõâêîôûàèìòù\-]+){1,4})\b"
)


def _norm_for_tokens(s: str) -> str:
    t = (s or "").strip()
    t = unicodedata.normalize("NFKD", t)
    t = "".join(ch for ch in t if not unicodedata.combining(ch))
    t = t.lower()
    return t


def _tokens_from_text(s: str) -> List[str]:
    t = _norm_for_tokens(s)
    toks = _TOKEN_RE.findall(t)
    out: List[str] = []
    for tok in toks:
        tok = tok.strip().lower()
        if not tok:
            continue
        if len(tok) <= 2:
            continue
        if tok in _STOPWORDS:
            continue
        out.append(tok)
    return out


def _top_keywords(article: Dict[str, Any], max_k: int = 8) -> List[str]:
    raw = " ".join(
        [
            str(article.get("title") or ""),
            str(article.get("snippet_text") or ""),
            str(article.get("title_en") or ""),
            str(article.get("summary_en") or ""),
        ]
    )
    toks = _tokens_from_text(raw)
    if not toks:
        return []

    title_toks = _tokens_from_text(str(article.get("title") or ""))
    counts: Dict[str, float] = {}
    for tok in toks:
        counts[tok] = counts.get(tok, 0.0) + 1.0
    for tok in title_toks:
        counts[tok] = counts.get(tok, 0.0) + 1.5

    for ban in ["hoy", "ayer", "video", "fotos", "foto", "ultimas", "ultimo", "último", "últimas", "ahora", "nuevo", "nueva", "news"]:
        b = _norm_for_tokens(ban)
        counts.pop(b, None)

    ranked = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
    out = [k for k, _v in ranked[:max_k]]
    return out


def _extract_entities(title: str, max_e: int = 6) -> List[str]:
    s = (title or "").strip()
    if not s:
        return []
    found = _ENTITY_SEQ_RE.findall(s)
    seen = set()
    out: List[str] = []
    for ent in found:
        ent = ent.strip()
        if not ent:
            continue
        key = ent.lower()
        if key in seen:
            continue
        seen.add(key)
        if len(ent) < 4:
            continue
        out.append(ent)
        if len(out) >= max_e:
            break
    return out


def _jaccard(a: List[str], b: List[str]) -> float:
    sa = set(a or [])
    sb = set(b or [])
    if not sa or not sb:
        return 0.0
    inter = len(sa.intersection(sb))
    union = len(sa.union(sb))
    if union <= 0:
        return 0.0
    return float(inter) / float(union)


def _cluster_bucket_key(article: Dict[str, Any]) -> str:
    sk = (article.get("subdivision_key") or article.get("country_key") or "").strip().lower() or "x"
    day = _day_bucket(article.get("published_utc"))
    kws = _top_keywords(article, max_k=6)
    kw_part = "|".join(sorted(kws))[:220]
    raw = f"{sk}|{day}|{kw_part}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _cluster_id_v2(subdivision_key: str, day: str, keywords: List[str], entities: List[str]) -> str:
    sk = (subdivision_key or "x").strip().lower()
    dy = (day or "unknown").strip().lower()
    kw_part = "|".join(sorted(keywords or []))[:240]
    ent_part = "|".join((entities or [])[:2])[:120]
    raw = f"v2|{sk}|{dy}|{kw_part}|{ent_part}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _cluster_confidence(items: List[Dict[str, Any]], rep_keywords: List[str]) -> float:
    if not items:
        return 0.0

    rep = rep_keywords or []
    sims: List[float] = []
    unique_sources = set()
    snip_good = 0

    for it in items:
        unique_sources.add((it.get("source") or "").strip().lower())
        kws = _top_keywords(it, max_k=8)
        sims.append(_jaccard(rep, kws))
        if len((it.get("snippet_text") or "").strip()) >= 60:
            snip_good += 1

    avg_sim = sum(sims) / float(len(sims)) if sims else 0.0
    src_boost = min(0.20, 0.08 * max(0, len(unique_sources) - 1))
    snip_boost = min(0.15, 0.05 * snip_good)

    conf = avg_sim + src_boost + snip_boost
    if conf < 0.0:
        conf = 0.0
    if conf > 1.0:
        conf = 1.0
    return conf


def _cluster_items_v2(raw: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    buckets: Dict[str, List[Dict[str, Any]]] = {}
    for a in raw:
        bkey = _cluster_bucket_key(a)
        buckets.setdefault(bkey, []).append(a)

    clusters_out: List[Dict[str, Any]] = []
    sim_threshold = _env_float("CLUSTER_SIM_THRESHOLD", 0.62)

    for _bkey, items in buckets.items():
        if not items:
            continue

        for it in items:
            it["_kws"] = _top_keywords(it, max_k=10)

        n = len(items)
        parent = list(range(n))

        def find(x: int) -> int:
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        def union(x: int, y: int) -> None:
            rx = find(x)
            ry = find(y)
            if rx != ry:
                parent[ry] = rx

        for i in range(n):
            for j in range(i + 1, n):
                si = _jaccard(items[i].get("_kws") or [], items[j].get("_kws") or [])
                if si >= float(sim_threshold):
                    union(i, j)

        groups: Dict[int, List[Dict[str, Any]]] = {}
        for idx in range(n):
            root = find(idx)
            groups.setdefault(root, []).append(items[idx])

        for gitems in groups.values():
            best = gitems[0]
            for it in gitems[1:]:
                if _quality_score(it) > _quality_score(best):
                    best = it
                elif _quality_score(it) == _quality_score(best):
                    if float(it.get("rank_score") or 0.0) > float(best.get("rank_score") or 0.0):
                        best = it

            sk = (best.get("subdivision_key") or best.get("country_key") or "").strip().lower() or "x"
            dy = _day_bucket(best.get("published_utc"))
            rep_keywords = _top_keywords(best, max_k=10)
            rep_entities = _extract_entities(str(best.get("title") or ""), max_e=6)
            cid = _cluster_id_v2(sk, dy, rep_keywords, rep_entities)

            for it in gitems:
                it["cluster_id"] = cid

            seen_sources: Dict[str, Dict[str, Any]] = {}
            for it in gitems:
                sname = (it.get("source") or "").strip() or "Unknown"
                if sname not in seen_sources:
                    seen_sources[sname] = {
                        "source": sname,
                        "link": it.get("link") or "",
                        "published_utc": it.get("published_utc") or "",
                    }
            sources_list = list(seen_sources.values())

            conf = _cluster_confidence(gitems, rep_keywords)

            try:
                _set_cluster_meta(cid, rep_keywords, rep_entities, conf)
            except Exception:
                pass

            best_out = dict(best)
            best_out["cluster_id"] = cid
            best_out["cluster_confidence"] = conf
            best_out["cluster_keywords"] = rep_keywords
            best_out["cluster_entities"] = rep_entities

            best_out = _strip_internal_fields(best_out)

            clusters_out.append(
                {
                    "cluster_id": cid,
                    "topic": best.get("topic") or "General",
                    "duplicates_count": len(gitems),
                    "sources_count": len(sources_list),
                    "sources": sources_list,
                    "best_item": best_out,
                    "cluster_confidence": conf,
                    "cluster_keywords": rep_keywords,
                    "cluster_entities": rep_entities,
                }
            )

    return clusters_out


# ----------------------------
# Topic labeling v5
# ----------------------------
GENERAL_LABEL = "General"
MIN_SCORE = 4.0
MIN_MARGIN = 1.25
STRONG_WIN_SCORE = 8.5
SPORTS_MIN_SCORE = 6.0
SPORTS_REQUIRE_ANCHOR = True
_SCORE_PATTERN = re.compile(r"\b\d{1,2}\s*[-–:]\s*\d{1,2}\b")

CATEGORY_RULES: Dict[str, Dict[str, Dict[str, float]]] = {
    "Politics": {
        "strong": {
            "presidente": 4.0,
            "gobierno": 3.5,
            "parlamento": 3.5,
            "senado": 3.5,
            "diputados": 3.5,
            "ministerio": 3.0,
            "elecciones": 4.0,
            "plebiscito": 4.0,
            "referendum": 4.0,
            "decreto": 3.0,
            "oposicion": 2.5,
            "fiscalia": 3.0,
            "corte": 2.5,
            "tribunal": 2.5,
            "justicia": 2.5,
        },
        "keywords": {
            "partido": 1.5,
            "campana": 1.5,
            "coalicion": 1.5,
            "intendente": 1.5,
            "alcalde": 1.5,
            "canciller": 1.5,
            "ley": 1.5,
            "proyecto": 1.0,
            "plenario": 1.5,
            "comision": 1.0,
            "diputado": 1.5,
            "senador": 1.5,
        },
        "negative": {},
    },
    "Economy": {
        "strong": {
            "inflacion": 4.0,
            "pib": 3.5,
            "recesion": 4.0,
            "tasa de interes": 4.0,
            "banco central": 4.0,
            "deuda": 3.0,
            "fmi": 3.5,
            "imf": 3.5,
            "desempleo": 3.5,
        },
        "keywords": {
            "crecimiento": 2.0,
            "exportaciones": 2.0,
            "importaciones": 2.0,
            "salarios": 2.0,
            "empleo": 2.0,
            "impuestos": 2.0,
            "arancel": 1.5,
            "dolar": 1.5,
            "usd": 1.0,
            "peso": 1.0,
            "real": 1.0,
            "costo de vida": 2.5,
            "ipc": 2.5,
            "tarifas": 2.0,
        },
        "negative": {},
    },
    "Business": {
        "strong": {
            "empresa": 3.0,
            "inversion": 3.0,
            "inversiones": 3.0,
            "fusion": 3.5,
            "fusiones": 3.5,
            "adquisicion": 3.5,
            "ganancias": 3.0,
            "resultados": 2.5,
            "restructuracion": 3.0,
            "ipo": 3.5,
        },
        "keywords": {
            "accionistas": 2.0,
            "startup": 2.0,
            "fintech": 2.5,
            "banco": 1.0,
            "industria": 1.5,
            "planta": 1.5,
            "empleador": 1.5,
            "contrato": 1.2,
        },
        "negative": {},
    },
    "Markets": {
        "strong": {
            "bolsa": 4.0,
            "acciones": 3.0,
            "bonos": 3.0,
            "wall street": 4.0,
            "nasdaq": 4.0,
            "dow jones": 4.0,
            "sp 500": 4.0,
            "s&p 500": 4.0,
            "tipo de cambio": 4.0,
        },
        "keywords": {
            "mercados": 2.0,
            "riesgo pais": 3.5,
            "dolar blue": 3.0,
            "cotizacion": 2.0,
            "cotización": 2.0,
            "bitcoin": 2.5,
            "btc": 1.5,
            "ethereum": 2.0,
            "etf": 2.0,
        },
        "negative": {},
    },
    "World": {
        "strong": {
            "onu": 3.0,
            "guerra": 3.5,
            "conflicto": 3.0,
            "ucrania": 4.0,
            "israel": 4.0,
            "gaza": 4.0,
            "china": 3.0,
            "eeuu": 3.0,
            "estados unidos": 3.0,
            "union europea": 3.0,
            "otan": 3.5,
        },
        "keywords": {
            "diplomacia": 2.0,
            "cumbre": 2.0,
            "sanciones": 2.0,
            "embajada": 2.0,
            "consulado": 2.0,
        },
        "negative": {},
    },
    "Society": {
        "strong": {
            "policia": 3.5,
            "policía": 3.5,
            "crimen": 3.5,
            "homicidio": 4.0,
            "asesinato": 4.0,
            "violencia": 3.0,
            "accidente": 3.0,
            "incendio": 3.0,
            "bomberos": 3.0,
            "tragedia": 3.0,
            "transito": 2.5,
            "tránsito": 2.5,
        },
        "keywords": {
            "barrio": 1.5,
            "vecinos": 1.5,
            "protesta": 2.0,
            "manifestacion": 2.0,
            "manifestación": 2.0,
            "sindicato": 2.0,
            "paro": 2.0,
            "huelga": 2.0,
            "educacion": 1.0,
            "educación": 1.0,
        },
        "negative": {},
    },
    "Education": {
        "strong": {
            "escuela": 3.5,
            "liceo": 3.5,
            "universidad": 3.5,
            "udelar": 3.5,
            "docentes": 3.0,
            "clases": 2.5,
            "inscripciones": 3.0,
        },
        "keywords": {
            "alumnos": 2.0,
            "estudiantes": 2.0,
            "facultad": 2.0,
            "beca": 2.0,
            "examen": 2.0,
        },
        "negative": {},
    },
    "Health": {
        "strong": {
            "vacuna": 4.0,
            "dengue": 4.0,
            "brote": 3.5,
            "outbreak": 3.5,
            "virus": 3.0,
            "epidemia": 3.0,
            "hospital": 3.0,
            "covid": 3.5,
            "gripe": 3.0,
        },
        "keywords": {
            "salud": 2.0,
            "medicos": 2.0,
            "médicos": 2.0,
            "pacientes": 2.0,
            "tratamiento": 2.0,
            "clinica": 2.0,
            "clínica": 2.0,
        },
        "negative": {},
    },
    "Science": {
        "strong": {
            "investigacion": 3.5,
            "investigación": 3.5,
            "cientific": 3.0,
            "ciencia": 3.0,
            "estudio": 2.5,
            "laboratorio": 3.0,
        },
        "keywords": {
            "astronomia": 3.0,
            "astronomía": 3.0,
            "espacio": 2.0,
            "nasa": 3.0,
            "descubrimiento": 3.0,
        },
        "negative": {},
    },
    "Technology": {
        "strong": {
            "inteligencia artificial": 4.0,
            "ciberseguridad": 4.0,
            "data breach": 4.0,
            "hackeo": 3.5,
            "software": 2.5,
            "cloud": 2.5,
        },
        "keywords": {
            "ia": 2.0,
            "ai": 2.0,
            "datos": 1.5,
            "algoritmo": 2.0,
            "plataforma": 1.5,
            "chip": 2.0,
            "robot": 2.0,
            "app": 2.0,
        },
        "negative": {},
    },
    "Energy": {
        "strong": {
            "petroleo": 4.0,
            "petróleo": 4.0,
            "gas": 3.0,
            "energia": 3.0,
            "energía": 3.0,
            "combustible": 3.0,
            "ute": 3.5,
            "ancap": 3.5,
        },
        "keywords": {
            "renovable": 2.5,
            "eolica": 2.5,
            "eólica": 2.5,
            "solar": 2.0,
            "tarifa": 2.0,
        },
        "negative": {},
    },
    "Environment": {
        "strong": {
            "clima": 3.0,
            "sequía": 4.0,
            "sequia": 4.0,
            "inundacion": 4.0,
            "inundación": 4.0,
            "incendios forestales": 4.0,
            "contaminacion": 3.5,
            "contaminación": 3.5,
        },
        "keywords": {
            "medio ambiente": 3.0,
            "fauna": 2.5,
            "bosque": 2.5,
            "rio": 1.5,
            "río": 1.5,
            "agua": 1.5,
        },
        "negative": {},
    },
    "Security": {
        "strong": {
            "narcotrafico": 4.0,
            "narcotráfico": 4.0,
            "trafico de drogas": 4.0,
            "tráfico de drogas": 4.0,
            "contrabando": 3.5,
            "operativo": 3.0,
            "allanamiento": 3.5,
            "detenido": 3.0,
        },
        "keywords": {
            "seguridad": 2.0,
            "guardia": 2.0,
            "carcel": 3.0,
            "cárcel": 3.0,
            "penitenciaria": 3.0,
            "penitenciaría": 3.0,
        },
        "negative": {},
    },
    "Culture": {
        "strong": {
            "cine": 3.0,
            "musica": 3.0,
            "música": 3.0,
            "teatro": 3.0,
            "festival": 3.0,
            "literatura": 3.0,
            "arte": 2.5,
        },
        "keywords": {
            "museo": 2.0,
            "exposicion": 2.0,
            "exposición": 2.0,
            "concierto": 2.5,
            "tv": 1.5,
            "pelicula": 2.0,
            "película": 2.0,
        },
        "negative": {},
    },
    "Sports": {
        "strong": {
            "futbol": 4.0,
            "futebol": 4.0,
            "basquet": 3.5,
            "basket": 3.5,
            "baloncesto": 3.5,
            "tenis": 3.0,
            "rugby": 3.0,
            "golf": 3.0,
            "nba": 4.0,
            "nfl": 4.0,
            "mlb": 4.0,
            "nhl": 4.0,
            "copa libertadores": 5.0,
            "sudamericana": 4.0,
            "eliminatorias": 4.0,
            "gran premio": 3.5,
            "formula 1": 4.0,
            "motogp": 4.0,
            "penarol": 3.5,
            "peñarol": 3.5,
            "nacional": 1.0,
        },
        "keywords": {
            "partido": 1.0,
            "liga": 1.0,
            "copa": 1.0,
            "torneo": 1.0,
            "campeonato": 1.5,
            "seleccion": 2.0,
            "selecao": 2.0,
            "gol": 2.0,
            "entrenador": 2.0,
            "jugador": 2.0,
            "fixture": 2.5,
            "referee": 2.0,
            "coach": 2.0,
            "player": 2.0,
        },
        "negative": {
            "parlamento": 2.0,
            "senado": 2.0,
            "diputados": 2.0,
            "ministerio": 2.0,
            "banco central": 2.0,
            "inflacion": 2.0,
            "decreto": 2.0,
            "impuestos": 2.0,
            "fiscalia": 2.0,
            "justicia": 2.0,
        },
    },
}

SPORTS_ANCHORS = [
    "futbol", "futebol", "basquet", "basket", "baloncesto", "tenis", "rugby", "golf",
    "nba", "nfl", "mlb", "nhl", "formula 1", "motogp", "copa libertadores", "sudamericana",
    "eliminatorias", "gol", "entrenador", "jugador", "fixture", "penarol", "peñarol",
    "boca", "river", "flamengo", "gremio", "grêmio", "palmeiras",
]

NON_SPORTS_DOMINATORS = [
    "presidente", "gobierno", "parlamento", "senado", "diputados", "ministerio",
    "banco central", "inflacion", "pib", "deuda", "impuestos", "decreto", "fiscalia", "justicia",
]


def _norm_text_for_topic(text: str) -> str:
    if not text:
        return ""
    t = text.lower().strip()
    t = unicodedata.normalize("NFKD", t)
    t = "".join(ch for ch in t if not unicodedata.combining(ch))
    t = re.sub(r"\s+", " ", t)
    return t


def _count_phrase_hits(text: str, phrase: str) -> int:
    if not phrase:
        return 0
    if " " in phrase:
        return 1 if phrase in text else 0
    return len(re.findall(rf"\b{re.escape(phrase)}\b", text))


def _score_category(text: str, rules: Dict[str, Dict[str, float]]) -> Tuple[float, List[str]]:
    score = 0.0
    matched: List[str] = []

    for phrase, w in (rules.get("strong") or {}).items():
        hits = _count_phrase_hits(text, phrase)
        if hits:
            score += w * hits
            matched.append(f"+{phrase}")

    for phrase, w in (rules.get("keywords") or {}).items():
        hits = _count_phrase_hits(text, phrase)
        if hits:
            score += w * hits
            matched.append(f"+{phrase}")

    for phrase, pen in (rules.get("negative") or {}).items():
        hits = _count_phrase_hits(text, phrase)
        if hits:
            score -= abs(pen) * hits
            matched.append(f"-{phrase}")

    distinct_positive = len([m for m in matched if m.startswith("+")])
    if distinct_positive >= 3:
        score += 1.0
    elif distinct_positive == 2:
        score += 0.5

    return score, matched


def _topic_label(a: Dict[str, Any]) -> str:
    source_topic = _topic_from_source_categories(a)
    if source_topic:
        if _env_bool("TOPIC_DEBUG", default=False):
            a["_topic_debug"] = {
                "method": "source_category",
                "source_categories": a.get("source_categories") or [],
                "picked": source_topic,
            }
        return source_topic

    raw = " ".join(
        [
            str(a.get("title_en") or ""),
            str(a.get("summary_en") or ""),
            str(a.get("title") or ""),
            str(a.get("snippet_text") or ""),
        ]
    )
    text = _norm_text_for_topic(raw)
    if not text:
        return GENERAL_LABEL

    scores: Dict[str, float] = {}
    debug_hits: Dict[str, List[str]] = {}

    for label, rules in CATEGORY_RULES.items():
        s, matched = _score_category(text, rules)
        scores[label] = s
        debug_hits[label] = matched

    if "Sports" in scores:
        sports_score = scores.get("Sports") or 0.0
        has_anchor = any(anchor in text for anchor in SPORTS_ANCHORS) or bool(_SCORE_PATTERN.search(text))
        dominators_hit = sum(1 for d in NON_SPORTS_DOMINATORS if d in text)

        if SPORTS_REQUIRE_ANCHOR and not has_anchor:
            scores["Sports"] = -999.0
        else:
            if dominators_hit >= 2 and sports_score < (SPORTS_MIN_SCORE + 3.0):
                scores["Sports"] = -999.0
            elif sports_score < SPORTS_MIN_SCORE:
                scores["Sports"] = -999.0

    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    best_label, best_score = ranked[0]
    second_score = ranked[1][1] if len(ranked) > 1 else -999.0

    if _env_bool("TOPIC_DEBUG", default=False):
        a["_topic_debug"] = {
            "method": "scoring_fallback",
            "best": {"label": best_label, "score": best_score},
            "second_score": second_score,
            "scores": scores,
            "hits": debug_hits,
        }

    if best_score < MIN_SCORE:
        return GENERAL_LABEL

    if (best_score - second_score) < MIN_MARGIN and best_score < STRONG_WIN_SCORE:
        return GENERAL_LABEL

    return best_label


# ----------------------------
# Ranking v2
# ----------------------------
def _rank_weights() -> Dict[str, float]:
    return {
        "recency_weight": _env_float("RANK_RECENCY_W", 5.0),
        "recency_tau_hours": _env_float("RANK_RECENCY_TAU_H", 10.0),
        "duplicates_weight": _env_float("RANK_DUP_W", 0.8),
        "snippet_weight": _env_float("RANK_SNIP_W", 0.8),
        "cached_weight": _env_float("RANK_CACHED_W", 0.5),
        "mercopress_boost": _env_float("RANK_MP_BOOST", 0.6),
    }


def _rank_score_and_factors(a: Dict[str, Any]) -> Tuple[float, Dict[str, Any]]:
    now = datetime.now(timezone.utc)

    pu = a.get("published_utc") or ""
    if pu:
        try:
            dt = datetime.fromisoformat(pu)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            age_hours = max(0.0, (now - dt.astimezone(timezone.utc)).total_seconds() / 3600.0)
        except Exception:
            age_hours = 6.0
    else:
        age_hours = 6.0

    w = _rank_weights()

    tau = max(1e-6, float(w["recency_tau_hours"]))
    recency_raw = math.exp(-age_hours / tau)
    recency_term = recency_raw * float(w["recency_weight"])

    dup = int(a.get("duplicates_count") or 1)
    dup_raw = math.log1p(max(1, dup))
    dup_term = dup_raw * float(w["duplicates_weight"])

    snip_len = len((a.get("snippet_text") or "").strip())
    snip_raw = min(1.0, snip_len / 220.0)
    snip_term = snip_raw * float(w["snippet_weight"])

    has_cached = 1.0 if a.get("has_cached_summary") else 0.0
    cached_term = has_cached * float(w["cached_weight"])

    subdivision_key = (a.get("subdivision_key") or a.get("country_key") or "").lower()
    is_mercopress = subdivision_key == "mp"
    mp_term = float(w["mercopress_boost"]) if is_mercopress else 0.0

    score = float(recency_term + dup_term + snip_term + cached_term + mp_term)

    factors: Dict[str, Any] = {
        "age_hours": round(float(age_hours), 3),
        "recency_raw": round(float(recency_raw), 6),
        "recency_term": round(float(recency_term), 6),
        "dup_count": int(dup),
        "dup_raw": round(float(dup_raw), 6),
        "dup_term": round(float(dup_term), 6),
        "snippet_len": int(snip_len),
        "snippet_raw": round(float(snip_raw), 6),
        "snippet_term": round(float(snip_term), 6),
        "has_cached_summary": bool(a.get("has_cached_summary")),
        "cached_term": round(float(cached_term), 6),
        "is_mercopress": bool(is_mercopress),
        "mp_term": round(float(mp_term), 6),
        "weights": {
            "recency_weight": w["recency_weight"],
            "recency_tau_hours": w["recency_tau_hours"],
            "duplicates_weight": w["duplicates_weight"],
            "snippet_weight": w["snippet_weight"],
            "cached_weight": w["cached_weight"],
            "mercopress_boost": w["mercopress_boost"],
        },
    }

    return score, factors


def _cluster_rank_weights() -> Dict[str, float]:
    return {
        "recency_weight": _env_float("CLUSTER_RANK_RECENCY_W", 4.6),
        "recency_tau_hours": _env_float("CLUSTER_RANK_RECENCY_TAU_H", 14.0),
        "duplicates_weight": _env_float("CLUSTER_RANK_DUP_W", 1.65),
        "sources_weight": _env_float("CLUSTER_RANK_SOURCES_W", 1.05),
        "confidence_weight": _env_float("CLUSTER_RANK_CONF_W", 2.2),
        "snippet_weight": _env_float("CLUSTER_RANK_SNIP_W", 0.45),
        "cached_weight": _env_float("CLUSTER_RANK_CACHED_W", 0.35),
        "mercopress_penalty_all": _env_float("CLUSTER_RANK_MP_PENALTY_ALL", 0.35),
        "mercopress_boost_mp": _env_float("CLUSTER_RANK_MP_BOOST_MP", 0.35),
    }


def _cluster_rank_score_and_factors(cobj: Dict[str, Any], subdivision_context: str) -> Tuple[float, Dict[str, Any]]:
    best = cobj.get("best_item") or {}
    now = datetime.now(timezone.utc)

    pu = (best.get("published_utc") or "").strip()
    dt = _parse_iso_utc(pu)
    if dt is None:
        age_hours = 6.0
    else:
        age_hours = max(0.0, (now - dt).total_seconds() / 3600.0)

    w = _cluster_rank_weights()

    tau = max(1e-6, float(w["recency_tau_hours"]))
    recency_raw = math.exp(-age_hours / tau)
    recency_term = recency_raw * float(w["recency_weight"])

    dup_count = max(1, int(cobj.get("duplicates_count") or 1))
    dup_raw = math.log1p(float(dup_count))
    dup_term = dup_raw * float(w["duplicates_weight"])

    sources_count = max(1, int(cobj.get("sources_count") or 1))
    sources_raw = math.log1p(float(sources_count))
    sources_term = sources_raw * float(w["sources_weight"])

    confidence = float(cobj.get("cluster_confidence") or 0.0)
    if confidence < 0.0:
        confidence = 0.0
    if confidence > 1.0:
        confidence = 1.0
    confidence_term = confidence * float(w["confidence_weight"])

    snip_len = len((best.get("snippet_text") or "").strip())
    snip_raw = min(1.0, snip_len / 220.0)
    snip_term = snip_raw * float(w["snippet_weight"])

    has_cached = 1.0 if best.get("has_cached_summary") else 0.0
    cached_term = has_cached * float(w["cached_weight"])

    subdivision_context_norm = (subdivision_context or "").strip().lower()
    is_mercopress = (best.get("subdivision_key") or best.get("country_key") or "").strip().lower() == "mp"

    mp_term = 0.0
    if is_mercopress and subdivision_context_norm == "all":
        mp_term = -abs(float(w["mercopress_penalty_all"]))
    elif is_mercopress and subdivision_context_norm == "mp":
        mp_term = abs(float(w["mercopress_boost_mp"]))

    score = float(
        recency_term
        + dup_term
        + sources_term
        + confidence_term
        + snip_term
        + cached_term
        + mp_term
    )

    factors: Dict[str, Any] = {
        "age_hours": round(float(age_hours), 3),
        "recency_raw": round(float(recency_raw), 6),
        "recency_term": round(float(recency_term), 6),
        "duplicates_count": int(dup_count),
        "duplicates_raw": round(float(dup_raw), 6),
        "duplicates_term": round(float(dup_term), 6),
        "sources_count": int(sources_count),
        "sources_raw": round(float(sources_raw), 6),
        "sources_term": round(float(sources_term), 6),
        "cluster_confidence": round(float(confidence), 6),
        "confidence_term": round(float(confidence_term), 6),
        "snippet_len": int(snip_len),
        "snippet_raw": round(float(snip_raw), 6),
        "snippet_term": round(float(snip_term), 6),
        "has_cached_summary": bool(best.get("has_cached_summary")),
        "cached_term": round(float(cached_term), 6),
        "is_mercopress": bool(is_mercopress),
        "subdivision_context": subdivision_context_norm,
        "country_context": subdivision_context_norm,  # compatibility
        "mp_term": round(float(mp_term), 6),
        "weights": {
            "recency_weight": w["recency_weight"],
            "recency_tau_hours": w["recency_tau_hours"],
            "duplicates_weight": w["duplicates_weight"],
            "sources_weight": w["sources_weight"],
            "confidence_weight": w["confidence_weight"],
            "snippet_weight": w["snippet_weight"],
            "cached_weight": w["cached_weight"],
            "mercopress_penalty_all": w["mercopress_penalty_all"],
            "mercopress_boost_mp": w["mercopress_boost_mp"],
        },
    }

    return score, factors


# ----------------------------
# OpenAI client
# ----------------------------
def _get_openai_client():
    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not set in backend environment (.env).")

    try:
        from openai import OpenAI  # type: ignore
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OpenAI package not installed in backend venv: {e}")

    return OpenAI(api_key=api_key)


# ----------------------------
# API Models
# ----------------------------
class EnrichItem(BaseModel):
    title: str
    link: str
    source: str
    snippet: str = ""
    cluster_id: Optional[str] = None


class EnrichRequest(BaseModel):
    items: List[EnrichItem] = Field(default_factory=list)


# ----------------------------
# Routes
# ----------------------------
@app.get("/")
def read_root():
    return {"message": "News Aggregator API is running"}


@app.get("/healthz")
def healthz():
    try:
        with _db() as conn:
            conn.execute("SELECT 1").fetchone()
        db_ok = True
    except Exception:
        db_ok = False

    return {
        "ok": True,
        "service": "news-aggregator-backend",
        "utc": _now_utc_iso(),
        "db_ok": db_ok,
    }


@app.get("/regions")
def get_regions():
    regions = []
    for key, meta in REGIONS.items():
        source_count = sum(1 for s in SOURCES if (s.get("region_key") or "").lower() == key)
        subdivisions_meta = _region_subdivision_meta(key)
        regions.append(
            {
                "key": meta["key"],
                "name": meta["name"],
                "status": meta["status"],
                "subdivision_label": meta.get("subdivision_label") or "Subdivision",
                "default_subdivision": meta.get("default_subdivision") or meta.get("default_country"),
                "default_country": meta.get("default_country") or meta.get("default_subdivision"),  # compatibility
                "subdivisions_count": len(subdivisions_meta),
                "countries_count": len(subdivisions_meta),  # compatibility
                "source_count": source_count,
            }
        )
    return {"regions": regions}


@app.get("/subdivisions")
def get_subdivisions(region: str = DEFAULT_REGION_KEY):
    r = _normalize_region(region)
    meta = _region_subdivision_meta(r)

    counts: Dict[str, int] = {k: 0 for k in meta.keys()}
    for s in SOURCES:
        sk_region = (s.get("region_key") or "").lower()
        if sk_region != r:
            continue
        sk = (s.get("subdivision_key") or s.get("country_key") or "").lower()
        if sk in counts:
            counts[sk] += 1

    subdivisions = []
    for key, info in meta.items():
        subdivisions.append(
            {
                "key": key,
                "code": info["code"],
                "name": info["name"],
                "flag_url": info["flag_url"],
                "source_count": counts.get(key, 0),
            }
        )

    return {
        "region": r,
        "subdivision_label": _region_subdivision_label(r),
        "default_subdivision": _default_subdivision_for_region(r),
        "subdivisions": subdivisions,
    }


@app.get("/countries")
def get_countries(region: str = DEFAULT_REGION_KEY):
    # Backward-compatible endpoint backed by canonical subdivisions
    r = _normalize_region(region)
    meta = _region_subdivision_meta(r)

    counts: Dict[str, int] = {k: 0 for k in meta.keys()}
    for s in SOURCES:
        sk_region = (s.get("region_key") or "").lower()
        if sk_region != r:
            continue
        ck = (s.get("subdivision_key") or s.get("country_key") or "").lower()
        if ck in counts:
            counts[ck] += 1

    countries = []
    for key, info in meta.items():
        countries.append(
            {
                "key": key,
                "code": info["code"],
                "name": info["name"],
                "flag_url": info["flag_url"],
                "source_count": counts.get(key, 0),
            }
        )

    return {
        "region": r,
        "subdivision_label": _region_subdivision_label(r),
        "default_subdivision": _default_subdivision_for_region(r),
        "countries": countries,
    }


@app.get("/debug-sources")
def debug_sources(region: Optional[str] = None):
    normalized_region = None
    if region is not None and region.strip():
        normalized_region = _normalize_region(region)

    out = []
    for s in SOURCES:
        s_region = (s.get("region_key") or "").lower()
        if normalized_region and s_region != normalized_region:
            continue

        try:
            feed = _fetch_feed(s["feed_url"])
            entries_found = len(feed.entries or [])
            bozo = bool(getattr(feed, "bozo", False))
            bozo_exc = getattr(feed, "bozo_exception", None)
            out.append(
                {
                    "region_key": s.get("region_key"),
                    "source": s["name"],
                    "source_id": s.get("id"),
                    "feed": s["feed_url"],
                    "entries_found": entries_found,
                    "ok": True,
                    "error": str(bozo_exc) if bozo_exc else None,
                    "status": 200,
                    "bozo": bozo,
                    "subdivision_key": s.get("subdivision_key") or s.get("country_key"),
                    "country_key": s.get("country_key") or s.get("subdivision_key"),
                    "subdivision_code": s.get("subdivision_code") or s.get("country_code"),
                    "country_code": s.get("country_code") or s.get("subdivision_code"),
                }
            )
        except Exception as e:
            out.append(
                {
                    "region_key": s.get("region_key"),
                    "source": s["name"],
                    "source_id": s.get("id"),
                    "feed": s["feed_url"],
                    "entries_found": 0,
                    "ok": False,
                    "error": str(e),
                    "status": None,
                    "bozo": True,
                    "subdivision_key": s.get("subdivision_key") or s.get("country_key"),
                    "country_key": s.get("country_key") or s.get("subdivision_key"),
                    "subdivision_code": s.get("subdivision_code") or s.get("country_code"),
                    "country_code": s.get("country_code") or s.get("subdivision_code"),
                }
            )
    return out


@app.get("/uy-news")
def get_uruguay_news(range: str = "24h", q: str = "", limit: int = 50):
    return get_news(region="mercosur", subdivision="uy", range=range, q=q, limit=limit)


def _collect_items(region: str, subdivision: str, range: str, q: str, scan_cap: int = 999999) -> List[Dict[str, Any]]:
    from concurrent.futures import ThreadPoolExecutor, as_completed

    r = _require_live_region(region)
    s_key = _normalize_subdivision_for_region(r, subdivision)
    since = _range_to_since(range)

    # Filter sources first
    matched_sources = []
    for source in _sources_for_region(r):
        source_subdivision_key = (source.get("subdivision_key") or source.get("country_key") or "").lower()

        if r == "mercosur":
            if s_key == "all":
                if source_subdivision_key not in {"uy", "ar", "br", "py", "bo", "mp"}:
                    continue
            else:
                if source_subdivision_key != s_key:
                    continue
        elif r == "mexico":
            if s_key == "all":
                pass  # include all Mexico feeds regardless of subdivision
            else:
                if source_subdivision_key != s_key:
                    continue
        elif r == "central-america":
            if s_key == "all":
                pass  # include all Central America feeds regardless of subdivision
            else:
                if source_subdivision_key != s_key:
                    continue
        else:
            if source_subdivision_key != s_key:
                continue

        matched_sources.append(source)

    # Fetch all feeds concurrently (up to 10 at a time)
    def _fetch_source(source):
        try:
            feed = _fetch_feed(source["feed_url"])
            return (source, feed)
        except Exception:
            return (source, None)

    feed_results = []
    with ThreadPoolExecutor(max_workers=min(10, max(1, len(matched_sources)))) as pool:
        futures = {pool.submit(_fetch_source, s): s for s in matched_sources}
        for future in as_completed(futures):
            feed_results.append(future.result())

    # Process fetched feeds into articles
    items: List[Dict[str, Any]] = []
    for source, feed in feed_results:
        if feed is None:
            continue
        for entry in (feed.entries or []):
            article = _build_article(source, entry)
            if not article:
                continue

            pub_utc = article.get("published_utc")
            if pub_utc:
                try:
                    pub_dt = datetime.fromisoformat(pub_utc)
                    if pub_dt.tzinfo is None:
                        pub_dt = pub_dt.replace(tzinfo=timezone.utc)
                    if pub_dt < since:
                        continue
                except Exception:
                    pass

            if not _matches_q(article, q):
                continue

            items.append(article)
            if len(items) >= scan_cap:
                return items

    return items


def _hard_cap_limit(region_key: str, subdivision_key: str, lim: int) -> int:
    r = (region_key or "").strip().lower()
    s = (subdivision_key or "").strip().lower()
    if r == "mercosur" and s == "all":
        return max(1, min(lim, 200))
    return max(1, min(lim, 200))


@app.get("/news")
def get_news(
    region: str = DEFAULT_REGION_KEY,
    country: Optional[str] = None,
    subdivision: Optional[str] = None,
    range: str = "24h",
    q: str = "",
    limit: int = 50,
):
    r = _require_live_region(region)
    selected_subdivision = _normalize_subdivision_for_region(r, _resolve_subdivision_param(subdivision, country))

    try:
        lim = int(limit)
    except Exception:
        lim = 50

    lim = _hard_cap_limit(r, selected_subdivision, lim)

    cache_key = f"region={r}|subdivision={selected_subdivision}|range={range}|q={q}|limit={lim}"
    cached = _news_cache_get(cache_key)
    if cached:
        payload, age_s = cached
        payload["cache_hit"] = True
        payload["cache_age_s"] = age_s
        payload["cache_ttl_s"] = _news_ttl_s()
        return payload

    scan_cap = min(2000, max(200, lim * 10))
    items = _collect_items(region=r, subdivision=selected_subdivision, range=range, q=q, scan_cap=scan_cap)
    items = _dedupe(items)

    for a in items:
        a["cluster_id"] = _sig(a)
        a["topic"] = _topic_label(a)
        score, factors = _rank_score_and_factors(a)
        a["rank_score"] = score
        a["rank_factors"] = factors

    items.sort(
        key=lambda a: (float(a.get("rank_score") or 0.0), a.get("published_utc") or ""),
        reverse=True,
    )

    items = items[:lim]
    resp = {
        "region": r,
        "subdivision_label": _region_subdivision_label(r),
        "subdivision": selected_subdivision,
        "country": selected_subdivision,  # compatibility
        "range": range,
        "q": q,
        "limit": lim,
        "count": len(items),
        "articles": items,
    }
    _news_cache_set(cache_key, resp)

    resp["cache_hit"] = False
    resp["cache_age_s"] = 0
    resp["cache_ttl_s"] = _news_ttl_s()
    return resp


@app.get("/clusters")
def get_clusters(
    region: str = DEFAULT_REGION_KEY,
    country: Optional[str] = None,
    subdivision: Optional[str] = None,
    range: str = "24h",
    q: str = "",
    limit: int = 50,
):
    r = _require_live_region(region)
    selected_subdivision = _normalize_subdivision_for_region(r, _resolve_subdivision_param(subdivision, country))

    try:
        lim = int(limit)
    except Exception:
        lim = 50

    lim = _hard_cap_limit(r, selected_subdivision, lim)

    scan_cap = min(3000, max(300, lim * 12))
    raw = _collect_items(region=r, subdivision=selected_subdivision, range=range, q=q, scan_cap=scan_cap)

    for it in raw:
        it["topic"] = _topic_label(it)
        score, factors = _rank_score_and_factors(it)
        it["rank_score"] = score
        it["rank_factors"] = factors

    clusters = _cluster_items_v2(raw)

    for cobj in clusters:
        cid = (cobj.get("cluster_id") or "").strip()
        best = cobj.get("best_item")
        if not isinstance(best, dict):
            continue

        cached_cluster = _get_fresh_cluster_enrich(cid)
        if cached_cluster:
            best["title_en"] = cached_cluster.get("title_en") or ""
            best["summary_en"] = cached_cluster.get("summary_en") or ""
            best["has_cached_summary"] = True

        cscore, cfactors = _cluster_rank_score_and_factors(cobj, subdivision_context=selected_subdivision)
        cobj["cluster_rank_score"] = cscore
        cobj["cluster_rank_factors"] = cfactors
        best["cluster_rank_score"] = cscore

        cobj["best_item"] = _strip_internal_fields(best)

    clusters.sort(
        key=lambda cobj: (
            float(cobj.get("cluster_rank_score") or 0.0),
            ((cobj.get("best_item") or {}).get("published_utc") or ""),
        ),
        reverse=True,
    )

    clusters = clusters[:lim]
    payload = {
        "region": r,
        "subdivision_label": _region_subdivision_label(r),
        "subdivision": selected_subdivision,
        "country": selected_subdivision,  # compatibility
        "range": range,
        "q": q,
        "limit": lim,
        "count": len(clusters),
        "clusters": clusters,
    }
    payload = _strip_internal_fields(payload)
    return payload


@app.get("/top")
def get_top(
    region: str = DEFAULT_REGION_KEY,
    country: Optional[str] = None,
    subdivision: Optional[str] = None,
    range: str = "24h",
    q: str = "",
    limit: int = 30,
):
    r = _require_live_region(region)
    selected_subdivision = _normalize_subdivision_for_region(r, _resolve_subdivision_param(subdivision, country))

    try:
        lim = int(limit)
    except Exception:
        lim = 30

    lim = _hard_cap_limit(r, selected_subdivision, lim)

    cache_key = _top_cache_key(r, selected_subdivision, range, q, lim)
    cached = _top_cache_get(cache_key)
    if cached:
        payload, age_s = cached

        _inject_cluster_cache_into_payload(payload)

        payload["cache_hit"] = True
        payload["cache_age_s"] = age_s
        payload["cache_ttl_s"] = _top_ttl_s()

        payload = _strip_internal_fields(payload)
        return payload

    scan_cap = min(3000, max(300, lim * 14))
    raw = _collect_items(region=r, subdivision=selected_subdivision, range=range, q=q, scan_cap=scan_cap)

    for it in raw:
        it["topic"] = _topic_label(it)
        score, factors = _rank_score_and_factors(it)
        it["rank_score"] = score
        it["rank_factors"] = factors

    clusters = _cluster_items_v2(raw)

    for cobj in clusters:
        cid = (cobj.get("cluster_id") or "").strip()
        best = cobj.get("best_item")
        if not isinstance(best, dict):
            continue

        cached_cluster = _get_fresh_cluster_enrich(cid)
        if cached_cluster:
            best["title_en"] = cached_cluster.get("title_en") or ""
            best["summary_en"] = cached_cluster.get("summary_en") or ""
            best["has_cached_summary"] = True

        cscore, cfactors = _cluster_rank_score_and_factors(cobj, subdivision_context=selected_subdivision)
        cobj["cluster_rank_score"] = cscore
        cobj["cluster_rank_factors"] = cfactors
        best["cluster_rank_score"] = cscore

        cobj["best_item"] = _strip_internal_fields(best)

    clusters.sort(
        key=lambda cobj: (
            float(cobj.get("cluster_rank_score") or 0.0),
            ((cobj.get("best_item") or {}).get("published_utc") or ""),
        ),
        reverse=True,
    )

    clusters = clusters[:lim]
    payload = {
        "region": r,
        "subdivision_label": _region_subdivision_label(r),
        "subdivision": selected_subdivision,
        "country": selected_subdivision,  # compatibility
        "range": range,
        "q": q,
        "limit": lim,
        "count": len(clusters),
        "clusters": clusters,
    }

    _top_cache_set(cache_key, payload)

    payload["cache_hit"] = False
    payload["cache_age_s"] = 0
    payload["cache_ttl_s"] = _top_ttl_s()

    payload = _strip_internal_fields(payload)
    return payload


@app.post("/enrich")
def enrich_items(req: EnrichRequest, request: Request):
    _rate_limit_check(request)

    if not req.items:
        return {"items": []}

    cached_out = []
    to_do: List[EnrichItem] = []

    for it in req.items:
        link = (it.link or "").strip()
        cid = (it.cluster_id or "").strip()

        if cid:
            cc = _get_fresh_cluster_enrich(cid)
            if cc:
                title_en = cc.get("title_en") or ""
                summary_en = cc.get("summary_en") or ""

                if link and title_en and summary_en:
                    try:
                        _set_cached_enrich(link, title_en, summary_en)
                    except Exception:
                        pass

                cached_out.append(
                    {
                        "link": link,
                        "title_en": title_en,
                        "summary_en": summary_en,
                        "cached": True,
                    }
                )
                continue

        if link:
            cached = _get_cached_enrich(link)
            if cached and cached.get("summary_en"):
                cached_out.append(
                    {
                        "link": link,
                        "title_en": cached.get("title_en") or "",
                        "summary_en": cached.get("summary_en") or "",
                        "cached": True,
                    }
                )
                continue

        to_do.append(it)

    if not to_do:
        return {"items": cached_out}

    client = _get_openai_client()
    model = (os.getenv("OPENAI_MODEL") or "gpt-4o-mini").strip()

    payload = []
    for it in to_do:
        payload.append(
            {
                "link": (it.link or "").strip(),
                "source": (it.source or "").strip(),
                "title": (it.title or "").strip(),
                "snippet": _clean_text_any((it.snippet or "").strip(), max_chars=700),
                "cluster_id": (it.cluster_id or "").strip(),
            }
        )

    system = (
        "You translate Spanish/Portuguese news headlines into English and write a short English summary.\n"
        "Return STRICT JSON only.\n"
        "Output shape:\n"
        '{ "items": [ {"link": "...", "title_en": "...", "summary_en": "..."}, ... ] }\n'
        "Rules:\n"
        "- title_en: natural English headline.\n"
        "- summary_en: 1–2 sentences, neutral, based ONLY on provided title + snippet.\n"
        "- If snippet is empty/uninformative: say so briefly.\n"
        "- No HTML, no markdown, no backticks.\n"
    )

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps({"items": payload})},
            ],
            response_format={"type": "json_object"},
        )
        content = (resp.choices[0].message.content or "").strip()
        data = json.loads(content)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Enrichment failed: {e}")

    link_to_cid: Dict[str, str] = {}
    for it in req.items:
        lnk = (it.link or "").strip()
        cid = (it.cluster_id or "").strip()
        if lnk and cid and lnk not in link_to_cid:
            link_to_cid[lnk] = cid

    out_items = []
    for obj in (data.get("items") or []):
        link = (obj.get("link") or "").strip()
        title_en = (obj.get("title_en") or "").strip()
        summary_en = (obj.get("summary_en") or "").strip()
        if not link:
            continue

        if title_en and summary_en:
            _set_cached_enrich(link, title_en, summary_en)

            cid = link_to_cid.get(link) or ""
            if cid:
                try:
                    _set_cached_cluster_enrich(cid, title_en, summary_en)
                except Exception:
                    pass

        out_items.append({"link": link, "title_en": title_en, "summary_en": summary_en, "cached": False})

    return {"items": cached_out + out_items}


# ----------------------------
# Background Pre-Enrichment Worker
# ----------------------------
_worker_lock = threading.Lock()
_worker_running = False
_worker_last_run_utc: Optional[str] = None
_worker_last_ok_utc: Optional[str] = None
_worker_last_error: Optional[str] = None
_worker_last_stats: Optional[Dict[str, Any]] = None
_worker_thread: Optional[threading.Thread] = None


def _env_list(key: str, default_csv: str) -> List[str]:
    v = (os.getenv(key) or "").strip()
    if not v:
        v = default_csv
    parts = [p.strip().lower() for p in v.split(",") if p.strip()]
    return parts


def _enrich_internal_clusters(items: List[Dict[str, str]]) -> int:
    if not items:
        return 0

    todo = []
    for it in items:
        cid = (it.get("cluster_id") or "").strip()
        link = (it.get("link") or "").strip()

        if cid:
            cc = _get_fresh_cluster_enrich(cid)
            if cc:
                try:
                    if link and cc.get("title_en") and cc.get("summary_en"):
                        _set_cached_enrich(link, cc.get("title_en") or "", cc.get("summary_en") or "")
                except Exception:
                    pass
                continue

        if link:
            cached = _get_cached_enrich(link)
            if cached and cached.get("summary_en"):
                continue

        todo.append(it)

    if not todo:
        return 0

    client = _get_openai_client()
    model = (os.getenv("OPENAI_MODEL") or "gpt-4o-mini").strip()

    system = (
        "You translate Spanish/Portuguese news headlines into English and write a short English summary.\n"
        "Return STRICT JSON only.\n"
        "Output shape:\n"
        '{ "items": [ {"link": "...", "title_en": "...", "summary_en": "..."}, ... ] }\n'
        "Rules:\n"
        "- title_en: natural English headline.\n"
        "- summary_en: 1–2 sentences, neutral, based ONLY on provided title + snippet.\n"
        "- If snippet is empty/uninformative: say so briefly.\n"
        "- No HTML, no markdown, no backticks.\n"
    )

    payload = []
    link_to_cid: Dict[str, str] = {}
    for it in todo:
        link = (it.get("link") or "").strip()
        cid = (it.get("cluster_id") or "").strip()
        if link and cid and link not in link_to_cid:
            link_to_cid[link] = cid

        payload.append(
            {
                "link": link,
                "source": (it.get("source") or "").strip(),
                "title": (it.get("title") or "").strip(),
                "snippet": _clean_text_any((it.get("snippet") or "").strip(), max_chars=700),
                "cluster_id": cid,
            }
        )

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps({"items": payload})},
            ],
            response_format={"type": "json_object"},
        )
        content = (resp.choices[0].message.content or "").strip()
        data = json.loads(content)
    except Exception:
        return 0

    enriched = 0
    for obj in (data.get("items") or []):
        link = (obj.get("link") or "").strip()
        title_en = (obj.get("title_en") or "").strip()
        summary_en = (obj.get("summary_en") or "").strip()
        if not link or not title_en or not summary_en:
            continue

        try:
            _set_cached_enrich(link, title_en, summary_en)
        except Exception:
            pass

        cid = link_to_cid.get(link) or ""
        if cid:
            try:
                _set_cached_cluster_enrich(cid, title_en, summary_en)
            except Exception:
                pass

        enriched += 1

    return enriched


def _worker_loop() -> None:
    global _worker_running, _worker_last_run_utc, _worker_last_ok_utc, _worker_last_error, _worker_last_stats

    enabled = _env_bool("PRE_ENRICH_ENABLED", default=False)
    interval_s = _env_int("PRE_ENRICH_INTERVAL_S", _env_int("PRE_ENRICH_INTERVAL_SECONDS", 180))
    startup_delay_s = _env_int("PRE_ENRICH_STARTUP_DELAY_S", _env_int("PRE_ENRICH_STARTUP_DELAY_SECONDS", 3))

    regions = _env_list("PRE_ENRICH_REGIONS", DEFAULT_REGION_KEY)
    if not regions:
        regions = [DEFAULT_REGION_KEY]

    ranges = _env_list("PRE_ENRICH_RANGES", "24h")
    if not ranges:
        ranges = ["24h"]

    subdivisions = _env_list("PRE_ENRICH_SUBDIVISIONS", "")
    if not subdivisions:
        subdivisions = _env_list("PRE_ENRICH_COUNTRIES", "uy,ar,br,py,bo,mp,all,cdmx,jalisco,nuevo-leon,edomex,yucatan,gt,cr,sv,hn,ni,pa,bz")
    if not subdivisions:
        subdivisions = ["uy", "ar", "br", "py", "bo", "mp", "all", "cdmx"]

    scan_limit = _env_int("PRE_ENRICH_SCAN_LIMIT", _env_int("PRE_ENRICH_MAX_ITEMS_PER_RUN", 60))
    max_new_per_bucket = _env_int("PRE_ENRICH_MAX_NEW_PER_BUCKET", 15)
    max_new_total = _env_int("PRE_ENRICH_MAX_NEW_TOTAL", _env_int("PRE_ENRICH_MAX_ITEMS_PER_RUN", 40))
    batch_size = _env_int("PRE_ENRICH_BATCH_SIZE", 10)

    if startup_delay_s > 0:
        time.sleep(startup_delay_s)

    while True:
        enabled = _env_bool("PRE_ENRICH_ENABLED", default=False)
        interval_s = _env_int("PRE_ENRICH_INTERVAL_S", _env_int("PRE_ENRICH_INTERVAL_SECONDS", interval_s))

        if not enabled:
            time.sleep(max(3, interval_s))
            continue

        with _worker_lock:
            _worker_running = True
            _worker_last_run_utc = _now_utc_iso()
            _worker_last_error = None

        stats: Dict[str, Any] = {
            "enabled": enabled,
            "interval_s": interval_s,
            "startup_delay_s": startup_delay_s,
            "regions": regions,
            "ranges": ranges,
            "subdivisions": subdivisions,
            "countries": subdivisions,  # compatibility
            "scan_limit": scan_limit,
            "max_new_per_bucket": max_new_per_bucket,
            "max_new_total": max_new_total,
            "batch_size": batch_size,
            "enriched_count": 0,
            "buckets": {},
            "mode": "cluster_v2_region_aware_subdivision",
        }

        try:
            total_enriched = 0
            total_queued = 0

            for region_key_raw in regions:
                try:
                    region_key = _normalize_region(region_key_raw)
                except Exception:
                    continue

                if region_key not in LIVE_REGION_KEYS:
                    continue

                region_subdivisions = subdivisions
                if region_key != "mercosur":
                    region_subdivisions = [k for k in subdivisions if k in _valid_subdivision_keys_for_region(region_key)]

                for subdivision_key in region_subdivisions:
                    if subdivision_key not in _valid_subdivision_keys_for_region(region_key):
                        continue

                    for r in ranges:
                        bucket_key = f"{region_key}:{subdivision_key}:{r}"
                        bucket_scanned = 0
                        bucket_cached = 0
                        bucket_queued = 0
                        bucket_enriched = 0

                        effective_scan_limit = int(scan_limit)
                        if region_key == "mercosur" and (subdivision_key or "").lower() == "all":
                            effective_scan_limit = min(effective_scan_limit, 60)

                        scan_cap = max(150, int(effective_scan_limit) * 10)
                        items = _collect_items(region=region_key, subdivision=subdivision_key, range=r, q="", scan_cap=scan_cap)
                        items = _dedupe(items)

                        for a in items:
                            a["topic"] = _topic_label(a)
                            score, _factors = _rank_score_and_factors(a)
                            a["rank_score"] = score

                        items.sort(
                            key=lambda a: (float(a.get("rank_score") or 0.0), a.get("published_utc") or ""),
                            reverse=True,
                        )

                        clusters = _cluster_items_v2(items[: max(80, effective_scan_limit * 4)])
                        for cobj in clusters:
                            cscore, cfactors = _cluster_rank_score_and_factors(cobj, subdivision_context=subdivision_key)
                            cobj["cluster_rank_score"] = cscore
                            cobj["cluster_rank_factors"] = cfactors

                        clusters.sort(
                            key=lambda cobj: (
                                float(cobj.get("cluster_rank_score") or 0.0),
                                ((cobj.get("best_item") or {}).get("published_utc") or ""),
                            ),
                            reverse=True,
                        )
                        top_clusters = clusters[: int(effective_scan_limit)]
                        bucket_scanned = len(top_clusters)

                        candidates: List[Dict[str, str]] = []
                        for cobj in top_clusters:
                            cid = (cobj.get("cluster_id") or "").strip()
                            best = cobj.get("best_item") or {}
                            link = (best.get("link") or "").strip()

                            if cid and _get_fresh_cluster_enrich(cid):
                                bucket_cached += 1
                                continue

                            if best.get("title_en") and best.get("summary_en"):
                                bucket_cached += 1
                                continue

                            candidates.append(
                                {
                                    "cluster_id": cid,
                                    "title": best.get("title") or "",
                                    "link": link,
                                    "source": best.get("source") or "",
                                    "snippet": best.get("snippet_text") or "",
                                }
                            )

                        if candidates:
                            remaining = max(0, max_new_total - total_queued)
                            take = min(max_new_per_bucket, remaining)
                            candidates = candidates[:take]
                        else:
                            candidates = []

                        bucket_queued = len(candidates)
                        total_queued += bucket_queued

                        if candidates:
                            for i in range(0, len(candidates), max(1, batch_size)):
                                chunk = candidates[i: i + max(1, batch_size)]
                                ecount = _enrich_internal_clusters(chunk)
                                bucket_enriched += ecount
                                total_enriched += ecount
                                if total_queued >= max_new_total:
                                    break

                        stats["buckets"][bucket_key] = {
                            "scanned": bucket_scanned,
                            "already_cached": bucket_cached,
                            "queued": bucket_queued,
                            "enriched": bucket_enriched,
                        }
                        stats["enriched_count"] = total_enriched

                        if total_queued >= max_new_total:
                            break
                    if total_queued >= max_new_total:
                        break
                if total_queued >= max_new_total:
                    break

            with _worker_lock:
                _worker_last_ok_utc = _now_utc_iso()
                _worker_last_stats = stats

        except Exception as e:
            with _worker_lock:
                _worker_last_error = str(e)
                _worker_last_stats = stats

        finally:
            with _worker_lock:
                _worker_running = False

        time.sleep(max(3, interval_s))


@app.get("/worker-status")
def worker_status():
    global _worker_thread
    with _worker_lock:
        return {
            "enabled": _env_bool("PRE_ENRICH_ENABLED", default=False),
            "running": _worker_running,
            "thread_alive": bool(_worker_thread and _worker_thread.is_alive()),
            "last_run_utc": _worker_last_run_utc,
            "last_ok_utc": _worker_last_ok_utc,
            "last_error": _worker_last_error,
            "last_stats": _worker_last_stats,
        }


@app.on_event("startup")
def _start_worker():
    global _worker_thread
    if _worker_thread and _worker_thread.is_alive():
        return
    t = threading.Thread(target=_worker_loop, daemon=True, name="pre_enrich_worker")
    _worker_thread = t
    t.start()