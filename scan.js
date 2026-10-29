/* The Scan screens (guided.js keeps what they do; this file is how they look).
   Discharge papers: a live scanner (corners, a moving scan line), each page drops into a tray, then the picture of the papers
   is read on the same screen and filed in Documents before the Confirm card.
   Medications: first the choice, the pharmacy paper stapled to the bag or the bottle itself. Then one camera screen that shows,
   step by step, which part to scan on a drawn bottle (or paper), turning the bottle to the next part after each photo.
   The bottle and paper are drawings of a made-up prescription, never a real patient's. */
let artId=0;
/* Each step: what to scan, the line under it, the hint inside the camera, the part outlined on the drawing, and the frame's shape. */
const SCAN_STEPS={
  bottle:[['Front of the label','The medication name and how to take it','Fit the front of the label in the corners','front','label'],
    ['Turn the bottle','The pharmacy, refills and doctor','Turn the bottle to the next part','side','label'],
    ['Turn it once more','The warning stickers','Turn again, to the stickers','back','label']],
  leaflet:[['Top of the paper','The medication, directions, doctor and pharmacy','Fit the top of the paper in the corners','top','page'],
    ['The rest of the page','What it’s for and the warnings. You can skip this one.','Now the rest of the page','rest','page']],
  card:['The whole bottle','One clear photo for the medication card','The whole bottle in the corners','whole','bottle']};
/* The review card's bottle row still names the 3 shots (guided.js bottleRow): [what, what it shows]. */
const BOTTLE_SHOTS=SCAN_STEPS.bottle.map(([a,b])=>[a,b]);
const LABEL_SHIFT={front:0,side:-92,back:-184,whole:0};
const TARGETS={front:[34,124,92,40],side:[34,108,92,62],back:[36,94,88,110],whole:[20,6,120,226]};
const bracket=([x,y,w,h],r=7)=>`M${x} ${y+r}V${y}h${r}M${x+w-r} ${y}h${r}v${r}M${x+w} ${y+h-r}v${r}h${-r}M${x+r} ${y+h}h${-r}v${-r}`;
const svgText=(x,y,size,t,o='')=>`<text x="${x}" y="${y}" font-size="${size}" ${o}>${esc(t)}</text>`;
const barcode=(x,y,w,h)=>{let s='',p=x;const bars=[1,2,1,1,3,1,2,1,1,2,1,3,1,1,2,1,2,1,1,3,1,2,1,1,2,2,1,1,3,1];for(let n=0;p<x+w-2;n++){const b=bars[n%bars.length]*.7;if(n%2===0)s+=`<rect x="${p.toFixed(1)}" y="${y}" width="${b.toFixed(1)}" height="${h}"/>`;p+=b+.6}return `<g fill="#1a1a1a">${s}</g>`};
/* A prescription bottle: amber, a white push-and-turn cap, the pharmacy label wrapped around it and warning stickers on the
   back. The label slides inside the bottle's outline as the step changes, so the bottle looks like it turns. */
function bottleArt(part='front',from=null){const id='b'+(++artId),shift=LABEL_SHIFT[part]??0,was=from&&LABEL_SHIFT[from]!==undefined?LABEL_SHIFT[from]:shift,t=TARGETS[part]||TARGETS.front;
const ridges=Array.from({length:27},(_,n)=>`<line x1="${28+n*4}" y1="15" x2="${28+n*4}" y2="45"/>`).join('');
const pills=[[52,74,9,4.6,-12],[70,70,9,4.6,18],[92,76,9,4.6,-30],[110,71,9,4.6,8],[61,82,9,4.6,40],[100,84,9,4.6,-6]].map(([cx,cy,rx,ry,r])=>`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${r} ${cx} ${cy})"/>`).join('');
const front=`<rect width="92" height="114" fill="#fbfaf7"/><rect width="92" height="14" fill="#174a7c"/>${svgText(5,9.6,6,'MAIN ST PHARMACY','fill="#fff" font-weight="700"')}${svgText(5,20.5,3.6,'12 Main St  ·  (555) 300-1200','fill="#444"')}${svgText(5,27.5,4.4,'Rx 0412887','font-weight="700"')}${svgText(87,27.5,4,'10/29/26','text-anchor="end" fill="#333"')}<line x1="5" y1="30.5" x2="87" y2="30.5" stroke="#bbb" stroke-width=".5"/>${svgText(5,38.5,5.6,'JANE DOE','font-weight="700"')}${svgText(5,48,5.3,'TAKE 1 TABLET BY MOUTH','font-weight="700"')}${svgText(5,55,5.3,'EVERY MORNING','font-weight="700"')}${svgText(5,66,5.5,'LISINOPRIL 10 MG TABLET','font-weight="700"')}${svgText(5,72.5,3.6,'Generic for: ZESTRIL   Mfr: ACCORD','fill="#444"')}<line x1="5" y1="79" x2="87" y2="79" stroke="#bbb" stroke-width=".5"/>${svgText(5,86,3.1,'CAUTION: Federal law prohibits the transfer','fill="#666"')}${svgText(5,90.5,3.1,'of this drug to any person other than the','fill="#666"')}${svgText(5,95,3.1,'patient for whom it was prescribed.','fill="#666"')}`;
const side=`<rect width="92" height="114" fill="#fbfaf7"/><rect width="92" height="14" fill="#174a7c"/>${svgText(5,9.6,4.6,'PHARMACIST: R. LEE','fill="#fff" font-weight="700"')}${svgText(5,22,3.5,'PRESCRIBER','fill="#666"')}${svgText(5,29,5.2,'DR. MAYA PATEL','font-weight="700"')}${svgText(5,39,5,'QTY: 30','font-weight="700"')}${svgText(5,46.5,4.4,'REFILLS: 2 BEFORE 10/29/27','font-weight="700"')}${svgText(5,54,4.1,'FILLED: 10/29/26')}${svgText(5,60.5,4.1,'DISCARD AFTER: 10/29/27')}${svgText(5,68,3.7,'PINK, ROUND, IMPRINT “L 10”','fill="#333"')}${barcode(8,78,62,18)}${svgText(8,101,3,'0 12345 67890 5','fill="#333"')}`;
const back=`<g transform="rotate(-3 46 20)"><rect x="6" y="4" width="80" height="30" rx="2" fill="#ffd60a"/>${svgText(46,16,6.4,'MAY CAUSE','text-anchor="middle" font-weight="800"')}${svgText(46,25.5,6.4,'DIZZINESS','text-anchor="middle" font-weight="800"')}</g><g transform="rotate(2 46 52)"><rect x="8" y="39" width="76" height="27" rx="2" fill="#ff8f1f"/>${svgText(46,50.5,5.8,'DO NOT DRINK','text-anchor="middle" font-weight="800"')}${svgText(46,59,5.8,'ALCOHOL','text-anchor="middle" font-weight="800"')}</g><g transform="rotate(-1.5 46 86)"><rect x="7" y="72" width="78" height="28" rx="2" fill="#8fd0ff"/>${svgText(46,83.5,5.6,'TAKE EXACTLY','text-anchor="middle" font-weight="800"')}${svgText(46,92,5.6,'AS DIRECTED','text-anchor="middle" font-weight="800"')}</g>`;
return `<svg viewBox="0 0 160 256" class="scan-art bottle-art" role="img" aria-label="Example bottle: ${esc(part==='whole'?'the whole bottle':'the part to scan is outlined')}" font-family="Arial,Helvetica,sans-serif"><defs>
<linearGradient id="${id}a" x1="0" x2="1"><stop offset="0" stop-color="#5e2c05"/><stop offset=".14" stop-color="#a65a12"/><stop offset=".34" stop-color="#e09a3c"/><stop offset=".55" stop-color="#c8781f"/><stop offset=".86" stop-color="#8e4710"/><stop offset="1" stop-color="#4f2404"/></linearGradient>
<linearGradient id="${id}c" x1="0" x2="1"><stop offset="0" stop-color="#b9b8b2"/><stop offset=".18" stop-color="#ecebe6"/><stop offset=".38" stop-color="#ffffff"/><stop offset=".7" stop-color="#e4e3dd"/><stop offset="1" stop-color="#a9a8a1"/></linearGradient>
<linearGradient id="${id}s" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".5"/><stop offset=".12" stop-color="#000" stop-opacity=".12"/><stop offset=".27" stop-color="#fff" stop-opacity=".0"/><stop offset=".33" stop-color="#fff" stop-opacity=".42"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/><stop offset=".78" stop-color="#000" stop-opacity=".06"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient>
<clipPath id="${id}l"><rect x="34" y="92" width="92" height="114" rx="1.5"/></clipPath><filter id="${id}f" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="3"/></filter></defs>
<ellipse cx="80" cy="229" rx="54" ry="6" fill="#000" opacity=".35" filter="url(#${id}f)"/>
<rect x="30" y="54" width="100" height="174" rx="12" fill="url(#${id}a)"/><g fill="#f4b7b0" opacity=".42">${pills}</g>
<g clip-path="url(#${id}l)"><g class="label-strip" style="--from:${was}px;--to:${shift}px;transform:translateX(${shift}px)"><g transform="translate(34 92)">${front}<g transform="translate(92 0)">${side}</g><g transform="translate(184 0)">${back}</g></g></g></g>
<rect x="30" y="54" width="100" height="174" rx="12" fill="url(#${id}s)"/><rect x="40" y="60" width="5" height="160" rx="2.5" fill="#fff" opacity=".18"/>
<rect x="31" y="50" width="98" height="10" rx="2" fill="#7a3d09"/>
<rect x="24" y="10" width="112" height="44" rx="6" fill="url(#${id}c)"/><g stroke="#000" stroke-opacity=".09" stroke-width="1.2">${ridges}</g><rect x="24" y="45" width="112" height="9" rx="2" fill="url(#${id}c)"/><line x1="26" y1="45.5" x2="134" y2="45.5" stroke="#000" stroke-opacity=".12"/>
${part==='side'||part==='back'?'<path class="turn-arrow" d="M44 244 Q80 256 116 244" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><path class="turn-arrow" d="M110 239.5 L117 243.6 L111 249" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>':''}
${target(t)}</svg>`}
const target=t=>`<g class="scan-target"><rect x="${t[0]}" y="${t[1]}" width="${t[2]}" height="${t[3]}" rx="4" class="target-fill"/><path d="${bracket(t)}" class="target-line"/></g>`;
/* The pharmacy paper stapled to the bag: the label part at the top (the same facts as the bottle), the drug information under it. */
function leafletArt(part='top'){const id='p'+(++artId),grey=(y,w)=>`<rect x="14" y="${y}" width="${w}" height="2.6" rx="1.3" fill="#cfcac0"/>`;
const lines=(y,ws)=>ws.map((w,n)=>grey(y+n*5.4,w)).join('');
return `<svg viewBox="0 0 160 232" class="scan-art leaflet-art" role="img" aria-label="Example pharmacy paper: the part to scan is outlined" font-family="Arial,Helvetica,sans-serif"><defs><filter id="${id}f" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3.5"/></filter></defs>
<g transform="rotate(-2 80 116)"><rect x="12" y="10" width="136" height="214" rx="2" fill="#000" opacity=".3" filter="url(#${id}f)"/><rect x="10" y="6" width="140" height="216" rx="1.5" fill="#fdfcf8"/>
<rect x="16" y="11" width="9" height="9" rx="1.5" fill="#c8102e"/><path d="M20.5 13v5M18 15.5h5" stroke="#fff" stroke-width="1.6"/>${svgText(28,18.2,6.2,'MAIN ST PHARMACY','font-weight="800" fill="#c8102e"')}${svgText(145,18,3.4,'(555) 300-1200','text-anchor="end" fill="#444"')}
${svgText(16,27,3.4,'12 Main St, Springfield','fill="#555"')}<line x1="16" y1="31" x2="144" y2="31" stroke="#222" stroke-width=".6"/>
${svgText(16,39,4.8,'JANE DOE','font-weight="700"')}${svgText(144,39,3.8,'Rx 0412887','text-anchor="end" font-weight="700"')}
${svgText(16,49,5.8,'LISINOPRIL 10 MG TABLET','font-weight="800"')}${svgText(16,57,4.3,'Take 1 tablet by mouth every morning')}
${svgText(16,65.5,3.7,'QTY 30    REFILLS 2 BEFORE 10/29/27','fill="#333"')}${svgText(16,72.5,3.7,'DR. MAYA PATEL    FILLED 10/29/26','fill="#333"')}
${svgText(16,80,3.4,'Pink, round, imprint “L 10”','fill="#555"')}${barcode(102,62,40,16)}
<line x1="10" y1="90" x2="150" y2="90" stroke="#9b958a" stroke-width=".7" stroke-dasharray="2.5 2"/>
${svgText(16,101,5,'LISINOPRIL - ORAL','font-weight="800"')}${svgText(16,107,3.2,'(lye-SIN-oh-pril)','fill="#666"')}
${svgText(16,116,3.8,'USES:','font-weight="700"')}${lines(119,[124,118,126,70])}
${svgText(16,145,3.8,'HOW TO USE:','font-weight="700"')}${lines(148,[122,126,110,96])}
${svgText(16,174,3.8,'SIDE EFFECTS:','font-weight="700"')}${lines(177,[120,126,116,124,60])}
${svgText(16,208,3.4,'MAY CAUSE DIZZINESS. Do not drink alcohol.','font-weight="700" fill="#333"')}</g>
${target(part==='rest'?[6,92,148,128]:[6,4,148,86])}</svg>`}
/* Discharge papers, drawn, for a PDF that has no picture yet. */
const paperArt=()=>`<svg viewBox="0 0 120 156" class="scan-art paper-art" aria-hidden="true" font-family="Arial,Helvetica,sans-serif"><rect width="120" height="156" rx="2" fill="#fdfcf8"/>${svgText(10,16,5.6,'DISCHARGE INSTRUCTIONS','font-weight="800"')}${[26,32,38,50,56,62,68,80,86,92,104,110,116,122].map((y,n)=>`<rect x="10" y="${y}" width="${[96,80,90,100,72,94,60,98,84,76,100,88,64,92][n]}" height="2.6" rx="1.3" fill="#cfcac0"/>`).join('')}</svg>`;

/* The camera, with its corners, its scan line and the hint. The flash plays once, right after a photo is taken. */
function scanCamera(frame,hint,label){const flash=journey.flash;journey.flash=false;
return `<div class="scan-cam frame-${frame}"><video id="flow-video" autoplay muted playsinline aria-label="${esc(label)} camera preview"></video><div class="scan-corners" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div class="scan-beam" aria-hidden="true"></div><p class="scan-hint">${esc(hint)}</p><div class="camera-message" id="camera-message">Allow camera access, or upload the photos.</div><button type="button" class="scan-retry" id="flow-camera-start" aria-label="Retry camera">${icon('spark')}</button>${flash?'<div class="scan-flash" aria-hidden="true"></div>':''}</div>`}
const scanProgress=(n,total,word='Step')=>`<div class="scan-top"><span>${word} ${Math.min(n+1,total)} of ${total}</span><div class="scan-progress" aria-hidden="true">${Array.from({length:total},(_,k)=>`<i class="${k<n?'done':k===n?'now':''}"></i>`).join('')}</div></div>`;
const scanTray=(shots,label)=>shots.length?`<div class="scan-tray" aria-label="${shots.length} ${esc(label)}${shots.length>1?'s':''} taken">${shots.slice(-3).map((s,k,all)=>`<img src="${esc(s)}" alt="" class="${k===all.length-1&&journey.justShot?'is-new':''}">`).join('')}<b>${shots.length}</b></div>`:'<span class="scan-tray-empty"></span>';
/* Only papers (discharge papers, documents) can be uploaded from files. Medication photos are taken live: the shutter, or
   the phone's camera when the live camera can't start. */
const scanControls=(upload,shots,label,accept,multiple)=>{const files=upload==='flow-receipt',noCam=typeof cameraStream!=='undefined'&&!cameraStream&&typeof cameraAttempted!=='undefined'&&cameraAttempted;
return `<div class="scan-controls">${files?`<label for="${upload}" tabindex="0" role="button" class="scan-upload">${icon('grid')}<span>Upload</span></label>`:noCam?`<label for="${upload}" tabindex="0" role="button" class="scan-upload"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 8.5h3.2l1.8-2.5h6l1.8 2.5H20V19H4Z"/><circle cx="12" cy="13.2" r="3.4"/></svg><span>Camera</span></label>`:'<span class="scan-upload" aria-hidden="true"></span>'}<button class="shutter" id="flow-shutter" disabled aria-label="Take this photo"></button>${scanTray(shots,label)}</div><input id="${upload}" type="file" accept="${accept}"${files?(multiple?' multiple':''):' capture="environment"'}>`};
/* While the pages or label are being read: the picture just taken, the scan line going over it, and what is happening. The
   steps tick on a timer while the one answer is on its way; the last stays open until it comes back. */
function scanReading(img,steps){return `<div class="scan-stage is-reading"><div class="scan-cam frame-page"><div class="scan-shot">${img?`<img src="${esc(img)}" alt="The page being read">`:paperArt()}</div><div class="scan-beam" aria-hidden="true"></div></div><ol class="scan-tasks" aria-live="polite">${steps.map((s,n)=>`<li style="--n:${n}"><i aria-hidden="true"></i>${esc(s)}</li>`).join('')}</ol></div>`}

/* Discharge papers. */
function papersScanPage(){if(journey.step==='filed')return filedPage();const shots=journey.paperShots||[];
if(journey.reading)return flowShell('','',`<div class="scan-head"><h1>Reading the discharge papers.</h1><p>Hold on, this takes a few seconds.</p></div>`+scanReading(journey.readingImg||shots[0],[`Reading ${shots.length>1||journey.pages.length>1?'the pages':'the page'}`,'Finding the medications','Finding follow-up visits and warning signs','Saving to Documents']),1);
const n=shots.length;journey.justShot=false;
return flowShell('','',`<div class="scan-head"><h1>Scan the discharge papers.</h1><p>One page at a time. Tap Read when every page is in.</p></div><div class="scan-stage">${scanCamera('page',n?`Page ${n+1}: flat, corners inside`:'Lay the page flat, corners inside','Discharge papers')}${scanControls('flow-receipt',shots,'page','image/jpeg,image/png,image/webp,application/pdf',true)}${n?`<button class="scan-done" id="scan-read-pages">Read ${n===1?'this page':`these ${n} pages`}</button>`:''}</div><p class="flow-subtle">The pages are saved privately to your account and filed in Documents.</p>`,1)}
/* After reading: the picture of the papers going into Documents, and what was found, before the Confirm card. */
function filedPage(){const f=journey.found||{},img=journey.preview||(journey.pages||[]).find(p=>/^data:image\//.test(p)),count=(k,one,many)=>f[k]?`<li><b>${f[k]}</b>${f[k]===1?one:many}</li>`:'';
const found=[count('meds','medication','medications'),count('visits','follow-up visit','follow-up visits'),count('signs','warning sign to watch for','warning signs to watch for')].join('');
return flowShell('','',`<div class="scan-filed"><div class="filed-art" aria-hidden="true"><svg class="filed-back" viewBox="0 0 200 150"><path d="M8 26a10 10 0 0 1 10-10h52l14 14h98a10 10 0 0 1 10 10v96a10 10 0 0 1-10 10H18a10 10 0 0 1-10-10z" fill="#e7dcc9"/></svg><div class="filed-sheet">${img?`<img src="${esc(img)}" alt="">`:paperArt()}</div><svg class="filed-front" viewBox="0 0 200 150"><path d="M4 66a10 10 0 0 1 10-10h172a10 10 0 0 1 10 10l-6 70a10 10 0 0 1-10 9H20a10 10 0 0 1-10-9z" fill="#f3ead9"/><text x="100" y="112" text-anchor="middle" font-size="15" font-weight="600" fill="#6f6556" font-family="Inter,Arial,sans-serif">Documents</text></svg><span class="filed-check">✓</span></div>
<p class="filed-tag">Saved to Documents</p><h1>Discharge papers filed.</h1><p class="filed-where">${esc(['Discharge papers'+(f.hospital?' · '+f.hospital:''),f.pages===1?'1 page':(f.pages||0)+' pages'].join(' · '))}<br>Find them any time in Documents.</p>
${found?`<ul class="filed-found">${found}</ul>`:''}<p class="filed-next">${f.meds?'Next, check each medication against the papers. When you confirm, its doses go into My Tasks.':'Next, add each medication. When you confirm, its doses go into My Tasks.'}</p>
<button class="primary" id="scan-filed-next">${f.meds?'Check what we found':'Add the medications'}</button></div>`,1)}

/* Medications: the choice first, then one screen per photo with the drawing of what to scan. */
function scanChoosePage(){return flowShell('','',`<div class="scan-head is-light"><h1>Scan a medication.</h1><p>Use whichever you have in hand.</p></div><div class="scan-options">
<button class="scan-option" data-scan-kind="leaflet"><span class="scan-option-art">${leafletArt('top')}</span><span class="scan-option-text"><em>Fastest</em><b>The pharmacy paper</b><small>The sheet stapled to the pharmacy bag. It has everything on it: 1 or 2 photos.</small></span></button>
<button class="scan-option" data-scan-kind="bottle"><span class="scan-option-art is-dark">${bottleArt('front')}</span><span class="scan-option-text"><b>The bottle</b><small>3 quick photos of the label as you turn the bottle.</small></span></button></div>
<button class="flow-secondary" id="flow-papers">I have the discharge papers</button>`,1)}
function bottleScanPage(){const kind=journey.kind;if(journey.step==='choose'||!kind)return scanChoosePage();if(journey.step==='cardPhoto')return cardPhotoPage(kind==='leaflet');const leaflet=kind==='leaflet',steps=SCAN_STEPS[kind],shots=journey.shots,n=shots.length,total=steps.length+1;
if(journey.reading)return flowShell('','',`<div class="scan-head"><h1>Reading the ${leaflet?'pharmacy paper':'label'}.</h1><p>Hold on, this takes a few seconds.</p></div>`+scanReading(shots[0],[`Reading ${n>1?`the ${n} photos`:'the photo'}`,'Finding how to take it','Finding the pharmacy and doctor']),1);
const card=journey.step==='cardPhoto',step=card?SCAN_STEPS.card:steps[Math.min(n,steps.length-1)],at=card?steps.length:Math.min(n,steps.length-1),prev=card?steps[steps.length-1][3]:n?steps[n-1][3]:null;
const art=leaflet&&!card?leafletArt(step[3]):bottleArt(step[3],journey.justShot?prev:null);journey.justShot=false;
const read=!card&&n?`<button class="scan-done" id="flow-bottle-read">${leaflet?'Skip, read it now':`Read ${n===1?'this photo':`these ${n} photos`} now`}</button>`:'';
return flowShell('','',`<div class="scan-head is-capture"><h1>${card?'Last photo: the whole bottle.':leaflet?'Scan the pharmacy paper.':'Scan the bottle.'}</h1><p>${card?'We read it. Now one clear photo, so everyone knows the exact medication.':'Follow the drawing. Scan the part outlined in green.'}</p></div>
<div class="scan-stage has-guide">${scanProgress(at,total)}${scanCamera(step[4],step[2],leaflet?'Pharmacy paper':'Medication bottle')}
<div class="scan-guide"><div class="scan-guide-art">${art}</div><div class="scan-guide-text"><span>Scan this part</span><b>${esc(step[0])}</b><small>${esc(step[1])}</small><em>Example ${leaflet&&!card?'paper':'bottle'}, not a real prescription</em></div></div>
${scanControls(card?'flow-card-upload':'flow-bottle-upload',card?[]:shots,'photo','image/*',!card)}${read}</div>
${card?`<button class="flow-secondary" id="flow-card-skip">Use the ${leaflet?'paper':'label'} photo instead</button>`:`<button class="flow-secondary" id="scan-switch">${leaflet?'Scan the bottle instead':'Scan the pharmacy paper instead'}</button>`}<button class="flow-secondary" id="flow-papers">I have the discharge papers</button><p class="flow-subtle">The photos are saved privately to your account.</p>`,1)}
/* After the reading: not a scan, one photo of the bottle taken with the phone's camera, zoomed in so its label can be read. It is the
   picture on the medication's task. The pharmacy paper already gave everything else, so no bottle steps follow. */
function cardPhotoPage(leaflet){return flowShell('','',`<div class="scan-head"><h1>Now, take a photo of the bottle.</h1><p>${leaflet?'We read the pharmacy paper.':'We read the label.'} This photo shows on the medication’s task, so everyone sees exactly what they’re giving.</p></div>
<div class="card-photo"><div class="card-photo-art">${bottleArt('whole')}</div><ul class="card-photo-tips"><li><b>Zoom in</b> so the label fills the photo.</li><li><b>Make it sharp.</b> The name, the strength and how to take it must be easy to read.</li><li><b>Good light,</b> no glare on the label.</li></ul></div>
<div class="card-photo-actions"><label class="primary" for="flow-card-upload" tabindex="0" role="button">Take the photo</label></div>
<input id="flow-card-upload" type="file" accept="image/*" capture="environment" hidden>
<button class="flow-secondary" id="flow-card-skip">${leaflet?'Add the photo later':'Use the label photo instead'}</button>`,1)}
uploadPage=function(){return journey.mode==='bottles'?bottleScanPage():papersScanPage()};
/* The review card's small guide for the next bottle photo, drawn the same way. */
function bottleGuide(count){const step=SCAN_STEPS.bottle[Math.min(count,2)];return `<div class="scan-mini">${bottleArt(step[3])}<p><b>Photo ${count+1}: ${esc(step[0].toLowerCase())}</b><br>${esc(step[1])}. Example bottle, not a real prescription.</p></div>`};

/* Camera pages of the discharge papers wait in the tray until Read; uploads are read with them. */
function addPaperShot(shot){const shots=journey.paperShots||[];if(shots.length>=MAX_RECEIPT_PAGES)throw Error(`Scan up to ${MAX_RECEIPT_PAGES} pages of one set of discharge papers.`);journey.paperShots=[...shots,shot];journey.flash=true;journey.justShot=true;journey.error='';render()}
const shotFile=(url,n)=>{const bytes=atob(url.split(',')[1]||''),a=new Uint8Array(bytes.length);for(let k=0;k<bytes.length;k++)a[k]=bytes.charCodeAt(k);return new File([a],`Discharge-page-${n+1}.jpg`,{type:'image/jpeg'})};
async function readPapers(extra=[]){const shots=journey.paperShots||[],files=[...shots.map(shotFile),...extra];if(!files.length)return;journey.readingImg=shots[0]||'';await acceptReceipt(files,shots);journey.paperShots=[]}
function startKind(kind){stopJourneyCamera();cameraAttempted=false;Object.assign(journey,{mode:'bottles',kind,step:'capture',shots:[],shotFrom:'',error:''});render();window.scrollTo(0,0)}
if(typeof document!=='undefined'){
/* Before guided.js's own handler: Back from a bottle or paper camera goes to the choice, not out of Scan. */
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;try{
  if(b.id==='flow-back'&&view==='upload'&&journey.mode==='bottles'&&journey.kind&&journey.step!=='choose'&&!journey.reading){e.stopImmediatePropagation();stopJourneyCamera();cameraAttempted=false;Object.assign(journey,{step:'choose',kind:'',shots:[],shotFrom:'',error:''});render();return}
  if(b.dataset?.scanKind){startKind(b.dataset.scanKind);return}
  if(b.id==='scan-switch'){startKind(journey.kind==='leaflet'?'bottle':'leaflet');return}
  if(b.id==='scan-read-pages'){await readPapers();return}
  if(b.id==='scan-filed-next'){filedNext();return}
}catch(err){journey.error=err.message;render()}},true);
}
if(typeof module!=='undefined')module.exports={SCAN_STEPS};
