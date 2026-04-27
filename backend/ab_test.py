# A/B test: Venice vs OpenAI for translation quality comparison
import os
import sys
import json
from openai import OpenAI

# Test headlines
TEST_CASES = [
    {
        "lang": "es",
        "title": "El gobierno aprueba nueva ley de energía renovable",
        "snippet": "El Congreso aprobó ayer una ley histórica para impulsar la transición energética del país hacia fuentes limpias.",
        "expected_category": "Energy",
    },
    {
        "lang": "pt",
        "title": "Brasil e União Europeia fecham acordo comercial inédito",
        "snippet": "O presidente anunciou nesta quarta-feira um tratado de livre comércio que beneficiará setores agrícolas e industriais.",
        "expected_category": "Economy",
    },
    {
        "lang": "el",
        "title": "Η ελληνική κυβέρνηση ανακοινώνει νέα μέτρα λιτότητας",
        "snippet": "Το υπουργικό συμβούλιο ενέκρινε σειρά αποφάσεων για τη μείωση του δημοσιονομικού ελλείμματος κατά 3%.",
        "expected_category": "Economy",
    },
    {
        "lang": "fr",
        "title": "La France renforce ses frontières suite à l'attentat de Marseille",
        "snippet": "Le président a annoncé un renforcement des contrôles aux frontières et une augmentation des effectifs de police.",
        "expected_category": "Security",
    },
]

SYSTEM_PROMPT = (
    "You are a news assistant. Translate the title into English, write a short English summary, "
    "and classify the article into exactly one category.\n"
    "Rules:\n"
    "- Use ONLY the provided TITLE and SNIPPET.\n"
    "- Do NOT invent facts.\n"
    "- Keep the summary 1–2 sentences.\n"
    "- category must be exactly one of: Politics, Economy, Business, Markets, World, Society, Education, Health, Science, Technology, Energy, Environment, Security, Culture, Sports\n"
    "- Choose the category based on the actual content, NOT the source's own category label.\n"
    "- Return strict JSON: {\"title_en\": \"...\", \"summary_en\": \"...\", \"category\": \"...\"}\n"
)

def call(client, model, title, snippet, lang_hint=""):
    text = f"TITLE:\n{title}\n\nSNIPPET:\n{snippet or ''}".strip()
    sys_msg = SYSTEM_PROMPT
    if lang_hint:
        sys_msg += f"\nLanguage hint: {lang_hint}\n"

    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": sys_msg},
            {"role": "user", "content": text},
        ],
        temperature=0.2,
    )

    content = resp.choices[0].message.content or ""
    content = content.strip()
    if content.startswith("```"):
        import re
        content = re.sub(r"^```(?:\w+)?\n?", "", content)
        content = re.sub(r"\n?```$", "", content)
        content = content.strip()

    try:
        data = json.loads(content)
        return {
            "title_en": data.get("title_en", "").strip(),
            "summary_en": data.get("summary_en", "").strip(),
            "category": data.get("category", "").strip(),
            "raw": content,
        }
    except Exception as e:
        return {"error": str(e), "raw": content[:200]}


def main():
    # OpenAI client
    openai_key = os.environ.get("GRAEME_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    openai_client = OpenAI(api_key=openai_key) if openai_key else None

    # Venice client
    venice_key = os.environ.get("VENICE_API_KEY")
    venice_client = OpenAI(base_url="https://api.venice.ai/api/v1", api_key=venice_key) if venice_key else None

    for tc in TEST_CASES:
        lang = tc["lang"]
        title = tc["title"]
        snippet = tc["snippet"]
        expected = tc["expected_category"]

        lang_hint = lang
        if lang == "es":
            venice_model = "mistral-small-3-2-24b-instruct"
        elif lang == "pt":
            venice_model = "mistral-small-3-2-24b-instruct"
        elif lang == "fr":
            venice_model = "mistral-small-3-2-24b-instruct"
        elif lang == "el":
            venice_model = "deepseek-v4-flash"
        else:
            venice_model = "deepseek-v4-flash"

        print(f"\n{'='*60}")
        print(f"Test: {lang} → {venice_model}")
        print(f"Original: {title[:70]}")

        # OpenAI
        if openai_client:
            openai_result = call(openai_client, "gpt-4o-mini", title, snippet, lang_hint)
            print(f"\n[OpenAI gpt-4o-mini]")
            print(f"  Title: {openai_result.get('title_en', 'ERROR')}")
            print(f"  Category: {openai_result.get('category', 'ERROR')}")

        # Venice
        if venice_client:
            venice_result = call(venice_client, venice_model, title, snippet, lang_hint)
            print(f"\n[Venice {venice_model}]")
            print(f"  Title: {venice_result.get('title_en', 'ERROR')}")
            print(f"  Category: {venice_result.get('category', 'ERROR')}")

        # Quality score
        if 'error' not in venice_result and 'error' not in (openai_result or {}):
            match = venice_result.get('category', '') == openai_result.get('category', '')
            print(f"\n  Category match: {match}")

if __name__ == "__main__":
    main()