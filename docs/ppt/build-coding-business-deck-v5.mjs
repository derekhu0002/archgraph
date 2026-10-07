import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT=path.resolve(import.meta.dirname,'../..');
const NODE_MODULES='C:/Users/remoteadmin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const RUNTIME_PYTHON='C:/Users/remoteadmin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const SKILL_DIR='C:/Users/remoteadmin/.codex/plugins/cache/openai-primary-runtime/presentations/26.909.12148/skills/presentations';
const TMP=path.join(ROOT,'docs/ppt/.build-coding-v5');
const OUT=path.join(ROOT,'docs/ppt/output/archgraph-coding-business-deck-v5-final-aligned.pptx');
const source=JSON.parse(await fs.readFile(path.join(ROOT,'docs/ppt/content-plan-v4.json'),'utf8'));
const {Presentation,PresentationFile}=await import(pathToFileURL(path.join(NODE_MODULES,'@oai/artifact-tool/dist/artifact_tool.mjs')).href);
const {resolvePresentationFont,finalizePresentation}=await import(pathToFileURL(path.join(SKILL_DIR,'container_tools/artifact_tool_utils.mjs')).href);
const C={ink:'#152338',paper:'#F7F5EF',white:'#FFFFFF',blue:'#315EF6',teal:'#14866D',orange:'#C65D32',muted:'#64748B',rule:'#D9DEE5',paleBlue:'#E8EDFF',paleTeal:'#E6F3EF',paleOrange:'#F8ECE6',charcoal:'#24364B',light:'#EEF1F4',navy:'#102033'};
const FONT=resolvePresentationFont();
const plan={...source,deckId:'archgraph-coding-business-deck-v5-001',title:'ArchGraph · Coding Agent 业务价值、应用架构与测评',subtitle:'以通用业务流程和 Harness 架构为骨架，呈现 ArchGraph 的构建位置、指标映射与现有证据',evidenceNote:'架构示意逐项映射 ARGO canonical model 的元素与关系。通用 Graph RAG 流程单独标为业界参考。',modelViews:{business:'coding-agent-business-value-flow-001',application:'coding-agent-application-architecture-001',archgraph:'archgraph-internal-read-write-001',metrics:['coding-agent-business-metrics-operations-001','coding-agent-business-metrics-delivery-001','coding-agent-business-benchmarks-1-001','coding-agent-business-benchmarks-2-001'],genericGraphRag:'generic-graph-rag-end-to-end-001',federation:'federated-intent-graph-architecture-001'}};
const titles=[
 ['Coding Agent 业务价值流程','Business Layer：跨业务场景的价值活动；先说明“做什么”，再进入实现架构。'],
 ['通用 Coding Agent 应用架构','Application Layer：Harness 编排应用功能；普通检索、RAG 与 Graph RAG 是可选实现。'],
 ['ArchGraph 在业务层与应用层中的位置','Graph MCP 是 Harness 可调用的应用能力；项目本体与图谱承载共享领域语义。'],
 ['业务阶段、应用能力与指标映射','每个 Assessment 关联到业务活动和应用能力，为结果页提供统一口径。'],
 ['Graph RAG 通用检索流程：写入、索引与查询','业界参考流程；各实现会省略、替换或扩展其中部分阶段。'],
 ['测评结果：局部改善已见，整体优势待同口径验证','检索与记忆有内部证据；整体 Coding 基准和知识质量仍需补测。'],
 ['联邦式意图图谱：自治项目通过引用协作','中心管理成员与授权；成员保有自己的图谱，读取返回引用。'],
 ['20 项指标：映射关系、当前结果与下一步','指标全集落在业务流程和应用能力上；“未测”表示证据缺口。'],
 ['业界实践提示：专家帮助 Agent 在生产级项目中工作','案例启发我们把专家脑中的项目地图变成可共享、可检查的外部模型。']
];
plan.pages=plan.pages.map((p,i)=>({...p,title:titles[i][0],subtitle:titles[i][1]}));
plan.pages[0].modelView=plan.modelViews.business;
plan.pages[1].modelView=plan.modelViews.application;
plan.pages[2].modelView=plan.modelViews.archgraph;
plan.pages[3].modelViews=plan.modelViews.metrics;
plan.pages[4].modelView=plan.modelViews.genericGraphRag;
plan.pages[4].pipeline=[['graphrag-flow-ingest-001','知识写入与解析'],['graphrag-flow-extract-001','实体关系抽取'],['graphrag-flow-index-001','图谱与索引构建'],['graphrag-flow-query-001','查询解析与改写'],['graphrag-flow-retrieve-001','向量词法图遍历召回'],['graphrag-flow-rerank-001','结果融合与重排'],['graphrag-flow-context-001','上下文组装与溯源'],['graphrag-flow-generate-001','生成回答与反馈']];
plan.pages[4].references=['Microsoft GraphRAG indexing dataflow','Microsoft GraphRAG query overview'];
plan.pages[4].speakerNotes='通用 Graph RAG 写入/索引与查询流程示意，节点与 Triggering 关系对应 ARGO 视图 generic-graph-rag-end-to-end-001。具体框架可能不使用图社区、LLM 抽取或混合召回，流程不是某产品实现规格。业界参考：Microsoft GraphRAG indexing dataflow https://github.com/microsoft/graphrag/blob/main/docs/index/default_dataflow.md ; query overview https://microsoft.github.io/graphrag/query/overview/ 。';
plan.pages[5].speakerNotes+='\n专家提供项目地图、可解释的把控与评审，是本项目的设计洞察；低年资工程师借此逐步学习领域本体属于尚未测量的潜在价值。图遍历在关系密集、多跳问题上有明确表达优势，但当前没有可与业界比较的多跳 Recall 数据，因此不宣称 Graph RAG 普遍优于普通检索或 RAG。';
plan.pages[6].modelView=plan.modelViews.federation;
plan.pages[6].speakerNotes+='\n图中组件、服务、数据对象和关系对齐视图 federated-intent-graph-architecture-001；“Access”表达经授权读取，“Federated Graph Reference”指向成员图，不表示中心合并或保存副本。';
plan.pages[7].speakerNotes+='\n业务阶段映射和应用能力映射分别来自四个 canonical 指标子视图。公开基准数字仅作口径背景，未在同一模型/任务/Harness 下运行时不作性能比较。';
plan.pages[8].cases=source.pages[8].cases;
plan.pages[8].speakerNotes=source.pages[8].speakerNotes+'\nOpenAI Harness Engineering 案例：三名工程师在约五个月内由 Codex 产出约一百万行代码，团队报告没有手写代码；文章强调人类设计环境、定义意图与架构、建立反馈机制。这里将“专家脑中有项目地图”作为对实践的解释，不是文章原话。来源：https://openai.com/index/harness-engineering/ 。';
await fs.writeFile(path.join(ROOT,'docs/ppt/content-plan-v5.json'),JSON.stringify(plan,null,2)+'\n','utf8');

const ppt=Presentation.create({slideSize:{width:1280,height:720}});
const box=(s,x,y,w,h,fill='none',stroke='none',sw=0,r=0)=>s.shapes.add({geometry:r?'roundRect':'rect',position:{left:x,top:y,width:w,height:h},fill,line:{fill:stroke,width:sw},...(r?{borderRadius:r}:{})});
const txt=(s,v,x,y,w,h,o={})=>{const q=box(s,x,y,w,h,o.boxFill||'none',o.boxStroke||'none',o.boxStroke?1:0,o.radius||0);q.text=String(v);q.text.style={typeface:FONT,fontSize:o.size||16,bold:!!o.bold,color:o.color||C.ink,alignment:o.align||'left',verticalAlignment:o.valign||'middle',autoFit:'shrinkText',wrap:true,insets:o.insets||{top:2,right:4,bottom:2,left:4}};return q;};
const line=(s,x1,y1,x2,y2,color=C.rule,width=1)=>s.shapes.add({geometry:'line',position:{left:Math.min(x1,x2),top:Math.min(y1,y2),width:Math.max(Math.abs(x2-x1),.1),height:Math.max(Math.abs(y2-y1),.1),horizontalFlip:x2<x1,verticalFlip:y2<y1},fill:'none',line:{fill:color,width}});
const dot=(s,x,y,r,fill)=>box(s,x-r,y-r,r*2,r*2,fill,'none',0,r);
function page(i,dark=false){const p=plan.pages[i],s=ppt.slides.add();s.background.fill=dark?C.navy:C.paper;const fg=dark?C.white:C.ink,sub=dark?'#BBC7D5':C.muted;txt(s,`ARCHGRAPH  /  ${String(i+1).padStart(2,'0')}     ${p.kicker}`,62,25,1140,23,{size:12,bold:true,color:dark?'#9DB1FF':C.blue});txt(s,p.title,62,53,1155,52,{size:32,bold:true,color:fg});txt(s,p.subtitle,65,108,1142,39,{size:15,color:sub});line(s,62,676,1218,676,dark?'#34475D':C.rule,1);txt(s,'ARCHGRAPH · CODING AGENT',64,682,450,18,{size:9,bold:true,color:sub});txt(s,p.references?.[0]||p.modelView||'',685,682,530,18,{size:8,color:sub,align:'right'});if(p.speakerNotes)s.speakerNotes.textFrame.setText(p.speakerNotes);return s;}
function node(s,label,sub,x,y,w,h,color=C.blue,fill=C.white,size=15){box(s,x,y,w,h,fill,color,1,9);box(s,x,y,5,h,color,'none',0);const subColor=(fill===C.ink||fill===C.blue||fill===C.teal||fill===C.orange)?'#E8EEF5':C.muted;if(h<48){txt(s,`${label}\n${sub}`,x+9,y+3,w-18,h-6,{size:Math.min(size,10),bold:true,color:fill===C.white?color:C.white,align:'center'});}else{txt(s,label,x+12,y+8,w-24,27,{size,bold:true,color});if(sub)txt(s,sub,x+12,y+37,w-24,h-42,{size:10,color:subColor});}}
function edge(s,x1,y1,x2,y2,label,type,color=C.blue){line(s,x1,y1,x2,y2,color,1.6);const mx=(x1+x2)/2,my=(y1+y2)/2;box(s,mx-43,my-12,86,22,C.paper,'none',0,4);txt(s,type,mx-42,my-11,84,20,{size:8,bold:true,color,align:'center'});if(label)txt(s,label,mx-65,my+9,130,17,{size:8,color:C.muted,align:'center'});}

// 1 · Generic business value process
{
 const s=page(0,true);const names=plan.pages[0].modelView;
 txt(s,'Business Process  /  Coding Agent 业务价值流程',66,171,660,24,{size:13,bold:true,color:'#AFC0FF'});
 const stages=[['明确任务与验收目标','目标 · 边界 · 完成定义'],['获取相关项目上下文','按任务需要获取相关信息'],['规划并执行代码变更','拆解 · 工具调用 · 迭代'],['验证并评审结果','测试 · 评审 · 修正'],['交付可验收结果','交付满足验收条件的变更'],['沉淀可复用项目知识','更新可复用的项目上下文']];
 const x0=66,w=169,gap=37,y=260,h=132,colors=[C.blue,'#5579D6','#4E86CC',C.teal,'#D47A4E','#20856D'];
 stages.forEach((a,i)=>{const x=x0+i*(w+gap);box(s,x,y,w,h,'#20344A','#4B6077',1,11);dot(s,x+22,y+22,14,colors[i]);txt(s,String(i+1).padStart(2,'0'),x+10,y+9,24,24,{size:11,bold:true,color:C.white,align:'center'});txt(s,a[0],x+12,y+42,w-24,43,{size:15,bold:true,color:C.white,align:'center'});txt(s,a[1],x+10,y+90,w-20,29,{size:10,color:'#C5D2E0',align:'center'});if(i<5){line(s,x+w,y+65,x+w+gap-2,y+65,'#91A9FF',1.7);txt(s,'Triggering',x+w-9,238,65,16,{size:7,bold:true,color:'#AFC0FF',align:'center'});}});
 txt(s,'图中相邻 Business Process 以 Triggering 连接',843,171,350,20,{size:9,bold:true,color:'#AFC0FF',align:'right'});
 box(s,93,463,1094,83,'#192B40','#3E536B',1,9);txt(s,'端到端目标',111,473,135,22,{size:11,bold:true,color:'#9DB1FF'});txt(s,'业务需求转成经过验证、可交付、可追溯的工程结果',252,467,882,30,{size:18,bold:true,color:C.white,align:'center'});txt(s,'流程只描述业务活动，不预设代码搜索、RAG 或 Graph RAG 等应用实现。',264,508,858,21,{size:11,color:'#C5D2E0',align:'center'});
 txt(s,'指标骨架',70,594,115,22,{size:12,bold:true,color:'#FFC59E'});txt(s,'每个业务活动都能关联对应 Assessment；整体 Coding 基准衡量端到端结果。',193,589,990,30,{size:14,bold:true,color:C.white});
}

// 2 · Generic Application Layer Harness and optional retrieval implementations.
{
 const s=page(1);txt(s,'APPLICATION COMPONENT',65,168,260,20,{size:10,bold:true,color:C.blue});node(s,'通用 Coding Agent Harness','Application Component',465,183,350,51,C.ink,C.white,16);
 const xs=[48,352,656,960],functions=[['会话编排','Application Function'],['上下文访问','Application Function'],['工具与代码执行','Application Function'],['验证与反馈','Application Function']];
 functions.forEach((a,i)=>{node(s,a[0],a[1],xs[i],323,264,80,[C.blue,C.teal,C.blue,C.orange][i],C.white,15);line(s,640,234,xs[i]+132,321,[C.blue,C.teal,C.blue,C.orange][i],1.4);txt(s,'Assignment',xs[i]+90,298,85,16,{size:7,bold:true,color:[C.blue,C.teal,C.blue,C.orange][i],align:'center'});});
 line(s,312,375,352,375,C.blue,1.8);line(s,180,403,180,419,C.blue,1.6);line(s,180,419,788,419,C.blue,1.6);line(s,788,419,788,403,C.blue,1.6);line(s,920,375,960,375,C.orange,1.8);line(s,1090,405,1090,451,C.orange,1.6);line(s,1090,451,180,451,C.orange,1.6);line(s,180,451,180,405,C.orange,1.6);txt(s,'Triggering',291,407,82,15,{size:7,bold:true,color:C.blue,align:'center'});txt(s,'Triggering',434,420,82,15,{size:7,bold:true,color:C.blue,align:'center'});txt(s,'Triggering',899,407,82,15,{size:7,bold:true,color:C.orange,align:'center'});txt(s,'Triggering · 验证结果反馈到会话编排',408,454,430,17,{size:8,bold:true,color:C.orange,align:'center'});
 txt(s,'Context Access 的实现选项',65,497,300,22,{size:12,bold:true,color:C.teal});
 const modes=[['普通检索','文件 · 代码 · 全文',C.blue],['RAG 检索','文本块 · 语义召回',C.teal],['Graph RAG 检索','实体 · 关系 · 图遍历',C.orange]];
 modes.forEach((a,i)=>{const x=387+i*280;node(s,a[0],a[1],x,526,238,73,a[2],i===2?C.paleOrange:C.white,14);line(s,x+119,524,484,405,a[2],1.5);txt(s,'Specialization',x+75,500,87,15,{size:7,bold:true,color:a[2],align:'center'});});
 txt(s,'按任务与知识结构选用；通用 Harness 本身不要求部署 RAG。',328,623,638,25,{size:12,bold:true,color:C.ink,align:'center'});
}

// 3 · ArchGraph's exact place in the two-layer model, plus current implementation chains.
{
 const s=page(2);box(s,63,166,1154,108,C.ink,'none',0,9);txt(s,'BUSINESS LAYER',79,174,145,19,{size:10,bold:true,color:'#AFC0FF'});
 node(s,'Coding Agent 业务价值流程','Business Process',85,197,255,57,C.blue,C.white,12);node(s,'项目领域本体','Business Object',816,197,213,57,C.blue,C.white,12);
 node(s,'Coding领域专家','Business Actor',1051,179,143,37,C.teal,C.white,9);node(s,'Coding开发者','Business Actor',1051,222,143,37,C.teal,C.white,9);
 line(s,1051,197,1030,211,C.muted,1.2);line(s,1051,239,1030,231,C.muted,1.2);txt(s,'Association',1021,202,81,13,{size:7,bold:true,color:C.muted,align:'center'});
 box(s,63,286,1154,207,C.paleTeal,'none',0,9);txt(s,'APPLICATION LAYER',79,292,180,19,{size:10,bold:true,color:C.teal});
 node(s,'ArchGraph MCP Provider','Application Component',82,329,190,60,C.blue,C.white,11);node(s,'Graph MCP Tool Interface','Application Interface',316,329,215,60,C.blue,C.white,10);node(s,'项目图谱上下文服务','Application Service',590,329,245,60,C.teal,C.white,12);node(s,'上下文访问','Application Function',941,329,228,60,C.teal,C.white,12);
 line(s,272,359,316,359,C.blue,1.6);txt(s,'Composition',266,337,85,14,{size:7,bold:true,color:C.blue,align:'center'});line(s,531,359,590,359,C.teal,1.6);txt(s,'Assignment',520,337,89,14,{size:7,bold:true,color:C.teal,align:'center'});line(s,835,359,941,359,C.teal,1.6);txt(s,'Serving',859,337,63,14,{size:7,bold:true,color:C.teal,align:'center'});
 node(s,'项目意图图谱','Data Object',645,419,212,49,C.orange,C.white,10);line(s,710,389,710,419,C.orange,1.5);txt(s,'Access',713,393,52,14,{size:7,bold:true,color:C.orange});node(s,'通用 Coding Agent Harness','Application Component',960,421,226,48,C.ink,C.white,10);
 // Data Object realizes the Business Object; route through the open gutter between app nodes.
 line(s,857,443,886,443,C.blue,1.4);line(s,886,443,886,255,C.blue,1.4);line(s,886,255,886,255,C.blue,1.4);txt(s,'Realization',887,270,75,14,{size:7,bold:true,color:C.blue});
 // The same Application Service serves the Harness and the Business Process.
 line(s,835,379,855,402,C.teal,1.3);line(s,855,402,952,402,C.teal,1.3);line(s,952,402,972,421,C.teal,1.3);txt(s,'Serving',871,405,62,14,{size:7,bold:true,color:C.teal});
 line(s,590,345,557,345,C.teal,1.3);line(s,557,345,557,225,C.teal,1.3);line(s,557,225,340,225,C.teal,1.3);txt(s,'Serving · Business Process',383,229,172,14,{size:7,bold:true,color:C.teal,align:'center'});
 txt(s,'ArchGraph 内部实现关系',68,507,310,21,{size:12,bold:true,color:C.blue});
 const detailRows=[
  ['写入治理',C.orange,'Graph Semantics','图谱写入去重门禁','无损写入门禁','Neo4j Semantic Projection','Triggering'],
  ['语义检索',C.teal,'Default Semantic Retrieval','Hybrid Semantic Retrieval','Semantic Rerank',null,'Triggering'],
  ['结构查询',C.blue,'Neo4j Structural Sync','Read-only Cypher Query','Community Index',null,'Serving']
 ];
 detailRows.forEach((r,ri)=>{const y=532+ri*42;txt(s,r[0],69,y+8,105,18,{size:8,bold:true,color:r[1]});const labels=r.slice(2,6).filter(Boolean);labels.forEach((a,i)=>{const x=181+i*250;box(s,x,y,217,34,C.white,r[1],1,6);txt(s,a,x+8,y+4,201,26,{size:9,bold:true,color:r[1],align:'center'});if(i<labels.length-1)line(s,x+217,y+17,x+246,y+17,r[1],1.5);});txt(s,r[6],1128,y+9,80,15,{size:7,bold:true,color:r[1],align:'right'});});
 txt(s,'箭头关系：写入与语义检索为 Triggering；结构投影到只读查询、查询到社区索引为 Serving。',221,660,913,15,{size:7,bold:true,color:C.muted,align:'center'});
}

// 4 · Three-way Business Process / Application capability / Assessment crosswalk.
{
 const s=page(3);const heads=[['Business Process · 业务活动',62,272,C.blue],['Application · 支撑能力',354,300,C.teal],['Assessment · 指标',677,540,C.orange]];
 heads.forEach(([v,x,w,c])=>{box(s,x,168,w,31,C.ink,'none',0);txt(s,v,x+9,171,w-18,23,{size:10,bold:true,color:C.white});});
 const rows=[
 ['明确任务与验收目标','会话编排','空闲时长 · 请示频率/回环'],
 ['获取相关项目上下文','上下文访问 · 项目图谱上下文服务','检索召回与排序'],
 ['规划并执行代码变更','会话编排 · 工具与代码执行','计划正确率 · 工具成功率 · 写入去重/无损 · 等待时延'],
 ['验证并评审结果','验证与反馈','验收通过率与回归'],
 ['交付可验收结果','项目图谱上下文服务','提交完整率 · 任务成功率 · 端到端时延/成本'],
 ['沉淀可复用项目知识','项目图谱上下文服务','记忆准确率与拒答'],
 ['整体任务结果','通用 Coding Agent Harness','SWE-bench · Terminal-Bench 等 8 项整体基准']
 ];
 rows.forEach((r,i)=>{const y=203+i*61,fill=i%2?C.white:'#F0F2F3';box(s,62,y,272,57,fill,'none',0);box(s,354,y,300,57,fill,'none',0);box(s,677,y,540,57,fill,'none',0);box(s,62,y,5,57,[C.blue,C.teal,C.blue,C.orange,C.teal,'#7A8798',C.ink][i],'none',0);txt(s,r[0],76,y+4,245,48,{size:11,bold:true});txt(s,r[1],367,y+3,274,49,{size:10,bold:true,color:C.teal});txt(s,r[2],690,y+3,511,49,{size:10,color:C.ink});txt(s,'Serving',323,y+22,54,16,{size:7,bold:true,color:C.muted,align:'center'});txt(s,'Association',633,y+22,53,16,{size:7,bold:true,color:C.muted,align:'center'});});
 box(s,64,642,1152,27,C.paleBlue,'none',0,5);txt(s,'业务阶段 ↔ 指标与应用能力分别由 canonical 模型中的业务映射、Serving 与 Association 关系表达。',76,645,1128,21,{size:10,bold:true,color:C.blue,align:'center'});
}

// 5 · Industry reference flow for Graph RAG indexing and query.
{
 const s=page(4);const nodes=plan.pages[4].pipeline;
 txt(s,'业界参考 · Generic Graph RAG',67,166,420,22,{size:12,bold:true,color:C.blue});
 box(s,65,200,565,32,C.ink,'none',0,6);txt(s,'写入与索引  /  Offline or incremental indexing',79,203,535,25,{size:11,bold:true,color:C.white});
 box(s,650,200,565,32,C.teal,'none',0,6);txt(s,'查询与生成  /  Query time',664,203,535,25,{size:11,bold:true,color:C.white});
 const positions=[[82,262],[364,262],[82,362],[650,262],[932,262],[650,362],[932,362],[791,485]];
 nodes.forEach(([id,name],i)=>{const [x,y]=positions[i],col=i<3?C.blue:(i<7?C.teal:C.orange),sub=['文档 / 代码解析','实体与关系抽取','图结构 / 向量索引','意图识别 / 重写','邻居扩展或向量/词法召回','候选合并并排序','关联片段与证据','带上下文生成'][i];node(s,name,sub,x,y,235,66,col,C.white,11);});
 const links=[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7]];
 links.forEach(([a,b])=>{const [x1,y1]=positions[a],[x2,y2]=positions[b];let sx=x1+235,sy=y1+33,tx=x2,ty=y2+33;if(a===1){sx=x1+118;sy=y1+66;tx=x2+118;ty=y2;}if(a===3||a===5){sx=x1+235;tx=x2;}
   if(a===6){sx=x1+117;sy=y1+66;tx=x2+117;ty=y2;}
   line(s,sx,sy,tx,ty,C.teal,1.8);const mx=(sx+tx)/2,my=(sy+ty)/2;txt(s,'Triggering',mx-40,my-11,80,18,{size:7,bold:true,color:C.teal,align:'center'});
 });
 box(s,80,582,1120,54,C.paleOrange,'none',0,8);txt(s,'图检索能表达实体关系与多跳路径；能否提升任务效果，取决于图质量、召回策略与任务，不代表普遍优于向量 RAG。',96,588,1088,41,{size:12,bold:true,color:C.orange,align:'center'});
}

// 6 · Evidence and measured improvements with caveats, plus expert/user value claims separated.
{
 const s=page(5);const st=plan.pages[5].status;
 const bar=[['已有实测',st.measured,C.teal],['部分证据',st.partial,C.orange],['当前未测',st.notMeasured,'#BFC7D2']];let x=66;for(const [label,n,c]of bar){const w=1148*n/20;box(s,x,171,w-3,31,c,'none',0);txt(s,`${label}  ${n}`,x,174,w-4,25,{size:10,bold:true,color:c==='#BFC7D2'?C.ink:C.white,align:'center'});x+=w;}
 const items=[['94.6 → 98.7','检索 R@1','向量基线 → 重排；R@5 99.4 · MRR 0.997',C.blue],['31 / 31','记忆题集','准确率 100% · 拒答正确率 100%',C.orange],['2.0–2.5s','Graph MCP 读路径','写路径约 1.1s',C.ink],['10 / 10','工具 ON 组','自建小样本，不代表总体 Coding 成功率',C.teal]];
 items.forEach((a,i)=>{const col=i%2,row=Math.floor(i/2),xx=66+col*575,yy=232+row*94;box(s,xx,yy,548,79,C.white,C.rule,1,8);box(s,xx,yy,5,79,a[3],'none',0);txt(s,a[0],xx+17,yy+9,175,34,{size:25,bold:true,color:a[3]});txt(s,a[1],xx+194,yy+8,325,24,{size:13,bold:true});txt(s,a[2],xx+194,yy+34,330,36,{size:9,color:C.muted});});
 box(s,66,428,548,141,C.ink,'none',0,9);txt(s,'价值洞察  /  基于模型结构',82,439,250,21,{size:11,bold:true,color:'#AFC0FF'});txt(s,'专家的项目地图可外化为共同本体与图谱，让 Agent 行为更可查看、校准和追问。',82,466,508,54,{size:15,bold:true,color:C.white});txt(s,'这是设计价值判断；尚无独立量化结果。',82,531,508,23,{size:10,color:'#C5D2E0'});
 box(s,632,428,582,141,C.paleTeal,'none',0,9);txt(s,'关系检索的优势与待证据',649,439,390,21,{size:11,bold:true,color:C.teal});txt(s,'显式关系与图遍历适合多跳任务；目前没有同任务、多跳 Recall 的行业可比数据。',649,466,542,53,{size:14,bold:true});txt(s,'低年资工程师借助本体学习领域知识，是待验证的潜在收益。',649,531,540,24,{size:10,color:C.muted});
 box(s,66,587,1148,61,C.paleOrange,'none',0,8);txt(s,'可比性限制',80,594,110,20,{size:10,bold:true,color:C.orange});txt(s,'8 项整体 Coding / Agent 基准尚未运行；10 题 A/B 的 OFF 组 grep 失败并触发慢回退，工具 −43%、轮次 −39%、token −18% 仅作方向观察。',198,591,999,45,{size:10,bold:true,color:C.ink});
}

// 7 · Federation model as a Registry–Broker over sovereign member graphs.
{
 const s=page(6);box(s,64,183,308,397,C.paleBlue,'none',0,10);txt(s,'成员项目 · 主权数据',82,196,260,23,{size:12,bold:true,color:C.blue});
 node(s,'Member Project Graph A','Data Object',91,244,252,61,C.blue,C.white,11);node(s,'Member Project Graph B','Data Object',91,475,252,61,C.blue,C.white,11);node(s,'Federated Graph Reference','Data Object',91,357,252,61,C.orange,C.white,10);
 line(s,217,305,217,356,C.muted,1.4);txt(s,'Association',184,318,83,15,{size:7,bold:true,color:C.muted,align:'center'});line(s,217,418,217,474,C.muted,1.4);txt(s,'Association',184,436,83,15,{size:7,bold:true,color:C.muted,align:'center'});
 node(s,'Federation Registry–Broker Center','Application Component',454,205,342,58,C.ink,C.white,13);node(s,'Graph MCP Tool Interface','Application Interface',493,300,265,52,C.blue,C.white,11);node(s,'Federation Registry–Broker Service','Application Service',454,393,342,60,C.teal,C.white,12);
 line(s,625,263,625,298,C.blue,1.6);txt(s,'Composition',634,271,81,14,{size:7,bold:true,color:C.blue});line(s,625,352,625,391,C.teal,1.6);txt(s,'Assignment',634,361,76,14,{size:7,bold:true,color:C.teal});
 node(s,'Federation Membership and Grants','Data Object',880,228,318,61,C.blue,C.white,11);line(s,796,421,880,259,C.teal,1.6);txt(s,'Access',824,322,50,14,{size:7,bold:true,color:C.teal});
 // Broker accesses member graphs through the federated MCP boundary, then returns a reference.
 line(s,454,410,343,274,C.orange,1.5);txt(s,'Access',377,326,54,14,{size:7,bold:true,color:C.orange});line(s,454,432,343,505,C.orange,1.5);txt(s,'Access',377,460,54,14,{size:7,bold:true,color:C.orange});line(s,454,421,343,388,C.orange,1.5);txt(s,'Access · returns reference',355,398,104,14,{size:7,bold:true,color:C.orange,align:'center'});
 box(s,880,351,318,153,C.white,C.rule,1,9);txt(s,'Registry–Broker',898,363,282,24,{size:14,bold:true,color:C.ink,align:'center'});txt(s,'中心管理成员、能力与授权元数据。\n跨成员读取先检查授权，再经项目 MCP 读穿。',900,395,278,66,{size:11,color:C.muted,align:'center'});txt(s,'中心返回图谱引用，成员内容不合并。',900,470,278,22,{size:9,bold:true,color:C.orange,align:'center'});
 box(s,65,600,1150,45,C.paleTeal,'none',0,7);txt(s,'成员图保持自治 · 中心只管联邦元数据 · 默认拒绝 · 授权后按引用读取',82,606,1115,33,{size:13,bold:true,color:C.teal,align:'center'});
}

// 8 · Twenty metric rows, tied back to canonical business stages and present evidence.
{
 const s=page(7),data=plan.pages[7].metrics,st={measured:'实测',partial:'部分',not_measured:'未测'},colors={measured:C.teal,partial:C.orange,not_measured:C.muted};
 const activities={ 'aos-as-idle':'明确任务','aos-as-hitl':'明确任务','aos-as-plan':'规划执行','aos-as-retrieve':'获取上下文','aos-as-tool':'规划执行','aos-as-write':'规划执行','aos-as-verify':'验证评审','aos-as-wait':'规划执行','aos-as-commit':'结果交付','aos-as-memory':'知识沉淀','aos-as-success':'结果交付','aos-as-e2e':'结果交付','aos-as-swebench':'整体任务','aos-as-sweverified':'整体任务','aos-as-terminalbench':'整体任务','aos-as-codegen':'整体任务','aos-as-livecodebench':'整体任务','aos-as-gaia':'整体任务','aos-as-taubench':'整体任务','aos-as-agentbench':'整体任务'};
 const cap={ '明确任务':'会话编排','获取上下文':'上下文访问 / 图谱服务','规划执行':'会话编排 / 工具执行','验证评审':'验证与反馈','结果交付':'图谱服务','知识沉淀':'图谱服务','整体任务':'Coding Agent Harness'};
 const draw=(items,x)=>{const w=558;box(s,x,167,w,28,C.ink,'none',0);txt(s,'# 业务阶段 · 指标',x+7,169,283,22,{size:10,bold:true,color:C.white});txt(s,'应用能力 / 现有证据',x+292,169,259,22,{size:10,bold:true,color:C.white});items.forEach((m,i)=>{const y=197+i*42;if(i%2===0)box(s,x,y,w,41,C.white,'none',0);const a=activities[m.kgId];txt(s,String(m.n).padStart(2,'0'),x+5,y+1,24,18,{size:9,bold:true,color:C.muted});txt(s,a,x+31,y+1,95,19,{size:9,bold:true,color:C.blue});txt(s,m.name,x+126,y+1,166,19,{size:9,bold:true});txt(s,`${cap[a]} · ${st[m.status]}`,x+297,y+1,252,18,{size:9,bold:true,color:colors[m.status]});txt(s,m.result,x+297,y+20,253,19,{size:8,color:C.muted});line(s,x,y+41,x+w,y+41,C.rule,.5);});};
 draw(data.slice(0,10),63);draw(data.slice(10),656);txt(s,'业界分数只作测量口径背景；任务集、模型、Harness 或评测方法不同，不作直接优劣比较。',77,633,1127,26,{size:10,bold:true,color:C.muted,align:'center'});
}

// 9 · Industry practice supporting expert-led Agent work; separate evidence from interpretation.
{
 const s=page(8,true);txt(s,'OPENAI · HARNESS ENGINEERING',67,169,484,21,{size:11,bold:true,color:'#AFC0FF'});
 const stats=[['3','工程师'],['5 个月','持续迭代'],['≈ 100 万','代码行'],['0','手写代码']];stats.forEach((a,i)=>{const x=67+i*287;txt(s,a[0],x,215,250,55,{size:34,bold:true,color:[C.blue,C.teal,C.orange,'#9DB1FF'][i]});txt(s,a[1],x,270,250,25,{size:12,bold:true,color:C.white});if(i<3)line(s,x+260,210,x+260,307,'#3B5067',1);});
 box(s,68,333,1144,117,'#1A2E44','#3B5067',1,10);txt(s,'文章报告的工程做法',87,346,290,22,{size:12,bold:true,color:'#9DB1FF'});const acts=['设计开发环境','定义意图与架构','设置自动验收','用反馈循环修正'];acts.forEach((a,i)=>{const x=89+i*273;box(s,x,385,246,42,'#243A53','#50657B',1,7);txt(s,a,x+8,391,230,28,{size:12,bold:true,color:C.white,align:'center'});if(i<3)txt(s,'›',x+246,390,27,24,{size:19,bold:true,color:'#9DB1FF',align:'center'});});
 box(s,68,481,550,144,'#20354C','#465B72',1,10);txt(s,'我们的解释',86,495,180,21,{size:11,bold:true,color:'#FFC59E'});txt(s,'专家掌握项目地图，才能检查 Agent 是否走在正确路径上。',86,523,512,47,{size:18,bold:true,color:C.white});txt(s,'把地图外化为本体和图谱，专家可以更深入地指导和校准。',86,580,512,28,{size:11,color:'#CBD5E1'});
 box(s,650,481,562,144,'#20354C','#465B72',1,10);txt(s,'待验证的扩展收益',668,495,220,21,{size:11,bold:true,color:'#79CBB6'});txt(s,'图谱给工程师一个可学习的领域模型；低年资成员可能借此逐步成长。',668,523,520,49,{size:15,bold:true,color:C.white});txt(s,'当前没有学习成效数据，作为待验证假设。',668,581,520,25,{size:10,color:'#CBD5E1'});
 txt(s,'案例数字为 OpenAI 团队自述；“专家脑中的图”是我们的解释，不是来源原句。',117,646,1040,20,{size:9,color:'#AEBBC8',align:'center'});
}

await fs.mkdir(TMP,{recursive:true});await fs.mkdir(path.dirname(OUT),{recursive:true});
const candidate=path.join(TMP,'candidate.pptx');await (await PresentationFile.exportPptx(ppt)).save(candidate);
for(let i=0;i<ppt.slides.items.length;i++){const slide=ppt.slides.items[i],n=String(i+1).padStart(2,'0');const png=await ppt.export({slide,format:'png',scale:1});await fs.writeFile(path.join(TMP,`slide-${n}.png`),new Uint8Array(await png.arrayBuffer()));const layout=await slide.export({format:'layout'});await fs.writeFile(path.join(TMP,`slide-${n}.layout.json`),await layout.text());}
const receipt=path.join(TMP,'validation-v5-final-aligned.json');
const result=await finalizePresentation({workspaceDir:ROOT,candidatePath:candidate,finalPath:OUT,pythonExecutable:RUNTIME_PYTHON,integrityValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--validate-bullet-geometry','--validate-heading-fit'],explicitTotalSlideCount:9,fontPolicy:{basis:'design',families:[FONT,'Microsoft YaHei']},verifyArtifactToolImport:true,receiptPath:receipt});
console.log(JSON.stringify({output:OUT,slides:ppt.slides.items.length,finalized:true,validation:result?.status||result?.ok||'completed'},null,2));
