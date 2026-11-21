/* Product selection and creation onboarding. Local prototype data only. */
function createCreationFlow(ctx){
 'use strict';
 const {state,products,product,task,getUI,esc,icon,btn,imageSrc,freshDraft,purposeName,openModal,closeModal,render,persist,toast,saveContext,taskChanged}=ctx;
 const purposes=['main','detail','video'];
 let setup=null,entry=null,uploadToken=0;
 const copy=v=>JSON.parse(JSON.stringify(v));
 const ui=()=>getUI();
 const uid=prefix=>prefix+(crypto.randomUUID?.()||Date.now().toString(36));
 const selectedProducts=()=>products.filter(p=>setup.products.includes(p.id));
 function suggestedName(){const p=selectedProducts();return p.length?`${p[0].name}${p.length>1?' 等'+p.length+'件商品':''} · ${setup.purposes.length===1?purposeName(setup.purposes[0]):'素材制作'} · ${new Date().getMonth()+1}月${new Date().getDate()}日`:'选择商品后自动命名';}
 function decorate(cls){document.querySelector('.overlay .modal')?.classList.add('creation-dialog',cls);}
 function start(pid,mode='new'){
  saveContext();
  const menu=document.querySelector('.task-switch-menu[open]');if(menu)menu.open=false;
  setup={mode,taskId:task().id,products:pid?[pid]:[],purposes:['main'],query:'',name:''};
  showSetup();
 }
 function rows(){
  const q=setup.query.trim().toLowerCase();
  const available=products.filter(p=>setup.mode!=='add'||!task().products.includes(p.id));
  const list=available.filter(p=>`${p.name} ${p.sku} ${p.color}`.toLowerCase().includes(q));
  return list.length?list.map(p=>`<label class="creation-product-option"><input type="checkbox" name="task-product" value="${p.id}" ${setup.products.includes(p.id)?'checked':''}><img src="${imageSrc(p.image)}" alt=""><span><strong>${esc(p.name)}</strong><small>${esc(p.sku)} · ${esc(p.category)}</small></span>${icon('check')}</label>`).join(''):`<p class="creation-no-results">${available.length?'没有找到匹配商品，可换个关键词或添加新商品。':'商品库中的商品均已加入本次制作，可添加新商品。'}</p>`;
 }
 function showSetup(){
  if(!setup)return;
  const adding=setup.mode==='add';
  openModal(adding?'添加商品到本次制作':'新建制作',`<p class="creation-intro">${adding?`目标：${esc(task().name)}。原有商品与草稿保留。`:'选好商品和制作内容，即可进入编辑。'}</p><section class="creation-section"><div class="creation-section-heading"><h3>${adding?'选择要加入的商品':'1. 选择商品'}</h3><button class="text-button" data-action="creation-add-product">${icon('plus')}添加新商品</button></div><div class="search creation-search">${icon('search')}<input id="creation-product-search" aria-label="搜索可选商品" placeholder="搜索商品名称或 SKU" value="${esc(setup.query)}" data-autofocus></div><div class="creation-products" role="group" aria-label="可选商品">${rows()}</div><p class="creation-selection" id="creation-selection" role="status"></p></section>${adding?'':`<section class="creation-section"><h3>2. 选择制作内容 <small>可多选</small></h3><div class="creation-purpose-options">${purposes.map(p=>`<label><input type="checkbox" name="creation-purpose" value="${p}" ${setup.purposes.includes(p)?'checked':''}><span>${icon(p==='video'?'video':'image')}${purposeName(p)}</span></label>`).join('')}</div><p class="creation-scope-note">交付清单按本次选择整理，进入后可继续调整制作。</p></section><details class="creation-naming" ${setup.name?'open':''}><summary>制作名称 <span id="creation-auto-name">${esc(setup.name||suggestedName())}</span></summary><label class="sr-only" for="new-task-name">制作名称（选填）</label><input id="new-task-name" maxlength="80" value="${esc(setup.name)}" placeholder="留空自动命名，可稍后修改"></details>`}<div class="field-error" id="task-error" role="alert"></div>`,btn('取消','close-modal')+btn(adding?'添加并继续制作':'进入制作',adding?'creation-confirm-add':'create-task','primary','arrow'));
  decorate('creation-setup');updateSelection();
 }
 function updateSelection(){
  const selected=selectedProducts(),line=document.querySelector('#creation-selection');
  if(line)line.textContent=selected.length?`已选 ${selected.length} 件：${selected.map(p=>p.name).join('、')}${setup.mode==='add'?'；将新增 '+selected.length*(task().purposes?.length||3)+' 个交付位置。':''}`:'尚未选择商品';
  const name=document.querySelector('#creation-auto-name');if(name)name.textContent=setup.name||suggestedName();
 }
 function fail(id,text,focus){const el=document.getElementById(id);if(el)el.textContent=text;document.querySelector(focus)?.focus();}
 function validate(){
  if(!setup.products.length){fail('task-error','请先选择至少一件商品。','#creation-product-search');return false;}
  if(setup.mode==='new'&&!setup.purposes.length){fail('task-error','请选择至少一种制作内容。','[name="creation-purpose"]');return false;}
  return true;
 }
 function create(){
  if(!setup||setup.mode!=='new'||!validate())return;
  const ids=setup.products.filter(id=>products.some(p=>p.id===id)),goals=[...setup.purposes];
  if(!ids.length)return;
  const first=goals[0],d={...freshDraft(ids[0]),purpose:first,media:first==='video'?'video':'image',...(first==='video'?{ratio:'9:16',quality:'1080P'}:{})};
  const name=setup.name.trim()||suggestedName().slice(0,80),id=uid('t-');
  state.tasks.push({companyId:ctx.company.id,ownerId:ctx.company.member().id,id,name,products:ids,purposes:goals,draft:d,assets:[],lastOpenedAt:Date.now(),workspace:{view:'page',node:'g1'},nodes:[{id:'g1',x:345,y:70,draft:copy(d)}]});
  state.task=id;ctx.company.initialize();ctx.production.ensure(task());taskChanged();state.workspaceView='page';
  Object.assign(ui(),{page:'studio',view:'page',node:'g1',filter:'all',tab:'all',scope:'current',inspector:false,sourcesOpen:false,promptOpen:false,advanced:false,selected:[],mobile:false,fitPending:true});
  setup=null;persist();closeModal();render();document.querySelector('#prompt')?.focus({preventScroll:true});toast('已进入新的制作，商品资料已带入，填写提示词即可生成。');
 }
 function confirmAdd(){
  if(!setup||setup.mode!=='add'||setup.taskId!==task().id||!validate())return;
  const ids=setup.products.filter(id=>products.some(p=>p.id===id)&&!task().products.includes(id));
  task().products.push(...ids);for(const pid of ids)for(const purpose of task().purposes||['main','detail','video'])ctx.production.ensurePurpose(task(),pid,purpose);setup=null;persist();closeModal();render();if(ids.length)ctx.selectProduct(ids[0]);toast(`已将 ${ids.length} 件商品加入「${task().name}」。`);
 }
 function newProduct(fromSetup=false){
  uploadToken++;
  entry={fromSetup,photo:'',name:'',sku:'',spec:'',category:'鞋服',confirmed:false,uploading:false};
  showProduct();
 }
 function showProduct(){
  openModal('添加新商品',`<p class="creation-intro">${entry.fromSetup?'保存后返回选择，并自动选中这件商品。':'保存商品资料，后续制作可重复使用。'}</p><label class="product-upload" for="product-photo"><span id="product-photo-preview">${icon('upload')}</span><span><strong id="product-photo-label">上传商品实拍</strong><small>JPG、PNG 或 WebP，单张不超过 10 MB</small></span><input id="product-photo" type="file" accept="image/jpeg,image/png,image/webp"></label><div class="creation-product-fields"><div><label for="product-name">商品名称 <span>*</span></label><input id="product-name" maxlength="80" placeholder="例如：轻行低帮运动鞋" data-autofocus></div><div class="form-grid"><div><label for="product-sku">SKU 编码 <span>*</span></label><input id="product-sku" maxlength="60" placeholder="例如 NEW-001"></div><div><label for="product-category">商品品类</label><select id="product-category"><option>鞋服</option><option>美妆个护</option></select></div></div><div><label for="product-spec">颜色 / 规格等已知信息 <span>*</span></label><textarea id="product-spec" maxlength="500" placeholder="例如：米白色、低帮、36–44 码。只填写已确认的信息。"></textarea></div><label class="checkbox-label"><input id="product-confirmed" type="checkbox">我已核对实拍和上述商品信息，可作为本次制作依据。</label></div><div class="field-error" id="product-error" role="alert"></div>`,btn(entry.fromSetup?'返回选择':'取消',entry.fromSetup?'creation-back':'close-modal')+btn(entry.fromSetup?'保存并选中':'保存商品','save-product',entry.fromSetup?'primary':'')+(entry.fromSetup?'':btn('保存并开始制作','save-product-create','primary','arrow')));
  decorate('creation-product-form');
 }
 async function photo(input){
  if(!entry||!input.files.length)return;
  const file=input.files[0],token=++uploadToken,current=entry;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024){fail('product-error','请选择 10 MB 以内的 JPG、PNG 或 WebP 实拍。','#product-photo');input.value='';return;}
  current.uploading=true;current.photo='';document.querySelector('#product-photo-label').textContent='正在处理实拍…';
  try{
   const url=URL.createObjectURL(file),img=new Image();
   try{img.src=url;await img.decode();}finally{URL.revokeObjectURL(url);}
   const c=document.createElement('canvas'),scale=Math.min(1,1200/Math.max(img.naturalWidth,img.naturalHeight));c.width=Math.max(1,Math.round(img.naturalWidth*scale));c.height=Math.max(1,Math.round(img.naturalHeight*scale));
   const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(img,0,0,c.width,c.height);
   if(token!==uploadToken||entry!==current)return;
   current.photo=c.toDataURL('image/jpeg',.85);document.querySelector('#product-photo-preview').innerHTML=`<img src="${current.photo}" alt="新商品实拍预览">`;document.querySelector('#product-photo-label').textContent='已添加实拍 · 点击更换';document.querySelector('#product-error').textContent='';
  }catch{if(token===uploadToken&&entry===current){current.photo='';fail('product-error','无法读取这张图片，请选择有效的商品实拍。','#product-photo');document.querySelector('#product-photo-label').textContent='重新上传商品实拍';}}
  finally{current.uploading=false;}
 }
 function captureProduct(){
  if(!entry)return;for(const field of ['name','sku','spec','category'])entry[field]=document.querySelector('#product-'+field)?.value||'';
  entry.confirmed=!!document.querySelector('#product-confirmed')?.checked;
 }
 function saveProduct(andCreate=false){
  if(!entry)return;captureProduct();
  if(entry.uploading){fail('product-error','实拍还在处理中，请稍候。','#product-photo');return;}
  if(!entry.photo){fail('product-error','请先上传商品实拍。','#product-photo');return;}
  const name=entry.name.trim(),sku=entry.sku.trim(),spec=entry.spec.trim();
  if(!name||!sku||!spec){fail('product-error','请填写商品名称、SKU 和已确认的颜色 / 规格。',!name?'#product-name':!sku?'#product-sku':'#product-spec');return;}
  if(products.some(p=>p.sku.toLowerCase()===sku.toLowerCase())){fail('product-error','这个 SKU 已存在，请选择已有商品或使用不同编码。','#product-sku');return;}
  if(!entry.confirmed){fail('product-error','请核对并确认商品实拍和已知信息。','#product-confirmed');return;}
  const id=uid('product-'),p={id,name,sku,category:entry.category,color:spec,spec:'用户已确认',image:'product-image:'+id,source:'product-image:'+id,imageData:entry.photo,facts:[spec],evidence:'用户提供的实拍与已确认信息',template:entry.category==='美妆个护'?'包装展示 · 柔光影棚':'商品展示 · 简约棚拍',custom:true};
  const custom=[...(state.products||[]),p];
  // Verify persistence before reporting a successful save; avoid a half-created product.
  try{localStorage.setItem(ctx.storageKey,JSON.stringify({...state,products:custom},(key,value)=>key==='uploads'?[]:value));}
  catch{fail('product-error','本机存储空间不足，商品尚未保存，请清理空间后重试。','#product-name');return;}
  p.companyId=ctx.company.id;p.ownerId=ctx.company.member().id;products.push(p);state.products=custom;const from=entry.fromSetup;entry=null;uploadToken++;
  persist();
  if(from&&setup){setup.products.push(id);setup.query='';showSetup();toast('商品已保存并选中，继续选择制作内容。');}
  else if(andCreate){render();start(id);}
  else{ui().page='products';ui().category='all';ui().search='';closeModal();render();document.querySelector(`[data-product="${id}"] [data-action="use-product"]`)?.focus();toast('商品已保存到本机商品库，可随时用于制作。');}
 }
 function rename(){openModal('修改制作名称',`<label for="rename-task">制作名称</label><input id="rename-task" value="${esc(task().name)}" maxlength="80" data-autofocus><div class="field-error" id="rename-error" role="alert"></div>`,btn('取消','close-modal')+btn('保存名称','creation-save-name','primary'));}
 function handleAction(action,id){
  switch(action){
   case 'new-task':start();return true;
   case 'use-product':start(id);return true;
   case 'create-task':create();return true;
   case 'creation-add-current':start(null,'add');return true;
   case 'creation-confirm-add':confirmAdd();return true;
   case 'new-product':newProduct();return true;
   case 'creation-add-product':newProduct(true);return true;
   case 'save-product':saveProduct();return true;
   case 'save-product-create':saveProduct(true);return true;
   case 'creation-back':entry=null;uploadToken++;showSetup();return true;
   case 'creation-rename':rename();return true;
   case 'creation-save-name':{const name=document.querySelector('#rename-task').value.trim();if(!name){fail('rename-error','请填写制作名称。','#rename-task');return true;}task().name=name;persist();closeModal();render();toast('制作名称已更新。');return true;}
   default:return false;
  }
 }
 function handleInput(el){
  if(el.id==='creation-product-search'&&setup){setup.query=el.value;document.querySelector('.creation-products').innerHTML=rows();return true;}
  if(el.id==='new-task-name'&&setup){setup.name=el.value;updateSelection();return true;}
  return false;
 }
 function handleChange(el){
  if(el.name==='task-product'&&setup){setup.products=setup.products.filter(id=>id!==el.value);if(el.checked)setup.products.push(el.value);updateSelection();document.querySelector('#task-error').textContent='';return true;}
  if(el.name==='creation-purpose'&&setup){setup.purposes=purposes.filter(p=>p===el.value?el.checked:setup.purposes.includes(p));updateSelection();document.querySelector('#task-error').textContent='';return true;}
  if(el.id==='product-photo'){photo(el);return true;}
  return false;
 }
 function dismiss(){if(entry?.fromSetup&&setup){entry=null;uploadToken++;showSetup();return true;}return false;}
 function close(){setup=null;entry=null;uploadToken++;}
 return {handleAction,handleInput,handleChange,dismiss,close};
}
