/* Local batch-workspace prototype. No model calls or production queue. */
window.createBatchWorkspace = function (ctx) {
  'use strict';
  const { esc, icon, product, products, cases, imageSrc, freshDraft, basePrompt, persist, render, toast, openModal, closeModal } = ctx;
  const copy = value => JSON.parse(JSON.stringify(value));
  const uid = prefix => prefix + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));
  const capacity = 2; // Demonstration only; never presented as real service capacity.
  const labels = { draft: '未提交', queued: '排队中', running: '生成中', complete: '生成完成', failed: '需处理' };
  const settings = ['product', 'purpose', 'prompt', 'model', 'ratio', 'quality', 'duration', 'count', 'reference'];
  let media = ctx.task().batchMedia || 'image', openItem = null, commonOpen = false, paneVisible = !matchMedia('(max-width:1099px)').matches, paneView = 'basic';
  let referenceFilterState = { search: '', category: 'all', media: 'all' };
  const errors = new Map();

  const isDraft = item => item.status === 'draft';
  const unit = type => type === 'image' ? '张' : '条';
  const mediaName = type => type === 'image' ? '图片' : '视频';

  function makeCommon(t, type) {
    return { ...freshDraft(t.products[0]), media: type, purpose: type === 'image' ? 'main' : 'video', count: 1,
      ...(type==='image'&&t.purposes?.includes('detail')&&!t.purposes.includes('main')?{purpose:'detail'}:{}), quality: type === 'image' ? '2048 × 2048' : '1080P', ratio: type === 'image' ? '1:1' : '9:16', reference: '' };
  }
  function makeItem(common, patch = {}) {
    return { id: uid('item-'), config: { ...copy(common), ...patch, shotsConfirmed:false, shotSignature:null }, overrides: Object.keys(patch), status: 'draft',
      shotsConfirmed: false, needsFactCheck: false, failureStep: '', outputs: [], runs: [] };
  }
  function ensure(t) {
    if (!t.batches) {
      t.batches = {};
      for (const type of ['image', 'video']) {
        const common = makeCommon(t, type), count = type === 'image' ? Math.max(3, t.products.length) : Math.max(2, t.products.length);
        t.batches[type] = { common, items: Array.from({ length: count }, (_, index) => {
          const pid = t.products[index % t.products.length], patch = {};
          if (pid !== common.product) { patch.product = pid; patch.prompt = basePrompt(product(pid)); }
          if (type === 'image') {
            patch.count = index === 1 ? 2 : 1;
            patch.prompt = basePrompt(product(pid)) + ['采用正面全貌构图，右侧留白。', '采用自然生活场景，背景保持克制。', '展示已确认结构细节，不推断未知材质。'][index % 3];
          } else patch.prompt = basePrompt(product(pid)) + (index % 2 ? '平稳侧向运镜，突出已确认细节。' : '先展示全貌，再平稳推进至可见细节。');
          return makeItem(common, patch);
        }) };
      }
    }
    // Preserve the saved effective prompt, including edits from the old advanced view.
    // Drafts now have one editable prompt; submitted snapshots remain immutable.
    for (const g of Object.values(t.batches)) {
      for (const d of [g.common, ...g.items.map(i => i.config)]) {
        if (typeof d.prompt !== 'string') d.prompt = [basePrompt(product(d.product)), d.intent].filter(Boolean).join('\n');
        delete d.intent;
        delete d.batchIntentReady;
        ctx.company.bindDraft(d);
      }
      for (const item of g.items) {
        item.overrides = [...new Set(item.overrides.map(key => key === 'intent' ? 'prompt' : key))];
        if(item.failureStep==='check'){item.legacyFailureStep='check';item.failureStep='';}
        for(const output of item.outputs){
          if(output.failedStep!=='check'&&output.resumeStep!=='check')continue;
          output.legacyCheck={failedStep:output.failedStep,resumeStep:output.resumeStep};
          delete output.failedStep;delete output.resumeStep;
          // Reuse historical saved output without starting generation again.
          if(output.status!=='complete'){
            if(output.generatedId||t.assets.some(a=>a.id===output.assetId||a.batchOutput===output.id)){
              completeOutput(t,item,output);output.finishedAt=output.finishedAt||Date.now();
            }else{output.status='failed';output.failedStep='generation';}
          }
        }
        syncStatus(item);
      }
    }
    return t.batches;
  }
  const group = () => ensure(ctx.task())[media];
  const currentItem = id => group().items.find(item => item.id === id);
  function options(values, selected) {
    return values.map(value => { const [id, name] = Array.isArray(value) ? value : [value, value]; return `<option value="${esc(id)}" ${String(selected) === String(id) ? 'selected' : ''}>${esc(name)}</option>`; }).join('');
  }
  function referenceEntries(d, t, filtered=true) {
    const entries = [
      ...cases.filter(c => !c.restricted).map(c => ({ id:c.id, name:`${c.media === 'video' ? '分镜参考' : '风格参考'} · ${c.name}`, category:c.category, media:c.media, text:`${c.name} ${c.tag} ${c.category} ${c.style} ${c.features}` })),
      ...ctx.company.entries().filter(x=>x.asset.product===d.product&&ctx.canUse(x.asset)&&(d.media==='video'||x.asset.media==='image')).map(x=>({ id:ctx.company.referenceKey(x.task,x.asset), name:`${x.task.id===t.id?'本任务':'公司素材'} · ${x.asset.name} V${x.asset.version}`, category:product(x.asset.product).category, media:x.asset.media, text:`${x.asset.name} ${product(x.asset.product).name} ${product(x.asset.product).sku} ${x.task.name}` }))
    ];
    return filtered ? filterReferenceEntries(entries, referenceFilterState) : entries;
  }
  function referenceOptions(d, t) {
    const list=referenceEntries(d,t), selected=referenceEntries(d,t,false).find(entry=>entry.id===d.reference);
    if(selected&&!list.some(entry=>entry.id===selected.id))list.unshift({...selected,name:'已选（筛选范围外） · '+selected.name});
    return [['', '仅使用当前商品实拍'], ...list.map(entry => [entry.id, entry.name])];
  }
  function referenceFilters(d) {
    return `<div class="batch-reference-filters"><label class="batch-field"><span>搜索参考</span><input id="batch-reference-search" type="search" aria-label="搜索案例或公司素材" placeholder="名称、SKU 或场景" value="${esc(referenceFilterState.search)}"></label><label class="batch-field"><span>品类</span><select id="batch-reference-category" aria-label="筛选参考品类"><option value="all" ${referenceFilterState.category==='all'?'selected':''}>全部品类</option>${[...new Set(cases.map(c=>c.category).concat(ctx.company.entries().map(x=>product(x.asset.product).category)))].map(category=>`<option value="${esc(category)}" ${referenceFilterState.category===category?'selected':''}>${esc(category)}</option>`).join('')}</select></label><label class="batch-field"><span>媒体</span><select id="batch-reference-media" aria-label="筛选参考媒体"><option value="all" ${referenceFilterState.media==='all'?'selected':''}>全部媒体</option><option value="image" ${referenceFilterState.media==='image'?'selected':''}>图片</option><option value="video" ${referenceFilterState.media==='video'?'selected':''}>视频</option></select></label></div><p class="batch-reference-count" role="status">找到 ${referenceEntries(d,ctx.task()).length} 份可用参考</p>`;
  }
  function references(d) { return d.reference ? [d.reference] : []; }
  function productChanged(item, id) {
    const previous = product(item.config.product);
    const wasDefault = item.config.prompt === basePrompt(previous) && !item.overrides.includes('prompt');
    item.config.product = id;
    item.config.template = product(id).template;
    item.config.reference = '';
    item.config.references = [];
    item.config.uploads = [];
    item.overrides = item.overrides.filter(key => key !== 'reference');
    if (wasDefault) item.config.prompt = basePrompt(product(id));
    else if (item.config.prompt.trim()) item.needsFactCheck = true;
    item.shotsConfirmed = false; ctx.production.invalidate(item.config);
  }
  function updateCommon(key, value) {
    const g = group(), previous = product(g.common.product);
    const wasDefault = g.common.prompt === basePrompt(previous);
    g.common[key] = value;
    if (key === 'product') {
      if (wasDefault) g.common.prompt = basePrompt(product(value));
      g.common.reference = '';
      g.common.template = product(value).template;
    }
    for (const item of g.items.filter(isDraft)) {
      if (item.overrides.includes(key)) continue;
      if (key === 'product') productChanged(item, value);
      else if (key === 'reference') {
        const ref = value.startsWith('company:')?ctx.company.resolve(value)?.asset:value.startsWith('result:') ? ctx.task().assets.find(a => a.id === value.slice(7)) : null;
        if (ref && ref.product !== item.config.product) {
          item.config.reference = '';
          if (!item.overrides.includes('reference')) item.overrides.push('reference');
        } else item.config.reference = value;
      } else {
        item.config[key] = value;
        if (key === 'prompt' && item.config.product !== g.common.product) item.needsFactCheck = true;
      }
      item.shotsConfirmed = false; ctx.production.invalidate(item.config);
      errors.delete(item.id);
    }
    persist();
  }
  function validate(item, type, t) {
    const d = item.config, problems = [];
    if (!products.some(p => p.id === d.product)||!t.products.includes(d.product)) problems.push('请选择有效商品。');
    if (d.prompt.length>3000) problems.push('提示词不能超过 3000 字符。');
    if (!d.prompt.trim()) problems.push('请填写提示词，或恢复公共设置。');
    if (!Number.isInteger(+d.count) || +d.count < 1 || +d.count > 6) problems.push('每项输出数量须为 1–6。');
    if (!['1:1', '3:4', '9:16', '16:9'].includes(d.ratio)) problems.push('当前比例不受演示模型支持。');
    if (!['公司默认模型', ...(type==='image'?['高保真模型 · 演示','高保真图片模型 · 演示']:['标准视频模型 · 演示'])].includes(d.model)) problems.push('模型与媒体类型不兼容。');
    if (type === 'image' ? !['1024 × 1024', '2048 × 2048', '4096 × 4096'].includes(d.quality) : d.quality !== '1080P') problems.push('请使用当前模型支持的清晰度。');
    if (type === 'video' && !['6', '12', '15'].includes(String(d.duration))) problems.push('视频时长不受当前演示模型支持。');
    if (type === 'image' ? !['main', 'detail'].includes(d.purpose) : !['video', 'clip'].includes(d.purpose)) problems.push('用途与媒体类型不兼容。');
    if (d.reference) {
      const ref = cases.find(c => c.id === d.reference);
      const asset = d.reference.startsWith('company:')?ctx.company.resolve(d.reference)?.asset:d.reference.startsWith('result:') && t.assets.find(a => a.id === d.reference.slice(7));
      if ((!ref || ref.restricted) && (!ctx.canUse(asset) || asset.product !== d.product || type==='image'&&asset.media!=='image')) problems.push('参考未就绪、未批准或与当前商品不一致，请重新选择。');
    }
    if (item.needsFactCheck) problems.push('商品已更换，请核对保留的提示词并确认商品事实。');
    const templateProblem=ctx.company.draftProblem(d);if(templateProblem)problems.push(templateProblem);
    if (ctx.production.needsStoryboard(d) && !ctx.production.confirmed(d)) problems.push('请先逐项确认带货成片的分镜、商品事实与时长。');
    return problems;
  }
  const fieldNames = {product:'商品',purpose:'素材用途',prompt:'提示词',model:'模型',ratio:'比例',quality:'清晰度',duration:'时长',count:'数量',reference:'参考'};
  function fieldSource(item,key) {
    if (!item) return '';
    const changed=item.overrides.includes(key);
    return `<span class="batch-field-source"><small>${changed?'已单独调整':'沿用公共'}</small>${changed?`<button type="button" data-action="batch-reset-field" data-id="${item.id}:${key}" aria-label="恢复${fieldNames[key]}为公共默认">恢复默认</button>`:''}</span>`;
  }
  function field(key, label, d, item, values, scope) {
    const id = `batch-${scope}-${key}`;
    const attrs = `id="${id}" data-batch-field="${key}" data-batch-scope="${scope}"`;
    return `<div class="batch-field"><div class="batch-field-heading"><label for="${id}">${label}</label>${fieldSource(item,key)}</div><select ${attrs}>${options(values,d[key])}</select></div>`;
  }
  function qualityLabel(d) {return d.media==='image'?({'1024 × 1024':'1K','2048 × 2048':'2K','4096 × 4096':'4K'}[d.quality]||d.quality):d.quality;}
  function commonSummary(d) {return `${product(d.product).name} · 默认：${d.ratio} · ${qualityLabel(d)} · ${d.count} ${unit(d.media)}/项`;}
  function itemTitle(item) {return `${String(group().items.indexOf(item)+1).padStart(2,'0')} · ${promptSummary(item.config)}`;}
  function submitLabel(total) {return total?`生成 ${total} ${unit(media)}${mediaName(media)}`:'暂无待提交项';}
  function promptSummary(d) {
    // Only strip the exact, known product preamble; custom text stays intact.
    const prefix = basePrompt(product(d.product));
    const detail = d.prompt.startsWith(prefix) ? d.prompt.slice(prefix.length).trim() : d.prompt.trim();
    return detail || d.prompt.trim() || '请填写提示词';
  }
  function sizePrompt() {
    const input = document.querySelector('.batch-composer-main textarea');
    if (!input) return;
    const style = getComputedStyle(input);
    input.style.height = 'auto';
    input.style.height = Math.max(parseFloat(style.minHeight), Math.min(input.scrollHeight, parseFloat(style.maxHeight))) + 'px';
  }
  function parameterMenu(key, name, label, content, changed=false) {
    return `<details class="batch-parameter-menu ${changed?'is-overridden':''}" data-parameter="${key}" name="batch-parameters"><summary title="${changed?'已单独调整；展开可恢复公共默认':'展开修改参数'}" aria-label="${esc(name + '：' + label + (changed?' · 已单独调整':''))}"><span>${esc(label)}</span>${icon('down')}</summary><div class="batch-parameter-popover"><strong>${name}</strong>${content}</div></details>`;
  }
  function inlineParameter(key, name, values, d, scope) {
    const item=scope==='common'?null:currentItem(scope), changed=item?.overrides.includes(key);
    return `<div class="batch-inline-parameter ${changed?'is-overridden':''}" data-parameter="${key}" title="${name}${changed?' · 已单独调整':' · 沿用公共默认'}"><select id="batch-${scope}-${key}" data-batch-field="${key}" data-batch-scope="${scope}" aria-label="${name}${changed?' · 已单独调整':''}">${options(values,d[key])}</select>${changed?`<button type="button" class="batch-inline-restore" data-action="batch-reset-field" data-id="${item.id}:${key}" aria-label="恢复${fieldNames[key]}为公共默认" title="恢复${fieldNames[key]}为公共默认">${icon('undo')}</button>`:''}</div>`;
  }
  function promptComposer(d, item, scope) {
    const ref = d.reference ? (cases.find(c => c.id === d.reference) || ctx.company.resolve(d.reference)?.asset || ctx.task().assets.find(a => `result:${a.id}` === d.reference)) : null;
    const presets = media === 'image' ? ['简洁棚拍', '日常场景', '细节特写'] : ['全貌到细节', '平稳环绕', '细节展示'];
    const shortcuts = presets.map((name, index) => `<button type="button" data-action="batch-preset" data-id="${scope}:${index}">${name}</button>`).join('');
    const owner = item || group();
    const tools = `<button class="text-button" data-action="batch-optimize" data-id="${scope}" ${!d.prompt.trim() ? 'disabled' : ''}>${icon('spark')}优化提示词</button>${owner.promptUndo !== undefined ? `<button class="text-button" data-action="batch-undo" data-id="${scope}">${icon('undo')}撤销</button>` : ''}`;
    const quality = media==='image'?[['1024 × 1024','1K'],['2048 × 2048','2K'],['4096 × 4096','4K']]:[['1080P','1080P']];
    const modelName = d.model==='公司默认模型'?'公司默认':media==='image'?'高保真':'标准视频';
    const model = parameterMenu('model','生成模型',modelName,field('model','模型',d,item,['公司默认模型',media==='image'?'高保真图片模型 · 演示':'标准视频模型 · 演示'],scope),item?.overrides.includes('model'));
    const specs = parameterMenu('specs','画面规格',`${d.ratio} · ${quality.find(([value])=>value===d.quality)?.[1] || d.quality}`,
      field('ratio','画面比例',d,item,['1:1','3:4','9:16','16:9'],scope)+field('quality','清晰度',d,item,quality,scope),item?.overrides.some(key=>['ratio','quality'].includes(key)));
    const count = inlineParameter('count',media==='image'?'图片张数':'视频条数',Array.from({length:6},(_,i)=>[i+1,`${i+1} ${unit(media)}`]),d,scope);
    const duration = media==='video'?inlineParameter('duration','视频时长',[['6','6 秒'],['12','12 秒'],['15','15 秒']],d,scope):'';
    const parameters = `<div class="batch-parameter-primary">${model}${specs}${media==='image'?count:''}</div>${media==='video'?`<div class="batch-parameter-secondary">${duration}${count}</div>`:''}`;
    return `<section class="batch-prompt-composer" aria-label="${item ? '生成项提示词' : '批量公共提示词'}">
      <div class="batch-composer-surface"><div class="batch-composer-heading"><strong>${item ? '提示词' : '公共提示词'}</strong><span class="batch-prompt-source">${fieldSource(item,'prompt')}</span></div><div class="batch-composer-main">
        <label class="sr-only" for="batch-${scope}-prompt">${item ? '提示词' : '公共提示词'}</label>
        <textarea id="batch-${scope}-prompt" data-batch-field="prompt" data-batch-scope="${scope}" maxlength="3000" placeholder="描述本次画面，商品外观以当前 SKU 实拍为准。">${esc(d.prompt)}</textarea>
      </div>
      <div class="batch-composer-tools"><div class="batch-composer-references">${ref ? `<button class="batch-composer-reference" type="button" data-action="batch-pane-view" data-id="reference" title="更换表达参考"><img src="${imageSrc(ref.image)}" alt=""><span>参考 · 1</span></button>` : `<button class="batch-composer-reference batch-composer-add" type="button" data-action="batch-pane-view" data-id="reference" title="添加表达参考">${icon('plus')}<span>添加参考</span></button>`}</div><div class="batch-composer-assist">${tools}</div></div>
      <div class="batch-parameter-toolbar" aria-label="生成参数">${parameters}</div></div>
      <div class="batch-template-line"><span>${esc(d.template)} · V${d.templateVersion||1}</span><button class="text-button" data-action="company-choose-template" data-id="batch:${scope}">选择公司模板</button></div><div class="batch-composer-shortcuts" aria-label="快捷创作起点">${shortcuts}<button type="button" data-action="batch-pane-view" data-id="reference">更多灵感${icon('chevron')}</button></div>
    </section>`;
  }
  function shots(d){return ctx.shotSummary(d);}
  function card(item, index, multipleProducts=false) {
    const d = item.config, p = product(d.product), selected = paneVisible && !commonOpen && openItem === item.id;
    const successes = item.outputs.filter(o => o.status === 'complete').length, problems = errors.get(item.id) || [];
    return `<article class="batch-item ${selected ? 'selected' : ''} ${problems.length ? 'has-error' : ''}" data-batch-item="${item.id}"><div class="batch-item-row">
      <span class="batch-number">${String(index + 1).padStart(2, '0')}</span><div class="batch-item-content">
      <div class="batch-item-summary"><p title="${esc(d.prompt)}">${esc(promptSummary(d))}</p><span>${esc(d.ratio)} · ${d.media === 'video' ? esc(d.duration) + 's · ' : ''}${esc(d.count)} ${unit(d.media)}</span></div>
      <div class="batch-item-heading"><img class="batch-product-thumb" src="${imageSrc(p.image)}" alt=""><p title="${esc(p.name)} · ${esc(p.sku)}">${esc(p.name)}${multipleProducts?' · '+esc(p.sku):''} · ${ctx.purposeName(d.purpose)}</p></div></div>
      <div class="batch-item-state"><span class="badge ${problems.length || item.status === 'failed' ? 'error' : item.status === 'complete' ? 'ok' : item.status === 'draft' ? '' : 'warn'}">${problems.length ? '待完善' : labels[item.status]}</span>${item.outputs.length ? `<small>${successes}/${item.outputs.length} 份完成</small>` : ''}</div>
      <div class="batch-item-actions"><button id="batch-select-${item.id}" class="text-button" data-action="${isDraft(item) ? 'batch-edit' : 'batch-results'}" data-id="${item.id}" aria-pressed="${selected}" aria-controls="batch-inspector">${isDraft(item) ? '编辑' : '结果'}${icon('chevron')}</button><button class="icon-button" data-action="batch-copy" data-id="${item.id}" aria-label="复制第 ${index + 1} 项" title="复制此项为新的未提交项">${icon('layers')}</button></div></div></article>`;
  }
  function inspector() {
    if (!paneVisible) return '';
    const item = commonOpen ? null : currentItem(openItem), d = commonOpen ? group().common : item?.config;
    if (!d) return '';
    const scope = commonOpen ? 'common' : item.id, editable = commonOpen || isDraft(item), p = product(d.product);
    const title = commonOpen ? '公共设置' : itemTitle(item);
    const titles = {basic:editable ? '' : '生成结果',context:'商品与用途',reference:'选择参考',storyboard:'确认分镜'};
    const problemList = !commonOpen && errors.get(item.id) || [];
    let body = '';
    if (!editable) body = `<p class="batch-small-note">${esc(p.name)} · ${ctx.purposeName(d.purpose)} · ${labels[item.status]}<br>完成输出可立即预览，其他项继续执行。保存后交由审核员处理。</p><div class="batch-outputs">${item.outputs.map((o,i)=>outputCard(o,i,item)).join('')}</div><button class="text-button" data-action="batch-record" data-id="${item.id}">${icon('clock')}输入与执行记录</button>`;
    else if (paneView === 'context') body = `<p class="batch-small-note">实拍与已确认事实随商品自动带入；更换商品后核对保留的提示词。</p>${field('product','当前商品',d,item,products.filter(p=>ctx.task().products.includes(p.id)).map(p=>[p.id,`${p.name} · ${p.sku}`]),scope)}<button class="text-button batch-add-product" data-action="creation-add-current">${icon('plus')}添加商品到本次制作</button>${field('purpose','素材用途',d,item,media==='image'?[['main','商品主图'],['detail','详情素材']]:[['video','带货成片 · 需确认分镜'],['clip','单段片段 · 不计成片交付']],scope)}<div class="batch-facts"><b>已确认事实</b><p>${p.facts.map(esc).join(' · ')}</p><small>${esc(p.evidence)}</small></div>`;
    else if (paneView === 'reference') body = `<p class="batch-small-note">商品实拍已自动绑定。可额外选择一份表达参考；已批准素材仅用于同 SKU。</p>${referenceFilters(d)}${field('reference',media==='image'?'表达参考':'首帧 / 已就绪参考',d,item,referenceOptions(d,ctx.task()),scope)}${d.reference ? `<button class="batch-reference-preview" data-action="batch-preview-reference" data-id="${scope}" aria-label="预览已选参考"><img src="${imageSrc(cases.find(c=>c.id===d.reference)?.image || ctx.company.resolve(d.reference)?.asset.image || ctx.task().assets.find(a=>'result:'+a.id===d.reference)?.image || p.image)}" alt="已选参考"></button><button class="text-button" data-action="batch-preview-reference" data-id="${scope}">预览参考${cases.find(c=>c.id===d.reference)?.media==='video'?' · 视频分镜':''}</button>` : ''}${d.reference && item ? `<button class="text-button" data-action="batch-analyze" data-id="${item.id}">${icon('spark')}解析参考 · 预设建议</button>` : ''}`;
    else if (paneView === 'storyboard' && item && d.purpose === 'video') body = `<p class="batch-small-note">${esc(p.name)} · ${esc(p.sku)} · 总时长 ${esc(d.duration)} 秒<br>可编辑镜头、画面、文案和时长，输入变化后须重新确认。</p>${shots(d)}<button class="btn sm" data-action="shots-edit" data-id="batch:${item.id}">编辑分镜</button><div class="batch-facts"><b>商品事实依据</b><p>${p.facts.map(esc).join(' · ')}</p><small>${esc(p.evidence)}</small></div><label class="checkbox-label"><input type="checkbox" data-batch-shots="${item.id}" ${ctx.production.confirmed(d)?'checked':''}>已确认此项分镜、商品事实及 ${esc(d.duration)} 秒总时长</label><button class="btn primary sm" data-action="batch-pane-view" data-id="basic">完成，返回创作</button>`;
    else body = `<button class="batch-context-card" data-action="batch-pane-view" data-id="context"><img src="${imageSrc(p.image)}" alt=""><span><b>${esc(p.name)}</b><small>${ctx.purposeName(d.purpose)} · 实拍与事实已带入</small></span>${icon('chevron')}</button>${promptComposer(d, item, scope)}
      ${item?.needsFactCheck?`<label class="checkbox-label batch-fact-confirm"><input type="checkbox" data-batch-facts="${item.id}">已核对保留内容，不含其他商品事实</label>`:''}
      ${item && media==='video' && d.purpose==='video'?`<button class="batch-storyboard-link" data-action="batch-pane-view" data-id="storyboard">${icon('video')}<span data-shot-status>${ctx.production.confirmed(d)?'分镜已确认':'分镜待确认'}</span>${icon('chevron')}</button>`:''}`;
    const sheet = matchMedia('(max-width:1099px)').matches;
    return `${sheet?'<div class="batch-pane-scrim" data-action="batch-close"></div>':''}<aside id="batch-inspector" class="batch-inspector ${media==='video'?'is-video':''}" ${sheet?'role="dialog" aria-modal="true"':''} aria-label="${esc([title,titles[paneView]].filter(Boolean).join(' · '))}"><header class="batch-pane-header"><div>${paneView!=='basic'&&editable?'<button class="icon-button" data-action="batch-pane-view" data-id="basic" aria-label="返回创作">'+icon('undo')+'</button>':''}<h2><span class="batch-current-title" title="${esc(title)}">${esc(title)}</span><small>${titles[paneView]}</small></h2></div><div>${item&&editable?`<details class="batch-more"><summary aria-label="更多操作">${icon('more')}</summary><div><button data-action="batch-reset" data-id="${item.id}">恢复公共设置</button><button data-action="batch-delete" data-id="${item.id}">删除此项</button></div></details>`:''}<button id="batch-pane-close" class="icon-button" data-action="batch-close" aria-label="关闭编辑区">${icon('close')}</button></div></header><div class="batch-pane-body">${problemList.length?`<div class="batch-errors" role="alert">${problemList.map(p=>'<p>'+esc(p)+'</p>').join('')}</div>`:''}${commonOpen?'<p class="batch-inheritance-note">修改将同步到未提交项中沿用公共设置的对应字段；单独调整的字段保持不变。</p>':''}${body}</div></aside>`;
  }
  function outputCard(output, index, item) {
    const a = ctx.task().assets.find(a => a.id === output.assetId), failed = output.status === 'failed';
    const stepNames = { generation: '生成失败', save: '保存失败' };
    const status = a ? a.adopted ? '已采用' : ctx.statusNames[a.status] : failed ? stepNames[output.failedStep] : output.status === 'running' ? (output.resumeStep === 'save' ? '重存中' : '生成中') : '排队中';
    return `<div class="batch-output ${output.status}">${a ? `<button class="batch-output-preview" data-action="asset-detail" data-id="${a.id}" aria-label="预览第 ${index + 1} 份${mediaName(item.config.media)}"><img src="${imageSrc(a.image)}" alt="${esc(a.name)}">${a.media === 'video' ? `<span class="batch-video-label">${a.duration}s · 分镜演示</span>` : ''}</button>` : `<div class="batch-output-placeholder">${icon(failed ? 'alert' : output.status === 'running' ? 'refresh' : 'clock')}<span>${failed && output.generatedId ? '生成结果已保留' : `第 ${index + 1} 份输出`}</span></div>`}<div class="batch-output-caption"><span class="badge ${failed || a && ['rejected','blocked','check_failed'].includes(a.status) ? 'error' : a?.status === 'approved' ? 'ok' : 'warn'}">${esc(status)}</span>${failed ? `<button class="text-button" data-action="batch-retry" data-id="${item.id}:${output.id}">${output.failedStep === 'save' ? '只重存' : '重试此输出'}</button>` : a ? `<button class="text-button" data-action="asset-detail" data-id="${a.id}">预览与审核</button>` : '<span class="batch-progress" aria-hidden="true"></span>'}</div></div>`;
  }
  function renderHeader() {return `<div class="batch-media-tabs" role="tablist" aria-label="批量媒体类型">${['image','video'].map(type=>`<button role="tab" aria-selected="${media===type}" data-action="batch-media" data-id="${type}" class="${media===type?'active':''}">${icon(type)}批量${mediaName(type)}</button>`).join('')}</div>`;}
  function renderWorkspace() {
    const g = group(), drafts = g.items.filter(isDraft), counts = {};
    const multipleProducts=new Set(g.items.map(item=>item.config.product)).size>1;
    if (!currentItem(openItem)) openItem = g.items[0]?.id || null;
    for (const key of Object.keys(labels)) counts[key] = g.items.filter(i => i.status === key).length;
    const total = drafts.reduce((n,item)=>n+(+item.config.count||0),0);
    requestAnimationFrame(sizePrompt);
    return `<section class="batch-workspace" aria-label="批量制作工作区">${matchMedia('(min-width:1100px)').matches?'':`<div class="batch-topline">${renderHeader()}</div>`}
      <div class="batch-layout ${paneVisible&&(commonOpen||openItem)?'with-inspector':''}"><div class="batch-list-area"><div class="batch-common"><div class="batch-common-heading"><div><h2>公共设置</h2><p>${esc(commonSummary(g.common))}</p></div><button id="batch-common-trigger" class="text-button" data-action="batch-common">调整${icon('settings')}</button></div></div>
      <div class="batch-list-heading"><div><h2>生成项清单 <span>${g.items.length}</span></h2></div><button class="btn sm" data-action="batch-add">${icon('plus')}新增${mediaName(media)}项</button></div>
      <div class="batch-status-summary" role="status" aria-live="polite">${Object.keys(labels).filter(key=>key!=='draft'&&counts[key]).map(key=>`<span class="${key==='failed'?'batch-error-text':''}">${labels[key]} ${counts[key]}</span>`).join('')}</div>
      <div class="batch-scroll" tabindex="0" role="region" aria-label="生成项清单">${g.items.map((item,index)=>card(item,index,multipleProducts)).join('') || '<div class="empty-state"><h3>新增第一项，开始批量创作</h3><p>不同商品或不同画面，都可以独立配置。</p></div>'}</div></div>${inspector()}</div>
      <footer class="batch-footer"><div class="batch-submit-summary"><strong id="batch-submit-count" aria-live="polite">待提交 ${drafts.length} 项 · 共 ${total} ${unit(media)}</strong><details class="batch-submit-help"><summary aria-label="批量提交与审核说明" title="提交与审核说明">${icon('shield')}</summary><div>提交全部未提交项；保存后提交人工审核，批准并采用后可交付。</div></details></div><button class="btn primary" data-action="batch-submit" ${!drafts.length?'disabled':''}>${icon('spark')}<span>${submitLabel(total)}</span>${icon('arrow')}</button></footer></section>`;
  }
  function showPane(id, view='basic', common=false) {
    if (id) openItem=id;
    commonOpen=common; paneView=view; paneVisible=true; render();
    if(matchMedia('(max-width:1099px)').matches) requestAnimationFrame(()=>document.getElementById('batch-pane-close')?.focus({preventScroll:true}));
  }
  function hidePane() {
    const target=commonOpen?'batch-common-trigger':`batch-select-${openItem}`;
    paneVisible=false; commonOpen=false; paneView='basic'; render();
    document.getElementById(target)?.focus({preventScroll:true});
  }
  function refreshCount() {
    const drafts = group().items.filter(isDraft), label = document.getElementById('batch-submit-count');
    const total=drafts.reduce((n,i)=>n+(+i.config.count||0),0);
    if (label) label.textContent = `待提交 ${drafts.length} 项 · 共 ${total} ${unit(media)}`;
    const button=document.querySelector('[data-action="batch-submit"]');
    if(button){button.disabled=!drafts.length;button.querySelector('span').textContent=submitLabel(total);}
  }
  function submit() {
    ctx.company.requireRight('create');
    const t = ctx.task(), g = group(), items = g.items.filter(isDraft);
    errors.clear();
    for (const item of items) { const list = validate(item, media, t); if (list.length) errors.set(item.id, list); }
    if (errors.size) {
      openItem = errors.keys().next().value; showPane(openItem);
      requestAnimationFrame(() => { const input = document.querySelector('.batch-inspector textarea'); input?.focus({ preventScroll: true }); document.querySelector(`[data-batch-item="${openItem}"]`)?.scrollIntoView({ block: 'nearest' }); });
      toast('请修正标记项，或明确删除后再提交；本次未启动生成。'); return;
    }
    if (!items.length) return;
    const submittedAt = Date.now();
    for (const item of items) {
      if(t.purposes&&!t.purposes.includes(item.config.purpose)&&item.config.purpose!=='clip')t.purposes.push(item.config.purpose);
      if (!t.products.includes(item.config.product)) t.products.push(item.config.product);
      ctx.production.ensurePurpose(t,item.config.product,item.config.purpose);
      item.snapshot = ctx.company.freeze(copy({ ...item.config, productFacts:product(item.config.product).facts, factSource:product(item.config.product).evidence, references: references(item.config), uploads: [] }));
      item.runId = uid('demo-run-'); item.submittedAt = submittedAt; item.status = 'queued';
      item.outputs = Array.from({ length: +item.snapshot.count }, (_, index) => ({ id: uid('out-'), index, status: 'queued', attempts: [], queueAt: submittedAt, attempt: 0 }));
      item.runs.push({ id: item.runId, snapshot: copy(item.snapshot), submittedAt });
    }
    openItem = items[0].id; paneVisible = !matchMedia('(max-width:1099px)').matches; commonOpen=false; paneView='basic'; persist(); pump(); render(); toast(`已提交 ${items.length} 项，正在演示并行与排队。`);
  }
  function allOutputs() {
    return ctx.state.tasks.flatMap(t => Object.values(ensure(t)).flatMap(g => g.items.flatMap(item => item.outputs.map(output => ({ t, item, output })))));
  }
  function syncStatus(item) {
    if (!item.outputs.length) return;
    item.status = item.outputs.some(o => o.status === 'running') ? 'running' : item.outputs.some(o => o.status === 'queued') ? 'queued' : item.outputs.some(o => o.status === 'failed') ? 'failed' : 'complete';
  }
  function completeOutput(t,item,output){
    const d=item.snapshot;
    const existing=t.assets.find(a=>a.id===output.assetId||a.id==='batch-'+output.id||a.batchOutput===output.id);
    output.status='complete';output.failedStep=null;delete output.resumeStep;
    output.assetId=existing?.id||'batch-'+output.id;
    if(existing)return;
    const p=product(d.product);
    const asset={companyId:t.companyId,creatorId:d.creatorId,creatorName:d.creatorName,scene:d.template,id:output.assetId,product:d.product,name:`${p.name} · ${ctx.purposeName(d.purpose)} ${output.index+1}`,purpose:d.purpose,
      image:output.index%2?p.source:p.image,style:'plain',status:'pending',version:1,media:d.media,duration:+d.duration,
      created:'刚刚',adopted:false,batchItem:item.id,batchRun:item.runId,batchOutput:output.id,snapshot:copy(d)};
    t.assets.unshift(asset);
  }
  function finish({ t, item, output }) {
    const d = item.snapshot, now = Date.now(), attempt = output.attempts.at(-1);
    const failed = ['generation','save'].includes(item.failureStep) && output.index === item.outputs.length - 1 && output.attempt === 1;
    if (!output.generatedId && !(failed && item.failureStep === 'generation')) { output.generatedId = uid('demo-generated-'); output.generatedAt = now; }
    output.finishedAt = now;
    if (attempt) attempt.finishedAt = now;
    if (failed) { output.status = 'failed'; output.failedStep = item.failureStep; if (attempt) attempt.status = 'failed'; }
    else {
      completeOutput(t,item,output);if(attempt)attempt.status='complete';
    }
    syncStatus(item);
  }
  function pump() {
    const all = allOutputs();
    let active = all.filter(({ output }) => output.status === 'running').length, changed = false;
    // Interleave output positions so independent items can start together.
    const queued = all.filter(({ output }) => output.status === 'queued').sort((a, b) => a.output.queueAt - b.output.queueAt || a.output.index - b.output.index);
    for (const { item, output } of queued) {
      if (active >= capacity) break;
      output.status = 'running'; output.startedAt = Date.now(); output.attempt += 1;
      output.dueAt = output.startedAt + (output.resumeStep && output.resumeStep !== 'generation' ? 1500 : 3200 + (output.index % 3) * 900);
      output.attempts.push({ number: output.attempt, step: output.resumeStep || 'generation', startedAt: output.startedAt, status: 'running' });
      syncStatus(item); active++; changed = true;
    }
    if (changed) persist();
    return changed;
  }
  function tick() {
    let changed = false;
    for (const row of allOutputs()) if (row.output.status === 'running' && row.output.dueAt <= Date.now()) { finish(row); changed = true; }
    changed = pump() || changed;
    if (changed) { persist(); render(); }
  }
  function record(item) {
    const d = item.snapshot;
    const time = stamp => stamp ? new Date(stamp).toLocaleTimeString('zh-CN', { hour12: false }) : '—';
    openModal('生成项 · 输入与执行记录', `<div class="note">本地演示记录。刷新后按原输出标识恢复，不表示服务器在关页后持续运行。</div><dl class="detail-list"><dt>生成项</dt><dd>${esc(item.id)}</dd><dt>执行记录</dt><dd>${esc(item.runId)}</dd><dt>商品 / 用途</dt><dd>${esc(product(d.product).sku)} · ${ctx.purposeName(d.purpose)}</dd><dt>提交配置</dt><dd>${esc(d.model)} · ${esc(d.ratio)} · ${esc(d.quality)}${d.media === 'video' ? ' · ' + esc(d.duration) + 's' : ''}</dd><dt>提示词快照</dt><dd>${esc(d.prompt)}</dd><dt>参考快照</dt><dd>${esc(d.reference || '仅当前 SKU 实拍')}</dd></dl><div class="batch-records">${item.outputs.map((o, i) => `<div><h3>输出 ${i + 1} · ${o.status === 'complete' ? '生成完成' : o.status === 'failed' ? '失败' : labels[o.status]}</h3><p>${o.generatedId ? `生成结果标识：${esc(o.generatedId)}` : '尚无成功生成结果'}</p>${o.attempts.map(a => `<p>尝试 ${a.number} · ${a.step === 'save' ? '只重存' : a.step === 'check' ? '历史初检记录' : '生成'} · ${time(a.startedAt)} → ${time(a.finishedAt)} · ${a.step === 'check' ? '已归档' : a.status === 'complete' ? '成功' : a.status === 'failed' ? '失败' : '进行中'}</p>`).join('')}</div>`).join('')}</div>`, '<button class="btn" data-action="close-modal">关闭</button>');
  }
  function appendPrompt(scope, text) {
    const target=scope==='common'?null:currentItem(scope), g=group(), d=target?.config||(scope==='common'?g.common:null);
    if(!d || target&&!isDraft(target))return;
    const next=[d.prompt,text].filter(Boolean).join('\n');
    if(next.length>3000){toast('提示词已接近 3000 字符，请先精简。');return;}
    const owner=target||g;
    owner.promptUndo={prompt:d.prompt,...(target?{overrides:[...target.overrides]}:{})};
    if(target){d.prompt=next;if(!target.overrides.includes('prompt'))target.overrides.push('prompt');target.shotsConfirmed=false;ctx.production.invalidate(target.config);errors.delete(target.id);persist();}
    else updateCommon('prompt',next);
    render();toast('已追加预设建议，可编辑或撤销；未调用 AI。');
  }
  function handleAction(action, id) {
    if (!action.startsWith('batch-')) return false;
    const item = currentItem(id), g = group();
    switch (action) {
      case 'batch-media': media = id; ctx.task().batchMedia = id; openItem = null; commonOpen=false; paneView='basic'; errors.clear(); persist(); render(); break;
      case 'batch-common': showPane(null,'basic',true); break;
      case 'batch-close': hidePane(); break;
      case 'batch-pane-view': paneView=['basic','context','reference','storyboard'].includes(id)?id:'basic'; render(); requestAnimationFrame(()=>document.querySelector('.batch-pane-body')?.scrollTo(0,0)); break;
      case 'batch-add': { const added = makeItem(g.common); g.items.push(added); persist(); showPane(added.id); if(!matchMedia('(max-width:1099px)').matches)requestAnimationFrame(() => document.querySelector(`[data-batch-item="${added.id}"]`)?.scrollIntoView({ block: 'nearest' })); break; }
      case 'batch-edit': if (item && isDraft(item)) showPane(id); break;
      case 'batch-copy': if (item) { const cloned = makeItem(item.snapshot || item.config); cloned.overrides = [...settings]; g.items.push(cloned); persist(); showPane(cloned.id); toast('已复制为新的未提交项；原结果与执行记录保留。'); if(!matchMedia('(max-width:1099px)').matches)requestAnimationFrame(() => document.querySelector(`[data-batch-item="${cloned.id}"]`)?.scrollIntoView({ block: 'nearest' })); } break;
      case 'batch-delete': if (item && isDraft(item)) openModal('删除此未提交项？', `<p>删除第 ${g.items.indexOf(item) + 1} 项：${esc(product(item.config.product).name)}。其他生成项与结果保留。</p>`, `<button class="btn" data-action="close-modal">取消</button><button class="btn danger" data-action="batch-confirm-delete" data-id="${id}">确认删除</button>`); break;
      case 'batch-confirm-delete': if (item && isDraft(item)) { g.items = g.items.filter(i => i !== item); errors.delete(id); persist(); closeModal(); render(); } break;
      case 'batch-reset': if (item && isDraft(item)) openModal('恢复此项公共设置？', '<p>将替换此项的独立配置与提示词，其他项保留原内容。</p>', `<button class="btn" data-action="close-modal">取消</button><button class="btn primary" data-action="batch-confirm-reset" data-id="${id}">确认恢复</button>`); break;
      case 'batch-confirm-reset': if (item && isDraft(item)) { item.config = copy(g.common); item.overrides = []; item.needsFactCheck = false; item.shotsConfirmed = false; ctx.production.invalidate(item.config); delete item.promptUndo; errors.delete(id); persist(); closeModal(); render(); } break;
      case 'batch-reset-field': {
        const [itemId,key]=id.split(':'), target=currentItem(itemId);
        if(!target || !isDraft(target) || !settings.includes(key))break;
        const previous=copy(target.config), overrides=[...target.overrides];
        if(key==='product')productChanged(target,g.common.product);
        else if(key==='reference'){
          const asset=g.common.reference.startsWith('result:')?ctx.task().assets.find(a=>a.id===g.common.reference.slice(7)):null;
          if(asset&&asset.product!==target.config.product){toast('公共参考属于其他商品，请选择同 SKU 参考。');break;}
          target.config.reference=g.common.reference;
        }else target.config[key]=copy(g.common[key]);
        target.overrides=target.overrides.filter(k=>k!==key);
        if(key==='prompt'){
          target.promptUndo={prompt:previous.prompt,overrides};
          if(target.config.product!==g.common.product)target.needsFactCheck=true;
        }
        target.shotsConfirmed=false;ctx.production.invalidate(target.config);errors.delete(target.id);persist();render();
        requestAnimationFrame(()=>{
          const control=document.getElementById(`batch-${itemId}-${key}`);
          if(control?.offsetParent!==null)control.focus({preventScroll:true});
          else document.querySelector(`.batch-parameter-menu:has(#batch-${itemId}-${key}) > summary`)?.focus({preventScroll:true});
        });
        toast(`已恢复${fieldNames[key]}，其他独立设置保留。`);break;
      }
      case 'batch-preset': {
        const [scope,index]=id.split(':'), target=scope==='common'?null:currentItem(scope), d=target?.config || (scope==='common'?g.common:null);
        if(!d || target&&!isDraft(target)) break;
        const choices=media==='image'?['简洁暖灰影棚，柔和侧光，主体清晰，画面留白。','自然生活场景，干净背景，保持商品真实比例与结构。','已确认结构的近景特写，柔和侧光，不推断未知材质。']:['先全貌、再细节、最后全貌定格，运镜平稳。','围绕商品缓慢平移，保持颜色与轮廓一致。','镜头平稳推进至已确认细节，以全貌收尾。'];
        appendPrompt(scope, choices[+index]||choices[0]);
        break;
      }
      case 'batch-optimize': case 'batch-analyze': {
        const target = id==='common'?null:item, d = id==='common'?g.common:target?.config;
        if(!d || target&&!isDraft(target) || action==='batch-analyze'&&!d.reference) break;
        const c=cases.find(c=>c.id===d.reference);
        appendPrompt(id,action==='batch-analyze'?(c?.style||'参考当前 SKU 已批准版本的构图与光线。'):`构图适配${d.ratio}，主体清楚，背景克制，保持商品真实轮廓。`);
        break;
      }
      case 'batch-undo': {
        const owner=id==='common'?g:item;
        if(!owner || item&&!isDraft(item) || owner.promptUndo===undefined) break;
        const old=owner.promptUndo, prompt=typeof old==='string'?old:old.prompt;
        if(id==='common') updateCommon('prompt',prompt);
        else {item.config.prompt=prompt;if(old.overrides)item.overrides=[...new Set(old.overrides.map(key=>key==='intent'?'prompt':key))];item.shotsConfirmed=false;ctx.production.invalidate(item.config);}
        delete owner.promptUndo;persist();render();break;
      }
      case 'batch-preview-reference': {
        const d=id==='common'?g.common:item?.config;if(!d?.reference)break;
        const c=cases.find(c=>c.id===d.reference),a=ctx.company.resolve(d.reference)?.asset||ctx.task().assets.find(a=>'result:'+a.id===d.reference),ref=c||a;
        if(!ref)break;
        openModal(ref.name,`<div class="case-preview-image"><img src="${imageSrc(ref.image)}" alt="${esc(ref.name)}"></div><p class="case-preview-style">${esc(c?.style||'同 SKU 已批准版本，保留来源和版本记录。')}</p>${ref.media==='video'?'<p class="case-preview-note">视频分镜示例，当前为静态关键帧与说明，未提供真实视频播放。</p>':''}<p class="case-preview-note">仅借鉴表达，商品外观以当前 SKU 实拍为准。预览不修改提示词、模板或数量。</p>`, '<button class="btn" data-action="close-modal">返回参考选择</button>');break;
      }
      case 'batch-submit': submit(); break;
      case 'batch-retry': { const [itemId, outputId] = id.split(':'), target = currentItem(itemId), output = target?.outputs.find(o => o.id === outputId); if (output?.status === 'failed') { output.resumeStep = output.failedStep; output.status = 'queued'; output.queueAt = Date.now(); syncStatus(target); persist(); pump(); render(); toast('只恢复此失败输出，成功结果与原输入保持不变。'); } break; }
      case 'batch-results': if(item)showPane(id); break;
      case 'batch-record': if (item?.snapshot) record(item); break;
    }
    return true;
  }
  function handleInput(target) {
    if (target.id === 'batch-reference-search') {
      const value = target.value, pos = target.selectionStart;
      referenceFilterState.search = value; render();
      const input = document.getElementById('batch-reference-search'); input?.focus(); input?.setSelectionRange(pos, pos); return true;
    }
    const key = target.dataset.batchField, scope = target.dataset.batchScope;
    if (!key) return false;
    const value = key === 'count' ? (target.value === '' ? '' : Number(target.value)) : target.value;
    if (scope === 'common') { if(key==='prompt')delete group().promptUndo;updateCommon(key,value); }
    else {
      const item = currentItem(scope); if (!item || !isDraft(item)) return true;
      if (key === 'product') productChanged(item, value); else item.config[key] = value;
      if (!item.overrides.includes(key)) item.overrides.push(key);
      if (key === 'prompt') delete item.promptUndo;
      item.shotsConfirmed = false; ctx.production.invalidate(item.config); errors.delete(item.id); persist();
    }
    if (key === 'prompt') {
      const promptSource=document.querySelector('.batch-prompt-source');
      if(promptSource)promptSource.innerHTML=fieldSource(scope==='common'?null:currentItem(scope),'prompt');
      document.querySelectorAll('[data-batch-shots]').forEach(input => { const item = currentItem(input.dataset.batchShots); input.checked = !!item&&ctx.production.confirmed(item.config); });
      const d=scope==='common'?group().common:currentItem(scope)?.config;const button=document.querySelector(`[data-action="batch-optimize"][data-id="${scope}"]`);if(button&&d)button.disabled=!d.prompt.trim();
      // Do not replace a focused text field during Chinese IME composition.
      for (const item of group().items) {
        const card = document.querySelector(`[data-batch-item="${item.id}"]`);
        if (!card) continue;
        card.querySelector('.batch-item-summary p').textContent = promptSummary(item.config);
        card.querySelector('.batch-item-summary p').title = item.config.prompt;
        card.querySelector('.batch-item-summary>span').textContent = `${item.config.ratio} · ${media === 'video' ? item.config.duration + 's · ' : ''}${item.config.count} ${unit(media)}`;
        if (item.promptUndo === undefined && item.id===openItem) document.querySelector('.batch-inspector [data-action=batch-undo]')?.remove();
      }
      if(scope==='common'&&group().promptUndo===undefined)document.querySelector('.batch-inspector [data-action=batch-undo]')?.remove();
      const summary = document.querySelector('.batch-common-heading p'), common = group().common;
      if (summary) summary.textContent = commonSummary(common);
      const heading=document.querySelector('.batch-current-title'), selected=currentItem(openItem);
      if(!commonOpen&&heading&&selected){heading.textContent=itemTitle(selected);heading.title=itemTitle(selected);}
      document.querySelector('[data-shot-status]')?.replaceChildren(document.createTextNode('分镜待确认'));
      refreshCount();
      sizePrompt();
    } else {
      const menu = target.closest('.batch-parameter-menu')?.dataset.parameter;
      render();
      if(menu) document.querySelector(`.batch-parameter-menu[data-parameter="${menu}"] > summary`)?.focus({preventScroll:true});
      else if(target.closest('.batch-inline-parameter')) document.getElementById(target.id)?.focus({preventScroll:true});
    }
    return true;
  }
  function handleChange(target) {
    if (target.id === 'batch-reference-category' || target.id === 'batch-reference-media') {
      referenceFilterState[target.id === 'batch-reference-category' ? 'category' : 'media'] = target.value; render(); document.getElementById(target.id)?.focus({preventScroll:true}); return true;
    }
    if (target.dataset.batchShots) { const item = currentItem(target.dataset.batchShots); if (item && isDraft(item)) {if(!item.config.shots)item.config.shots=ctx.production.defaultShots(item.config);if(target.checked){try{ctx.production.confirm(item.config);}catch(e){target.checked=false;toast(e.message);return true;}}else ctx.production.invalidate(item.config);item.shotsConfirmed=target.checked;persist(); } return true; }
    if (target.dataset.batchFacts) { const item = currentItem(target.dataset.batchFacts); if (item && isDraft(item)) { item.needsFactCheck = !target.checked; item.shotsConfirmed = false; ctx.production.invalidate(item.config); persist(); } return true; }
    if (target.dataset.batchFailure) { const item = currentItem(target.dataset.batchFailure); if (item && isDraft(item)) { item.failureStep = target.value; persist(); } return true; }
    // A blur/change must not replace the button that the user is clicking.
    if (target.dataset.batchField) return true;
    return false;
  }
  for (const t of ctx.state.tasks) ensure(t);
  setTimeout(tick, 0);
  setInterval(tick, 350);
  document.addEventListener('click',event=>{
    for(const menu of document.querySelectorAll('.batch-parameter-menu[open],.batch-more[open],.batch-submit-help[open]')) if(!menu.contains(event.target))menu.open=false;
  });
  function handleKeydown(event) {
    const help=document.querySelector('.batch-submit-help[open]');
    if(event.key==='Escape'&&help){help.open=false;help.querySelector('summary').focus();return true;}
    if(!paneVisible || !document.querySelector('.batch-inspector') || document.querySelector('#overlay-root .overlay'))return false;
    if(event.key==='Escape'){
      const menu=document.querySelector('.batch-parameter-menu[open],.batch-more[open],.batch-submit-help[open]');
      if(menu){menu.open=false;menu.querySelector('summary')?.focus();}
      else hidePane();
      return true;
    }
    if(event.key==='Tab' && matchMedia('(max-width:1099px)').matches){
      const list=[...document.querySelectorAll('.batch-inspector button:not(:disabled),.batch-inspector input,.batch-inspector select,.batch-inspector textarea,.batch-inspector summary')].filter(el=>el.offsetParent!==null),first=list[0],last=list.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
    return false;
  }
  return { render: renderWorkspace, header:renderHeader, handleAction, handleInput, handleChange, handleKeydown,
    getDraft(id){if(id==='common')return group().common;for(const g of Object.values(ensure(ctx.task()))){const item=g.items.find(i=>i.id===id&&isDraft(i));if(item)return item.config;}return null;},
    draftTargets(){return Object.entries(ensure(ctx.task())).flatMap(([type,g])=>g.items.filter(isDraft).map((item,i)=>({key:'batch:'+item.id,name:'批量'+mediaName(type)+' '+(i+1)+' · '+product(item.config.product).sku,draft:item.config})));},
    touch(id){if(id==='common'){const d=group().common;for(const key of ['prompt','model','ratio','quality','duration','count','templateId','templateVersion','template'])updateCommon(key,d[key]);return;}for(const [type,g] of Object.entries(ensure(ctx.task()))){const item=g.items.find(i=>i.id===id&&isDraft(i));if(item){item.overrides=[...new Set([...item.overrides,...settings,'templateId','templateVersion','template'])];item.shotsConfirmed=ctx.production.confirmed(item.config);media=type;openItem=id;paneVisible=true;commonOpen=false;paneView='basic';}}},
    taskChanged() { media = ctx.task().batchMedia || 'image'; openItem = null; commonOpen=false; paneView='basic'; errors.clear(); } };
};
