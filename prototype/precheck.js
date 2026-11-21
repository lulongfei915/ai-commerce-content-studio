/* Shared, scripted precheck for the UI prototype. No image/video understanding. */
window.createPrecheck = function ({ product }) {
  const version = 'demo-v1';
  function enqueue(asset, index = 0) {
    const p = product(asset.product);
    asset.status = 'checking';
    asset.adopted = false;
    asset.precheck = {
      mode: 'demo', ruleVersion: asset.snapshot?.templateVersion?'公司模板 V'+asset.snapshot.templateVersion:version, rules:JSON.parse(JSON.stringify(asset.snapshot?.rulesSnapshot||{product:true,person:true,scene:true})), result: 'running',
      sku: p.sku, source: p.evidence, assetVersion: asset.version,
      scenario: index % 3 === 1 ? 'blocked' : 'passed',
      startedAt: Date.now(), dueAt: Date.now() + 1200, dimensions: []
    };
  }
  function initialize(tasks) {
    let changed = false;
    for (const t of tasks) for (const a of t.assets) {
      if (a.precheck) continue;
      // Preserve historical human decisions; do not invent an AI pass record.
      if (['approved', 'rejected'].includes(a.status)) {
        a.precheck = { mode: 'demo', result: 'legacy', dimensions: [] };
      } else {
        const wasBlocked = a.status === 'blocked' || a.id === 'a6';
        const reason = a.reason || a.historyNote || a.legacyReviewReason;
        enqueue(a, wasBlocked ? 1 : 0);
        if (wasBlocked && reason) a.precheck.issue = reason;
      }
      changed = true;
    }
    return changed;
  }
  function tick(tasks) {
    const changed = [];
    for (const t of tasks) for (const a of t.assets) {
      const c = a.precheck;
      if (a.status !== 'checking' || !c || c.dueAt > Date.now()) continue;
      const p = product(a.product);
      c.checkedAt = Date.now();
      if (c.sku !== p.sku || c.source !== p.evidence || c.assetVersion !== a.version) {
        c.result = 'error';
        c.message = '商品依据或素材版本已变化，请按当前资料重新制作。';
        a.status = 'check_failed';
      } else {
        const blocked = c.scenario === 'blocked';
        const personRequired = /人物|模特|穿搭|上身/.test([a.snapshot?.template, a.snapshot?.prompt].join(' '));
        c.result = blocked ? 'blocked' : 'passed';
        c.message = blocked ? (c.issue || '演示问题：商品颜色或结构细节与实拍不一致，需调整后返工。') : '模拟初检通过，仍须人工确认品牌审美与商用一致性。';
        c.dimensions = [
          { name: '商品一致性', result: blocked ? '未通过' : '通过', detail: blocked ? c.message : '颜色、轮廓、结构与可见细节（预设演示）' },
          { name: '人物一致性', result: c.rules?.person===false?'未启用':personRequired ? '通过' : '不适用', detail: c.rules?.person===false?'公司模板未启用此项（预设演示）':personRequired ? '形象与人物商品交互（预设演示，未识别真实人物）' : '当前预设为商品展示样例；正式检查须按实际人物与参考配置执行。' },
          { name: '场景一致性', result: c.rules?.scene===false?'未启用':'通过', detail: c.rules?.scene===false?'公司模板未启用此项（预设演示）':a.media === 'video' ? '场景与跨镜头连续性（预设演示，未分析真实视频）' : '背景、构图与场景要求（预设演示）' }
        ];
        a.status = blocked ? 'blocked' : 'pending';
      }
      a.adopted = false;
      changed.push(a.id);
    }
    return changed;
  }
  const passed = a => a?.precheck?.result === 'passed';
  const canReview = a => !!a && a.status === 'pending' && passed(a);
  // Historical approved versions retain their original decision, visibly marked.
  const canUse = a => !!a && a.status === 'approved' && (passed(a) || a.precheck?.result === 'legacy');
  function retry(asset) {
    if (asset?.status !== 'check_failed') return false;
    const previous = asset.precheck;
    const scenario = previous.scenario, issue = previous.issue;
    enqueue(asset, scenario === 'blocked' ? 1 : 0);
    asset.precheck.issue = issue;
    for (const key of ['sku', 'source', 'assetVersion']) asset.precheck[key] = previous[key];
    return true;
  }
  return { enqueue, initialize, tick, canReview, canUse, retry };
};
