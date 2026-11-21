/* Company records for the local prototype. These checks are not server authentication. */
window.createCompanyDomain = function ({ state, products, product, canUse, freshDraft, basePrompt }) {
  const copy = x => JSON.parse(JSON.stringify(x));
  const uid = prefix => prefix + (crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));
  const id = 'demo-company';
  const roles = { admin: '管理员', designer: '设计师', reviewer: '审核员', viewer: '只读成员' };
  const rights = { admin: ['manage','create','review','adopt','download'], designer: ['create','adopt','download'], reviewer: ['review','download'], viewer: [] };
  const isNew = !state.company;
  if (!state.company) state.company = { id, currentMember: 'm-lin', members: [
    { id:'m-lin',name:'林小满',role:'admin',active:true,download:true },
    { id:'m-chen',name:'陈言',role:'designer',active:true,download:true },
    { id:'m-zhou',name:'周晴',role:'reviewer',active:true,download:true },
    { id:'m-guest',name:'访客',role:'viewer',active:true,download:false }
  ], templates: [], audit: [] };
  const data = state.company;
  data.productOwners ||= {};
  data.audit ||= [];
  const member = () => data.members.find(m => m.id === data.currentMember);
  const can = permission => !!member()?.active && rights[member().role]?.includes(permission) && (permission !== 'download' || member().download);
  const requireRight = permission => { if (!can(permission)) throw new Error('当前身份没有此操作权限。'); };
  const audit = (action, target, detail='') => { data.audit.unshift({id:uid('log-'),at:Date.now(),member:member()?.id,name:member()?.name,action,target,detail}); data.audit=data.audit.slice(0,300); };
  if (!data.templates.length && isNew) {
    for (const p of products.filter(p=>!p.custom)) for (const purpose of ['main','detail','video','clip']) {
      if (data.templates.some(t=>t.versions[0].category===p.category&&t.versions[0].purpose===purpose)) continue;
      const video=['video','clip'].includes(purpose), fields={name:purpose==='clip'?`${p.category} · 视频片段`:video?`${p.category} · 商品视频`:purpose==='detail'?`${p.category} · 细节展示`:p.template,category:p.category,media:video?'video':'image',purpose,prompt:video?'以{{商品名称}}实拍为依据，先展示全貌，再平稳过渡至已确认细节，保持{{商品事实}}。':'以{{商品名称}}实拍为主体，保持{{商品事实}}。简洁暖灰背景，柔和自然光，突出商品真实轮廓与细节。',model:'公司默认模型',ratio:video?'9:16':'1:1',quality:video?'1080P':'2048 × 2048',count:video?1:2,duration:12,rules:{product:true,person:true,scene:true}};
      data.templates.push({id:uid('tpl-'),active:true,draft:null,versions:[{...fields,version:1,publishedAt:Date.now(),publisher:'林小满'}]});
    }
  }
  function latest(t) { return t?.versions?.at(-1); }
  function options(p,media,purpose) { return data.templates.filter(t=>t.active&&latest(t)?.category===p.category&&(!media||latest(t).media===media)&&(!purpose||latest(t).purpose===purpose)); }
  function bindDraft(d) {
    if(d.templateId){const existing=data.templates.find(t=>t.id===d.templateId)?.versions.find(v=>v.version===d.templateVersion);if(!existing||existing.category===product(d.product).category&&existing.media===d.media&&existing.purpose===d.purpose)return;delete d.templateId;delete d.templateVersion;}
    const t=options(product(d.product),d.media,d.purpose)[0];
    if(t){d.templateId=t.id;d.templateVersion=latest(t).version;d.template=latest(t).name;}
  }
  function apply(d,templateId,version) {
    const t=data.templates.find(t=>t.id===templateId), v=t?.versions.find(v=>v.version===Number(version));
    if(!t?.active||!v)throw new Error('模板已停用或版本不存在，请重新选择。');
    if(v.category!==product(d.product).category||v.media!==d.media||v.purpose!==d.purpose)throw new Error('模板品类、媒体或用途与当前制作不匹配。');
    const p=product(d.product);
    Object.assign(d,{templateId:t.id,templateVersion:v.version,template:v.name,prompt:v.prompt.replaceAll('{{商品名称}}',p.name).replaceAll('{{SKU}}',p.sku).replaceAll('{{商品事实}}',p.facts.join('、')),model:v.model,ratio:v.ratio,quality:v.quality,count:v.count,duration:String(v.duration),shots:undefined,shotsConfirmed:false,shotSignature:null});
  }
  function draftProblem(d) {
    bindDraft(d);
    const t=data.templates.find(t=>t.id===d.templateId),v=t?.versions.find(v=>v.version===d.templateVersion);
    if(!t?.active||!v)return '当前模板已停用或尚未发布，请选择可用公司模板。';
    if(v.media!==d.media||v.purpose!==d.purpose||v.category!==product(d.product).category)return '模板不适用于当前商品、媒体或用途，请重新选择模板。';
    return '';
  }
  function freeze(d) {
    const problem=draftProblem(d);if(problem)throw new Error(problem);
    const t=data.templates.find(t=>t.id===d.templateId),v=t.versions.find(v=>v.version===d.templateVersion);
    d.templateSnapshot=copy(v);d.rulesSnapshot=copy(v.rules);d.creatorId=member().id;d.creatorName=member().name;
    d.referenceSnapshots=(d.references||[]).map(ref=>{const current=state.tasks.find(t=>t.id===state.task&&t.companyId===id),local=ref.startsWith('result:')?current?.assets.find(a=>a.id===ref.slice(7)&&a.companyId===id):null;const source=resolve(ref)||(local?{task:current,asset:local}:null);return source?{ref,taskId:source.task.id,assetId:source.asset.id,version:source.asset.version,sku:product(source.asset.product).sku}:null;}).filter(Boolean);
    return d;
  }
  function validateTemplate(d) {
    if(!d.name?.trim()||!d.prompt?.trim())return '请填写模板名称和默认提示词。';
    if(d.name.length>60||d.prompt.length>3000)return '名称最多 60 字，提示词最多 3000 字。';
    if(!['鞋服','美妆个护','家居日用','数码配件'].includes(d.category))return '请选择有效品类。';
    if(!['image','video'].includes(d.media)||!(d.media==='image'?['main','detail']:['video','clip']).includes(d.purpose))return '媒体和用途不匹配。';
    if(!['公司默认模型','高保真模型 · 演示','高保真图片模型 · 演示','标准视频模型 · 演示'].includes(d.model))return '请选择可用模型。';
    if(d.media==='video'?d.model.includes('高保真'):d.model.includes('视频'))return '模型和媒体不匹配。';
    if(!['1:1','3:4','9:16','16:9'].includes(d.ratio)||!(d.media==='video'?['1080P']:['1024 × 1024','2048 × 2048','4096 × 4096']).includes(d.quality))return '比例或清晰度不受支持。';
    if(!Number.isInteger(+d.count)||+d.count<1||+d.count>6)return '数量须为 1–6 的整数。';
    if(d.media==='video'&&![6,12,15].includes(+d.duration))return '视频总时长须为 6、12 或 15 秒。';
    if(!d.rules?.product)return '商品一致性为必检规则。';return '';
  }
  function saveTemplate(templateId,fields,publish=false) {
    requireRight('manage');const problem=validateTemplate(fields);if(problem)throw new Error(problem);
    let t=data.templates.find(t=>t.id===templateId);if(!t){t={id:uid('tpl-'),active:false,draft:null,versions:[]};data.templates.unshift(t);}
    t.draft=copy({...fields,name:fields.name.trim(),count:+fields.count,duration:+fields.duration});
    if(publish){t.versions.push({...copy(t.draft),version:(latest(t)?.version||0)+1,publishedAt:Date.now(),publisher:member().name});t.active=true;t.draft=null;}
    audit(publish?'发布模板':'保存模板草稿',t.id,publish?'V'+latest(t).version:fields.name);return t;
  }
  function toggleTemplate(templateId){requireRight('manage');const t=data.templates.find(t=>t.id===templateId);if(!latest(t))throw new Error('请先发布模板。');t.active=!t.active;audit(t.active?'启用模板':'停用模板',t.id);return t;}
  function switchMember(mid){const next=data.members.find(m=>m.id===mid&&m.active);if(!next)throw new Error('该成员已停用，不能进入。');data.currentMember=mid;}
  function updateMember(mid,role,download){requireRight('manage');const m=data.members.find(m=>m.id===mid);if(!m||!roles[role])throw new Error('成员或角色无效。');if(m.role==='admin'&&role!=='admin'&&data.members.filter(x=>x.active&&x.role==='admin').length<=1)throw new Error('必须保留至少一位有效管理员。');m.role=role;m.download=!!download;audit('修改成员权限',mid,roles[role]);}
  function disableMember(mid,to){requireRight('manage');const m=data.members.find(m=>m.id===mid&&m.active),next=data.members.find(m=>m.id===to&&m.active&&['admin','designer'].includes(m.role));if(!m||!next||m.id===next.id)throw new Error('请选择有效的任务接手人。');if(mid===data.currentMember)throw new Error('不能停用当前体验身份。');if(m.role==='admin'&&data.members.filter(x=>x.active&&x.role==='admin').length<=1)throw new Error('不能停用最后一位管理员。');for(const t of state.tasks)if(t.companyId===id&&t.ownerId===mid)t.ownerId=next.id;for(const p of products)if(p.ownerId===mid){p.ownerId=next.id;data.productOwners[p.id]=next.id;}m.active=false;audit('停用并交接',mid,`接手人：${next.name}；素材与历史记录保留`);}
  function resolve(ref){
    if(!ref?.startsWith('company:'))return null;
    const [,tid,aid]=ref.split(':');const t=state.tasks.find(t=>t.id===tid&&t.companyId===id);const asset=t?.assets.find(a=>a.id===aid&&a.companyId===id);return asset?{task:t,asset}:null;
  }
  const referenceKey=(t,a)=>`company:${t.id}:${a.id}`;
  const entries=()=>state.tasks.filter(t=>t.companyId===id).flatMap(t=>t.assets.filter(a=>a.companyId===id).map(asset=>({task:t,asset})));
  const validReference=(ref,pid)=>{const x=resolve(ref);return !!x&&canUse(x.asset)&&x.asset.product===pid;};
  function referencesProblem(d){for(const ref of d.references||[]){if(ref.startsWith('company:')&&(!validReference(ref,d.product)||(d.media==='image'&&resolve(ref)?.asset.media!=='image')))return '公司引用已失效、未批准或与当前 SKU 不一致，请移除或重新选择。';}return '';}
  function initialize(){
    for(const p of products){p.companyId ||= id;p.ownerId = data.productOwners[p.id]||p.ownerId||'m-lin';data.productOwners[p.id]=p.ownerId;}
    for(const t of state.tasks){t.companyId ||= id;t.ownerId ||= 'm-lin';for(const a of t.assets){a.companyId ||= t.companyId;a.creatorId ||= t.ownerId;a.creatorName ||= data.members.find(m=>m.id===a.creatorId)?.name||'历史成员';a.scene ||= a.snapshot?.template||'商品展示';}for(const d of [t.draft,...t.nodes.map(n=>n.draft)]){if(d.media==='video'&&d.quality!=='1080P')d.quality='1080P';bindDraft(d);}}
    if(isNew&&!state.tasks.some(t=>t.id==='company-history')){
      const d=freshDraft('shoe');const history={id:'company-history',companyId:id,ownerId:'m-chen',name:'春季上新 · 历史素材示例',products:['shoe','beauty'],purposes:['main'],draft:d,nodes:[{id:'g1',x:345,y:70,draft:copy(d)}],assets:[],workspace:{view:'page',node:'g1'}};
      for(const pid of ['shoe','beauty']){const p=product(pid);history.assets.push({id:`history-${pid}`,companyId:id,product:pid,name:`${p.name} · 历史批准示例`,purpose:'main',media:'image',image:p.image,style:'plain',status:'approved',version:2,adopted:false,creatorId:'m-chen',creatorName:'陈言',created:'历史示例',scene:'简约棚拍',snapshot:{...copy(freshDraft(pid)),count:1},precheck:{mode:'demo',result:'legacy',dimensions:[]}});}
      state.tasks.push(history);
    }
  }
  initialize();
  return {data,id,roles,member,can,requireRight,audit,latest,options,bindDraft,apply,draftProblem,freeze,validateTemplate,saveTemplate,toggleTemplate,switchMember,updateMember,disableMember,resolve,referenceKey,entries,validReference,referencesProblem,initialize,uid,copy};
};
