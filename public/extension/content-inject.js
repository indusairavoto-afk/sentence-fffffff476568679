// Inject into the page so the webapp knows the extension is installed
window.postMessage({ type: 'BRIDGE_EXT_INSTALLED', extensionId: chrome.runtime.id }, '*');

// Also listen for pings from the page just in case
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'BRIDGE_EXT_PING') {
    window.postMessage({ type: 'BRIDGE_EXT_INSTALLED', extensionId: chrome.runtime.id }, '*');
  }
});
