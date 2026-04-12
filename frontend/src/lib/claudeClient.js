/**
 * Anthropic Claude API client for LLM generation
 */

export async function callClaude(apiKey, model, professorProfile, syllabus, type) {
  const profileBlock = JSON.stringify(professorProfile, null, 2);

  const systemPrompt = type === 'plan'
    ? "You are an academic coach. Build a structured study plan (5 sections: expectation alignment, weekly cadence, communication strategy, exam/project prep, risk mitigations). Be concrete, reference the professor's data directly, keep it under 400 words."
    : "You are an academic coach. Write a 5-question study quiz for this professor. Mix formats (MC, short answer, scenario). After each question give the answer + a 1-sentence tip tied to this professor's tendencies. Under 350 words total.";

  const userContent = type === 'plan'
    ? `Professor profile:\n${profileBlock}\n\nSyllabus:\n${syllabus}`
    : `Professor profile:\n${profileBlock}\n\nSyllabus focus:\n${syllabus}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }]
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || "Claude API request failed");
  }

  const data = await response.json();
  return data.content?.[0]?.text ?? "";
}
