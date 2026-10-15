export const AUXILIARY_MODEL_KEYS = [
  'worlds.qqbot.vision.model',
  'worlds.qqbot.proactive.model',
  'worlds.qqbot.emotion.model',
  'worlds.gaming.watch.model',
];

export function auxiliaryUpdates(payload, model) {
  if (!Array.isArray(payload?.groups)) throw new Error('/api/config 缺少 groups 数组');
  const found = new Set();
  const updates = [];
  for (const entry of payload.groups) {
    const group = entry?.group;
    const properties = group?.schema?.properties;
    if (!properties || typeof group.id !== 'string') continue;
    const values = {};
    for (const key of AUXILIARY_MODEL_KEYS) {
      if (!Object.hasOwn(properties, key)) continue;
      found.add(key);
      if (entry.values?.[key] !== model) values[key] = model;
    }
    if (Object.keys(values).length) updates.push({ group: group.id, values });
  }
  const missing = AUXILIARY_MODEL_KEYS.filter((key) => !found.has(key));
  if (missing.length) throw new Error(`侧调用配置项未声明: ${missing.join(', ')}`);
  return updates;
}

export async function syncAuxiliaryModels(api, model, log = () => {}) {
  if (!model) throw new Error('侧调用模型未配置');
  const res = await api('/api/config');
  if (!res.ok) throw new Error(`GET /api/config HTTP ${res.status}`);
  const updates = auxiliaryUpdates(await res.json(), model);
  for (const update of updates) {
    const saved = await api('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    });
    if (!saved.ok) throw new Error(`更新侧调用 ${update.group} HTTP ${saved.status}`);
    const body = await saved.json();
    if (body.ok !== true) throw new Error(`更新侧调用 ${update.group} 未确认成功`);
    const remaining = auxiliaryUpdates(body, model);
    if (remaining.some((item) => item.group === update.group))
      throw new Error(`侧调用 ${update.group} 写入后读数不匹配`);
  }
  if (updates.length) log(`QQ / gaming 侧调用配置已同步到 ${model}`);
}
