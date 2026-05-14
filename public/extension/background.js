chrome.runtime.onMessageExternal.addListener(
  (request, sender, sendResponse) => {
    if (request.action === 'fetch_html' && request.url) {
      console.log('Received request to fetch:', request.url);

      chrome.tabs.create({ url: request.url, active: false }, (tab) => {
        const tabId = tab.id;

        const listener = (updatedTabId, info) => {
          if (updatedTabId === tabId && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);

            chrome.scripting.executeScript({
              target: { tabId: tabId },
              world: 'MAIN',
              func: () => {
                return new Promise((resolve) => {

                  const cleanText = (t) => {
                    if (!t) return '';
                    return t
                      .replace(/[\u200B-\u200D\uFEFF]?[⭐\*]?turn\d+search\d+[⭐\*]?[\u200B-\u200D\uFEFF]?/g, '')
                      .replace(/[\u200B-\u200D\uFEFF]/g, '')
                      .trim();
                  };

                  const mapParts = (parts) => {
                    if (Array.isArray(parts)) {
                      return cleanText(
                        parts
                          .map(p => typeof p === 'string' ? p : (p?.text || p?.value || p?.content || ''))
                          .filter(Boolean)
                          .join('\n')
                      );
                    }
                    return cleanText(String(parts || ''));
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
                        return;
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

                  const title = document.title || 'Extracted Chat';
                  const hostname = window.location.hostname;
                  const isGemini = hostname.includes('gemini.google.com');
                  const isClaude = hostname.includes('claude.ai');
                  const isDeepSeek = hostname.includes('deepseek.com');
                  const isPerplexity = hostname.includes('perplexity.ai');
                  const isGrok = hostname.includes('grok.com');

                  // ── Gemini-specific extraction ──────────────────────────────
                  const tryGeminiExtract = () => {
                    if (!isGemini) return false;

                    const msgs = [];

                    // Strategy 1: Gemini embeds conversation data in a script tag as AF_initDataCallback
                    try {
                      const scripts = document.querySelectorAll('script');
                      for (const script of scripts) {
                        const text = script.textContent || '';
                        // Gemini uses AF_initDataCallback with nested arrays
                        if (text.includes('AF_initDataCallback') && text.includes('"user"')) {
                          // Extract all string arrays that look like conversation turns
                          const matches = text.matchAll(/"(user|model)","([^"]{10,})"/g);
                          for (const m of matches) {
                            const role = m[1] === 'model' ? 'assistant' : 'user';
                            const content = m[2].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                            if (content.trim()) {
                              msgs.push({ role, content: content.trim(), content_html: content.trim() });
                            }
                          }
                          if (msgs.length > 0) break;
                        }
                      }
                    } catch (_) {}

                    if (msgs.length > 0) {
                      resolve({ success: true, title, messages: dedupe(msgs) });
                      return true;
                    }

                    // Strategy 2: DOM-based extraction using Gemini's custom elements
                    // Gemini share pages use <user-query> and <model-response> custom elements
                    const domMsgs = [];

                    // Try Gemini's custom element selectors
                    const userNodes = document.querySelectorAll(
                      'user-query, .user-query, [data-turn-type="user"], .conversation-turn-user, ' +
                      '.query-content, user-query-content, .user-request-text'
                    );
                    const modelNodes = document.querySelectorAll(
                      'model-response, .model-response, [data-turn-type="model"], .conversation-turn-model, ' +
                      'response-container, .response-content, model-response-text, .response-text'
                    );

                    if (userNodes.length > 0 || modelNodes.length > 0) {
                      // Build ordered list by finding common parent and iterating children
                      const allTurns = [];

                      userNodes.forEach(el => {
                        allTurns.push({ el, role: 'user', top: el.getBoundingClientRect().top + window.scrollY });
                      });
                      modelNodes.forEach(el => {
                        allTurns.push({ el, role: 'assistant', top: el.getBoundingClientRect().top + window.scrollY });
                      });

                      allTurns.sort((a, b) => a.top - b.top);

                      for (const turn of allTurns) {
                        const text = (turn.el.textContent || '').trim();
                        const html = (turn.el.innerHTML || '').trim();
                        if (text.length > 0) {
                          domMsgs.push({ role: turn.role, content: text, content_html: html || text });
                        }
                      }
                    }

                    // Strategy 3: Generic conversation container scan for Gemini
                    if (domMsgs.length === 0) {
                      // Try message-content elements — Gemini often wraps turns this way
                      const containers = document.querySelectorAll(
                        'message-content, .message-content, conversation-turn, .conversation-turn, ' +
                        '.chat-turn, [class*="turn"], [class*="message-row"]'
                      );

                      containers.forEach((el) => {
                        const cls = (el.className || '').toLowerCase();
                        const tag = (el.tagName || '').toLowerCase();
                        let role = 'unknown';

                        if (cls.includes('user') || tag === 'user-query') {
                          role = 'user';
                        } else if (cls.includes('model') || cls.includes('assistant') || cls.includes('response') || tag === 'model-response') {
                          role = 'assistant';
                        }

                        const text = (el.textContent || '').trim();
                        if (text.length > 5) {
                          domMsgs.push({ role, content: text, content_html: el.innerHTML || text });
                        }
                      });
                    }

                    // Strategy 4: Scan all script tags for JSON arrays with role/parts patterns (Gemini specific)
                    if (domMsgs.length === 0) {
                      try {
                        const scripts = document.querySelectorAll('script');
                        for (const script of scripts) {
                          const text = script.textContent || '';
                          if (text.length < 100) continue;
                          // Look for Gemini's protobuf-style nested arrays with role indicators
                          // Gemini often serialises: [null, null, [["role", ...], ["content", ...]]]
                          const roleUserIdx = text.indexOf('"1"'); // user role in Gemini proto
                          const roleModelIdx = text.indexOf('"2"'); // model role in Gemini proto
                          if ((roleUserIdx > -1 || roleModelIdx > -1) && text.includes('parts')) {
                            // Try parsing any JSON-like object
                            try {
                              const jsonMatch = text.match(/\[[\s\S]{200,}\]/);
                              if (jsonMatch) {
                                const parsed = JSON.parse(jsonMatch[0]);
                                const msgs2 = buildMessages(parsed);
                                if (msgs2.length > 0) {
                                  resolve({ success: true, title, messages: dedupe(msgs2) });
                                  return true;
                                }
                              }
                            } catch (_) {}
                          }
                        }
                      } catch (_) {}
                    }

                    if (domMsgs.length > 0) {
                      // Fix unknown roles using alternating logic
                      let isUser = true;
                      for (const m of domMsgs) {
                        if (m.role === 'unknown') {
                          m.role = isUser ? 'user' : 'assistant';
                        }
                        isUser = m.role !== 'user';
                      }
                      resolve({ success: true, title, messages: dedupe(domMsgs) });
                      return true;
                    }

                    return false;
                  };

                  // ── ChatGPT/General extraction ──────────────────────────────
                  const tryExtract = () => {
                    // Try Gemini first if on Gemini
                    if (isGemini && tryGeminiExtract()) return true;

                    if (window.__remixContext) {
                      try {
                        const msgs = buildMessages(window.__remixContext);
                        if (msgs.length > 0) {
                          resolve({ success: true, title, messages: dedupe(msgs) });
                          return true;
                        }
                      } catch (_) {}
                    }

                    if (window.__NEXT_DATA__) {
                      try {
                        const msgs = buildMessages(window.__NEXT_DATA__);
                        if (msgs.length > 0) {
                          resolve({ success: true, title, messages: dedupe(msgs) });
                          return true;
                        }
                      } catch (_) {}
                    }

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

                  if (tryExtract()) return;

                  // Poll: wait for hydration
                  let attempts = 0;
                  const poll = setInterval(() => {
                    attempts++;

                    // For Gemini, try DOM extraction on every poll attempt since it's DOM-rendered
                    if (isGemini && tryGeminiExtract()) {
                      clearInterval(poll);
                      return;
                    }

                    if (tryExtract() || attempts >= 20) {
                      clearInterval(poll);
                      if (attempts >= 20) {
                        // ── Universal DOM fallback ─────────────────────────────
                        const msgs = [];

                        // ChatGPT
                        document.querySelectorAll('[data-message-author-role]').forEach(el => {
                          const role = el.getAttribute('data-message-author-role');
                          if (role !== 'user' && role !== 'assistant') return;
                          const text = (el.textContent || '').trim();
                          if (text) msgs.push({ role, content: text, content_html: (el.innerHTML || '').trim() });
                        });

                        // Claude
                        if (msgs.length === 0) {
                          document.querySelectorAll('.font-user-message, .font-claude-message').forEach(el => {
                            const isUser = (el.className || '').includes('user');
                            const text = (el.textContent || '').trim();
                            if (text) msgs.push({ role: isUser ? 'user' : 'assistant', content: text, content_html: el.innerHTML || text });
                          });
                        }

                        // Gemini broad fallback
                        if (msgs.length === 0 && isGemini) {
                          const allEls = document.querySelectorAll('[class*="query"], [class*="response"], [class*="message"], user-query, model-response');
                          allEls.forEach(el => {
                            const cls = (el.className || '').toLowerCase();
                            const tag = (el.tagName || '').toLowerCase();
                            const isUser = cls.includes('query') || cls.includes('user') || tag === 'user-query';
                            const isModel = cls.includes('response') || cls.includes('model') || tag === 'model-response';
                            if (!isUser && !isModel) return;
                            const text = (el.textContent || '').trim();
                            if (text.length > 5) {
                              msgs.push({ role: isUser ? 'user' : 'assistant', content: text, content_html: el.innerHTML || text });
                            }
                          });
                        }

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
