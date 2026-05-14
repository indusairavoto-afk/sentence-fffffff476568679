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
              func: () => {
                return new Promise((resolve) => {

                  // ── Phase 1: Wait for framework hydration ──────────────────
                  let bootChecks = 0;
                  const bootInterval = setInterval(() => {
                    bootChecks++;
                    const hasRemix    = document.documentElement.innerHTML.includes('__remixContext');
                    const hasMessages = document.querySelectorAll(
                      '[data-message-author-role], article, .prose, .markdown'
                    ).length > 0;

                    if (hasRemix || hasMessages || bootChecks >= 30) {
                      clearInterval(bootInterval);
                      scrollToTopAndWait();
                    }
                  }, 500);

                  // ── Phase 2: Scroll to absolute top & wait for first
                  //    message to mount via MutationObserver ────────────────
                  function scrollToTopAndWait() {
                    window.scrollTo({ top: 0, behavior: 'instant' });

                    // Fight ChatGPT's auto-scroll for 1.5 s
                    let topLockCount = 0;
                    const topLockInterval = setInterval(() => {
                      window.scrollTo({ top: 0, behavior: 'instant' });
                      if (++topLockCount >= 6) clearInterval(topLockInterval);
                    }, 250);

                    let topMessageSeen = false;
                    const observer = new MutationObserver(() => {
                      const firstMsg = document.querySelector('[data-message-author-role]');
                      if (firstMsg && !topMessageSeen) {
                        topMessageSeen = true;
                        setTimeout(() => { observer.disconnect(); doFullScrollSweep(); }, 1500);
                      }
                    });
                    observer.observe(document.body, { childList: true, subtree: true });

                    // Safety fallback
                    setTimeout(() => {
                      if (!topMessageSeen) {
                        topMessageSeen = true;
                        observer.disconnect();
                        doFullScrollSweep();
                      }
                    }, 5000);
                  }

                  // ── Phase 3: Scroll top → bottom to force-render all msgs ──
                  function doFullScrollSweep() {
                    window.scrollTo({ top: 0, behavior: 'instant' });

                    setTimeout(() => {
                      let currentPos = 0;
                      const stepSize  = 500;
                      const stepDelay = 200;

                      const doScroll = () => {
                        currentPos += stepSize;
                        window.scrollTo({ top: currentPos, behavior: 'instant' });

                        const newHeight = Math.max(
                          document.body.scrollHeight,
                          document.documentElement.scrollHeight
                        );

                        if (currentPos < newHeight) {
                          setTimeout(doScroll, stepDelay);
                        } else {
                          // ── Phase 4: Extract structured messages from DOM ──
                          // This replaces sending raw outerHTML (which can be
                          // 5-20 MB) with a compact JSON array of just the
                          // message content — drastically reducing payload size
                          // and eliminating Chrome extension message limits.
                          setTimeout(() => extractMessages(), 600);
                        }
                      };

                      doScroll();
                    }, 300);
                  }

                  // ── Phase 4: Structured message extraction ─────────────────
                  function extractMessages() {
                    const title = document.title ||
                      document.querySelector('title')?.textContent ||
                      'ChatGPT Chat';

                    const messages = [];
                    const REMOVE_SELECTORS = 'button, [aria-label], svg, [data-testid*="action"], [class*="btn"], [class*="button"], form';

                    // ChatGPT share pages use TWO different DOM layouts:
                    // - The very first message block sits in a special wrapper
                    //   that does NOT carry [data-message-author-role] directly
                    // - The remaining messages use the standard layout
                    // Selecting the outer "group w-full" wrappers first, then
                    // finding the role attribute inside, captures BOTH layouts.
                    const wrappers = document.querySelectorAll(
                      'main div[class*="group"][class*="w-full"], ' +
                      'main article, ' +
                      'main [data-testid*="conversation-turn"]'
                    );

                    // Fallback: if wrapper approach yields nothing, use direct selector
                    const nodes = wrappers.length > 0
                      ? wrappers
                      : document.querySelectorAll('[data-message-author-role]');

                    nodes.forEach(node => {
                      // Find the role — either on this node or inside it
                      const roleEl = node.getAttribute('data-message-author-role')
                        ? node
                        : node.querySelector('[data-message-author-role]');
                      if (!roleEl) return;

                      const role = roleEl.getAttribute('data-message-author-role');
                      if (role !== 'user' && role !== 'assistant') return;

                      // Find the best content container
                      let target;
                      if (role === 'user') {
                        target = node.querySelector('[data-message-text-content="true"]') ||
                                 node.querySelector('.whitespace-pre-wrap') ||
                                 node.querySelector('[class*="user-message"]') ||
                                 node;
                      } else {
                        target = node.querySelector('.markdown') ||
                                 node.querySelector('[class*="prose"]') ||
                                 node;
                      }

                      // Clone and strip UI chrome (buttons, icons, etc.)
                      const clone = target.cloneNode(true);
                      clone.querySelectorAll(REMOVE_SELECTORS).forEach(n => n.remove());

                      const text = (clone.textContent || '').trim();
                      const html = (clone.innerHTML  || '').trim();

                      if (text.length > 0) {
                        messages.push({ role, content: text, content_html: html });
                      }
                    });

                    // Deduplicate adjacent identical messages (can happen when
                    // both wrapper selectors match the same node)
                    const deduped = messages.filter((msg, i) => {
                      if (i === 0) return true;
                      const prev = messages[i - 1];
                      return msg.content.trim() !== prev.content.trim() || msg.role !== prev.role;
                    });

                    resolve({ success: true, title, messages: deduped });
                  }

                });
              }
            }, (results) => {
              let payload = null;
              if (results && results[0] && results[0].result) {
                payload = results[0].result;
              }

              chrome.tabs.remove(tabId);

              if (payload && payload.success && payload.messages) {
                sendResponse(payload);           // { success, title, messages }
              } else {
                sendResponse({ success: false }); // signal failure gracefully
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
