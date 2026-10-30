'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { splitCents, validateExpense } = require('../src/domain');
test('AA 分摊以分计算且余数可追溯', () => { assert.deepEqual(splitCents(100, ['a','b','c']), [{userId:'a',shareCents:34},{userId:'b',shareCents:33},{userId:'c',shareCents:33}]); });
test('AA 成员不能重复', () => { assert.throws(() => splitCents(100, ['a','a']), /重复/); });
test('AA 必须包含垫付人', () => { assert.throws(() => validateExpense({kind:'aa',amountCents:100,item:'纸',category:'采购',payerId:'a',occurredOn:'2026-01-01',participantIds:['b']}), /垫付人/); });
test('统一报销不产生分摊行', () => { assert.deepEqual(validateExpense({kind:'reimbursement',amountCents:100,item:'纸',category:'采购',payerId:'a',occurredOn:'2026-01-01'}), []); });
