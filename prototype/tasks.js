/* Task context connects creation, review and delivery; all data is local mock state. */
function createTaskFlow({production,state,getUI,task,product,taskPurposes,esc,icon,btn,heading,empty,render,persist,syncDraft,closeModal,toast,taskChanged,isGenerating}){
 const ui=()=>getUI();

 function stats(t=task()){
  const purposes=taskPurposes(t);const positions=production.slots(t);
  const valid=a=>a.status==='approved'&&t.products.includes(a.product)&&purposes.includes(a.purpose)&&a.media===(a.purpose==='video'?'video':'image');
  const ready=positions.filter(r=>r.asset).length;
  const unpicked=positions.filter(r=>!r.asset&&t.assets.some(a=>valid(a)&&production.matches(a,r)&&!Object.values(t.deliverySelections).includes(a.id))).length;
  const running=(isGenerating(t.id)?1:0)+Object.values(t.batches||{}).flatMap(b=>b.items).flatMap(i=>i.outputs).filter(o=>['queued','running'].includes(o.status)).length;
  return {ready,total:positions.length,pending:t.assets.filter(a=>a.status==='pending').length,unpicked,running};
 }
 function saveContext(){syncDraft();task().workspace={view:ui().view,node:ui().node};task().lastOpenedAt=Date.now();persist();}
 function recent(){return state.tasks.slice().sort((a,b)=>(b.lastOpenedAt||0)-(a.lastOpenedAt||0));}
 function switchTask(id,continueWork=false){
  const target=state.tasks.find(t=>t.id===id);if(!target)return;
  const before=task(),old=stats(before);saveContext();closeModal();state.task=id;taskChanged();
  Object.assign(ui(),{page:continueWork||ui().page==='tasks'?'studio':ui().page,view:target.workspace?.view||'page',node:target.workspace?.node||target.nodes.find(n=>n.draft.product===target.draft.product&&n.draft.purpose===target.draft.purpose)?.id||target.nodes[0].id,mobile:false,inspector:false,connecting:null,fitPending:true,scope:'current',filter:'all',tab:'all',selected:[],reviewFilter:'pending',deliveryView:'list',deliverySearch:'',deliveryProduct:'all',deliveryMedia:'all',intentUndo:null});
  state.workspaceView=ui().view;target.lastOpenedAt=Date.now();persist();render();
  document.querySelector('.task-switch-menu > summary')?.focus({preventScroll:true});toast(`已切换至「${target.name}」${before.id!==id&&old.running?'；原任务的制作继续进行。':'。'}`);
 }
 function location(){return `<div class="task-location" aria-label="当前生产任务"><button class="task-all-link" data-action="manage-tasks" aria-label="查看全部任务">${icon('arrow')}<span>全部任务</span></button><span class="task-location-divider">/</span><details class="task-switch-menu"><summary aria-label="切换任务，当前：${esc(task().name)}" title="${esc(task().name)}"><span>${esc(task().name)}</span>${icon('down')}</summary><div class="task-switch-popover"><span class="task-switch-label">最近任务</span>${recent().slice(0,6).map(t=>`<button data-action="flow-switch" data-id="${esc(t.id)}" ${t.id===task().id?'aria-current="true"':''}><span>${esc(t.name)}</span>${t.id===task().id?icon('check'):''}</button>`).join('')}<div class="task-switch-footer">${btn('查看全部','flow-all','sm')}</div></div></details>${ui().page==='studio'?`<button class="task-name-edit" data-action="creation-rename" aria-label="修改制作名称" title="修改制作名称">${icon('settings')}</button>`:''}</div>`;}
 function next(){const s=stats();if(s.pending)return {label:`待审核 ${s.pending} 份`,action:'flow-review',glyph:'shield'};if(s.unpicked)return{label:'选择交付版本',action:'flow-delivery',glyph:'box'};if(s.ready===s.total&&s.total)return{label:'核对并导出',action:'flow-delivery',glyph:'download'};if(s.ready)return{label:`继续补齐 ${s.total-s.ready} 项`,action:'flow-delivery',glyph:'arrow'};if(s.running)return{label:'查看制作进度',action:'flow-return',glyph:'clock'};return{label:'填写提示词',action:'flow-start',glyph:'arrow'};}
 function nextButton(){const n=next();return `<button class="task-next" data-action="${n.action}">${icon(n.glyph)}<span>${n.label}</span>${icon('chevron')}</button>`;}
 function titleBar(){return location()+`<button class="task-return" data-action="flow-return">${icon('arrow')}<span>返回此任务创作</span></button>`;}
 function taskPage(){
  const q=(ui().taskSearch||'').trim().toLowerCase(),list=recent().filter(t=>`${t.name} ${t.products.map(p=>product(p).name+' '+product(p).sku).join(' ')}`.toLowerCase().includes(q));
  return heading('全部制作任务','继续已有制作，或选好商品开启一次新制作。',btn('返回当前创作','flow-return')+btn('新建制作','new-task','primary','plus'))+`<div class="task-list-toolbar"><div class="search">${icon('search')}<input id="task-search" aria-label="搜索任务名称、商品或 SKU" value="${esc(ui().taskSearch||'')}" placeholder="搜索任务名称、商品或 SKU"></div><span role="status">${list.length} 个任务</span></div><div class="task-list">${list.map(t=>{const s=stats(t),time=t.lastOpenedAt?new Date(t.lastOpenedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'示例任务';return `<article class="task-list-row" data-task="${esc(t.id)}"><div class="task-list-identity"><div><h2>${esc(t.name)}</h2>${t.id===task().id?'<span class="task-current">当前任务</span>':''}</div><p>${t.products.length} 个 SKU · 最近使用 ${time}</p></div><div class="task-list-status">${s.running?`<span>制作中 ${s.running}</span>`:s.pending?`<button data-action="flow-task-review" data-id="${esc(t.id)}">待审核 ${s.pending} 份${icon('chevron')}</button>`:'<span>暂无待审核</span>'}<span>交付 ${s.ready}/${s.total}</span></div><button class="btn sm" data-action="flow-continue" data-id="${esc(t.id)}">继续创作${icon('arrow')}</button></article>`;}).join('')}</div>${!list.length?empty('没有找到匹配的任务','换个关键词，或新建制作。','清除搜索','flow-clear'):''}`;
 }
 function go(page){saveContext();closeModal();ui().page=page;ui().mobile=false;if(page==='review')ui().reviewFilter='pending';if(page==='assets'){ui().deliveryView='list';ui().deliverySearch='';ui().deliveryProduct='all';ui().deliveryMedia='all';}render();const title=document.querySelector('#main h1');if(title){title.tabIndex=-1;title.focus({preventScroll:true});}}
 function handleAction(action,id){
  switch(action){
   case 'manage-tasks':case 'flow-all':saveContext();closeModal();ui().page='tasks';ui().mobile=false;ui().taskSearch='';render();document.querySelector('#task-search')?.focus({preventScroll:true});return true;
   case 'flow-switch':switchTask(id);return true;
   case 'flow-continue':switchTask(id,true);return true;
   case 'flow-task-review':switchTask(id,true);go('review');return true;
   case 'flow-return':go('studio');return true;
   case 'flow-start':go('studio');if(ui().view==='canvas')document.querySelector(`[data-action="edit-node"][data-id="${ui().node}"]`)?.click();else if(ui().view==='batch')document.querySelector('.batch-inspector textarea')?.focus({preventScroll:true});else document.querySelector('#prompt')?.focus({preventScroll:true});return true;
   case 'flow-review':go('review');return true;
   case 'flow-delivery':go('assets');return true;
   case 'flow-clear':ui().taskSearch='';render();document.querySelector('#task-search')?.focus();return true;
   default:return false;
  }
 }
 function handleInput(target){if(target.id!=='task-search')return false;const pos=target.selectionStart;ui().taskSearch=target.value;render();const input=document.querySelector('#task-search');input.focus({preventScroll:true});input.setSelectionRange(pos,pos);return true;}
 function handleKeydown(event){const menu=document.querySelector('.task-switch-menu[open]');if(!menu||event.key!=='Escape')return false;event.preventDefault();menu.open=false;menu.querySelector('summary').focus();return true;}
 return {stats,saveContext,switchTask,location,nextButton,titleBar,taskPage,handleAction,handleInput,handleKeydown};
}
