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

                  // ─── Helpers ────────────────────────────────────────────────
                  const cleanText = (t) => {
                    if (!t) return '';
                    return t
                      .replace(/[\u200B-\u200D\uFEFF]?[⭐*]?turn\d+search\d+[⭐*]?[\u200B-\u200D\uFEFF]?/g, '')
                      .replace(/[\u200B-\u200D\uFEFF]/g, '')
                      .replace(/\s+/g, ' ')
                      .trim();
                  };

                  const mapParts = (parts) => {
                    if (Array.isArray(parts)) {
                      return cleanText(parts.map(p => typeof p === 'string' ? p : (p?.text || p?.value || p?.content || '')).filter(Boolean).join('\n'));
                    }
                    return cleanText(String(parts || ''));
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

                  const fixUnknownRoles = (msgs) => {
                    let isUser = true;
                    return msgs.map(m => {
                      if (m.role === 'unknown') m.role = isUser ? 'user' : 'assistant';
                      isUser = m.role !== 'user';
                      return m;
                    });
                  };

                  // Sort elements by their DOM position (top offset)
                  const sortByDomOrder = (items) => items.sort((a, b) => {
                    const ra = a.el.getBoundingClientRect();
                    const rb = b.el.getBoundingClientRect();
                    return (ra.top + window.scrollY) - (rb.top + window.scrollY);
                  });

                  // Deep-search JS object for chat message patterns
                  const buildMessagesFromObj = (root) => {
                    const out = [];
                    const search = (obj) => {
                      if (!obj || typeof obj !== 'object') return;
                      if (Array.isArray(obj)) { obj.forEach(search); return; }

                      // Pattern A: { role, content: { parts } }  ← ChatGPT/Gemini API
                      if ((obj.role === 'user' || obj.role === 'assistant') && obj.content?.parts !== undefined) {
                        const text = mapParts(obj.content.parts).trim();
                        if (text) out.push({ role: obj.role, content: text, content_html: text });
                        return;
                      }
                      // Pattern B: { author: { role }, content: { parts } }
                      if ((obj.author?.role === 'user' || obj.author?.role === 'assistant') && obj.content?.parts !== undefined) {
                        const text = mapParts(obj.content.parts).trim();
                        if (text) out.push({ role: obj.author.role, content: text, content_html: text });
                        return;
                      }
                      // Pattern C: { message: { role, content: { parts } } }
                      if (obj.message?.role && obj.message.content?.parts !== undefined) {
                        search(obj.message); return;
                      }
                      // Pattern D: Claude { sender: "human"|"assistant", text }
                      if ((obj.sender === 'human' || obj.sender === 'assistant') && obj.text) {
                        const role = obj.sender === 'human' ? 'user' : 'assistant';
                        const text = cleanText(typeof obj.text === 'string' ? obj.text : mapParts(obj.text));
                        if (text) out.push({ role, content: text, content_html: text });
                        return;
                      }
                      // Pattern E: { role: "user"|"assistant", content: string }
                      if ((obj.role === 'user' || obj.role === 'assistant') && typeof obj.content === 'string' && obj.content.length > 0) {
                        out.push({ role: obj.role, content: cleanText(obj.content), content_html: cleanText(obj.content) });
                        return;
                      }
                      try { Object.values(obj).forEach(search); } catch (_) {}
                    };
                    search(root);
                    return out;
                  };

                  // ─── Platform Detection ─────────────────────────────────────
                  const hostname = window.location.hostname;
                  const pathname = window.location.pathname;
                  const title = document.title || 'Extracted Chat';

                  const isChatGPT    = hostname.includes('chatgpt.com');
                  const isGemini     = hostname.includes('gemini.google.com');
                  const isClaude     = hostname.includes('claude.ai');
                  const isGrok       = hostname.includes('grok.com') || (hostname.includes('x.com') && pathname.includes('/grok'));
                  const isPerplexity = hostname.includes('perplexity.ai');
                  const isDeepSeek   = hostname.includes('deepseek.com');

                  const done = (msgs) => resolve({ success: msgs.length > 0, title, messages: dedupe(fixUnknownRoles(msgs)) });

                  // ══════════════════════════════════════════════════════════════
                  // CLAUDE  (claude.ai/share/...)
                  // ══════════════════════════════════════════════════════════════
                  const tryClaudeExtract = () => {
                    if (!isClaude) return false;
                    const msgs = [];

                    // Strategy 1: window.__NEXT_DATA__ or window.__SSR_DATA__
                    for (const key of ['__NEXT_DATA__', '__SSR_DATA__', '__NUXT_DATA__']) {
                      if (window[key]) {
                        try {
                          const found = buildMessagesFromObj(window[key]);
                          if (found.length > 0) { done(found); return true; }
                        } catch (_) {}
                      }
                    }

                    // Strategy 2: data-testid selectors — most reliable for Claude share pages
                    const humanTurns = document.querySelectorAll('[data-testid="human-turn"], [data-testid="user-turn"]');
                    const aiTurns    = document.querySelectorAll('[data-testid="ai-turn"], [data-testid="assistant-turn"]');

                    if (humanTurns.length > 0 || aiTurns.length > 0) {
                      const allTurns = [];
                      humanTurns.forEach(el => allTurns.push({ el, role: 'user' }));
                      aiTurns.forEach(el => allTurns.push({ el, role: 'assistant' }));
                      sortByDomOrder(allTurns).forEach(({ el, role }) => {
                        const text = cleanText(el.textContent || '');
                        if (text) msgs.push({ role, content: text, content_html: el.innerHTML || text });
                      });
                    }

                    // Strategy 3: font-* class selectors
                    if (msgs.length === 0) {
                      const nodes = document.querySelectorAll('.font-user-message, .font-claude-message, [class*="human-turn"], [class*="ai-turn"]');
                      nodes.forEach(el => {
                        const cls = (el.className || '').toLowerCase();
                        const isUser = cls.includes('user') || cls.includes('human');
                        const text = cleanText(el.textContent || '');
                        if (text) msgs.push({ role: isUser ? 'user' : 'assistant', content: text, content_html: el.innerHTML || text });
                      });
                    }

                    // Strategy 4: article elements (Claude sometimes uses these)
                    if (msgs.length === 0) {
                      document.querySelectorAll('article').forEach((el, i) => {
                        const text = cleanText(el.textContent || '');
                        if (text) msgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: text, content_html: el.innerHTML || text });
                      });
                    }

                    if (msgs.length > 0) { done(msgs); return true; }
                    return false;
                  };

                  // ══════════════════════════════════════════════════════════════
                  // GROK  (grok.com/share/...)
                  // ══════════════════════════════════════════════════════════════
                  const tryGrokExtract = () => {
                    if (!isGrok) return false;
                    const msgs = [];

                    // Strategy 1: __NEXT_DATA__ (Grok uses Next.js)
                    if (window.__NEXT_DATA__) {
                      try {
                        const found = buildMessagesFromObj(window.__NEXT_DATA__);
                        if (found.length > 0) { done(found); return true; }
                      } catch (_) {}
                    }

                    // Strategy 2: Look for Grok's conversation data in other globals
                    for (const key of ['__INITIAL_STATE__', '__APP_STATE__', 'grokData', '__GROK_DATA__']) {
                      if (window[key]) {
                        try {
                          const found = buildMessagesFromObj(window[key]);
                          if (found.length > 0) { done(found); return true; }
                        } catch (_) {}
                      }
                    }

                    // Strategy 3: DOM extraction with strict alternation
                    // Grok uses obfuscated Tailwind classes — use structural heuristics
                    // Find the main conversation container
                    const possibleContainers = document.querySelectorAll(
                      '[class*="conversation"], [class*="message-list"], [class*="chat"], main, [role="main"]'
                    );

                    let bestContainer = null;
                    let maxChildren = 0;
                    possibleContainers.forEach(el => {
                      const childCount = el.children.length;
                      if (childCount > maxChildren && childCount > 1) {
                        maxChildren = childCount;
                        bestContainer = el;
                      }
                    });

                    if (bestContainer) {
                      Array.from(bestContainer.children).forEach((el, i) => {
                        const text = cleanText(el.textContent || '');
                        if (text.length > 5) {
                          msgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: text, content_html: el.innerHTML || text });
                        }
                      });
                    }

                    // Strategy 4: Broad scan — find elements with significant text, use alternation
                    if (msgs.length === 0) {
                      const candidates = document.querySelectorAll('[class*="message"], [class*="bubble"], [class*="turn"], [class*="response"]');
                      const seen = new Set();
                      candidates.forEach(el => {
                        const text = cleanText(el.textContent || '');
                        if (text.length > 10 && !seen.has(text.substring(0, 80))) {
                          seen.add(text.substring(0, 80));
                          msgs.push({ role: 'unknown', content: text, content_html: el.innerHTML || text });
                        }
                      });
                    }

                    // Force strict alternation for Grok (obfuscated classes = unreliable role detection)
                    if (msgs.length > 0) {
                      msgs.forEach((m, i) => { m.role = i % 2 === 0 ? 'user' : 'assistant'; });
                      done(msgs);
                      return true;
                    }
                    return false;
                  };

                  // ══════════════════════════════════════════════════════════════
                  // PERPLEXITY  (perplexity.ai/search/...)
                  // ══════════════════════════════════════════════════════════════
                  const tryPerplexityExtract = () => {
                    if (!isPerplexity) return false;
                    const msgs = [];

                    // Strategy 1: __NEXT_DATA__ (Perplexity uses Next.js)
                    if (window.__NEXT_DATA__) {
                      try {
                        // Perplexity stores queries and answers in pageProps
                        const data = window.__NEXT_DATA__;
                        const pageProps = data?.props?.pageProps || data?.props || {};

                        // Look for thread/messages structure
                        const thread = pageProps?.thread || pageProps?.initialData?.thread || pageProps?.dehydratedState;
                        if (thread) {
                          const found = buildMessagesFromObj(thread);
                          if (found.length > 0) { done(found); return true; }
                        }

                        // Fallback: search all of __NEXT_DATA__
                        const found = buildMessagesFromObj(data);
                        if (found.length > 0) { done(found); return true; }
                      } catch (_) {}
                    }

                    // Strategy 2: data-testid selectors
                    const queryEls  = document.querySelectorAll('[data-testid="query-text"], [data-testid="user-query"], [class*="UserQuery"], [class*="user-query"]');
                    const answerEls = document.querySelectorAll('[data-testid="answer-text"], [data-testid="ai-answer"], [class*="Answer"], [class*="answer"]');

                    if (queryEls.length > 0 || answerEls.length > 0) {
                      const allTurns = [];
                      queryEls.forEach(el => allTurns.push({ el, role: 'user' }));
                      answerEls.forEach(el => allTurns.push({ el, role: 'assistant' }));
                      sortByDomOrder(allTurns).forEach(({ el, role }) => {
                        const text = cleanText(el.textContent || '');
                        if (text) msgs.push({ role, content: text, content_html: el.innerHTML || text });
                      });
                    }

                    // Strategy 3: Perplexity question/answer DOM scan
                    if (msgs.length === 0) {
                      // Perplexity share pages: questions in headings/bold, answers in prose blocks
                      const questions = document.querySelectorAll('h1, h2, h3, [class*="query"], [class*="question"]');
                      const answers   = document.querySelectorAll('[class*="prose"], [class*="markdown"], [class*="answer"], [class*="response"]');

                      const allTurns = [];
                      questions.forEach(el => {
                        const text = cleanText(el.textContent || '');
                        if (text.length > 5 && text.length < 500) allTurns.push({ el, role: 'user' });
                      });
                      answers.forEach(el => {
                        const text = cleanText(el.textContent || '');
                        if (text.length > 20) allTurns.push({ el, role: 'assistant' });
                      });

                      sortByDomOrder(allTurns).forEach(({ el, role }) => {
                        const text = cleanText(el.textContent || '');
                        if (text) msgs.push({ role, content: text, content_html: el.innerHTML || text });
                      });
                    }

                    if (msgs.length > 0) { done(msgs); return true; }
                    return false;
                  };

                  // ══════════════════════════════════════════════════════════════
                  // DEEPSEEK  (chat.deepseek.com/share/...)
                  // ══════════════════════════════════════════════════════════════
                  const tryDeepSeekExtract = () => {
                    if (!isDeepSeek) return false;
                    const msgs = [];

                    // Strategy 1: React hydration globals
                    for (const key of ['__NEXT_DATA__', '__REACT_ROUTER_DATA__', '__INITIAL_STATE__']) {
                      if (window[key]) {
                        try {
                          const found = buildMessagesFromObj(window[key]);
                          if (found.length > 0) { done(found); return true; }
                        } catch (_) {}
                      }
                    }

                    // Strategy 2: DOM extraction — DeepSeek uses chat bubble structure
                    const userEls  = document.querySelectorAll('[class*="user-message"], [class*="human"], .fbb737a4, [data-role="user"]');
                    const botEls   = document.querySelectorAll('[class*="assistant-message"], [class*="bot-message"], [class*="ds-markdown"], [data-role="assistant"]');

                    if (userEls.length > 0 || botEls.length > 0) {
                      const allTurns = [];
                      userEls.forEach(el => allTurns.push({ el, role: 'user' }));
                      botEls.forEach(el => allTurns.push({ el, role: 'assistant' }));
                      sortByDomOrder(allTurns).forEach(({ el, role }) => {
                        const text = cleanText(el.textContent || '');
                        if (text) msgs.push({ role, content: text, content_html: el.innerHTML || text });
                      });
                    }

                    // Strategy 3: Generic class scan for DeepSeek
                    if (msgs.length === 0) {
                      document.querySelectorAll('[class*="message"], [class*="chat-message"]').forEach(el => {
                        const cls = (el.className || '').toLowerCase();
                        const isUser = cls.includes('user') || cls.includes('human');
                        const isBot  = cls.includes('assistant') || cls.includes('bot') || cls.includes('ai');
                        if (!isUser && !isBot) return;
                        const text = cleanText(el.textContent || '');
                        if (text.length > 5) msgs.push({ role: isUser ? 'user' : 'assistant', content: text, content_html: el.innerHTML || text });
                      });
                    }

                    if (msgs.length > 0) { done(msgs); return true; }
                    return false;
                  };

                  // ══════════════════════════════════════════════════════════════
                  // GEMINI  (gemini.google.com/share/...)
                  // ══════════════════════════════════════════════════════════════
                  const tryGeminiExtract = () => {
                    if (!isGemini) return false;
                    const msgs = [];

                    // Strategy 1: AF_initDataCallback script tags
                    try {
                      document.querySelectorAll('script').forEach(script => {
                        const text = script.textContent || '';
                        if (!text.includes('AF_initDataCallback')) return;
                        const matches = [...text.matchAll(/"(user|model)","([^"]{5,})"/g)];
                        matches.forEach(m => {
                          const role = m[1] === 'model' ? 'assistant' : 'user';
                          const content = m[2].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                          if (content.trim()) msgs.push({ role, content: content.trim(), content_html: content.trim() });
                        });
                      });
                    } catch (_) {}

                    if (msgs.length > 0) { done(msgs); return true; }

                    // Strategy 2: Gemini custom elements (user-query / model-response)
                    const userNodes  = document.querySelectorAll('user-query, .user-query, [data-turn-type="user"]');
                    const modelNodes = document.querySelectorAll('model-response, .model-response, [data-turn-type="model"]');

                    if (userNodes.length > 0 || modelNodes.length > 0) {
                      const allTurns = [];
                      userNodes.forEach(el => allTurns.push({ el, role: 'user' }));
                      modelNodes.forEach(el => allTurns.push({ el, role: 'assistant' }));
                      sortByDomOrder(allTurns).forEach(({ el, role }) => {
                        const text = cleanText(el.textContent || '');
                        if (text) msgs.push({ role, content: text, content_html: el.innerHTML || text });
                      });
                      if (msgs.length > 0) { done(msgs); return true; }
                    }

                    // Strategy 3: message-content / conversation-turn elements
                    document.querySelectorAll('message-content, .message-content, conversation-turn, .conversation-turn').forEach(el => {
                      const cls = (el.className || '').toLowerCase();
                      const tag = (el.tagName || '').toLowerCase();
                      let role = 'unknown';
                      if (cls.includes('user') || tag === 'user-query') role = 'user';
                      else if (cls.includes('model') || cls.includes('response') || tag === 'model-response') role = 'assistant';
                      const text = cleanText(el.textContent || '');
                      if (text.length > 5) msgs.push({ role, content: text, content_html: el.innerHTML || text });
                    });

                    if (msgs.length > 0) { done(msgs); return true; }
                    return false;
                  };

                  // ══════════════════════════════════════════════════════════════
                  // CHATGPT  (chatgpt.com/share/...)
                  // ══════════════════════════════════════════════════════════════
                  const tryChatGPTExtract = () => {
                    // window.__remixContext — current ChatGPT share format
                    if (window.__remixContext) {
                      try {
                        const found = buildMessagesFromObj(window.__remixContext);
                        if (found.length > 0) { done(found); return true; }
                      } catch (_) {}
                    }
                    // window.__NEXT_DATA__ — older ChatGPT format
                    if (window.__NEXT_DATA__) {
                      try {
                        const found = buildMessagesFromObj(window.__NEXT_DATA__);
                        if (found.length > 0) { done(found); return true; }
                      } catch (_) {}
                    }
                    // React Router globals
                    for (const key of ['__reactRouterDataStrategies', '__reactRouterContext', '__reactRouterManifest', 'remixContext']) {
                      if (window[key]) {
                        try {
                          const found = buildMessagesFromObj(window[key]);
                          if (found.length > 0) { done(found); return true; }
                        } catch (_) {}
                      }
                    }
                    return false;
                  };

                  // ══════════════════════════════════════════════════════════════
                  // UNIVERSAL DOM FALLBACK
                  // ══════════════════════════════════════════════════════════════
                  const universalDomFallback = () => {
                    const msgs = [];

                    // 1. data-message-author-role (ChatGPT)
                    document.querySelectorAll('[data-message-author-role]').forEach(el => {
                      const role = el.getAttribute('data-message-author-role');
                      if (role !== 'user' && role !== 'assistant') return;
                      const text = cleanText(el.textContent || '');
                      if (text) msgs.push({ role, content: text, content_html: el.innerHTML || text });
                    });
                    if (msgs.length > 0) return msgs;

                    // 2. Claude class selectors
                    document.querySelectorAll('.font-user-message, .font-claude-message, [data-testid="human-turn"], [data-testid="ai-turn"]').forEach(el => {
                      const cls = (el.className || '') + (el.getAttribute('data-testid') || '');
                      const isUser = cls.includes('user') || cls.includes('human');
                      const text = cleanText(el.textContent || '');
                      if (text) msgs.push({ role: isUser ? 'user' : 'assistant', content: text, content_html: el.innerHTML || text });
                    });
                    if (msgs.length > 0) return msgs;

                    // 3. Gemini custom elements
                    const geminiTurns = [];
                    document.querySelectorAll('user-query, model-response').forEach(el => {
                      const tag = el.tagName.toLowerCase();
                      const text = cleanText(el.textContent || '');
                      if (text) geminiTurns.push({ el, role: tag === 'user-query' ? 'user' : 'assistant' });
                    });
                    if (geminiTurns.length > 0) {
                      sortByDomOrder(geminiTurns).forEach(({ el, role }) => {
                        const text = cleanText(el.textContent || '');
                        if (text) msgs.push({ role, content: text, content_html: el.innerHTML || text });
                      });
                      return msgs;
                    }

                    // 4. Broad class-based scan as last resort
                    const broadNodes = document.querySelectorAll('[class*="message"], [class*="bubble"], [class*="turn"], article');
                    const seen = new Set();
                    const broad = [];
                    broadNodes.forEach(el => {
                      const text = cleanText(el.textContent || '');
                      const key = text.substring(0, 80);
                      if (text.length > 10 && !seen.has(key)) {
                        seen.add(key);
                        const cls = (el.className || '').toLowerCase();
                        const isUser = cls.includes('user') || cls.includes('human') || cls.includes('query');
                        const isBot  = cls.includes('assistant') || cls.includes('model') || cls.includes('response') || cls.includes('bot') || cls.includes('ai');
                        broad.push({ role: isUser ? 'user' : isBot ? 'assistant' : 'unknown', content: text, content_html: el.innerHTML || text });
                      }
                    });
                    if (broad.length > 0) return fixUnknownRoles(broad);

                    return msgs;
                  };

                  // ══════════════════════════════════════════════════════════════
                  // MAIN DISPATCH — try immediately, then poll
                  // ══════════════════════════════════════════════════════════════
                  const tryAll = () => {
                    if (isGemini     && tryGeminiExtract())     return true;
                    if (isClaude     && tryClaudeExtract())     return true;
                    if (isGrok       && tryGrokExtract())       return true;
                    if (isPerplexity && tryPerplexityExtract()) return true;
                    if (isDeepSeek   && tryDeepSeekExtract())   return true;
                    if (tryChatGPTExtract())                    return true;
                    return false;
                  };

                  if (tryAll()) return;

                  let attempts = 0;
                  const poll = setInterval(() => {
                    attempts++;
                    if (tryAll() || attempts >= 24) {
                      clearInterval(poll);
                      if (attempts >= 24) {
                        const msgs = universalDomFallback();
                        resolve({ success: msgs.length > 0, title, messages: dedupe(msgs) });
                      }
                    }
                  }, 500);

                });
              }
            }, (results) => {
              chrome.tabs.remove(tabId);
              const payload = results?.[0]?.result || null;
              if (payload?.success && payload?.messages?.length > 0) {
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
