// background.js

async function getAccessToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: interactive }, (token) => {
      if (!chrome.runtime.lastError && token) return resolve(token);
      
      const errorMsg = chrome.runtime.lastError?.message || "";
      chrome.storage.local.get(["calistToken", "tokenExpiry"], (result) => {
        if (result.calistToken && result.tokenExpiry > Date.now()) {
          return resolve(result.calistToken);
        }
        const manifest = chrome.runtime.getManifest();
        const clientId = manifest.oauth2.client_id;
        const scopes = encodeURIComponent(manifest.oauth2.scopes.join(' '));
        const redirectUri = encodeURIComponent(chrome.identity.getRedirectURL());
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&response_type=token&redirect_uri=${redirectUri}&scope=${scopes}`;

        if (!interactive) {
          // Try to silently renew the token without bugging the user
          chrome.identity.launchWebAuthFlow({ url: authUrl + "&prompt=none", interactive: false }, (redirectUrl) => {
            if (chrome.runtime.lastError || !redirectUrl) {
              return reject(new Error("Not authenticated. Please click the Calist extension icon to connect."));
            }
            const params = new URLSearchParams(new URL(redirectUrl).hash.substring(1));
            const token = params.get("access_token");
            if (token) {
              chrome.storage.local.set({ calistToken: token, tokenExpiry: Date.now() + (3000 * 1000) }, () => resolve(token));
            } else {
              return reject(new Error("Not authenticated. Please click the Calist extension icon to connect."));
            }
          });
          return;
        }

        chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (redirectUrl) => {
          if (chrome.runtime.lastError) return reject(new Error("WebAuthFlow failed: " + chrome.runtime.lastError.message));
          if (redirectUrl) {
            const params = new URLSearchParams(new URL(redirectUrl).hash.substring(1));
            const token = params.get("access_token");
            if (token) {
              chrome.storage.local.set({ calistToken: token, tokenExpiry: Date.now() + (3000 * 1000) }, () => resolve(token));
            } else reject(new Error("No token returned."));
          } else reject(new Error("Unknown auth error."));
        });
      });
    });
  });
}

function parseCommand(text) {
  let action = "create";
  let targetCalendar = null;
  let title = text;

  // 1. Action parsing
  let durationModifier = "set";
  const firstWordMatch = title.match(/^\s*(delete|rm|remove|move|mv|reschedule|undo|reverse|scale)\b/i);
  if (firstWordMatch) {
    const fw = firstWordMatch[1].toLowerCase();
    if (fw === "undo" || fw === "reverse") action = "undo";
    else if (fw === "move" || fw === "mv" || fw === "reschedule") action = "move";
    else if (fw === "scale") action = "scale";
    else action = "delete";
    title = title.substring(firstWordMatch[0].length).trim();
  }

  // 2. Hashtag parsing
  const hashMatch = title.match(/#(\w+)/);
  if (hashMatch) {
    targetCalendar = hashMatch[1];
    title = title.replace(hashMatch[0], "").trim();
  }

  // 2.5 Recurrence Scope parsing
  let recurrenceScope = "this";
  const futureMatch = title.match(/\b(future|forward)\b/i);
  if (futureMatch) {
      recurrenceScope = "future";
      title = title.replace(futureMatch[0], "").trim();
  } else {
      const allMatch = title.match(/\b(all)\b/i);
      if (allMatch) {
          recurrenceScope = "all";
          title = title.replace(allMatch[0], "").trim();
      }
  }

  // 3. Duration Parsing
  let durationMs = 0;
  let hasDuration = false;

  const plusMatch = title.match(/\b(plus|add)\b/i);
  if (plusMatch) { durationModifier = "add"; title = title.replace(plusMatch[0], "").trim(); }
  
  const minusMatch = title.match(/\b(minus|subtract)\b/i);
  if (minusMatch) { durationModifier = "subtract"; title = title.replace(minusMatch[0], "").trim(); }

  const byMatch = title.match(/\bby\b/i);
  if (byMatch && action === "scale") { 
      if (durationModifier === "set") durationModifier = "add";
      title = title.replace(byMatch[0], "").trim(); 
  }

  const hrMatch = title.match(/\b(\d+(?:\.\d+)?)\s*h(?:ou)?r?s?\b/i);
  if (hrMatch) {
    durationMs += parseFloat(hrMatch[1]) * 60 * 60 * 1000;
    title = title.replace(hrMatch[0], "").trim();
    hasDuration = true;
  }

  const minMatch = title.match(/\b(\d+)\s*m(?:in)?(?:ute)?s?\b/i);
  if (minMatch) {
    durationMs += parseInt(minMatch[1]) * 60 * 1000;
    title = title.replace(minMatch[0], "").trim();
    hasDuration = true;
  }
  
  if (!hasDuration && action === "create") {
      durationMs = 60 * 60 * 1000; // default 1 hour for create
  }

  // 4. Date Parsing
  let extractedDates = [];
  const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const monthRegex = monthNames.join("|");
  const daysOfWeek = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const dayRegex = daysOfWeek.join("|");
  
  const numDatePattern = `\\b\\d{1,2}[\\./]\\d{1,2}(?:[\\./]\\d{2,4})?\\.?(?=\\s|$)`;
  const textDatePattern1 = `\\b\\d{1,2}(?:st|nd|rd|th)?\\s*(?:of\\s+)?(?:${monthRegex})\\b`;
  const textDatePattern2 = `\\b(?:${monthRegex})\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`;
  const relativeDayPattern = `\\b(?:next\\s+)?(?:${dayRegex})\\b`;
  const allDateRegex = new RegExp(`\\btoday\\b|\\btomorrow\\b|\\btommorow\\b|${numDatePattern}|${textDatePattern1}|${textDatePattern2}|${relativeDayPattern}`, "i");

  while (true) {
    const match = title.match(allDateRegex);
    if (!match) break;
    
    const token = match[0].toLowerCase();
    let d = new Date();
    
    if (token === "today") {
       // date is today
    } else if (token === "tomorrow" || token === "tommorow") {
       d.setDate(d.getDate() + 1);
    } else if (token.match(/\b(\d{1,2})[\./](\d{1,2})/)) {
       const mArr = token.match(/\b(\d{1,2})[\./](\d{1,2})(?:[\./](\d{2,4}))?/);
       let day = parseInt(mArr[1]);
       let month = parseInt(mArr[2]) - 1;
       let year = mArr[3] ? parseInt(mArr[3]) : d.getFullYear();
       if (year < 100) year += 2000;
       d.setFullYear(year, month, day);
    } else if (token.match(new RegExp(`(?:next\\s+)?(?:${dayRegex})`, "i"))) {
       const hasNext = token.startsWith("next");
       const dayToken = token.replace("next", "").trim().substring(0, 3);
       const dayIndex = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(dayToken);
       if (dayIndex !== -1) {
           const currentDay = d.getDay() === 0 ? 7 : d.getDay();
           const targetDay = dayIndex === 0 ? 7 : dayIndex;
           let diff = targetDay - currentDay;
           if (hasNext) diff += 7;
           d.setDate(d.getDate() + diff);
       }
    } else {
       const mArr = token.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?(${monthRegex})\\b|\\b(${monthRegex})\\s+(\\d{1,2})`, "i"));
       let day, mStr;
       if (mArr[1]) { day = parseInt(mArr[1]); mStr = mArr[2].toLowerCase(); }
       else { mStr = mArr[3].toLowerCase(); day = parseInt(mArr[4]); }
       let month = monthNames.findIndex(x => x === mStr);
       if (month >= 12) month -= 12;
       d.setMonth(month, day);
    }
    extractedDates.push(d);
    title = title.replace(match[0], "").trim();
  }

  // 5. Recurrence Parsing
  let recurrence = null;
  const everyHourMatch = title.match(/\bevery\s*hour\b/i);
  if (everyHourMatch) { recurrence = "RRULE:FREQ=HOURLY"; title = title.replace(everyHourMatch[0], "").trim(); }
  const everyDayMatch = title.match(/\bevery\s*day\b/i);
  if (everyDayMatch) { recurrence = "RRULE:FREQ=DAILY"; title = title.replace(everyDayMatch[0], "").trim(); }
  const everyWeekMatch = title.match(/\bevery\s*week\b/i);
  if (everyWeekMatch) { recurrence = "RRULE:FREQ=WEEKLY"; title = title.replace(everyWeekMatch[0], "").trim(); }
  const everyMonthMatch = title.match(/\bevery\s*month\b/i);
  if (everyMonthMatch) { recurrence = "RRULE:FREQ=MONTHLY"; title = title.replace(everyMonthMatch[0], "").trim(); }
  const everyYearMatch = title.match(/\bevery\s*year\b/i);
  if (everyYearMatch) { recurrence = "RRULE:FREQ=YEARLY"; title = title.replace(everyYearMatch[0], "").trim(); }
  const everyWeekdayMatch = title.match(/\bevery\s*weekday\b/i);
  if (everyWeekdayMatch) { recurrence = "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"; title = title.replace(everyWeekdayMatch[0], "").trim(); }

  // 6. Time Parsing
  let extractedTimes = [];
  const timeRegexSrc = `\\b\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)\\b|\\b\\d{1,2}:\\d{2}\\b|\\b(?:[01]\\d|2[0-3])[0-5]\\d\\b|\\b\\d{1,2}\\b`;
  const allTimeRegex = new RegExp(timeRegexSrc, "i");

  function parseTimeToken(token) {
    let m = token.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (m) {
      let hr = parseInt(m[1]);
      let mn = m[2] ? parseInt(m[2]) : 0;
      let ampm = m[3].toLowerCase();
      if (ampm === "pm" && hr < 12) hr += 12;
      if (ampm === "am" && hr === 12) hr = 0;
      return { hr, mn };
    }
    m = token.match(/^(\d{1,2}):(\d{2})$/i);
    if (m) return { hr: parseInt(m[1]), mn: parseInt(m[2]) };
    
    m = token.match(/^([01]\d|2[0-3])([0-5]\d)$/);
    if (m) return { hr: parseInt(m[1]), mn: parseInt(m[2]) };
    
    m = token.match(/^(\d{1,2})$/);
    if (m) return { hr: parseInt(m[1]), mn: 0 };
    return null;
  }

  while (true) {
    const match = title.match(allTimeRegex);
    if (!match) break;
    
    const t = parseTimeToken(match[0]);
    if (t) {
      extractedTimes.push(t);
    }
    title = title.replace(match[0], "").trim();
  }

  title = title.replace(/\b(at|on|for|to)\b/gi, "").replace(/\s+/g, " ").trim();

  // For compatibility with legacy CREATE and DELETE handlers:
  let startHour = 9, startMin = 0;
  let hasTime = extractedTimes.length > 0;
  if (hasTime) {
    startHour = extractedTimes[0].hr;
    startMin = extractedTimes[0].mn;
  }
  let baseDate = extractedDates.length > 0 ? extractedDates[0] : new Date();
  const start = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), startHour, startMin, 0);
  
  let end = new Date(start.getTime() + durationMs);
  if (extractedTimes.length > 1) {
     let eHr = extractedTimes[1].hr;
     let eMn = extractedTimes[1].mn;
     if (eHr < startHour && eHr < 12) eHr += 12;
     end = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), eHr, eMn, 0);
     hasDuration = true;
  }

  return { action, targetCalendar, title, start, end, hasTime, hasDuration, durationMs, durationModifier, extractedDates, extractedTimes, recurrence, recurrenceScope };
}

async function resolveCalendarId(token, hashtag) {
  const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", { headers: { Authorization: "Bearer " + token }});
  const data = await res.json();
  chrome.storage.local.set({ cachedCalendars: data.items });
  if (hashtag.toLowerCase() === "primary") return "primary";
  const cal = data.items.find(c => c.summary.toLowerCase().replace(/\s+/g, "") === hashtag.toLowerCase());
  return cal ? cal.id : "primary";
}

async function executeCommand(commandStr, tabId) {
  const cmd = parseCommand(commandStr);
  const opId = "op_" + Date.now();
  
  const { cachedCalendars } = await new Promise(resolve => chrome.storage.local.get(["cachedCalendars"], resolve));
  let targetColor = '#039be5'; // default blue
  
  if (cachedCalendars) {
     const hashtag = cmd.targetCalendar || "primary";
     let cal;
     if (hashtag === "primary") {
         cal = cachedCalendars.find(c => c.primary);
     } else {
         cal = cachedCalendars.find(c => c.summary.toLowerCase().replace(/\s+/g, "") === hashtag.toLowerCase());
     }
     if (cal && cal.backgroundColor) targetColor = cal.backgroundColor;
  }
  
  if (tabId && cmd.action === "create") {
    chrome.tabs.sendMessage(tabId, {
      type: "optimisticUpdate",
      opId: opId,
      action: cmd.action,
      title: cmd.title,
      newStart: cmd.start.toISOString(),
      newEnd: cmd.end.toISOString(),
      recurrence: cmd.recurrence,
      backgroundColor: targetColor,
      hasTime: cmd.hasTime,
      hasDate: cmd.extractedDates.length > 0
    }).catch(() => {});
  }
  
  const token = await getAccessToken(false);
  
  try {
      const headers = {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json"
      };

      if (cmd.action === "undo") {
    const undoState = await new Promise(resolve => chrome.storage.local.get(["lastUndoState"], res => resolve(res.lastUndoState)));
    if (!undoState) throw new Error("Nothing to undo");

    if (undoState.action === "create") {
      const delRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(undoState.calendarId)}/events/${undoState.eventId}`, {
        method: "DELETE", headers
      });
      if (!delRes.ok) throw new Error("Failed to undo creation");
      await new Promise(resolve => chrome.storage.local.remove("lastUndoState", resolve));
      return `Undid creation of "${undoState.summary}"`;
    } 
    else if (undoState.action === "delete") {
      const event = {
        summary: undoState.originalEvent.summary,
        start: undoState.originalEvent.start,
        end: undoState.originalEvent.end
      };
      if (undoState.originalEvent.recurrence) event.recurrence = undoState.originalEvent.recurrence;
      if (undoState.originalEvent.description) event.description = undoState.originalEvent.description;
      if (undoState.originalEvent.location) event.location = undoState.originalEvent.location;
      
      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(undoState.calendarId)}/events`, {
        method: "POST", headers, body: JSON.stringify(event)
      });
      if (!res.ok) throw new Error("Failed to undo deletion");
      await new Promise(resolve => chrome.storage.local.remove("lastUndoState", resolve));
      return `Restored deleted event "${event.summary}"`;
    }
    else if (undoState.action === "delete_future") {
      const patchRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(undoState.calendarId)}/events/${undoState.masterId}`, {
        method: "PATCH", headers, body: JSON.stringify({ recurrence: undoState.originalRecurrence })
      });
      if (!patchRes.ok) throw new Error("Failed to undo future deletion");
      await new Promise(resolve => chrome.storage.local.remove("lastUndoState", resolve));
      return `Restored future occurrences`;
    }
    else if (undoState.action === "move") {
      const patchBody = {
        start: undoState.oldStart,
        end: undoState.oldEnd
      };
      const patchRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(undoState.calendarId)}/events/${undoState.eventId}`, {
        method: "PATCH", headers, body: JSON.stringify(patchBody)
      });
      if (!patchRes.ok) throw new Error("Failed to undo move");
      await new Promise(resolve => chrome.storage.local.remove("lastUndoState", resolve));
      return `Reverted move for "${undoState.summary}"`;
    }
  }

  else if (cmd.action === "create") {
    const calId = cmd.targetCalendar ? await resolveCalendarId(token, cmd.targetCalendar) : "primary";
    
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const toLocalISO = (d) => {
        const pad = n => n.toString().padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };
    
    const event = {
      summary: cmd.title,
      start: { dateTime: toLocalISO(cmd.start), timeZone: tz },
      end: { dateTime: toLocalISO(cmd.end), timeZone: tz }
    };
    if (cmd.recurrence) {
      event.recurrence = [cmd.recurrence];
    }
    

    
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`, {
      method: "POST", headers, body: JSON.stringify(event)
    });
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error("Failed to create event: " + errorText);
    }
    
    const createdEvent = await res.json();
    await new Promise(resolve => chrome.storage.local.set({
      lastUndoState: { action: "create", eventId: createdEvent.id, calendarId: calId, summary: cmd.title }
    }, resolve));
    
    if (tabId) {
        chrome.tabs.sendMessage(tabId, { type: "commitOptimisticUpdate", opId: opId }).catch(() => {});
    }
    
    return `Created event "${cmd.title}" on ${cmd.targetCalendar || "primary"}`;
  } 
  
  else if (cmd.action === "delete" || cmd.action === "move" || cmd.action === "scale") {
    let calIds = [];
    if (cmd.targetCalendar) {
      calIds = [await resolveCalendarId(token, cmd.targetCalendar)];
    } else {
      const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", { headers });
      const data = await res.json();
      chrome.storage.local.set({ cachedCalendars: data.items });
      calIds = data.items.map(c => c.id);
    }

    const now = new Date();
    const dayOfWeek = now.getDay();
    const diffToMonday = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    
    let minDate = new Date(now);
    minDate.setDate(diffToMonday);
    minDate.setHours(0, 0, 0, 0);
    
    let maxDate = new Date(minDate);
    maxDate.setDate(minDate.getDate() + 6);
    maxDate.setHours(23, 59, 59, 999);

    if (cmd.extractedDates.length > 0) {
      const extractedMin = new Date(Math.min(...cmd.extractedDates));
      const extractedMax = new Date(Math.max(...cmd.extractedDates));
      
      if (extractedMin < minDate) minDate = extractedMin;
      if (extractedMax > maxDate) maxDate = extractedMax;
    }
    
    // Buffer by a few days to be safe
    minDate.setDate(minDate.getDate() - 2);
    maxDate.setDate(maxDate.getDate() + 2);
    minDate.setHours(0, 0, 0, 0);
    maxDate.setHours(23, 59, 59, 999);

    let timeMin = minDate.toISOString();
    let timeMax = maxDate.toISOString();
    
    // Respect the maxPastDays setting to protect older events
    const { maxPastDays } = await new Promise(resolve => chrome.storage.local.get(["maxPastDays"], resolve));
    const limitDays = maxPastDays !== undefined ? maxPastDays : 7;
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - limitDays);
    cutoffDate.setHours(0, 0, 0, 0);
    
    if (new Date(timeMin) < cutoffDate) {
      timeMin = cutoffDate.toISOString();
    }

    // If timeMax is before timeMin due to the cutoff, we shouldn't search anything
    if (new Date(timeMax) < new Date(timeMin)) {
      throw new Error(`The target event is older than your configured "Max Past Days" limit (${limitDays} days).`);
    }
    
    let allMatches = [];
    
    await Promise.all(calIds.map(async (calId) => {
      try {
        const searchRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?q=${encodeURIComponent(cmd.title)}&timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`, { headers });
        if (searchRes.ok) {
          const data = await searchRes.json();
          if (data.items) {
            data.items.forEach(item => {
              item.calendarId = calId;
              allMatches.push(item);
            });
          }
        }
      } catch (e) {
      }
    }));

    allMatches.sort((a, b) => {
      const aTime = a.start?.dateTime || a.start?.date || "";
      const bTime = b.start?.dateTime || b.start?.date || "";
      return aTime.localeCompare(bTime);
    });

    if (allMatches.length === 0) {
      throw new Error(`Could not find event "${cmd.title}" to ${cmd.action}`);
    }

    let targetEvent;
    
    let sourceDateStr = null;
    let targetDateStr = null;
    let targetTime = null;
    let targetEndTime = null;
    const todayStr = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, '0') + "-" + String(now.getDate()).padStart(2, '0');

    if (cmd.action === "move") {
       if (cmd.extractedDates.length === 0) {
          sourceDateStr = todayStr;
          targetDateStr = todayStr;
       } else if (cmd.extractedDates.length === 1) {
          const d1 = cmd.extractedDates[0];
          const d1Str = d1.getFullYear() + "-" + String(d1.getMonth() + 1).padStart(2, '0') + "-" + String(d1.getDate()).padStart(2, '0');
          if (cmd.extractedTimes.length > 0) {
             sourceDateStr = d1Str;
             targetDateStr = d1Str;
          } else {
             sourceDateStr = todayStr;
             targetDateStr = d1Str;
          }
       } else if (cmd.extractedDates.length >= 2) {
          const d1 = cmd.extractedDates[0];
          const d2 = cmd.extractedDates[1];
          sourceDateStr = d1.getFullYear() + "-" + String(d1.getMonth() + 1).padStart(2, '0') + "-" + String(d1.getDate()).padStart(2, '0');
          targetDateStr = d2.getFullYear() + "-" + String(d2.getMonth() + 1).padStart(2, '0') + "-" + String(d2.getDate()).padStart(2, '0');
       }
       
       if (cmd.extractedTimes.length > 0) targetTime = cmd.extractedTimes[0];
       if (cmd.extractedTimes.length > 1) targetEndTime = cmd.extractedTimes[1];
       
    } else if (cmd.action === "delete" || cmd.action === "scale") {
       if (cmd.extractedDates.length > 0) {
          const d1 = cmd.extractedDates[0];
          sourceDateStr = d1.getFullYear() + "-" + String(d1.getMonth() + 1).padStart(2, '0') + "-" + String(d1.getDate()).padStart(2, '0');
       } else {
          sourceDateStr = todayStr;
       }
    }

    let filteredMatches = allMatches;
    
    // 1. Filter by target date
    let matchesForDate = filteredMatches.filter(m => {
      const mDate = m.start?.dateTime || m.start?.date || "";
      return mDate.startsWith(sourceDateStr);
    });
    
    // If events exist on the target date, narrow down to them. 
    // Otherwise, keep searching the whole week (handles cases where date wasn't specified and today has no matches).
    if (matchesForDate.length > 0) {
        filteredMatches = matchesForDate;
    }

    // 2. Filter by exact time if specified
    if (cmd.extractedTimes && cmd.extractedTimes.length > 0) {
        const targetT = cmd.extractedTimes[0];
        let matchesForTime = filteredMatches.filter(m => {
            if (m.start?.dateTime) {
                const d = new Date(m.start.dateTime);
                return d.getHours() === targetT.hr && d.getMinutes() === targetT.mn;
            }
            return false;
        });
        
        // Only apply time filter if it yields results, otherwise fallback to whatever we had
        if (matchesForTime.length > 0) {
            filteredMatches = matchesForTime;
        }
    }
    
    // 3. Resolve the target event
    if (filteredMatches.length === 1) {
        targetEvent = filteredMatches[0];
    } else if (filteredMatches.length > 1) {
        throw new Error(`Found ${filteredMatches.length} matching events. Please specify a calendar or exact time.`);
    } else {
        // Fallback to the next upcoming occurrence if neither date nor time uniquely identified an event
        const upcomingMatches = allMatches.filter(m => {
            const mDate = m.start?.dateTime || m.start?.date || "";
            return new Date(mDate) >= now;
        });
        if (upcomingMatches.length > 0) {
            targetEvent = upcomingMatches[0];
        } else {
            targetEvent = allMatches[0];
        }
    }
    
    // If we are modifying "future" starting from the very first instance, it is equivalent to modifying "all".
    // This prevents leaving behind an orphaned master event with an invalid RRULE.
    if (cmd.recurrenceScope === "future" && targetEvent.recurringEventId) {
        const checkRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetEvent.calendarId)}/events/${targetEvent.recurringEventId}`, { headers });
        if (checkRes.ok) {
            const masterCheck = await checkRes.json();
            const mStart = masterCheck.start?.dateTime || masterCheck.start?.date;
            const tStart = targetEvent.start?.dateTime || targetEvent.start?.date;
            if (mStart === tStart) {
                cmd.recurrenceScope = "all";
            }
        }
    }
    
    // Handle "all" recurrence scope
    if (cmd.recurrenceScope === "all" && targetEvent.recurringEventId) {
        const masterRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetEvent.calendarId)}/events/${targetEvent.recurringEventId}`, { headers });
        if (masterRes.ok) {
            const masterEvent = await masterRes.json();
            masterEvent.calendarId = targetEvent.calendarId;
            targetEvent = masterEvent;
        }
    }

    if (cmd.action === "delete") {

      if (tabId) {
          chrome.tabs.sendMessage(tabId, { 
              type: "optimisticUpdate", 
              opId: opId,
              title: targetEvent.summary, 
              eventId: targetEvent.id,
              targetStart: (targetEvent.start?.dateTime || targetEvent.start?.date),
              action: cmd.action,
              recurrenceScope: cmd.recurrenceScope
          }).catch(() => {});
      }
      
      if (cmd.recurrenceScope === "future" && targetEvent.recurringEventId) {
          const masterRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetEvent.calendarId)}/events/${targetEvent.recurringEventId}`, { headers });
          if (masterRes.ok) {
              const masterEvent = await masterRes.json();
              const instanceStart = new Date(targetEvent.start.dateTime || targetEvent.start.date);
              const untilDate = new Date(instanceStart.getTime() - 1000);
              const untilStr = untilDate.toISOString().replace(/[-:]/g, '').split('.')[0] + "Z";
              
              if (masterEvent.recurrence) {
                  const originalRecurrence = masterEvent.recurrence.slice();
                  masterEvent.recurrence = masterEvent.recurrence.map(rule => {
                      if (rule.startsWith('RRULE:')) return rule.replace(/;(UNTIL|COUNT)=[^;]+/g, '') + ';UNTIL=' + untilStr;
                      return rule;
                  });
                  await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetEvent.calendarId)}/events/${targetEvent.recurringEventId}`, {
                      method: "PATCH", headers, body: JSON.stringify({ recurrence: masterEvent.recurrence })
                  });
                  await new Promise(resolve => chrome.storage.local.set({
                      lastUndoState: { action: "delete_future", calendarId: targetEvent.calendarId, masterId: targetEvent.recurringEventId, originalRecurrence: originalRecurrence }
                  }, resolve));
              }
          }
          if (tabId) {
              chrome.tabs.sendMessage(tabId, { type: "commitOptimisticUpdate", opId: opId }).catch(() => {});
          }
          return `Deleted future occurrences of "${targetEvent.summary}"`;
      }
      
      const delRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetEvent.calendarId)}/events/${targetEvent.id}`, {
        method: "DELETE", headers
      });
      if (!delRes.ok) throw new Error("Failed to delete event");
      
      await new Promise(resolve => chrome.storage.local.set({
        lastUndoState: { action: "delete", calendarId: targetEvent.calendarId, originalEvent: targetEvent }
      }, resolve));
      
      if (tabId) {
          chrome.tabs.sendMessage(tabId, { type: "commitOptimisticUpdate", opId: opId }).catch(() => {});
      }
      
      return `Deleted event "${targetEvent.summary}"`;
    }
    
    else if (cmd.action === "scale") {
      if (!targetEvent.start?.dateTime || !targetEvent.end?.dateTime) {
          throw new Error("Cannot scale an all-day event.");
      }
      
      const originalStart = new Date(targetEvent.start.dateTime);
      const originalEnd = new Date(targetEvent.end.dateTime);
      const originalDurationMs = originalEnd.getTime() - originalStart.getTime();
      
      let newDurationMs = originalDurationMs;
      if (cmd.durationModifier === "add") {
         newDurationMs += cmd.durationMs;
      } else if (cmd.durationModifier === "subtract") {
         newDurationMs -= cmd.durationMs;
         if (newDurationMs < 0) newDurationMs = 0;
      } else {
         newDurationMs = cmd.durationMs;
      }
      
      const newEnd = new Date(originalStart.getTime() + newDurationMs);
      
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const toLocalISO = (d) => {
          const pad = n => n.toString().padStart(2, '0');
          return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      };
      
      const patchBody = {
        start: { dateTime: toLocalISO(originalStart), timeZone: tz },
        end: { dateTime: toLocalISO(newEnd), timeZone: tz }
      };
      
      if (tabId) {
          chrome.tabs.sendMessage(tabId, { 
              type: "optimisticUpdate", 
              opId: opId,
              title: targetEvent.summary, 
              eventId: targetEvent.id,
              targetStart: (targetEvent.start?.dateTime || targetEvent.start?.date),
              action: cmd.action,
              recurrenceScope: cmd.recurrenceScope,
              newDurationMs: newDurationMs,
              newStart: originalStart.toISOString(),
              newEnd: newEnd.toISOString()
          }).catch(() => {});
      }
      
      if (cmd.recurrenceScope === "future" && targetEvent.recurringEventId) {
          const masterRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetEvent.calendarId)}/events/${targetEvent.recurringEventId}`, { headers });
          if (masterRes.ok) {
              const masterEvent = await masterRes.json();
              const instanceStart = new Date(targetEvent.start.dateTime || targetEvent.start.date);
              const untilDate = new Date(instanceStart.getTime() - 1000);
              const untilStr = untilDate.toISOString().replace(/[-:]/g, '').split('.')[0] + "Z";
              
              if (masterEvent.recurrence) {
                  const originalRecurrence = masterEvent.recurrence.slice();
                  masterEvent.recurrence = masterEvent.recurrence.map(rule => {
                      if (rule.startsWith('RRULE:')) return rule.replace(/;(UNTIL|COUNT)=[^;]+/g, '') + ';UNTIL=' + untilStr;
                      return rule;
                  });
                  await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetEvent.calendarId)}/events/${targetEvent.recurringEventId}`, {
                      method: "PATCH", headers, body: JSON.stringify({ recurrence: masterEvent.recurrence })
                  });
                  
                  // Create new master event
                  const newEventBody = {
                      summary: masterEvent.summary,
                      start: patchBody.start,
                      end: patchBody.end,
                      recurrence: originalRecurrence.map(rule => rule.replace(/;UNTIL=[^;]+/g, ''))
                  };
                  const createRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetEvent.calendarId)}/events`, {
                      method: "POST", headers, body: JSON.stringify(newEventBody)
                  });
                  if (!createRes.ok) throw new Error("Failed to create scaled future events");
              }
          }
      } else {
          const patchRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetEvent.calendarId)}/events/${targetEvent.id}`, {
            method: "PATCH", headers, body: JSON.stringify(patchBody)
          });
          if (!patchRes.ok) throw new Error("Failed to scale event");
      }
      
      await new Promise(resolve => chrome.storage.local.set({
        lastUndoState: { action: "move", eventId: targetEvent.id, calendarId: targetEvent.calendarId, summary: targetEvent.summary, oldStart: targetEvent.start, oldEnd: targetEvent.end }
      }, resolve));
      
      const msToText = (ms) => {
         if (ms === 0) return "0m";
         const totalMins = Math.floor(ms / 60000);
         const h = Math.floor(totalMins / 60);
         const m = totalMins % 60;
         if (h > 0 && m > 0) return `${h}h ${m}m`;
         if (h > 0) return `${h}h`;
         return `${m}m`;
      };
      
      if (tabId) {
          chrome.tabs.sendMessage(tabId, { type: "commitOptimisticUpdate", opId: opId }).catch(() => {});
      }
      
      return `Resized "${targetEvent.summary}" to ${msToText(newDurationMs)}`;
    }
    
    else if (cmd.action === "move") {
      let newStart = new Date(targetEvent.start.dateTime || targetEvent.start.date);
      let newEnd = new Date(targetEvent.end.dateTime || targetEvent.end.date);
      
      const [tY, tM, tD] = targetDateStr.split('-');
      newStart.setFullYear(tY, tM - 1, tD);
      newEnd.setFullYear(tY, tM - 1, tD);
      
      if (targetTime) {
         newStart.setHours(targetTime.hr, targetTime.mn, 0);
         
         if (targetEndTime) {
             let eHr = targetEndTime.hr;
             let eMn = targetEndTime.mn;
             if (eHr < targetTime.hr && eHr < 12) eHr += 12;
             newEnd.setHours(eHr, eMn, 0);
         } else if (cmd.hasDuration) {
             newEnd = new Date(newStart.getTime() + cmd.durationMs);
         } else {
             const originalStart = new Date(targetEvent.start.dateTime || targetEvent.start.date);
             const originalEnd = new Date(targetEvent.end.dateTime || targetEvent.end.date);
             const originalDurationMs = originalEnd.getTime() - originalStart.getTime();
             newEnd = new Date(newStart.getTime() + originalDurationMs);
         }
      }
      
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const toLocalISO = (d) => {
          const pad = n => n.toString().padStart(2, '0');
          return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      };
      
      const patchBody = {
        start: { dateTime: toLocalISO(newStart), timeZone: tz },
        end: { dateTime: toLocalISO(newEnd), timeZone: tz }
      };
      
      if (tabId) {
          chrome.tabs.sendMessage(tabId, { 
              type: "optimisticUpdate", 
              opId: opId,
              title: targetEvent.summary, 
              eventId: targetEvent.id,
              targetStart: (targetEvent.start?.dateTime || targetEvent.start?.date),
              action: cmd.action,
              recurrenceScope: cmd.recurrenceScope,
              newStart: newStart.toISOString(),
              newEnd: newEnd.toISOString()
          }).catch(() => {});
      }
      
      if (cmd.recurrenceScope === "future" && targetEvent.recurringEventId) {
          const masterRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetEvent.calendarId)}/events/${targetEvent.recurringEventId}`, { headers });
          if (masterRes.ok) {
              const masterEvent = await masterRes.json();
              const instanceStart = new Date(targetEvent.start.dateTime || targetEvent.start.date);
              const untilDate = new Date(instanceStart.getTime() - 1000);
              const untilStr = untilDate.toISOString().replace(/[-:]/g, '').split('.')[0] + "Z";
              
              if (masterEvent.recurrence) {
                  const originalRecurrence = masterEvent.recurrence.slice();
                  masterEvent.recurrence = masterEvent.recurrence.map(rule => {
                      if (rule.startsWith('RRULE:')) return rule.replace(/;(UNTIL|COUNT)=[^;]+/g, '') + ';UNTIL=' + untilStr;
                      return rule;
                  });
                  await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetEvent.calendarId)}/events/${targetEvent.recurringEventId}`, {
                      method: "PATCH", headers, body: JSON.stringify({ recurrence: masterEvent.recurrence })
                  });
                  
                  // Create new master event
                  const newEventBody = {
                      summary: masterEvent.summary,
                      start: patchBody.start,
                      end: patchBody.end,
                      recurrence: originalRecurrence.map(rule => rule.replace(/;UNTIL=[^;]+/g, ''))
                  };
                  const createRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetEvent.calendarId)}/events`, {
                      method: "POST", headers, body: JSON.stringify(newEventBody)
                  });
                  if (!createRes.ok) throw new Error("Failed to create moved future events");
              }
          }
      } else {
          const patchRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetEvent.calendarId)}/events/${targetEvent.id}`, {
            method: "PATCH", headers, body: JSON.stringify(patchBody)
          });
          if (!patchRes.ok) throw new Error("Failed to move event");
      }
      
      await new Promise(resolve => chrome.storage.local.set({
        lastUndoState: { action: "move", eventId: targetEvent.id, calendarId: targetEvent.calendarId, summary: targetEvent.summary, oldStart: targetEvent.start, oldEnd: targetEvent.end }
      }, resolve));
      
      if (tabId) {
          chrome.tabs.sendMessage(tabId, { type: "commitOptimisticUpdate", opId: opId }).catch(() => {});
      }
      
      const timeString = cmd.start.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      return `Moved "${targetEvent.summary}" to ${timeString}`;
    }
  }
  } catch (error) {
      if (tabId && cmd.action !== "undo") {
          chrome.tabs.sendMessage(tabId, { type: "revertOptimisticUpdate", opId: opId }).catch(() => {});
      }
      throw error;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getCalendars") {
    getAccessToken(false).then(async (token) => {
      const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", { headers: { Authorization: "Bearer " + token }});
      const data = await res.json();
      const calColors = {};
      if (data.items) {
        data.items.forEach(c => {
          calColors[c.summary.toLowerCase().replace(/\s+/g, "")] = c.backgroundColor;
        });
      }
      sendResponse({ success: true, calendars: calColors });
    }).catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "authenticate") {
    getAccessToken(true)
      .then(token => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "processCommand") {
    executeCommand(request.text, sender?.tab?.id)
      .then(msg => sendResponse({ success: true, message: msg }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "signOut") {
    chrome.storage.local.get(["calistToken"], (res) => {
      if (res.calistToken) {
          fetch(`https://oauth2.googleapis.com/revoke?token=${res.calistToken}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
          }).then(() => {
            chrome.identity.removeCachedAuthToken({ token: res.calistToken }, () => {
              chrome.storage.local.remove(["calistToken", "tokenExpiry"], () => {
                sendResponse({ success: true });
              });
            });
          }).catch(err => {
            chrome.storage.local.remove(["calistToken", "tokenExpiry"], () => {
              sendResponse({ success: true });
            });
          });
      } else {
          sendResponse({ success: true });
      }
    });
    return true;
  }
  
  if (request.action === "updateIcon") {
      const iconPath = request.isDark ? "assets/img/icon_light.png" : "assets/img/icon_dark.png";
      chrome.action.setIcon({ path: iconPath }).catch(() => {});
      sendResponse({ success: true });
      return true;
  }
});
