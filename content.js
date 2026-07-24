function waitForElement(xpath) {
  return new Promise((resolve) => {
    const el = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (el) {
      return resolve(el);
    }

    const observer = new MutationObserver((mutations) => {
      const el = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  });
}

function showToast(message, isError = false) {
  let toastContainer = document.getElementById("calist-toast-container");
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.id = "calist-toast-container";
    Object.assign(toastContainer.style, {
      position: "fixed",
      bottom: "24px",
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: "9999",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      alignItems: "center",
    });
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement("div");
  Object.assign(toast.style, {
    backgroundColor: isError ? "var(--gm3-sys-color-error-container, #f9dedc)" : "var(--gm3-sys-color-inverse-surface, #313033)",
    color: isError ? "var(--gm3-sys-color-on-error-container, #410e0b)" : "var(--gm3-sys-color-inverse-on-surface, #f4eff4)",
    padding: "14px 24px",
    borderRadius: "8px",
    fontFamily: "'Google Sans Text', 'Google Sans', sans-serif",
    fontSize: "14px",
    boxShadow: "0px 4px 8px 3px rgba(0, 0, 0, 0.15), 0px 1px 3px rgba(0, 0, 0, 0.3)",
    opacity: "0",
    transform: "translateY(20px)",
    transition: "opacity 0.2s cubic-bezier(0.2, 0, 0, 1), transform 0.4s cubic-bezier(0.2, 0, 0, 1)",
    display: "flex",
    alignItems: "center",
  });
  
  toast.innerText = message;
  toastContainer.appendChild(toast);

  // Trigger reflow
  void toast.offsetWidth;

  toast.style.opacity = "1";
  toast.style.transform = "translateY(0)";

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(20px)";
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

async function init() {
  const targetXPath = '//*[@id="gb"]/div[2]/div[2]';
  const targetDiv = await waitForElement(targetXPath);

  // Create a container for the input and overlay
  const container = document.createElement("div");
  Object.assign(container.style, {
    position: "relative",
    width: "100%",
    flex: "1",
    height: "36px", // Reduced height for a sleeker look
    margin: "0 8px",
    display: "flex",
    alignItems: "center"
  });

  // Inject a stylesheet to aggressively hide the native placeholder
  // and prevent browser defaults for disabled inputs
  const style = document.createElement("style");
  style.textContent = `
    #calist-input::placeholder {
      color: transparent !important;
    }
    #calist-input:disabled {
      color: transparent !important;
      background-color: transparent !important;
    }
  `;
  document.head.appendChild(style);

  // The background layer that displays the highlighted text
  const highlightLayer = document.createElement("div");
  Object.assign(highlightLayer.style, {
    position: "absolute",
    inset: "0",
    padding: "0 24px",
    boxSizing: "border-box",
    border: "1px solid var(--gm3-sys-color-outline, #747775)",
    borderRadius: "18px",
    fontSize: "0.875rem",
    fontFamily: "'Google Sans Text', 'Google Sans', sans-serif",
    fontStyle: "normal",
    fontWeight: "normal",
    WebkitFontSmoothing: "antialiased", // Fixes bold/blurry font rendering
    MozOsxFontSmoothing: "grayscale",
    color: "var(--gm3-sys-color-on-surface, #e3e3e3)",
    whiteSpace: "pre", // Preserve spaces for exact alignment
    overflow: "hidden",
    pointerEvents: "none", // Let clicks pass through to the input
    lineHeight: "34px", // Vertically centers text without collapsing spaces like flexbox does
    transition: "background-color 0.15s, border-color 0.15s",
  });

  // The actual input field
  const inputField = document.createElement("input");
  inputField.type = "text";
  inputField.id = "calist-input";
  Object.assign(inputField.style, {
    position: "absolute",
    inset: "0",
    padding: "0 24px",
    boxSizing: "border-box",
    border: "2px solid transparent", // Keep transparent so highlightLayer's border shows
    borderRadius: "18px",
    backgroundColor: "transparent",
    color: "transparent", // Hide the native text
    caretColor: "var(--gm3-sys-color-on-surface, #e3e3e3)", // But show the cursor!
    fontSize: "0.875rem",
    fontFamily: "'Google Sans Text', 'Google Sans', sans-serif",
    fontStyle: "normal",
    fontWeight: "normal",
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
    outline: "none",
    margin: "0",
    width: "100%",
    height: "100%",
  });

  // Fetch calendar colors for dynamic syntax highlighting
  let calendarColors = {};
  
  const updateHighlight = () => {
    const text = inputField.value;
    if (!text) {
      highlightLayer.innerHTML = `<span style="color: var(--gm3-sys-color-on-surface-variant, #c4c7c5); font-style: normal; font-weight: normal;">${inputField.placeholder || 'Type event...'}</span>`;
      return;
    }
    
    // Escape HTML to prevent XSS
    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
      
    let tokens = {};
    let tokenCounter = 0;
    
    function tokenize(match, colorInfo) {
        const tokenId = `__TOKEN_${tokenCounter++}__`;
        tokens[tokenId] = `<span style="color: ${colorInfo.color}; background-color: ${colorInfo.bg}; border-radius: 4px; padding: 0;">${match}</span>`;
        return tokenId;
    }

    // Highlight Projects (#hashtag) dynamically using real calendar colors
    html = html.replace(/(#\w+)/g, (match, p1) => {
      const calName = p1.substring(1).toLowerCase();
      // Default to Google Blue if calendar not found
      const hexColor = calendarColors[calName] || "#a8c7fa"; 
      // Add 20 opacity (roughly 12%) via hex code append
      const bgHex = hexColor + "20"; 
      return tokenize(match, { color: hexColor, bg: bgHex });
    });
    
    // Highlight Time words (Google Yellow)
    const timePatterns = [
      "\\d{1,2}:\\d{2}", "\\d{1,2}\\s*(?:am|pm)", "(?:[01]\\d|2[0-3])[0-5]\\d"
    ].join("|");
    html = html.replace(new RegExp(`\\b(${timePatterns})(?=\\b|\\s|\\.|$)`, "gi"), (match) => 
        tokenize(match, { color: "#f29900", bg: "rgba(242, 153, 0, 0.12)" })
    );

    // Highlight Duration words combined (e.g. 1 hour 15 min) (Light Purple)
    const durationPattern = `(?:for\\s+)?(?:\\d+(?:\\.\\d+)?\\s*h(?:ou)?r?s?(?:\\s*\\d+\\s*m(?:in)?(?:ute)?s?)?|\\d+\\s*m(?:in)?(?:ute)?s?)`;
    html = html.replace(new RegExp(`\\b(${durationPattern})(?=\\b|\\s|\\.|$)`, "gi"), (match) => 
        tokenize(match, { color: "#eaddff", bg: "rgba(234, 221, 255, 0.12)" })
    );

    // Highlight Date and Recurrence words (Green)
    const datePatterns = [
      "tomorrow", "tommorow", "today", "every\\s+\\w+", 
      "(?:next\\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)",
      "\\d{1,2}[\\./]\\d{1,2}(?:[\\./]\\d{2,4})?\\.?",
      "\\d{1,2}(?:st|nd|rd|th)?\\s*(?:of\\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*",
      "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\s+\\d{1,2}(?:st|nd|rd|th)?"
    ].join("|");
    html = html.replace(new RegExp(`\\b(${datePatterns})(?=\\b|\\s|\\.|$)`, "gi"), (match) => 
        tokenize(match, { color: "var(--gm3-sys-color-tertiary, #6dd58c)", bg: "rgba(109, 213, 140, 0.12)" })
    );
    
    // Highlight Scope words (Google Blue)
    html = html.replace(/\b(all|future|forward)\b/gi, (match) => 
        tokenize(match, { color: "var(--gm3-sys-color-primary, #a8c7fa)", bg: "rgba(168, 199, 250, 0.12)" })
    );

    // Highlight Action words (Red)
    html = html.replace(/\b(delete|remove|move|reschedule|undo|reverse|scale|plus|minus|add|subtract)\b/gi, (match) => 
        tokenize(match, { color: "var(--gm3-sys-color-error, #f2b8b5)", bg: "rgba(242, 184, 181, 0.12)" })
    );
    
    // Restore tokens
    for (const [tokenId, tagHtml] of Object.entries(tokens)) {
        html = html.replace(tokenId, tagHtml);
    }
    
    highlightLayer.innerHTML = html;
  };
  
  chrome.runtime.sendMessage({ action: "getCalendars" }, (response) => {
    if (response && response.success && response.calendars) {
      calendarColors = response.calendars;
      updateHighlight();
    }
  });

  // Sync scrolling if text overflows
  inputField.addEventListener("scroll", () => {
    highlightLayer.scrollLeft = inputField.scrollLeft;
  });



  inputField.addEventListener("input", updateHighlight);
  
  // Initial render
  updateHighlight();
  
  // Check autofocus setting
  chrome.storage.local.get(["autofocus"], (res) => {
    if (res.autofocus !== false) {
      inputField.focus();
    }
  });
  
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.autofocus && changes.autofocus.newValue) {
      inputField.focus();
    }
  });

  // Interactive focus and hover states mirroring GM3
  inputField.addEventListener("focus", () => {
    highlightLayer.style.border = "2px solid var(--gm3-sys-color-on-surface, #ffffff)";
    highlightLayer.style.padding = "0 23px"; // compensate for +1px border
    highlightLayer.style.backgroundColor = "transparent";
  });
  
  inputField.addEventListener("blur", () => {
    highlightLayer.style.border = "1px solid var(--gm3-sys-color-outline, #747775)";
    highlightLayer.style.padding = "0 24px";
    highlightLayer.style.backgroundColor = "transparent";
  });

  inputField.addEventListener("mouseenter", () => {
    if (document.activeElement !== inputField) {
      highlightLayer.style.backgroundColor = "rgba(227, 227, 227, 0.08)";
    }
  });

  inputField.addEventListener("mouseleave", () => {
    if (document.activeElement !== inputField) {
      highlightLayer.style.backgroundColor = "transparent";
    }
  });

  let commandHistory = [];
  let historyIndex = -1;
  let currentDraft = "";
  chrome.storage.local.get(["commandHistory"], (res) => {
    if (res.commandHistory) commandHistory = res.commandHistory;
  });

  inputField.addEventListener("keydown", function (e) {
    if (e.key === "ArrowUp") {
      if (historyIndex === -1) {
        currentDraft = inputField.value;
      }
      if (historyIndex < commandHistory.length - 1) {
        historyIndex++;
        inputField.value = commandHistory[commandHistory.length - 1 - historyIndex];
        updateHighlight();
        e.preventDefault();
      }
    } else if (e.key === "ArrowDown") {
      if (historyIndex > 0) {
        historyIndex--;
        inputField.value = commandHistory[commandHistory.length - 1 - historyIndex];
        updateHighlight();
        e.preventDefault();
      } else if (historyIndex === 0) {
        historyIndex = -1;
        inputField.value = currentDraft;
        updateHighlight();
        e.preventDefault();
      }
    }
  });

  inputField.addEventListener("keypress", function (e) {
    if (e.key === "Enter") {
      try {
        const inputText = e.target.value;
        if (!inputText.trim()) return;

        if (commandHistory.length === 0 || commandHistory[commandHistory.length - 1] !== inputText) {
          commandHistory.push(inputText);
          if (commandHistory.length > 50) commandHistory.shift();
          chrome.storage.local.set({ commandHistory: commandHistory });
        }
        historyIndex = -1;
        currentDraft = "";

        // Do not disable input; clear it so user can keep typing immediately
        inputField.value = "";
        inputField.placeholder = "Type event..."; // Keep normal placeholder
        updateHighlight();
        
        chrome.runtime.sendMessage({ action: "processCommand", text: inputText }, (response) => {
          if (chrome.runtime.lastError || !response || !response.success) {
            const errorMsg = chrome.runtime.lastError?.message || response?.error || "Unknown error";
            showToast(errorMsg, true);
          }
        });
      } catch (err) {
        if (err.message && err.message.includes("Extension context invalidated")) {
          showToast("Extension updated! Please refresh the page to continue.", true);
        } else {
          console.error("Calist error:", err);
        }
      }
    }
  });

  container.appendChild(highlightLayer);
  container.appendChild(inputField);

  // Optimistic UI State Cache
  const optimisticStates = {};

  function recalculateColumnLayout(columnEl, opId) {
      if (!columnEl) return;
      const rawEvents = Array.from(columnEl.querySelectorAll('div[data-eventchip], div[data-eventid]'))
          .filter(e => !e.className.includes("VfPpkd") && !e.closest('header') && e.style.display !== 'none');
          
      // Filter out descendants so we only process top-level event blocks
      const events = rawEvents.filter(e => {
          let p = e.parentElement;
          while (p && p !== columnEl) {
              if (rawEvents.includes(p)) return false;
              p = p.parentElement;
          }
          return true;
      });
      
      const parsed = events.map(el => {
          const top = parseFloat(el.style.top) || 0;
          const height = parseFloat(el.style.height) || 0;
          return { el, start: top, end: top + height };
      });
      
      let groups = [];
      let currentGroup = [];
      let currentGroupEnd = -1;
      
      parsed.sort((a, b) => a.start - b.start).forEach(ev => {
          if (currentGroup.length === 0) {
              currentGroup.push(ev);
              currentGroupEnd = ev.end;
          } else {
              if (ev.start < currentGroupEnd - 2) {
                  currentGroup.push(ev);
                  currentGroupEnd = Math.max(currentGroupEnd, ev.end);
              } else {
                  groups.push(currentGroup);
                  currentGroup = [ev];
                  currentGroupEnd = ev.end;
              }
          }
      });
      if (currentGroup.length > 0) groups.push(currentGroup);
      
      groups.forEach(group => {
          let columns = [];
          group.forEach(ev => {
              let placed = false;
              for (let i = 0; i < columns.length; i++) {
                  const colLast = columns[i][columns[i].length - 1];
                  if (ev.start >= colLast.end) {
                      columns[i].push(ev);
                      ev.colIndex = i;
                      placed = true;
                      break;
                  }
              }
              if (!placed) {
                  ev.colIndex = columns.length;
                  columns.push([ev]);
              }
          });
          
          const numCols = columns.length;
          group.forEach(ev => {
              if (optimisticStates[opId]) {
                  const alreadySaved = optimisticStates[opId].some(s => s.element === ev.el);
                  if (!alreadySaved) {
                      optimisticStates[opId].push({
                          element: ev.el,
                          width: ev.el.style.width,
                          left: ev.el.style.left
                      });
                  }
              }
              
              const isOptimistic = optimisticStates[opId] && optimisticStates[opId].some(s => s.element === ev.el && s.isCreate);
              if (isOptimistic) {
                  ev.el.style.width = `calc(${100 / numCols}% - 14px)`;
                  ev.el.style.left = `calc(${(100 / numCols) * ev.colIndex}% + 2px)`;
              } else {
                  ev.el.style.width = `${100 / numCols}%`;
                  ev.el.style.left = `${(100 / numCols) * ev.colIndex}%`;
              }
          });
      });
  }

  // Optimistic UI Listener
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
     if (msg.type === "commitOptimisticUpdate" && msg.opId) {
         if (optimisticStates[msg.opId]) {
             optimisticStates[msg.opId].forEach(state => {
                 if (!state.isCreate) {
                     if (state.width !== undefined) state.element.style.width = state.width;
                     if (state.left !== undefined) state.element.style.left = state.left;
                 }
             });
             delete optimisticStates[msg.opId];
         }
         return;
     }

     if (msg.type === "revertOptimisticUpdate" && msg.opId && optimisticStates[msg.opId]) {
         const states = optimisticStates[msg.opId];
         states.forEach(state => {
             if (state.isCreate) {
                 state.element.remove();
                 return;
             }
             if (state.originalParent && state.element.parentElement !== state.originalParent) {
                 state.originalParent.appendChild(state.element);
             }
             if (state.display !== undefined) state.element.style.display = state.display;
             if (state.opacity !== undefined) state.element.style.opacity = state.opacity;
             if (state.height !== undefined) state.element.style.height = state.height;
             if (state.top !== undefined) state.element.style.top = state.top;
             if (state.transition !== undefined) state.element.style.transition = state.transition;
             if (state.width !== undefined) state.element.style.width = state.width;
             if (state.left !== undefined) state.element.style.left = state.left;
             if (state.dataEventId !== undefined) {
                 state.element.setAttribute('data-eventid', state.dataEventId);
             }
             const timeSpan = state.element.querySelector('.gVNoLb');
             if (timeSpan && state.timeText !== undefined) {
                 timeSpan.textContent = state.timeText;
             }
         });
         delete optimisticStates[msg.opId];
         return;
     }
      
     if (msg.type === "optimisticUpdate") {
         let pixelsPerHour = 60;
         const anyColumn = document.querySelector('div[role="gridcell"][data-datekey]');
         if (anyColumn && anyColumn.offsetHeight) {
             pixelsPerHour = anyColumn.offsetHeight / 24;
         }
         
         if (msg.action === "create" && msg.newStart && msg.newEnd && msg.title) {
             const startDate = new Date(msg.newStart);
             const endDate = new Date(msg.newEnd);
             
             const mainColumns = Array.from(document.querySelectorAll('div[data-datekey]')).filter(el => el.getAttribute('role') === 'gridcell' || el.clientHeight > 150);
             
             const targetDateStr = startDate.getDate().toString();
             const dayButtons = Array.from(document.querySelectorAll('button[data-datekey]'));
             const targetButton = dayButtons.find(btn => {
                 if (btn.textContent.trim() === targetDateStr) return true;
                 const spans = Array.from(btn.querySelectorAll('*'));
                 return spans.some(s => s.textContent.trim() === targetDateStr && s.children.length === 0);
             });
             
             let targetColumn = null;
             let targetDatekey = null;
             if (targetButton) {
                 targetDatekey = targetButton.getAttribute('data-datekey');
                 targetColumn = document.querySelector(`div[role="gridcell"][data-datekey="${targetDatekey}"]`);
             }
             if (!targetColumn && mainColumns.length > 0) {
                 targetColumn = mainColumns[0];
                 targetDatekey = targetColumn.getAttribute('data-datekey');
             }

             if (targetColumn && targetDatekey) {
                 const targetKeyNum = parseInt(targetDatekey);
                 let instances = [];
                     
                     if (msg.recurrence && msg.recurrence.includes("FREQ=HOURLY")) {
                         for (const col of mainColumns) {
                             const colKeyNum = parseInt(col.getAttribute('data-datekey'));
                             if (colKeyNum >= targetKeyNum) {
                                 let diff = colKeyNum - targetKeyNum;
                                 let curS = new Date(startDate); curS.setDate(curS.getDate() + diff);
                                 let curE = new Date(endDate); curE.setDate(curE.getDate() + diff);
                                 let startH = (colKeyNum === targetKeyNum) ? startDate.getHours() : 0;
                                 for (let h = startH; h < 24; h++) {
                                     let s = new Date(curS); s.setHours(h);
                                     let e = new Date(curE); e.setHours(h);
                                     instances.push({ col: col, s: s, e: e });
                                 }
                             }
                         }
                     } else if (msg.recurrence && msg.recurrence.includes("FREQ=WEEKLY")) {
                         for (const col of mainColumns) {
                             const colKeyNum = parseInt(col.getAttribute('data-datekey'));
                             if (colKeyNum >= targetKeyNum && (colKeyNum - targetKeyNum) % 7 === 0) {
                                 let diff = colKeyNum - targetKeyNum;
                                 let s = new Date(startDate); s.setDate(s.getDate() + diff);
                                 let e = new Date(endDate); e.setDate(e.getDate() + diff);
                                 instances.push({ col: col, s: s, e: e });
                             }
                         }
                     } else if (msg.recurrence && msg.recurrence.includes("FREQ=DAILY")) {
                         for (const col of mainColumns) {
                             const colKeyNum = parseInt(col.getAttribute('data-datekey'));
                             if (colKeyNum >= targetKeyNum) {
                                 let diff = colKeyNum - targetKeyNum;
                                 let s = new Date(startDate); s.setDate(s.getDate() + diff);
                                 let e = new Date(endDate); e.setDate(e.getDate() + diff);
                                 instances.push({ col: col, s: s, e: e });
                             }
                         }
                     } else {
                         instances.push({col: targetColumn, s: startDate, e: endDate});
                     }

                         if (!optimisticStates[msg.opId]) optimisticStates[msg.opId] = [];

                         instances.forEach(inst => {
                             const newEvent = document.createElement('div');
                             newEvent.className = 'NlL62b';
                             newEvent.style.backgroundColor = msg.backgroundColor || '#039be5';
                             newEvent.style.borderColor = msg.backgroundColor || '#039be5';
                             newEvent.style.borderRadius = '4px';
                             newEvent.style.padding = '2px 4px';
                             newEvent.style.color = 'white';
                             newEvent.style.fontSize = '12px';
                             newEvent.style.overflow = 'hidden';
                             newEvent.style.boxSizing = 'border-box';
                             newEvent.innerHTML = '<span class="I0UMhf" style="font-weight:bold;display:block;"></span><span class="gVNoLb" style="display:block;"></span>';
                             
                             newEvent.setAttribute('data-eventid', btoa('optimistic_create_' + Math.random()));
                             
                             const hours = (inst.e - inst.s) / 3600000;
                             const newHeight = Math.max((hours * pixelsPerHour) - 2, 10);
                             const startHour = inst.s.getHours() + (inst.s.getMinutes() / 60);
                             const newTop = (startHour * pixelsPerHour) - 1;
                             
                             newEvent.style.height = `${newHeight}px`;
                             newEvent.style.top = `${newTop}px`;
                             newEvent.style.transition = "none";
                             newEvent.style.position = "absolute";
                             newEvent.style.zIndex = "999";
                             newEvent.style.opacity = "1";
                             
                             const titleSpan = newEvent.querySelector('.I0UMhf');
                             if (titleSpan) titleSpan.textContent = msg.title;
                             const timeSpan = newEvent.querySelector('.gVNoLb');
                             if (timeSpan) {
                                 const formatTime = (d) => d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', hour12: false});
                                 timeSpan.textContent = `${formatTime(inst.s)} - ${formatTime(inst.e)}`;
                             }
                             
                             let targetContainer = inst.col.querySelector('.rGFpCd') || inst.col;
                             targetContainer.appendChild(newEvent);
                             
                             optimisticStates[msg.opId].push({
                                 element: newEvent,
                                 isCreate: true
                             });
                             
                             recalculateColumnLayout(inst.col, msg.opId);
                         });
                 }
             return;
         }
         
         const columnsToRecalculate = new Set();
         const rawBlocks = Array.from(document.querySelectorAll('div[data-eventid], div[role="button"]'));
         const blocks = rawBlocks.filter(b => {
             let p = b.parentElement;
             while (p) {
                 if (rawBlocks.includes(p)) return false;
                 p = p.parentElement;
             }
             return true;
         });
         
         blocks.forEach(b => {
             let isMatch = false;
             const domEventId = b.getAttribute('data-eventid');
             
             if (domEventId && msg.eventId) {
                 try {
                     const decoded = atob(domEventId);
                     const fullId = decoded.split(' ')[0];
                     
                     if (msg.recurrenceScope === "future" && msg.eventId.includes('_')) {
                         const msgMaster = msg.eventId.split('_')[0];
                         const msgDate = msg.eventId.split('_')[1];
                         
                         const domMaster = fullId.split('_')[0];
                         const domDate = fullId.split('_')[1] || "";
                         
                         if (domMaster === msgMaster && domDate >= msgDate) {
                             isMatch = true;
                         }
                     } else if (msg.recurrenceScope === "all" && msg.eventId.includes('_')) {
                         const msgMaster = msg.eventId.split('_')[0];
                         const domMaster = fullId.split('_')[0];
                         if (domMaster === msgMaster) {
                             isMatch = true;
                         }
                     } else if (fullId.split('_')[0] === msg.eventId.split('_')[0]) {
                         isMatch = true;
                     }
                 } catch (e) {}
             } 
             // Only fallback to title if we couldn't do a strict ID check
             else if (msg.title && b.textContent && b.textContent.toLowerCase().includes(msg.title.toLowerCase())) {
                 if (!b.className.includes("VfPpkd") && !b.closest('header')) {
                     let timeMatch = true;
                     let dateMatch = true;
                     
                     if (msg.hasTime && msg.newStart) {
                         const startHour = new Date(msg.newStart).getHours();
                         const startMin = new Date(msg.newStart).getMinutes();
                         const expectedTop = ((startHour + (startMin / 60)) * pixelsPerHour) - 1;
                         const actualTop = parseFloat(b.style.top || '0');
                         if (Math.abs(actualTop - expectedTop) > 5) {
                             timeMatch = false;
                         }
                     }
                     
                     if (msg.hasDate && msg.newStart) {
                         const targetDate = new Date(msg.newStart);
                         const padTwo = n => n.toString().padStart(2, '0');
                         const expectedDatekey = `${targetDate.getFullYear()}${padTwo(targetDate.getMonth() + 1)}${padTwo(targetDate.getDate())}`;
                         const col = b.closest('[data-datekey]');
                         if (col && col.getAttribute('data-datekey') !== expectedDatekey) {
                             dateMatch = false;
                         }
                     }
                     
                     if (timeMatch && dateMatch) {
                         isMatch = true;
                     }
                 }
             }
             
             if (isMatch) {
                 b._isMatch = true;
             }
         });
         
         let matchedBlocks = blocks.filter(b => b._isMatch);
         if (!msg.eventId && matchedBlocks.length > 1 && msg.recurrenceScope !== "all" && msg.recurrenceScope !== "future") {
             matchedBlocks = [];
         }
         
         if (msg.eventId && matchedBlocks.length > 1 && msg.recurrenceScope !== "all" && msg.recurrenceScope !== "future") {
             if (msg.targetStart) {
                 const targetDate = new Date(msg.targetStart);
                 const startHour = targetDate.getHours() + (targetDate.getMinutes() / 60);
                 const expectedTop = (startHour * pixelsPerHour) - 1;
                 
                 const targetDateStr = targetDate.getDate().toString();
                 const dayButtons = Array.from(document.querySelectorAll('button[data-datekey]'));
                 const targetButton = dayButtons.find(btn => {
                     if (btn.textContent.trim() === targetDateStr) return true;
                     const spans = Array.from(btn.querySelectorAll('*'));
                     return spans.some(s => s.textContent.trim() === targetDateStr && s.children.length === 0);
                 });
                 
                 let expectedDatekey = null;
                 if (targetButton) {
                     expectedDatekey = targetButton.getAttribute('data-datekey');
                 }

                 let bestMatch = null;
                 for (const b of matchedBlocks) {
                     let topMatch = false;
                     let dateMatch = false;
                     
                     const actualTop = parseFloat(b.style.top || '0');
                     if (!b.style.top || Math.abs(actualTop - expectedTop) < 5) topMatch = true;
                     
                     const col = b.closest('[data-datekey]');
                     if (col && expectedDatekey && col.getAttribute('data-datekey') === expectedDatekey) {
                         dateMatch = true;
                     }
                     
                     if (topMatch && dateMatch) {
                         bestMatch = b;
                         break;
                     }
                 }
                 
                 if (bestMatch) {
                     matchedBlocks = [bestMatch];
                 } else {
                     matchedBlocks = [];
                 }
             } else {
                 matchedBlocks = [];
             }
         }
         
         matchedBlocks.forEach(b => {
             const domEventId = b.getAttribute('data-eventid');
             
             // Save state for possible reversion
             if (!optimisticStates[msg.opId]) optimisticStates[msg.opId] = [];
                 optimisticStates[msg.opId].push({
                     element: b,
                     display: b.style.display,
                     opacity: b.style.opacity,
                     height: b.style.height,
                     top: b.style.top,
                     transition: b.style.transition,
                     width: b.style.width,
                     left: b.style.left,
                     dataEventId: domEventId,
                     timeText: b.querySelector('.gVNoLb')?.textContent
                 });
                 
                 const currentColumn = b.closest('[data-datekey]');
                 if (currentColumn) columnsToRecalculate.add(currentColumn);

                 // Prevent Google Calendar's sync engine from prematurely deleting our scaled/moved "future" instances.
                 if (msg.recurrenceScope === "future" && (msg.action === "scale" || msg.action === "move")) {
                     b.setAttribute('data-eventid', btoa('optimistic_' + Math.random()));
                 }
                 
                 if (msg.action === "delete") {
                     b.dataset.optimisticDeleted = "true";
                     b.style.display = "none";
                 } 
                 else if (msg.action === "scale") {
                     if (msg.newStart && msg.newEnd) {
                         const startDate = new Date(msg.newStart);
                         const endDate = new Date(msg.newEnd);
                         const hours = (endDate - startDate) / 3600000;
                         const newHeight = Math.max((hours * pixelsPerHour) - 2, 10);

                         b.style.transition = "top 0.3s ease-out, height 0.3s ease-out";
                         b.style.height = `${newHeight}px`;
                         
                         if (msg.hasTime) {
                             const startHour = startDate.getHours() + (startDate.getMinutes() / 60);
                             const newTop = (startHour * pixelsPerHour) - 1;
                             b.style.top = `${newTop}px`;
                         }
                         
                         const timeSpan = b.querySelector('.gVNoLb');
                         if (timeSpan) {
                             const formatTime = (d) => d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', hour12: false});
                             timeSpan.textContent = `${formatTime(startDate)} - ${formatTime(endDate)}`;
                         }
                     }
                 } 
                 else if (msg.action === "move") {
                     if (msg.newStart && msg.newEnd) {
                         const startDate = new Date(msg.newStart);
                         const endDate = new Date(msg.newEnd);
                         const hours = (endDate - startDate) / 3600000;
                         const newHeight = Math.max((hours * pixelsPerHour) - 2, 10);
                         const startHour = startDate.getHours() + (startDate.getMinutes() / 60);
                         const newTop = (startHour * pixelsPerHour) - 1;
                         
                         b.style.transition = "top 0.3s ease-out, height 0.3s ease-out";
                         b.style.height = `${newHeight}px`;
                         b.style.top = `${newTop}px`;
                         
                         const timeSpan = b.querySelector('.gVNoLb');
                         if (timeSpan) {
                             const formatTime = (d) => d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', hour12: false});
                             timeSpan.textContent = `${formatTime(startDate)} - ${formatTime(endDate)}`;
                         }
                         
                         const targetDate = startDate.getDate().toString();
                         const dayButtons = Array.from(document.querySelectorAll('button[data-datekey]'));
                         const targetButton = dayButtons.find(btn => {
                             if (btn.textContent.trim() === targetDate) return true;
                             const spans = Array.from(btn.querySelectorAll('*'));
                             return spans.some(s => s.textContent.trim() === targetDate && s.children.length === 0);
                         });
                         
                         let targetColumn = null;
                         if (targetButton) {
                             const targetDatekey = targetButton.getAttribute('data-datekey');
                             targetColumn = document.querySelector(`div[role="gridcell"][data-datekey="${targetDatekey}"]`);
                         }
                         
                         // Fix for recurring events: don't pile all occurrences into a single target day
                         if ((msg.recurrenceScope === "all" || msg.recurrenceScope === "future") && msg.action === "move") {
                             targetColumn = currentColumn || targetColumn;
                         }
                         
                         if (targetColumn) {
                             const currentContainerClass = b.parentElement ? b.parentElement.className.split(' ')[0] : 'rGFpCd';
                             let targetContainer = targetColumn.querySelector(`.${currentContainerClass}`);
                             if (!targetContainer) targetContainer = targetColumn.querySelector('.rGFpCd') || targetColumn;
                             
                             if (b.parentElement !== targetContainer) {
                                 const originalParent = b.parentElement;
                                 targetContainer.appendChild(b);
                                 columnsToRecalculate.add(targetColumn);
                                 
                                 // Store the original parent so we can revert it if needed!
                                 if (optimisticStates[msg.opId]) {
                                     const stateObj = optimisticStates[msg.opId].find(s => s.element === b);
                                     if (stateObj) stateObj.originalParent = originalParent;
                                 }
                             }
                         } else {
                             // Target column is not in view. Hide the event gracefully.
                             b.dataset.optimisticDeleted = "true";
                             b.style.transition = "opacity 0.25s";
                             b.style.opacity = "0";
                             setTimeout(() => { 
                                 if (optimisticStates[msg.opId]) {
                                     b.style.display = "none"; 
                                     recalculateColumnLayout(currentColumn, msg.opId); 
                                 }
                             }, 250);
                         }
                     }
                 }
         });
         
         // Trigger recalculation for any affected columns so events don't visually overlap illegally
         columnsToRecalculate.forEach(col => recalculateColumnLayout(col, msg.opId));
     }
  });

  if (targetDiv.firstElementChild) {
    targetDiv.firstElementChild.after(container);
  } else {
    targetDiv.appendChild(container);
  }
}

function showTutorial() {
  if (document.getElementById("calist-tutorial-overlay")) return;

  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const surfaceColor = isDark ? "#202124" : "#ffffff";
  const textColor = isDark ? "#e8eaed" : "#202124";
  const codeBgColor = isDark ? "#303134" : "#f1f3f4";
  const primaryColor = isDark ? "#8ab4f8" : "#1a73e8";

  const overlay = document.createElement("div");
  overlay.id = "calist-tutorial-overlay";
  Object.assign(overlay.style, {
    position: "fixed", top: "0", left: "0", width: "100vw", height: "100vh",
    backgroundColor: "rgba(0, 0, 0, 0.6)", zIndex: "10000",
    display: "flex", justifyContent: "center", alignItems: "center",
    backdropFilter: "blur(2px)",
    opacity: "0", transition: "opacity 0.2s"
  });

  const modal = document.createElement("div");
  Object.assign(modal.style, {
    backgroundColor: surfaceColor,
    color: textColor,
    borderRadius: "16px", padding: "32px", width: "420px",
    boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
    fontFamily: "'Google Sans', sans-serif", position: "relative",
    transform: "scale(0.95)", transition: "transform 0.2s"
  });

  const title = document.createElement("h2");
  title.innerText = "Typing for Google Calendar";
  title.style.marginTop = "0";

  const closeBtn = document.createElement("button");
  closeBtn.innerHTML = "&times;";
  Object.assign(closeBtn.style, {
    position: "absolute", top: "16px", right: "16px",
    background: "none", border: "none", fontSize: "24px", cursor: "pointer",
    color: isDark ? "#9aa0a6" : "#5f6368"
  });
  closeBtn.onclick = () => {
    overlay.style.opacity = "0";
    modal.style.transform = "scale(0.95)";
    setTimeout(() => overlay.remove(), 200);
  };

  const createEx = (titleText, code) => {
    const p = document.createElement("p");
    p.innerText = titleText;
    p.style.margin = "16px 0 6px 0";
    p.style.fontWeight = "500";
    p.style.fontSize = "15px";
    
    const c = document.createElement("code");
    c.innerText = code;
    Object.assign(c.style, {
      display: "block", background: codeBgColor,
      padding: "10px", borderRadius: "8px", fontFamily: "monospace", color: primaryColor,
      fontSize: "13px"
    });
    return [p, c];
  };

  modal.appendChild(title);
  modal.appendChild(closeBtn);
  createEx("Create Event", "lunch tomorrow 1500 for 2h").forEach(el => modal.appendChild(el));
  createEx("Move Event", "move lunch tomorrow to friday 1600").forEach(el => modal.appendChild(el));
  createEx("Scale Event", "scale lunch plus 15 min").forEach(el => modal.appendChild(el));
  createEx("Delete Event", "delete lunch tomorrow").forEach(el => modal.appendChild(el));
  createEx("Undo Action", "undo").forEach(el => modal.appendChild(el));

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  void overlay.offsetWidth; // trigger reflow
  overlay.style.opacity = "1";
  modal.style.transform = "scale(1)";
  
  overlay.onclick = (e) => {
    if (e.target === overlay) closeBtn.onclick();
  };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "open_tutorial") {
    showTutorial();
  }
});

init();
chrome.storage.local.get(["theme"], (res) => {
  const applyThemeToIcon = () => {
    let isDark = false;
    if (res.theme === 'system' || !res.theme) {
      isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } else {
      isDark = res.theme === 'dark';
    }
    chrome.runtime.sendMessage({ action: "updateIcon", isDark: isDark }).catch(() => {});
  };
  applyThemeToIcon();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyThemeToIcon);
});
