// Реквизиты оператора читаются с сервера из того же файла, что и кабинет.
// Самозанятому нужны ФИО и ИНН. ОГРН и наименование юрлица у него не требуются.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadOperator() {
  const file = path.join(__dirname, '../../public/legal/operator.js');
  const src = fs.readFileSync(file, 'utf8');
  const window = {};
  vm.runInNewContext(src, { window }, { filename: file });
  return window.SV_LEGAL || {};
}

function missing(value) {
  return value == null || !String(value).trim() || String(value).indexOf('[УКАЖИТЕ') === 0;
}

function operatorGaps(config) {
  const C = config || loadOperator();
  const O = C.operator || {};
  const selfEmployed = String(O.personStatus || '') === 'самозанятый';
  const fields = selfEmployed
    ? [['ФИО', O.personName], ['ИНН', O.inn]]
    : [['название', O.name], ['ИНН', O.inn], ['ОГРН', O.ogrn], ['адрес', O.address], ['почта', O.email]];
  return fields.filter((field) => missing(field[1])).map((field) => field[0]);
}

module.exports = { loadOperator, operatorGaps };
