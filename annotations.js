import {FontLoader} from './vendor/FontLoader.js';
import {localText} from './language.js';
import {viewBasis as basisOf} from './dimensions.js';

// 多类标注（标高、构件引注、轴号、剖切符号、说明）：内容来自 W2 已核的 scene.annotations。
// 尺寸链仍由 dimensions.js 绘制；其开关与布置链/选中构件下拉并入本面板“尺寸”一行，作为尺寸总开关。
// 文字与符号在重建时按“规则字高与屏幕可读下限(14px，按当前取景换算)取大者”定下世界尺寸，之后缩放旋转不改变世界坐标。
const CATEGORIES=[
 ['dimension_chain','Dimensions','尺寸'],['level','Levels','标高'],['member_label','Labels','构件引注'],
 ['grid','Grid','轴号'],['section_mark','Sections','剖切符号'],['note','Notes','说明'],['schedule','Schedules','明细表']];

export function createAnnotations({T,scene,camera,viewport,parts=[],cfg={},views,getView=()=>'',onChange=()=>{},onLayout=()=>{},dimensionToggle=()=>null,dimensionExtent=()=>[],dimensionObstacles=()=>[]}){
 const items=cfg.annotations||[],byId=new Map(parts.map(p=>[p.c.id,p]));
 const group=new T.Group();group.name='model-annotations';group.renderOrder=9500;scene.add(group);
 const lineMaterial=new T.LineBasicMaterial({color:0x7a2d1f,transparent:true,opacity:1,depthTest:false,depthWrite:false,toneMapped:false});
 const textMaterial=new T.MeshBasicMaterial({color:0x7a2d1f,transparent:true,opacity:1,depthTest:false,depthWrite:false,toneMapped:false,side:T.DoubleSide});
 const defaults=cfg.annotation_defaults||{},status=cfg.annotation_status||{missing:[]};
 const userChoice={};let font=null,fontPending=null,error='',lastKey='',built=[],current=null,probe=null,lastLayout=[];
 // 轴线、剖切符号等按当前视图范围内的构件外包定位（不含示意地面），避免被大地块撑开取景。
 const bounds=new T.Box3();
 const ground=c=>['site','terrain'].includes(c.group)||/^(existing|finished)_ground/.test(c.role||'');
 function scopeBounds(){
  const v=views.get(getView())||{};bounds.makeEmpty();
  for(const p of parts)if(!ground(p.c)&&(!v.groups||v.groups.includes(p.c.group)))bounds.union(p.box);
  if(bounds.isEmpty())for(const p of parts)bounds.union(p.box);
 }
 const panel=document.createElement('section');panel.className='annotation-control';
 panel.style.cssText='margin:10px 0 14px;padding:12px 14px;border:2px solid #9b6b55;border-radius:6px;background:#f6ede6;color:#5a2f22;font-size:14px';
 const heading=document.createElement('div');heading.style.cssText='font-weight:700;margin-bottom:6px';panel.append(heading);
 const boxes={};
 for(const [kind,en,zh] of CATEGORIES){
  const label=document.createElement('label');label.style.cssText='display:flex;align-items:center;gap:8px;min-height:30px;cursor:pointer';
  const input=document.createElement('input');input.type='checkbox';input.id='annotation-'+kind;input.dataset.kind=kind;input.style.cssText='width:20px;height:20px;margin:0';
  const name=document.createElement('span');name.dataset.en=en;name.dataset.zh=zh;
  label.append(input,name);panel.append(label);boxes[kind]={input,name};
  input.onchange=()=>{
   if(kind==='dimension_chain'){const t=dimensionToggle();if(t&&t.checked!==input.checked){t.checked=input.checked;t.dispatchEvent(new Event('change'));}return;}
   userChoice[kind]=input.checked;onLayout();rebuild();
  };
 }
 // 原尺寸控件（开关、模式下拉、说明）移入“尺寸”一行，同一 #dimensions-toggle 为唯一开关。
 const dimensionControl=document.querySelector('.dimension-control');
 if(dimensionControl){
  boxes.dimension_chain.input.closest('label').style.display='none';
  dimensionControl.style.cssText='margin:0 0 6px;padding:0;border:0;background:transparent;color:inherit;font-size:14px';
  const row=dimensionControl.querySelector('label');if(row)row.style.cssText='display:flex;align-items:center;gap:8px;min-height:30px;font-weight:400;cursor:pointer';
  const toggle=dimensionControl.querySelector('#dimensions-toggle');if(toggle)toggle.style.cssText='width:20px;height:20px;margin:0';
  heading.after(dimensionControl);
 }
 const missingNote=document.createElement('small');missingNote.style.cssText='display:block;margin-top:6px;line-height:1.5';panel.append(missingNote);
 document.querySelector('#shared-controls summary').after(panel);
 const count=(kind,view)=>kind==='dimension_chain'?(cfg.dimension_chains||[]).filter(c=>c.view_ids.includes(view)).length:items.filter(i=>i.kind===kind&&i.view_ids.includes(view)).length;
 // 切换视图即带出该视图全部标注；分类开关只用于手动隐藏（用户选择跨视图保持）。
 const enabled=kind=>kind==='dimension_chain'?Boolean(dimensionToggle()?.checked):(userChoice[kind]??true);
 function updatePanel(){
  const view=getView();heading.textContent=localText('Annotations','标注分类');
  for(const [kind] of CATEGORIES){const {input,name}=boxes[kind],n=count(kind,view);
   input.checked=enabled(kind);input.disabled=n===0&&kind!=='dimension_chain';
   name.textContent=localText(name.dataset.en,name.dataset.zh)+(n?` (${n})`:localText(' · none in view',' · 本视图无'));}
  const missing=(status.missing||[]).filter(m=>m.view===view);
  missingNote.textContent=error||missing.map(m=>`${localText('Missing','缺')} ${m.kind}: ${m.reason||localText('reason required','需补缺失理由')}`).join(' · ');
 }
 function loadFont(){
  if(font||fontPending)return;
  fontPending=new FontLoader().loadAsync(new URL('./vendor/helvetiker_regular.typeface.json',import.meta.url).href)
   .then(value=>{font=value;rebuild();}).catch(e=>{error=localText('3D font unavailable: ','实体字形加载失败：')+e.message;updatePanel();})
   .finally(()=>{fontPending=null;});
 }
 // 文字平面随视图类型固定：平面图水平、剖面平行剖切面、三维视图朝向视角水平投影。
 function frame(){
  const v=views.get(getView())||{};
  if(v.kind==='plan')return {axis:new T.Vector3(1,0,0),up:new T.Vector3(0,0,-1),normal:new T.Vector3(0,1,0)};
  const direction=new T.Vector3(...(v.direction||[1,.72,1]));direction.y=0;
  let normal=direction.lengthSq()>1e-9?direction.normalize():new T.Vector3(0,0,1);
  if(v.kind==='section'&&v.sections){const s=Object.values(v.sections)[0];const n=new T.Vector3(...s.normal);n.y=0;if(n.lengthSq()>1e-9){n.normalize();normal=n.dot(normal)>=0?n:n.negate();}}
  const up=new T.Vector3(0,1,0);return {axis:up.clone().cross(normal).normalize(),up,normal};
 }
 let sink=null;
 const textHeight=()=>{const v=views.get(getView())||{},base=v.kind==='plan'?.2:.16;
  const perPixel=camera&&viewport?.clientHeight?(camera.top-camera.bottom)/Math.max(camera.zoom,1e-6)/viewport.clientHeight:0;
  return Math.max(base,14*perPixel);};
 function segments(points,leader=false){if(probe)return null;if(sink){sink.push(...points);return null;}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(points.flatMap(p=>p.toArray()),3));const l=new T.LineSegments(g,lineMaterial);l.renderOrder=9500;l.userData={itemId:current?.id,leader};group.add(l);return l;}
 // 字宽：字形已加载时按实际字形比例，否则按字数估算（与 text() 的“字高=字形包围盒高”缩放一致）。
 const measures=new Map();
 function textWidth(content,height){
  if(!font)return content.length*.62*height;
  if(!measures.has(content)){const g=new T.ShapeGeometry(font.generateShapes(content,1));g.computeBoundingBox();const b=g.boundingBox;measures.set(content,(b.max.x-b.min.x)/Math.max(b.max.y-b.min.y,.01));g.dispose();}
  return measures.get(content)*height;
 }
 function text(content,position,f,height=.16,align='left'){
  if(sink||probe){const w=textWidth(content,height),x0=align==='center'?-w/2:align==='right'?-w:0,pts=[];
   for(const dx of [x0,x0+w])for(const dy of [-height/2,height/2])pts.push(position.clone().addScaledVector(f.axis,dx).addScaledVector(f.up,dy));
   if(probe)probe.push(pts);else sink.push(...pts);return null;}
  const geometry=new T.ShapeGeometry(font.generateShapes(content,1));geometry.computeBoundingBox();const b=geometry.boundingBox;
  geometry.translate(align==='center'?-(b.max.x+b.min.x)/2:align==='right'?-b.max.x:-b.min.x,-(b.max.y+b.min.y)/2,0);
  const mesh=new T.Mesh(geometry,textMaterial);mesh.renderOrder=9600;
  mesh.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(f.axis,f.up,f.normal));
  mesh.scale.setScalar(height/Math.max(b.max.y-b.min.y,.01));mesh.position.copy(position).addScaledVector(f.normal,.01);
  mesh.userData.text=content;mesh.userData.itemId=current?.id;mesh.userData.kind=current?.kind;group.add(mesh);return mesh;
 }
 const center=part=>part.box.getCenter(new T.Vector3());
 // 窄视窗平面图引注只写编号（mark），完整规格见明细表，避免长文字挤小模型。
 const labelText=item=>item.mark&&(views.get(getView())||{}).kind==='plan'&&viewport.clientWidth<600?item.mark:item.text;
 function draw(item,f,L=null){
  const s=textHeight(),k=s/.22;scopeBounds();
  // 轴线、剖切符号、平面引注落在构件与尺寸链共同外包之外，不与尺寸文字重叠。
  const outer=bounds.clone();for(const q of dimensionExtent())outer.expandByPoint(q);
  if(item.kind==='level'){
   const {base:origin,label}=levelBase(item,f,k),{dx=0,dh=0}=L?.get(item.id)||{},base=origin.clone().addScaledVector(f.axis,dx).addScaledVector(f.up,dh);
   const a=base.clone().addScaledVector(f.axis,-.45*k),b=base.clone().addScaledVector(f.axis,.45*k),tip=base.clone().addScaledVector(f.axis,-.3*k);
   const l=tip.clone().addScaledVector(f.axis,-.09*k).addScaledVector(f.up,.14*k),r=tip.clone().addScaledVector(f.axis,.09*k).addScaledVector(f.up,.14*k);
   segments([a,b,tip,l,tip,r,l,r]);
   // 符号被排到构件外侧时，用引线连回原指示点（标高数值仍由符号文字给出）。
   if(dx||dh)segments([origin,base.clone().addScaledVector(f.axis,-Math.sign(dx)*.45*k)],true);
   return text(label,tip.clone().addScaledVector(f.up,.28*k).addScaledVector(f.axis,-.1*k),f,s);
  }
  if(item.kind==='member_label'){
   const part=byId.get(item.ref);if(!part)throw Error('Missing annotation reference: '+item.ref);
   const place=L?.get(item.id),at=place?.anchor||center(part);
   // 无显式偏移时终点由屏幕空间排布给出（文字沿引线外端放置，避开尺寸文字、其他标注和构件）。
   const end=item.offset?at.clone().add(new T.Vector3(...item.offset)):place?place.end:at.clone().add(f.up.clone().multiplyScalar(.7*k).addScaledVector(f.axis,.7*k));
   const sign=place?.sign||1,shoulder=end.clone().addScaledVector(f.axis,.25*k*sign);
   const d=.03;segments([at,end,end,shoulder],true);segments([at.clone().addScaledVector(f.axis,-d),at.clone().addScaledVector(f.axis,d),at.clone().addScaledVector(f.up,-d),at.clone().addScaledVector(f.up,d)]);
   return text(labelText(item),shoulder.clone().addScaledVector(f.axis,.05*sign),f,s,sign>0?'left':'right');
  }
  if(item.kind==='grid'){
   const index=item.axis==='x'?'x':'z',other=index==='x'?'z':'x',[lo,hi]=item.extent||[outer.min[other]-.3*k,outer.max[other]+.3*k];
   const a=new T.Vector3(),b=new T.Vector3();a[index]=b[index]=item.position;a[other]=lo;b[other]=hi;a.y=b.y=bounds.min.y;
   const ring=(c)=>{const pts=[];for(let i=0;i<24;i++){const t0=i/24*Math.PI*2,t1=(i+1)/24*Math.PI*2;pts.push(c.clone().addScaledVector(f.axis,Math.cos(t0)*.22*k).addScaledVector(f.up,Math.sin(t0)*.22*k),c.clone().addScaledVector(f.axis,Math.cos(t1)*.22*k).addScaledVector(f.up,Math.sin(t1)*.22*k));}return pts;};
   const ca=a.clone(),cb=b.clone();ca[other]-=.22*k;cb[other]+=.22*k;
   if(probe)probe.lines.push([a,b]);
   segments([a,b,...ring(ca),...ring(cb)]);text(item.label,ca,f,s,'center');return text(item.label,cb,f,s,'center');
  }
  if(item.kind==='section_mark'){
   const target=views.get(item.section_view),plane=Object.values(target.sections)[0],n=new T.Vector3(...plane.normal);
   const t=new T.Vector3(0,1,0).cross(n).normalize(),c=bounds.getCenter(new T.Vector3()),origin=n.clone().multiplyScalar(-plane.constant);
   const base=c.clone().sub(n.clone().multiplyScalar(c.clone().sub(origin).dot(n)));base.y=bounds.max.y;
   const half=Math.abs(t.x)*outer.getSize(new T.Vector3()).x/2+Math.abs(t.z)*outer.getSize(new T.Vector3()).z/2+.3*k;
   base.x+=t.x*(outer.getCenter(new T.Vector3()).x-c.x);base.z+=t.z*(outer.getCenter(new T.Vector3()).z-c.z);
   const a=base.clone().addScaledVector(t,-half),b=base.clone().addScaledVector(t,half),pts=[];
   for(const e of [a,b]){const head=e.clone().addScaledVector(n,.4);pts.push(e,head,head,head.clone().addScaledVector(n,-.12).addScaledVector(t,.08),head,head.clone().addScaledVector(n,-.12).addScaledVector(t,-.08));}
   const dash=[];for(let k=0;k<40;k+=2)dash.push(a.clone().lerp(b,k/40),a.clone().lerp(b,(k+1)/40));
   if(probe)probe.lines.push([a,b]);
   segments([...pts,...dash]);text(item.label,a.clone().addScaledVector(n,.65),f,s,'center');return text(item.label,b.clone().addScaledVector(n,.65),f,s,'center');
  }
  if(item.kind==='note')return text(item.text,new T.Vector3(...item.position),f,s);
 }
 function levelBase(item,f,k){
  const part=item.ref?byId.get(item.ref):null;if(item.ref&&!part)throw Error('Missing annotation reference: '+item.ref);
  const y=part?part.box[item.face||'max'].y:item.value_m;
  const base=part?center(part):bounds.getCenter(new T.Vector3());
  if(item.at){base.x=item.at[0];base.z=item.at[1];}else if(!part)base.addScaledVector(f.axis,-(bounds.getSize(new T.Vector3()).length()/2+.4));
  base.y=y;return {base,y,label:`${item.label} ${(y>=0?'+':'')+y.toFixed(3)}`};
 }
 // 与取景一致的相机平面基：平面图朝下，其余按视图方向；布局只依赖它，不依赖当前相机状态，缩放平移不影响结果。
 const viewBasis=()=>basisOf(T,views.get(getView()));
 function hullOf(points){
  const q=[...new Set(points.map(p=>p[0].toFixed(5)+','+p[1].toFixed(5)))].map(t=>t.split(',').map(Number)).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  if(q.length<3)return q;const turn=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]),lower=[],upper=[];
  for(const p of q){while(lower.length>1&&turn(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
  for(const p of [...q].reverse()){while(upper.length>1&&turn(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
  return [...lower.slice(0,-1),...upper.slice(0,-1)];
 }
 // 矩形（相机平面）与凸多边形是否相交：分离轴检验。
 function rectHitsHull(r,h){
  if(h.length<3)return false;
  if(r.r<=Math.min(...h.map(p=>p[0]))||r.l>=Math.max(...h.map(p=>p[0]))||r.t<=Math.min(...h.map(p=>p[1]))||r.b>=Math.max(...h.map(p=>p[1])))return false;
  const rc=[[r.l,r.b],[r.r,r.b],[r.r,r.t],[r.l,r.t]];
  for(let i=0;i<h.length;i++){const a=h[i],b=h[(i+1)%h.length],nx=b[1]-a[1],ny=a[0]-b[0];
   if(rc.every(c=>(c[0]-a[0])*nx+(c[1]-a[1])*ny>=0))return false;}
  return true;
 }
 // 屏幕空间排布：尺寸文字最优先，其次轴号/剖切等固定文字，再标高，最后构件引注；
 // 引注沿固定方向（平面图向南，其他视图向屏幕左右）加长引线并错位，直到文字框不与已占用框、构件投影外包相交，引线不穿过任何文字框。
 function computeLayout(wanted,f){
  const out=new Map(),B=viewBasis(),s=textHeight(),k=s/.22,gap=.35*s,v=views.get(getView())||{},plan=v.kind==='plan',exempt=v.kind==='section';
  const uv=p=>[p.dot(B.right),p.dot(B.up)];
  const rectOf=pts=>{const q=pts.map(uv),xs=q.map(a=>a[0]),ys=q.map(a=>a[1]);return {l:Math.min(...xs),r:Math.max(...xs),b:Math.min(...ys),t:Math.max(...ys)};};
  const grow=(r,g)=>({l:r.l-g,r:r.r+g,b:r.b-g,t:r.t+g}),hit=(a,b)=>a.l<b.r&&a.r>b.l&&a.b<b.t&&a.t>b.b;
  const crosses=(p,q,r)=>{let lo=0,hi=1;const dx=q[0]-p[0],dy=q[1]-p[1];
   for(const [d,e] of [[-dx,p[0]-r.l],[dx,r.r-p[0]],[-dy,p[1]-r.b],[dy,r.t-p[1]]]){
    if(Math.abs(d)<1e-12){if(e<0)return false;continue;}const t=e/d;if(d<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return false;}
   return true;};
  const ccw=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const segCross=(p,q,r,t)=>ccw(p,q,r)*ccw(p,q,t)<0&&ccw(r,t,p)*ccw(r,t,q)<0;
  const leaders=[],solid=[],guides=[];for(const pts of dimensionObstacles())solid.push(rectOf(pts));
  for(const item of wanted){
   if(item.kind==='level'||item.kind==='schedule'||(item.kind==='member_label'&&!item.offset))continue;
   const boxes=[];boxes.lines=[];probe=boxes;try{draw(item,f,null);}catch(e){}finally{probe=null;}
   for(const pts of boxes)solid.push(rectOf(pts));
   for(const [a,b] of boxes.lines)guides.push([uv(a),uv(b)]);
  }
  const hullPoints=[];for(const p of parts)if(p.o.visible&&!ground(p.c))for(let i=0;i<8;i++)hullPoints.push(uv(new T.Vector3(i&1?p.box.max.x:p.box.min.x,i&2?p.box.max.y:p.box.min.y,i&4?p.box.max.z:p.box.min.z)));
  const hullAll=hullOf(hullPoints),hull=exempt?[]:hullAll,centre=hullAll.length?hullAll.reduce((a,p)=>a+p[0],0)/hullAll.length:0;
  const side=p=>uv(p)[0]>=centre?1:-1;
  const free=r=>{const g=grow(r,gap);return !solid.some(o=>hit(g,o))&&!guides.some(([p,q])=>crosses(p,q,g))&&!rectHitsHull(g,hull);};
  const textClear=(p,q)=>!solid.some(o=>crosses(p,q,grow(o,.2*s))),clear=(p,q)=>textClear(p,q)&&!leaders.some(([r,t])=>segCross(p,q,r,t));
  const tierOf=(...segs)=>segs.every(([p,q])=>clear(p,q))?0:segs.every(([p,q])=>textClear(p,q))?1:2;
  const corners=(o,a0,a1,h0,h1)=>[[a0,h0],[a1,h0],[a0,h1],[a1,h1]].map(([a,h])=>o.clone().addScaledVector(f.axis,a).addScaledVector(f.up,h));
  // 候选顺序：引线由短到长；同长度先取偏好侧再取另一侧，再按固定间距上下错位。找不到完全合格的位置时，退而取文字框不相交者，最后才取最短位置。
  // 候选已按引线长度排序。引线不穿过任何文字框是硬条件；引线互不交叉在不显著加长引线时优先满足。
  const search=(candidates)=>{let t1=null,first=null;
   for(const c of candidates){first=first||c;if(t1&&c.cost>t1.cost*6+25*s)break;if(!free(c.r))continue;
    const tier=c.leader();if(tier===0){c.q='ok';return c;}if(tier===1&&!t1)t1=c;}
   if(t1){t1.q='text-clear';return t1;}
   const semi=candidates.find(c=>free(c.r));if(semi){semi.q='semi';return semi;}first.q='first';return first;};
  const byCost=list=>list.sort((a,b)=>a.cost-b.cost);
  // 平面图：引注文字竖排成一列，置于构件与尺寸文字外包的左侧，按指示点自上而下排序、等距错开，文字互不重叠，引线按序不交叉。
  if(plan){
   const col=wanted.filter(i=>i.kind==='member_label'&&!i.offset&&byId.has(i.ref)).map(item=>{const A=center(byId.get(item.ref));return {item,A,a:uv(A)};});
   if(col.length){
    scopeBounds();const xs=[...hullAll.map(p=>p[0]),...solid.map(r=>r.l),uv(bounds.min)[0],uv(bounds.max)[0]].filter(Number.isFinite);
    const left=Math.min(...xs)-1.2*k,pitch=1.9*s;let prev=Infinity;
    col.sort((p,q)=>q.a[1]-p.a[1]||p.a[0]-q.a[0]);
    for(const c of col){const y=Math.min(c.a[1],prev-pitch);prev=y;
     const E=c.A.clone().addScaledVector(f.axis,left+.3*k-c.a[0]).addScaledVector(f.up,y-c.a[1]);
     out.set(c.item.id,{anchor:c.A,end:E,sign:-1,q:'column'});solid.push({l:left-textWidth(labelText(c.item),s)-.1,r:left+.3*k,b:y-s/2,t:y+s/2});leaders.push([c.a,[left+.3*k,y]]);}
   }
  }
  for(const item of wanted.filter(i=>!plan&&i.kind==='member_label'&&!i.offset)){
   const part=byId.get(item.ref);if(!part)continue;
   const w=textWidth(item.text,s),ext=.25*k+.05+w,mid=center(part);
   const lats=plan?[.5*k,...Array.from({length:12},(_,j)=>[.5*k+(j+1)*2*s,.5*k-(j+1)*2*s]).flat()]:[0,...Array.from({length:16},(_,j)=>[(j+1)*1.5*s,-(j+1)*1.5*s]).flat()];
   // 指示点先取构件中心；中心被尺寸文字压住或无合格位置时，依次试构件顶面、底面中心。
   const anchors=[mid,mid.clone().setY(part.box.max.y),mid.clone().setY(part.box.min.y)];let chosen=null;
   for(const A of anchors){
    const sign=plan?1:side(A),a=uv(A),list=[];
    for(let i=0;i<200;i++){
     const length=.7*k+i*.5*s;
     for(const sd of plan?[1]:[sign,-sign])for(const lat of lats){
      const E=plan?A.clone().addScaledVector(f.up,-length).addScaledVector(f.axis,lat):A.clone().addScaledVector(f.axis,sd*length).addScaledVector(f.up,lat);
      const e=uv(E),sh=uv(E.clone().addScaledVector(f.axis,.25*k*sd));
      list.push({A,E,sign:sd,cost:Math.hypot(e[0]-a[0],e[1]-a[1])+(sd===sign?0:.5*s),r:rectOf(corners(E,sd>0?0:-ext,sd>0?ext:0,-s/2,s/2)),seg:[a,e],leader:()=>tierOf([a,e],[e,sh])});
     }
    }
    const c=search(byCost(list));chosen=chosen||c;
    if(c.q==='ok'){chosen=c;break;}
    if(c.q==='text-clear'&&chosen.q!=='ok'&&(chosen.q!=='text-clear'||c.cost<chosen.cost))chosen=c;
   }
   out.set(item.id,{anchor:chosen.A,end:chosen.E,sign:chosen.sign,q:chosen.q});solid.push(chosen.r);leaders.push(chosen.seg);
  }
  for(const item of wanted.filter(i=>i.kind==='level')){
   const {base,label}=levelBase(item,f,k),w=textWidth(label,s),sign=side(base),b0=uv(base);
   const a1=Math.max(.45*k,w-.4*k),h0=Math.min(0,.28*k-s/2),h1=Math.max(.14*k,.28*k+s/2),lats=[0,...Array.from({length:3},(_,j)=>[(j+1)*2*s,-(j+1)*2*s]).flat()],list=[];
   for(let i=0;i<240;i++)for(const sd of i?[sign,-sign]:[sign])for(const dh of lats){
    if(!i&&dh)continue;
    const dx=sd*i*.5*s,o=base.clone().addScaledVector(f.axis,dx).addScaledVector(f.up,dh),end=o.clone().addScaledVector(f.axis,-Math.sign(dx)*.45*k),q=uv(end);
    list.push({dx,dh,cost:Math.hypot(q[0]-b0[0],q[1]-b0[1])+(sd===sign?0:.5*s),r:rectOf(corners(o,-.45*k,a1,h0,h1)),seg:[b0,q],leader:()=>(!dx&&!dh)?0:tierOf([b0,q])});
   }
   const chosen=search(byCost(list));
   out.set(item.id,{dx:chosen.dx,dh:chosen.dh,q:chosen.q});solid.push(chosen.r);if(chosen.dx||chosen.dh)leaders.push(chosen.seg);
  }
  lastLayout=[...out].map(([id,v])=>({id,q:v.q}));return out;
 }
 const labelsInView=()=>items.filter(i=>i.kind==='member_label'&&i.view_ids.includes(getView())).map(i=>i.id);
 // 明细表与说明是图纸上的文字块：停靠视窗右侧（竖排）或底部（横排），取景按两种停靠各算一次、取模型更大者并让出其占位，不压模型；
 // 手机单列布局（main 为 block）时移到视窗下方随页面流动，不占视窗。dock(side) 设定停靠并返回占位像素（右侧为宽，底部为高）。
 const tables=document.createElement('div');tables.id='annotation-schedules';
 viewport.append(tables);
 const stacked=()=>getComputedStyle(viewport.parentElement).display==='block';
 const DOCK={right:'position:absolute;right:8px;top:8px;left:auto;bottom:auto;display:flex;flex-direction:column;align-items:flex-end;gap:6px;max-width:46%;max-height:calc(100% - 80px);overflow:auto;z-index:3',
  bottom:'position:absolute;left:8px;right:150px;bottom:8px;top:auto;display:flex;flex-direction:row;flex-wrap:wrap;align-items:flex-end;gap:6px;max-height:45%;overflow:auto;z-index:3'};
 tables.style.cssText=DOCK.right;
 function dock(side){
  if(stacked()){if(tables.parentElement===viewport)viewport.after(tables);tables.style.cssText='display:flex;flex-wrap:wrap;gap:6px;padding:8px;overflow-x:auto';return 0;}
  if(tables.parentElement!==viewport)viewport.append(tables);tables.style.cssText=DOCK[side];if(!tables.childElementCount)return 0;return (side==='right'?tables.offsetWidth:tables.offsetHeight)+16;}
 function drawTables(list){tables.replaceChildren();for(const it of list){if(it.kind==='note'){const n=document.createElement('div');n.textContent=it.text;n.dataset.itemId=it.id;n.style.cssText='max-width:360px;background:rgba(255,255,255,.92);color:#7a2d1f;font:600 12px/1.4 sans-serif;border:1.5px solid #7a2d1f;padding:4px 8px';tables.append(n);continue;}const box=document.createElement('table');box.style.cssText='border-collapse:collapse;background:rgba(255,255,255,.92);color:#111;font:600 12px/1.3 sans-serif;border:1.5px solid #111';const cap=document.createElement('caption');cap.textContent=it.title;cap.style.cssText='font:700 13px sans-serif;padding:2px 6px;background:rgba(255,255,255,.92);border:1.5px solid #111;border-bottom:0';box.append(cap);const head=box.insertRow();for(const c of it.columns){const th=document.createElement('th');th.textContent=c;th.style.cssText='border:1px solid #111;padding:2px 6px;text-align:left';head.append(th);}for(const r of it.rows){const tr=box.insertRow();for(const c of r){const td=tr.insertCell();td.textContent=c;td.style.cssText='border:1px solid #111;padding:2px 6px';}}tables.append(box);}}
 function clear(){tables.replaceChildren();for(const o of [...group.children]){o.geometry.dispose();group.remove(o);}built=[];}
 function rebuild(){
  clear();error='';lastKey=viewKey();
  const all=items.filter(i=>i.view_ids.includes(getView())&&enabled(i.kind)),block=i=>i.kind==='schedule'||i.kind==='note',wanted=all.filter(i=>!block(i));drawTables(all.filter(block));built.push(...all.filter(block).map(i=>i.id));
  if(wanted.length&&!font){loadFont();}
  else if(font){const f=frame();let L=null;try{L=computeLayout(wanted,f);}catch(e){error=e.message;}for(const item of wanted){current=item;try{draw(item,f,L);built.push(item.id);}catch(e){error=e.message;}}current=null;}
  updatePanel();onChange();
 }
 // 视图、尺寸文字位置或可见构件集变化时重排（构件图层开关不触发重建事件，由签名捕获）。
 const viewKey=()=>getView()+'|'+parts.filter(p=>p.o.visible).length+'|'+dimensionObstacles().map(o=>o.map(p=>p.x.toFixed(2)+','+p.z.toFixed(2)).join(' ')).join(';');
 function update(){if(lastKey!==viewKey())rebuild();}
 // 取景用：按与绘制相同的几何估算当前视图已开启标注的外包点（无需字形，文字宽按字数估算）。
 function extent(){
  const points=[],wanted=items.filter(i=>i.view_ids.includes(getView())&&enabled(i.kind)&&i.kind!=='schedule'&&i.kind!=='note'),f=frame();let L=null;try{L=computeLayout(wanted,f);}catch(e){}
  sink=points;
  try{for(const item of wanted){try{draw(item,f,L);}catch(e){}}}finally{sink=null;}
  return points;
 }
 document.addEventListener('model-language',updatePanel);
 // 尺寸开关改变尺寸链外包，标注位置随之重排。
 dimensionToggle()?.addEventListener('change',()=>rebuild());
 rebuild();
 // 验证用：已绘标注外包在视窗中的像素范围。
 function screenBounds(){
  if(!group.children.length||!camera||!viewport)return null;
  const box=new T.Box3().setFromObject(group),xs=[],ys=[];camera.updateMatrixWorld();
  for(let i=0;i<8;i++){const q=new T.Vector3(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z).project(camera);
   xs.push((q.x+1)*viewport.clientWidth/2);ys.push((1-q.y)*viewport.clientHeight/2);}
  return {left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys),width:viewport.clientWidth,height:viewport.clientHeight};
 }
 // 验证用：以当前相机把已绘文字框、引线与构件投影外包投到视窗像素，供浏览器断言（与排布所用的视图基相互独立）。
 function screenLayout(){
  if(!camera||!viewport)return null;
  camera.updateMatrixWorld();const W=viewport.clientWidth,H=viewport.clientHeight;
  const px=p=>{const q=p.clone().project(camera);return [(q.x+1)*W/2,(1-q.y)*H/2];};
  const texts=[],leaders=[];
  for(const o of group.children){
   if(o.isMesh&&o.userData.text!==undefined){
    o.updateWorldMatrix(true,false);const b=o.geometry.boundingBox,q=Array.from({length:8},(_,i)=>px(new T.Vector3(i&1?b.max.x:b.min.x,i&2?b.max.y:b.min.y,i&4?b.max.z:b.min.z).applyMatrix4(o.matrixWorld)));
    texts.push({id:o.userData.itemId,kind:o.userData.kind,text:o.userData.text,left:Math.min(...q.map(a=>a[0])),right:Math.max(...q.map(a=>a[0])),top:Math.min(...q.map(a=>a[1])),bottom:Math.max(...q.map(a=>a[1]))});
   }else if(o.userData.leader){
    const a=o.geometry.attributes.position,segs=[];for(let i=0;i+1<a.count;i+=2)segs.push([px(new T.Vector3().fromBufferAttribute(a,i)),px(new T.Vector3().fromBufferAttribute(a,i+1))]);
    leaders.push({id:o.userData.itemId,segments:segs});
   }
  }
  const v=views.get(getView())||{};let hull=null;
  if(v.kind!=='section'){const pts=[];for(const p of parts)if(p.o.visible&&!ground(p.c))for(let i=0;i<8;i++)pts.push(px(new T.Vector3(i&1?p.box.max.x:p.box.min.x,i&2?p.box.max.y:p.box.min.y,i&4?p.box.max.z:p.box.min.z)));hull=hullOf(pts);}
  return {texts,leaders,hull,width:W,height:H};
 }
 return {update,rebuild,extent,dock,state:()=>({screenLayout:screenLayout(),layoutQuality:lastLayout,fontReady:Boolean(font),error,view:getView(),textHeight:textHeight(),screenBounds:screenBounds(),
  categories:Object.fromEntries(CATEGORIES.map(([kind])=>[kind,{enabled:enabled(kind),count:count(kind,getView()),disabled:boxes[kind].input.disabled}])),
  visibleItems:[...built],texts:group.children.filter(o=>o.isMesh).map(o=>o.userData.text),objects:group.children.length,
  missing:(status.missing||[]).filter(m=>m.view===getView())})};
}
