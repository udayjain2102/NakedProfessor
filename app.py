from __future__ import annotations

import hashlib
import io
import json
import os
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from xml.etree import ElementTree

import streamlit as st
from diskcache import Cache

from rmp_scraper.professor_profiles import (
    ParameterInsight,
    ProfessorProfile,
    ProfessorSnapshot,
    derive_parameter_profile,
    profile_as_dict,
)
from rmp_scraper.data_store import (
    DEFAULT_ARTIFACT_PATH,
    DEFAULT_DB_PATH,
    ensure_database,
    get_professors_for_school,
    search_schools as db_search_schools,
)
from rmp_scraper.syllabus_parser import parse_syllabus, snapshot_as_json

MODEL_OPTIONS: List[tuple[str, str]] = [
    ("gpt-4.1-mini", "Balanced cost vs. quality"),
    ("gpt-4.1", "Highest quality"),
    ("gpt-4o-mini", "Fast + inexpensive"),
]
MODEL_LABELS = {name: f"{name} – {desc}" for name, desc in MODEL_OPTIONS}
EXPORTS_DIR = Path("exports")
CACHE_DIR = Path("cache_store")
CACHE = Cache(str(CACHE_DIR))
CONVO_DIR = EXPORTS_DIR / "conversations"
DEFAULT_MODEL = "gpt-4.1-mini"
PARAMETER_FIELD_CONFIG = [
    (
        "instruction_clarity",
        "Instruction clarity",
        ["How clear are lectures, explanations, and assignment directions?"],
    ),
    (
        "workload_intensity",
        "Workload intensity",
        ["How heavy is the weekly workload, reading, and deadline pressure?"],
    ),
    (
        "support_accessibility",
        "Support accessibility",
        ["How available or helpful is the professor when students need support?"],
    ),
    (
        "assessment_strictness",
        "Assessment strictness",
        ["How tough or unpredictable are tests, quizzes, and grading?"],
    ),
    (
        "student_sentiment",
        "Student sentiment",
        ["What is the overall student vibe toward this professor/course?"],
    ),
]


def _format_param_name(name: str) -> str:
    return name.replace("_", " ").title()


def _render_profile(profile: ProfessorProfile) -> None:
    st.subheader("Professor Parameters")
    param_items = list(profile.parameters.items())
    cols = st.columns(len(param_items))
    for col, (name, insight) in zip(cols, param_items):
        col.markdown(f"**{_format_param_name(name)}**")
        col.markdown(f"*Level:* `{insight.level}`")
        col.markdown(f"*Summary:* {insight.summary}")
        if insight.signals:
            col.caption(" • ".join(insight.signals))

    st.subheader("Risk Signals")
    for tension in profile.tensions:
        st.write(f"- {tension}")


def _render_search_shell(title: str, subtitle: str) -> None:
    st.markdown(
        f"""
        <div style="
            border:1px solid rgba(255,255,255,0.08);
            background:linear-gradient(180deg, rgba(20,24,33,0.98), rgba(14,18,28,0.96));
            border-radius:24px;
            padding:16px 18px;
            box-shadow:0 18px 40px rgba(0,0,0,0.28);
            margin:6px 0 14px 0;
        ">
            <div style="font-size:1.1rem;font-weight:700;color:#f7f8fb;">{title}</div>
            <div style="font-size:0.92rem;color:#9aa4b2;margin-top:4px;">{subtitle}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def _extract_docx_text(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            xml_bytes = archive.read("word/document.xml")
    except Exception:
        return ""

    try:
        root = ElementTree.fromstring(xml_bytes)
    except ElementTree.ParseError:
        return ""

    paragraphs: List[str] = []
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    for paragraph in root.findall(".//w:p", namespace):
        runs = [node.text or "" for node in paragraph.findall(".//w:t", namespace)]
        text = "".join(runs).strip()
        if text:
            paragraphs.append(text)
    return "\n".join(paragraphs)


def _extract_pdf_text(data: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        return ""
    try:
        reader = PdfReader(io.BytesIO(data))
        return "\n".join((page.extract_text() or "").strip() for page in reader.pages).strip()
    except Exception:
        return ""


def _read_uploaded_file(uploaded_file) -> Tuple[str, Optional[str]]:
    suffix = Path(uploaded_file.name).suffix.lower()
    data = uploaded_file.getvalue()

    if suffix in {".txt", ".md", ".csv", ".json", ".rtf"}:
        return data.decode("utf-8", errors="ignore").strip(), None
    if suffix == ".docx":
        text = _extract_docx_text(data)
        if text:
            return text, None
        return "", f"{uploaded_file.name}: couldn't extract text from this DOCX file."
    if suffix == ".pdf":
        text = _extract_pdf_text(data)
        if text:
            return text, None
        return "", f"{uploaded_file.name}: PDF text extraction isn't available in this environment yet."
    return "", f"{uploaded_file.name}: unsupported file type."


def _collect_uploaded_materials(uploaded_files) -> Tuple[str, List[str], List[str]]:
    chunks: List[str] = []
    filenames: List[str] = []
    warnings: List[str] = []

    for uploaded_file in uploaded_files or []:
        text, warning = _read_uploaded_file(uploaded_file)
        filenames.append(uploaded_file.name)
        if text:
            chunks.append(f"[Source: {uploaded_file.name}]\n{text}")
        if warning:
            warnings.append(warning)

    return "\n\n".join(chunks).strip(), filenames, warnings


def _merge_course_materials(*parts: str) -> str:
    return "\n\n".join(part.strip() for part in parts if part and part.strip()).strip()


def _suggest_professors(professors, query: str, limit: int = 12):
    trimmed = query.strip().lower()
    scored = []
    for professor in professors:
        name = professor.full_name.strip()
        department = professor.department or ""
        haystack = f"{name} {department}".lower()
        if not trimmed:
            score = 0
        elif haystack.startswith(trimmed):
            score = 3
        elif name.lower().startswith(trimmed):
            score = 2
        elif trimmed in haystack:
            score = 1
        else:
            continue
        scored.append((score, name.lower(), department.lower(), professor))
    scored.sort(key=lambda item: (-item[0], item[1], item[2]))
    return [item[-1] for item in scored[:limit]]


def _render_school_suggestions(matches: List[str], selected_school: Optional[str]) -> Optional[str]:
    for school in matches:
        label = school if school != selected_school else f"{school}  Selected"
        if st.button(label, key=f"school-suggestion-{school}", use_container_width=True):
            st.session_state["selected_school"] = school
            st.session_state["professor_school"] = school
            st.session_state["professor_query"] = ""
            st.session_state["selected_professor_label"] = None
            st.rerun()
    return st.session_state.get("selected_school")


def _render_professor_suggestions(professors, selected_label: Optional[str]) -> Optional[str]:
    for professor in professors:
        label = f"{professor.full_name} ({professor.department or 'General'})"
        button_label = label if label != selected_label else f"{label}  Selected"
        if st.button(button_label, key=f"professor-suggestion-{professor.professor_id}", use_container_width=True):
            st.session_state["selected_professor_label"] = label
            st.session_state["selected_professor_id"] = professor.professor_id
            st.rerun()
    return st.session_state.get("selected_professor_label")


def _build_manual_profile(
    school_name: str,
    professor_name: str,
    parameter_levels: Dict[str, str],
) -> ProfessorProfile:
    parts = professor_name.strip().split(None, 1)
    first = parts[0] if parts else "Manual"
    last = parts[1] if len(parts) > 1 else "Professor"
    snapshot = ProfessorSnapshot(
        school_rank=None,
        school_name=school_name or "Unknown School",
        school_id="manual-school",
        school_state=None,
        professor_id=f"manual::{school_name}::{professor_name}".strip(),
        professor_legacy_id=None,
        professor_first=first,
        professor_last=last,
        department="User-entered",
        avg_rating=None,
        avg_difficulty=None,
        would_take_again_percent=None,
        num_ratings=None,
        profile_url="",
    )
    parameters = {
        key: ParameterInsight(
            level=parameter_levels[key],
            summary=f"User-entered estimate: {parameter_levels[key]}.",
            signals=signals,
        )
        for key, _, signals in PARAMETER_FIELD_CONFIG
    }
    tensions = []
    if parameter_levels["instruction_clarity"] == "low":
        tensions.append("You marked instruction clarity as low, so plan to self-clarify lectures and prompts.")
    if parameter_levels["workload_intensity"] == "high":
        tensions.append("You marked workload as high, so protect time each week for assignments and catch-up.")
    if parameter_levels["support_accessibility"] == "low":
        tensions.append("You marked support accessibility as low, so rely on peers, office hours, and early outreach.")
    if parameter_levels["assessment_strictness"] in {"high", "unpredictable"}:
        tensions.append("You expect strict or unpredictable assessments, so build extra review and practice checkpoints.")
    if parameter_levels["student_sentiment"] == "low":
        tensions.append("Overall student sentiment looks low, so stay organized and use the syllabus as your anchor.")
    if not tensions:
        tensions.append("These professor settings were entered manually, so adjust them as you learn more.")
    return ProfessorProfile(snapshot=snapshot, parameters=parameters, reliability="unknown", tensions=tensions)


def _build_generic_profile(school_name: str, professor_name: str) -> ProfessorProfile:
    parts = professor_name.strip().split(None, 1)
    first = parts[0] if parts else "Unknown"
    last = parts[1] if len(parts) > 1 else "Professor"
    snapshot = ProfessorSnapshot(
        school_rank=None,
        school_name=school_name or "Unknown School",
        school_id="generic-school",
        school_state=None,
        professor_id=f"generic::{school_name}::{professor_name}".strip(),
        professor_legacy_id=None,
        professor_first=first,
        professor_last=last,
        department="Unknown",
        avg_rating=None,
        avg_difficulty=None,
        would_take_again_percent=None,
        num_ratings=None,
        profile_url="",
    )
    parameters = {
        key: ParameterInsight(
            level="unknown",
            summary="No database profile available.",
            signals=signals,
        )
        for key, _, signals in PARAMETER_FIELD_CONFIG
    }
    tensions = ["No professor-specific data was selected, so this plan will lean more heavily on the syllabus."]
    return ProfessorProfile(snapshot=snapshot, parameters=parameters, reliability="unknown", tensions=tensions)


def _render_professor_fallback(school_choice: str, professor_query: str) -> Tuple[Optional[ProfessorProfile], Optional[ProfessorSnapshot]]:
    with st.expander("Can't find your professor?", expanded=bool(professor_query.strip())):
        fallback_mode = st.radio(
            "How do you want to continue?",
            options=["Enter parameters manually", "Continue with just the syllabus"],
            key="professor_fallback_mode",
        )
        manual_name = st.text_input(
            "Professor name",
            value=professor_query.strip(),
            key="manual_professor_name",
            placeholder="Enter the professor name if you know it",
        )
        if fallback_mode == "Enter parameters manually":
            st.caption("Set the professor tendencies yourself and we’ll use those signals in the plan.")
            manual_levels: Dict[str, str] = {}
            for key, label, _signals in PARAMETER_FIELD_CONFIG:
                options = ["low", "medium", "high"]
                if key == "assessment_strictness":
                    options = ["lenient", "balanced", "high", "unpredictable"]
                manual_levels[key] = st.select_slider(
                    label,
                    options=options,
                    value=options[1],
                    key=f"manual-{key}",
                )
            profile = _build_manual_profile(school_choice, manual_name or "Manual Professor", manual_levels)
            return profile, profile.snapshot

        profile = _build_generic_profile(school_choice, manual_name or professor_query.strip() or "Unknown Professor")
        return profile, profile.snapshot


def _messages_digest(model_name: str, messages: List[Dict[str, str]], max_tokens: int) -> str:
    payload = {
        "model": model_name,
        "messages": messages,
        "max_tokens": max_tokens,
    }
    blob = json.dumps(payload, sort_keys=True).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def _call_llm(
    model_name: str,
    messages: List[Dict[str, str]],
    max_tokens: int = 900,
    cache_tag: Optional[str] = None,
    force_refresh: bool = False,
) -> Tuple[Optional[str], Optional[str]]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None, "Set the OPENAI_API_KEY environment variable before generating content."

    try:
        from openai import OpenAI
    except ImportError:
        return None, "Install the `openai` package (pip install openai) to generate content."

    client = OpenAI(api_key=api_key)
    cache_key = None
    if cache_tag:
        cache_key = f"{cache_tag}:{_messages_digest(model_name, messages, max_tokens)}"
        if not force_refresh:
            cached = CACHE.get(cache_key)
            if cached:
                return cached, None
    try:
        response = client.responses.create(
            model=model_name,
            input=messages,
            max_output_tokens=max_tokens,
        )
    except Exception as exc:  # pragma: no cover - surfaces API errors to UI
        return None, f"LLM request failed: {exc}"

    content = getattr(response, "output_text", None)
    if content:
        if cache_key:
            CACHE.set(cache_key, content, expire=60 * 60 * 12)
        return content, None

    try:
        text = "\n".join(
            block.text
            for item in getattr(response, "output", [])
            for block in getattr(item, "content", [])
            if hasattr(block, "text")
        )
        text = text.strip()
        if cache_key and text:
            CACHE.set(cache_key, text, expire=60 * 60 * 12)
        return text, None
    except Exception:  # pragma: no cover - defensive
        return None, "Unable to parse LLM response; please inspect logs."


def _generate_plan(
    profile: ProfessorProfile,
    syllabus_text: str,
    structured: Dict,
    model_name: str,
    force_refresh: bool = False,
) -> Tuple[str, bool]:
    syllabus_text = syllabus_text.strip()
    if not syllabus_text:
        return "Please paste a syllabus or course description first.", False

    profile_block = json.dumps(profile_as_dict(profile), indent=2)
    syllabus_structured = json.dumps(structured, indent=2)
    prompt = (
        "You are an academic coach that adapts learning plans to a professor's tendencies.\n"
        "Use the provided professor profile, tensions, and syllabus to build a structured plan "
        "covering: (1) expectation alignment, (2) weekly study cadence, (3) communication strategy, "
        "(4) exam/project prep, (5) risk mitigations tied to the tensions. "
        "Reference concrete data points when possible.\n\n"
        f"Professor Profile JSON:\n{profile_block}\n\n"
        f"Structured syllabus info:\n{syllabus_structured}\n\n"
        f"Syllabus raw excerpt:\n{syllabus_text}\n"
    )
    digest = hashlib.sha256(
        (profile.snapshot.professor_id + syllabus_text + json.dumps(structured, sort_keys=True)).encode("utf-8")
    ).hexdigest()
    text, error = _call_llm(
        model_name,
        [
            {"role": "system", "content": "You tailor study plans to professor-specific signals and keep them practical."},
            {"role": "user", "content": prompt},
        ],
        cache_tag=f"plan:{digest}",
        force_refresh=force_refresh,
    )
    if error:
        return error, False
    assert text is not None
    return text, True


def _generate_quiz(
    profile: ProfessorProfile,
    syllabus_text: str,
    structured: Dict,
    model_name: str,
    force_refresh: bool = False,
) -> Tuple[str, bool]:
    syllabus_text = syllabus_text.strip()
    if not syllabus_text:
        return "Add at least a short syllabus summary before generating quizzes.", False

    profile_block = json.dumps(profile_as_dict(profile), indent=2)
    syllabus_structured = json.dumps(structured, indent=2)
    prompt = (
        "Create a short quiz (5 questions) to help a student prepare for this professor.\n"
        "- Mix formats (multiple choice, short answer, scenario) and tie each back to the professor's tendencies.\n"
        "- Provide answers plus a quick rationale / success tip referencing the tensions when relevant.\n\n"
        f"Professor Profile JSON:\n{profile_block}\n\n"
        f"Structured syllabus info:\n{syllabus_structured}\n\n"
        f"Syllabus focus areas:\n{syllabus_text}\n"
    )
    digest = hashlib.sha256(
        ("quiz" + profile.snapshot.professor_id + syllabus_text + json.dumps(structured, sort_keys=True)).encode("utf-8")
    ).hexdigest()
    text, error = _call_llm(
        model_name,
        [
            {"role": "system", "content": "You craft diagnostic quizzes that mirror a professor's quirks."},
            {"role": "user", "content": prompt},
        ],
        max_tokens=700,
        cache_tag=f"quiz:{digest}",
        force_refresh=force_refresh,
    )
    if error:
        return error, False
    assert text is not None
    return text, True


def _conversation_system_prompt(profile: ProfessorProfile, syllabus_text: str, structured: Dict) -> str:
    profile_block = json.dumps(profile_as_dict(profile), indent=2)
    syllabus_note = syllabus_text.strip() or "Syllabus not provided yet—ask the student for details."
    structured_block = json.dumps(structured, indent=2)
    return (
        "You are ProfCoach, a friendly study partner who adapts tips to a specific professor.\n"
        "Keep replies concise, actionable, and reference the professor's parameters/tensions when helpful.\n"
        "Offer follow-up questions when the student is vague and suggest note-taking or scheduling tactics when relevant.\n"
        f"Professor context (JSON):\n{profile_block}\n\n"
        f"Structured syllabus info:\n{structured_block}\n\n"
        f"Student syllabus excerpt:\n{syllabus_note}\n"
    )


def _chat_with_coach(
    profile: ProfessorProfile,
    syllabus_text: str,
    structured: Dict,
    history: List[Dict[str, str]],
    model_name: str,
) -> Tuple[Optional[str], Optional[str]]:
    system_prompt = _conversation_system_prompt(profile, syllabus_text, structured)
    messages = [{"role": "system", "content": system_prompt}, *history]
    return _call_llm(model_name, messages, max_tokens=650)


def _build_markdown_export(
    profile: ProfessorProfile,
    syllabus_text: str,
    structured: Dict,
    plan_text: Optional[str],
    quiz_text: Optional[str],
    chat_history: List[Dict[str, str]],
    attached_files: Optional[List[str]] = None,
) -> str:
    snapshot = profile.snapshot
    lines = [
        f"# Study Planner – {snapshot.full_name}",
        f"- **School:** {snapshot.school_name} ({snapshot.school_state or 'N/A'})",
        f"- **Rank:** {snapshot.school_rank or 'N/A'}",
        f"- **Department:** {snapshot.department or 'N/A'}",
        "",
        "## Professor Parameters",
    ]
    for name, insight in profile.parameters.items():
        lines.append(f"- **{_format_param_name(name)}:** {insight.level} — {insight.summary}")
    lines.extend(
        [
            "",
            "## Risk Tensions",
        ]
    )
    for tension in profile.tensions:
        lines.append(f"- {tension}")

    lines.extend(
        [
            "",
            "## Syllabus Snapshot",
            syllabus_text.strip() or "_Not provided yet._",
        ]
    )
    if attached_files:
        lines.extend(["", "### Attached Files"])
        lines.extend(f"- {name}" for name in attached_files)
    lines.extend(["", "### Parsed Assessments"])
    assessments = structured.get("assessments", [])
    if assessments:
        for assessment in assessments:
            parts = [assessment.get("name", "Assessment")]
            if assessment.get("date"):
                parts.append(f"Date: {assessment['date']}")
            if assessment.get("weight") is not None:
                parts.append(f"Weight: {assessment['weight']}%")
            lines.append(f"- {' | '.join(parts)}")
    else:
        lines.append("- _No assessments detected._")
    lines.extend(
        [
            "",
            "### Topic Highlights",
        ]
    )
    topics = structured.get("topics", [])
    if topics:
        for topic in topics[:10]:
            lines.append(f"- {topic}")
    else:
        lines.append("- _No topics parsed yet._")

    lines.extend(
        [
            "",
            "## Personalized Plan",
            plan_text.strip() if plan_text else "_Generate a plan to populate this section._",
            "",
            "## Quiz & Practice Prompts",
            quiz_text.strip() if quiz_text else "_Generate a quiz to populate this section._",
            "",
            "## Conversation Log",
        ]
    )
    if chat_history:
        for message in chat_history:
            speaker = "Student" if message["role"] == "user" else "Coach"
            lines.append(f"- **{speaker}:** {message['content']}")
    else:
        lines.append("_No chat yet._")
    lines.append("")
    lines.append("_Markdown export ready for Obsidian or Notion import._")
    return "\n".join(lines)


def _save_markdown_to_exports(filename: str, content: str) -> Path:
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    target = EXPORTS_DIR / filename
    target.write_text(content, encoding="utf-8")
    return target


def _conversation_path(professor_id: str) -> Path:
    CONVO_DIR.mkdir(parents=True, exist_ok=True)
    return CONVO_DIR / f"{professor_id}.json"


def _load_conversation_history(professor_id: str) -> List[Dict[str, str]]:
    path = _conversation_path(professor_id)
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text())
    except Exception:
        return []


def _save_conversation_history(professor_id: str, history: List[Dict[str, str]]) -> None:
    path = _conversation_path(professor_id)
    path.write_text(json.dumps(history, ensure_ascii=False, indent=2))


def main() -> None:
    st.set_page_config(page_title="RMP Professor Adapter", layout="wide")
    st.title("Professor-Aware Study Planner")
    st.write(
        "Pick your school and professor from the RateMyProfessors scrape, inspect their signal profile, "
        "chat with a coaching bot, spin up quizzes, and export everything to Obsidian/Notion."
    )

    ensure_database(DEFAULT_ARTIFACT_PATH, DEFAULT_DB_PATH)

    selection_col, workspace_col = st.columns([1.05, 1.95], gap="large")

    with selection_col:
        _render_search_shell("Search the database", "Type a university first, then narrow to a professor.")

        st.markdown("### University")
        school_query = st.text_input(
            "Search universities",
            placeholder="Search universities like Google...",
            key="school_query",
            label_visibility="collapsed",
        )
        school_matches = db_search_schools(school_query, limit=8)
        selected_school = st.session_state.get("selected_school")
        if school_matches:
            selected_school = _render_school_suggestions(school_matches, selected_school)
        else:
            st.info("No university matches yet. Try a broader name.")

        school_choice = selected_school
        selected_prof = None
        profile = None

        if school_choice:
            st.markdown("### Professor")
            if st.session_state.get("professor_school") != school_choice:
                st.session_state["professor_school"] = school_choice
                st.session_state["professor_query"] = ""
                st.session_state["selected_professor_label"] = None
                st.session_state["selected_professor_id"] = None
                st.session_state["professor_fallback_mode"] = "Enter parameters manually"

            professors = get_professors_for_school(school_choice)
            professor_query = st.text_input(
                "Search professors",
                placeholder="Search professors like Google...",
                key="professor_query",
                label_visibility="collapsed",
            )
            professor_matches = _suggest_professors(professors, professor_query, limit=8)

            if professor_matches:
                selected_label = _render_professor_suggestions(
                    professor_matches,
                    st.session_state.get("selected_professor_label"),
                )
                if selected_label:
                    selected_prof = next(
                        (
                            professor
                            for professor in professors
                            if f"{professor.full_name} ({professor.department or 'General'})" == selected_label
                        ),
                        None,
                    )
                st.caption("If your professor isn't listed, you can enter the parameters yourself or continue with the syllabus only.")
            elif professor_query.strip():
                st.warning("No professor match found in the database.")
            else:
                st.caption("Start typing a professor name to see suggestions.")

            fallback_profile, fallback_snapshot = _render_professor_fallback(school_choice, professor_query)
            if selected_prof is None and fallback_profile is not None and fallback_snapshot is not None:
                profile = fallback_profile
                selected_prof = fallback_snapshot

        if profile is None and selected_prof is not None:
            profile = derive_parameter_profile(selected_prof)

        if profile is not None:
            _render_profile(profile)

    if profile is None or selected_prof is None:
        st.info("Pick a university and professor, or use the fallback option, to continue.")
        return

    if st.session_state.get("active_professor") != selected_prof.professor_id:
        st.session_state["active_professor"] = selected_prof.professor_id
        history = _load_conversation_history(selected_prof.professor_id)
        if not history:
            history = [
                {
                    "role": "assistant",
                    "content": (
                        f"👋 I'm your study coach for {selected_prof.full_name}. "
                        "Paste parts of the syllabus or ask how to navigate their class!"
                    ),
                }
            ]
        st.session_state["chat_history"] = history
        st.session_state["last_plan"] = ""
        st.session_state["last_quiz"] = ""

    with workspace_col:
        model_names = [name for name, _ in MODEL_OPTIONS]
        model_name = st.selectbox(
            "LLM model",
            options=model_names,
            index=model_names.index(DEFAULT_MODEL),
            format_func=lambda value: MODEL_LABELS.get(value, value),
        )
        tabs = st.tabs(["Plans & Quizzes", "Conversational Coach", "Exports & Notes"])

        with tabs[0]:
            st.subheader("Syllabus Workspace")
            syllabus_uploads = st.file_uploader(
                "Attach syllabus files",
                type=["txt", "md", "docx", "pdf"],
                accept_multiple_files=True,
                help="Upload a syllabus, assignment sheet, or reading schedule.",
            )
            syllabus_upload_text, syllabus_upload_names, syllabus_upload_warnings = _collect_uploaded_materials(
                syllabus_uploads
            )
            if syllabus_upload_names:
                st.caption("Syllabus attachments: " + ", ".join(syllabus_upload_names))

            syllabus_text = st.text_area(
                "Paste the syllabus or major assignment list",
                height=220,
                key="syllabus_text",
            )
            document_uploads = st.file_uploader(
                "Attach supporting documents",
                type=["txt", "md", "docx", "pdf", "csv", "json", "rtf"],
                accept_multiple_files=True,
                help="Upload lecture notes, assignment briefs, rubrics, or study guides.",
            )
            supporting_doc_text, supporting_doc_names, supporting_doc_warnings = _collect_uploaded_materials(
                document_uploads
            )
            if supporting_doc_names:
                st.caption("Supporting documents: " + ", ".join(supporting_doc_names))

            for warning in [*syllabus_upload_warnings, *supporting_doc_warnings]:
                st.warning(warning)

            course_material_text = _merge_course_materials(syllabus_text, syllabus_upload_text, supporting_doc_text)
            syllabus_snapshot = parse_syllabus(course_material_text)
            syllabus_structured = snapshot_as_json(syllabus_snapshot)
            st.session_state["syllabus_structured"] = syllabus_structured
            st.session_state["course_material_text"] = course_material_text
            st.session_state["course_material_files"] = syllabus_upload_names + supporting_doc_names

            with st.expander("Parsed assessments, dates, and topics", expanded=bool(syllabus_snapshot.assessments)):
                if syllabus_snapshot.assessments:
                    table_rows = [
                        {
                            "Assessment": a.name,
                            "Date": a.date_text or "—",
                            "Weight": f"{a.weight:.1f}%" if a.weight is not None else "—",
                        }
                        for a in syllabus_snapshot.assessments
                    ]
                    st.table(table_rows)
                else:
                    st.write("No assessments detected yet.")
                if syllabus_snapshot.topics:
                    st.markdown("**Topics/Weeks Detected**")
                    st.write("\n".join(f"- {topic}" for topic in syllabus_snapshot.topics[:12]))
                if syllabus_snapshot.upcoming:
                    st.markdown("**Upcoming Key Dates**")
                    st.write("\n".join(f"- {item}" for item in syllabus_snapshot.upcoming[:5]))

            force_refresh = st.checkbox("Force fresh generations (skip cache)", value=False)

            plan_col, quiz_col = st.columns(2)
            with plan_col:
                if st.button("Generate professor-aware plan", type="primary"):
                    with st.spinner("Drafting plan..."):
                        plan, ok = _generate_plan(
                            profile,
                            course_material_text,
                            syllabus_structured,
                            model_name,
                            force_refresh=force_refresh,
                        )
                    st.session_state["last_plan"] = plan if ok else ""
                    if ok:
                        st.success("Plan ready ↓")
                    else:
                        st.warning(plan)
            with quiz_col:
                if st.button("Generate adaptive quiz"):
                    with st.spinner("Building quiz..."):
                        quiz, ok = _generate_quiz(
                            profile,
                            course_material_text,
                            syllabus_structured,
                            model_name,
                            force_refresh=force_refresh,
                        )
                    st.session_state["last_quiz"] = quiz if ok else ""
                    if ok:
                        st.success("Quiz ready ↓")
                    else:
                        st.warning(quiz)

            if st.session_state.get("last_plan"):
                st.markdown("### Personalized Plan")
                st.markdown(st.session_state["last_plan"])
            if st.session_state.get("last_quiz"):
                st.markdown("### Practice Quiz")
                st.markdown(st.session_state["last_quiz"])

        with tabs[1]:
            st.subheader("Conversational Coach")
            st.caption(
                "Ask for study tactics, communication scripts, or follow-ups. "
                "The coach remembers this professor's quirks and saves each session so you can pick up later."
            )
            chat_history = st.session_state.get("chat_history", [])
            for message in chat_history:
                with st.chat_message(message["role"]):
                    st.markdown(message["content"])

            user_prompt = st.chat_input("Ask for advice, e.g., 'How do I prep for their surprise quizzes?'")
            if user_prompt:
                chat_history.append({"role": "user", "content": user_prompt})
                with st.chat_message("user"):
                    st.markdown(user_prompt)
                with st.chat_message("assistant"):
                    reply, error = _chat_with_coach(
                        profile,
                        st.session_state.get("course_material_text", ""),
                        st.session_state.get("syllabus_structured", {}),
                        chat_history,
                        model_name,
                    )
                    if error:
                        st.warning(error)
                    else:
                        assert reply is not None
                        chat_history.append({"role": "assistant", "content": reply})
                        st.markdown(reply)
                st.session_state["chat_history"] = chat_history
                _save_conversation_history(selected_prof.professor_id, chat_history)

        with tabs[2]:
            st.subheader("Export to Obsidian / Notion")
            syllabus_text = st.session_state.get("course_material_text", "")
            plan_text = st.session_state.get("last_plan", "")
            quiz_text = st.session_state.get("last_quiz", "")
            chat_history = st.session_state.get("chat_history", [])
            structured = st.session_state.get("syllabus_structured", {})
            attached_files = st.session_state.get("course_material_files", [])
            markdown_blob = _build_markdown_export(
                profile,
                syllabus_text,
                structured,
                plan_text,
                quiz_text,
                chat_history,
                attached_files=attached_files,
            )
            timestamp = datetime.now().strftime("%Y%m%d_%H%M")
            safe_prof_name = selected_prof.full_name.replace(" ", "_")
            filename = f"{safe_prof_name}_{timestamp}.md"

            st.download_button(
                "Download Markdown (drop into Obsidian or import to Notion)",
                data=markdown_blob.encode("utf-8"),
                file_name=filename,
                mime="text/markdown",
            )
            if st.button("Save Markdown to exports/ for Obsidian syncing"):
                target = _save_markdown_to_exports(filename, markdown_blob)
                st.success(f"Saved to {target}. Add that folder to your Obsidian vault or watchfolder.")

            st.caption(
                "Tip: Obsidian can watch the `exports/` folder directly. Notion users can import the Markdown file "
                "into a database or page to keep coaching plans alongside other notes."
            )


if __name__ == "__main__":
    main()
