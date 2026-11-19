// 选中高亮（独立模块，viewer.js 只调用接口）：高对比色自发光明暗闪烁 + 常亮轮廓线。
// 默认开启，不需项目配置；项目可用 scene.selection_highlight 覆盖 {color,bright_ms,dark_ms,strength}，旧 selection_blink 仍兼容。
// 系统“减少动态效果”时不闪，保持常亮高对比色。
export const DEFAULT_HIGHLIGHT={color:'#ff6a00',bright_ms:700,dark_ms:500,strength:.55};

export function resolveHighlight(cfg={}){
 const legacy=cfg.selection_blink,own=cfg.selection_highlight||{};
 const pick=(key,fallback)=>Number.isFinite(own[key])&&own[key]>0?own[key]:Number.isFinite(legacy?.[key])&&legacy[key]>0?legacy[key]:fallback;
 return {color:typeof own.color==='string'?own.color:DEFAULT_HIGHLIGHT.color,bright_ms:pick('bright_ms',DEFAULT_HIGHLIGHT.bright_ms),
  dark_ms:pick('dark_ms',DEFAULT_HIGHLIGHT.dark_ms),strength:Number.isFinite(own.strength)&&own.strength>0?own.strength:DEFAULT_HIGHLIGHT.strength};
}

export function createSelectionHighlight({T,cfg,reducedMotion,onChange=()=>{}}){
 const opt=resolveHighlight(cfg),tint=new T.Color(opt.color),period=opt.bright_ms+opt.dark_ms;
 const originals=new Map(),outlines=new Map();
 let started=0,level=0,active=false;
 const outlineMaterial=new T.LineBasicMaterial({color:tint,transparent:true,opacity:1,depthTest:false,depthWrite:false,toneMapped:false});
 function paint(mesh){
  const base=originals.get(mesh);if(!base)return;
  mesh.material.emissive.setRGB(base.r+tint.r*level,base.g+tint.g*level,base.b+tint.b*level);
 }
 function set(next){level=next;for(const mesh of originals.keys())paint(mesh);onChange();}
 return {
  options:opt,
  // 开始高亮一组网格：记录原自发光，加轮廓线，立即亮相。
  begin(meshes){
   this.end();active=true;started=performance.now();
   for(const mesh of meshes){
    originals.set(mesh,mesh.material.emissive.clone());
    if(mesh.geometry&&!mesh.isInstancedMesh){const line=new T.LineSegments(new T.EdgesGeometry(mesh.geometry,25),outlineMaterial);line.renderOrder=9000;line.raycast=()=>{};mesh.add(line);outlines.set(mesh,line);}
   }
   set(opt.strength);
  },
  // 主题等外部改了基础自发光后，重新记录并重绘。
  rebase(mesh){if(!originals.has(mesh))return;originals.get(mesh).copy(mesh.material.emissive);paint(mesh);},
  end(){
   for(const [mesh,base] of originals)mesh.material.emissive.copy(base);
   for(const [mesh,line] of outlines){mesh.remove(line);line.geometry.dispose();}
   originals.clear();outlines.clear();active=false;level=0;
  },
  // 每帧调用：按相位切换亮暗；减少动态效果时恒亮。
  tick(now){
   if(!active)return;
   const bright=reducedMotion.matches||Math.max(0,now-started)%period<opt.bright_ms;
   const next=bright?opt.strength:0;if(next!==level)set(next);
  },
  state:()=>({active,level,color:opt.color,periodMs:period,reducedMotion:reducedMotion.matches,outlines:outlines.size})
 };
}
