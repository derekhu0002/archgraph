import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT=path.resolve(import.meta.dirname,'../..');
const NODE_MODULES='C:/Users/remoteadmin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const RUNTIME_PYTHON='C:/Users/remoteadmin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const SKILL_DIR='C:/Users/remoteadmin/.codex/plugins/cache/openai-primary-runtime/presentations/26.909.12148/skills/presentations';
const TMP=path.join(ROOT,'docs/ppt/.build-coding-v4');
const OUT=path.join(ROOT,'docs/ppt/output/archgraph-coding-business-deck-v4-final.pptx');
const plan=JSON.parse(await fs.readFile(path.join(ROOT,'docs/ppt/content-plan-v4.json'),'utf8'));
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

// 1 · Business Layer: the industry-neutral value flow, independent of implementation choices.
{
 const p=plan.pages[0],s=base(p,1,true);pill(s,'适用于不同业务领域',938,184,258,'#243750','#C9D4E2');
 const x0=68,w=165,gap=36,y=262,h=132,colors=[C.blue,'#496CE8','#4E86CC',C.teal,'#D47A4E','#20856D'];
 p.key.forEach((n,i)=>{const x=x0+i*(w+gap);rect(s,x,y,w,h,i===3?'#244C71':'#21344A',i===3?'#7896FF':'#4B6077',1,12);dot(s,x+23,y+24,14,colors[i]);text(s,String(i+1).padStart(2,'0'),x+12,y+11,22,24,{size:12,bold:true,color:C.white,align:'center'});text(s,n.label,x+16,y+42,w-32,42,{size:17,bold:true,color:C.white,align:'center'});text(s,n.sub,x+10,y+87,w-20,31,{size:12,color:'#C8D3DF',align:'center'});if(i<5){rule(s,x+w,y+66,x+w+gap-8,y+66,'#91A9FF',2);text(s,'›',x+w+gap-18,y+50,18,30,{size:23,bold:true,color:'#91A9FF',align:'center'});}});
 text(s,'Business Layer · 业务价值主路径',70,220,390,25,{size:13,bold:true,color:'#9DB1FF'});
 rect(s,295,433,690,42,'#1D3047','#3F5570',1,8);text(s,'执行反馈：Acting → AwaitingResult → 结果返回 → 再规划 / 再执行',311,439,660,30,{size:13,bold:true,color:'#D4DDEA',align:'center'});
 const waits=[['人类校准','补充信息 / 评审 / 批准',80,C.paleOrange,C.orange],['异步并行','后台任务不阻塞主回合',453,C.paleBlue,'#91A9FF'],['终止判断','Stopped 仅表示会话结束',826,C.paleTeal,'#56B99A']];
 waits.forEach(([a,b,x,,accent])=>{rect(s,x,511,340,69,'#1E3046','#3F5570',1,9);dot(s,x+21,535,5,accent);text(s,a,x+37,519,278,23,{size:15,bold:true,color:C.white});text(s,b,x+37,543,285,26,{size:12,color:'#C8D3DF'});});
 text(s,'评价目标：可验证、可接受、可持续改进的交付结果。',68,613,980,27,{size:15,bold:true,color:'#FFC59E'});
}
// 2 · Application Layer: align app components to business activities; expose three optional context-access modes.
{
 const p=plan.pages[1],s=base(p,2),xs=[58,255,452,649,846,1043],w=178,stages=plan.pages[0].key;
 text(s,'BUSINESS LAYER  /  业务价值活动',66,176,520,21,{size:12,bold:true,color:C.blue});
 stages.forEach((a,i)=>{const x=xs[i];rect(s,x,201,w,61,i===2?C.paleBlue:C.white,i===2?'#AAB8FF':C.rule,1,8);pill(s,String(i+1).padStart(2,'0'),x+8,208,36,i===2?C.blue:C.ink,C.white);text(s,a.label,x+48,205,w-55,24,{size:12,bold:true,color:C.ink});text(s,a.sub,x+10,232,w-20,23,{size:9,color:C.muted,align:'center'});});
 text(s,'↓ 同一业务活动由多个应用组件协作支撑',66,270,580,20,{size:10,bold:true,color:C.muted});
 rect(s,58,293,1164,37,C.ink,'none',0,7);text(s,'APPLICATION LAYER  /  通用 Coding Agent Harness',72,299,420,24,{size:13,bold:true,color:C.white});text(s,'Session Loop · Policy · Sandbox · Event / Trace',680,299,525,24,{size:11,color:'#CBD5E1',align:'right'});
 const cards=[
  ['入口 / 会话','任务输入 · 工作区',C.blue],['Planner','拆解 · 计划状态',C.blue],['Context Access','按需选择知识访问',C.teal],['工具适配器','IDE · Shell · Git · MCP',C.teal],['裁判 / 人审','测试 · Review · 决策',C.orange],['交付 / 记忆','提交 · 证据 · 复用',C.orange]
 ];
 cards.forEach((a,i)=>{const x=xs[i];rule(s,x+w/2,262,x+w/2,350,'#AAB4C2',1);rect(s,x,350,w,113,C.white,C.rule,1,9);rect(s,x,350,6,113,a[2],'none',0);dot(s,x+20,366,10,a[2]);text(s,String(i+1).padStart(2,'0'),x+10,355,20,21,{size:9,bold:true,color:C.white,align:'center'});text(s,a[0],x+36,355,w-45,25,{size:12,bold:true,color:a[2]});text(s,a[1],x+12,382,w-24,24,{size:9,color:C.muted,align:'center'});if(i===2){const modes=[['普通检索','代码 / 文件'],['RAG','切块 / 召回'],['Graph RAG','实体 / 关系']];modes.forEach((m,j)=>{rect(s,x+12,407+j*17,w-24,15,j===2?C.paleTeal:C.light,'none',0,4);text(s,`${m[0]} · ${m[1]}`,x+15,407+j*17,w-30,14,{size:8,bold:j===2,color:j===2?C.teal:C.muted,align:'center'});});}else{text(s,['目标 / 人类决策','状态 / 下一步','任务相关上下文','受限执行面','可执行质量门','Commit / Memory'][i],x+10,414,w-20,34,{size:9,color:C.ink,align:'center'});}if(i<5){rule(s,x+w,405,x+w+19,405,C.blue,2);text(s,'›',x+w+3,390,16,22,{size:18,bold:true,color:C.blue,align:'center'});}});
 text(s,'上下文源：代码仓 · 文档 · 历史决策 · 可授权知识图谱',66,477,510,24,{size:10,bold:true,color:C.blue});text(s,'可执行裁判：单测 / 集成测 / 代码评审 / 任务成功定义',630,477,570,24,{size:10,bold:true,color:C.orange,align:'right'});
 rect(s,128,522,1024,65,C.paleBlue,'none',0,9);text(s,'Context Access 的三种可选方式',146,529,280,20,{size:12,bold:true,color:C.blue});text(s,'普通检索　→　RAG　→　Graph RAG',455,527,666,25,{size:16,bold:true,color:C.ink,align:'center'});text(s,'不要求每个 Agent 都使用 RAG；按信息结构、关系推理与可追溯要求选型。',250,555,790,22,{size:11,color:C.muted,align:'center'});
 text(s,'工程实践强调：结构化上下文 · 自动验收 · 可控工具 · 持续反馈',90,615,1100,27,{size:14,bold:true,color:C.ink,align:'center'});
}
// 3 · ArchGraph overlays both layers: domain knowledge on business layer, governed graph access on application layer.
{
 const p=plan.pages[2],s=base(p,3);
 const band=(y,h,label,color)=>{rect(s,65,y,1150,h,color,'none',0,9);text(s,label,80,y+8,190,22,{size:12,bold:true,color:C.white});};
 band(192,184,'BUSINESS LAYER',C.ink);
 const bx=[296,584,872];const biz=[['领域本体 / Schema','共享概念 · 关系 · 约束'],['项目意图图谱','需求 · 决策 · 架构 · 状态'],['价值与指标关系','阶段 ↔ 能力 ↔ Assessment']];
 biz.forEach((a,i)=>{const x=bx[i];rect(s,x,220,255,86,C.white,C.rule,1,10);text(s,a[0],x+10,229,235,25,{size:15,bold:true,color:C.blue,align:'center'});text(s,a[1],x+12,260,231,34,{size:11,color:C.muted,align:'center'});if(i<2){rule(s,x+255,262,x+280,262,'#AAB8FF',2);text(s,'›',x+262,246,18,25,{size:20,bold:true,color:C.blue,align:'center'});}});
 text(s,'人类领域专家维护语义与事实；Agent 与业务流程共享同一知识表达',310,324,700,25,{size:12,bold:true,color:C.white,align:'center'});
 band(409,188,'APPLICATION LAYER',C.teal);
 const app=[['Context Access / Graph MCP','语义 · 结构 · 子图与受控读写'],['Knowledge Governance','校验 · 去重 · 无损 · 墓碑'],['Evaluation / Trace','GWT · 指标映射 · commit/path']];
 app.forEach((a,i)=>{const x=320+i*288;rect(s,x,444,207,83,C.white,C.rule,1,9);text(s,a[0],x+8,451,191,27,{size:11,bold:true,color:C.teal,align:'center'});text(s,a[1],x+8,481,191,32,{size:9,color:C.muted,align:'center'});if(i<2){rule(s,x+207,485,x+276,485,'#6CC4AB',2);text(s,'›',x+231,470,16,22,{size:18,bold:true,color:C.teal,align:'center'});}});
 // Cross-layer trace: business assets feed application services; app evidence maps back to business outcomes.
 [[423,444],[711,444],[999,444]].forEach(([cx,ty],i)=>{rule(s,cx,306,cx,ty,i===1?C.orange:'#91A4BB',1.5);dot(s,cx,306,4,i===1?C.orange:'#91A4BB');});
 rect(s,83,565,1114,61,C.paleBlue,'none',0,8);text(s,'跨层连接',99,572,100,21,{size:11,bold:true,color:C.blue});text(s,'业务语义进入图谱 → Agent 按需检索 / 写入 → 验收与证据回链 → 指标衡量价值',215,568,954,28,{size:14,bold:true,color:C.ink,align:'center'});text(s,'质量剖面（已提出，尚未全部量化）：覆盖 · 结构 · 溯源 · 新鲜度 · 冗余',220,597,900,20,{size:10,color:C.muted,align:'center'});
 text(s,'当前基座：Acme（ArchiMate 3.2 + UML 2 状态机）；Schema 可按项目扩展。',78,642,1110,19,{size:10,color:C.muted,align:'center'});
}
// 4 · Explicit Business Layer → Application Layer → metric crosswalk.
{
 const p=plan.pages[3],s=base(p,4);const rows=p.crosswalk;
 const cols=[{x:63,w:177,t:'业务环节',c:C.blue},{x:240,w:283,t:'Business Layer · 价值活动',c:C.blue},{x:523,w:355,t:'Application Layer · 支撑能力',c:C.teal},{x:878,w:337,t:'Assessment · 当前指标',c:C.orange}];
 cols.forEach(c=>{rect(s,c.x,188,c.w,32,C.ink,'none',0);text(s,c.t,c.x+7,191,c.w-14,25,{size:10,bold:true,color:C.white,align:c.w<200?'center':'left'});});
 rows.forEach((r,i)=>{const y=222+i*62,fill=i%2===0?C.white:'#F0F2F3';cols.forEach(c=>rect(s,c.x,y,c.w-2,60,fill,'none',0));rect(s,cols[0].x,y,5,60,[C.blue,C.blue,C.teal,C.orange,C.teal,'#7A8798'][i],'none',0);text(s,String(i+1).padStart(2,'0'),cols[0].x+10,y+7,28,18,{size:9,bold:true,color:C.muted});text(s,r.stage,cols[0].x+39,y+6,130,47,{size:11,bold:true,color:C.ink});text(s,r.business,cols[1].x+10,y+5,cols[1].w-18,49,{size:10,color:C.ink});text(s,r.application,cols[2].x+10,y+5,cols[2].w-18,49,{size:10,bold:true,color:C.teal});text(s,r.metrics,cols[3].x+10,y+5,cols[3].w-18,49,{size:9,color:C.ink});if(i<5){text(s,'↓',1159,y+44,20,20,{size:13,bold:true,color:C.muted,align:'center'});}});
 rect(s,64,608,1150,34,C.paleBlue,'none',0,7);text(s,'20 项指标状态',76,614,135,21,{size:11,bold:true,color:C.blue});let x=223;[[4,C.teal,'实测'],[5,C.orange,'部分'],[11,'#BEC6D1','未测']].forEach(([n,c,label])=>{const w=875*n/20;rect(s,x,613,w-2,17,c,'none',0);text(s,`${label} ${n}`,x,629,w-2,16,{size:8,bold:true,color:c==='#BEC6D1'?C.muted:c,align:'center'});x+=w;});
 text(s,'映射不是一对一：跨阶段任务由多个组件协同；附录列出全部20项及测量状态。',76,657,1125,18,{size:10,bold:true,color:C.muted,align:'center'});
}
// 5 · RAG options are nested in Application Layer Context Access; Graph RAG is one specialized branch.
{
 const p=plan.pages[4],s=base(p,5),cov=new Map(p.coverage.map(x=>[x.id,x]));
 text(s,'Context Access · 按知识与任务选择实现方式',69,174,390,22,{size:12,bold:true,color:C.blue});
 const options=[{x:467,n:'普通检索',d:'代码 / 文件 / 全文',c:C.blue},{x:713,n:'RAG',d:'文本块 / 语义召回',c:C.teal},{x:959,n:'Graph RAG',d:'实体关系 / 多跳子图',c:C.orange}];
 options.forEach(a=>{rect(s,a.x,174,230,40,C.white,C.rule,1,7);dot(s,a.x+16,194,5,a.c);text(s,a.n,a.x+29,178,83,20,{size:11,bold:true,color:a.c});text(s,a.d,a.x+110,178,112,26,{size:9,color:C.muted,align:'right'});});
 const groups=[{label:'写入与知识治理',ids:['L1','L2','L3','L4'],y:216,color:C.blue},{label:'检索与排序',ids:['L5','L6'],y:351,color:C.teal},{label:'生成、验证与回流',ids:['L7','L8'],y:486,color:C.orange}];
 groups.forEach(g=>{text(s,g.label,68,g.y-1,144,21,{size:12,bold:true,color:g.color});rule(s,68,g.y+24,1212,g.y+24,C.rule,1);const gap=16,n=g.ids.length,w=(978-gap*(n-1))/n,start=224;g.ids.forEach((id,i)=>{const st=p.stages.find(a=>a.id===id),c=cov.get(id),x=start+i*(w+gap),y=g.y+31;rect(s,x,y,w,79,C.white,C.rule,1,8);text(s,`${st.id} · ${st.name}`,x+8,y+4,w-16,23,{size:12,bold:true,color:C.ink});text(s,st.sub,x+8,y+28,w-16,19,{size:9,color:C.muted});const state=c.status==='covered'?'覆盖':c.status==='replaced'?'替代设计':'部分';const color=c.status==='covered'?C.teal:(c.status==='replaced'?C.blue:C.orange);pill(s,`${state} · 指标 ${c.metrics}`,x+8,y+51,w-16,color,C.white);if(i<n-1){rule(s,x+w,y+39,x+w+gap-5,y+39,g.color,2);text(s,'›',x+w+gap-17,y+24,17,23,{size:18,bold:true,color:g.color,align:'center'});}});});
 rect(s,68,619,1144,33,C.paleBlue,'none',0,6);text(s,'Graph 特有构建：本体语义 · 图谱事实与关系 · Graph MCP · 写入治理与来源溯源',80,623,1123,25,{size:11,bold:true,color:C.blue,align:'center'});
}
// 6 · Show where there is measured improvement, while preserving small-sample and baseline caveats.
{
 const p=plan.pages[5],s=base(p,6);const st=p.status;const parts=[[st.measured,C.teal,'实测'],[st.partial,C.orange,'部分'],[st.notMeasured,'#C8CED7','未测']];let bx=67,bw=1145,x=bx;parts.forEach(([n,c,l])=>{const w=bw*n/20;rect(s,x,196,w-3,35,c,'none',0);text(s,`${n} ${l}`,x,232,w-5,24,{size:12,bold:true,color:c==='#C8CED7'?C.muted:c,align:'center'});x+=w;});
 const k=p.kpis;const kpi=[{v:'94.6 → 98.7',l:'Context Access · 检索 R@1',n:'内部向量基线 → 重排；R@5 99.4 · MRR 0.997',c:C.blue},{v:'10 / 10',l:'工具层 · ON 组任务成功',n:'自建试跑小样本，不代表总体 Coding 成功率',c:C.teal},{v:'2.0–2.5s',l:'Graph MCP · 读路径时延',n:'写约 1.1s；读写路径分别统计',c:C.ink},{v:'31 / 31',l:'记忆层 · 题集正确',n:'自建数据；拒答正确率 100%',c:C.orange}];
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
 draw(data.slice(0,10),65);draw(data.slice(10),660);text(s,'业界区间仅作测量口径参考；“未测”不等于劣于行业。完整下一步动作见 content-plan-v4.json。',69,642,1127,22,{size:11,color:C.muted});
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
const receipt=path.join(TMP,'validation-v4-final.json');
const result=await finalizePresentation({workspaceDir:ROOT,candidatePath:candidate,finalPath:OUT,pythonExecutable:RUNTIME_PYTHON,integrityValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--validate-bullet-geometry','--validate-heading-fit'],explicitTotalSlideCount:9,fontPolicy:{basis:'design',families:[FONT,'Microsoft YaHei']},verifyArtifactToolImport:true,receiptPath:receipt});
console.log(JSON.stringify({output:OUT,slides:ppt.slides.items.length,finalized:true,validation:result?.status||result?.ok||'completed'},null,2));
