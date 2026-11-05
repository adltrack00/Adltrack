/* record.html: the home care record a doctor, hospital or EMS crew opens by scanning the For EMS code. The link's token is
   after the #, so it never reaches a server log; the page sends it (and the PIN, when the family set one) to
   /api/record/open and lays the record out in the EMS sheet's design. Read-only, with no sign-in (server/record.js). */
(() => {
  const main = document.getElementById('record'), token = location.hash.slice(1);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const tel = s => esc(s).replace(/\(?\+?\d[\d\s().-]{6,}\d/g, p => `<a href="tel:${p.replace(/[^\d+]/g, '')}">${p}</a>`);
  const when = at => new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const day = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? new Date(d + 'T12:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const clock = t => /^\d\d:\d\d$/.test(t) ? new Date('2000-01-01T' + t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : t;
  const CATS = { discharge: 'Discharge papers', insurance: 'Insurance', prescriptions: 'Prescriptions', results: 'Lab and test results', visits: 'Doctor visits', legal: 'ID and legal papers', other: 'Other' };
  // Vital signs are saved one at a time, so a day's readings share one row, newest day first.
  const byDay = list => { const m = new Map(); for (const v of list) { const d = new Date(v.at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); if (!m.has(d)) m.set(d, []); m.get(d).push(v); } return [...m]; };
  const brand = '<span class="ems-view-brand">Adltrack</span>';
  let pin = '';

  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...(pin ? { pin } : {}), ...body }) });
  const card = (title, inner) => `<article class="ems-sheet"><h3>${esc(title)}</h3>${inner}</article>`;

  function pinForm(error = '') {
    main.innerHTML = `${brand}<article class="ems-sheet"><span class="ems-eyebrow">Home care record</span><h2 class="record-pin-title">Enter the PIN</h2><p class="ems-view-note">The family set a PIN for this record. Ask them or the patient for it.</p><form class="record-pin" id="record-pin"><input name="pin" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" aria-label="PIN" required autofocus>${error ? `<p class="record-error" role="alert">${esc(error)}</p>` : ''}<button>Open the record</button></form></article>`;
    document.getElementById('record-pin').addEventListener('submit', e => { e.preventDefault(); pin = e.target.elements.pin.value.trim(); load(); });
  }
  function closed(message) { main.innerHTML = `${brand}<article class="ems-sheet"><span class="ems-eyebrow">Home care record</span><p class="ems-view-note">${esc(message)}</p></article>`; }

  async function load() {
    if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return closed('This link doesn’t open a care record. Scan the code on the For EMS sheet again.');
    let r, body;
    try { r = await post('/api/record/open'); body = await r.json(); } catch { return closed('We couldn’t reach Adltrack. Check the internet connection and scan again.'); }
    if (r.status === 401 && body.needPin) return pinForm(pin ? body.error : '');
    if (!r.ok) return closed(body.error || 'This code no longer opens a care record.');
    show(body.record);
  }

  function show(x) {
    document.title = (x.name || 'Patient') + ' — home care record';
    const meds = x.meds.length ? `<ul class="record-meds">${x.meds.map(m => `<li><strong>${esc(m.name)}</strong><small>${esc([m.how, m.times.map(clock).join(', '), m.unconfirmed ? 'Not confirmed yet' : ''].filter(Boolean).join(' · '))}</small>${m.taken + m.skipped ? `<small>Last 30 days: ${m.taken} taken${m.skipped ? `, ${m.skipped} skipped` : ''}</small>` : ''}${m.prescriber || m.pharmacy ? `<small>${esc([m.prescriber ? 'Prescribed by ' + m.prescriber : '', m.pharmacy].filter(Boolean).join(' · '))}</small>` : ''}${m.warnings ? `<small>Important: ${esc(m.warnings)}</small>` : ''}</li>`).join('')}</ul>` : '<p class="record-none">None recorded.</p>';
    const vitals = x.vitals.length ? `<div class="record-scroll"><table class="record-vitals"><thead><tr><th>Day</th><th>Blood pressure</th><th>Heart rate</th><th>Temp</th><th>Pain</th></tr></thead><tbody>${byDay(x.vitals).map(([d, list]) => { const cell = (k, unit = '') => list.filter(v => v[k]).map(v => esc(v[k]) + unit).join('<br>'); return `<tr><td>${esc(d)}</td><td>${cell('bp')}</td><td>${cell('heart')}</td><td>${cell('temp', '°')}</td><td>${cell('pain', '/10')}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="record-none">No vital signs in the last 30 days.</p>';
    const notes = (list, none) => list.length ? `<ul class="record-notes">${list.map(n => `<li><strong>${esc(n.note || n.name)}</strong><small>${esc(when(n.at))}${n.note && n.name && n.name !== 'Symptoms' ? ' · ' + esc(n.name) : ''}</small></li>`).join('')}</ul>` : `<p class="record-none">${none}</p>`;
    const docs = x.documents.length ? `<ul class="record-docs">${x.documents.map(d => `<li><span><strong>${esc(d.name)}</strong><small>${esc([CATS[d.category] || 'Other', day(d.date)].filter(Boolean).join(' · '))}</small></span><span class="record-pages">${d.pages.map((p, n) => `<button type="button" data-doc="${esc(d.id)}" data-page="${n}" data-type="${esc(p.type)}">${p.type === 'application/pdf' ? 'Open PDF' : d.pages.length > 1 ? 'Page ' + (n + 1) : 'Open'}</button>`).join('')}</span></li>`).join('')}</ul>` : '<p class="record-none">The family hasn’t shared any documents.</p>';
    main.innerHTML = `${brand}<article class="ems-sheet"><header class="ems-head"><div><span class="ems-eyebrow">Home care record</span><h2>${esc(x.name || 'Name not added')}</h2><p>${esc(x.line)}</p></div>${x.photo ? '<img class="record-photo" id="record-photo" alt="">' : ''}</header>
<div class="ems-alerts"><div class="ems-alert"><span>Code status</span><strong>${esc(x.code || 'Not added')}</strong>${x.papers ? `<small>Papers: ${esc(x.papers)}</small>` : ''}</div><div class="ems-alert"><span>Allergies</span><strong>${x.allergies.length ? x.allergies.map(esc).join('<br>') : 'Not added'}</strong></div></div>
<dl class="ems-list">${x.rows.map(r => `<div class="ems-row"><dt>${esc(r.label)}</dt><dd>${r.value.map(/phone|contact|proxy/i.test(r.label) ? tel : esc).join('<br>')}</dd></div>`).join('')}</dl></article>
${card('Medications', meds)}${card('Vital signs · last 30 days', vitals)}${card('Symptoms · last 30 days', notes(x.symptoms, 'No symptoms written down in the last 30 days.'))}${card('Incidents · last 30 days', notes(x.incidents, 'No incidents in the last 30 days.'))}${card('Documents', docs)}
<p class="ems-view-note">Recorded at home by the family and caregivers in Adltrack. Read-only, shared by the family. Opened ${esc(when(x.at))}. Confirm medications with the bottles.</p>`;
    if (x.photo) fileUrl({ photo: true }).then(u => { const img = document.getElementById('record-photo'); if (img && u) img.src = u; });
  }

  async function fileUrl(body) { try { const r = await post('/api/record/file', body); return r.ok ? URL.createObjectURL(await r.blob()) : ''; } catch { return ''; } }
  const dialog = document.getElementById('record-page'), pageBody = document.getElementById('record-page-body');
  dialog.querySelector('.record-x').addEventListener('click', () => dialog.close());
  main.addEventListener('click', async e => {
    const b = e.target.closest('[data-doc]'); if (!b) return;
    b.disabled = true; const u = await fileUrl({ doc: b.dataset.doc, page: Number(b.dataset.page) }); b.disabled = false;
    if (!u) return;
    if (b.dataset.type === 'application/pdf') { window.open(u, '_blank', 'noopener'); return; }
    pageBody.innerHTML = `<img src="${u}" alt="">`; dialog.showModal();
  });
  load();
})();
