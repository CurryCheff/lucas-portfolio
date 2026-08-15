/* ============================================
   SUBMIT FORM
   Public testimonial submission form, gated by a
   signed ?t= token in the URL. Matches the global
   window.initX() pattern used by the other components.
   ============================================ */

(function () {
  // Display-only decode — never trusted, purely for showing who the link
  // is for before the real (server-side) check happens on submit.
  //
  // atob() decodes base64 into a binary string (one JS char per byte), not
  // UTF-8 text — feeding that straight to JSON.parse mangles any non-ASCII
  // byte sequence (e.g. an em dash or an accented name) into mojibake.
  // Re-decode the byte string as UTF-8 explicitly before parsing.
  function decodeUnsafe(token) {
    try {
      const payload = String(token).split('.')[0];
      const binary = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const json = new TextDecoder('utf-8').decode(bytes);
      return JSON.parse(json);
    } catch (err) {
      return null;
    }
  }

  window.initSubmitForm = function initSubmitForm() {
    const formState = document.getElementById('formState');
    const doneState = document.getElementById('doneState');
    const invalidState = document.getElementById('invalidState');
    const form = document.getElementById('submitForm');
    const submitBtn = document.getElementById('submitBtn');
    const messageEl = document.getElementById('formMessage');
    const clientLabelLine = document.getElementById('clientLabelLine');

    const params = new URLSearchParams(window.location.search);
    const token = params.get('t');

    if (!token) {
      formState.classList.add('state-hidden');
      invalidState.classList.remove('state-hidden');
      return { destroy: () => {} };
    }

    const claims = decodeUnsafe(token);
    if (claims && claims.sub) {
      clientLabelLine.textContent = `Submitting as ${claims.sub}.`;
    }

    const showMessage = (text, kind) => {
      messageEl.textContent = text;
      messageEl.className = `message message--${kind}`;
    };

    const onSubmit = async (e) => {
      e.preventDefault();
      submitBtn.disabled = true;
      showMessage('', '');
      messageEl.classList.add('state-hidden');

      const body = {
        token,
        quote: document.getElementById('quote').value,
        authorName: document.getElementById('authorName').value,
        authorRole: document.getElementById('authorRole').value,
        phone: document.getElementById('phone').value,
        email: document.getElementById('email').value,
        consent: document.getElementById('consent').checked,
      };

      try {
        const res = await fetch('/api/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          showMessage(data.error || 'Something went wrong — try again.', 'error');
          messageEl.classList.remove('state-hidden');
          submitBtn.disabled = false;
          return;
        }

        formState.classList.add('state-hidden');
        doneState.classList.remove('state-hidden');
      } catch (err) {
        showMessage('Connection issue — try again.', 'error');
        messageEl.classList.remove('state-hidden');
        submitBtn.disabled = false;
      }
    };

    form.addEventListener('submit', onSubmit);

    return {
      destroy: () => form.removeEventListener('submit', onSubmit),
    };
  };
})();
