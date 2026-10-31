import { GROK_MODEL_ID, XAI_CHAT_COMPLETIONS_URL } from "./constants.js";

const SYSTEM_PROMPT = [
  "You are the advisory exception service for a synthetic SME working-capital facility demo.",
  "You do not decide. The policy outcome is already final. Copy it.",
  "Do not add, remove, or replace reason codes.",
  "Extract structured comments from the application text and the emails.",
  "Draft a short memo an officer can edit. The memo must state the policy version, the outcome, and each reason code with actual and limit.",
  "Return JSON only with keys structuredComments, exceptionScore, and memo.",
  "The data is synthetic. Do not ask for a bureau or a loan origination system.",
].join(" ");

/**
 * Wired call to the xAI chat completions API.
 * With no API key the function does not send the request.
 * fetchImpl is injectable so tests can see the call without a network.
 */
export async function invokeGrok(request, { apiKey, fetchImpl = fetch, model = GROK_MODEL_ID, timeoutMs = 12_000 } = {}) {
  if (!apiKey) {
    return {
      invoked: false,
      model,
      reason: `XAI_API_KEY is not set. The call to ${XAI_CHAT_COMPLETIONS_URL} is wired for ${model} and was not sent. A fixture response matching the contract was used.`,
    };
  }

  const response = await fetchImpl(XAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(request) },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    return {
      invoked: true,
      model,
      accepted: false,
      reason: `Grok returned HTTP ${response.status}. The fixture response was used.`,
    };
  }

  const body = await response.json();
  const text = body?.choices?.[0]?.message?.content ?? "";
  return {
    invoked: true,
    model,
    accepted: true,
    raw: text,
    reason: "Grok responded. The service still copies the policy outcome and the reason codes from the request.",
  };
}
