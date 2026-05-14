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

                  // ── Phase 1: Wait for the JS framework to hydrate ──────────
                  // ChatGPT share pages boot a React/Remix app. We wait until
                  // __remixContext appears OR any message node is in the DOM,
                  // giving up after 15 s.
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

                  // ── Phase 2: Scroll to absolute top, then wait for the
                  //    very first message to mount via MutationObserver ────────
                  // ChatGPT auto-scrolls the page to the middle on load, which
                  // means top messages are not yet in the DOM. Scrolling to top
                  // triggers the intersection observer that mounts them.
                  function scrollToTopAndWait() {
                    // Interrupt ChatGPT's own scroll and pin the page at 0
                    window.scrollTo({ top: 0, behavior: 'instant' });

                    // Keep fighting any programmatic scroll for 1.5 s
                    let topLockCount = 0;
                    const topLockInterval = setInterval(() => {
                      window.scrollTo({ top: 0, behavior: 'instant' });
                      topLockCount++;
                      if (topLockCount >= 6) clearInterval(topLockInterval); // 6 × 250 ms = 1.5 s
                    }, 250);

                    // Use a MutationObserver to detect when the first assistant
                    // message renders into the DOM (the one that was off-screen)
                    let topMessageSeen = false;

                    const observer = new MutationObserver(() => {
                      const firstMsg = document.querySelector('[data-message-author-role]');
                      if (firstMsg && !topMessageSeen) {
                        topMessageSeen = true;
                        // Give React one more tick to finish painting siblings
                        setTimeout(() => {
                          observer.disconnect();
                          doFullScrollSweep();
                        }, 1500);
                      }
                    });

                    observer.observe(document.body, { childList: true, subtree: true });

                    // Safety fallback: if observer never fires within 5 s, proceed anyway
                    setTimeout(() => {
                      if (!topMessageSeen) {
                        topMessageSeen = true;
                        observer.disconnect();
                        doFullScrollSweep();
                      }
                    }, 5000);
                  }

                  // ── Phase 3: Scroll from top → bottom in small steps ──────
                  // Each step forces ChatGPT's virtual-scroll engine to render
                  // the next batch of messages into the DOM.
                  function doFullScrollSweep() {
                    window.scrollTo({ top: 0, behavior: 'instant' });

                    // Measure total scrollable height after a brief settle
                    setTimeout(() => {
                      const totalHeight = Math.max(
                        document.body.scrollHeight,
                        document.documentElement.scrollHeight
                      );

                      let currentPos = 0;
                      const stepSize  = 500;   // px per step
                      const stepDelay = 200;   // ms between steps — slow enough for React to render

                      const doScroll = () => {
                        currentPos += stepSize;
                        window.scrollTo({ top: currentPos, behavior: 'instant' });

                        // Re-measure height as new messages render and push the page taller
                        const newHeight = Math.max(
                          document.body.scrollHeight,
                          document.documentElement.scrollHeight
                        );

                        if (currentPos < newHeight) {
                          setTimeout(doScroll, stepDelay);
                        } else {
                          // Reached the bottom — brief pause then capture
                          setTimeout(() => {
                            resolve(document.documentElement.outerHTML);
                          }, 600);
                        }
                      };

                      doScroll();
                    }, 300);
                  }

                });
              }
            }, (results) => {
              let html = null;
              if (results && results[0] && results[0].result) {
                html = results[0].result;
              }

              chrome.tabs.remove(tabId);
              sendResponse({ html: html, success: !!html });
            });
          }
        };

        chrome.tabs.onUpdated.addListener(listener);
      });

      return true;
    }
  }
);
