// POST /api/chat: SHRI JI Assistant. Read-only; provider key stays on the server.
import { route, HttpError, jsonBody, callerHash, rateLimit } from "../../_lib.js";
import { getSettings } from "../../_catalog.js";
import { loadCategories } from "../../_categories.js";
import { cleanChatInput, answer, loadFaq, aiConfigured } from "../../_assistant.js";

const DAILY_AI_LIMIT = Number(process.env.CHAT_DAILY_AI_LIMIT || 300);   // per server instance: cost brake
export default route(["POST"], async (req, res) => {
  await loadCategories();
  const settings = await getSettings();
  if (settings.chat_enabled === "0") throw new HttpError(503, "The assistant is switched off right now. Please browse the shop or call us.");
  const who = callerHash(req);
  if (!rateLimit(`chat:${who}`, 12, 5 * 60 * 1000) || !rateLimit(`chat-day:${who}`, 100, 24 * 60 * 60 * 1000))
    throw new HttpError(429, "You are sending messages too quickly. Please wait a minute and try again.");
  const input = cleanChatInput(jsonBody(req));
  const useAi = aiConfigured() && rateLimit("chat-ai-global", DAILY_AI_LIMIT, 24 * 60 * 60 * 1000);
  res.json(await answer(input, { faq: await loadFaq(), useAi }));
});
