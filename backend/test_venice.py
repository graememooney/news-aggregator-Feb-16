# Quick integration test for Venice API via backend client
import os
import sys

# Ensure backend is on path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Set env explicitly from our confirmed working key
os.environ["VENICE_API_KEY"] = "VENICE_INFERENCE_KEY_h160hgD4D4OszBrzGLKV_UDM5ysglO467BhcSCO0-T"
os.environ["USE_VENICE"] = "true"
os.environ["VENICE_BASE_URL"] = "https://api.venice.ai/api/v1"

from ai import translate_and_summarize

print("Testing Spanish → Mistral...")
title, summary, category = translate_and_summarize(
    title="El gobierno aprueba nueva ley de energía renovable",
    snippet="El Congreso aprobó ayer una ley histórica para impulsar la transición energética del país hacia fuentes limpias.",
    source_lang_hint="es",
)
print(f"Title: {title}")
print(f"Summary: {summary}")
print(f"Category: {category}")
print()

print("Testing Greek → DeepSeek...")
title2, summary2, category2 = translate_and_summarize(
    title="Η κυβέρνηση εγκρίνει νέο νόμο για τις ανανεώσιμες πηγές ενέργειας",
    snippet="Η Βουλή ενέκρινε χθες έναν ιστορικό νόμο για την προώθηση της ενεργειακής μετάβασης της χώρας σε καθαρές πηγές.",
    source_lang_hint="el",
)
print(f"Title: {title2}")
print(f"Summary: {summary2}")
print(f"Category: {category2}")