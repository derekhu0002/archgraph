import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT=path.resolve(import.meta.dirname,'../..');
const NODE_MODULES='C:/Users/remoteadmin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const RUNTIME_PYTHON='C:/Users/remoteadmin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const SKILL_DIR='C:/Users/remoteadmin/.codex/plugins/cache/openai-primary-runtime/presentations/26.909.12148/skills/presentations';
const TMP=path.join(ROOT,'docs/ppt/.build-coding-v3');
const OUT=path.join(ROOT,'docs/ppt/output/archgraph-coding-business-deck-v3-final.pptx');
const plan=JSON.parse(await fs.readFile(path.join(ROOT,'docs/ppt/content-plan-v3.json'),'utf8'));
const {Presentation,PresentationFile}=await import(pathToFileURL(path.join(NODE_MODULES,'@oai/artifact-tool/dist/artifact_tool.mjs')).href);
const {resolvePresentationFont,finalizePresentation}=await import(pathToFileURL(path.join(SKILL_DIR,'container_tools/artifact_tool_utils.mjs')).href);
const C={ink:'#152338',paper:'#F7F5EF',white:'#FFFFFF',blue:'#315EF6',teal:'#14866D',orange:'#C65D32',muted:'#64748B',rule:'#D9DEE5',paleBlue:'#E8EDFF',paleTeal:'#E6F3EF',paleOrange:'#F8ECE6',charcoal:'#24364B',light:'#EEF1F4'};
const FONT=resolvePresentationFont();
const ppt=Presentation.create({slideSize:{width:1280,height:720}});
const rect=(s,x,y,w,h,fill='none',stroke='none',sw=0,r=0)=>s.shapes.add({geometry:r?'roundRect':'rect',position:{left:x,top:y,width:w,height:h},fill,line:{fill:stroke,width:sw},...(r?{borderRadius:r}:{})});
const text=(s,value,x,y,w,h,o={})=>{const q=rect(s,x,y,w,h,o.boxFill||'none',o.boxStroke||'none',o.boxStroke?1:0,o.radius||0);q.text=String(value);q.text.style={typeface:FONT,fontSize:o.size||18,bold:!!o.bold,color:o.color||C.ink,alignment:o.align||'left',verticalAlignment:o.valign||'middle',autoFit:'shrinkText',wrap:true,insets:o.insets||{top:2,right:3,bottom:2,left:3}};return q;};
const rule=(s,x1,y1,x2,y2,color=C.rule,width=1)=>s.shapes.add({geometry:'line',position:{left:Math.min(x1,x2),top:Math.min(y1,y2),width:Math.max(Math.abs(x2-x1),.01),height:Math.max(Math.abs(y2-y1),.01),horizontalFlip:x2<x1,verticalFlip:y2<y1},fill:'none',line:{fill:color,width}});
const dot=(s,x,y,r,color)=>rect(s,x-r,y-r,2*r,2*r,color,'none',0,r);
const pill=(s,t,x,y,w,bg,fg=C.ink)=>{rect(s,x,y,w,25,bg,'none',0,12);text(s,t,x+4,y+1,w-8,22,{size:11,bold:true,color:fg,align:'center'});};
function base(p,n,dark=false){const s=ppt.slides.add();s.background.fill=dark?C.ink:C.paper;const fg=dark?C.white:C.ink,sub=dark?'#BBC7D5':C.muted;text(s,p.kicker.toUpperCase(),64,28,780,24,{size:13,bold:true,color:dark?'#9DB1FF':C.blue});text(s,p.title,64,57,1152,54,{size:34,bold:true,color:fg});text(s,p.subtitle,66,114,1136,45,{size:16,color:sub});rule(s,64,676,1216,676,dark?'#3D4D62':C.rule,1);text(s,`ARCHGRAPH  /  ${String(n).padStart(2,'0')}`,64,682,350,19,{size:10,bold:true,color:sub});text(s,p.references?.[0]||'',690,682,526,19,{size:9,color:sub,align:'right'});if(p.speakerNotes)s.speakerNotes.textFrame.setText(p.speakerNotes);return s;}

// 1 · A domain-independent business value lifecycle, with execution mechanics as secondary cues.
{
 const p=plan.pages[0],s=base(p,1,true);pill(s,'适用于不同业务领域',938,184,258,'#243750','#C9D4E2');
 const x0=68,w=165,gap=36,y=262,h=132,colors=[C.blue,'#496CE8','#4E86CC',C.teal,'#D47A4E','#20856D'];
 p.key.forEach((n,i)=>{const x=x0+i*(w+gap);rect(s,x,y,w,h,i===3?'#244C71':'#21344A',i===3?'#7896FF':'#4B6077',1,12);dot(s,x+23,y+24,14,colors[i]);text(s,String(i+1).padStart(2,'0'),x+12,y+11,22,24,{size:12,bold:true,color:C.white,align:'center'});text(s,n.label,x+16,y+42,w-32,42,{size:17,bold:true,color:C.white,align:'center'});text(s,n.sub,x+10,y+87,w-20,31,{size:12,color:'#C8D3DF',align:'center'});if(i<5){rule(s,x+w,y+66,x+w+gap-8,y+66,'#91A9FF',2);text(s,'›',x+w+gap-18,y+50,18,30,{size:23,bold:true,color:'#91A9FF',align:'center'});}});
 text(s,'业务价值主路径',70,220,250,25,{size:13,bold:true,color:'#9DB1FF'});
 rect(s,295,433,690,42,'#1D3047','#3F5570',1,8);text(s,'执行反馈：Acting → AwaitingResult → 结果返回 → 再规划 / 再执行',311,439,660,30,{size:13,bold:true,color:'#D4DDEA',align:'center'});
 const waits=[['人类校准','补充信息 / 评审 / 批准',80,C.paleOrange,C.orange],['异步并行','后台任务不阻塞主回合',453,C.paleBlue,'#91A9FF'],['终止判断','Stopped 仅表示会话结束',826,C.paleTeal,'#56B99A']];
 waits.forEach(([a,b,x,,accent])=>{rect(s,x,511,340,69,'#1E3046','#3F5570',1,9);dot(s,x+21,535,5,accent);text(s,a,x+37,519,278,23,{size:15,bold:true,color:C.white});text(s,b,x+37,543,285,26,{size:12,color:'#C8D3DF'});});
 text(s,'评价目标：可验证、可接受、可持续改进的交付结果。',68,613,980,27,{size:15,bold:true,color:'#FFC59E'});
}
// 2 · Generic Coding Agent application architecture (distinct from the business lifecycle).
{
 const p=plan.pages[1],s=base(p,2);const human={x:430,y:186,w:420,h:62};rect(s,human.x,human.y,human.w,human.h,C.ink,'none',0,11);text(s,'人类专家 / 团队',human.x+14,human.y+7,human.w-28,26,{size:18,bold:true,color:C.white,align:'center'});text(s,'目标 · 领域知识 · 验收边界 · 决策',human.x+12,human.y+34,human.w-24,22,{size:12,color:'#D2DCE7',align:'center'});
 const rx=319,ry=286,rw=642,rh=94;rect(s,rx,ry,rw,rh,C.paleBlue,'#AEBBFF',1,12);text(s,'Agent Runtime',rx+14,ry+6,rw-28,23,{size:16,bold:true,color:C.blue,align:'center'});
 const steps=[['Plan','拆解'],['Context','取上下文'],['Act','调用工具'],['Verify','检查结果']];steps.forEach((a,i)=>{const x=rx+30+i*148;rect(s,x,ry+38,124,39,C.white,'#C9D2E4',1,7);text(s,a[0],x+4,ry+39,116,19,{size:12,bold:true,color:C.ink,align:'center'});text(s,a[1],x+4,ry+57,116,17,{size:10,color:C.muted,align:'center'});if(i<3){rule(s,x+124,ry+58,x+143,ry+58,C.blue,2);text(s,'›',x+134,ry+42,16,24,{size:19,bold:true,color:C.blue,align:'center'});}});
 rule(s,640,248,640,282,C.blue,2);
 const comps=[{x:70,title:'上下文源',items:'代码仓 · 文档 · 历史决策',c:C.blue},{x:455,title:'工具面',items:'IDE · Shell · Git · 测试 · MCP',c:C.teal},{x:840,title:'Harness 控制',items:'规则 · 权限 · 隔离 · 调度',c:C.orange}];
 comps.forEach(a=>{rect(s,a.x,424,340,78,C.white,C.rule,1,9);rect(s,a.x,424,7,78,a.c,'none',0);text(s,a.title,a.x+18,431,300,24,{size:15,bold:true,color:a.c});text(s,a.items,a.x+18,461,300,27,{size:12,color:C.muted});});
 rule(s,490,380,240,420,C.blue,1.5);rule(s,640,380,625,420,C.teal,1.5);rule(s,790,380,1010,420,C.orange,1.5);
 rect(s,276,526,728,43,C.paleTeal,'none',0,8);text(s,'机器裁判与观测：测试 · 代码评审 · 任务指标 · 可追溯会话',294,532,692,31,{size:14,bold:true,color:C.teal,align:'center'});rule(s,640,502,640,523,C.teal,2);
 text(s,'工程实践反复强调：结构化上下文  ·  自动验收  ·  持续修正循环',90,600,1100,28,{size:15,bold:true,color:C.ink,align:'center'});
 text(s,'OpenAI Harness Engineering  ·  Bun Rust 迁移  ·  Anthropic 迁移方法（个案与来源见附录）',130,631,1020,21,{size:10,color:C.muted,align:'center'});
}
// 3 · ArchGraph-specific overlay: ontology, graph, MCP, governance, and metric links.
{
 const p=plan.pages[2],s=base(p,3);
 const human={x:72,y:222,w:250,h:73},agent={x:958,y:222,w:250,h:73};
 rect(s,human.x,human.y,human.w,human.h,C.ink,'none',0,10);text(s,'人类专家',human.x+12,human.y+11,human.w-24,26,{size:18,bold:true,color:C.white,align:'center'});text(s,'写意图 · 维护领域语义',human.x+10,human.y+41,human.w-20,21,{size:12,color:'#D2DCE7',align:'center'});
 rect(s,958,222,250,73,C.teal,'none',0,10);text(s,'Coding Agent',970,233,226,26,{size:18,bold:true,color:C.white,align:'center'});text(s,'读上下文 · 执行动作 · 写证据',970,263,226,21,{size:12,color:'#E1F0EB',align:'center'});
 rect(s,431,203,418,58,C.paleBlue,'none',0,9);text(s,'可插拔本体 / Schema',443,208,394,24,{size:16,bold:true,color:C.blue,align:'center'});text(s,'定义共享词汇、关系与约束',443,232,394,22,{size:12,color:C.muted,align:'center'});
 rule(s,322,254,431,232,C.blue,2);rule(s,849,232,958,254,C.teal,2);
 rect(s,383,311,514,91,C.white,C.rule,1,11);rect(s,383,311,8,91,C.blue,'none',0);text(s,'项目意图图谱 · 项目唯一事实源',407,321,466,27,{size:18,bold:true,color:C.ink,align:'center'});text(s,'目标 / 决策 / 架构 / 状态 / 指标 / 验收 / 证据',407,353,466,28,{size:13,color:C.muted,align:'center'});
 rule(s,197,295,470,311,C.blue,2);rule(s,1083,295,810,311,C.teal,2);
 const feats=[{x:64,n:'读',h:'语义与范围',t:'语义检索 · 子图上下文 · 只读结构查询',c:C.blue},{x:456,n:'写',h:'治理门禁',t:'类型校验 · 去重 · 无损 · 墓碑',c:C.teal},{x:848,n:'测',h:'指标与验收',t:'Assessment ↔ 阶段/能力 · GWT 测试 · commit/path',c:C.orange}];
 feats.forEach(a=>{rect(s,a.x,436,368,76,C.white,C.rule,1,9);pill(s,a.n,a.x+12,449,40,a.c,C.white);text(s,a.h,a.x+61,441,288,24,{size:14,bold:true,color:a.c});text(s,a.t,a.x+61,467,290,34,{size:11,color:C.muted});});
 rule(s,640,402,640,428,C.blue,1.5);
 rect(s,65,548,1150,78,C.paleBlue,'none',0,9);text(s,'差异重点',82,555,104,22,{size:12,bold:true,color:C.blue});text(s,'不仅回答“搜到了什么”，还记录“该记什么、如何入图、依据何在、是否通过验收”。',198,552,980,29,{size:16,bold:true,color:C.ink});text(s,'质量剖面：覆盖 · 结构 · 溯源 · 新鲜度 · 冗余（已提出，尚未全部量化）',198,582,980,25,{size:12,color:C.muted});
 text(s,'当前基座：Acme（ArchiMate 3.2 + UML 2 状态机）；Schema 可按项目扩展。',78,638,1110,20,{size:11,color:C.muted,align:'center'});
}
// 4 · Metric taxonomy explicitly connected to workflow and capabilities.
{
 const p=plan.pages[3],s=base(p,4);const st=p.status;
 text(s,'通用流程 / 状态',68,195,260,24,{size:13,bold:true,color:C.blue});text(s,'框架能力与可观测点',365,195,360,24,{size:13,bold:true,color:C.teal});text(s,'指标结果状态',955,195,250,24,{size:13,bold:true,color:C.orange,align:'right'});
 const top=['理解与计划','检索上下文','执行与写入','验证与人审','交付与沉淀','等待 / 异步'];top.forEach((a,i)=>{const x=67+i*193;rect(s,x,226,175,46,i===1?C.paleBlue:C.white,C.rule,1,8);text(s,a,x+5,230,165,37,{size:12,bold:true,color:i===1?C.blue:C.ink,align:'center'});if(i<5){rule(s,x+175,249,x+190,249,C.muted,1.5);}});
 text(s,'流程节点 → Assessment 指标 → 局部证据 → 整体结果',235,284,810,26,{size:14,bold:true,color:C.ink,align:'center'});
 const bw=820,bx=366,by=326;let x=bx;[[st.measured,C.teal,'已定量'],[st.partial,C.orange,'部分测量'],[st.notMeasured,'#C8CED7','未测量']].forEach(([n,c,label])=>{const w=bw*n/20;rect(s,x,by,w-2,36,c,'none',0);text(s,`${label} ${n}`,x,by+39,w-4,23,{size:12,bold:true,color:c==='#C8CED7'?C.muted:c,align:'center'});x+=w;});
 text(s,'20',74,317,190,76,{size:66,bold:true,color:C.ink});text(s,'项指标建模',80,391,205,27,{size:16,bold:true});
 const rows=p.groups;rows.forEach((g,i)=>{const col=i<5?0:1,row=i%5,xx=67+col*588,yy=438+row*39;dot(s,xx+5,yy+13,4,i<4?C.teal:(i<7?C.orange:'#AAB3BF'));text(s,g.stateLabel,xx+17,yy,171,24,{size:11,bold:true});text(s,g.metrics.join(' · '),xx+195,yy,366,25,{size:11,color:C.muted});});
 rect(s,66,645,1148,1,C.rule,'none',0);text(s,'整体指标看任务成功率与端到端成本；局部指标看每个过程环节是否稳定。逐项定义见附录。',73,647,1120,22,{size:12,bold:true,color:C.blue});
}
// 5 · Industry-wide Graph RAG lifecycle and ArchGraph coverage mapped to metric ids.
{
 const p=plan.pages[4],s=base(p,5);const cov=new Map(p.coverage.map(x=>[x.id,x]));const groups=[{label:'写入与知识治理',ids:['L1','L2','L3','L4'],y:206,color:C.blue},{label:'检索与排序',ids:['L5','L6'],y:356,color:C.teal},{label:'生成、验证与回流',ids:['L7','L8'],y:506,color:C.orange}];
 groups.forEach(g=>{text(s,g.label,68,g.y-2,142,24,{size:13,bold:true,color:g.color});rule(s,68,g.y+27,1212,g.y+27,C.rule,1);const gap=16,n=g.ids.length,w=(978-gap*(n-1))/n,start=224;g.ids.forEach((id,i)=>{const st=p.stages.find(a=>a.id===id),c=cov.get(id),x=start+i*(w+gap),y=g.y+39;rect(s,x,y,w,91,C.white,C.rule,1,8);text(s,`${st.id} · ${st.name}`,x+8,y+5,w-16,25,{size:13,bold:true,color:C.ink});text(s,st.sub,x+8,y+31,w-16,23,{size:10,color:C.muted});const state=c.status==='covered'?'覆盖':c.status==='replaced'?'替代设计':'部分';const color=c.status==='covered'?C.teal:(c.status==='replaced'?C.blue:C.orange);pill(s,`${state} · 指标 ${c.metrics}`,x+8,y+61,w-16,color,C.white);if(i<n-1){rule(s,x+w,y+45,x+w+gap-5,y+45,g.color,2);text(s,'›',x+w+gap-17,y+29,17,25,{size:20,bold:true,color:g.color,align:'center'});}});});
 rect(s,68,644,1144,23,C.paleBlue,'none',0,6);text(s,'L2：以图谱元素/关系作为语义单元；L4 社区索引为部分覆盖。Graph RAG 属于应用框架支撑层。',78,644,1123,22,{size:11,bold:true,color:C.blue});
}
// 6 · Results separate from the metric model, with correct comparability limits.
{
 const p=plan.pages[5],s=base(p,6);const st=p.status;const parts=[[st.measured,C.teal,'实测'],[st.partial,C.orange,'部分'],[st.notMeasured,'#C8CED7','未测']];let bx=67,bw=1145,x=bx;parts.forEach(([n,c,l])=>{const w=bw*n/20;rect(s,x,196,w-3,35,c,'none',0);text(s,`${n} ${l}`,x,232,w-5,24,{size:12,bold:true,color:c==='#C8CED7'?C.muted:c,align:'center'});x+=w;});
 const k=p.kpis;const kpi=[{v:'94.6 → 98.7',l:'检索 R@1',n:'内部向量基线 → 重排；R@5 99.4 · MRR 0.997',c:C.blue},{v:'10 / 10',l:'ON 组任务成功',n:'自建试跑小样本，不代表总体 Coding 成功率',c:C.teal},{v:'2.0–2.5s',l:'读路径时延',n:'写约 1.1s；读写路径分别统计',c:C.ink},{v:'31 / 31',l:'记忆题集正确',n:'自建数据；拒答正确率 100%',c:C.orange}];
 kpi.forEach((a,i)=>{const col=i%2,row=Math.floor(i/2),xx=68+col*575,yy=282+row*105;rect(s,xx,yy,548,88,C.white,C.rule,1,8);rect(s,xx,yy,6,88,a.c,'none',0);text(s,a.v,xx+19,yy+8,205,39,{size:27,bold:true,color:a.c});text(s,a.l,xx+226,yy+10,300,24,{size:14,bold:true});text(s,a.n,xx+226,yy+37,300,40,{size:11,color:C.muted});});
 text(s,'MCP 试跑',68,501,125,23,{size:12,bold:true,color:C.orange});text(s,'工具调用 −43%  ·  轮次 −39%  ·  token −18%',197,497,605,29,{size:15,bold:true,color:C.ink});text(s,'10 题试跑；OFF 组 grep 失败并触发慢回退，基线污染，差值仅作方向性观察。',197,526,985,28,{size:11,color:C.orange});
 rect(s,68,566,1145,67,C.paleBlue,'none',0,8);text(s,'可比性与下一步',83,572,145,21,{size:12,bold:true,color:C.blue});text(s,'8 项整体 Coding / Agent 基准尚未运行；跨团队/论文数据不与本地检索分数直接比较。',235,571,960,23,{size:12,bold:true});text(s,'先做同模型、同任务、同 Harness 对照；再跟踪知识库覆盖 / 结构 / 溯源 / 新鲜度 / 冗余随规模的变化。',235,596,960,27,{size:11,color:C.muted});
}
// 7 · Organization federation architecture.
{
 const p=plan.pages[6],s=base(p,7);const cx=642,cy=383,pts=[[205,244],[433,207],[861,207],[1080,259],[1027,497],[329,507]];
 text(s,'项目自治维护领域知识库',66,190,1145,22,{size:13,bold:true,color:C.blue,align:'center'});
 p.members.forEach((m,i)=>{const [x,y]=pts[i];rule(s,cx,cy,x+65,y+25,i%2?C.teal:C.blue,2);dot(s,x+65,y+25,4,i%2?C.teal:C.blue);rect(s,x,y,132,50,C.white,C.rule,1,8);text(s,m,x+5,y+7,122,35,{size:m.length>17?10:13,bold:true,align:'center'});});
 rect(s,cx-77,cy-54,154,108,C.ink,'none',0,44);text(s,'联邦中心',cx-67,cy-16,134,32,{size:18,bold:true,color:C.white,align:'center'});
 text(s,'发现能力',580,268,124,21,{size:10,bold:true,color:C.muted,align:'center'});text(s,'显式授权 · 按引用读取',535,458,214,22,{size:10,bold:true,color:C.muted,align:'center'});
 const stats=p.status;stats.forEach((d,i)=>{const xx=104+i*370;rule(s,xx,570,xx+300,570,C.rule,1);text(s,d.v,xx,577,112,45,{size:31,bold:true,color:[C.blue,C.teal,C.orange][i]});text(s,d.k,xx+119,584,177,24,{size:13,bold:true});});
 text(s,'领域专业维护  ·  MCP 基础治理  ·  中心统一授权  ·  不合并主权图',282,635,716,25,{size:14,bold:true,color:C.ink,align:'center'});
}
// 8 · Twenty metric details, two native-shape tables.
{
 const p=plan.pages[7],s=base(p,8),data=p.metrics;const sl={measured:'实测',partial:'部分',not_measured:'未测'},sc={measured:C.teal,partial:C.orange,not_measured:C.muted};
 const draw=(items,x)=>{const w=555;rect(s,x,193,w,29,C.ink,'none',0);text(s,'#  指标 / 流程状态',x+8,196,246,22,{size:10,bold:true,color:C.white});text(s,'现有结果',x+260,196,286,22,{size:10,bold:true,color:C.white});items.forEach((m,i)=>{const y=226+i*40;if(i%2===0)rect(s,x,y,w,39,C.white,'none',0);text(s,String(m.n).padStart(2,'0'),x+6,y+3,26,17,{size:9,bold:true,color:C.muted});text(s,m.name,x+34,y+1,215,21,{size:10,bold:true});text(s,`${sl[m.status]} · ${m.group}`,x+34,y+20,220,16,{size:8,bold:true,color:sc[m.status]});text(s,m.result,x+260,y+3,288,33,{size:9,color:C.ink});rule(s,x,y+39,x+w,y+39,C.rule,.6);});};
 draw(data.slice(0,10),65);draw(data.slice(10),660);text(s,'业界区间仅作测量口径参考；“未测”不等于劣于行业。完整下一步动作见 content-plan-v3.json。',69,642,1127,22,{size:11,color:C.muted});
}
// 9 · Industry evidence: pain and practice, kept distinct from our measured results.
{
 const p=plan.pages[8],s=base(p,9);const xs=[68,355,642,929];p.pains.forEach((a,i)=>{const x=xs[i];text(s,a.big,x,207,250,66,{size:43,bold:true,color:[C.blue,C.teal,C.orange,C.ink][i]});text(s,a.head,x,275,250,35,{size:15,bold:true});text(s,a.line,x,312,250,52,{size:11,color:C.muted});if(i<3)rule(s,x+265,208,x+265,371,C.rule,1);});
 rule(s,67,390,1213,390,C.rule,1);text(s,'工程案例里的可复用做法',69,401,450,27,{size:16,bold:true,color:C.blue});
 const cases=p.cases;cases.forEach((a,i)=>{const y=440+i*40;text(s,a.head,72,y,318,26,{size:12,bold:true});text(s,a.metric,400,y,335,26,{size:11,bold:true,color:i===0?C.teal:C.ink});text(s,a.line,747,y,450,28,{size:10,color:C.muted});});
 rect(s,68,615,1145,39,C.paleOrange,'none',0,7);text(s,'不同研究口径、样本与方法不可合并成一个因果结论；本页用于提出问题与设计框架。',80,621,1120,27,{size:12,bold:true,color:C.orange,align:'center'});
}

await fs.mkdir(TMP,{recursive:true});await fs.mkdir(path.dirname(OUT),{recursive:true});
const candidate=path.join(TMP,'candidate.pptx');await (await PresentationFile.exportPptx(ppt)).save(candidate);
for(let i=0;i<ppt.slides.items.length;i++){const slide=ppt.slides.items[i],n=String(i+1).padStart(2,'0');const png=await ppt.export({slide,format:'png',scale:1});await fs.writeFile(path.join(TMP,`slide-${n}.png`),new Uint8Array(await png.arrayBuffer()));const layout=await slide.export({format:'layout'});await fs.writeFile(path.join(TMP,`slide-${n}.layout.json`),await layout.text());}
const receipt=path.join(TMP,'validation-v3-final.json');
const result=await finalizePresentation({workspaceDir:ROOT,candidatePath:candidate,finalPath:OUT,pythonExecutable:RUNTIME_PYTHON,integrityValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--validate-bullet-geometry','--validate-heading-fit'],explicitTotalSlideCount:9,fontPolicy:{basis:'design',families:[FONT,'Microsoft YaHei']},verifyArtifactToolImport:true,receiptPath:receipt});
console.log(JSON.stringify({output:OUT,slides:ppt.slides.items.length,finalized:true,validation:result?.status||result?.ok||'completed'},null,2));
