document.addEventListener('DOMContentLoaded', () => {
  const authBtn = document.getElementById("authBtn");
  const signOutBtn = document.getElementById("signOutBtn");
  const authSection = document.getElementById("authSection");
  const statusEl = document.getElementById("status");
  const themeSelect = document.getElementById("themeSelect");
  const autofocusToggle = document.getElementById("autofocusToggle");
  const pastDaysInput = document.getElementById("pastDaysInput");

  // Load settings
  chrome.storage.local.get(["calistToken", "tokenExpiry", "theme", "autofocus", "maxPastDays"], (res) => {
    authSection.style.display = "block";
    if (res.calistToken && res.tokenExpiry && res.tokenExpiry > Date.now()) {
      statusEl.textContent = "Connected to Google Calendar.";
      authBtn.style.display = "none";
      signOutBtn.style.display = "block";
    } else {
      statusEl.textContent = "Please connect to Google Calendar.";
      authBtn.style.display = "block";
      signOutBtn.style.display = "none";
    }

    if (res.theme) themeSelect.value = res.theme;
    if (res.autofocus !== undefined) autofocusToggle.checked = res.autofocus;
    if (res.maxPastDays !== undefined) pastDaysInput.value = res.maxPastDays;
    
    applyTheme(themeSelect.value);
  });

  // Theme logic
  function applyTheme(theme) {
    if (theme === 'system') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.body.className = isDark ? 'theme-dark' : 'theme-light';
      chrome.runtime.sendMessage({ action: "updateIcon", isDark: isDark }).catch(() => {});
    } else {
      document.body.className = 'theme-' + theme;
      chrome.runtime.sendMessage({ action: "updateIcon", isDark: theme === 'dark' }).catch(() => {});
    }
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (themeSelect.value === 'system') applyTheme('system');
  });

  // Save settings on change
  themeSelect.addEventListener('change', (e) => {
    chrome.storage.local.set({ theme: e.target.value });
    applyTheme(e.target.value);
  });
  
  autofocusToggle.addEventListener('change', (e) => {
    chrome.storage.local.set({ autofocus: e.target.checked });
  });

  pastDaysInput.addEventListener('change', (e) => {
    chrome.storage.local.set({ maxPastDays: parseInt(e.target.value) || 0 });
  });

  // Auth
  authBtn.addEventListener("click", () => {
    authBtn.disabled = true;
    authBtn.textContent = "Connecting...";
    
    chrome.runtime.sendMessage({ action: "authenticate" }, (response) => {
      if (chrome.runtime.lastError || !response || !response.success) {
        const errorMsg = chrome.runtime.lastError?.message || response?.error || "Unknown error";
        statusEl.textContent = "Error: " + errorMsg;
        statusEl.style.color = "var(--gm3-sys-color-error, #d93025)";
        authBtn.disabled = false;
        authBtn.textContent = "Try Again";
      } else {
        statusEl.textContent = "Connected successfully!";
        statusEl.style.color = "var(--gm3-sys-color-tertiary, #188038)";
        authBtn.style.display = "none";
        signOutBtn.style.display = "block";
      }
    });
  });

  signOutBtn.addEventListener("click", () => {
    signOutBtn.disabled = true;
    signOutBtn.textContent = "Signing out...";
    
    chrome.runtime.sendMessage({ action: "signOut" }, (response) => {
      statusEl.textContent = "Signed out. You can now connect a different account.";
      statusEl.style.color = "var(--text)";
      authBtn.style.display = "block";
      signOutBtn.style.display = "none";
      signOutBtn.disabled = false;
      signOutBtn.textContent = "Sign Out / Switch Account";
      authBtn.textContent = "Connect Google Calendar";
      authBtn.disabled = false;
    });
  });

  // Tutorial Modal
  const tutorialBtn = document.getElementById("tutorialBtn");

  tutorialBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "open_tutorial" });
        window.close(); // Close the extension popup
      }
    });
  });
});
