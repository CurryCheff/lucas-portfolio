/* ============================================
   ADMIN DASHBOARD
   Password-gated queue for reviewing testimonial
   submissions. Matches the global window.initX()
   pattern used by the other components.
   ============================================ */

(function () {
  const TOKEN_KEY = 'overboard_admin_token';

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY);
  }
  function setToken(token) {
    sessionStorage.setItem(TOKEN_KEY, token);
  }
  function clearToken() {
    sessionStorage.removeItem(TOKEN_KEY);
  }

  async function authedFetch(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${getToken()}`,
        ...options.headers,
      },
    });
    return res;
  }

  function escapeText(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  window.initAdminDashboard = function initAdminDashboard() {
    const loginScreen = document.getElementById('loginScreen');
    const dashboard = document.getElementById('dashboard');
    const loginForm = document.getElementById('loginForm');
    const passwordInput = document.getElementById('passwordInput');
    const loginError = document.getElementById('loginError');
    const logoutBtn = document.getElementById('logoutBtn');

    const mintForm = document.getElementById('mintForm');
    const clientLabelInput = document.getElementById('clientLabelInput');
    const mintResult = document.getElementById('mintResult');

    const statusFilter = document.getElementById('statusFilter');
    const queueList = document.getElementById('queueList');

    const refreshBatchesBtn = document.getElementById('refreshBatchesBtn');
    const batchList = document.getElementById('batchList');

    function showDashboard() {
      loginScreen.classList.add('state-hidden');
      dashboard.classList.remove('state-hidden');
      loadQueue();
      loadBatches();
    }

    function showLogin() {
      dashboard.classList.add('state-hidden');
      loginScreen.classList.remove('state-hidden');
    }

    async function onLoginSubmit(e) {
      e.preventDefault();
      loginError.classList.add('state-hidden');
      const res = await fetch('/api/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        loginError.textContent = data.error || 'Login failed';
        loginError.classList.remove('state-hidden');
        return;
      }
      setToken(data.token);
      passwordInput.value = '';
      showDashboard();
    }

    function onLogout() {
      clearToken();
      showLogin();
    }

    async function onMintSubmit(e) {
      e.preventDefault();
      mintResult.classList.add('state-hidden');
      const res = await authedFetch('/api/admin-mint-link', {
        method: 'POST',
        body: JSON.stringify({ clientLabel: clientLabelInput.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        mintResult.textContent = data.error || 'Could not create link';
        mintResult.classList.remove('state-hidden');
        return;
      }
      mintResult.textContent = data.link;
      mintResult.classList.remove('state-hidden');
      clientLabelInput.value = '';
      loadQueue();
    }

    function renderQueueItem(row) {
      const el = document.createElement('div');
      el.className = 'queue-item';

      const top = document.createElement('div');
      top.className = 'queue-item__top';
      top.innerHTML = `<span class="queue-item__name">${escapeText(row.author_name || row.client_name)}</span><span class="badge">${row.status}</span>`;
      el.appendChild(top);

      if (row.quote) {
        const quote = document.createElement('p');
        quote.className = 'queue-item__quote';
        quote.textContent = row.quote;
        el.appendChild(quote);
      }

      const meta = document.createElement('p');
      meta.className = 'queue-item__meta';
      meta.textContent = [row.author_role, row.contact_email, row.contact_phone].filter(Boolean).join(' · ');
      el.appendChild(meta);

      if (row.status === 'pending') {
        const actions = document.createElement('div');
        actions.className = 'queue-item__actions';

        const approveBtn = document.createElement('button');
        approveBtn.className = 'btn';
        approveBtn.textContent = 'Approve';
        approveBtn.addEventListener('click', () => review(row.id, 'approve'));

        const rejectBtn = document.createElement('button');
        rejectBtn.className = 'btn btn--danger';
        rejectBtn.textContent = 'Reject';
        rejectBtn.addEventListener('click', () => {
          const note = window.prompt('Rejection note (optional):') || '';
          review(row.id, 'reject', note);
        });

        actions.appendChild(approveBtn);
        actions.appendChild(rejectBtn);
        el.appendChild(actions);
      }

      return el;
    }

    async function review(id, decision, rejectionNote) {
      const res = await authedFetch('/api/admin-review', {
        method: 'POST',
        body: JSON.stringify({ id, decision, rejectionNote }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(data.error || 'Review failed');
        return;
      }
      if (decision === 'approve' && data.publish && data.publish.published) {
        window.alert(`Batch published: ${data.publish.prUrl}`);
      }
      loadQueue();
      loadBatches();
    }

    async function loadQueue() {
      queueList.innerHTML = '<p class="empty-state">Loading…</p>';
      const res = await authedFetch(`/api/admin-queue?status=${encodeURIComponent(statusFilter.value)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        queueList.innerHTML = `<p class="empty-state">${escapeText(data.error || 'Could not load queue')}</p>`;
        return;
      }
      queueList.innerHTML = '';
      if (data.submissions.length === 0) {
        queueList.innerHTML = '<p class="empty-state">Nothing here yet.</p>';
        return;
      }
      data.submissions.forEach((row) => queueList.appendChild(renderQueueItem(row)));
    }

    function renderBatchItem(batch) {
      const el = document.createElement('div');
      el.className = 'batch-item';
      el.innerHTML = `<div class="queue-item__top"><a href="${escapeText(batch.prUrl)}" target="_blank" rel="noopener">PR #${batch.prNumber}</a><span class="badge badge--warn">${batch.itemCount} item(s)</span></div>`;

      const mergeBtn = document.createElement('button');
      mergeBtn.className = 'btn';
      mergeBtn.textContent = 'Merge to production';
      mergeBtn.style.marginTop = '10px';
      mergeBtn.addEventListener('click', () => mergeBatch(batch.prNumber));
      el.appendChild(mergeBtn);

      return el;
    }

    async function mergeBatch(prNumber) {
      const password = window.prompt('Re-enter the admin password to confirm this merge:');
      if (!password) return;
      const res = await authedFetch('/api/admin-merge', {
        method: 'POST',
        body: JSON.stringify({ password, prNumber }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(data.error || 'Merge failed');
        return;
      }
      window.alert('Merged.');
      loadBatches();
    }

    async function loadBatches() {
      batchList.innerHTML = '<p class="empty-state">Loading…</p>';
      const res = await authedFetch('/api/admin-publish');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        batchList.innerHTML = `<p class="empty-state">${escapeText(data.error || 'Could not load batches')}</p>`;
        return;
      }
      batchList.innerHTML = '';
      if (data.batches.length === 0) {
        batchList.innerHTML = '<p class="empty-state">No open batches.</p>';
        return;
      }
      data.batches.forEach((batch) => batchList.appendChild(renderBatchItem(batch)));
    }

    loginForm.addEventListener('submit', onLoginSubmit);
    logoutBtn.addEventListener('click', onLogout);
    mintForm.addEventListener('submit', onMintSubmit);
    statusFilter.addEventListener('change', loadQueue);
    refreshBatchesBtn.addEventListener('click', loadBatches);

    if (getToken()) {
      showDashboard();
    } else {
      showLogin();
    }

    return { destroy: () => {} };
  };
})();
