/* Run after serving ui-design over HTTP: node scripts/verify-consistency.cjs.
 * Requires Playwright; set STUDIO_BROWSER_CHANNEL if Chrome is unavailable. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const url = process.env.STUDIO_TEST_URL || 'http://127.0.0.1:8765';
const output = path.resolve(__dirname, '../output/consistency');
fs.mkdirSync(output, {recursive:true});
const results=[];
const errors=[];
function pass(name){results.push(name);console.log('PASS',name);}
async function saved(page){return page.evaluate(()=>JSON.parse(localStorage.getItem('zaowu-ui-v1')));}
async function current(page){const s=await saved(page);return s.tasks.find(t=>t.id===s.task);}
async function openPurpose(page, purpose){
  await page.locator('.style-menu > summary').click();
  await page.locator('[data-field="purpose"]').selectOption(purpose);
}
async function close(page){await page.locator('.overlay .modal-header [data-action="close-modal"]').click();}
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.STUDIO_BROWSER_CHANNEL||'chrome'});
 try{
 const context=await browser.newContext({viewport:{width:1440,height:900}});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.waitForLoadState('networkidle');
 await page.locator('.media-menu > summary').click();
 await page.locator('[data-action="media"][data-id="video"]').click();
 await openPurpose(page,'clip');
 const before=await current(page);const planCount=before.deliveryPlan.length;
 await page.locator('[data-action="generate"]').click();
 assert.equal(await page.locator('#confirm-shots').count(),0);
 await page.locator('[data-action="confirm-generate"]').click();
 await page.waitForFunction(()=>{const s=JSON.parse(localStorage.getItem('zaowu-ui-v1'));return s.tasks.find(t=>t.id===s.task).assets.some(a=>a.purpose==='clip');});
 let t=await current(page);const clip=t.assets.find(a=>a.purpose==='clip');
 assert.equal(clip.media,'video');assert.equal(t.deliveryPlan.length,planCount);assert.equal(t.deliveryPlan.some(r=>r.purpose==='clip'),false);
 pass('快捷片段无需分镜即可生成，且不增加交付位置');
 await page.reload();await page.waitForLoadState('networkidle');
 assert.equal((await current(page)).draft.purpose,'clip');pass('刷新后片段用途和草稿保留');
 await page.waitForFunction(()=>{const s=JSON.parse(localStorage.getItem('zaowu-ui-v1'));return s.tasks.find(t=>t.id===s.task).assets.some(a=>a.purpose==='clip'&&a.status==='pending');});
 const reviewClip=(await current(page)).assets.find(a=>a.purpose==='clip'&&a.status==='pending');
 await page.locator(`[data-action="asset-detail"][data-id="${reviewClip.id}"]`).first().click();
 await page.locator('[data-action="approve"]').click();
 assert.equal(await page.locator('[data-action="adopt"]').isDisabled(),true);assert.match(await page.locator('[data-action="adopt"]').innerText(),/片段不计成片交付/);await close(page);
 pass('片段通过初检和人工批准后仍不能采用到成片交付');
 await openPurpose(page,'video');
 await page.locator('[data-action="generate"]').click();
 await page.locator('[data-action="confirm-generate"]').click();
 assert.match(await page.locator('#generation-error').innerText(),/请先确认分镜/);
 await page.locator('#confirm-shots').check();await page.locator('[data-action="confirm-generate"]').click();
 await page.waitForFunction(()=>{const s=JSON.parse(localStorage.getItem('zaowu-ui-v1'));return s.tasks.find(t=>t.id===s.task).assets.some(a=>a.snapshot?.shotSignature);});
 pass('快捷带货成片阻止未确认生成，确认后生成并保存分镜快照');
 // Reference selection must not change the input, template or count.
 const preserved=(await current(page)).draft;
 await page.locator('[data-action="browse-cases"]').first().click();
 await page.locator('#case-picker-search').fill('全貌');
 await page.locator('#case-picker-media').selectOption('video');
 await page.locator('#case-picker-category').selectOption('鞋服');
 assert.equal(await page.locator('.case-picker-preview').count(),1);
 await page.locator('.case-picker-preview').click();
 assert.equal(await page.locator('.case-shot-list').count(),1);
 await page.locator('[data-action="add-case"]').click();
 await page.locator('[data-action="case-picker-back"]').click();
 assert.equal(await page.locator('#case-picker-search').inputValue(),'全貌');
 assert.equal(await page.locator('#case-picker-media').inputValue(),'video');
 assert.equal(await page.locator('#case-picker-category').inputValue(),'鞋服');
 await close(page);
 t=await current(page);assert.equal(t.draft.prompt,preserved.prompt);assert.equal(t.draft.templateId,preserved.templateId);assert.equal(t.draft.count,preserved.count);assert.ok(t.draft.references.includes('c5'));
 pass('快捷案例搜索、组合筛选、视频预览及引用有效，返回保留筛选且不改提示词/模板/数量');
 await page.locator('[data-action="browse-cases"]').first().click();
 await page.locator('#case-picker-search').fill('不存在的案例');assert.equal(await page.locator('.case-picker-preview').count(),0);
 await page.locator('#case-picker-search').fill('色彩');assert.equal(await page.locator('[data-action="add-case"][data-id="c4"]').isDisabled(),true);
 await page.locator('.case-picker-preview').click();assert.equal(await page.locator('.case-restriction').count(),1);assert.equal(await page.locator('.case-reference').isDisabled(),true);await close(page);
 pass('案例空结果有反馈，授权待确认案例可预览但不可引用');
 // Canvas uses the same draft and picker, and must not leave the canvas boundary.
 await page.locator('[data-action="view"][data-id="canvas"]').click();
 await page.locator('[data-action="edit-node"][data-id="g1"]').click();
 await openPurpose(page,'clip');
 await page.locator('[data-action="generate"]').click();assert.equal(await page.locator('#confirm-shots').count(),0);await close(page);
 await page.locator('[data-action="browse-cases"]').first().click();
 await page.locator('#case-picker-category').selectOption('美妆个护');await page.locator('#case-picker-media').selectOption('image');
 assert.equal(await page.locator('.case-picker-preview').count(),2);
 const bounds=await page.evaluate(()=>{const c=document.querySelector('.canvas-workspace').getBoundingClientRect(),m=document.querySelector('.overlay .modal').getBoundingClientRect();return{canvas:{x:c.x,right:c.right,y:c.y,bottom:c.bottom},modal:{x:m.x,right:m.right,y:m.y,bottom:m.bottom}};});
 assert.ok(bounds.modal.x>=bounds.canvas.x-1 && bounds.modal.right<=bounds.canvas.right+1);
 await page.screenshot({animations:'disabled',path:path.join(output,'canvas-cases-desktop.png')});
 await close(page);await page.locator('[data-action="view"][data-id="page"]').click();
 assert.equal((await current(page)).draft.purpose,'clip');
 pass('画布支持片段、共享案例筛选，弹层保留在画布内，切回快捷不丢草稿');
 // Batch: all drafts are clips and must submit without storyboard confirmation.
 await page.locator('[data-action="view"][data-id="batch"]').click();
 await page.locator('[data-action="batch-media"][data-id="video"]').click();
 await page.locator('[data-action="batch-common"]').click();await page.locator('[data-action="batch-pane-view"][data-id="context"]').click();
 await page.locator('[data-batch-field="purpose"]').selectOption('clip');
 await page.locator('[data-action="batch-pane-view"][data-id="basic"]').first().click();await page.locator('[data-action="batch-close"]').click();
 await page.locator('[data-action="batch-edit"]').first().click();
 assert.equal(await page.locator('.batch-storyboard-link').count(),0);
 await page.locator('[data-action="batch-pane-view"][data-id="reference"]').first().click();
 const beforeReference=(await current(page)).batches.video.items[0].config;
 await page.locator('#batch-reference-search').fill('全貌');await page.locator('#batch-reference-category').selectOption('鞋服');await page.locator('#batch-reference-media').selectOption('video');
 const select=page.locator('[data-batch-field="reference"]');assert.equal(await select.locator('option').count(),2);
 await select.selectOption('c5');
 await page.locator('[data-action="batch-preview-reference"]').last().click();assert.match(await page.locator('.modal-body').innerText(),/视频分镜示例/);await close(page);
 await page.locator('#batch-reference-search').fill('找不到');
 assert.equal(await select.inputValue(),'c5');assert.match(await select.locator('option:checked').innerText(),/筛选范围外/);
 t=await current(page);assert.equal(t.batches.video.items[0].config.prompt,beforeReference.prompt);assert.equal(t.batches.video.items[0].config.count,beforeReference.count);
 await page.screenshot({animations:'disabled',path:path.join(output,'batch-reference-desktop.png')});
 pass('批量案例组合筛选与预览有效，已选参考在筛选范围外仍保留，不改提示词/数量');
 await page.locator('[data-action="batch-submit"]').click();
 assert.equal((await current(page)).batches.video.items.every(i=>i.status!=='draft'),true);
 pass('批量片段无需分镜即可提交全部未提交项');
 await page.waitForFunction(()=>{const s=JSON.parse(localStorage.getItem('zaowu-ui-v1'));return s.tasks.find(t=>t.id===s.task).batches.video.items.every(i=>i.status==='complete');});
 t=await current(page);assert.equal(t.deliveryPlan.length,planCount);assert.equal(t.assets.filter(a=>a.batchItem).every(a=>a.purpose==='clip'&&!a.adopted),true);
 pass('批量片段完成后独立初检，保持非交付素材');
 await page.locator('[data-action="batch-add"]').click();
 await page.locator('[data-action="batch-pane-view"][data-id="context"]').click();await page.locator('[data-batch-field="purpose"]').selectOption('video');
 await page.locator('[data-action="batch-pane-view"][data-id="basic"]').first().click();await page.locator('[data-action="batch-submit"]').click();
 assert.match(await page.locator('.batch-errors').innerText(),/确认带货成片的分镜/);
 await page.locator('.batch-storyboard-link').click();await page.locator('[data-batch-shots]').check();await page.locator('[data-action="batch-pane-view"][data-id="basic"]').first().click();
 await page.locator('[data-action="batch-pane-view"][data-id="context"]').click();await page.locator('[data-batch-field="purpose"]').selectOption('clip');await page.locator('[data-batch-field="purpose"]').selectOption('video');
 await page.locator('[data-action="batch-pane-view"][data-id="basic"]').first().click();assert.match(await page.locator('[data-shot-status]').innerText(),/待确认/);
 pass('批量带货成片仍强制确认分镜，改变用途后原确认失效');
 // Small-screen controls: search, preview and backdrop remain usable.
 for(const width of [390,320]){
   const small=await browser.newContext({viewport:{width,height:844}});const p=await small.newPage();p.on('pageerror',e=>errors.push(e.message));
   await p.goto(url);await p.waitForLoadState('networkidle');await p.locator('[data-action="browse-cases"]').first().click();await p.locator('#case-picker-media').selectOption('video');
   await p.locator('.case-picker-preview').click();await p.locator('[data-action="case-picker-back"]').click();assert.equal(await p.locator('#case-picker-media').inputValue(),'video');
   assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.ok(await p.locator('.case-picker-card .grow').evaluate(el=>el.getBoundingClientRect().width>100));
   await p.screenshot({animations:'disabled',path:path.join(output,`case-picker-${width}.png`)});await close(p);
   await p.locator('[data-action="view"][data-id="batch"]').click();await p.locator('[data-action="batch-edit"]').first().click();await p.locator('[data-action="batch-pane-view"][data-id="reference"]').first().click();
   await p.locator('#batch-reference-search').fill('全貌');await p.locator('#batch-reference-media').selectOption('video');assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await p.screenshot({animations:'disabled',path:path.join(output,`batch-reference-${width}.png`)});await small.close();
 }
 pass('390px/320px 下快捷及批量参考筛选与预览可用，无页面横向溢出');
 assert.deepEqual(errors,[]);pass('浏览器无未处理脚本错误');
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({date:'2026-11-20',url,browser:`Chrome ${browser.version()} via Playwright`,checks:results,errors},null,2));
 console.log(`${results.length} checks passed. Evidence: ${output}`);
 await context.close();
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
