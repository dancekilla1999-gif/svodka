/* Единственное место реквизитов оператора «Сводки».
   Замените каждое значение в квадратных скобках на свои данные и задеплойте заново.
   Тексты политики, согласия, cookies и оферты подставят эти поля сами.
   В браузере это window.SV_LEGAL, в функции Vercel тот же файл подключается через require. */
var SV_LEGAL_ROOT = typeof window !== "undefined" ? window : globalThis;
SV_LEGAL_ROOT.SV_LEGAL = {
  service: "Сводка",
  site: "https://svodka-egor12.vercel.app",
  updated: "26 ноября 2026 г.",
  version: "2026-11-26.3",
  operator: {
    personName: "Егор Бондарев",
    personStatus: "самозанятый",
    name: "[УКАЖИТЕ ПОЛНОЕ НАИМЕНОВАНИЕ]",
    inn: "[УКАЖИТЕ ИНН]",
    ogrn: "[УКАЖИТЕ ОГРН]",
    address: "[УКАЖИТЕ ЮРИДИЧЕСКИЙ АДРЕС]",
    email: "[УКАЖИТЕ EMAIL]",
    phone: "[УКАЖИТЕ ТЕЛЕФОН]"
  },
  supabaseRegion: "ЕС, Германия (Франкфурт), eu-central-1",
  rknNotice: "[УКАЖИТЕ НОМЕР УВЕДОМЛЕНИЯ РКН]",
  rknCrossBorder: "[УКАЖИТЕ УВЕДОМЛЕНИЕ РКН О ТРАНСГРАНИЧНОЙ ПЕРЕДАЧЕ]",
  court: "[УКАЖИТЕ СУД]"
};
if (typeof module !== "undefined" && module.exports) module.exports = SV_LEGAL_ROOT.SV_LEGAL;
