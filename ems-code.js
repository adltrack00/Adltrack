/* The For EMS code holds a link to ems.html with the sheet's text packed after the #. A phone camera opens the link, and
   ems.html unpacks the text in the browser and shows the sheet. The part after # is never sent to any server, so nothing
   about the patient is stored online or put on a public page: the information lives only in the printed code itself.
   (A code with plain text made iPhone cameras offer only the first phone number in it.) */
const EMS_LINK_MAX=2300;
const emsB64=bytes=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
const emsBytes=s=>{const b=atob(s.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(b,c=>c.charCodeAt(0))};
async function emsSqueeze(bytes,way){const s=new Blob([bytes]).stream().pipeThrough(new (way==='in'?CompressionStream:DecompressionStream)('deflate-raw'));return new Uint8Array(await new Response(s).arrayBuffer())}
/* "z." + deflated text, or "t." + the text itself where the browser can't compress. */
async function emsPack(text){const raw=new TextEncoder().encode(text);if(typeof CompressionStream==='function'){try{return 'z.'+emsB64(await emsSqueeze(raw,'in'))}catch{}}return 't.'+emsB64(raw)}
async function emsUnpack(hash){const m=/^#?([zt])\.([A-Za-z0-9_-]+)$/.exec(hash||'');if(!m)return '';try{const b=emsBytes(m[2]);return new TextDecoder().decode(m[1]==='z'?await emsSqueeze(b,'out'):b)}catch{return ''}}
/* The whole link; a very long sheet is cut so the code stays scannable, and the printed sheet has the rest. */
async function emsLink(base,text){let link='';for(const t of [text,text.slice(0,2400)+'\n(More on the printed sheet)',text.slice(0,1400)+'\n(More on the printed sheet)']){link=base+'#'+await emsPack(t);if(link.length<=EMS_LINK_MAX)break}return link}
if(typeof module!=='undefined')module.exports={emsPack,emsUnpack,emsLink};
