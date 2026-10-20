// /sitemap.xml, /robots.txt, /api/site-settings and /api/chat (rewritten to ?action=).
import sitemap from "./_routes/site/sitemap.js";
import robots from "./_routes/site/robots.js";
import settings from "./_routes/site/settings.js";
import chat from "./_routes/site/chat.js";
export default (req, res) => {
  const a = req.query?.action;
  return a === "robots" ? robots(req, res) : a === "settings" ? settings(req, res) : a === "chat" ? chat(req, res) : sitemap(req, res);
};
