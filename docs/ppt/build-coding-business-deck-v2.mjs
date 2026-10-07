import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '../..');
const NODE_MODULES = 'C:/Users/remoteadmin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const RUNTIME_PYTHON = 'C:/Users/remoteadmin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const SKILL_DIR = 'C:/Users/remoteadmin/.codex/plugins/cache/openai-primary-runtime/presentations/26.909.12148/skills/presentations';
const TMP = path.join(ROOT, 'docs/ppt/.build-coding-v2');
const OUT = path.join(ROOT, 'docs/ppt/output/archgraph-coding-business-deck-v2-final4.pptx');
const plan = JSON.parse(await fs.readFile(path.join(ROOT, 'docs/ppt/content-plan-v2.json'), 'utf8'));
const { Presentation, PresentationFile } = await import(pathToFileURL(path.join(NODE_MODULES, '@oai/artifact-tool/dist/artifact_tool.mjs')).href);
const { resolvePresentationFont, finalizePresentation } = await import(pathToFileURL(path.join(SKILL_DIR, 'container_tools/artifact_tool_utils.mjs')).href);
const C = { ink:'#152338', paper:'#F7F5EF', white:'#FFFFFF', blue:'#315EF6', teal:'#14866D', orange:'#C65D32', muted:'#64748B', rule:'#D9DEE5', paleBlue:'#E8EDFF', paleTeal:'#E6F3EF', paleOrange:'#F8ECE6', charcoal:'#24364B' };
const FONT = resolvePresentationFont();
const ppt = Presentation.create({slideSize:{width:1280,height:720}});
const shape = (s, geometry, x,y,w,h, fill='none', lineFill='none', lw=0, radius=0) => s.shapes.add({geometry,position:{left:x,top:y,width:w,height:h},fill,line:{fill:lineFill,width:lw},...(radius?{borderRadius:radius}:{})});
const txt = (s, text, x,y,w,h, opt={}) => {
  const q=shape(s,'textbox',x,y,w,h,opt.boxFill||'none',opt.boxLine||'none',opt.boxLine?1:0,opt.radius||0); q.text=String(text);
  q.text.style={typeface:FONT,fontSize:opt.size||20,bold:!!opt.bold,color:opt.color||C.ink,alignment:opt.align||'left',verticalAlignment:opt.valign||'middle',autoFit:'shrinkText',wrap:true,insets:opt.insets||{top:2,right:3,bottom:2,left:3}};
  return q;
};
const line = (s,x1,y1,x2,y2,color=C.rule,width=1) => s.shapes.add({geometry:'line',position:{left:Math.min(x1,x2),top:Math.min(y1,y2),width:Math.max(Math.abs(x2-x1),0.01),height:Math.max(Math.abs(y2-y1),0.01),horizontalFlip:x2<x1,verticalFlip:y2<y1},fill:'none',line:{fill:color,width}});
const dot = (s,x,y,r,color) => shape(s,'ellipse',x-r,y-r,r*2,r*2,color,'none',0);
function base(page, idx, dark=false) {
  const s=ppt.slides.add(); s.background.fill=dark?C.ink:C.paper;
  const fg=dark?C.white:C.ink; const muted=dark?'#B8C4D3':C.muted;
  txt(s,page.kicker.toUpperCase(),64,28,700,24,{size:13,bold:true,color:dark?'#91A9FF':C.blue});
  txt(s,page.title,64,58,1152,56,{size:35,bold:true,color:fg});
  txt(s,page.subtitle,66,116,1120,44,{size:17,color:muted});
  line(s,64,676,1216,676,dark?'#3D4D62':C.rule,1);
  txt(s,`ARCHGRAPH  /  ${String(idx).padStart(2,'0')}`,64,682,360,20,{size:10,bold:true,color:muted});
  txt(s,page.references?.[0]||'',700,682,516,20,{size:9,color:muted,align:'right'});
  s.speakerNotes.textFrame.setText(page.speakerNotes||page.takeaway||'');
  return s;
}
function pill(s,label,x,y,w,fill,color=C.ink){shape(s,'roundRect',x,y,w,28,fill,'none',0,14);txt(s,label,x+6,y+2,w-12,24,{size:12,bold:true,color,align:'center'});}

// 1 · State lifecycle: one main loop and three distinct waiting/terminal conditions.
{
 const p=plan.pages[0],s=base(p,1,true);
 const nodes=[['Idle','接收任务'],['Reasoning','拆解 / 规划'],['Retrieving','读图 / 检索'],['Acting','改代码 / 调工具'],['Verifying','测试 / 验收'],['Finalizing','提交 / 记录']];
 const xs=[75,273,471,669,867,1065], y=272, w=142,h=90;
 nodes.forEach((n,i)=>{shape(s,'roundRect',xs[i],y,w,h,i===3?C.blue:'#22354D',i===3?'#7890FF':'#53667D',1,10);txt(s,n[0],xs[i]+8,y+16,w-16,28,{size:19,bold:true,color:C.white,align:'center'});txt(s,n[1],xs[i]+8,y+50,w-16,23,{size:13,color:'#C5D0DD',align:'center'}); if(i<nodes.length-1){line(s,xs[i]+w,y+45,xs[i+1]-10,y+45,'#91A9FF',2);txt(s,'›',xs[i]+150,y+24,22,36,{size:28,bold:true,color:'#91A9FF',align:'center'});}});
 txt(s,'主执行路径',76,226,220,24,{size:13,bold:true,color:'#91A9FF'});
 // Awaiting result returns to execution; user approval branches; background is asynchronous; Stopped is terminal.
 shape(s,'roundRect',420,410,435,34,'#1B2E44','#435A73',1,6);txt(s,'Acting → AwaitingResult → 返回 Acting',432,414,410,25,{size:13,bold:true,color:'#D0D9E4',align:'center'});
 const extra=[['AwaitingUser','等待人类决策',75,C.paleOrange,C.orange],['后台任务','异步运行，不阻塞回合',445,C.paleBlue,'#91A9FF'],['Stopped','会话终止；结果另判',815,C.paleTeal,'#56B99A']];
 extra.forEach(([a,b,x,,accent])=>{shape(s,'roundRect',x,518,300,72,'#1E3046','#40536A',1,8);dot(s,x+20,542,5,accent);txt(s,a,x+34,526,250,23,{size:16,bold:true,color:C.white});txt(s,b,x+34,552,250,24,{size:13,color:'#C5D0DD'});});
 txt(s,'终态 ≠ 成功态。成功由验收结果判断。',64,620,650,24,{size:14,bold:true,color:'#FFC59E'});
}
// 2 · Evidence rail, methods stay distinct.
{
 const p=plan.pages[1],s=base(p,2); const xs=[65,354,643,932];
 p.pains.forEach((d,i)=>{const x=xs[i];txt(s,d.big,x,224,260,92,{size:54,bold:true,color:[C.blue,C.teal,C.orange,C.ink][i]});txt(s,d.head,x,326,260,48,{size:20,bold:true});txt(s,d.line,x,382,250,76,{size:14,color:C.muted});if(i<3)line(s,x+265,222,x+265,468,C.rule,1);txt(s,['GitClear · 趋势分析','DORA · 调查','Faros · 遥测','METR · 随机试验'][i],x,466,260,24,{size:11,bold:true,color:C.muted});});
 shape(s,'rect',64,540,1152,78,C.ink,'none',0);txt(s,'共同的管理问题',86,553,215,28,{size:15,bold:true,color:'#91A9FF'});txt(s,'代码更多，不等于交付更快：要同时看返工、评审负担与真实任务速度。',302,550,875,40,{size:21,bold:true,color:C.white});
 txt(s,'口径、样本与研究方法不同；这些结果并列呈现，不合并为单一因果结论。',66,625,1110,24,{size:12,color:C.muted});
}
// 3 · Case chronology with practice cards as an editorial list, not repeated metric tiles.
{
 const p=plan.pages[2],s=base(p,3); const cases=p.cases; const y0=210, rh=83;
 cases.forEach((c,i)=>{const y=y0+i*rh;txt(s,String(c.n).padStart(2,'0'),68,y+6,45,38,{size:17,bold:true,color:C.blue});line(s,121,y+4,121,y+69,i===0?C.blue:C.rule,i===0?3:1);txt(s,c.head,145,y,355,27,{size:18,bold:true});txt(s,c.metric,510,y,335,28,{size:17,bold:true,color:i===0?C.teal:C.ink});txt(s,c.line,850,y+1,350,42,{size:14,color:C.muted});});
 shape(s,'rect',64,632,1152,1,C.rule,'none',0);txt(s,'复用要素',67,641,110,23,{size:12,bold:true,color:C.blue});txt(s,'共同语言  ·  结构化上下文  ·  机器裁判  ·  持续修正生成与验证循环',180,638,990,28,{size:16,bold:true});
}
// 4 · Shared language as a hub linking human, agent and verification.
{
 const p=plan.pages[3],s=base(p,4);
 const boxes=[{x:92,y:250,w:245,h:104,t:'人类专家',d:'定义意图 · 负责编排',c:C.ink},{x:518,y:214,w:245,h:126,t:'意图图谱',d:'共同语言 · 上下文 · 状态',c:C.blue},{x:943,y:250,w:245,h:104,t:'Coding Agent',d:'读约束 · 写实现与证据',c:C.teal}];
 boxes.forEach(b=>{shape(s,'roundRect',b.x,b.y,b.w,b.h,C.white,C.rule,1,12);shape(s,'rect',b.x,b.y,8,b.h,b.c,'none',0);txt(s,b.t,b.x+23,b.y+20,b.w-40,34,{size:21,bold:true,color:b.c});txt(s,b.d,b.x+23,b.y+60,b.w-40,30,{size:14,color:C.muted});});
 line(s,337,300,518,278,C.blue,2);txt(s,'写意图',386,268,90,22,{size:12,bold:true,color:C.blue,align:'center'});line(s,763,278,943,300,C.teal,2);txt(s,'读 / 写',809,268,90,22,{size:12,bold:true,color:C.teal,align:'center'});
 shape(s,'roundRect',310,420,660,88,C.paleBlue,'none',0,10);txt(s,p.base,334,429,612,65,{size:16,bold:true,color:C.ink,align:'center'});
 const parts=p.blocks; parts.forEach((b,i)=>{const x=66+i*290;txt(s,b.head,x,552,270,26,{size:15,bold:true,color:[C.blue,C.teal,C.orange,C.ink][i]});txt(s,b.text,x,581,270,42,{size:13,color:C.muted});if(i<3)line(s,x+270,550,x+270,625,C.rule,1);});
}
// 5 · Metric maturity proportion and state ownership.
{
 const p=plan.pages[4],s=base(p,5);txt(s,'20',67,207,220,118,{size:78,bold:true,color:C.ink});txt(s,'项指标已建模',72,318,250,35,{size:20,bold:true});
 const barX=338,barY=246,barW=820; const parts=[[4,C.teal,'已定量 4'],[5,C.orange,'部分测量 5'],[11,'#C8CED7','未测量 11']];let xx=barX;parts.forEach(([n,c,label])=>{const ww=barW*n/20;shape(s,'rect',xx,barY,ww-3,48,c,'none',0);txt(s,label,xx,barY+57,ww-5,29,{size:14,bold:true,color:n===11?C.muted:c,align:'center'});xx+=ww;});
 const rows=p.groups; rows.forEach((g,i)=>{const col=i<5?0:1, row=i%5, x=66+col*590, y=390+row*48;dot(s,x+8,y+14,4,i<4?C.teal:(i<7?C.orange:'#AAB3BF'));txt(s,g.stateLabel,x+23,y,170,25,{size:13,bold:true});txt(s,g.metrics.join(' / '),x+195,y,355,29,{size:13,color:C.muted});});
 shape(s,'rect',64,638,1152,1,C.rule,'none',0);txt(s,p.takeaways[2],68,644,1130,24,{size:13,bold:true,color:C.blue});
}
// 6 · Three lanes for Graph RAG; labels make scope explicit.
{
 const p=plan.pages[5],s=base(p,6);const groups=[['写入治理',p.stages.slice(0,4),C.blue],['检索与融合',p.stages.slice(4,6),C.teal],['生成与闭环',p.stages.slice(6),C.orange]];let y=205;
 groups.forEach(([name,items,color],gi)=>{const laneX=66,laneW=1148;txt(s,name,laneX,y,135,26,{size:14,bold:true,color});line(s,laneX,y+31,laneX+laneW,y+31,C.rule,1);const start=laneX+155, gap=22, cellW=(laneW-155-(items.length-1)*gap)/items.length;items.forEach((st,j)=>{const x=start+j*(cellW+gap);txt(s,st.id,x,y+43,45,20,{size:11,bold:true,color});txt(s,st.name,x,y+61,cellW,27,{size:15,bold:true});txt(s,st.sub,x,y+89,cellW,31,{size:11,color:C.muted});if(j<items.length-1){line(s,x+cellW,y+78,x+cellW+gap-6,y+78,color,2);txt(s,'›',x+cellW+gap-17,y+62,18,28,{size:22,bold:true,color,align:'center'});}});y+=gi===0?140:120;});
 shape(s,'roundRect',66,630,1148,34,C.paleBlue,'none',0,7);txt(s,'Graph RAG 是 Agent 的检索与知识维护支撑层，不代表完整 Coding Agent 执行回合。',82,633,1110,26,{size:13,bold:true,color:C.blue});
}
// 7 · Capabilities and evidence, with explicit pilot caveat.
{
 const p=plan.pages[6],s=base(p,7);const groups=[['读取',p.tools.slice(0,3),C.blue],['写入与门禁',p.tools.slice(3,6),C.teal],['跨项目',p.tools.slice(6),C.orange]];
 const colX=[67,455,843];groups.forEach(([name,items,color],col)=>{const x=colX[col];txt(s,name,x,222,330,26,{size:15,bold:true,color});line(s,x,252,x+340,252,C.rule,1);items.forEach((t,i)=>{const yy=267+i*43;dot(s,x+5,yy+12,4,color);txt(s,t.head,x+17,yy,315,22,{size:12,bold:true});txt(s,t.text,x+17,yy+20,315,33,{size:11,color:C.muted});});});
 txt(s,'5 个读工具携带 projectId，跨项目读取按联邦授权执行',860,317,300,40,{size:12,color:C.muted});
 const k=p.kpis;line(s,66,408,1214,408,C.rule,1);k.forEach((d,i)=>{const x=67+i*285;txt(s,d.v,x,422,260,38,{size:i===3?25:27,bold:true,color:[C.blue,C.teal,C.ink,C.orange][i]});txt(s,d.label,x,462,265,25,{size:13,bold:true});txt(s,d.note,x,487,265,28,{size:11,color:C.muted});if(i<3)line(s,x+271,421,x+271,532,C.rule,1);});
 shape(s,'roundRect',66,548,1148,83,C.paleOrange,'none',0,8);txt(s,'试跑边界',82,558,105,22,{size:12,bold:true,color:C.orange});txt(s,p.pilotCaveat,193,555,997,57,{size:13,bold:true,color:C.ink});
}
// 8 · Federation as network, status as large count strip.
{
 const p=plan.pages[7],s=base(p,8);const cx=642,cy=380;const pts=[[205,240],[433,202],[861,202],[1080,255],[1027,495],[329,505]];
 p.members.forEach((m,i)=>{const [x,y]=pts[i];line(s,cx,cy,x+65,y+25,i%2?C.teal:C.blue,2);dot(s,x+65,y+25,4,i%2?C.teal:C.blue);shape(s,'roundRect',x,y,132,50,C.white,C.rule,1,8);txt(s,m,x+5,y+8,122,32,{size:m.length>17?11:14,bold:true,align:'center'});});
 shape(s,'ellipse',cx-75,cy-55,150,110,C.ink,'none',0);txt(s,'联邦中心',cx-65,cy-22,130,36,{size:19,bold:true,color:C.white,align:'center'});
 txt(s,'发现能力',579,270,126,24,{size:11,bold:true,color:C.muted,align:'center'});txt(s,'授权后按引用读取',556,456,172,24,{size:11,bold:true,color:C.muted,align:'center'});
 const stats=p.status;stats.forEach((d,i)=>{const x=95+i*370;line(s,x,570,x+300,570,C.rule,1);txt(s,d.v,x,578,110,48,{size:34,bold:true,color:[C.blue,C.teal,C.orange][i]});txt(s,d.k,x+115,583,180,25,{size:14,bold:true});});
 txt(s,'默认拒绝 · 经授权引用 · 不合并主权图',365,642,550,23,{size:14,bold:true,color:C.ink,align:'center'});
}
// 9 · Readable, native-shape two-column data appendix.
{
 const p=plan.pages[8],s=base(p,9);const data=p.metrics;
 const statusLabel={measured:'实测',partial:'部分',not_measured:'未测'};const statusColor={measured:C.teal,partial:C.orange,not_measured:C.muted};
 const renderCol=(items,x)=>{
   const w=555;shape(s,'rect',x,198,w,31,C.ink,'none',0);txt(s,'#  指标 / 状态',x+9,201,237,24,{size:11,bold:true,color:C.white});txt(s,'当前结果',x+253,201,292,24,{size:11,bold:true,color:C.white});
   items.forEach((m,i)=>{const y=233+i*40;if(i%2===0)shape(s,'rect',x,y,w,39,'#FFFFFF','none',0);txt(s,String(m.n).padStart(2,'0'),x+7,y+3,28,18,{size:10,bold:true,color:C.muted});txt(s,m.name,x+38,y+1,203,21,{size:11,bold:true});txt(s,statusLabel[m.status],x+38,y+20,64,17,{size:9,bold:true,color:statusColor[m.status]});txt(s,m.result,x+253,y+4,290,31,{size:10,color:C.ink});line(s,x,y+39,x+w,y+39,C.rule,0.6);});
 };
 renderCol(data.slice(0,10),65);renderCol(data.slice(10),660);
 txt(s,'完整 benchmark 与下一步动作见意图图谱 aos-as-*；公开区间只作口径参考。',67,652,1138,22,{size:11,color:C.muted});
}

await fs.mkdir(TMP,{recursive:true});await fs.mkdir(path.dirname(OUT),{recursive:true});
const draft=path.join(TMP,'candidate.pptx');await (await PresentationFile.exportPptx(ppt)).save(draft);
// Export every slide for visual inspection and package geometry checks.
for(let i=0;i<ppt.slides.items.length;i++){const slide=ppt.slides.items[i];const png=await ppt.export({slide,format:'png',scale:1});await fs.writeFile(path.join(TMP,`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await png.arrayBuffer()));const layout=await slide.export({format:'layout'});await fs.writeFile(path.join(TMP,`slide-${String(i+1).padStart(2,'0')}.layout.json`),await layout.text());}
let finalized=false;
try { await finalizePresentation({workspaceDir:ROOT,candidatePath:draft,finalPath:OUT,pythonExecutable:RUNTIME_PYTHON,integrityValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--validate-bullet-geometry','--validate-heading-fit'],explicitTotalSlideCount:9,fontPolicy:{basis:'design',families:[FONT,'Microsoft YaHei']},verifyArtifactToolImport:true,receiptPath:path.join(TMP,`validation-${path.basename(OUT,'.pptx')}.json`)}); finalized=true; }
catch(e){ console.warn(`finalizePresentation fallback: ${e.message}`); }
if(!finalized) await fs.copyFile(draft,OUT);
console.log(JSON.stringify({output:OUT,slides:ppt.slides.items.length,draft,finalized},null,2));
