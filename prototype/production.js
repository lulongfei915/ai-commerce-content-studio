/* Delivery positions and storyboard snapshots shared by all three creation modes. */
window.createProductionRules = function ({product,canUse}) {
  const copy=x=>JSON.parse(JSON.stringify(x));
  const uid=()=>crypto.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2);
  const names={main:'商品主图',detail:'详情素材',video:'带货视频'};
  function requirement(pid,purpose){return{id:'req-'+uid(),product:pid,purpose,module:names[purpose],count:1,ratio:purpose==='video'?'9:16':'1:1',quality:purpose==='video'?'1080P':'2048 × 2048',duration:12};}
  function ensure(t){
    if(!t.deliveryPlan){t.deliveryPlan=t.products.flatMap(pid=>(t.purposes?.length?t.purposes:['main','detail','video']).map(p=>requirement(pid,p)));t.deliverySelections={};for(const a of t.assets.filter(a=>a.adopted)){const r=t.deliveryPlan.find(r=>matches(a,r));if(r&&!Object.values(t.deliverySelections).includes(a.id))t.deliverySelections[r.id+':0']=a.id;}}
    t.deliverySelections ||= {};
    return t.deliveryPlan;
  }
  function matches(a,r){
    if(!a||a.product!==r.product||a.purpose!==r.purpose||a.media!==(r.purpose==='video'?'video':'image'))return false;
    const d=a.snapshot||{},ratio=d.ratio||(a.media==='video'?'9:16':'1:1'),quality=d.quality||(a.media==='video'?'1080P':'2048 × 2048');
    if((d.deliveryModule||names[a.purpose])!==r.module||ratio!==r.ratio||quality!==r.quality)return false;
    return a.media!=='video'||+(a.duration||d.duration||12)===+r.duration;
  }
  function slots(t){ensure(t);return t.deliveryPlan.flatMap(r=>Array.from({length:+r.count},(_,index)=>{const key=r.id+':'+index,a=t.assets.find(a=>a.id===t.deliverySelections[key]);return{...r,requirementId:r.id,key,index,asset:canUse(a)&&matches(a,r)?a:null};}));}
  function stats(t){const rows=slots(t);return{total:rows.length,ready:rows.filter(r=>r.asset).length};}
  function ensurePurpose(t,pid,purpose){ensure(t);if(!names[purpose])return;if(!t.deliveryPlan.some(r=>r.product===pid&&r.purpose===purpose))t.deliveryPlan.push(requirement(pid,purpose));if(t.purposes&&!t.purposes.includes(purpose))t.purposes.push(purpose);}
  function adopt(t,key,assetId){const row=slots(t).find(r=>r.key===key),a=t.assets.find(a=>a.id===assetId);if(!row||!canUse(a)||!matches(a,row))throw new Error('版本的 SKU、模块或规格与交付位置不匹配。');if(Object.entries(t.deliverySelections).some(([k,id])=>k!==key&&id===assetId))throw new Error('同一素材版本不能重复填入多个交付位置。');t.deliverySelections[key]=assetId;syncAdopted(t);}
  function syncAdopted(t){const adopted=new Set(slots(t).filter(r=>r.asset).map(r=>r.asset.id));for(const a of t.assets)a.adopted=adopted.has(a.id);}
  function validatePlan(rows,t){
    if(!rows.length)return '至少保留一项交付要求。';const modules=new Set();let total=0;
    for(const r of rows){if(!t.products.includes(r.product)||!names[r.purpose])return '请选择本任务商品及有效用途。';if(!r.module?.trim()||r.module.length>40)return '模块名称须为 1–40 字。';const key=[r.product,r.purpose,r.module.trim()].join('/');if(modules.has(key))return '同一商品、用途下的模块名称不能重复。';modules.add(key);if(!Number.isInteger(+r.count)||r.count<1||r.count>6)return '每项数量须为 1–6 的整数。';total+=+r.count;if(!['1:1','3:4','9:16','16:9'].includes(r.ratio))return '请选择有效比例。';if(!(r.purpose==='video'?['1080P']:['1024 × 1024','2048 × 2048','4096 × 4096']).includes(r.quality))return '清晰度与媒体不匹配。';if(r.purpose==='video'&&![6,12,15].includes(+r.duration))return '视频时长须为 6、12 或 15 秒。';}
    if(total>100)return '单任务最多配置 100 个交付位置。';return '';
  }
  function savePlan(t,rows){const problem=validatePlan(rows,t);if(problem)throw new Error(problem);const before=copy(t.deliverySelections);t.deliveryPlan=copy(rows).map(r=>({...r,module:r.module.trim(),count:+r.count,duration:+r.duration}));t.purposes=[...new Set(rows.map(r=>r.purpose))];const valid=new Set(slots(t).filter(r=>r.asset).map(r=>r.key));t.deliverySelections=Object.fromEntries(Object.entries(before).filter(([k])=>valid.has(k)));syncAdopted(t);return Object.keys(before).length-Object.keys(t.deliverySelections).length;}
  function applyRequirement(d,r){Object.assign(d,{purpose:r.purpose,media:r.purpose==='video'?'video':'image',ratio:r.ratio,quality:r.quality,duration:String(r.duration),count:1,deliveryModule:r.module,deliveryRequirementId:r.id});invalidate(d);}
  const needsStoryboard=d=>d.media==='video'&&d.purpose==='video';
  function defaultShots(d){const total=+d.duration||12,a=Math.floor(total/3),b=total-a*2;return[{duration:a,visual:'展示商品全貌，平稳推进',copy:''},{duration:a,visual:'展示实拍可见细节，不添加未知卖点',copy:''},{duration:b,visual:'完整商品定格收尾',copy:''}];}
  function signature(d){return JSON.stringify({product:d.product,media:d.media,purpose:d.purpose,prompt:d.prompt,templateId:d.templateId,templateVersion:d.templateVersion,ratio:d.ratio,quality:d.quality,model:d.model,count:d.count,duration:d.duration,references:d.references||[],reference:d.reference||'',shots:d.shots||[],deliveryModule:d.deliveryModule});}
  function invalidate(d){d.shotsConfirmed=false;delete d.shotSignature;}
  function validateShots(d,shots=d.shots){if(!shots?.length||shots.length>12)return '分镜须为 1–12 个镜头。';if(shots.some(s=>!Number.isInteger(+s.duration)||s.duration<=0||!s.visual?.trim()))return '每个镜头须填写画面说明和正整数时长。';if(shots.some(s=>s.visual.length>500||(s.copy||'').length>200))return '画面最多 500 字，文案最多 200 字。';if(shots.reduce((n,s)=>n+ +s.duration,0)!==+d.duration)return `镜头总时长须等于 ${d.duration} 秒。`;return '';}
  function confirm(d){const problem=validateShots(d);if(problem)throw new Error(problem);d.shotsConfirmed=true;d.shotSignature=signature(d);}
  const confirmed=d=>!!d.shotsConfirmed&&d.shotSignature===signature(d)&&!validateShots(d);
  return{needsStoryboard,requirement,ensure,slots,stats,matches,ensurePurpose,adopt,syncAdopted,validatePlan,savePlan,applyRequirement,defaultShots,signature,invalidate,validateShots,confirm,confirmed,copy};
};
