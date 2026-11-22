import {createGlobe} from './globe.js';
import {loadTerrain,computeDrainage,cellAt,getMetrics} from './hydrology.js';
import {loadBottleRounds,bottleClue,bottleResult} from './bottle.js';
import {icon} from './icons.js';
import {locationName} from './location.js';

const $=id=>document.getElementById(id);
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
$('info').innerHTML=icon('info');
$('expand').innerHTML=icon('expand');
const mobile=matchMedia('(max-width:720px)');
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
const fmt=new Intl.NumberFormat('en-US');
let mode='drain', terrain, model, rounds=[], roundIndex=0, guess, result, replayDay=7;
let plug={lat:29.125,lon:-41.125}, drop=0, playFrame=0, replayFrame=0;
let picking=false, collapsed=false, toastTimer;
let globe;
function starField(){
  const canvas=$('stars'), ctx=canvas.getContext('2d');
  const w=canvas.width=innerWidth,h=canvas.height=innerHeight;
  let seed=314159;
  function next(){seed=(1664525*seed+1013904223)>>>0;return seed/4294967296}
  ctx.clearRect(0,0,w,h);
  for(let i=0;i<w*h/1570;i++){
    const x=next()*w,y=next()*h,r=.28+next()**3*.92,a=.1+next()**2*.57;
    ctx.fillStyle='rgba(185,208,227,'+a+')';ctx.beginPath();ctx.arc(x,y,r,0,2*Math.PI);ctx.fill();
    if(r>1.16 && a>.48){ctx.fillStyle='#bccdd730';ctx.fillRect(x-2.3,y-.35,4.6,.7);ctx.fillRect(x-.35,y-2.3,.7,4.6)}
  }
}
function coordinates(lat,lon){return Math.abs(lat).toFixed(1)+'° '+(lat<0?'S':'N')+'  '+Math.abs(lon).toFixed(1)+'° '+(lon<0?'W':'E')}
function announce(text,persist=false){
  clearTimeout(toastTimer);$('notice').textContent=text;$('notice').hidden=!text;
  if(text&&!persist)toastTimer=setTimeout(()=>{$('notice').hidden=true},3600);
}
function actionState(){
  const ended=model&&drop>=model.plugDepth;
  $('drain-text').textContent=picking?'Cancel placement':playFrame?'Pause drainage':ended?'Refill ocean':drop?'Continue draining':'Pull the plug';
  $('drain-action').querySelector('[data-icon]').innerHTML=icon(picking?'close':playFrame?'pause':ended?'reset':drop?'play':'drain');
  $('drain-action').disabled=!model;
}
function setPick(active){
  picking=active;$('world').classList.toggle('picking',active);
  if(globe?.setCursor)globe.setCursor(active?'crosshair':'grab');
  $('relocate').setAttribute('aria-pressed',String(mode==='drain'&&active));
  $('plug-sites').hidden=!(mode==='drain'&&active);
  if(active){announce(mode==='drain'?'Select an ocean point for the plug.':'Select the buoy’s day-30 position.',true)}
  else announce('');
  actionState();
}
function stopDrain(){cancelAnimationFrame(playFrame);playFrame=0;actionState()}
function setPlug(lat,lon,initial=false){
  if(!terrain)return;
  const i=cellAt(terrain,lat,lon);
  if(!terrain.ocean[i]){announce('Choose open water. This point is on land or in an inland basin.',true);return}
  stopDrain();
  const y=Math.floor(i/terrain.width),x=i%terrain.width;
  plug={lat:90-(y+.5)*180/terrain.height,lon:(x+.5)*360/terrain.width-180};
  model=computeDrainage(terrain,i);globe.setDrainage(model.floor);$('place').textContent=locationName(plug.lat,plug.lon);
  $('place').title=coordinates(plug.lat,plug.lon);$('limit').textContent='−'+fmt.format(model.plugDepth)+' m';$('depth').max=model.plugDepth;
  $('depth').disabled=false;setPick(false);updateProfile();setDrop(0);globe.invalidate();
  if(!initial)announce('Plug placed at '+coordinates(plug.lat,plug.lon)+'.');
}
let chartBase=10,chartScale=.005;
function updateProfile(){
  // Elevations along the east-west transect, centered on the selected ocean cell.
  const values=[];
  for(let s=0;s<=100;s++)values.push(terrain.elevation[cellAt(terrain,plug.lat,plug.lon-38+.76*s)]);
  const high=Math.max(400,...values),low=Math.min(-500,...values,-model.plugDepth);
  chartScale=49/(high-low);chartBase=5+high*chartScale;
  const line=values.map((z,i)=>(i?'L':'M')+(i*1.6).toFixed(1)+' '+(chartBase-z*chartScale).toFixed(1)).join('');
  $('profile-edge').setAttribute('d',line);
  for(const id of ['profile-fill','profile-hatch'])$(id).setAttribute('d',line+'L160 62H0Z');
  $('profile-pt').setAttribute('cx','80');$('profile-pt').setAttribute('cy',chartBase+model.plugDepth*chartScale);
}
function setDrop(next){
  if(!model)return;
  drop=Math.round(Math.min(model.plugDepth,Math.max(0,next)));
  $('depth').value=drop;$('depth').style.setProperty('--progress',100*drop/model.plugDepth+'%');
  $('level').textContent=drop?'−'+fmt.format(drop):'0';
  $('depth').setAttribute('aria-valuetext',fmt.format(drop)+' meters below present sea level');
  $('water-edge').setAttribute('d','M0 '+(chartBase+drop*chartScale)+'H160');
  const metrics=getMetrics(model,drop);
  $('exposure').hidden=drop===0;$('exposure').textContent=metrics.exposedPercent.toFixed(1)+'% seafloor exposed · '+(metrics.retainedKm2/1e6).toFixed(2)+'M km² isolated water';
  globe.setLevel(-drop);actionState();
}
function drain(){
  if(picking){setPick(false);return}
  if(playFrame){stopDrain();return}
  if(!model)return;
  if(drop>=model.plugDepth){setDrop(0);return}
  const start=performance.now(),from=drop;
  const duration=Math.max(1500,17500*(1-from/model.plugDepth));
  const step=t=>{
    const p=Math.min(1,(t-start)/duration);
    setDrop(from+(model.plugDepth-from)*p);
    if(p<1)playFrame=requestAnimationFrame(step);
    else{playFrame=0;actionState();announce('The water has reached the plug. Isolated basins retain their water.')}
  };
  playFrame=requestAnimationFrame(step);actionState();
}
function drawPin(el,coords){
  if(!coords){el.hidden=true;return}
  const p=globe.project(coords[1],coords[0]);
  el.hidden=!p.visible;
  if(p.visible)el.style.transform='translate('+p.x+'px,'+p.y+'px)';
}
function projectPath(coords){
  let path='',lift=true;
  for(const [lon,lat] of coords){
    const p=globe.project(lat,lon);
    if(!p.visible){lift=true;continue}
    path+=(lift?'M':'L')+p.x.toFixed(1)+' '+p.y.toFixed(1);lift=false;
  }
  return path;
}
function guessArc(a,b){
  // Spherical interpolation keeps the distance line on the visible hemisphere.
  const rad=Math.PI/180;
  const v=([lon,lat])=>[Math.cos(lat*rad)*Math.cos(lon*rad),Math.cos(lat*rad)*Math.sin(lon*rad),Math.sin(lat*rad)];
  const A=v(a),B=v(b),theta=Math.acos(Math.max(-1,Math.min(1,A.reduce((sum,x,i)=>sum+x*B[i],0))));
  if(theta<1e-5)return [a,b];
  return Array.from({length:65},(_,i)=>{
    const t=i/64,u=Math.sin((1-t)*theta),w=Math.sin(t*theta),p=A.map((x,j)=>u*x+w*B[j]);
    return [Math.atan2(p[1],p[0])/rad,Math.atan2(p[2],Math.hypot(p[0],p[1]))/rad]
  });
}
function overlays(){
  if(!globe)return;
  $('coordinates').textContent=coordinates(globe.view.lat,globe.view.lon);
  if(mode==='drain'){
    drawPin($('pin'),model?[plug.lon,plug.lat]:null);$('pin-label').textContent='Drain plug';
    $('guess-pin').hidden=true;$('track-line').setAttribute('d','');$('guess-line').setAttribute('d','');return;
  }
  const round=rounds[roundIndex];if(!round)return;
  const track=result?round.track.slice(0,replayDay+1):bottleClue(round);
  $('track-line').setAttribute('d',projectPath(track));
  $('guess-line').setAttribute('d',result&&replayDay===30?projectPath(guessArc(guess,result.target)):'');
  drawPin($('pin'),track.at(-1));$('pin-label').textContent='Buoy · Day '+(track.length-1);drawPin($('guess-pin'),guess);
}
function onPick({lat,lon}){
  if(!picking)return;
  if(mode==='drain')setPlug(lat,lon);
  else{
    guess=[lon,lat];setPick(false);bottleUI();globe.invalidate();announce('Guess placed. Reveal the recorded route when you’re ready.')
  }
}
function layout(){
  if(!globe)return;
  const w=innerWidth,h=innerHeight;
  if(mobile.matches){
    const end=document.querySelector('.controls').getBoundingClientRect().top;
    const start=57,space=Math.max(94,end-start);
    globe.setLayout({cx:w*.5,cy:start+space*.49,radius:Math.min(w*.435,space*.46)});
  }else{
    const rail=w>1040?w*.628:w*.667;
    globe.setLayout({cx:rail,cy:h*.49,radius:Math.min(w*(w>1040?.32:.30),h*.393)});
  }
}
function bottleView(){
  const r=rounds[roundIndex];
  if(r){const [lon,lat]=r.track[7];globe.setView(lat,lon,1.65)}else globe.setView(20,-28,1);
}
function bottleUI(){
  const r=rounds[roundIndex];if(!r)return;
  $('round-place').textContent=r.label;$('round-label').textContent='Drifter '+r.drifterId+' · '+r.startDate;
  $('stat-name').textContent=result?'Distance from buoy':'Track shown';
  $('stat-value').textContent=result?fmt.format(result.distanceKm)+' km':'Day 0–7';
  $('bottle-action').disabled=Boolean(replayFrame);
  $('bottle-text').textContent=result?(replayFrame?'Replaying track…':'Next drifter'):guess?'Reveal the route':picking?'Cancel placement':'Place a guess';
  $('bottle-action').querySelector('[data-icon]').innerHTML=icon(result?'reset':guess?'play':picking?'close':'pin');
  $('intro').textContent=result?'Your guess earned '+fmt.format(result.score)+' of 1,000 points. The amber track shows where the buoy traveled.':'Watch a real buoy’s first week, then guess where the ocean carries it by day 30.';
}
function resetRound(){
  cancelAnimationFrame(replayFrame);replayFrame=0;guess=null;result=null;replayDay=7;setPick(false);bottleUI();bottleView();globe.invalidate();
}
function playBottle(){
  if(!rounds.length)return;
  if(result){roundIndex=(roundIndex+1)%rounds.length;resetRound();return}
  if(!guess){setPick(!picking);bottleUI();return}
  result=bottleResult(rounds[roundIndex],guess);
  if(reduceMotion.matches){replayDay=30;globe.invalidate();bottleUI();return}
  const start=performance.now();
  const step=t=>{
    replayDay=Math.min(30,7+Math.floor((t-start)/65));globe.invalidate();
    if(replayDay<30)replayFrame=requestAnimationFrame(step);else{replayFrame=0;bottleUI()}
  };
  replayFrame=requestAnimationFrame(step);bottleUI();
}
function setExperiment(next){
  $('experiments').hidden=true;$('switcher').setAttribute('aria-expanded','false');
  if(next===mode)return;
  stopDrain();cancelAnimationFrame(replayFrame);replayFrame=0;if(result)replayDay=30;
  mode=next;setPick(false);
  $('drain-body').hidden=mode!=='drain';$('bottle-body').hidden=mode!=='bottle';
  $('title').textContent=mode==='drain'?'Drain Plug':'Message in a Bottle';
  for(const el of document.querySelectorAll('[data-mode]'))el.setAttribute('aria-pressed',String(el.dataset.mode===mode));
  if(mode==='drain'){
    $('intro').textContent='Pull a plug in the ocean floor and watch the world beneath the waves emerge.';
    $('legend').innerHTML=drainLegend;globe.setLevel(-drop);globe.setView(plug.lat-9,plug.lon+13,1);
  }else{
    globe.setLevel(0);$('legend').innerHTML='<span class="legend-item"><i class="route"></i>Buoy track</span><span class="legend-item"><i class="trapped"></i>Your guess</span>';
    bottleUI();bottleView();
  }
  layout();globe.invalidate();
}
const drainLegend=$('legend').innerHTML;
function toggleFold(){
  collapsed=!collapsed;document.querySelector('.controls').classList.toggle('collapsed',collapsed);
  $('fold').setAttribute('aria-expanded',String(!collapsed));$('fold').setAttribute('aria-label',collapsed?'Expand experiment controls':'Collapse experiment controls');layout();
}
starField();
globe=createGlobe($('earth'),{onPick,onRender:overlays});
layout();
addEventListener('resize',()=>{starField();layout()});
new ResizeObserver(layout).observe(document.querySelector('.controls'));
$('depth').addEventListener('input',e=>{stopDrain();setDrop(Number(e.target.value))});
$('drain-action').onclick=drain;
$('reset').onclick=()=>{stopDrain();setPick(false);setDrop(0);announce('Sea level restored.')};
$('relocate').onclick=()=>{stopDrain();setPick(!picking)};
for(const button of document.querySelectorAll('[data-site]'))button.onclick=()=>{
  const [lat,lon]=button.dataset.site.split(',').map(Number);
  setPlug(lat,lon);globe.setView(lat,lon,1.22);layout();
};
$('home').onclick=()=>mode==='bottle'?bottleView():globe.setView(20,-28,1);
$('plus').onclick=()=>globe.zoomBy(1.2);$('minus').onclick=()=>globe.zoomBy(1/1.2);
$('bottle-action').onclick=playBottle;
$('fold').onclick=toggleFold;
$('switcher').onclick=()=>{const open=$('experiments').hidden;$('experiments').hidden=!open;$('switcher').setAttribute('aria-expanded',String(open))};
document.querySelector('[data-mode=drain]').setAttribute('aria-pressed','true');
for(const el of document.querySelectorAll('[data-mode]'))el.onclick=()=>setExperiment(el.dataset.mode);
document.addEventListener('click',e=>{if(!e.target.closest('#experiments,#switcher')){$('experiments').hidden=true;$('switcher').setAttribute('aria-expanded','false')}});
$('info').onclick=()=>$('guide').showModal();$('close-guide').onclick=()=>$('guide').close();
$('guide').onclick=e=>{if(e.target===$('guide')&&!e.target.closest('a')){const r=$('guide').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('guide').close()}};
$('expand').onclick=async()=>{try{
  if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else announce('This browser already uses the available screen. For an edge-to-edge view, add Pelagic to your home screen.')
}catch{announce('Your browser controls fullscreen in this view. Open the site in its own tab to expand it.')}};
document.addEventListener('fullscreenchange',()=>{const full=!!document.fullscreenElement;$('expand').innerHTML=icon(full?'shrink':'expand');$('expand').title=full?'Exit fullscreen':'Enter fullscreen';$('expand').setAttribute('aria-label',$('expand').title);layout()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){
  if(!$('experiments').hidden)$('switcher').click();
  if(picking){setPick(false);if(mode==='bottle')bottleUI()}
}});
const results=await Promise.allSettled([
  loadTerrain('./assets/terrain.bin',1440,720).then(t=>{terrain=t;globe.setTerrain(t);setPlug(plug.lat,plug.lon,true)}),
  loadBottleRounds().then(data=>{rounds=data;if(mode==='bottle'){bottleUI();bottleView()}}),
  globe.ready
]);
if(results.some(r=>r.status==='rejected'))announce('Some Earth data could not load. Refresh the page to retry.',true);
