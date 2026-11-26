// Реквизиты оператора читаются с сервера из того же файла, что и кабинет.
// require нужен, чтобы файл попал в бандл функции Vercel, а не только читался с диска.
// Самозанятому нужны ФИО, ИНН и почта. ОГРН и наименование юрлица у него не требуются.
const operatorConfig = require('../../public/legal/operator.js');

function loadOperator() {
  return operatorConfig || {};
}

function missing(value) {
  return value == null || !String(value).trim() || String(value).indexOf('[УКАЖИТЕ') === 0;
}

function operatorGaps(config) {
  const C = config || loadOperator();
  const O = C.operator || {};
  const selfEmployed = String(O.personStatus || '') === 'самозанятый';
  const fields = selfEmployed
    ? [['ФИО', O.personName], ['ИНН', O.inn], ['почта', O.email]]
    : [['название', O.name], ['ИНН', O.inn], ['ОГРН', O.ogrn], ['адрес', O.address], ['почта', O.email]];
  return fields.filter((field) => missing(field[1])).map((field) => field[0]);
}

module.exports = { loadOperator, operatorGaps };
