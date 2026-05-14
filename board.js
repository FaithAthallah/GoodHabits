/* ============================================================
   SOMEHABITS — board.js
   Features:
   - In-memory post store with sample data
   - Create post (title, body, category, author, image upload)
   - Masonry card rendering with like, expand, zoom
   - Per-post AI chat via Anthropic API
   - Filter by category + sort
   - Image lightbox
   ============================================================ */

/* ── AI System Prompt ───────────────────────────────────────── */
const SYSTEM_PROMPT = `You are Vera, a warm, knowledgeable AI wellness coach for "SomeHabits" — a community habit board where people share their health journeys.

A user has shared a post about their habit or experience. Your role is to:
- Give thoughtful, encouraging, science-backed feedback on their specific post
- Answer any questions they have about the habit or topic
- Suggest improvements, variations, or next steps
- Celebrate their effort and progress

Your tone is:
- Warm, supportive, and non-judgmental
- Evidence-based — no bro-science, no fads
- Concise: keep responses under 180 words unless a detailed plan is asked for
- Use 1–2 relevant emojis max per response

You are NOT a replacement for medical advice. Always recommend a doctor for health concerns.`;

/* ── Utility: get initials from name ────────────────────────── */
function initials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

/* ── Utility: format date ───────────────────────────────────── */
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ── Utility: truncate ──────────────────────────────────────── */
function truncate(str, n) {
  return str.length > n ? str.slice(0, n).trim() + '…' : str;
}

/* ── Category emoji map ─────────────────────────────────────── */
const CAT_EMOJI = {
  'Fitness': '🏋️',
  'Nutrition': '🥗',
  'Mindfulness': '🧘',
  'Recovery': '😴',
  'Morning Routine': '🌅',
  'Mental Health': '🧠',
};

/* ════════════════════════════════════════════════════════════
   POST STORE
   ════════════════════════════════════════════════════════════ */
let posts = [];

let nextId = 7;
let activeFilter = 'all';
let activeSort = 'newest';

/* ── AI chat history per post ───────────────────────────────── */
const chatHistories = {};

/* active post id for AI modal */
let activePostId = null;

/* ── API Key storage ───────────────────────────────────────── */
const getApiKey = (provider) => localStorage.getItem(`${provider}_api_key`);
const setApiKey = (provider, key) => localStorage.setItem(`${provider}_api_key`, key);
const clearApiKey = (provider) => localStorage.removeItem(`${provider}_api_key`);
const getCurrentProvider = () => localStorage.getItem('ai_provider') || 'anthropic';

/* ── AI API call helper ───────────────────────────────────── */
async function callAiApi(provider, apiKey, messages, systemPrompt) {
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-opus-20240229',
        max_tokens: 1000,
        system: systemPrompt,
        messages,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || 'API error');
    }

    const data = await res.json();
    return data.content.filter(b => b.type === 'text').map(b => b.text).join('');

  } else if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        max_tokens: 1000,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || 'API error');
    }

    const data = await res.json();
    return data.choices[0].message.content;

  }

  throw new Error('Unsupported provider');
}

/* ════════════════════════════════════════════════════════════
   RENDER
   ════════════════════════════════════════════════════════════ */
function getFilteredSorted() {
  let list = activeFilter === 'all'
    ? [...posts]
    : posts.filter(p => p.category === activeFilter);

  if (activeSort === 'newest') list.sort((a, b) => b.ts - a.ts);
  else if (activeSort === 'oldest') list.sort((a, b) => a.ts - b.ts);
  else if (activeSort === 'likes') list.sort((a, b) => b.likes - a.likes);

  return list;
}

function renderBoard() {
  const board = document.getElementById('board');
  const empty = document.getElementById('empty-state');
  const list  = getFilteredSorted();

  board.innerHTML = '';

  if (list.length === 0) {
    board.hidden = true;
    empty.hidden = false;
    return;
  }
  board.hidden = false;
  empty.hidden = true;

  list.forEach((post, i) => {
    const card = buildCard(post, i);
    board.appendChild(card);
  });

  updatePostCount();
}

function buildCard(post, index) {
  const card = document.createElement('article');
  card.className = 'post-card';
  card.dataset.id = post.id;
  card.style.animationDelay = `${index * 0.06}s`;

  const emoji = CAT_EMOJI[post.category] || '📌';
  const LONG = 280;
  const isLong = post.body.length > LONG;
  const snippet = isLong ? post.body.slice(0, LONG).trim() + '…' : post.body;

  card.innerHTML = `
    ${post.image ? `
    <div class="post-card__img-wrap" data-post-id="${post.id}" role="button" tabindex="0" aria-label="Zoom image">
      <img class="post-card__img" src="${post.image}" alt="${post.title}" loading="lazy" />
      <div class="post-card__img-overlay">
        <span class="post-card__zoom-hint">🔍 Click to expand</span>
      </div>
    </div>` : ''}
    <div class="post-card__body">
      <div class="post-card__top">
        <span class="post-card__cat">${emoji} ${post.category}</span>
        <span class="post-card__date">${fmtDate(post.ts)}</span>
      </div>
      <h3 class="post-card__title">${post.title}</h3>
      <p class="post-card__body-text ${isLong ? 'clamped' : ''}" data-full="${encodeURIComponent(post.body)}" data-short="${encodeURIComponent(snippet)}">${snippet}</p>
      ${isLong ? `<button class="post-card__readmore" data-expanded="false">Read more</button>` : ''}
      <footer class="post-card__footer">
        <div class="post-card__author">
          <div class="post-card__author-avatar">${initials(post.author)}</div>
          <span>${post.author}</span>
        </div>
        <div class="post-card__actions">
          <button class="post-card__like-btn ${post.liked ? 'liked' : ''}" data-post-id="${post.id}" aria-label="Like post">
            ${post.liked ? '❤️' : '🤍'} <span class="like-count">${post.likes}</span>
          </button>
          <button class="post-card__ai-btn" data-post-id="${post.id}" aria-label="Ask AI about this post">
            🤖 Ask AI
          </button>
        </div>
      </footer>
    </div>
  `;

  // Like button
  card.querySelector('.post-card__like-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleLike(post.id, card);
  });

  // AI button
  card.querySelector('.post-card__ai-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openAiModal(post.id);
  });

  // Read more
  card.querySelector('.post-card__readmore')?.addEventListener('click', () => {
    const btn  = card.querySelector('.post-card__readmore');
    const para = card.querySelector('.post-card__body-text');
    const expanded = btn.dataset.expanded === 'true';
    if (expanded) {
      para.textContent = decodeURIComponent(para.dataset.short);
      para.classList.add('clamped');
      btn.textContent = 'Read more';
      btn.dataset.expanded = 'false';
    } else {
      para.textContent = decodeURIComponent(para.dataset.full);
      para.classList.remove('clamped');
      btn.textContent = 'Show less';
      btn.dataset.expanded = 'true';
    }
  });

  // Image zoom
  const imgWrap = card.querySelector('.post-card__img-wrap');
  if (imgWrap) {
    imgWrap.addEventListener('click', () => openLightbox(post.image, post.title));
    imgWrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') openLightbox(post.image, post.title);
    });
  }

  return card;
}

function updatePostCount() {
  const el = document.getElementById('post-count');
  if (el) el.textContent = posts.length;
}

/* ════════════════════════════════════════════════════════════
   LIKE
   ════════════════════════════════════════════════════════════ */
function toggleLike(postId, card) {
  const post = posts.find(p => p.id === postId);
  if (!post) return;
  post.liked = !post.liked;
  post.likes += post.liked ? 1 : -1;

  const btn   = card.querySelector(`.post-card__like-btn[data-post-id="${postId}"]`);
  const count = btn?.querySelector('.like-count');
  if (btn)   { btn.classList.toggle('liked', post.liked); }
  if (btn)   { btn.firstChild.textContent = post.liked ? '❤️' : '🤍'; }
  if (count) { count.textContent = post.likes; }
}

/* ════════════════════════════════════════════════════════════
   CREATE POST
   ════════════════════════════════════════════════════════════ */
let uploadedImageDataUrl = null;

function openCreateModal() {
  document.getElementById('create-modal').hidden = false;
  document.getElementById('create-overlay').hidden = false;
  document.getElementById('post-author').focus();
}

function closeCreateModal() {
  document.getElementById('create-modal').hidden = true;
  document.getElementById('create-overlay').hidden = true;
  document.getElementById('create-form').reset();
  document.getElementById('body-count').textContent = '0';
  clearImagePreview();
}

function clearImagePreview() {
  uploadedImageDataUrl = null;
  document.getElementById('image-preview').hidden = true;
  document.getElementById('image-drop-inner').hidden = false;
  document.getElementById('remove-image-btn').hidden = true;
  document.getElementById('post-image').value = '';
}

function initCreateForm() {
  const openBtns = [
    document.getElementById('fab-btn'),
  ];
  openBtns.forEach(b => b?.addEventListener('click', openCreateModal));

  const closeBtns = [
    document.getElementById('close-create-btn'),
    document.getElementById('cancel-create-btn'),
  ];
  closeBtns.forEach(b => b?.addEventListener('click', closeCreateModal));
  document.getElementById('create-overlay')?.addEventListener('click', closeCreateModal);

  // Body char count
  const bodyTA = document.getElementById('post-body');
  bodyTA?.addEventListener('input', () => {
    document.getElementById('body-count').textContent = bodyTA.value.length;
  });

  // Image upload
  const fileInput = document.getElementById('post-image');
  const drop      = document.getElementById('image-drop');
  const preview   = document.getElementById('image-preview');
  const inner     = document.getElementById('image-drop-inner');
  const removeBtn = document.getElementById('remove-image-btn');

  function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) { alert('Image must be under 5MB.'); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      uploadedImageDataUrl = e.target.result;
      preview.src = uploadedImageDataUrl;
      preview.hidden = false;
      inner.hidden = true;
      removeBtn.hidden = false;
    };
    reader.readAsDataURL(file);
  }

  fileInput?.addEventListener('change', () => loadFile(fileInput.files[0]));
  removeBtn?.addEventListener('click', (e) => { e.stopPropagation(); clearImagePreview(); });

  // Drag & drop
  drop?.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragover'); });
  drop?.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop?.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dragover');
    loadFile(e.dataTransfer.files[0]);
  });

  // Submit
  document.getElementById('create-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    submitPost();
  });
}

function submitPost() {
  const author   = document.getElementById('post-author').value.trim();
  const category = document.getElementById('post-category').value;
  const title    = document.getElementById('post-title').value.trim();
  const body     = document.getElementById('post-body').value.trim();

  let valid = true;
  [['post-author', author], ['post-category', category], ['post-title', title], ['post-body', body]].forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (!val) { el.classList.add('invalid'); valid = false; }
    else       { el.classList.remove('invalid'); }
  });
  if (!valid) return;

  const newPost = {
    id: nextId++,
    author,
    category,
    title,
    body,
    image: uploadedImageDataUrl || null,
    likes: 0,
    liked: false,
    ts: Date.now(),
  };

  posts.unshift(newPost);
  closeCreateModal();

  // If filter doesn't match, reset to all
  if (activeFilter !== 'all' && activeFilter !== category) {
    setFilter('all');
  } else {
    renderBoard();
  }

  // Scroll to board
  document.getElementById('board')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ════════════════════════════════════════════════════════════
   FILTER + SORT
   ════════════════════════════════════════════════════════════ */
function setFilter(value) {
  activeFilter = value;
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.classList.toggle('filter-pill--active', pill.dataset.filter === value);
  });
  renderBoard();
}

function initFilters() {
  document.getElementById('filter-pills')?.addEventListener('click', (e) => {
    const pill = e.target.closest('.filter-pill');
    if (!pill) return;
    setFilter(pill.dataset.filter);
  });

  document.getElementById('sort-select')?.addEventListener('change', (e) => {
    activeSort = e.target.value;
    renderBoard();
  });
}

/* ════════════════════════════════════════════════════════════
   AI MODAL
   ════════════════════════════════════════════════════════════ */
function openAiModal(postId) {
  const post = posts.find(p => p.id === postId);
  if (!post) return;

  activePostId = postId;

  // Initialise history for this post if first time
  if (!chatHistories[postId]) {
    chatHistories[postId] = [];
  }

  // Render post context strip
  const ctx = document.getElementById('ai-post-context');
  ctx.innerHTML = `
    ${post.image
      ? `<img class="ai-post-context__img" src="${post.image}" alt="" />`
      : `<div class="ai-post-context__img-placeholder">${CAT_EMOJI[post.category] || '📌'}</div>`
    }
    <div class="ai-post-context__text">
      <div class="ai-post-context__cat">${CAT_EMOJI[post.category] || ''} ${post.category}</div>
      <div class="ai-post-context__title">${post.title}</div>
      <div class="ai-post-context__snippet">${truncate(post.body, 120)}</div>
    </div>
  `;

  // Re-render messages from history
  const messagesEl = document.getElementById('ai-messages');
  messagesEl.innerHTML = '';

  if (chatHistories[postId].length === 0) {
    // Initial bot greeting
    const greeting = buildBubble('bot', `Hey! I've read ${post.author}'s post about "${post.title}". What would you like to know or discuss? I can give feedback, suggest improvements, or answer any questions about this habit 💪`);
    messagesEl.appendChild(greeting);
  } else {
    // Restore previous messages
    chatHistories[postId].forEach(msg => {
      const role = msg.role === 'user' ? 'user' : 'bot';
      messagesEl.appendChild(buildBubble(role, msg.content));
    });
  }

  document.getElementById('ai-modal').hidden = false;
  document.getElementById('ai-overlay').hidden = false;
  document.getElementById('ai-chat-input').focus();
  scrollMessages();
}

function closeAiModal() {
  document.getElementById('ai-modal').hidden = true;
  document.getElementById('ai-overlay').hidden = true;
  activePostId = null;
}

function initAiModal() {
  document.getElementById('close-ai-btn')?.addEventListener('click', closeAiModal);
  document.getElementById('ai-overlay')?.addEventListener('click', closeAiModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!document.getElementById('ai-modal').hidden) closeAiModal();
      if (!document.getElementById('create-modal').hidden) closeCreateModal();
      if (!document.getElementById('lightbox').hidden) closeLightbox();
    }
  });

  // AI chat form
  document.getElementById('ai-chat-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input   = document.getElementById('ai-chat-input');
    const sendBtn = document.getElementById('ai-chat-form').querySelector('button');
    const text    = input.value.trim();
    if (!text || activePostId === null) return;

    input.value = '';
    sendBtn.disabled = true;

    await sendAiMessage(text, activePostId, sendBtn);
    sendBtn.disabled = false;
    input.focus();
  });

  // Suggestion pills
  document.getElementById('ai-suggestions')?.addEventListener('click', (e) => {
    const pill = e.target.closest('.prompt-pill');
    if (!pill || activePostId === null) return;
    const input = document.getElementById('ai-chat-input');
    input.value = pill.dataset.prompt;
    document.getElementById('ai-chat-form').requestSubmit();
  });
}

async function sendAiMessage(userText, postId, sendBtn) {
  const provider = getCurrentProvider();
  const apiKey = getApiKey(provider);
  
  if (!apiKey) {
    alert(`Please add your ${provider} API key in Settings (⚙️) first.`);
    return;
  }

  const post       = posts.find(p => p.id === postId);
  const messagesEl = document.getElementById('ai-messages');

  // User bubble
  messagesEl.appendChild(buildBubble('user', userText));
  scrollMessages();

  // Loading bubble
  const loadingBubble = buildBubble('bot', '');
  loadingBubble.querySelector('.ai-chat__bubble').classList.add('loading');
  messagesEl.appendChild(loadingBubble);
  scrollMessages();

  // Build history with post context prepended
  const postContext = `The user is asking about this community post:\n\nTitle: "${post.title}"\nCategory: ${post.category}\nAuthor: ${post.author}\nPost body: "${post.body}"`;

  const history = chatHistories[postId].length === 0
    ? [{ role: 'user', content: postContext }, { role: 'assistant', content: `Got it! I've read the post. I'm ready to help with any questions about "${post.title}" by ${post.author}.` }]
    : chatHistories[postId];

  const messages = [...history, { role: 'user', content: userText }];

  try {
    const reply = await callAiApi(provider, apiKey, messages, SYSTEM_PROMPT);

    // Update history
    chatHistories[postId] = [
      ...messages,
      { role: 'assistant', content: reply },
    ];

    const bubble = loadingBubble.querySelector('.ai-chat__bubble');
    bubble.classList.remove('loading');
    bubble.textContent = reply;

  } catch (err) {
    const bubble = loadingBubble.querySelector('.ai-chat__bubble');
    bubble.classList.remove('loading');
    bubble.textContent = `⚠️ Error: ${err.message || 'Couldn\'t reach the AI.'}`;
    bubble.style.color = 'rgba(255,120,80,.85)';
  }

  scrollMessages();
}

function buildBubble(role, text) {
  const msg    = document.createElement('div');
  msg.className = `ai-chat__msg ai-chat__msg--${role === 'user' ? 'user' : 'bot'}`;

  const avatar = document.createElement('span');
  avatar.className = 'ai-chat__avatar';
  avatar.textContent = role === 'user' ? '🧑' : '🤖';

  const bubble = document.createElement('div');
  bubble.className = 'ai-chat__bubble';
  bubble.textContent = text;

  msg.appendChild(avatar);
  msg.appendChild(bubble);
  return msg;
}

function scrollMessages() {
  const el = document.getElementById('ai-messages');
  if (el) el.scrollTop = el.scrollHeight;
}

/* ════════════════════════════════════════════════════════════
   SETTINGS MODAL
   ════════════════════════════════════════════════════════════ */
function openSettingsModal() {
  const providerSelect = document.getElementById('ai-provider-select');
  const input = document.getElementById('api-key-input');
  const currentProvider = getCurrentProvider();
  providerSelect.value = currentProvider;
  updateKeyHelp(currentProvider);
  const key = getApiKey(currentProvider);
  input.value = key ? key.substring(0, 10) + '...' : '';
  input.dataset.hasKey = !!key;
  document.getElementById('settings-modal').hidden = false;
  document.getElementById('settings-overlay').hidden = false;
}

function closeSettingsModal() {
  document.getElementById('settings-modal').hidden = true;
  document.getElementById('settings-overlay').hidden = true;
}

function updateKeyHelp(provider) {
  document.getElementById('key-help-anthropic').hidden = provider !== 'anthropic';
  document.getElementById('key-help-openai').hidden = provider !== 'openai';
}

function initSettingsModal() {
  document.getElementById('open-settings-btn')?.addEventListener('click', openSettingsModal);
  document.getElementById('close-settings-btn')?.addEventListener('click', closeSettingsModal);
  document.getElementById('settings-overlay')?.addEventListener('click', closeSettingsModal);

  document.getElementById('ai-provider-select')?.addEventListener('change', (e) => {
    const provider = e.target.value;
    localStorage.setItem('ai_provider', provider);
    updateKeyHelp(provider);
    const key = getApiKey(provider);
    const input = document.getElementById('api-key-input');
    input.value = key ? key.substring(0, 10) + '...' : '';
    input.dataset.hasKey = !!key;
  });

  document.getElementById('save-api-key-btn')?.addEventListener('click', () => {
    const provider = document.getElementById('ai-provider-select').value;
    const input = document.getElementById('api-key-input');
    const key = input.value.trim();
    if (key) {
      setApiKey(provider, key);
      alert('API key saved! ✓');
      closeSettingsModal();
    } else {
      alert('Please enter an API key.');
    }
  });

  document.getElementById('clear-api-key-btn')?.addEventListener('click', () => {
    const provider = document.getElementById('ai-provider-select').value;
    if (confirm('Clear API key?')) {
      clearApiKey(provider);
      document.getElementById('api-key-input').value = '';
      alert('API key cleared.');
    }
  });
}

/* ════════════════════════════════════════════════════════════
   LIGHTBOX
   ════════════════════════════════════════════════════════════ */
function openLightbox(src, alt) {
  const lb  = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  img.src = src;
  img.alt = alt || '';
  lb.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeLightbox() {
  document.getElementById('lightbox').hidden = true;
  document.body.style.overflow = '';
}

function initLightbox() {
  document.getElementById('lightbox-close')?.addEventListener('click', closeLightbox);
  document.getElementById('lightbox')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('lightbox')) closeLightbox();
  });
}

/* ════════════════════════════════════════════════════════════
   INIT
   ════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  renderBoard();
  initCreateForm();
  initFilters();
  initAiModal();
  initSettingsModal();
  initLightbox();
});
