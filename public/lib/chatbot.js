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

    // Full running history, sent with every request so the model has
    // context. In-memory only — nothing persisted, nothing requested.
    const messages = [];
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
      messages.push({ role: 'user', content: text });

      sending = true;
      input.disabled = true;
      const pendingEl = addMessage('bot', '…');

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages }),
        });
        const data = await res.json().catch(() => ({}));
        const pendingText = pendingEl.querySelector('.chatbot__message-text');

        if (!res.ok || !data.reply) {
          pendingText.textContent = data.error || 'Something went wrong — try again, or reach out directly.';
        } else {
          pendingText.textContent = data.reply;
          messages.push({ role: 'model', content: data.reply });
        }
      } catch (err) {
        pendingEl.querySelector('.chatbot__message-text').textContent =
          'Connection issue — try again, or reach out directly.';
      } finally {
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
