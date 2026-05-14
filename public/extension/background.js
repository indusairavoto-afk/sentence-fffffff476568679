chrome.runtime.onMessageExternal.addListener(
  (request, sender, sendResponse) => {
    if (request.action === 'fetch_html' && request.url) {
      console.log('Received request to fetch:', request.url);
      
      // Open tab in background
      chrome.tabs.create({ url: request.url, active: false }, (tab) => {
        const tabId = tab.id;
        
        const listener = (updatedTabId, info) => {
          if (updatedTabId === tabId && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            
            // Inject script to poll for content to render instead of blind wait
            chrome.scripting.executeScript({
              target: { tabId: tabId },
              func: () => {
                return new Promise((resolve) => {
                  let checks = 0;
                  const maxChecks = 20; // 10 seconds (500ms * 20)
                  
                  const interval = setInterval(() => {
                    checks++;
                    // Typical ChatGPT message selectors or Remix context
                    const hasMessages = document.querySelectorAll('article, [data-message-author-role], .prose, .markdown').length > 0;
                    const hasRemix = document.documentElement.innerHTML.includes('__remixContext');
                    
                    // If content seems to be rendered, or we timed out
                    if ((hasMessages || hasRemix) && checks > 2) { // Wait at least 1s after finding it
                      clearInterval(interval);
                      setTimeout(() => resolve(document.documentElement.outerHTML), 1000);
                    } else if (checks >= maxChecks) {
                      clearInterval(interval);
                      resolve(document.documentElement.outerHTML);
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
      
      // Return true to indicate we will send a response asynchronously
      return true;
    }
  }
);
