chrome.runtime.onMessageExternal.addListener(
  (request, sender, sendResponse) => {
    if (request.action === 'fetch_html' && request.url) {
      console.log('Received request to fetch:', request.url);

      chrome.tabs.create({ url: request.url, active: false }, (tab) => {
        const tabId = tab.id;

        const listener = (updatedTabId, info) => {
          if (updatedTabId === tabId && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);

            // Run in MAIN world so we can access the page's own window variables
            // (window.__remixContext, window.__NEXT_DATA__, etc.).
            // ChatGPT serializes the FULL conversation into these objects on page
            // load — completely independent of virtual scroll or viewport rendering.
            chrome.scripting.executeScript({
              target: { tabId: tabId },
              world: 'MAIN',
              func: () => {
                return new Promise((resolve) => {

                  const mapParts = (parts) => {
                    if (Array.isArray(parts)) {
                      return parts
                        .map(p => typeof p === 'string' ? p : (p?.text || p?.value || p?.content || ''))
                        .filter(Boolean)
                        .join('\n');
                    }
                    return String(parts || '');
                  };

                  const buildMessages = (root) => {
                    const out = [];
                    const search = (obj) => {
                      if (!obj || typeof obj !== 'object') return;
                      if (Array.isArray(obj)) { obj.forEach(search); return; }

                      // Pattern A: { role, content: { parts } }  ← ChatGPT API
                      if ((obj.role === 'user' || obj.role === 'assistant') &&
                          obj.content != null && obj.content.parts !== undefined) {
                        const text = mapParts(obj.content.parts).trim();
                        if (text) out.push({ role: obj.role, content: text, content_html: text });
                        return; // don't recurse into children
                      }

                      // Pattern B: { author: { role }, content: { parts } }
                      if ((obj.author?.role === 'user' || obj.author?.role === 'assistant') &&
                          obj.content != null && obj.content.parts !== undefined) {
                        const text = mapParts(obj.content.parts).trim();
                        if (text) out.push({ role: obj.author.role, content: text, content_html: text });
                        return;
                      }

                      // Pattern C: { message: { role, content: { parts } } }
                      if (obj.message && obj.message.role && obj.message.content?.parts !== undefined) {
                        search(obj.message);
                        return;
                      }

                      try { Object.values(obj).forEach(search); } catch (_) {}
                    };
                    search(root);
                    return out;
                  };

                  const dedupe = (msgs) => {
                    const seen = new Set();
                    return msgs.filter(m => {
                      const key = m.role + ':' + m.content.substring(0, 120);
                      if (seen.has(key)) return false;
                      seen.add(key);
                      return true;
                    });
                  };

                  const title = document.title || 'ChatGPT Chat';

                  // ── Strategy 1: window.__remixContext ─────────────────────
                  // Current ChatGPT share pages embed the full conversation here
                  const tryExtract = () => {
                    if (window.__remixContext) {
                      try {
                        const msgs = buildMessages(window.__remixContext);
                        if (msgs.length > 0) {
                          resolve({ success: true, title, messages: dedupe(msgs) });
                          return true;
                        }
                      } catch (_) {}
                    }

                    // ── Strategy 2: window.__NEXT_DATA__ ──────────────────────
                    // Older ChatGPT format
                    if (window.__NEXT_DATA__) {
                      try {
                        const msgs = buildMessages(window.__NEXT_DATA__);
                        if (msgs.length > 0) {
                          resolve({ success: true, title, messages: dedupe(msgs) });
                          return true;
                        }
                      } catch (_) {}
                    }

                    // ── Strategy 3: React Router streaming data ────────────────
                    // ChatGPT inlines data via window.__reactRouterDataStrategies
                    // or similar globals
                    const globals = ['__reactRouterDataStrategies', '__reactRouterContext',
                                     '__reactRouterManifest', 'remixContext'];
                    for (const key of globals) {
                      if (window[key]) {
                        try {
                          const msgs = buildMessages(window[key]);
                          if (msgs.length > 0) {
                            resolve({ success: true, title, messages: dedupe(msgs) });
                            return true;
                          }
                        } catch (_) {}
                      }
                    }

                    return false;
                  };

                  // Try immediately — data may already be hydrated
                  if (tryExtract()) return;

                  // Otherwise poll: the page sets these variables after hydration
                  // (typically within 1-3 seconds of DOMContentLoaded)
                  let attempts = 0;
                  const poll = setInterval(() => {
                    attempts++;
                    if (tryExtract() || attempts >= 20) {
                      clearInterval(poll);
                      if (attempts >= 20) {
                        // ── Fallback: DOM extraction ───────────────────────────
                        // If JSON data never appeared, try scraping what's visible
                        const msgs = [];
                        document.querySelectorAll('[data-message-author-role]').forEach(el => {
                          const role = el.getAttribute('data-message-author-role');
                          if (role !== 'user' && role !== 'assistant') return;
                          const text = (el.textContent || '').trim();
                          if (text) msgs.push({ role, content: text, content_html: (el.innerHTML || '').trim() });
                        });
                        resolve({ success: msgs.length > 0, title, messages: dedupe(msgs) });
                      }
                    }
                  }, 500);

                });
              }
            }, (results) => {
              let payload = null;
              if (results && results[0] && results[0].result) {
                payload = results[0].result;
              }

              chrome.tabs.remove(tabId);

              if (payload && payload.success && payload.messages) {
                sendResponse(payload);
              } else {
                sendResponse({ success: false });
              }
            });
          }
        };

        chrome.tabs.onUpdated.addListener(listener);
      });

      return true;
    }
  }
);
