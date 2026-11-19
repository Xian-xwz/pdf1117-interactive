import {configureControls} from './configuration.js';
import {createDimensions} from './dimensions.js';
import {createAnnotations} from './annotations.js';
import {createViewControls} from './view-controls.js';
import {createSelectionHighlight} from './selection-highlight.js';
import {OrbitControls} from './vendor/OrbitControls.js';
import {createDetailLoader} from './component-details.js';
import {renderPresentation,wallValue,componentTitle} from './presentation.js';
import {configureLanguage,translateTree,translated,currentLanguage,localText} from './language.js';

export function install(env){
 const {T,scene,renderer,camera,parts,model,cfg,groundGroup,groundBoxes,setGroundSurface,setShadows,stage,caps,sectionCap,instances}=env;
 configureLanguage(cfg);configureControls(cfg,env.meta);translateTree();
 const detailLoader=createDetailLoader(env.metadataURL,env.gltfLoader);
 let localModel=null,originalLayers=[];
 const viewport=document.querySelector('#viewport'),canvas=renderer.domElement;
 // 小窗与右侧详情共存，放大继续使用来源弹窗及独立资源生命周期。
 const nodePreview=document.createElement('section');nodePreview.className='node-preview';nodePreview.hidden=true;viewport.append(nodePreview);
 let previewGeneration=0;
 const detailSlots=cfg.detail_slots||[];
 // 与 W2 同一规则：按 detail_slots 顺序取首个命中的 Detail 位。
 // 机器生成位可含参数分组图：按选中构件所在组取图；不在任何组时返回 null（显示主图并明示不同）。
 const slotVariant=(slot,c)=>slot?.source?.variants?.find(v=>v.members.includes(c.id))||null;
 const slotOf=c=>detailSlots.find(s=>s.match?.ids?.includes(c.id)||s.match?.roles?.includes(c.role)||s.match?.groups?.includes(c.group))||null;
 function closeNodePreview(){previewGeneration++;detailLoader.releasePreviewSource();nodePreview.hidden=true;nodePreview.replaceChildren();delete nodePreview.dataset.slot;}
 async function showNodePreview(p,c){
  closeNodePreview();
  // 来源优先级：构件节点图（资料截图简化形式）> Detail 位截图 > 机器制图；待提供不弹图。
  let source=c.parameters?.viewer?.sources?.find(s=>s.presentation_role==='node_detail'&&s.mime?.startsWith('image/'));
  let caption='';
  const slot=slotOf(p.c);
  if(!source&&slot&&slot.status!=='pending'){
   const s=slot.source,variant=slotVariant(slot,p.c);source={...(variant?.image||s.image),title:slot.title};
   caption=s.kind==='generated'?`Generated drawing, not original · ${s.scale} / 生成图，非原图 · ${s.scale}`:`Document crop · page ${s.page} / 资料截图 · 第${s.page}页`;
   if(s.kind==='generated'&&s.variants?.length){
    caption+=variant?` · Typical: represents ${variant.typical_count}/${variant.total_count} piles (ref ${variant.representative}); selected ${p.c.id} is in this group / 代表 ${variant.typical_count}/${variant.total_count} 根（参考 ${variant.representative}），当前选中 ${p.c.id} 属于此组`
     :` · Selected ${p.c.id} is not in the typical group; its parameters differ from this drawing / 当前选中 ${p.c.id} 不属于代表组，参数与本图不同`;
   }
  }
  if(!source)return;
  if(caption)source={...source,locator:caption};
  const generation=previewGeneration;
  nodePreview.hidden=false;nodePreview.setAttribute('aria-label',translated('Connection figure / 节点详图'));
  const close=el('button','×','node-preview-close');close.type='button';close.setAttribute('aria-label',translated('Close figure / 收起节点图'));close.onclick=()=>{nodePreview.hidden=true;};
  const button=el('button','Loading source / 正在读取依据','node-preview-image');button.type='button';button.setAttribute('aria-label',translated('Click to enlarge / 点击放大'));nodePreview.dataset.source=source.path;
  nodePreview.append(close,button);
  if(caption){nodePreview.dataset.slot=slot.id;nodePreview.append(el('p',caption,'node-preview-caption'));}
  button.onclick=()=>openSource(source,button);
  try{
   const url=await detailLoader.loadPreviewSource(source);
   if(selected!==p||generation!==previewGeneration)return;
   const img=document.createElement('img');img.src=url;img.alt=translated(source.title);button.replaceChildren(img);
   const side=document.querySelector('.node-source-button');
   if(side){const thumb=img.cloneNode();side.prepend(thumb);}
  }catch(error){if(error.name!=='AbortError'&&selected===p&&generation===previewGeneration){button.textContent=translated('Figure unavailable / 节点图暂不可用');nodePreview.append(el('p',error.message));}}
 }
 if(navigator.maxTouchPoints>0||matchMedia('(pointer: coarse)').matches)document.querySelector('.gestures').innerHTML='One finger: rotate · Two fingers: zoom / pan<br><small>单指旋转 · 双指缩放或平移 · 轻点查看构件</small>';
 const controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.dampingFactor=.1;controls.minZoom=.25;controls.maxZoom=10;controls.maxPolarAngle=Math.PI*.495;
 renderer.shadowMap.autoUpdate=false;
 const ray=new T.Raycaster(),pointer=new T.Vector2();
 const views=new Map(cfg.views.map(v=>[v.id,v]));
 let view=cfg.default_view||cfg.views[0].id,roof=true,terrain=false,trusses=false,selected=null,dirty=true,down=null,initialized=false,surface=cfg.ground_default||'finished';
 const dimensions=createDimensions({T,scene,camera,viewport,parts,cfg,getView:()=>view,onChange:()=>dirty=true,onModeChange:target=>target?preset(target):applyView()});
 const viewControls=createViewControls(cfg,views,()=>applyView(false));
 const annotations=createAnnotations({T,scene,camera,viewport,parts,cfg,views,getView:()=>view,onChange:()=>dirty=true,onLayout:()=>applyView(),dimensionToggle:()=>document.querySelector('#dimensions-toggle'),dimensionExtent:()=>dimensions.extent(),dimensionObstacles:()=>dimensions.obstacles()});
 // viewer_framework 包：屋面/屋架只由 scene.floor_layers 驱动，固定开关不渲染（旧包不变）。
 const framework=cfg.viewer_framework===1;
 const soleLayer=g=>framework?cfg.floor_layers.find(l=>l.groups?.length===1&&l.groups[0]===g&&!l.floors)?.id:undefined;
 const roofLayer=soleLayer('roof'),trussLayer=soleLayer('trusses');
 for(const [id,layer] of [['roof',roofLayer],['trusses',trussLayer]])if(layer){const label=document.getElementById(id).closest('label');label.hidden=true;label.style.display='none';}
 const foundationGroups=new Set(['framing','foundation']);
 const inViewScope=(c,v)=>(!v.groups||v.groups.includes(c.group))&&(!v.block||v.block===c.block)&&
  (!v.floors||v.floors.includes(c.floor));
 let wallMode='solid',terrainTranslucent=false;const layers=Object.fromEntries(cfg.floor_layers.map(l=>[l.id,true]));
 const terrainByView={};
 let catalog=cfg.default_catalog||'arc',catalogFilter=null;
 const matchesCatalog=c=>!catalogFilter||(catalogFilter.groups.has(typeof c==='string'?c:c.group)&&(!catalogFilter.roles||catalogFilter.roles.has(c.role)));
 const partById=new Map(parts.map(p=>[p.c.id,p]));
 const isEnvelope=c=>cfg.framing_floors.includes(c.floor)&&['walls','opening_infill'].includes(c.group);
 const layerOf=c=>cfg.floor_layers.find(l=>(!l.groups||l.groups.includes(c.group))&&(!l.floors||l.floors.includes(c.floor)))?.id;
 // 显示线保持原材质；地形透明度独立于图层显隐、现状/完成视图和墙体叠加。
 const isTerrain=c=>['existing_ground','finished_ground'].includes(c.role);
 const selectedTerrainRole=()=>surface+'_ground';
 const terrainMeshes=part=>parts.filter(q=>q===part||(q.c.display_only&&q.c.id===part.c.id+'-shell'&&q.c.role===part.c.role)).flatMap(q=>q.meshes);
 const hasTerrain=parts.some(p=>isTerrain(p.c)&&p.meshes.length>0);
 const terrainOpacityControl=document.querySelector('#terrain-translucent');
 document.querySelector('#terrain-opacity-control').hidden=!hasTerrain;
 terrainOpacityControl.disabled=!hasTerrain;terrainOpacityControl.checked=false;
 let wallTheme='material';
 const candidateColors={fire:'#A33F4A',load_bearing:'#315C9D',bracing:'#70478B',non_bearing:'#286B63',unknown:'#626970',context:'#DAD5C9'};
 const themeColors={...candidateColors,...cfg.semantic_palette?.colors};
 const wallProperties=cfg.wall_properties?.metadata_sha256===env.meta.metadata_sha256?cfg.wall_properties.components||{}:{};
 const baseColors=new Map(parts.flatMap(p=>p.meshes.map(m=>[m,m.material.color.clone()])));
 const authorAlpha=new Map(parts.flatMap(p=>p.meshes.map(m=>[m,{transparent:m.material.transparent,opacity:m.material.opacity,depthWrite:m.material.depthWrite,castShadow:m.castShadow}])));
 // 选中高亮由 selection-highlight.js 负责（高对比色明暗闪烁 + 常亮轮廓，默认开启）；选中网格独立出实例批次。
 const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
 const blinkEnabled=true;  // 选中构件被隐藏或剖切掉时清除选中
 const highlight=createSelectionHighlight({T,cfg,reducedMotion,onChange:()=>{refreshLocalModel();dirty=true;}});
 function applyTheme(){
  const effective=catalog==='arc'?'material':wallTheme;
  for(const p of parts)if(p.c.group==='walls')for(const m of p.meshes){
   if(effective==='material')m.material.color.copy(baseColors.get(m));
   else{const value=wallValue(wallProperties[p.c.id],effective);m.material.color.set(value===null?themeColors.unknown:value?themeColors[effective]:themeColors.context);}
   m.material.emissive.setHex(0);
   if(p===selected)highlight.rebase(m);
  }
  document.querySelector('#wall-theme').disabled=catalog==='arc';
  document.querySelector('#theme-status').textContent=effective==='material'?'Material / 材质色':
   'Candidate palette / 候选色表 · '+(cfg.semantic_palette?.status==='approved'?'Source / 来源：'+cfg.semantic_palette.source:'Pending palette approval / 待色表核定')+' · Grey: unknown / 灰色为未知';
  refreshLocalModel();renderer.shadowMap.needsUpdate=true;dirty=true;translateTree();
 }
 const meshMap=new Map(),baseTransforms=parts.map(p=>p.o.matrixWorld.toArray());
 for(const p of parts)for(const m of p.meshes)meshMap.set(m,p);
 const corners=b=>Array.from({length:8},(_,i)=>new T.Vector3(i&1?b.max.x:b.min.x,i&2?b.max.y:b.min.y,i&4?b.max.z:b.min.z));
 // 取景与标注字高互相依赖（字高取屏幕下限换算、标注外包又决定取景），迭代三次收敛后标注再据最终相机重排。
 function fit(direction){for(let pass=0;pass<6;pass++)fitOnce(direction);annotations.rebuild();}  // 取景定稿后按最终相机重排一次
 function fitOnce(direction){
  controls.enableDamping=false;controls.update();controls.enableDamping=true;
  const current=views.get(view),plan=current.kind==='plan',box=new T.Box3();
  // 平面图按可见构件取景，不含示意场地（场地板只是底色，撑大取景会让构件和标注过小）。
  for(const p of parts)if(p.o.visible&&!(plan&&['site','terrain'].includes(p.c.group)))box.union(p.box);
  if(groundGroup.visible)for(const b of groundBoxes)box.union(b);
  if(box.isEmpty()){for(const p of parts)box.union(p.box);}
  for(const point of [...annotations.extent(),...dimensions.extent()])box.expandByPoint(point);
  const center=box.getCenter(new T.Vector3());camera.up.set(0,1,0);if(plan)camera.up.set(0,0,-1);camera.zoom=1;controls.target.copy(center);camera.position.copy(center).add(new T.Vector3(...direction).normalize().multiplyScalar(90));camera.lookAt(center);camera.updateMatrixWorld();
  // 明细表/说明让位：右侧停靠扣宽、底部停靠扣高，取每像素世界长度较小（模型较大）者；正交视锥不对称，使模型居中于剩余区域。
  const W=viewport.clientWidth,H=viewport.clientHeight,ps=corners(box).map(p=>p.applyMatrix4(camera.matrixWorldInverse)),xs=ps.map(p=>p.x),ys=ps.map(p=>p.y);
  const dx=Math.max(...xs)-Math.min(...xs),dy=Math.max(...ys)-Math.min(...ys),need=(uw,uh)=>Math.max(dx/.88/uw,dy/.76/uh)*dimensions.frameScale();
  const rw=Math.min(annotations.dock('right'),W*.55),bh=Math.min(annotations.dock('bottom'),H*.45),bottomBetter=bh>0&&need(W,H-bh)<need(W-rw,H);
  const uw=bottomBetter?W:W-rw,uh=bottomBetter?H-bh:H,wpp=need(uw,uh);annotations.dock(bottomBetter?'bottom':'right');
  camera.left=-uw/2*wpp;camera.right=(W-uw/2)*wpp;camera.top=uh/2*wpp;camera.bottom=-(H-uh/2)*wpp;camera.updateProjectionMatrix();controls.update();dirty=true;
 }
 function clearCaps(){while(caps.children.length){const c=caps.children[0];meshMap.delete(c);caps.remove(c);c.geometry.dispose();c.material.dispose();}}
 function applyView(reset=true){
  clearCaps();const current=views.get(view),plan=current.kind==='plan',cut=current.kind==='section',floor=current.floor;
  const {shadows,foundation:foundationPlan}=viewControls.sync(view,plan);
  const terrainVisible=terrain&&!plan&&hasTerrain;
  groundGroup.visible=!hasTerrain&&terrain&&!plan&&Boolean(cfg.ground)&&matchesCatalog('terrain');
  stage.visible=!terrainVisible&&!groundGroup.visible&&(!plan||shadows);
  setShadows(shadows);
  for(const p of parts){const c=p.c;let plane=null;
   // 叠层采用基础平面的同楼栋构件，继续服从图层与专业筛选。
   const inFoundationUnderlay=Boolean(foundationPlan)&&c.floor===foundationPlan.floor&&
    foundationGroups.has(c.group)&&inViewScope(c,foundationPlan);
   p.o.visible=plan?(c.group!=='roof'&&(c.floor===floor||c.group==='stairs')):c.group==='roof'?roof&&!cut:c.group==='trusses'?trusses:true;
   p.o.visible=inFoundationUnderlay||(p.o.visible&&inViewScope(c,current));
   const layer=layerOf(c),envelope=isEnvelope(c),frame=c.group==='framing',overlay=envelope&&wallMode==='overlay';
   if(layer&&!layers[layer]||!matchesCatalog(c))p.o.visible=false;
   if(envelope&&wallMode==='frame'||frame&&wallMode==='solid'&&!inFoundationUnderlay)p.o.visible=false;
   if(isTerrain(c))p.o.visible=terrainVisible&&c.role===selectedTerrainRole()&&(!layer||layers[layer])&&matchesCatalog(c);
   const translucentGround=isTerrain(c)&&terrainTranslucent;
   for(const m of p.meshes){const a=authorAlpha.get(m);m.material.transparent=translucentGround||overlay||a.transparent;m.material.opacity=translucentGround?.30:overlay?.10:a.opacity;m.material.depthWrite=translucentGround||overlay?false:a.depthWrite;m.castShadow=translucentGround||overlay?false:a.castShadow;}
   if(plan&&Number.isFinite(cfg.levels[c.block]?.[floor]))plane=new T.Plane(new T.Vector3(0,-1,0),cfg.levels[c.block][floor]+(current.cutAbove??1.2));
   else if(cut){const s=isTerrain(c)?Object.values(current.sections)[0]:current.sections[c.block];if(s)plane=new T.Plane(new T.Vector3(...s.normal),s.constant);}
   for(const m of p.meshes){m.material.clippingPlanes=plane?[plane]:[];m.material.clipShadows=true;m.material.needsUpdate=true;for(const e of m.children)if(e.isLineSegments){e.visible=(!plan||c.group==='stairs')&&!overlay;e.material.clippingPlanes=plane?[plane]:[];}}
   if(p.o.visible&&plane&&!overlay&&!c.display_only){const first=caps.children.length;sectionCap(terrainMeshes(p),plane);for(const cap of caps.children.slice(first)){meshMap.set(cap,p);if(isTerrain(c)){const source=p.meshes[0].material;cap.material.transparent=source.transparent;cap.material.opacity=source.opacity;cap.material.depthWrite=source.depthWrite;cap.material.needsUpdate=true;}}}
  }
  document.querySelector('#view-title').textContent=current.label||current.title||current.id;document.querySelector('#view-zh').textContent=current.label_zh||'';
  for(const b of document.querySelectorAll('[data-view]')){b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-pressed',String(b.dataset.view===view));}
  for(const [id,on,disabled]of [['roof',roof,plan||cut],['trusses',trusses,plan],['terrain',terrain,plan]]){const e=document.getElementById(id);e.disabled=disabled||e.dataset.unavailable==='true';e.checked=on&&!e.disabled;}
  document.querySelector('#surface').disabled=(!groundGroup.visible&&!terrainVisible)||(cfg.ground_states||[]).length<2;
  terrainOpacityControl.checked=terrainTranslucent;
  for(const l of cfg.floor_layers){const e=document.getElementById('layer-'+l.id);e.checked=layers[l.id];e.disabled=(l.id===roofLayer&&(plan||cut))||(l.id===trussLayer&&plan);}
  for(const b of document.querySelectorAll('[data-wall]')){const active=b.dataset.wall===wallMode;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));}
  document.querySelector('#layer-hint').textContent=plan?'Floor slice / 楼层切片':cut?'Roof hidden for the section / 剖切隐藏屋面':surface==='existing'&&groundGroup.visible?'Existing ground; proposed buildings for reference / 现状地形，拟建建筑用于定位':'Toggle layers to explore / 可切换图层';
  if(blinkEnabled&&selected&&(!selected.o.visible||isSelectionClipped(selected)))clearSelection();
  else{updateSelectionVisibility();refreshLocalModel();instances.refresh(selected,localModel?selected:null);}
  if(reset)fit(plan?[0,1,.0001]:(current.direction||[1,.72,1]));renderer.shadowMap.needsUpdate=true;dirty=true;translateTree();
 }
 const groupText={walls:'Wall / 墙体',opening_infill:'Opening / 洞口示意',ground_slab:'Ground floor slab / 一层地坪',upper_slab:'Upper floor slab / 二层楼板',stairs:'Stair / 楼梯',roof:'Roof / 屋面',trusses:'Roof truss / 屋架',framing:'Wall framing / 木墙构件'};
 const statuses={drawing:'Drawing / 图纸明示',measured:'Measured from drawing / 图面量取',derived:'Derived / 推导',rule:'Rule-based / 规则生成',schematic:'Schematic / 示意',unknown:'Unknown / 未知'};
 function el(tag,text,cl){const e=document.createElement(tag);e.textContent=translated(text);if(cl)e.className=cl;return e;}
 function clearSelection(){
  dimensions.set(null);
  closeNodePreview();
  releaseLocalModel();
  closeSource();detailLoader.release();
  document.querySelector('#inspector').classList.remove('has-selection');
  highlight.end();
  selected=null;instances.refresh(null);document.querySelector('#pin').hidden=true;document.querySelector('#clear').hidden=true;
  document.querySelector('#details').setAttribute('aria-busy','false');
  document.querySelector('#details').replaceChildren(el('p','Click a part of the model. 点击构件查看已有资料。','empty'));dirty=true;
 }
 // 同色提亮保留材质及专业主题的语义。
 function select(p){
  clearSelection();if(!p||(blinkEnabled&&(!p.o.visible||isSelectionClipped(p))))return;
  selected=p;
  dimensions.set(p);
  highlight.begin(p.meshes);
  instances.refresh(p);
  renderDetails(p,p.c,Boolean(p.c.detail));
  if(p.c.detail){
   const status=el('p','Loading component data / 正在读取构件资料','detail-status');
   status.setAttribute('role','status');document.querySelector('#details').append(status);
   document.querySelector('#details').setAttribute('aria-busy','true');
   detailLoader.load(p.c,env.meta.project).then(data=>{if(selected===p){renderDetails(p,data);dirty=true;}}).catch(error=>{if(error.name!=='AbortError'&&selected===p){
    document.querySelector('#details').setAttribute('aria-busy','false');
    status.textContent='资料加载失败，可重试。当前无法判断资料是否齐全。';
    const reason=el('p',error.message,'field-source'),retry=el('button','重新读取资料','detail-retry');retry.onclick=()=>select(p);status.after(reason,retry);
   }});
  }
 }
 function releaseLocalModel(){
  for(const [mesh,mask] of originalLayers)mesh.layers.mask=mask;
  originalLayers=[];
  if(localModel)localModel.traverse(mesh=>meshMap.delete(mesh));
  localModel=null;
  detailLoader.releaseModel();
  instances.refresh(selected);
  renderer.shadowMap.needsUpdate=true;dirty=true;
 }
 function refreshLocalModel(){
  if(!localModel||!selected)return;
  localModel.visible=selected.o.visible;
  localModel.traverse(mesh=>{
   if(!mesh.isMesh)return;
   const source=selected.meshes[0].material;
   mesh.material.clippingPlanes=source.clippingPlanes;
   mesh.material.transparent=source.transparent;mesh.material.opacity=source.opacity;
   mesh.material.depthWrite=source.depthWrite;mesh.castShadow=selected.meshes[0].castShadow;mesh.material.color.copy(source.color);mesh.material.emissive.copy(source.emissive);mesh.material.needsUpdate=true;
  });
 }
 async function showLocalModel(p,button){
  if(localModel){
   if(blinkEnabled)clearSelection();
   else{releaseLocalModel();button.textContent='Load local model / 加载局部模型';}
   return;
  }
  button.disabled=true;button.textContent='Loading / 正在加载';
  try{
   const group=await detailLoader.loadModel(p.c);
   if(selected!==p)return;
   group.updateMatrixWorld(true);
   const box=new T.Box3().setFromObject(group);
   if(!group.getObjectByName(p.c.id)||['min','max'].some(key=>box[key].distanceTo(p.box[key])>1e-4)){
    detailLoader.releaseModel();throw new Error('局部模型身份或坐标不符');
   }
   localModel=group;
   for(const mesh of p.meshes){originalLayers.push([mesh,mesh.layers.mask]);mesh.layers.disableAll();}
   group.traverse(mesh=>{if(mesh.isMesh){mesh.material.dispose();mesh.material=p.meshes[0].material.clone();meshMap.set(mesh,p);}});
   scene.add(group);refreshLocalModel();instances.refresh(p,p);
   button.textContent='Unload local model / 卸载局部模型';
   renderer.shadowMap.needsUpdate=true;dirty=true;
  }catch(error){
   if(error.name!=='AbortError'&&selected===p){
    button.textContent='Try local model again / 重试局部模型';
    const status=el('p','Local model unavailable / 局部模型暂不可用：'+error.message,'detail-model-status');
    status.setAttribute('role','status');button.after(status);
   }
  }
  finally{button.disabled=false;}
 }
 function renderDetails(p,c,pending=false){
  if(!pending)p.detailData=c;
  const d=document.querySelector('#details');d.setAttribute('aria-busy',String(pending));
  p.displayLabel=componentTitle(c);d.replaceChildren(el('h2',p.displayLabel));
  d.append(el('p',c.id.replace(/-LINTEL-\d+$/,''),'id'));
  document.querySelector('#clear').hidden=false;document.querySelector('#inspector').classList.add('has-selection');
  if(pending){if(!matchMedia('(max-width:580px)').matches)document.querySelector('#inspector').scrollIntoView({block:'start'});dirty=true;return;}
  const provenance=el('details','','detail-provenance');provenance.append(el('summary','构件编号、版本与模型参数'),el('p',c.id,'id'));
  if(c.role&&!c.parameters?.viewer?.design?.title)d.append(el('p',({stud:'Stud / 立柱',king_stud:'Full-height stud / 通高边柱',jack_stud:'Lintel support / 过梁支承柱',lintel:'Lintel / 过梁',head_trimmer:'Head trimmer / 非承重上横档',sill:'Window sill / 窗台板',bottom_plate:'Bottom plate / 底板',top_plate:'Top plate / 顶板',ribbon:'Capping plate / 天花边缘固定板',cripple:'Short stud / 短柱',nogging:'Nogging / 横撑',corner:'Corner / 转角构件'})[c.role]||c.role));
  if(c.truss_id)d.append(el('p',`Lot ${c.lot} · ${c.truss_type} · ${c.profile_status==='measured'?'Supplied section / 已有截面详图':'Schematic section / 截面示意'}`));const params=Object.entries(c.parameters||{}).filter(([key])=>!['shared_object','viewer'].includes(key)),schematic=params.some(([,v])=>v?.status==='schematic');
  if(schematic)provenance.append(el('span','Contains schematic values / 含示意参数','chip warning'));
  for(const reference of p.c.object_refs||[]){
   provenance.append(el('p',`Object / 对象：${reference.object_id}`),el('p',`Revision / 修订：${reference.object_revision} · ${reference.consumption_mode==='candidate_preview'?'Design preview / 设计候选':'Source projection / 来源投影'}`));
  }
  const slot=slotOf(p.c);
  if(slot){const status=slot.status==='generated'?`Generated ${slot.source.scale} / 机器生成`:slot.status==='document_crop'?'Document crop / 资料截图':'Detail pending / Detail 待提供';
   const row=el('p',`Detail · ${slot.title} · ${status}`,'detail-slot');row.dataset.slot=slot.id;row.dataset.status=slot.status;d.append(row);}
  d.append(renderPresentation(c,p.c.object_refs||[],{selectRelated:(id,button)=>{const target=partById.get(id);if(target)select(target);else button.after(el('p','Related component not in this model / 当前模型无此关联构件'));},openSource}));
  showNodePreview(p,c);
  const size=p.box.getSize(new T.Vector3());provenance.append(el('p',`Model extents / 模型包围尺寸：${size.toArray().map(x=>x.toFixed(2)).join(' × ')} m`));
  for(const[key,value]of params){const item=el('details',''),summary=el('summary',`${key} · ${statuses[value?.status]||value?.status||'Unknown / 未知'}`);item.append(summary,el('p',value?.locator||'No locator'),el('p',value?.note||''));provenance.append(item);}
  provenance.append(el('p','包围尺寸表示模型外形，不等于设计截面。'));d.append(provenance);
  if(p.c.detail_model){const button=el('button',localModel?'Unload local model / 卸载局部模型':'Load local model / 加载局部模型','detail-model');button.onclick=()=>showLocalModel(p,button);d.append(button);}
  d.append(el('span','Selected / 已选中','chip'),el('p','','selection-visibility'));
  updateSelectionVisibility();
  document.querySelector('#clear').hidden=false;document.querySelector('#inspector').classList.add('has-selection');
  if(!matchMedia('(max-width:580px)').matches)document.querySelector('#inspector').scrollIntoView({block:'start'});dirty=true;translateTree();
 }
 const sourceDialog=document.querySelector('#source-dialog');
 function closeSource(){if(sourceDialog.open)sourceDialog.close();detailLoader.releaseSource();document.querySelector('#source-content').replaceChildren();}
 sourceDialog.addEventListener('close',()=>{if(!sourceDialog.open){detailLoader.releaseSource();document.querySelector('#source-content').replaceChildren();}});
 document.querySelector('#source-close').onclick=closeSource;
 async function openSource(source,button){
  closeSource();const owner=selected;button.disabled=true;
  document.querySelector('#source-title').textContent=translated(source.title||'Source / 依据');
  const content=document.querySelector('#source-content');content.append(el('p','Loading source / 正在读取依据'));sourceDialog.showModal();
  try{const url=await detailLoader.loadSource(source);if(selected!==owner)return;content.replaceChildren();
   if(source.mime.startsWith('image/')){const img=document.createElement('img');img.src=url;img.alt=translated(source.title||'Source page / 来源页');content.append(img);}
   else{const link=el('a',source.mime==='text/html'?source.title:'Open report / 打开计算书');link.href=url;link.target='_blank';link.rel='noopener';content.append(link);}
   if(source.locator)content.append(el('p',source.locator));
  }catch(error){if(error.name!=='AbortError'&&selected===owner)content.replaceChildren(el('p','Source unavailable / 依据暂不可用：'+error.message));}
  finally{button.disabled=false;}
 }
 function isSelectionClipped(p){
  const planes=p.meshes[0]?.material.clippingPlanes||[];
  return planes.some(pl=>corners(p.box).every(point=>pl.distanceToPoint(point)<-1e-5));
 }
 function updateSelectionVisibility(){
  if(!selected)return;
  const message=document.querySelector('.selection-visibility');
  if(!message)return;
  message.textContent=!matchesCatalog(selected.c)?'Hidden by system filter / 已被系统筛选隐藏':!selected.o.visible?'Hidden in current view / 当前视图隐藏':isSelectionClipped(selected)?'Outside the section / 位于剖切范围之外':'';
  message.hidden=!message.textContent;
 }
 function pick(x,y){
  const rect=canvas.getBoundingClientRect();pointer.set((x-rect.left)/rect.width*2-1,1-(y-rect.top)/rect.height*2);camera.updateMatrixWorld();ray.setFromCamera(pointer,camera);
  const targets=[...parts.filter(p=>p.o.visible&&!(wallMode==='overlay'&&isEnvelope(p.c))).flatMap(p=>p.meshes.filter(m=>!instances.owns(m)||p===selected&&!localModel)),...instances.targets(),...caps.children];if(groundGroup.visible)groundGroup.traverse(o=>{if(o.isMesh)targets.push(o);});if(localModel?.visible)localModel.traverse(o=>{if(o.isMesh)targets.push(o);});
  const hit=ray.intersectObjects(targets,false).find(h=>h.object.visible&&!(h.object.material.clippingPlanes||[]).some(pl=>pl.distanceToPoint(h.point)<-1e-5));
  select(hit?(instances.partFor(hit)||meshMap.get(hit.object)):null);return selected?.c.id||null;
 }
 function preset(id){view=id;const current=views.get(id);for(const l of cfg.floor_layers)layers[l.id]=true;
  roof=current.roof??current.kind!=='plan';trusses=current.trusses??!current.groups;
  if(roofLayer){layers[roofLayer]=roof;roof=true;}if(trussLayer){layers[trussLayer]=trusses;trusses=true;}terrain=terrainByView[id]??current.terrain??hasTerrain;
  if((cfg.ground_states||[]).includes(current.ground_surface)){
   surface=current.ground_surface;setGroundSurface(surface);document.querySelector('#surface').value=surface;
  }
  wallMode=current.wall_mode||'solid';applyView();
 }
 // 切专业只切换目录。筛选是独立状态，与原楼层及剖切取交集。
 const catalogButtons=[...document.querySelectorAll('[data-catalog]')],filterButtons=[...document.querySelectorAll('[data-catalog-filter]')];
 const allSystems=document.querySelector('#catalog-all');
 function updateCatalog(){
  for(const b of catalogButtons){const active=b.dataset.catalog===catalog;b.setAttribute('aria-pressed',String(active));document.getElementById(b.getAttribute('aria-controls')).hidden=!active;}
  for(const b of filterButtons){const active=b===catalogFilter?.button;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));}
  allSystems.setAttribute('aria-pressed',String(!catalogFilter));
  document.querySelector('#catalog-status').textContent=catalogFilter?`Filtered / 筛选：${catalogFilter.label}`:'All systems visible where enabled / 按当前视图显示全部系统';
  translateTree();
 }
 for(const b of catalogButtons)b.onclick=()=>{catalog=b.dataset.catalog;updateCatalog();applyTheme();};
 for(const b of filterButtons)b.onclick=()=>{catalogFilter={button:b,groups:new Set(b.dataset.catalogFilter.split(' ')),roles:b.dataset.catalogRole?new Set(b.dataset.catalogRole.split(' ')):null,label:b.firstChild.textContent.trim()};updateCatalog();applyView(false);};
 allSystems.onclick=()=>{if(!catalogFilter)return;catalogFilter=null;updateCatalog();applyView(false);};
 updateCatalog();applyTheme();
 document.querySelector('#wall-theme').onchange=e=>{wallTheme=e.target.value;applyTheme();};
 for(const b of document.querySelectorAll('[data-detail-focus]'))b.onclick=()=>{const section=document.getElementById('detail-'+b.dataset.detailFocus);if(section){let parent=section.parentElement;while(parent){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}section.scrollIntoView({block:'nearest'});}else document.querySelector('#catalog-status').textContent='Select a component to view its supplied data / 先选择构件查看对应资料';};
 for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>preset(b.dataset.view);
 for(const b of document.querySelectorAll('[data-wall]'))b.onclick=()=>{wallMode=b.dataset.wall;applyView(false);};
 for(const l of cfg.floor_layers)document.getElementById('layer-'+l.id).onchange=e=>{layers[l.id]=e.target.checked;applyView(false);};

 document.querySelector('#trusses').onchange=e=>{trusses=e.target.checked;applyView(false);};document.querySelector('#roof').onchange=e=>{roof=e.target.checked;applyView(false);};document.querySelector('#terrain').onchange=e=>{terrain=e.target.checked;terrainByView[view]=terrain;applyView();};
 document.querySelector('#surface').onchange=e=>{surface=e.target.value;setGroundSurface(surface);applyView(false);};
 terrainOpacityControl.onchange=e=>{if(!hasTerrain)return;terrainTranslucent=e.target.checked;applyView(false);};
 document.querySelector('#reset').onclick=()=>applyView();document.querySelector('#clear').onclick=clearSelection;
 const activePointers=new Set();
 canvas.addEventListener('pointerdown',e=>{activePointers.add(e.pointerId);down=activePointers.size===1&&e.button===0?{x:e.clientX,y:e.clientY,id:e.pointerId}:null;});
 canvas.addEventListener('pointercancel',e=>{activePointers.delete(e.pointerId);down=null;});
 canvas.addEventListener('pointerup',e=>{activePointers.delete(e.pointerId);if(down?.id===e.pointerId&&Math.hypot(e.clientX-down.x,e.clientY-down.y)<4)pick(e.clientX,e.clientY);down=null;});
 canvas.addEventListener('keydown',e=>{if(e.key==='Escape')clearSelection();if(e.key.toLowerCase()==='r')applyView();});canvas.tabIndex=0;
 controls.addEventListener('change',()=>dirty=true);
 function resize(){const w=viewport.clientWidth,h=viewport.clientHeight;renderer.setSize(w,h);if(initialized)fit(camera.position.clone().sub(controls.target).toArray());else{const half=(camera.top-camera.bottom)/2;camera.left=-half*w/h;camera.right=half*w/h;camera.updateProjectionMatrix();}dirty=true;}
 new ResizeObserver(resize).observe(viewport);resize();preset(view);initialized=true;
 document.addEventListener('model-language',()=>{if(selected)renderDetails(selected,selected.detailData||selected.c,Boolean(selected.c.detail&&!selected.detailData));updateCatalog();document.querySelector('#view-title').textContent=translated(views.get(view).label||views.get(view).title||view);document.querySelector('#model-note').textContent=localText(cfg.note,cfg.noteZh||cfg.note);translateTree();dirty=true;});
 function draw(now=performance.now()){requestAnimationFrame(draw);controls.update();
  if(selected&&selected.o.visible&&!document.hidden)highlight.tick(now);
  if(!dirty)return;dirty=false;dimensions.update(!selected||!isSelectionClipped(selected));annotations.update();renderer.render(scene,camera);
  const pin=document.querySelector('#pin');if(selected){const center=selected.box.getCenter(new T.Vector3()),q=center.clone().project(camera),x=(q.x*.5+.5)*viewport.clientWidth,y=(.5-q.y*.5)*viewport.clientHeight;pin.textContent=selected.displayLabel||selected.c.id;pin.hidden=!selected.o.visible||(selected.meshes[0]?.material.clippingPlanes||[]).some(pl=>pl.distanceToPoint(center)<-1e-5)||q.z<-1||q.z>1||Math.abs(q.x)>1||Math.abs(q.y)>1;pin.style.left=Math.min(viewport.clientWidth-100,Math.max(8,x+12))+'px';pin.style.top=Math.max(8,y-24)+'px';}}
 window.viewer={state:()=>({view,surface,visibleIds:parts.filter(p=>p.o.visible).map(p=>p.c.id),catalog,wallTheme,effectiveTheme:catalog==='arc'?'material':wallTheme,wallColors:Object.fromEntries(parts.filter(p=>p.c.group==='walls').map(p=>[p.c.id,p.meshes[0].material.color.getHexString()])),visible:parts.filter(p=>p.o.visible).length,total:parts.length,wallMode,layers:{...layers},groups:Object.fromEntries([...new Set(parts.map(p=>p.c.group))].map(g=>[g,parts.filter(p=>p.c.group===g&&p.o.visible).length])),upperEnvelope:parts.filter(p=>isEnvelope(p.c)&&p.o.visible).length,framing:parts.filter(p=>p.c.group==='framing'&&p.o.visible).length,opacity:wallMode==='overlay'?.10:1,trusses:parts.filter(p=>p.c.group==='trusses'&&p.o.visible).length,terrain:groundGroup.visible||parts.some(p=>isTerrain(p.c)&&p.o.visible),terrainCaps:caps.children.filter(m=>isTerrain(meshMap.get(m)?.c||{})).map(m=>({opacity:m.material.opacity,depthWrite:m.material.depthWrite})),localTerrainMaterials:localModel&&selected&&isTerrain(selected.c)?materialStates(localModel):[],terrainMaterials:parts.filter(p=>isTerrain(p.c)).map(p=>({id:p.c.id,visible:p.o.visible,opacity:p.meshes[0].material.opacity,depthWrite:p.meshes[0].material.depthWrite,castShadow:p.meshes[0].castShadow})),roof:parts.filter(p=>p.c.group==='roof'&&p.o.visible).length,caps:caps.children.length,selected:selected?.c.id||null,objectRefs:selected?.c.object_refs||[],detail:detailLoader.state(),selectedInstanced:selected?.meshes.some(mesh=>instances.owns(mesh))||false,instances:instances.stats(),renderCalls:renderer.info.render.calls,geometryBuffers:renderer.info.memory.geometries,camera:camera.position.toArray(),target:controls.target.toArray(),zoom:camera.zoom,geometryUnchanged:parts.every((p,i)=>p.o.matrixWorld.toArray().every((x,j)=>Math.abs(x-baseTransforms[i][j])<1e-9))}),project:id=>{const p=parts.find(p=>p.c.id===id);if(!p)return null;const m=p.meshes[0],g=m.geometry,pos=g.attributes.position,ix=g.index;let best=-1,point=new T.Vector3();for(let i=0;i<(ix?ix.count:pos.count);i+=3){const a=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(pos,ix?ix.getX(i+j):i+j));const area=a[1].clone().sub(a[0]).cross(a[2].clone().sub(a[0])).lengthSq();if(area>best){best=area;point.copy(a[0]).add(a[1]).add(a[2]).multiplyScalar(1/3);}}const q=point.applyMatrix4(m.matrixWorld).project(camera),rect=canvas.getBoundingClientRect();return [rect.left+(q.x*.5+.5)*rect.width,rect.top+(.5-q.y*.5)*rect.height];}};
 // 验证钩子：按世界包围盒投影（fy 为竖向比例），不依赖网格三角形或实例批次。
 window.viewer.projectBox=(id,fy=.5)=>{const p=parts.find(p=>p.c.id===id);if(!p)return null;const q=p.box.getCenter(new T.Vector3());q.y=p.box.min.y+(p.box.max.y-p.box.min.y)*fy;q.project(camera);const rect=canvas.getBoundingClientRect();return [rect.left+(q.x*.5+.5)*rect.width,rect.top+(.5-q.y*.5)*rect.height];};
 const materialStates=object=>{const states=[];object.traverse(m=>{if(m.isMesh)states.push({opacity:m.material.opacity,depthWrite:m.material.depthWrite,castShadow:m.castShadow});});return states;};
 const originalState=window.viewer.state;window.viewer.state=()=>({...originalState(),dimensions:dimensions.state(),annotations:annotations.state(),floorLayerOrder:cfg.floor_layers.map(l=>l.id),fixedLayerToggles:['roof','trusses'].filter(id=>Boolean(document.getElementById(id).offsetParent)),floorLayerLabels:[...document.querySelectorAll('#floor-layers label span')].map(e=>e.textContent),detailSlot:selected?(()=>{const s=slotOf(selected.c);if(!s)return null;const v=slotVariant(s,selected.c);return {id:s.id,status:s.status,image:(v?.image||s.source.image)?.path||null,variant:v?{representative:v.representative,typical_count:v.typical_count,total_count:v.total_count,selectedInGroup:true}:s.source.variants?{selectedInGroup:false}:null};})():null,nodePreview:{hidden:nodePreview.hidden,slot:nodePreview.dataset.slot||null,imageLoaded:Boolean(nodePreview.querySelector('img')?.complete&&nodePreview.querySelector('img')?.naturalWidth)},terrainTranslucent,shadows:renderer.shadowMap.enabled,language:currentLanguage(),selectionPulse:{...highlight.state(),active:Boolean(selected&&!reducedMotion.matches&&selected.o.visible&&!document.hidden),strength:highlight.state().level}});
 document.querySelector('#loading').hidden=true;translateTree();window.ready=true;draw();
}
