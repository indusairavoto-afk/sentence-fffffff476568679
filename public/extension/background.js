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
                  // Step 1: Wait for initial content to appear
                  let checks = 0;
                  const maxChecks = 30;

                  const waitForContent = setInterval(() => {
                    checks++;
                    const hasMessages = document.querySelectorAll(
                      'article, [data-message-author-role], .prose, .markdown'
                    ).length > 0;
                    const hasRemix = document.documentElement.innerHTML.includes('__remixContext');

                    if ((hasMessages || hasRemix) || checks >= maxChecks) {
                      clearInterval(waitForContent);

                      // Step 2: Scroll to top first, then scroll down gradually
                      // to force all lazy-rendered messages into the DOM
                      window.scrollTo({ top: 0, behavior: 'instant' });

                      setTimeout(() => {
                        const scrollStep = async () => {
                          return new Promise((scrollDone) => {
                            const scrollContainer =
                              document.querySelector('[data-testid="conversation-turns-list"]') ||
                              document.querySelector('main') ||
                              document.scrollingElement ||
                              document.documentElement;

                            const totalHeight = Math.max(
                              document.body.scrollHeight,
                              scrollContainer.scrollHeight
                            );

                            let currentPos = 0;
                            const stepSize = 600;
                            const stepDelay = 180;

                            const doScroll = () => {
                              currentPos += stepSize;
                              window.scrollTo({ top: currentPos, behavior: 'instant' });

                              if (currentPos < totalHeight + stepSize) {
                                setTimeout(doScroll, stepDelay);
                              } else {
                                // Reached bottom — scroll back to top then capture
                                setTimeout(() => {
                                  window.scrollTo({ top: 0, behavior: 'instant' });
                                  setTimeout(() => scrollDone(), 600);
                                }, 400);
                              }
                            };

                            doScroll();
                          });
                        };

                        scrollStep().then(() => {
                          resolve(document.documentElement.outerHTML);
                        });
                      }, 800);
                    }
                  }, 500);
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
