import { useEffect, useMemo, useState } from "react";

const MODEL_OPTIONS = [
  { value: "gpt-4o-mini", label: "gpt-4o-mini (Fast)" },
  { value: "gpt-4.1-mini", label: "gpt-4.1-mini (Balanced)" },
  { value: "gpt-4.1", label: "gpt-4.1 (Higher quality)" }
];

function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    return headers.reduce((obj, header, index) => {
      obj[header] = values[index] ? values[index].trim() : "";
      return obj;
    }, {});
  });
}

async function callOpenAI(apiKey, model, prompt) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: [{ role: "user", content: prompt }],
      max_output_tokens: 900
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || "OpenAI request failed");
  }

  const data = await response.json();
  return data.output_text ||
    data.output?.map((item) => item.content?.map((block) => block.text).join(""))?.join("\n") ||
    "";
}

function profileSummary(professor) {
  return `${professor.professor_first} ${professor.professor_last} — ${professor.department} · ${professor.avg_rating || "N/A"}⭐ · difficulty ${professor.avg_difficulty || "N/A"}`;
}

export default function App() {
  const [professors, setProfessors] = useState([]);
  const [school, setSchool] = useState("Pennsylvania State University - Behrend");
  const [selectedProfessorId, setSelectedProfessorId] = useState("");
  const [syllabus, setSyllabus] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  const [plan, setPlan] = useState("");
  const [quiz, setQuiz] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/data/behrend_professors.csv")
      .then((res) => res.text())
      .then((text) => {
        const parsed = parseCSV(text);
        setProfessors(parsed);
        if (parsed.length > 0) {
          setSelectedProfessorId(parsed[0].professor_id);
        }
      })
      .catch((err) => {
        console.error(err);
        setError("Unable to load professor data.");
      });
  }, []);

  const schools = useMemo(
    () => Array.from(new Set(professors.map((prof) => prof.school_name))).sort(),
    [professors]
  );

  const filteredProfessors = useMemo(
    () => professors.filter((prof) => prof.school_name === school),
    [professors, school]
  );

  const selectedProfessor = useMemo(
    () => filteredProfessors.find((prof) => prof.professor_id === selectedProfessorId) || filteredProfessors[0],
    [filteredProfessors, selectedProfessorId]
  );

  async function generate(type) {
    if (!openaiKey) {
      setError("Enter your OpenAI API key to generate content.");
      return;
    }
    if (!selectedProfessor) {
      setError("Select a professor first.");
      return;
    }
    if (!syllabus.trim()) {
      setError("Paste the syllabus or course description before generating.");
      return;
    }

    setError("");
    setStatus(`${type === "plan" ? "Generating plan" : "Generating quiz"}…`);
    setLoading(true);

    const profileBlock = `Professor: ${selectedProfessor.professor_first} ${selectedProfessor.professor_last}\nDepartment: ${selectedProfessor.department}\nRating: ${selectedProfessor.avg_rating}\nDifficulty: ${selectedProfessor.avg_difficulty}\nWould take again: ${selectedProfessor.would_take_again_percent}%\nReviews: ${selectedProfessor.num_ratings}`;
    const prompt =
      type === "plan"
        ? `You are an academic coach. Using the professor profile below and the syllabus, create a tailored study plan covering expectation alignment, weekly cadence, communication strategy, exam/project prep, and risk mitigations.\n\nProfessor profile:\n${profileBlock}\n\nSyllabus:\n${syllabus}`
        : `You are an academic coach. Create a 5-question study quiz for this professor. Mix multiple choice, short answer, and scenario questions. Provide answers and quick tips tied to the professor profile below.\n\nProfessor profile:\n${profileBlock}\n\nSyllabus:\n${syllabus}`;

    try {
      const result = await callOpenAI(openaiKey, model, prompt);
      if (type === "plan") {
        setPlan(result);
      } else {
        setQuiz(result);
      }
      setStatus("Ready");
    } catch (err) {
      console.error(err);
      setError(err.message || "Generation failed.");
      setStatus("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="poster-stage">
        <div className="poster-copy">
          <div className="poster-tag-row">
            <span className="poster-chip">Streamlit replacement</span>
            <span className="poster-chip">Professor planner</span>
            <span className="poster-chip">Penn State Behrend</span>
          </div>

          <div className="brand-lockup">
            <div className="brand-mark">RMP</div>
            <div>
              <div className="eyebrow">Professor-aware study planning</div>
              <h1>Behrend study coach</h1>
            </div>
          </div>

          <p className="poster-headline">Turn syllabus detail and RateMyProfessors signals into a plan, quiz, and professor strategy.</p>
          <p className="poster-subhead">Select a professor, paste the syllabus, and generate professor-aware guidance directly in the browser.</p>

          <div className="poster-panels">
            <article className="poster-panel">
              <span className="section-label">Professor</span>
              <strong>{selectedProfessor ? profileSummary(selectedProfessor) : "Loading professors…"}</strong>
              <p>{selectedProfessor ? selectedProfessor.profile_url : "No professor selected."}</p>
            </article>
            <article className="poster-panel poster-panel-light">
              <span className="section-label">Status</span>
              <strong>{loading ? "Running" : status || "Ready"}</strong>
              <p>{error || "Use your OpenAI key, select a professor, and generate output."}</p>
            </article>
          </div>
        </div>

        <div className="phone-stage">
          <div className="phone-shell">
            <div className="phone-notch" />
            <div className="phone-screen">
              <div className="screen-header" style={{ paddingTop: "36px" }}>
                <strong>Streamlit Study Planner</strong>
                <p>Use Behrend professor ratings and syllabus input to generate tailored student guidance.</p>
              </div>
              <div className="screen-body" style={{ padding: "20px" }}>
                <label className="section-label">OpenAI API key</label>
                <input
                  type="password"
                  value={openaiKey}
                  onChange={(event) => setOpenaiKey(event.target.value)}
                  placeholder="sk-..."
                  style={{ width: "100%", padding: "14px", borderRadius: "18px", border: "1px solid var(--line)", marginBottom: "16px" }}
                />

                <label className="section-label">Professor</label>
                <select
                  value={school}
                  onChange={(event) => setSchool(event.target.value)}
                  style={{ width: "100%", padding: "14px", borderRadius: "18px", border: "1px solid var(--line)", marginBottom: "12px" }}
                >
                  {schools.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedProfessorId}
                  onChange={(event) => setSelectedProfessorId(event.target.value)}
                  style={{ width: "100%", padding: "14px", borderRadius: "18px", border: "1px solid var(--line)", marginBottom: "20px" }}
                >
                  {filteredProfessors.map((prof) => (
                    <option key={prof.professor_id} value={prof.professor_id}>
                      {prof.professor_first} {prof.professor_last} — {prof.department}
                    </option>
                  ))}
                </select>

                <label className="section-label">Syllabus / Course notes</label>
                <textarea
                  value={syllabus}
                  onChange={(event) => setSyllabus(event.target.value)}
                  placeholder="Paste the syllabus or major assignment list here..."
                  rows={10}
                  style={{ width: "100%", padding: "16px", borderRadius: "24px", border: "1px solid var(--line)", resize: "vertical", marginBottom: "18px" }}
                />

                <label className="section-label">LLM model</label>
                <select
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  style={{ width: "100%", padding: "14px", borderRadius: "18px", border: "1px solid var(--line)", marginBottom: "20px" }}
                >
                  {MODEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "20px" }}>
                  <button
                    onClick={() => generate("plan")}
                    disabled={loading}
                    style={{ flex: 1, background: "#111", color: "#fff", borderRadius: "18px", padding: "14px" }}
                  >
                    Generate plan
                  </button>
                  <button
                    onClick={() => generate("quiz")}
                    disabled={loading}
                    style={{ flex: 1, background: "#f7f06d", color: "#111", borderRadius: "18px", padding: "14px" }}
                  >
                    Generate quiz
                  </button>
                </div>

                <div style={{ marginBottom: "18px" }}>
                  <span className="section-label">Professor details</span>
                  <div style={{ padding: "18px", borderRadius: "24px", background: "rgba(255,255,255,0.92)", border: "1px solid var(--line)", marginTop: "10px" }}>
                    {selectedProfessor ? (
                      <>
                        <p><strong>{selectedProfessor.professor_first} {selectedProfessor.professor_last}</strong></p>
                        <p>{selectedProfessor.department}</p>
                        <p>{selectedProfessor.avg_rating} ⭐ · difficulty {selectedProfessor.avg_difficulty} · {selectedProfessor.would_take_again_percent}% would take again</p>
                        <a href={selectedProfessor.profile_url} target="_blank" rel="noreferrer">RateMyProfessors profile</a>
                      </>
                    ) : (
                      <p>Loading professor details…</p>
                    )}
                  </div>
                </div>

                {plan && (
                  <article className="poster-panel" style={{ marginBottom: "18px" }}>
                    <span className="section-label">Generated plan</span>
                    <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{plan}</pre>
                  </article>
                )}
                {quiz && (
                  <article className="poster-panel poster-panel-light">
                    <span className="section-label">Generated quiz</span>
                    <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{quiz}</pre>
                  </article>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
