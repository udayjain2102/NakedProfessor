export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { model, prompt } = req.body;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "Missing required environment variable: OPENAI_API_KEY" });
  }

  if (!model || !prompt) {
    return res.status(400).json({ error: "Missing model or prompt." });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [{ role: "user", content: prompt }],
        max_output_tokens: 900,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text || "OpenAI request failed." });
    }

    const data = await response.json();
    const textResult =
      data.output_text ||
      data.output?.map((item) => item.content?.map((block) => block.text).join("")).join("\n") ||
      "";

    return res.status(200).json({ text: textResult });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Generation failed." });
  }
}
