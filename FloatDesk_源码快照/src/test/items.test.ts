import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameProjectMatches } from '../shared/items';

const item = (id: string, name: string, type: string, target: string) => ({ id, name, type, target });

test('同名 + 同目标 + 同类型才算相同项目（排除自己）', () => {
  const scenes = [
    { items: [item('a', 'GitHub', 'web', 'https://github.com'), item('b', '别的', 'web', 'https://x.com')] },
    { items: [item('c', 'GitHub', 'web', 'https://github.com')] },
  ];
  const m = sameProjectMatches(scenes, item('a', 'GitHub', 'web', 'https://github.com'));
  assert.deepEqual(m.map((x) => x.id), ['c']);
});

test('名称不同 / 目标不同 / 类型不同都不算相同', () => {
  const scenes = [
    { items: [item('a', '同名不同目标', 'web', 'https://a.com')] },
    { items: [item('x', '同名不同目标', 'web', 'https://b.com')] },
    { items: [item('y', '另一个名', 'web', 'https://a.com')] },
    { items: [item('z', '同名不同目标', 'file', 'https://a.com')] },
  ];
  assert.deepEqual(sameProjectMatches(scenes, item('a', '同名不同目标', 'web', 'https://a.com')), []);
});

test('没有相同项目时返回空数组', () => {
  const scenes = [{ items: [item('a', '唯一', 'app', '/Applications/A.app')] }];
  assert.deepEqual(sameProjectMatches(scenes, item('a', '唯一', 'app', '/Applications/A.app')), []);
});

test('同一场景内的相同项目也会被匹配到', () => {
  const scenes = [{ items: [item('a', '重复', 'web', 'https://r.com'), item('b', '重复', 'web', 'https://r.com')] }];
  assert.deepEqual(sameProjectMatches(scenes, item('a', '重复', 'web', 'https://r.com')).map((x) => x.id), ['b']);
});

test('空名称不匹配任何项目（防止空项目互相污染）', () => {
  const scenes = [{ items: [item('a', '', 'web', ''), item('b', '', 'web', '')] }];
  assert.deepEqual(sameProjectMatches(scenes, item('a', '', 'web', '')), []);
});

test('输入非法时安全返回空数组', () => {
  assert.deepEqual(sameProjectMatches(null as any, item('a', 'x', 'web', '')), []);
  assert.deepEqual(sameProjectMatches([{ items: null as any }], item('a', 'x', 'web', '')), []);
});
