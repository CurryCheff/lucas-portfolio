/* ============================================
   CHATBOT
   Floating terminal-styled chat widget backed by
   /api/chat (a Vercel serverless function that calls
   Gemini). No API key here — this only ever talks to
   our own /api/chat endpoint. Matches the global
   window.initX() pattern used by the other components.
   ============================================ */

(function () {
  window.initChatbot = function initChatbot() {
    const root = document.getElementById('chatbot');
    const toggle = document.getElementById('chatbotToggle');
    const panel = document.getElementById('chatbotPanel');
    const closeBtn = document.getElementById('chatbotClose');
    const body = document.getElementById('chatbotBody');
    const form = document.getElementById('chatbotForm');
    const input = document.getElementById('chatbotInput');

    if (!root || !toggle || !panel || !closeBtn || !body || !form || !input) {
      return { destroy: () => {} };
    }

    // Backstop only. Deliberately longer than the server's own 35s Gemini
    // timeout, so when the server is reachable its more specific message
    // wins — this exists for the case where the connection itself dies and
    // the request would otherwise never settle, leaving the input disabled
    // forever with no way out but a page reload.
    const REQUEST_TIMEOUT_MS = 45000;

    // Running history, sent with every request so the model has context.
    // In-memory only — nothing persisted, nothing requested. Trimmed to the
    // last MAX_HISTORY turns so a long session doesn't grow the request
    // body linearly (the backend caps what it forwards to Gemini too, this
    // just keeps what we send over the wire bounded).
    const MAX_HISTORY = 20;
    const messages = [];
    const pushMessage = (msg) => {
      messages.push(msg);
      if (messages.length > MAX_HISTORY) messages.splice(0, messages.length - MAX_HISTORY);
    };
    let sending = false;
    let open = false;

    const scrollToBottom = () => {
      body.scrollTop = body.scrollHeight;
    };

    const addMessage = (role, text) => {
      const el = document.createElement('div');
      el.className = 'chatbot__message chatbot__message--' + (role === 'user' ? 'user' : 'bot');

      const prompt = document.createElement('span');
      prompt.className = 'chatbot__message-prompt';
      prompt.textContent = role === 'user' ? '$' : '>';

      const textEl = document.createElement('span');
      textEl.className = 'chatbot__message-text';
      textEl.textContent = text;

      el.appendChild(prompt);
      el.appendChild(textEl);
      body.appendChild(el);
      scrollToBottom();
      return el;
    };

    const setOpen = (next) => {
      open = next;
      toggle.setAttribute('aria-expanded', String(open));
      panel.setAttribute('aria-hidden', String(!open));
      root.classList.toggle('chatbot--open', open);
      if (open) {
        requestAnimationFrame(() => input.focus());
        scrollToBottom();
      }
    };

    const onToggleClick = () => setOpen(!open);
    const onCloseClick = () => setOpen(false);

    const onSubmit = async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || sending) return;

      input.value = '';
      addMessage('user', text);
      pushMessage({ role: 'user', content: text });

      sending = true;
      input.disabled = true;
      const pendingEl = addMessage('bot', '…');

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages }),
        });
        const data = await res.json().catch(() => ({}));
        const pendingText = pendingEl.querySelector('.chatbot__message-text');

        if (!res.ok || !data.reply) {
          pendingText.textContent = data.error || 'Something went wrong — try again, or reach out directly.';
        } else {
          pendingText.textContent = data.reply;
          pushMessage({ role: 'model', content: data.reply });
        }
      } catch (err) {
        pendingEl.querySelector('.chatbot__message-text').textContent =
          err.name === 'AbortError'
            ? 'That took too long — try again, or reach out directly.'
            : 'Connection issue — try again, or reach out directly.';
      } finally {
        clearTimeout(timeout);
        sending = false;
        input.disabled = false;
        scrollToBottom();
      }
    };

    toggle.addEventListener('click', onToggleClick);
    closeBtn.addEventListener('click', onCloseClick);
    form.addEventListener('submit', onSubmit);

    return {
      destroy: () => {
        toggle.removeEventListener('click', onToggleClick);
        closeBtn.removeEventListener('click', onCloseClick);
        form.removeEventListener('submit', onSubmit);
      },
    };
  };
})();
