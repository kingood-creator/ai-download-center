'use strict';
function splitCents(total, participantIds) {
  if (!Number.isInteger(total) || total <= 0) throw new Error('金额必须为正整数分');
  const ids = [...new Set(participantIds)];
  if (!ids.length || ids.length !== participantIds.length) throw new Error('AA 成员不能为空且不能重复');
  const base = Math.floor(total / ids.length), remainder = total % ids.length;
  return ids.map((userId, index) => ({ userId, shareCents: base + (index < remainder ? 1 : 0) }));
}
function validateExpense(input) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new Error('金额必须大于 0');
  if (!input.item?.trim() || !input.category?.trim() || !input.payerId || !input.occurredOn) throw new Error('请完整填写必填信息');
  if (input.kind === 'aa') {
    const splits = splitCents(input.amountCents, input.participantIds || []);
    if (!splits.some(x => x.userId === input.payerId)) throw new Error('AA 成员必须包含垫付人');
    return splits;
  }
  if (input.kind !== 'reimbursement') throw new Error('未知结算方式');
  return [];
}
module.exports = { splitCents, validateExpense };
