// 详情面板“三行摘要”的文案整理：一行一个事实、去内部状态词、来源只写类型（不写 PDF 文件名/图号）。
// 只改展示，不改数据；原文仍在“展开完整计算、连接与依据”中。
const STATE_WORDS=/^(推导|图纸明示|示意|暂定|已测|规则|确认|derived|drawing|schematic|measured|rule|confirmed)(\s*[、,，/]\s*(推导|图纸明示|示意|暂定|已测|规则|确认|derived|drawing|schematic|measured|rule|confirmed))*$/i;
const FILE_REF=/\b[\w.-]+\.pdf\b\s*(S\d+[A-Za-z]?)?\s*[:：]?\s*/gi;
const SEE_SOURCE=/^see source page.*$/i;

export const isBasisLabel=label=>/basis|依据/i.test(String(label));

export function sourceKind(text){return /计算书|计算报告|calculation|calc\b/i.test(text)?'report':'drawing';}
export const sourceLabel=(kind,zh)=>zh?(kind==='report'?'来源：计算报告':'来源：设计图纸'):(kind==='report'?'Source: calculation report':'Source: design drawings');

// 只在括号外的分号处拆行，括号内的“；”属于同一事实。
function splitTop(value){
 const out=[];let depth=0,cur='';
 for(const ch of String(value??'')){
  if('（('.includes(ch))depth++;else if('）)'.includes(ch))depth=Math.max(0,depth-1);
  if(depth===0&&(ch==='；'||ch===';')){out.push(cur);cur='';}else cur+=ch;
 }
 out.push(cur);return out.map(s=>s.trim()).filter(Boolean);
}
// 拆成事实行；basis=true 时去状态词与文件引用，并返回 {lines,schematic,kind}。
export function splitFacts(value,{basis=false}={}){
 const raw=splitTop(value);
 if(!basis)return {lines:raw,schematic:false,kind:null};
 const text=raw.join(' ');let schematic=/示意|schematic|暂定/i.test(text);
 const lines=[];
 for(const item of raw){
  if(STATE_WORDS.test(item)||SEE_SOURCE.test(item))continue;
  const cleaned=item.replace(FILE_REF,'').replace(/\s+/g,' ').trim();
  if(cleaned&&!STATE_WORDS.test(cleaned))lines.push(cleaned);
 }
 return {lines,schematic,kind:sourceKind(text)};
}
