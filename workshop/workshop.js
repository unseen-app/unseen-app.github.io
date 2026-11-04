'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const source = document.createElement('canvas');
  const scene = document.createElement('canvas');
  const tile = document.createElement('canvas');
  const state = { regions: [], selected: null, history: [], tool: 'solid', color: '#252525', size: 24, soft: false, original: false, ready: false, busy: false, name: 'Пример', serial: 0, turns: 0, cropMode: 'full', cropRect: null, cropping: false, cropDraft: null };
  let drag = null;
  let frame = 0;
  let loadVersion = 0;
  let savedURL = null;
  let savedBlob = null;
  let savedName = '';
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const selected = () => state.regions.find(region => region.id === state.selected);
  const validCrop = () => state.cropDraft && state.cropDraft.w >= 4 && state.cropDraft.h >= 4;
  const snapshot = () => JSON.stringify({ regions: state.regions, turns: state.turns, cropMode: state.cropMode, cropRect: state.cropRect });
  const status = (text, error = false) => { $('status').textContent = text; $('status').classList.toggle('error', error); };

  function restore(previous) {
    Object.assign(state, JSON.parse(previous));
    state.cropping = false;
    state.cropDraft = null;
    $('crop').value = state.cropMode;
  }

  function remember(previous = snapshot()) {
    state.history.push(previous);
    if (state.history.length > 40) state.history.shift();
  }

  function view() {
    if (!state.cropping && state.cropMode === 'custom' && state.cropRect) return { ...state.cropRect };
    if (!state.cropping && state.cropMode === 'avatar') {
      const side = Math.min(source.width, source.height);
      return { x: Math.floor((source.width - side) / 2), y: Math.floor((source.height - side) / 2), w: side, h: side };
    }
    return { x: 0, y: 0, w: source.width, h: source.height };
  }

  function oriented(area = view()) {
    return state.turns % 2 ? { w: area.h, h: area.w } : { w: area.w, h: area.h };
  }

  function outputSize() {
    const size = oriented();
    const limit = $('resize').value === 'original' ? Math.max(size.w, size.h) : $('resize').value === 'custom' ? clamp(Number($('long-edge').value) || 1200, 64, 4096) : Number($('resize').value);
    const scale = Math.min(1, limit / Math.max(size.w, size.h));
    return { w: Math.max(1, Math.round(size.w * scale)), h: Math.max(1, Math.round(size.h * scale)) };
  }

  function rotateContext(c, size) {
    if (state.turns === 1) { c.translate(size.h, 0); c.rotate(Math.PI / 2); }
    if (state.turns === 2) { c.translate(size.w, size.h); c.rotate(Math.PI); }
    if (state.turns === 3) { c.translate(0, size.w); c.rotate(-Math.PI / 2); }
  }

  function paintImage(c, image, area, size) {
    const rotated = oriented(area);
    c.save();
    c.scale(size.w / rotated.w, size.h / rotated.h);
    rotateContext(c, area);
    c.drawImage(image, area.x, area.y, area.w, area.h, 0, 0, area.w, area.h);
    c.restore();
  }

  function paintWatermark(c, size) {
    const label = $('watermark-text').value.trim();
    if (!$('watermark').checked || !label) return;
    const date = $('watermark-date-enabled').checked ? $('watermark-date').value : '';
    const suffix = /^\d{4}-\d{2}-\d{2}$/.test(date) ? ` · ${date.split('-').reverse().join('.')}` : '';
    const text = label + suffix;
    const font = Math.max(10, Math.min(size.w, size.h) * .043);
    c.save();
    c.globalAlpha = Number($('watermark-opacity').value) / 100;
    c.fillStyle = '#252525';
    c.font = `600 ${font}px Golos, Arial, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.translate(size.w / 2, size.h / 2);
    c.rotate(-Math.PI / 6);
    const span = Math.hypot(size.w, size.h);
    const stepX = c.measureText(text).width + font * 3;
    const stepY = font * 4.5;
    for (let row = -Math.ceil(span / stepY); row <= Math.ceil(span / stepY); row++) {
      for (let col = -Math.ceil(span / stepX); col <= Math.ceil(span / stepX); col++) {
        c.fillText(text, col * stepX + (row % 2 ? stepX / 2 : 0), row * stepY);
      }
    }
    c.restore();
  }

  function compose() {
    const c = scene.getContext('2d');
    c.clearRect(0, 0, scene.width, scene.height);
    c.drawImage(source, 0, 0);
    // Opaque masks stay on top even when a later pixel region overlaps them.
    const ordered = [...state.regions.filter(r => r.type === 'pixel'), ...state.regions.filter(r => r.type === 'solid')];
    for (const r of ordered) {
      const x = Math.floor(r.x), y = Math.floor(r.y);
      const w = Math.min(scene.width - x, Math.ceil(r.x + r.w) - x);
      const h = Math.min(scene.height - y, Math.ceil(r.y + r.h) - y);
      c.save();
      c.beginPath();
      c.rect(x, y, w, h);
      c.clip();
      if (r.type === 'solid') {
        c.fillStyle = r.color;
        c.fillRect(x, y, w, h);
      } else {
        tile.width = Math.max(1, Math.ceil(w / r.size));
        tile.height = Math.max(1, Math.ceil(h / r.size));
        const t = tile.getContext('2d');
        t.imageSmoothingEnabled = true;
        t.imageSmoothingQuality = 'high';
        t.drawImage(source, x, y, w, h, 0, 0, tile.width, tile.height);
        c.imageSmoothingEnabled = false;
        if (r.soft) c.filter = `blur(${Math.max(1, r.size * .08)}px)`;
        c.drawImage(tile, 0, 0, tile.width, tile.height, x - (r.soft ? 2 : 0), y - (r.soft ? 2 : 0), w + (r.soft ? 4 : 0), h + (r.soft ? 4 : 0));
      }
      c.restore();
    }
  }

  function fitCanvas() {
    const area = oriented();
    const css = getComputedStyle($('stage'));
    const available = $('stage').clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
    const limit = innerWidth <= 720 ? Math.max(240, Math.min(480, innerHeight * .55)) : 620;
    const width = Math.min(area.w, available, limit * area.w / area.h);
    canvas.style.width = `${Math.max(1, width)}px`;
    canvas.style.height = `${Math.max(1, width * area.h / area.w)}px`;
  }

  function render() {
    frame = 0;
    if (!state.ready) return;
    const area = view();
    const size = oriented(area);
    if (canvas.width !== size.w || canvas.height !== size.h) { canvas.width = size.w; canvas.height = size.h; }
    compose();
    ctx.clearRect(0, 0, size.w, size.h);
    paintImage(ctx, state.original ? source : scene, area, size);
    if (!state.original) paintWatermark(ctx, size);
    const r = state.cropping ? state.cropDraft : selected();
    if (r && !state.original) {
      const scale = size.w / (canvas.getBoundingClientRect().width || size.w);
      ctx.save();
      rotateContext(ctx, area);
      if (state.cropping) {
        ctx.fillStyle = '#25252588';
        ctx.beginPath(); ctx.rect(0, 0, area.w, area.h); ctx.rect(r.x, r.y, r.w, r.h); ctx.fill('evenodd');
      }
      ctx.strokeStyle = '#f6821f';
      ctx.lineWidth = 2 * scale;
      ctx.setLineDash([5 * scale, 4 * scale]);
      ctx.strokeRect(r.x - area.x, r.y - area.y, r.w, r.h);
      ctx.setLineDash([]);
      ctx.fillStyle = '#f6821f';
      ctx.fillRect(r.x + r.w - area.x - 5 * scale, r.y + r.h - area.y - 5 * scale, 10 * scale, 10 * scale);
      ctx.restore();
    }
    const output = outputSize();
    $('dimensions').textContent = `${size.w} × ${size.h}` + (output.w !== size.w || output.h !== size.h ? ` → ${output.w} × ${output.h}` : '');
    $('filename').textContent = state.name;
    $('region-count').textContent = `Областей: ${state.regions.length}`;
    $('selection-state').textContent = state.cropping ? 'Режим обрезки' : r ? `Область ${state.regions.indexOf(r) + 1}` : 'Новая область';
    $('undo').disabled = (!state.history.length && !state.cropping) || state.busy;
    $('clear').disabled = (!state.regions.length && !state.cropping) || state.busy;
    $('clear').textContent = state.cropping ? 'Отменить обрезку' : 'Сбросить маски';
    $('remove').disabled = !selected() || state.busy || state.cropping;
    $('save').disabled = state.busy;
    $('save').firstChild.textContent = state.cropping && validCrop() ? 'Обрезать и сохранить ' : 'Сохранить картинку ';
    $('crop-toolbar').hidden = !state.cropping;
    $('crop-apply').disabled = !validCrop();
    $('crop-edit').textContent = state.cropping ? '✓ Обрезать' : '✂ Выбрать кадр';
    $('crop-cancel-side').hidden = !state.cropping;
    $('crop-redraw').disabled = !state.cropDraft;
    $('crop-guide').textContent = validCrop() ? 'Кадр выбран. Нажми «Обрезать» или «Сохранить».' : 'Выдели фрагмент на фото';
    $('compare').setAttribute('aria-pressed', String(state.original));
    $('compare').textContent = state.original ? 'К обработке' : 'Сравнить';
    $('original-label').hidden = !state.original;
    $('instruction').textContent = state.cropping ? 'Для возврата к маскам нажми «Закрыть» или «Пиксели».' : state.original ? 'Сохранится обработанная версия. Нажми «К обработке», чтобы продолжить.' : 'Проведи пальцем или мышью, чтобы выделить область';
    fitCanvas();
    window.UnseenTelegram?.sync();
    window.UnseenTelegram?.ready();
  }

  function requestRender() { if (!frame) frame = requestAnimationFrame(render); }
  function showCanvas() { requestAnimationFrame(() => canvas.scrollIntoView({ block: 'center', behavior: 'instant' })); }

  function syncTools() {
    const r = selected();
    if (r) { state.tool = r.type; state.color = r.color; state.size = r.size; state.soft = r.soft; }
    document.querySelectorAll('[data-tool]').forEach(button => {
      const active = !state.cropping && button.dataset.tool === state.tool;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('[data-color]').forEach(button => {
      const active = button.dataset.color === state.color;
      button.classList.toggle('chosen', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $('solid-options').hidden = state.tool !== 'solid';
    $('pixel-options').hidden = state.tool !== 'pixel';
    $('strength').value = state.size;
    $('strength-value').value = state.size;
    $('soft').checked = state.soft;
  }

  function newRegion(x, y, w, h) {
    return { id: ++state.serial, x, y, w, h, type: state.tool, color: state.color, size: state.size, soft: state.soft };
  }

  function acceptImage(image, name, originalWidth, originalHeight, demo = false) {
    const scale = Math.min(1, 4096 / image.width, 4096 / image.height, Math.sqrt(6_000_000 / (image.width * image.height)));
    source.width = Math.max(1, Math.round(image.width * scale));
    source.height = Math.max(1, Math.round(image.height * scale));
    source.getContext('2d').drawImage(image, 0, 0, source.width, source.height);
    scene.width = source.width;
    scene.height = source.height;
    state.regions = [];
    state.history = [];
    state.selected = null;
    state.original = false;
    state.turns = 0;
    state.cropMode = 'full';
    state.cropRect = null;
    state.cropDraft = null;
    state.cropping = false;
    state.ready = true;
    state.name = name;
    $('crop').value = 'full';
    if (demo) state.regions = [
      { ...newRegion(120, 245, 220, 220), type: 'pixel', size: 34 },
      { ...newRegion(392, 455, 382, 56), type: 'solid' },
    ];
    syncTools();
    render();
    status(demo ? 'Открыт пример с вымышленными данными. Попробуй двигать маски или загрузи своё фото.' : scale < 1 ? `Фото уменьшено с ${originalWidth} × ${originalHeight} до ${source.width} × ${source.height} для обработки на устройстве.` : 'Изображение открыто на устройстве. Выдели то, что хочешь прикрыть.');
  }

  async function openFile(file) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { status('Выбери JPEG, PNG или WebP. Этот формат пока не поддерживается.', true); return; }
    if (file.size > 35 * 1024 * 1024) { status('Для тестовой версии выбери изображение до 35 МБ.', true); return; }
    const version = ++loadVersion;
    state.busy = true;
    $('editor').setAttribute('aria-busy', 'true');
    $('save').disabled = true;
    status('Открываем изображение на устройстве…');
    let image;
    let url;
    try {
      if ('createImageBitmap' in window) image = await createImageBitmap(file, { imageOrientation: 'from-image' });
      else {
        url = URL.createObjectURL(file);
        image = new Image();
        image.src = url;
        await image.decode();
      }
      if (version !== loadVersion) return;
      if (!image.width || !image.height) throw new Error('Empty image');
      acceptImage(image, file.name, image.width, image.height);
    } catch {
      if (version === loadVersion) status('Не удалось открыть изображение. Попробуй другой файл JPEG, PNG или WebP.', true);
    } finally {
      image?.close?.();
      if (url) URL.revokeObjectURL(url);
      if (version === loadVersion) {
        state.busy = false;
        $('editor').setAttribute('aria-busy', 'false');
        $('save').disabled = !state.ready;
        requestRender();
      }
    }
  }

  function drawExample() {
    ++loadVersion;
    state.busy = false;
    $('editor').setAttribute('aria-busy', 'false');
    const demo = document.createElement('canvas');
    demo.width = 1440;
    demo.height = 1000;
    const c = demo.getContext('2d');
    const box = (x, y, w, h, color, radius = 20) => { c.fillStyle = color; c.beginPath(); c.roundRect(x, y, w, h, radius); c.fill(); };
    const text = (value, x, y, size = 30, color = '#252525', weight = 400) => { c.font = `${weight} ${size}px Golos, Arial, sans-serif`; c.fillStyle = color; c.fillText(value, x, y); };
    box(0, 0, 1440, 1000, '#f4f4f4', 0);
    box(60, 55, 1320, 100, '#ffffff');
    text('UNSEEN / ЛИЧНОЕ', 105, 117, 30, '#252525', 650);
    box(920, 83, 410, 44, '#fff0e3', 9);
    text('ДЕМО · ВЫМЫШЛЕННЫЕ ДАННЫЕ', 943, 111, 17, '#a94e05', 550);
    box(60, 185, 1320, 750, '#ffffff');
    box(120, 245, 220, 220, '#fff0e3', 35);
    // A fictional face drawn locally, with no remote or personal image involved.
    c.fillStyle = '#252525'; c.beginPath(); c.arc(230, 325, 63, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#f1b78d'; c.beginPath(); c.ellipse(230, 330, 48, 61, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#252525'; c.beginPath(); c.ellipse(227, 291, 53, 28, -.15, 0, Math.PI * 2); c.fill();
    box(147, 389, 166, 76, '#f6821f', 40);
    text('Алексей · пример', 390, 303, 54, '#252525', 600);
    text('Скриншот профиля', 393, 353, 27, '#777777');
    text('Телефон', 393, 432, 21, '#777777');
    text('+7 000 123-45-67', 393, 499, 39, '#252525', 520);
    text('Имя пользователя', 393, 577, 21, '#777777');
    text('@example_user', 393, 634, 35, '#252525', 500);
    box(889, 401, 420, 368, '#fff0e3');
    text('Можно делиться.', 927, 466, 32, '#252525', 600);
    text('Личное прикрыто.', 927, 509, 32, '#252525', 600);
    text('Выдели любую область', 927, 588, 23, '#9c5b26');
    text('и попробуй инструменты.', 927, 624, 23, '#9c5b26');
    for (let i = 0; i < 9; i++) box(929 + (i % 5) * 39, 676 + Math.floor(i / 5) * 30, 20, 20, i % 3 === 0 ? '#252525' : '#f6821f', 0);
    c.strokeStyle = '#ebebeb'; c.lineWidth = 2; c.beginPath(); c.moveTo(120, 814); c.lineTo(1310, 814); c.stroke();
    text('Сначала проверь результат, затем отправляй.', 120, 875, 25, '#777777');
    acceptImage(demo, 'Пример · вымышленные данные', 1440, 1000, true);
  }

  function point(event) {
    const bounds = canvas.getBoundingClientRect();
    const area = view();
    const size = oriented(area);
    const x = clamp((event.clientX - bounds.left) / bounds.width, 0, 1) * size.w;
    const y = clamp((event.clientY - bounds.top) / bounds.height, 0, 1) * size.h;
    if (state.turns === 1) return { x: area.x + y, y: area.y + area.h - x };
    if (state.turns === 2) return { x: area.x + area.w - x, y: area.y + area.h - y };
    if (state.turns === 3) return { x: area.x + area.w - y, y: area.y + x };
    return { x: x + area.x, y: y + area.y };
  }

  canvas.addEventListener('pointerdown', event => {
    if (!state.ready || state.busy || drag || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    state.original = false;
    const p = point(event);
    const area = view();
    const margin = 16 * oriented(area).w / canvas.getBoundingClientRect().width;
    const r = state.cropping ? state.cropDraft : selected();
    const resize = r && Math.abs(p.x - r.x - r.w) < margin && Math.abs(p.y - r.y - r.h) < margin;
    const candidates = state.cropping ? (r ? [r] : []) : [...state.regions].reverse();
    const hit = resize ? r : candidates.find(item => p.x >= item.x && p.x <= item.x + item.w && p.y >= item.y && p.y <= item.y + item.h);
    if (!state.cropping && !hit && state.regions.length >= 50) { status('В тестовой версии можно добавить до 50 областей. Удали лишнюю область.', true); return; }
    drag = { pointer: event.pointerId, start: p, previous: snapshot(), cropping: state.cropping, oldDraft: state.cropDraft ? { ...state.cropDraft } : null, mode: resize ? 'resize' : hit ? 'move' : 'draw', before: hit ? { ...hit } : null };
    if (hit) { drag.region = hit; if (!state.cropping) { state.selected = hit.id; syncTools(); } }
    else {
      drag.region = newRegion(p.x, p.y, 0, 0);
      if (state.cropping) state.cropDraft = drag.region;
      else { state.regions.push(drag.region); state.selected = drag.region.id; }
    }
    canvas.setPointerCapture(event.pointerId);
    requestRender();
  });

  canvas.addEventListener('pointermove', event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const p = point(event), r = drag.region, start = drag.start, before = drag.before;
    if (drag.mode === 'draw') { r.x = Math.min(start.x, p.x); r.y = Math.min(start.y, p.y); r.w = Math.abs(p.x - start.x); r.h = Math.abs(p.y - start.y); }
    else if (drag.mode === 'move') { r.x = clamp(before.x + p.x - start.x, 0, source.width - r.w); r.y = clamp(before.y + p.y - start.y, 0, source.height - r.h); }
    else { r.w = clamp(p.x - r.x, 5, source.width - r.x); r.h = clamp(p.y - r.y, 5, source.height - r.y); }
    requestRender();
  });

  function finishPointer(event, cancel = false) {
    if (!drag || drag.pointer !== event.pointerId) return;
    const previous = drag.previous;
    const tooSmall = drag.mode === 'draw' && (drag.region.w < 4 || drag.region.h < 4);
    if (drag.cropping) {
      if (cancel || tooSmall) state.cropDraft = drag.oldDraft;
    } else if (cancel || tooSmall) { restore(previous); state.selected = null; }
    else if (snapshot() !== previous) remember(previous);
    drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    syncTools();
    requestRender();
  }
  canvas.addEventListener('pointerup', event => finishPointer(event));
  canvas.addEventListener('pointercancel', event => finishPointer(event, true));
  canvas.addEventListener('lostpointercapture', event => finishPointer(event, true));

  function addRegion() {
    if (!state.ready || state.busy || state.regions.length >= 50) return;
    finishCropForEditing();
    remember();
    const area = view();
    const r = newRegion(area.x + area.w * .3, area.y + area.h * .4, area.w * .4, area.h * .2);
    state.regions.push(r);
    state.selected = r.id;
    state.original = false;
    syncTools();
    requestRender();
  }
  $('add-region').addEventListener('click', addRegion);

  function undo() {
    if (state.busy) return;
    if (state.cropping) { cancelCrop(); return; }
    if (!state.history.length) return;
    restore(state.history.pop());
    state.selected = null;
    state.original = false;
    syncTools();
    requestRender();
  }
  $('undo').addEventListener('click', undo);
  $('remove').addEventListener('click', () => {
    if (!selected()) return;
    remember(); state.regions = state.regions.filter(r => r.id !== state.selected); state.selected = null; syncTools(); requestRender();
  });
  $('clear').addEventListener('click', () => { if (state.cropping) { cancelCrop(); return; } remember(); state.regions = []; state.selected = null; state.original = false; syncTools(); requestRender(); });
  $('compare').addEventListener('click', () => { finishCropForEditing(); state.original = !state.original; requestRender(); });

  function startCrop() {
    if (!state.ready || state.busy) return;
    if (state.cropping) return;
    state.original = false;
    state.cropping = true;
    state.cropDraft = state.cropMode === 'custom' && state.cropRect ? { ...state.cropRect } : null;
    state.selected = null;
    $('crop').value = 'custom';
    syncTools();
    requestRender();
    status('Выдели кадр и нажми «Обрезать». Можно сразу нажать «Сохранить» или перейти к маскам.');
    showCanvas();
  }
  function cancelCrop() {
    state.cropping = false; state.cropDraft = null; $('crop').value = state.cropMode; syncTools(); requestRender();
    status('Обрезка отменена. Можно скрывать фрагменты или сохранить изображение.');
    showCanvas();
  }
  function applyCrop() {
    if (!validCrop()) { status('Сначала выдели кадр на изображении. Для выхода нажми «Отмена» или выбери инструмент скрытия.', true); return false; }
    remember();
    const r = state.cropDraft;
    const x = Math.floor(r.x), y = Math.floor(r.y);
    state.cropRect = { x, y, w: Math.min(source.width - x, Math.ceil(r.x + r.w) - x), h: Math.min(source.height - y, Math.ceil(r.y + r.h) - y) };
    state.cropMode = 'custom'; state.cropping = false; state.cropDraft = null;
    $('crop').value = 'custom'; syncTools(); requestRender();
    status('Кадр обрезан. Теперь можно скрыть фрагменты или сохранить изображение.');
    showCanvas();
    return true;
  }
  function finishCropForEditing() {
    if (!state.cropping) return;
    if (validCrop()) applyCrop(); else cancelCrop();
  }
  $('crop-edit').addEventListener('click', () => { if (state.cropping) applyCrop(); else startCrop(); });
  $('crop-cancel').addEventListener('click', cancelCrop);
  $('crop-cancel-side').addEventListener('click', cancelCrop);
  $('crop-apply').addEventListener('click', applyCrop);
  $('crop-redraw').addEventListener('click', () => { state.cropDraft = null; requestRender(); });
  $('crop').addEventListener('change', () => {
    if ($('crop').value === 'custom') { startCrop(); return; }
    remember(); state.cropMode = $('crop').value; state.cropping = false; state.cropDraft = null; state.original = false; syncTools(); requestRender();
  });
  function turn(delta) {
    if (!state.ready || state.busy) return;
    remember(); state.turns = (state.turns + delta + 4) % 4; state.original = false; requestRender();
  }
  $('rotate-left').addEventListener('click', () => turn(-1));
  $('rotate-right').addEventListener('click', () => turn(1));
  $('resize').addEventListener('change', () => { $('custom-size-options').hidden = $('resize').value !== 'custom'; requestRender(); });
  $('long-edge').addEventListener('input', requestRender);
  $('format').addEventListener('change', () => { $('quality-options').hidden = $('format').value !== 'image/jpeg'; });
  $('quality').addEventListener('input', () => { $('quality-value').value = `${$('quality').value}%`; });
  $('watermark').addEventListener('change', () => { $('watermark-options').hidden = !$('watermark').checked; requestRender(); });
  for (const id of ['watermark-text', 'watermark-date', 'watermark-date-enabled', 'watermark-opacity']) {
    $(id).addEventListener('input', () => { $('watermark-opacity-value').value = `${$('watermark-opacity').value}%`; requestRender(); });
  }
  const today = new Date();
  $('watermark-date').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  document.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => {
    finishCropForEditing();
    state.tool = button.dataset.tool;
    const r = selected(); if (r && r.type !== state.tool) { remember(); r.type = state.tool; }
    syncTools(); requestRender();
  }));
  document.querySelectorAll('[data-color]').forEach(button => button.addEventListener('click', () => {
    state.color = button.dataset.color;
    const r = selected(); if (r && r.color !== state.color) { remember(); r.color = state.color; }
    syncTools(); requestRender();
  }));
  $('strength').addEventListener('input', () => {
    state.size = Number($('strength').value);
    const r = selected(); if (r && r.size !== state.size) { remember(); r.size = state.size; }
    $('strength-value').value = state.size; requestRender();
  });
  $('soft').addEventListener('change', () => {
    state.soft = $('soft').checked;
    const r = selected(); if (r) { remember(); r.soft = state.soft; }
    requestRender();
  });
  canvas.addEventListener('keydown', event => {
    if (event.key === 'Escape') { if (state.cropping) cancelCrop(); else { state.selected = null; requestRender(); } return; }
    if (event.key === 'Enter') { event.preventDefault(); if (state.cropping) applyCrop(); else addRegion(); return; }
    const r = state.cropping ? state.cropDraft : selected();
    if (!r) return;
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); if (state.cropping) { state.cropDraft = null; requestRender(); } else $('remove').click(); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); if (!state.cropping) remember();
    const step = Math.max(1, Math.round(view().w / 200));
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    if (event.shiftKey) { r.w = clamp(r.w + dx, 5, source.width - r.x); r.h = clamp(r.h + dy, 5, source.height - r.y); }
    else { r.x = clamp(r.x + dx, 0, source.width - r.w); r.y = clamp(r.y + dy, 0, source.height - r.h); }
    requestRender();
  });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); undo(); }
  });
  $('upload').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', () => { openFile($('file').files[0]); $('file').value = ''; });
  $('example').addEventListener('click', drawExample);
  $('stage').addEventListener('dragover', event => { event.preventDefault(); $('drop-message').hidden = false; });
  $('stage').addEventListener('dragleave', event => { if (!$('stage').contains(event.relatedTarget)) $('drop-message').hidden = true; });
  $('stage').addEventListener('drop', event => { event.preventDefault(); $('drop-message').hidden = true; openFile(event.dataTransfer.files[0]); });
  document.addEventListener('paste', event => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    const file = [...(event.clipboardData?.items || [])].find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile();
    if (file) { event.preventDefault(); openFile(file); }
  });

  function download() {
    const a = document.createElement('a');
    a.href = savedURL; a.download = savedName; document.body.append(a); a.click(); a.remove();
  }

  $('save').addEventListener('click', async () => {
    if (!state.ready || state.busy || drag) return;
    if ($('watermark').checked && !$('watermark-text').value.trim()) { status('Введи подпись для водяного знака или отключи его.', true); $('watermark-text').focus(); return; }
    if ($('resize').value === 'custom' && !$('long-edge').checkValidity()) { $('long-edge').reportValidity(); return; }
    finishCropForEditing();
    state.busy = true; $('save').disabled = true;
    window.UnseenTelegram?.sync();
    status('Сохраняем обработанную картинку…');
    try {
      compose();
      const area = view();
      const size = outputSize();
      const output = document.createElement('canvas');
      output.width = size.w; output.height = size.h;
      const c = output.getContext('2d');
      const type = $('format').value;
      if (type === 'image/jpeg') { c.fillStyle = '#ffffff'; c.fillRect(0, 0, output.width, output.height); }
      c.imageSmoothingQuality = 'high';
      paintImage(c, scene, area, size);
      paintWatermark(c, size);
      // Export only the newly rasterized canvas, never the source file or selection outlines.
      const blob = await new Promise(resolve => output.toBlob(resolve, type, Number($('quality').value) / 100));
      if (!blob) throw new Error('Image export failed');
      if (savedURL) URL.revokeObjectURL(savedURL);
      savedBlob = blob;
      savedURL = URL.createObjectURL(blob);
      savedName = `Unseen-${$('crop').value === 'avatar' ? 'avatar' : 'private'}.${type === 'image/png' ? 'png' : 'jpg'}`;
      $('saved-preview').src = savedURL;
      $('download-again').href = savedURL; $('download-again').download = savedName;
      $('open-image').href = savedURL;
      const file = new File([blob], savedName, { type: blob.type });
      $('share').hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
      download();
      if (!$('saved-dialog').open) $('saved-dialog').showModal();
      window.UnseenTelegram?.sync();
      const weight = blob.size >= 1048576 ? `${(blob.size / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(blob.size / 1024))} КБ`;
      status(`Готово · ${size.w} × ${size.h} · ${type === 'image/png' ? 'PNG' : 'JPEG'} · ${weight} · без исходных EXIF. Проверь результат перед отправкой.`);
    } catch { status('Браузеру не удалось сохранить картинку. Попробуй PNG или изображение меньшего размера.', true); }
    finally { state.busy = false; requestRender(); }
  });
  $('share').addEventListener('click', async () => {
    if (!savedBlob) return;
    try { await navigator.share({ files: [new File([savedBlob], savedName, { type: savedBlob.type })] }); }
    catch (error) { if (error.name !== 'AbortError') { if (!$('saved-dialog').open) $('saved-dialog').showModal(); } }
  });
  $('close-dialog').addEventListener('click', () => $('saved-dialog').close());
  new ResizeObserver(() => { if (state.ready) fitCanvas(); }).observe($('stage'));
  document.fonts.load('600 32px Golos').catch(() => {}).then(() => { if (!state.ready && !state.busy) drawExample(); });
})();
