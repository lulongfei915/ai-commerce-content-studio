import { useState } from 'react';

import { uploadMedia } from '../../shared/api/upload';
import { Modal } from '../../shared/ui/Modal';
import { actionError } from '../creation/api';
import type { Category } from '../products/api';
import { CaseBrowser } from './CaseBrowser';
import { licenseCase, saveCase } from './api';
import type { CreativeCase, UsagePurpose } from './api';

export function CaseLibrary({
  categories,
  token,
  canManage,
  canPlayVideo,
}: {
  categories: Category[];
  token: string;
  canManage: boolean;
  canPlayVideo: boolean;
}) {
  const [editor, setEditor] = useState<CreativeCase | 'new'>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [upload, setUpload] = useState<{ file: File; id: string }>();
  function open(item: CreativeCase | 'new') {
    setEditor(item);
    setError('');
    setUpload(undefined);
  }
  return (
    <>
      {canManage && (
        <div className="work-actions">
          <button
            type="button"
            className="work-primary"
            disabled={!categories.length}
            onClick={() => open('new')}
          >
            新增案例
          </button>
        </div>
      )}
      <CaseBrowser
        categories={categories}
        revision={revision}
        canPlayVideo={canPlayVideo}
        onEdit={canManage ? open : undefined}
      />
      {editor && (
        <Modal
          title={editor === 'new' ? '新增案例' : '编辑案例授权'}
          onClose={() => setEditor(undefined)}
          busy={busy}
        >
          <form
            className="work-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              const form = new FormData(event.currentTarget);
              const scope = String(form.get('scope') ?? '').trim() || null;
              const purposes = form.getAll('purposes') as UsagePurpose[];
              if (scope && !purposes.length) {
                setError('请选择授权用途。');
                return;
              }
              setBusy(true);
              setError('');
              void (async () => {
                if (editor !== 'new') return licenseCase(token, editor, scope, purposes);
                const file = form.get('file');
                if (!(file instanceof File) || !file.size) throw new Error('请选择案例文件。');
                const file_id =
                  upload &&
                  upload.file.name === file.name &&
                  upload.file.lastModified === file.lastModified &&
                  upload.file.size === file.size
                    ? upload.id
                    : await uploadMedia(file, token);
                setUpload({ file, id: file_id });
                return saveCase(token, {
                  name: String(form.get('name')),
                  file_id,
                  source: String(form.get('source')),
                  category: String(form.get('category')) as Category['id'],
                  usage_scope: scope,
                  usage_purposes: purposes,
                });
              })()
                .then(() => {
                  setEditor(undefined);
                  setRevision((item) => item + 1);
                })
                .catch((cause: unknown) => setError(actionError(cause)))
                .finally(() => setBusy(false));
            }}
          >
            <fieldset className="work-form" disabled={busy}>
              {editor === 'new' && (
                <>
                  <label>
                    案例名称
                    <input name="name" required maxLength={120} />
                  </label>
                  <label>
                    案例品类
                    <select name="category">
                      {categories.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    案例来源
                    <input name="source" required maxLength={300} />
                  </label>
                  <label>
                    案例文件
                    <input
                      name="file"
                      type="file"
                      required
                      accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                    />
                  </label>
                </>
              )}
              <label>
                确认的使用范围
                <input
                  name="scope"
                  maxLength={300}
                  defaultValue={editor === 'new' ? '' : (editor.usage_scope ?? '')}
                />
              </label>
              <div className="work-options">
                {(
                  [
                    { id: 'main', label: '主图' },
                    { id: 'detail', label: '详情素材' },
                    { id: 'video', label: '带货视频' },
                  ] as const
                ).map((item) => (
                  <label className="work-check" key={item.id}>
                    <input
                      type="checkbox"
                      name="purposes"
                      value={item.id}
                      defaultChecked={editor !== 'new' && editor.usage_purposes?.includes(item.id)}
                    />
                    {item.label}
                  </label>
                ))}
              </div>
              <p className="work-muted">使用范围为空时，案例只能浏览。</p>
            </fieldset>
            {error && (
              <p role="alert" className="work-error">
                {error}
              </p>
            )}
            <div className="work-actions">
              <button type="submit" disabled={busy} className="work-primary">
                保存案例
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
