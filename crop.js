/* The profile picture, fitted to its circle the way Instagram does it: after picking or taking the photo it opens full screen
   over black, under a circle. Drag it to move it, pinch (or the slider, or the mouse wheel) to zoom, then Use photo saves what
   is inside the circle, 256px, as before. Cancel keeps the old picture. */
const CROP_MAX_ZOOM=4;
let crop=null;
function cropFit(){const c=crop,v=c.size,s=c.base*c.zoom,w=c.img.naturalWidth*s,h=c.img.naturalHeight*s;
c.x=Math.min(0,Math.max(v-w,c.x));c.y=Math.min(0,Math.max(v-h,c.y));const im=c.d.querySelector('.crop-img');im.style.width=w+'px';im.style.height=h+'px';im.style.transform=`translate(${c.x}px,${c.y}px)`;
const r=c.d.querySelector('#crop-zoom');if(r)r.value=c.zoom}
/* Zooming keeps the point under the fingers (or the middle of the circle) where it is. */
function cropZoom(z,cx=crop.size/2,cy=crop.size/2){const c=crop,old=c.base*c.zoom;c.zoom=Math.min(CROP_MAX_ZOOM,Math.max(1,z));const s=c.base*c.zoom;c.x=cx-(cx-c.x)*s/old;c.y=cy-(cy-c.y)*s/old;cropFit()}
function cropOpen(img,url){let d=$('#photo-crop');if(!d){d=document.createElement('dialog');d.id='photo-crop';d.className='photo-crop';d.setAttribute('aria-label','Move and scale the profile photo');document.body.append(d)}
d.innerHTML=`<div class="crop-top"><button class="crop-text" id="crop-cancel">Cancel</button><h2>Move and scale</h2><button class="crop-text crop-use" id="crop-use">Use photo</button></div><div class="crop-stage"><div class="crop-frame"><img class="crop-img" src="${esc(url)}" alt="" draggable="false"><div class="crop-ring" aria-hidden="true"></div></div></div><label class="crop-slider"><span aria-hidden="true">−</span><input type="range" id="crop-zoom" min="1" max="${CROP_MAX_ZOOM}" step="0.01" value="1" aria-label="Zoom"><span aria-hidden="true">+</span></label>`;
d.tabIndex=-1;d.showModal();d.focus();const frame=d.querySelector('.crop-frame'),size=frame.clientWidth;
crop={d,img,url,size,base:size/Math.min(img.naturalWidth,img.naturalHeight),zoom:1,x:0,y:0,pts:new Map(),pinch:null};
crop.x=(size-img.naturalWidth*crop.base)/2;crop.y=(size-img.naturalHeight*crop.base)/2;cropFit();
const at=e=>{const r=frame.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top]};
frame.addEventListener('pointerdown',e=>{frame.setPointerCapture(e.pointerId);crop.pts.set(e.pointerId,at(e));crop.pinch=null});
frame.addEventListener('pointermove',e=>{if(!crop||!crop.pts.has(e.pointerId))return;const [px,py]=crop.pts.get(e.pointerId),p=at(e);crop.pts.set(e.pointerId,p);
if(crop.pts.size===1){crop.x+=p[0]-px;crop.y+=p[1]-py;cropFit();return}
const [a,b]=[...crop.pts.values()],dist=Math.hypot(a[0]-b[0],a[1]-b[1]),mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];
if(crop.pinch){crop.x+=mid[0]-crop.pinch.mid[0];crop.y+=mid[1]-crop.pinch.mid[1];cropZoom(crop.zoom*dist/crop.pinch.dist,mid[0],mid[1])}crop.pinch={dist,mid}});
const up=e=>{if(!crop)return;crop.pts.delete(e.pointerId);crop.pinch=null};frame.addEventListener('pointerup',up);frame.addEventListener('pointercancel',up);
frame.addEventListener('wheel',e=>{e.preventDefault();const p=at(e);cropZoom(crop.zoom*Math.exp(-e.deltaY/400),p[0],p[1])},{passive:false});
d.querySelector('#crop-zoom').addEventListener('input',e=>cropZoom(Number(e.target.value)));
d.addEventListener('close',()=>{if(crop&&crop.d===d){URL.revokeObjectURL(crop.url);crop=null}},{once:true})}

/* What is inside the circle, 256px across. */
function cropPhoto(){const c=crop,s=c.base*c.zoom,out=document.createElement('canvas');out.width=out.height=256;
out.getContext('2d').drawImage(c.img,-c.x/s,-c.y/s,c.size/s,c.size/s,0,0,256,256);return out.toDataURL('image/jpeg',.85)}

document.addEventListener('click',e=>{const b=e.target.closest('#crop-cancel,#crop-use');if(!b||!crop)return;
if(b.id==='crop-use'){const previous=profile.photo;profile.photo=cropPhoto();crop.d.close();if(!saveProfile()){profile.photo=previous;toast('Not enough browser storage for this photo.');return}render();toast('Profile photo updated.');return}
crop.d.close()});

setProfilePhoto=async function(file){if(!file)return;if(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>15000000)return toast('Use a JPG, PNG or WebP photo under 15 MB.');
const url=URL.createObjectURL(file);try{const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=url});cropOpen(img,url)}catch{URL.revokeObjectURL(url);toast('This photo could not be read. Try another.')}
const f=$('#profile-photo');if(f)f.value=''};
