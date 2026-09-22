(function () {
  'use strict';

  // === CONFIG ===
  var CFG = window.HERMES_CONFIG || {};
  var DEFAULT_URL = CFG.serverUrl || window.location.origin;
  var DEFAULT_KEY = CFG.apiKey || '';
  // Responses is the ONLY transport (completions mode was removed).
  var DEFAULT_MODE = 'responses';
  var DEFAULT_TURNS = CFG.maxTurns || 8;
  var DEFAULT_INST = CFG.instructions || '';
  var TIMEOUT_MS = 900000; // 15 min (inference is slow)

  // Session ID rules: letters, numbers, hyphens, underscores, 3-64 chars
  var SESSION_ID_RE = /^[a-zA-Z0-9_-]{3,64}$/;

  // === MARKED CONFIG (Kindle-safe) ===
  // marked.js v4 UMD build - disable async (Kindle doesn't support async imports)
  if (typeof marked !== 'undefined') {
    marked.setOptions({
      breaks: true,      // GitHub-style line breaks
      gfm: true,         // GitHub Flavored Markdown
      headerIds: false,  // No auto-generated IDs
      mangle: false     // Don't mangle email addresses
    });
  }

  // === STATE ===
  var state = {
    serverUrl: DEFAULT_URL,
    apiKey: DEFAULT_KEY,
    mode: DEFAULT_MODE,    // always 'responses' now (kept for stored-session shape)
    maxTurns: DEFAULT_TURNS,

    sessions: [],       // [{id, mode, preview, time, lastResponseId?, messageCount?}]
    activeSession: null,     // string session ID
    messages: [],       // current view buffer [{role, content, tools}]

    // Responses-mode paging
    latestResponseId: null,
    earliestResponseId: null,
    hasEarlier: false,
    loadingEarlier: false,

    // History paging (official /api/sessions/{id}/messages)
    // Offset of the oldest row currently held in `messages`, and whether the
    // server reported more rows beyond it. Drives [Load earlier] in BOTH modes.
    historyOffset: 0,
    historyHasMore: false,
    historyLoading: false,

    connected: false,
    sending: false,
    lastError: null,
    dark: false,

    // In-flight request control (STOP button)
    activeCtrl: null,
    userAborted: false,

    // Token usage totals per session: {sessionId: totalTokens}
    usage: {}
  };

  // === DOM CACHE ===
  var E = {};
  function cacheDom() {
    var ids = [
      'status', 'mode-badge',
      'sessions-view', 'chat-view',
      'sessions-list', 'sessions-empty',
      'refresh-sessions-btn',
      'new-session-btn', 'new-session-form', 'new-session-input',
      'new-session-error', 'new-session-cancel', 'new-session-create',
      'rejoin-input', 'rejoin-error', 'rejoin-btn',
      'settings-toggle', 'settings-panel',
      'setting-url', 'setting-key',
      'setting-max-turns', 'setting-dark-mode', 'mode-hint',
      'test-connection-btn', 'settings-save',
      'back-btn', 'session-title', 'chat-mode-badge',
      'load-earlier', 'load-earlier-btn',
      'messages', 'typing-indicator',
      'message-input', 'send-btn', 'stop-btn',
      'usage-total'
    ];
    for (var i = 0; i < ids.length; i++) {
      E[ids[i]] = document.getElementById(ids[i]);
    }
  }

  // === PERSISTENCE ===
  var LS_META_KEY = 'hermes_tw_sessions_v2';  // only session metadata
  var LS_MSG_PREFIX = 'hermes_tw_msgs_';      // legacy completions-mode arrays (unused)
  var LS_USAGE_KEY = 'hermes_tw_usage_v1';     // per-session token totals

  /** Token totals per session: {sessionId: totalTokens}. Spend visibility
      without spending tokens — the values come from server usage envelopes. */
  function loadUsage() {
    try { return JSON.parse(localStorage.getItem(LS_USAGE_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function saveUsage() {
    try { localStorage.setItem(LS_USAGE_KEY, JSON.stringify(state.usage)); }
    catch (e) { /* silent */ }
  }

  function saveMeta() {
    try {
      // Only save settings, NOT sessions - server is source of truth
      localStorage.setItem(LS_META_KEY, JSON.stringify({
        serverUrl: state.serverUrl,
        apiKey: state.apiKey,
        mode: state.mode,
        maxTurns: state.maxTurns,
        dark: state.dark
      }));
    } catch (e) { /* silent fail on Kindle */ }
  }

  function loadMeta() {
    try {
      var d = JSON.parse(localStorage.getItem(LS_META_KEY) || 'null');
      if (d) {
        state.serverUrl = d.serverUrl || DEFAULT_URL;
        state.apiKey = d.apiKey || '';
        state.mode = 'responses';  // single transport
        state.maxTurns = d.maxTurns || DEFAULT_TURNS;
        state.dark = !!d.dark;
        // Sessions loaded from server, not localStorage
        state.sessions = [];
      }
      applyDarkMode();
    } catch (e) { /* use defaults */ }
  }

  // === HELPERS ===
  // Twemoji handles emoji → <img> conversion
  // This is a no-op now, kept for backwards compatibility
  function replaceEmoji(text) {
    return text || '';
  }

  function escapeHtml(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderMarkdown(text) {
    if (!text) return '';
    // Use marked.js if available, otherwise fall back to basic rendering
    if (typeof marked === 'function') {
      return marked.parse(text);
    }
    // Fallback: basic markdown (code, bold, italic, line breaks)
    var h = escapeHtml(text);
    h = h.replace(/```([a-z]*)\n([\s\S]*?)```/g, function (_, _lang, code) {
      return '<pre class="code-block">' + code.trim() + '</pre>';
    });
    h = h.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/([^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    h = h.replace(/\n/g, '<br>');
    return h;
  }

  // Apply Twemoji to an element (converts emoji to <img> tags)
  function applyTwemoji(el) {
    if (typeof twemoji === 'object' && twemoji.parse) {
      twemoji.parse(el, {
        folder: 'svg',  // SVG is smaller and scales better
        ext: '.svg',
        className: 'emoji'
      });
    }
  }

  function formatTime(ts) {
    if (!ts) return '';
    var d = new Date(ts), now = new Date(), diff = now - d;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return d.toLocaleDateString();
  }

  function scrollToBottom() {
    window.scrollTo(0, document.body.scrollHeight);
  }

  function scrollIntoViewKindle(el) {
    if (!el) return;
    try {
      if (el.scrollIntoView) { el.scrollIntoView(false); }
      else {
        var r = el.getBoundingClientRect();
        window.scrollTo(0, (window.pageYOffset || 0) + r.top - 50);
      }
    } catch (e) { window.scrollTo(0, document.body.scrollHeight); }
  }

  // Validate session ID format
  function validateSessionId(id) {
    if (!id || !id.trim()) return 'Session ID cannot be empty.';
    if (!SESSION_ID_RE.test(id.trim())) {
      return 'Only letters, numbers, hyphens (-) and underscores (_) allowed. 3-64 chars.';
    }
    return null; // valid
  }

  // === SESSION MANAGEMENT ===
  function findSession(id) {
    for (var i = 0; i < state.sessions.length; i++) {
      if (state.sessions[i].id === id) return state.sessions[i];
    }
    return null;
  }

  function upsertSession(id, mode) {
    var s = findSession(id);
    if (!s) {
      s = { id: id, mode: mode || state.mode, preview: '', time: Date.now(), lastResponseId: null };
      state.sessions.unshift(s);
    }
    return s;
  }

  function touchSession(id, preview, responseId) {
    var s = upsertSession(id);
    if (preview) s.preview = preview.substring(0, 80);
    if (responseId) s.lastResponseId = responseId;
    s.time = Date.now();
    // Bubble to top
    var idx = state.sessions.indexOf(s);
    if (idx > 0) { state.sessions.splice(idx, 1); state.sessions.unshift(s); }
    saveMeta();
  }

  function deleteSession(id) {
    // Purge any legacy completions-mode blob left on the device.
    try { localStorage.removeItem(LS_MSG_PREFIX + id); } catch (e) { /* silent */ }
    state.sessions = state.sessions.filter(function (s) { return s.id !== id; });
    saveMeta();
  }

  // === SERVER SESSIONS API ===
  // Fetches recent sessions via the official Hermes API (/api/sessions)
  // Proxied through the typewriter proxy to the gateway's api_server.
  // Requires API key authentication (same as completions API)
  function fetchServerSessions(callback) {
    if (!state.serverUrl) {
      if (callback) callback(null);
      return;
    }
    var ctrl = new AbortController();
    var tid = setTimeout(function () { ctrl.abort(); }, 8000);

    // Official Hermes endpoint (proxied): GET /api/sessions
    fetch(state.serverUrl + '/api/sessions?limit=15', {
      headers: headers(), // Include Authorization header
      signal: ctrl.signal
    })
      .then(function (r) {
        clearTimeout(tid);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var serverSessions = data.data || []; // official shape: {object:"list", data:[...]}
        console.log('[hermes] Fetched ' + serverSessions.length + ' sessions from server');
        if (callback) callback(serverSessions);
      })
      .catch(function (err) {
        clearTimeout(tid);
        console.log('[hermes] Failed to fetch sessions:', err.message);
        if (callback) callback(null);
      });
  }

  // Set sessions from server response (server is source of truth, no local merge)
  function setSessionsFromServer(serverSessions) {
    if (!serverSessions || serverSessions.length === 0) {
      state.sessions = [];
      return;
    }
    
    var sessions = [];
    for (var j = 0; j < serverSessions.length; j++) {
      var ss = serverSessions[j];
      
      // Handle timestamp: use started_at_iso (from our endpoint) or started_at (raw timestamp)
      var sessionTime = Date.now();
      // Official /api/sessions shape: started_at is a unix timestamp (float)
      if (ss.started_at) {
        sessionTime = ss.started_at * 1000; // Unix timestamp (seconds) to ms
      } else if (ss.started_at_iso) {
        sessionTime = new Date(ss.started_at_iso).getTime();
      }
      
      sessions.push({
        id: ss.id,
        mode: state.mode, // Use current mode setting
        preview: ss.preview || '',
        title: ss.title || null,
        source: ss.source || null,
        message_count: ss.message_count || 0,
        model: ss.model || null,
        time: sessionTime
      });
    }
    
    state.sessions = sessions;
  }

  // === API HEADERS ===
  function headers(includeSession) {
    var h = { 'Content-Type': 'application/json' };
    if (state.apiKey) h['Authorization'] = 'Bearer ' + state.apiKey;
    if (includeSession && state.activeSession) {
      h['X-Hermes-Session-Id'] = state.activeSession;
    }
    return h;
  }

  // === TOKEN USAGE ===
  // Compact "1.2k" formatting for e-ink status lines.
  function formatTokens(n) {
    if (n == null || isNaN(n)) return '0';
    n = Math.round(n);
    if (n >= 1000) {
      var k = n / 1000;
      return (k >= 100 ? String(Math.round(k)) : String(Math.round(k * 10) / 10)) + 'k';
    }
    return String(n);
  }

  // Normalize the two usage shapes backends emit:
  // OpenAI-style {input_tokens, output_tokens, total_tokens} and
  // chat-completions-style {prompt_tokens, completion_tokens, total_tokens}.
  function normalizeUsage(u) {
    if (!u) return null;
    var inp = u.input_tokens != null ? u.input_tokens : u.prompt_tokens;
    var out = u.output_tokens != null ? u.output_tokens : u.completion_tokens;
    var tot = u.total_tokens != null ? u.total_tokens : ((inp || 0) + (out || 0));
    return { input: inp || 0, output: out || 0, total: tot || 0 };
  }

  // Fold a finished turn's usage into the session total and repaint the header.
  function recordUsage(sessionId, msg) {
    if (!sessionId || !msg || !msg.usage) return;
    state.usage[sessionId] = (state.usage[sessionId] || 0) + (msg.usage.total || 0);
    saveUsage();
    renderUsageTotal();
  }

  function renderUsageTotal() {
    if (!E['usage-total']) return;
    var t = state.activeSession ? (state.usage[state.activeSession] || 0) : 0;
    E['usage-total'].textContent = t > 0 ? '∑ ' + formatTokens(t) : '';
  }

  // === HEALTH CHECK ===
  function checkHealth(manual) {
    if (manual) E['test-connection-btn'].textContent = '[...]';
    var ctrl = new AbortController();
    var tid = setTimeout(function () { ctrl.abort(); }, 6000);
    // Use /v1/models — requires auth, so a 401 correctly shows as disconnected
    fetch(state.serverUrl + '/v1/models', { headers: headers(), signal: ctrl.signal })
      .then(function (r) {
        clearTimeout(tid);
        state.connected = r.ok;
        state.lastError = r.ok ? null : 'Auth failed (' + r.status + ')';
        renderStatus();
        if (manual) E['test-connection-btn'].textContent = r.ok ? '[OK!]' : '[ERR ' + r.status + ']';
      })
      .catch(function (err) {
        clearTimeout(tid);
        state.connected = false;
        state.lastError = err.message || 'Connection failed';
        renderStatus();
        if (manual) E['test-connection-btn'].textContent = '[FAIL]';
      })
      .finally(function () {
        if (manual) setTimeout(function () { E['test-connection-btn'].textContent = '[TEST]'; }, 2500);
      });
  }

  // === SEND MESSAGE (mode dispatcher) ===
  function sendMessage(text) {
    if (state.sending || !text.trim()) return;
    state.sending = true;
    state.userAborted = false;
    updateInputState();

    var userMsg = { role: 'user', content: text, tools: [] };
    state.messages.push(userMsg);
    renderMessages();

    var session = findSession(state.activeSession);
    if (!session) return;

    doResponses(text, session);
  }

  // ─── COMPLETIONS MODE: REMOVED ──────────────────────────────────────────────
  // /v1/chat/completions support was gutted; the responses path is the only
  // transport. Its tool events were the weaker of the two anyway: the SSE
  // carried only {tool, toolCallId, status, emoji, label} with NO output and
  // NO elapsed time, so every tool card needed a second history round-trip
  // to be useful. /v1/responses emits real function_call_output items with
  // the output inline, which is strictly better.

  // ─── RESPONSES MODE ──────────────────────────────────────────────────────────
  function doResponses(text, session) {
    showTyping(true);
    var ctrl = new AbortController();
    state.activeCtrl = ctrl; // hoisted so [STOP] can abort the in-flight request
    var tid = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);

    // Push the assistant bubble up front so deltas can paint into it as they
    // arrive (Kindle e-ink: showing partial text beats a blank page).
    var assistantMsg = { role: 'assistant', content: '', tools: [] };
    state.messages.push(assistantMsg);
    renderMessages();

    var body = {
      model: 'hermes-agent',
      input: text,
      store: true,
      stream: true,
      instructions: DEFAULT_INST
    };
    // Use conversation name = session ID for server-side response chaining
    body.conversation = session.id;

    console.log('[hermes] Streaming POST /v1/responses, conversation:', session.id);
    fetch(state.serverUrl + '/v1/responses', {
      method: 'POST',
      headers: headers(false), // no session header — responses uses conversation param
      body: JSON.stringify(body),
      signal: ctrl.signal
    })
      .then(function (r) {
        clearTimeout(tid);
        if (!r.ok) {
          return r.text().then(function (t) {
            throw new Error('HTTP ' + r.status + ': ' + (t.substring(0, 200) || 'error'));
          });
        }
        var ct = (r.headers && r.headers.get) ? (r.headers.get('Content-Type') || '') : '';
        if (ct.indexOf('text/event-stream') !== -1 && r.body && r.body.getReader) {
          return pumpResponsesStream(r, assistantMsg, session);
        }
        // Fallback for builds that ignore stream:true and return plain JSON.
        return r.json().then(function (data) {
          var msg = parseResponseData(data);
          assistantMsg.content = msg.content;
          assistantMsg.tools = msg.tools;
          if (data.usage) assistantMsg.usage = normalizeUsage(data.usage);
          if (data.id) {
            state.latestResponseId = data.id;
            if (data.previous_response_id && !state.earliestResponseId) {
              state.earliestResponseId = data.previous_response_id;
            }
            touchSession(session.id, assistantMsg.content, data.id);
          }
        });
      })
      .then(function () {
        if (assistantMsg.content) touchSession(session.id, assistantMsg.content, state.latestResponseId);
        recordUsage(session.id, assistantMsg);
        saveMeta();
        updateHasEarlier();
        renderMessages();
      })
      .catch(function (err) {
        if (state.userAborted) {
          // [STOP] pressed: keep the partial turn, skip the error bubble.
          state.userAborted = false;
          state.lastError = null;
          if (assistantMsg.content) touchSession(session.id, assistantMsg.content, state.latestResponseId);
          recordUsage(session.id, assistantMsg);
          renderMessages();
          return;
        }
        var errMsg = err.message || String(err);
        console.error('[hermes] Responses error:', errMsg);
        state.lastError = errMsg;
        // Reuse the placeholder bubble instead of leaving a blank one behind.
        if (!assistantMsg.content && assistantMsg.tools.length === 0) {
          assistantMsg.role = 'error';
          assistantMsg.content = errMsg;
        } else {
          state.messages.push({ role: 'error', content: errMsg, tools: [] });
        }
        renderMessages();
      })
      .finally(function () {
        state.activeCtrl = null;
        state.sending = false;
        showTyping(false);
        updateInputState();
        removeCursor();
      });
  }

  // ─── RESPONSES MODE: SSE CONSUMER ────────────────────────────────────────────
  // Consumes the spec-compliant SSE that api_server emits for stream:true
  // (gateway/platforms/api_server.py `_write_sse_responses`). Event types:
  //   response.created                 — envelope, carries the response id
  //   response.output_item.added       — item.type ∈ function_call |
  //                                      function_call_output | message
  //   response.output_item.done        — finalized item (carries arguments)
  //   response.output_text.delta       — streamed assistant text
  //   response.output_text.done        — authoritative full text for the item
  //   response.completed               — terminal envelope w/ output + usage
  //   response.failed                  — terminal error
  function pumpResponsesStream(response, msg, session) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buf = '';

    function handleEvent(evtName, payload) {
      if (!payload) return;
      var d;
      try { d = JSON.parse(payload); } catch (e) { return; } // partial block
      var type = d.type || evtName;

      if (type === 'response.output_text.delta') {
        if (typeof d.delta === 'string') msg.content += d.delta;
        updateLastMessage(msg);
      } else if (type === 'response.output_text.done') {
        if (typeof d.text === 'string') msg.content = d.text;
        updateLastMessage(msg);
      } else if (type === 'response.output_item.added') {
        var item = d.item || {};
        if (item.type === 'function_call') {
          var args = '';
          try {
            var p = JSON.parse(item.arguments || '{}');
            var k = Object.keys(p);
            if (k.length > 0) args = String(p[k[0]]);
          } catch (e2) { args = (item.arguments || ''); }
          msg.tools.push({
            name: item.name || 'tool', icon: '\u26A1', args: args,
            isComplete: false, callId: item.call_id || '', t0: Date.now()
          });
          updateTypingTool(item.name || 'tool');
          updateLastMessage(msg);
        } else if (item.type === 'reasoning') {
          // Forward-compatible: accumulate reasoning summaries if the backend
          // ever emits them. Rendered collapsed under [THOUGHT].
          var rtxt = '';
          if (Array.isArray(item.summary)) {
            for (var si = 0; si < item.summary.length; si++) {
              var sp = item.summary[si];
              rtxt += (typeof sp === 'string') ? sp : (sp.text || '');
            }
          } else if (typeof item.content === 'string') {
            rtxt = item.content;
          }
          if (rtxt) {
            msg.reasoning = (msg.reasoning || '') + rtxt;
            updateLastMessage(msg);
          }
        } else if (item.type === 'function_call_output') {
          attachToolOutput(msg, item.call_id, item.output);
          updateLastMessage(msg);
        }
      } else if (type === 'response.reasoning_summary_text.delta') {
        if (typeof d.delta === 'string' && d.delta) {
          msg.reasoning = (msg.reasoning || '') + d.delta;
          updateLastMessage(msg);
        }
      } else if (type === 'response.output_item.done') {
        var it = d.item || {};
        if (it.type === 'function_call') {
          for (var t = 0; t < msg.tools.length; t++) {
            if (msg.tools[t].callId && msg.tools[t].callId === it.call_id) {
              msg.tools[t].isComplete = true;
              msg.tools[t].elapsed = Date.now() - (msg.tools[t].t0 || Date.now());
              break;
            }
          }
          updateLastMessage(msg);
        }
      } else if (type === 'response.completed') {
        var resp = d.response || {};
        if (resp.id) {
          state.latestResponseId = resp.id;
          if (resp.previous_response_id && !state.earliestResponseId) {
            state.earliestResponseId = resp.previous_response_id;
          }
        }
        // Token usage envelope — folded into the session total on completion.
        if (resp.usage) msg.usage = normalizeUsage(resp.usage);
        // Safety net: if no deltas painted (or text was tool-only), take the
        // terminal envelope's output as the source of truth.
        if (!msg.content && resp.output) {
          var parsed = parseResponseData(resp);
          msg.content = parsed.content;
          if (parsed.tools.length) msg.tools = parsed.tools;
        }
      } else if (type === 'response.failed') {
        var fr = d.response || {};
        throw new Error((fr.error && fr.error.message) || 'response failed');
      }
    }

    function parseBlock(block) {
      var lines = block.split('\n');
      var name = '';
      var dataLines = [];
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i];
        if (ln.indexOf('event:') === 0) name = ln.substring(6).trim();
        else if (ln.indexOf('data:') === 0) dataLines.push(ln.substring(5).trim());
      }
      if (dataLines.length) handleEvent(name, dataLines.join('\n'));
    }

    function read() {
      return reader.read().then(function (result) {
        if (result.done) {
          if (buf.trim()) parseBlock(buf);
          return;
        }
        buf += decoder.decode(result.value, { stream: true });
        // SSE events are separated by a blank line — split on \n\n and keep
        // the trailing partial block in the buffer.
        var blocks = buf.split('\n\n');
        buf = blocks.pop() || '';
        for (var i = 0; i < blocks.length; i++) parseBlock(blocks[i]);
        return read();
      });
    }

    return read();
  }

  // ─── TOOL OUTPUT ATTACHMENT ──────────────────────────────────────────────────
  // Both the chat-completions path and the responses SSE path need to bind a
  // tool result to the badge that requested it. Rows/calls are linked by
  // call_id; an orphan (call outside our window) gets a synthesized badge so
  // output is never silently dropped.
  // The Responses API's function_call_output carries `output` as a LIST of
  // content parts — [{type:"input_text", text:"..."}] — not a string. Feeding
  // that straight to textContent renders "[object Object]", which is exactly
  // what the first live test showed. Flatten every shape to plain text.
  function normalizeToolOutput(o) {
    if (o == null) return '';
    if (typeof o === 'string') return o;
    if (Array.isArray(o)) {
      var parts = [];
      for (var i = 0; i < o.length; i++) {
        var t = normalizeToolOutput(o[i]);
        if (t) parts.push(t);
      }
      return parts.join('\n');
    }
    if (typeof o === 'object') {
      if (typeof o.text === 'string') return o.text;
      if (typeof o.output === 'string') return o.output;
      if (typeof o.content === 'string') return o.content;
      try { return JSON.stringify(o); } catch (e) { return String(o); }
    }
    return String(o);
  }

  function attachToolOutput(msg, callId, output) {
    // Store the FULL output — truncation is the badge's job, not storage's.
    var out = normalizeToolOutput(output);
    var found = -1;
    for (var i = msg.tools.length - 1; i >= 0; i--) {
      if (msg.tools[i].callId && msg.tools[i].callId === callId) { found = i; break; }
    }
    if (found >= 0) {
      msg.tools[found].output = out;
      msg.tools[found].isComplete = true;
      msg.tools[found].elapsed = Date.now() - (msg.tools[found].t0 || Date.now());
    } else if (callId) {
      msg.tools.push({
        name: 'tool', icon: '\u26A1', args: '', output: out,
        isComplete: true, callId: callId
      });
    }
    return msg;
  }

  // ─── HISTORY PAGING (both modes) ─────────────────────────────────────────────
  // `hasEarlier` means "the server has older rows we haven't loaded". It is
  // driven by `historyHasMore` (from the pagination block on the messages
  // endpoint), NOT by turn count — the old turn-count version silently produced
  // `false` on the old completions path, which used to be the default, so
  // [Load earlier] never appeared and past the last maxTurns*2 messages a
  // session was unviewable.
  function updateHasEarlier() {
    state.hasEarlier = !!state.historyHasMore;
    updateLoadEarlierUI();
  }

  // Fetch one page of older rows for the active session and prepend them.
  // Pages backwards from the oldest row we currently hold.
  function loadEarlierHistory() {
    var id = state.activeSession;
    if (!id || state.historyLoading || !state.historyHasMore) return;
    state.historyLoading = true;
    E['load-earlier-btn'].textContent = '[Loading...]';

    var pageSize = 100;
    var url = state.serverUrl + '/api/sessions/' + id + '/messages'
            + '?limit=' + pageSize + '&order=latest&offset=' + state.historyOffset;

    fetch(url, { headers: headers(false) })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var rows = data.data || [];
        var pg = data.pagination || {};
        var older = mergeRowsToMessages(rows);
        if (older.length) {
          state.messages = older.concat(state.messages);
        }
        // Advance the offset by what the server actually returned.
        state.historyOffset += rows.length;
        // NOTE: the messages endpoint's `pagination` block carries only
        // {limit, offset, order, returned} — it does NOT report `has_more`
        // (that field exists on the sessions LIST handler, not this one).
        // So infer it: a full page means more may follow.
        state.historyHasMore = rows.length >= pageSize;
        saveMeta();
        updateHasEarlier();
        renderMessages();
      })
      .catch(function (err) {
        E['load-earlier-btn'].textContent = '[ERR: ' + (err.message || 'Failed') + ']';
        setTimeout(function () { E['load-earlier-btn'].textContent = '[Load earlier messages...]'; }, 2000);
        return;
      })
      .finally(function () {
        state.historyLoading = false;
        E['load-earlier-btn'].textContent = '[Load earlier messages...]';
      });
  }

  // Paging always goes through the history endpoint. The responses chain is a
  // continuation mechanism, not a history source: `previous_response_id` only
  // exists for turns this device sent, so chain-paging silently showed nothing
  // for foreign sessions.
  function loadEarlier() {
    return loadEarlierHistory();
  }

  // ─── RESPONSE PARSING ────────────────────────────────────────────────────────
  function parseResponseData(data) {
    var msg = { role: 'assistant', content: '', tools: [] };
    if (data.output && Array.isArray(data.output)) {
      for (var i = 0; i < data.output.length; i++) {
        var item = data.output[i];
        if (item.type === 'function_call') {
          var name = item.name || 'tool';
          var args = '';
          try {
            var p = JSON.parse(item.arguments || '{}');
            var k = Object.keys(p);
            if (k.length > 0) args = String(p[k[0]]);
          } catch (e) { args = (item.arguments || ''); }
          msg.tools.push({ name: name, icon: '\u26A1', args: args, isComplete: true, callId: item.call_id || '' });
        } else if (item.type === 'function_call_output') {
          for (var j = msg.tools.length - 1; j >= 0; j--) {
            if (msg.tools[j].callId === item.call_id) {
              msg.tools[j].output = normalizeToolOutput(item.output);
              break;
            }
          }
        } else if (item.type === 'message') {
          var content = item.content;
          if (Array.isArray(content)) {
            for (var k2 = 0; k2 < content.length; k2++) {
              if (content[k2].type === 'output_text') {
                msg.content += replaceEmoji(content[k2].text || '');
              }
            }
          } else if (typeof content === 'string') {
            msg.content += replaceEmoji(content);
          }
        }
      }
    }
    return msg;
  }

  function responseToMessages(data) {
    var msgs = [];
    // Extract user turn from input field
    if (data.input) {
      var txt = '';
      if (typeof data.input === 'string') {
        txt = data.input;
      } else if (Array.isArray(data.input)) {
        for (var i = 0; i < data.input.length; i++) {
          if (data.input[i] && data.input[i].content) { txt = data.input[i].content; break; }
        }
      }
      if (txt) msgs.push({ role: 'user', content: txt, tools: [] });
    }
    // Extract assistant turn from output
    if (data.output) {
      var m = parseResponseData(data);
      if (m.content || m.tools.length) msgs.push(m);
    }
    return msgs;
  }

  // === RENDERING ===
  function renderStatus() {
    var icon = state.connected ? '\u25CF' : '\u25CB'; // ● / ○
    var s = icon + (state.connected ? ' ONLINE' : ' OFFLINE');
    if (state.lastError && !state.connected) s = '\u25CB OFFLINE: ' + state.lastError.substring(0, 20);
    E['status'].textContent = s;
    E['status'].className = 'status status--' + (state.connected ? 'online' : 'offline');
  }

  function renderModeBadge() {
    // One transport now — say what it actually is instead of a mode toggle.
    if (E['mode-badge']) { E['mode-badge'].textContent = '\u2630 SSE'; }
    if (E['chat-mode-badge']) { E['chat-mode-badge'].textContent = '\u2630'; }
    if (E['mode-hint']) {
      E['mode-hint'].textContent = 'Streams from /v1/responses. History paged from server.';
    }
  }

  function showView(name) {
    E['sessions-view'].style.display = name === 'sessions' ? '' : 'none';
    E['chat-view'].style.display = name === 'chat' ? '' : 'none';
    if (name === 'sessions') renderSessionsList();
  }

  function renderSessionsList() {
    // Show loading state
    E['sessions-list'].innerHTML = '<div class="loading-state"><p class="muted">Loading sessions...</p></div>';
    E['sessions-empty'].style.display = 'none';
    
    // Check if we have an API key before fetching
    if (!state.apiKey) {
      E['sessions-list'].innerHTML = '';
      E['sessions-empty'].style.display = '';
      E['sessions-empty'].innerHTML = '<p>API key required.</p><p class="muted">Open [SETTINGS] and enter your API key.</p>';
      return;
    }
    
    // Clear local sessions - server is source of truth
    state.sessions = [];
    
    // Fetch from server, then render
    fetchServerSessions(function(serverSessions) {
      if (serverSessions) {
        // Replace sessions entirely from server
        setSessionsFromServer(serverSessions);
      } else {
        // Auth failed or network error - show message
        E['sessions-list'].innerHTML = '';
        E['sessions-empty'].style.display = '';
        E['sessions-empty'].innerHTML = '<p>Failed to load sessions.</p><p class="muted">Check your API key in [SETTINGS].</p>';
        return;
      }
      _renderSessionsListInner();
    });
  }
  
  function _renderSessionsListInner() {
    E['sessions-list'].innerHTML = '';
    if (state.sessions.length === 0) {
      E['sessions-empty'].style.display = '';
      return;
    }
    E['sessions-empty'].style.display = 'none';
    var frag = document.createDocumentFragment();
    for (var i = 0; i < state.sessions.length; i++) {
      (function (s) {
        var btn = document.createElement('button');
        btn.className = 'thread-item' + (s.id === state.activeSession ? ' thread-item--active' : '');

        // Session name or title
        var nm = document.createElement('span');
        nm.className = 'thread-name';
        // Show title if available, otherwise show ID
        nm.textContent = s.title || s.id;
        btn.appendChild(nm);

        // Source badge (discord, telegram, cli, api_server)
        if (s.source) {
          var src = document.createElement('span');
          src.className = 'session-source-pill';
          src.textContent = s.source.substring(0, 3); // 'dis', 'tel', 'cli', 'api'
          btn.appendChild(src);
        }

        if (s.preview) {
          var pv = document.createElement('span');
          pv.className = 'thread-preview';
          pv.textContent = s.preview;
          btn.appendChild(pv);
        }
        
        // Meta: message count + time
        var meta = document.createElement('span');
        meta.className = 'thread-meta';
        var metaText = '';
        if (s.message_count) metaText += s.message_count + ' msgs';
        if (s.time) {
          if (metaText) metaText += ' • ';
          metaText += formatTime(s.time);
        }
        meta.textContent = metaText;
        btn.appendChild(meta);
        
        // Delete button (2-step confirm for Kindle compatibility)
        var del = document.createElement('button');
        del.className = 'btn btn--sm btn--delete';
        del.textContent = '[DEL]';
        del.setAttribute('aria-label', 'Delete session ' + s.id);
        
        var confirmTimeout = null;
        del.onclick = function (ev) {
          ev.stopPropagation();
          if (del.textContent === '[SURE?]') {
            deleteSession(s.id);
            renderSessionsList();
          } else {
            del.textContent = '[SURE?]';
            del.style.background = 'var(--ink)';
            del.style.color = 'var(--paper)';
            // Revert after 3 seconds if not confirmed
            if (confirmTimeout) clearTimeout(confirmTimeout);
            confirmTimeout = setTimeout(function() {
              del.textContent = '[DEL]';
              del.style.background = '';
              del.style.color = '';
            }, 3000);
          }
        };
        btn.appendChild(del);

        btn.onclick = function () { openSession(s.id); };
        frag.appendChild(btn);
      })(state.sessions[i]);
    }
    E['sessions-list'].appendChild(frag);
  }

  function renderMessages() {
    E['messages'].innerHTML = '';
    if (state.messages.length === 0) {
      var emp = document.createElement('div');
      emp.className = 'empty-state';
      emp.innerHTML = '<p class="muted">Start typing below.</p>';
      E['messages'].appendChild(emp);
      return;
    }

    // Kindle perf guard: render only the newest window, but say so HONESTLY.
    // Older rows are still in state.messages and reachable via [Load earlier]
    // (which pages the history endpoint) — they are NOT "stored locally".
    var msgs = state.messages;
    var session = findSession(state.activeSession);
    var window = state.maxTurns * 2;
    if (msgs.length > window) {
      var hidden = msgs.length - window;
      msgs = msgs.slice(-window);
      var note = document.createElement('div');
      note.className = 'load-earlier-note';
      note.textContent = '[... ' + hidden + ' older message'
        + (hidden === 1 ? '' : 's') + ' — use [Load earlier] ...]';
      E['messages'].appendChild(note);
    }

    var frag = document.createDocumentFragment();
    for (var i = 0; i < msgs.length; i++) {
      frag.appendChild(buildMessageEl(msgs[i]));
    }
    E['messages'].appendChild(frag);
    scrollToBottom();
  }

  // === TOOL CARDS / REASONING BUILDERS ===

  // Per-tool emoji, mirroring the server's tools/registry emoji fields. The
  // LIVE streaming path gets a real glyph in `d.emoji`, but the /api/sessions
  // history path carries only `tool_name` — without this map every historical
  // badge would collapse to one generic bolt. Regenerate with:
  //   ~/.hermes/skills/productivity/kindle-frontend-pipeline/scripts/collect_tool_emojis.py
  var TOOL_EMOJI = {
    "annotate_preview": "\uD83D\uDD16",
    "apply_layout": "\uD83E\uDDF1",
    "browser_back": "\u2B05",
    "browser_cdp": "\uD83E\uDDEA",
    "browser_click": "\uD83D\uDC46",
    "browser_console": "\uD83D\uDDA5\uFE0F",
    "browser_dialog": "\uD83D\uDCAC",
    "browser_exec": "\uD83C\uDF10",
    "browser_get_images": "\uD83D\uDDBC\uFE0F",
    "browser_navigate": "\uD83C\uDF10",
    "browser_press": "\u2328\uFE0F",
    "browser_scroll": "\uD83D\uDCDC",
    "browser_snapshot": "\uD83D\uDCF8",
    "browser_type": "\u2328\uFE0F",
    "browser_vision": "\uD83D\uDC41\uFE0F",
    "clarify": "\u2753",
    "close_terminal": "\uD83D\uDDA5\uFE0F",
    "cronjob": "\u23F0",
    "delegate_task": "\uD83D\uDD00",
    "desktop_preview": "\uD83D\uDDBC\uFE0F",
    "drive_preview": "\uD83D\uDDB1\uFE0F",
    "execute_code": "\uD83D\uDC0D",
    "focus_pane": "\uD83E\uDE9F",
    "ha_call_service": "\uD83C\uDFE0",
    "ha_get_state": "\uD83C\uDFE0",
    "ha_list_entities": "\uD83C\uDFE0",
    "ha_list_services": "\uD83C\uDFE0",
    "image_generation": "\uD83C\uDFA8",
    "kanban_attach": "\uD83D\uDCCE",
    "kanban_attach_url": "\uD83D\uDCCE",
    "kanban_attachments": "\uD83D\uDCCE",
    "kanban_block": "\u23F8",
    "kanban_comment": "\uD83D\uDCAC",
    "kanban_complete": "\u2714",
    "kanban_create": "\u2795",
    "kanban_heartbeat": "\uD83D\uDC93",
    "kanban_link": "\uD83D\uDD17",
    "kanban_list": "\uD83D\uDCCB",
    "kanban_request_changes": "\u23CE",
    "kanban_request_review": "\uD83D\uDC40",
    "kanban_show": "\uD83D\uDCCB",
    "kanban_unblock": "\u23F5",
    "memory": "\uD83E\uDDE0",
    "patch": "\uD83D\uDD27",
    "process": "\u2699\uFE0F",
    "read_file": "\uD83D\uDCD6",
    "react_to_message": "\uD83D\uDC9B",
    "search_files": "\uD83D\uDD0E",
    "terminal": "\uD83D\uDCBB",
    "write_file": "\u270D\uFE0F"
  };

  // Resolve a tool's glyph: explicit emoji from the stream, else the map,
  // else a lightning bolt so the badge is never blank.
  function toolEmoji(name, explicit) {
    if (explicit) return explicit;
    if (name && TOOL_EMOJI[name]) return TOOL_EMOJI[name];
    return '\u26A1';
  }

  function toolEmojiFor(tool) {
    return toolEmoji(tool.name, tool.icon && tool.icon !== '\u26A1' ? tool.icon : null);
  }

  // Kindle has no emoji font: a raw glyph renders as tofu. Emit the prebuilt
  // PNG instead. Assets are named U<5-hex-per-codepoint>.png and carry NO
  // FE0F (VS16) variant — leaving the selector in produces a guaranteed 404,
  // so variation selectors and ZWJ are stripped during the lookup.
  function emojiImg(ch, cls) {
    var img = document.createElement('img');
    img.className = cls || 'emoji';
    img.alt = ch || '';
    var name = 'U';
    for (var i = 0; i < ch.length; i++) {
      var cp = ch.charCodeAt(i);
      if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < ch.length) {
        var lo = ch.charCodeAt(i + 1);
        if (lo >= 0xDC00 && lo <= 0xDFFF) {
          cp = ((cp - 0xD800) << 10) + (lo - 0xDC00) + 0x10000;
          i++;
        }
      }
      if (cp === 0xFE0F || cp === 0xFE0E || cp === 0x200D) continue;
      name += ('00000' + cp.toString(16).toUpperCase()).slice(-5);
    }
    img.src = '/emoji/' + name + '.png';
    // Unknown glyph: hide the spacer rather than show a broken-image box.
    img.onerror = function () { this.style.visibility = 'hidden'; };
    return img;
  }

  // Badge preview only — this is the SHORT form. The full args/output live in
  // the expanded detail row, which is deliberately untruncated.
  function truncatePreview(s, n) {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    if (s.length <= n) return s;
    return s.slice(0, n - 1) + '\u2026';
  }

  // Full detail for one tool: emoji + name, complete args, elapsed, and the
  // ENTIRE output (no substring cap — the point of expanding is to see it all).
  function buildToolDetail(tool) {
    var frag = document.createDocumentFragment();

    var head = document.createElement('div');
    head.className = 'tool-detail-head';
    head.appendChild(emojiImg(toolEmojiFor(tool), 'emoji'));
    var nm = document.createElement('span');
    nm.textContent = ' ' + (tool.name || 'tool') +
      (tool.isComplete ? '' : ' \u2014 RUNNING');
    head.appendChild(nm);
    frag.appendChild(head);

    if (tool.args) {
      var a = document.createElement('div');
      a.className = 'tool-detail-args';
      a.textContent = tool.args;
      frag.appendChild(a);
    }
    if (tool.elapsed != null) {
      var t = document.createElement('div');
      t.className = 'tool-detail-time';
      t.textContent = 'TIME ' + tool.elapsed + 'ms';
      frag.appendChild(t);
    }
    var outTxt = normalizeToolOutput(tool.output);
    if (outTxt) {
      var o = document.createElement('pre');
      o.className = 'tool-detail-out';
      o.textContent = outTxt;
      frag.appendChild(o);
    }
    return frag;
  }

  // Toggle the detail row for one badge. Tapping the same badge again hides it.
  function toggleToolDetail(msg, idx, detailEl) {
    if (!detailEl) return;
    if (detailEl.style.display !== 'none' && detailEl._toolIdx === idx) {
      detailEl.style.display = 'none';
      detailEl._toolIdx = -1;
      return;
    }
    var tool = msg.tools[idx];
    if (!tool) return;
    detailEl._toolIdx = idx;
    detailEl.innerHTML = '';
    detailEl.appendChild(buildToolDetail(tool));
    detailEl.style.display = '';
  }

  // Badges are real <button>s (48px touch targets). Clicking toggles detail.
  // Badge text is the SHORT preview; emoji renders as a PNG (no emoji font).
  function makeToolBadge(tool, idx, msg, detailEl) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'badge' + (tool.isComplete ? ' badge--complete' : ' badge--active');
    b.appendChild(emojiImg(toolEmojiFor(tool), 'emoji'));
    var txt = document.createElement('span');
    txt.textContent = ' ' + (tool.name || 'tool') +
      (tool.args ? ' ' + truncatePreview(tool.args, 40) : '');
    b.appendChild(txt);
    b.setAttribute('aria-label', 'Tool details: ' + (tool.name || 'tool'));
    b.onclick = function () { toggleToolDetail(msg, idx, detailEl); };
    return b;
  }

  // Collapsed reasoning block. Button toggle (not <details> — flaky on old
  // WebKit). Collapsed by default; raw text in <pre>, no markdown inside.
  function buildReasoningEl(msg) {
    var wrap = document.createElement('div');
    wrap.className = 'reasoning';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--sm reasoning-toggle';
    btn.textContent = '[THOUGHT]';
    btn.setAttribute('aria-label', 'Toggle reasoning display');
    var pre = document.createElement('pre');
    pre.className = 'reasoning-text';
    pre.style.display = 'none';
    pre.textContent = msg.reasoning || '';
    btn.onclick = function () {
      var open = pre.style.display === 'none';
      pre.style.display = open ? '' : 'none';
      wrap.className = 'reasoning' + (open ? ' reasoning--open' : '');
      btn.textContent = open ? '[HIDE]' : '[THOUGHT]';
    };
    wrap.appendChild(btn);
    wrap.appendChild(pre);
    return wrap;
  }

  // Badges live BELOW the prose (they are a footnote to the turn, not a
  // header), and the row WRAPS instead of scrolling sideways — the old
  // side-scroller hid every tool past the first couple on a 6" screen.
  function buildToolsBlock(msg) {
    var wrap = document.createElement('div');
    wrap.className = 'tools-block';

    var tc = document.createElement('div');
    tc.className = 'tools-container';
    var detail = document.createElement('div');
    detail.className = 'tool-detail';
    detail.style.display = 'none';
    detail._toolIdx = -1;
    for (var i = 0; i < msg.tools.length; i++) {
      tc.appendChild(makeToolBadge(msg.tools[i], i, msg, detail));
    }
    wrap.appendChild(tc);
    wrap.appendChild(detail);
    return wrap;
  }

  function buildMessageEl(msg) {
    var el = document.createElement('article');
    el.className = 'message message--' + msg.role;

    var role = document.createElement('span');
    role.className = 'message-role';
    role.textContent = msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'Hermes' : 'Error';
    el.appendChild(role);

    // Reasoning (collapsed) sits above the prose.
    if (msg.reasoning) {
      el.appendChild(buildReasoningEl(msg));
    }

    if (msg.content) {
      var c = document.createElement('div');
      c.className = 'message-content';
      c.innerHTML = renderMarkdown(msg.content);
      el.appendChild(c);
    }

    // Per-turn token cost, straight from the server's usage envelope.
    if (msg.role === 'assistant' && msg.usage) {
      var u = document.createElement('div');
      u.className = 'usage-line';
      u.textContent = '▸ ' + formatTokens(msg.usage.input) + ' in · ' +
        formatTokens(msg.usage.output) + ' out';
      el.appendChild(u);
    }

    // Tool badges + shared detail row, LAST so they sit under the message.
    if (msg.tools && msg.tools.length > 0) {
      el.appendChild(buildToolsBlock(msg));
    }

    // Apply Twemoji to convert emoji to images (Kindle-safe)
    applyTwemoji(el);

    return el;
  }

  // Markdown re-render throttle for e-ink: marked.parse on every token chunk
  // crushes Kindle's JIT-less CPU. Full render at most every 800ms; between
  // renders show escaped plain text + cursor. Completion always re-renders
  // fully via renderMessages().
  var MD_RENDER_MS = 800;

  function updateLastMessage(msg) {
    var all = E['messages'].querySelectorAll('.message');
    var last = all[all.length - 1];
    if (!last) { renderMessages(); return; }

    // Live-update reasoning block
    if (msg.reasoning) {
      var rz = last.querySelector('.reasoning');
      if (!rz) {
        rz = buildReasoningEl(msg);
        var c0 = last.querySelector('.message-content');
        if (c0) last.insertBefore(rz, c0); else last.appendChild(rz);
      } else {
        var rpre = rz.querySelector('.reasoning-text');
        if (rpre) rpre.textContent = msg.reasoning;
      }
    }

    // Live-update tool badges. The whole block is re-appended at the END so
    // badges stay below the prose as it streams in; the detail row is a
    // sibling of the badge row so its open state survives the rebuild.
    var tc = last.querySelector('.tools-container');
    if (msg.tools && msg.tools.length > 0) {
      var detail = last.querySelector('.tool-detail');
      if (!tc) {
        var block = buildToolsBlock(msg);
        last.appendChild(block);
        tc = block.querySelector('.tools-container');
        detail = block.querySelector('.tool-detail');
      }
      // Re-anchor below prose: content/usage may have been appended after us.
      var tblock = tc.parentNode;
      last.appendChild(tblock);
      tc.innerHTML = '';
      for (var i = 0; i < msg.tools.length; i++) {
        tc.appendChild(makeToolBadge(msg.tools[i], i, msg, detail));
      }
      // Side-scrolling row: keep the newest badge in view as tools arrive.
      tc.scrollLeft = tc.scrollWidth;
      // Keep an open detail row in sync with the tool it shows.
      if (detail && detail.style.display !== 'none' && detail._toolIdx >= 0) {
        var dt = msg.tools[detail._toolIdx];
        if (dt) {
          detail.innerHTML = '';
          detail.appendChild(buildToolDetail(dt));
        } else { detail.style.display = 'none'; detail._toolIdx = -1; }
      }
    }

    // Live-update content with streaming cursor (throttled markdown)
    var c = last.querySelector('.message-content');
    if (!c) {
      c = document.createElement('div');
      c.className = 'message-content';
      last.appendChild(c);
    }
    var now = Date.now();
    if (msg._lastMdRender && (now - msg._lastMdRender) < MD_RENDER_MS && msg.content) {
      // Fast path: escaped text only, no marked.parse.
      c.textContent = msg.content;
      var cur = document.createElement('span');
      cur.className = 'streaming-cursor';
      cur.textContent = '_';
      c.appendChild(cur);
    } else {
      msg._lastMdRender = now;
      c.innerHTML = renderMarkdown(msg.content) + '<span class="streaming-cursor">_</span>';
    }

    // Apply Twemoji to new content
    applyTwemoji(c);

    scrollToBottom();
  }

  function removeCursor() {
    var cs = document.querySelectorAll('.streaming-cursor');
    for (var i = 0; i < cs.length; i++) {
      if (cs[i].parentNode) cs[i].parentNode.removeChild(cs[i]);
    }
  }

  // === TYPING INDICATOR ===
  var _typingInterval = null;
  var _typingDots = 0;
  var _lastToolName = null;
  
  function showTyping(on, toolName) {
    if (on) {
      E['typing-indicator'].style.display = '';
      // Track tool name for display
      _lastToolName = toolName || null;
      // Start animated ellipsis (e-ink safe - no CSS animations)
      if (_typingInterval) clearInterval(_typingInterval);
      _typingDots = 0;
      _typingInterval = setInterval(function () {
        _typingDots = (_typingDots + 1) % 4;
        var dots = ['', '.', '..', '...'][_typingDots];
        var text = _lastToolName 
          ? _lastToolName.toUpperCase() + dots 
          : 'HERMES IS WRITING' + dots;
        E['typing-indicator'].querySelector('.muted').textContent = text;
      }, 500);
      scrollToBottom();
    } else {
      E['typing-indicator'].style.display = 'none';
      _lastToolName = null;
      if (_typingInterval) {
        clearInterval(_typingInterval);
        _typingInterval = null;
      }
    }
  }
  
  function updateTypingTool(toolName) {
    // Update the typing indicator to show current tool
    // Make sure typing indicator is visible during tool calls
    if (E['typing-indicator'].style.display === 'none') {
      showTyping(true, toolName);
    } else if (_typingInterval) {
      _lastToolName = toolName;
    }
  }

  function updateInputState() {
    E['message-input'].disabled = state.sending;
    E['send-btn'].disabled = state.sending;
    // While sending, [SEND] is replaced by [STOP] — aborting the in-flight
    // request is the fastest way to stop burning tokens on a bad turn.
    E['send-btn'].style.display = state.sending ? 'none' : '';
    E['stop-btn'].style.display = state.sending ? '' : 'none';
  }

  // Abort the in-flight generation. The partial turn is kept (see the catch
  // response handlers); nothing is converted to an error.
  function stopGeneration() {
    if (!state.sending || !state.activeCtrl) return;
    state.userAborted = true;
    try { state.activeCtrl.abort(); } catch (e) { /* already settled */ }
  }

  function updateLoadEarlierUI() {
    E['load-earlier'].style.display = state.hasEarlier ? '' : 'none';
  }

  function applyDarkMode() {
    var root = document.documentElement;
    if (state.dark) {
      root.classList.add('dark-mode');
      root.classList.remove('light-mode');
    } else {
      root.classList.remove('dark-mode');
      root.classList.add('light-mode');
    }
  }

  function toggleSettings() {
    var isOff = E['settings-panel'].style.display === 'none';
    E['settings-panel'].style.display = isOff ? '' : 'none';
    if (isOff) {
      E['setting-url'].value = state.serverUrl;
      E['setting-key'].value = state.apiKey;
      E['setting-max-turns'].value = state.maxTurns;
      E['setting-dark-mode'].checked = !!state.dark;
      renderModeBadge();
    }
  }

  function saveSettings() {
    state.serverUrl = E['setting-url'].value.trim() || DEFAULT_URL;
    state.apiKey = E['setting-key'].value.trim();
    state.maxTurns = parseInt(E['setting-max-turns'].value, 10) || DEFAULT_TURNS;
    state.dark = !!E['setting-dark-mode'].checked;
    
    // Mode is no longer user-selectable; responses is the only transport.
    state.mode = 'responses';
    if (state.activeSession) {
      var s = findSession(state.activeSession);
      if (s) s.mode = 'responses';
    }

    applyDarkMode();
    saveMeta();
    toggleSettings(); // Close panel
    renderModeBadge();
    checkHealth(false);
    renderSessionsList();
  }

  // === SESSION OPEN ===
  function openSession(id) {
    var session = upsertSession(id);
    state.activeSession = id;
    state.messages = [];
    state.latestResponseId = null;
    state.earliestResponseId = null;
    state.hasEarlier = false;
    state.lastError = null;
    // Reset history paging for the newly opened session.
    state.historyOffset = 0;
    state.historyHasMore = false;
    state.historyLoading = false;
    updateLoadEarlierUI();

    E['session-title'].textContent = id;
    E['chat-mode-badge'].textContent = '\u2630';
    renderUsageTotal();
    showView('chat');
    updateLoadEarlierUI();

    // History is loaded from the official endpoint in BOTH modes — it is the
    // authoritative view of a session regardless of how it was created. The
    // responses chain is only a continuation mechanism (it lets RESP mode
    // append to a conversation), not a history source: relying on it meant a
    // session created anywhere else (Discord, CLI, cron) rendered EMPTY in
    // responses mode, because lastResponseId only exists for sessions this
    // device sent via RESP.
    // History comes from the official endpoint (authoritative for sessions
    // created anywhere — Discord, CLI, cron — not just this device).
    state.messages = [];
    renderMessages();
    loadSessionHistory(id);

    E['message-input'].focus();
  }

  // Build a readable turn list from raw message rows, merging tool rows into
  // the assistant message that called them. Shared by the initial history
  // fetch and by [Load earlier] paging, so both produce identical shapes.
  //
  // Two row quirks the official API exhibits, both handled here:
  //  1. An assistant turn is split across MULTIPLE consecutive assistant rows
  //     (text row, then tool-call rows). Emitting each as its own message made
  //     a single turn look like a pile of `[*] tool` blocks with no prose.
  //  2. User rows occasionally carry empty content (attachments, markers).
  //     Rendering nothing made the opening turn an invisible blank box.
  function mergeRowsToMessages(rows) {
    var msgs = [];
    var cur = null; // assistant message currently being accumulated

    function flush() {
      if (cur && (cur.content || cur.tools.length)) msgs.push(cur);
      cur = null;
    }

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];

      if (row.role === 'user') {
        flush();
        var uc = row.content || '';
        if (!uc.trim()) {
          // No text to show — surface the row rather than emitting a blank box.
          var kind = row.display_kind ? String(row.display_kind) : '';
          uc = kind ? '[' + kind + ']' : '[no text content]';
        }
        msgs.push({ role: 'user', content: uc, tools: [] });

      } else if (row.role === 'assistant') {
        // Consecutive assistant rows belong to the SAME turn — accumulate.
        if (!cur) cur = { role: 'assistant', content: '', tools: [] };
        if (row.content) {
          cur.content += (cur.content ? '\n\n' : '') + row.content;
        }
        var tcs = row.tool_calls || [];
        for (var t = 0; t < tcs.length; t++) {
          var fn = (tcs[t] && tcs[t].function) || {};
          var args = '';
          try {
            var p = JSON.parse(fn.arguments || '{}');
            var k = Object.keys(p);
            if (k.length > 0) args = String(p[k[0]]);
          } catch (e) { args = (fn.arguments || ''); }
          cur.tools.push({
            name: fn.name || row.tool_name || 'tool',
            icon: '\u26A1', args: args, isComplete: true,
            callId: tcs[t].id || tcs[t].call_id || ''
          });
        }

      } else if (row.role === 'tool') {
        var out = (row.content || '');
        if (!cur) cur = { role: 'assistant', content: '', tools: [] };
        var attached = false;
        for (var j = 0; j < cur.tools.length; j++) {
          if (cur.tools[j].callId && cur.tools[j].callId === row.tool_call_id) {
            cur.tools[j].output = out;
            attached = true;
            break;
          }
        }
        if (!attached) {
          // Orphan output (the calling row fell outside our window) — keep it
          // visible with a synthesized badge rather than dropping it.
          cur.tools.push({
            name: row.tool_name || 'tool', icon: '\u26A1', args: '',
            output: out, isComplete: true, callId: row.tool_call_id || ''
          });
        }
      }
      // role:"error"/other rows are skipped — not part of a readable turn
    }
    flush();
    return msgs;
  }

  // ─── SESSION HISTORY (official /api/sessions/{id}/messages) ─────────────────
  // Loads the newest page of a session from the server and merges it with any
  // locally stored messages. The server is the source of truth; local storage
  // is only an offline cache for sessions sent from this device.
  //
  // Paging: offset 0 == newest page (order=latest). Older rows are fetched by
  // [Load earlier] via loadEarlierHistory(), which increments historyOffset.
  function loadSessionHistory(id, callback) {
    if (!state.serverUrl) { if (callback) callback(null); return; }
    var ctrl = new AbortController();
    // 12s is the Kindle budget. Keep it generous but bounded — a silent abort
    // used to leave the view on "Loading..." with no explanation.
    var tid = setTimeout(function () { ctrl.abort(); }, 20000);
    var pageSize = 100;

    fetch(state.serverUrl + '/api/sessions/' + id + '/messages?limit=' + pageSize + '&order=latest', {
      headers: headers(false),
      signal: ctrl.signal
    })
      .then(function (r) {
        clearTimeout(tid);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var rows = data.data || [];
        console.log('[hermes] History fetch: ' + rows.length + ' rows for ' + id);
        var msgs = mergeRowsToMessages(rows);

        if (state.activeSession === id) {
          // Server history supersedes local: it covers gaps (turns that happened
          // on other devices) and is authoritative. Local messages not present in
          // the server window (e.g. the in-flight turn) are preserved on top.
          var localMsgs = state.messages || [];
          var lastLocalUser = null;
          for (var m = localMsgs.length - 1; m >= 0; m--) {
            if (localMsgs[m].role === 'user') { lastLocalUser = localMsgs[m]; break; }
          }
          var lastServerUser = null;
          for (var s2 = msgs.length - 1; s2 >= 0; s2--) {
            if (msgs[s2].role === 'user') { lastServerUser = msgs[s2]; break; }
          }
          var tail = [];
          if (lastLocalUser && (!lastServerUser || lastLocalUser.content !== lastServerUser.content)) {
            var idx = localMsgs.indexOf(lastLocalUser);
            if (idx >= 0) tail = localMsgs.slice(idx);
          }
          state.messages = msgs.concat(tail);
          // Paging bookkeeping: offset 0 page is in hand; a full page implies
          // the server may hold older rows.
          state.historyOffset = rows.length;
          state.historyHasMore = rows.length >= pageSize;
          updateHasEarlier();
          renderMessages();
        }
        if (callback) callback(msgs);
      })
      .catch(function (err) {
        clearTimeout(tid);
        console.warn('[hermes] History fetch failed:', err.message);
        // Surface the failure instead of leaving a blank chat view.
        if (state.activeSession === id && state.messages.length === 0) {
          state.messages = [{
            role: 'error',
            content: 'Could not load session history (' + (err.message || 'failed') + ').',
            tools: []
          }];
          renderMessages();
        }
        if (callback) callback(null);
      });
  }

  // === FORM VALIDATION HELPERS ===
  function showFormError(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.style.display = msg ? '' : 'none';
  }

  // === EVENT BINDING ===
  function bindEvents() {
    // Refresh sessions
    E['refresh-sessions-btn'].addEventListener('click', function () {
      E['refresh-sessions-btn'].textContent = '[...]';
      renderSessionsList();
      setTimeout(function () { E['refresh-sessions-btn'].textContent = '[\u21BB]'; }, 1000);
    });
    
    // New session
    E['new-session-btn'].addEventListener('click', function () {
      E['new-session-form'].style.display = '';
      E['new-session-input'].value = '';
      showFormError(E['new-session-error'], '');
      E['new-session-input'].focus();
    });
    E['new-session-cancel'].addEventListener('click', function () {
      E['new-session-form'].style.display = 'none';
    });

    function tryCreateSession() {
      var id = E['new-session-input'].value.trim();
      var err = validateSessionId(id);
      if (err) { showFormError(E['new-session-error'], err); return; }
      showFormError(E['new-session-error'], '');
      E['new-session-form'].style.display = 'none';
      upsertSession(id, state.mode); // stamp with current mode
      saveMeta();
      openSession(id);
    }

    E['new-session-create'].addEventListener('click', tryCreateSession);
    E['new-session-input'].addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); tryCreateSession(); }
    });

    // Rejoin
    function tryRejoin() {
      var id = E['rejoin-input'].value.trim();
      var err = validateSessionId(id);
      if (err) { showFormError(E['rejoin-error'], err); return; }
      showFormError(E['rejoin-error'], '');
      E['rejoin-input'].value = '';
      // If session doesn't exist locally, create stub with current mode
      if (!findSession(id)) upsertSession(id, state.mode);
      saveMeta();
      openSession(id);
    }
    E['rejoin-btn'].addEventListener('click', tryRejoin);
    E['rejoin-input'].addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); tryRejoin(); }
    });


    E['settings-toggle'].addEventListener('click', toggleSettings);
    E['settings-save'].addEventListener('click', saveSettings);

    E['test-connection-btn'].addEventListener('click', function () {
      state.serverUrl = E['setting-url'].value.trim() || state.serverUrl;
      checkHealth(true);
    });

    // Back - refresh sessions when returning to list
    E['back-btn'].addEventListener('click', function () {
      showView('sessions');
      renderSessionsList(); // Refresh from server
    });

    // Load earlier (responses mode paging)
    E['load-earlier-btn'].addEventListener('click', loadEarlier);

    // Send
    E['send-btn'].addEventListener('click', function () {
      var text = E['message-input'].value;
      if (text.trim()) {
        sendMessage(text.trim());
        E['message-input'].value = '';
        autoGrow();
      }
    });

    // Stop
    E['stop-btn'].addEventListener('click', stopGeneration);
    E['message-input'].addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); E['send-btn'].click(); }
    });
    E['message-input'].addEventListener('input', autoGrow);
    E['message-input'].addEventListener('focus', function () {
      setTimeout(function () { scrollIntoViewKindle(E['message-input']); }, 150);
    });

    // Escape: abort generation first, otherwise close forms
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        if (state.sending) { stopGeneration(); return; }
        if (E['new-session-form'].style.display !== 'none') {
          E['new-session-form'].style.display = 'none';
        } else if (E['settings-panel'].style.display !== 'none') {
          E['settings-panel'].style.display = 'none';
        }
      }
    });
  }

  function autoGrow() {
    var el = E['message-input'];
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
  }

  // === INIT ===
  function init() {
    window.onerror = function (msg, src, ln) {
      console.error('[hermes]', msg, src, ln);
      return false;
    };
    window.addEventListener('unhandledrejection', function (e) {
      console.error('[hermes] Promise error:', e.reason);
    });

    cacheDom();
    loadMeta();
    state.usage = loadUsage();

    renderModeBadge();
    bindEvents();
    renderSessionsList();
    checkHealth();
    setInterval(checkHealth, 30000);
    
    // If no API key, open settings on first load
    if (!state.apiKey) {
      toggleSettings();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
