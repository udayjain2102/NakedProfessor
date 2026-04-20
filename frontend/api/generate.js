import {
  buildStudyPlanPrompt,
  parseStudyPlanResponse,
} from "../src/lib/studyPlanSchema";

function extractOutputText(data) {
  return (
    data.output_text ||
    data.output?.map((item) => item.content?.map((block) => block.text).join("")).join("\n") ||
    ""
  );
}

function normalizeJsonText(text) {
  return String(text || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { syllabus, professorSignals } = req.body || {};
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "OpenAI API key not configured." });
  }

  if (!syllabus || !professorSignals) {
    return res.status(400).json({ error: "Missing syllabus or professorSignals." });
  }

  try {
    const prompt = buildStudyPlanPrompt({ syllabus, professorSignals });
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        input: [{ role: "user", content: prompt }],
        max_output_tokens: 900,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text || "OpenAI request failed." });
    }

    const data = await response.json();
    const textResult = extractOutputText(data);
    let parsed;

    try {
      parsed = parseStudyPlanResponse(JSON.parse(normalizeJsonText(textResult)));
    } catch (error) {
      return res.status(502).json({
        error: error.message || "Model response did not match the study plan schema.",
      });
    }

    return res.status(200).json({ plan: parsed });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Generation failed." });
  }
}
