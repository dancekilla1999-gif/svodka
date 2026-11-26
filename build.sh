#!/usr/bin/env bash
# Сборка: release.txt -> сайт в public/, srv.txt -> серверный код в srv/; всё сверяется по sha256
set -euo pipefail
# Плейсхолдеры оператора: в обычной сборке и в CI это предупреждение, регистрация на сайте закрыта.
# Прод-сборка с REQUIRE_OPERATOR=1 для самозанятого требует ФИО, ИНН и почту. ОГРН и наименование юрлица не требуются.
if [ "${REQUIRE_OPERATOR:-}" = "1" ]; then
  node -e '
    const { operatorGaps } = require("./srv/lib/operator");
    const gaps = operatorGaps();
    if (gaps.length) {
      console.error("ERROR: public/legal/operator.js — не заполнено: " + gaps.join(", ") + ". Для самозанятого нужны ФИО, ИНН и почта. ОГРН и наименование не требуются. Пока в этих полях плейсхолдеры [УКАЖИТЕ], прод-сборка останавливается.");
      process.exit(1);
    }
  '
elif grep -q '\[УКАЖИТЕ' public/legal/operator.js; then
  echo "WARNING: public/legal/operator.js содержит плейсхолдеры [УКАЖИТЕ…]. Регистрация закрыта, пока не заполнены ФИО, ИНН и почта самозанятого. Прод-сборка с REQUIRE_OPERATOR=1 остановится." >&2
fi
# Если сайт уже лежит в репозитории (public/ и srv/) — собираем из него без скачивания.
# Иначе — как на проде: скачиваем релиз из Supabase Storage по release.txt/srv.txt.
if [ -d public ] && { [ ! -f srv.txt ] || [ -d srv ]; }; then
  echo "OK: собрано из файлов репозитория ($(find public -type f | wc -l) файлов сайта)"; exit 0
fi
BASE="https://qozyihhlocvgpkchyqsp.supabase.co/storage/v1/object/public"
fetch() { # manifest dir
  while read -r sum bk obj path; do
    [ -z "$path" ] && continue
    mkdir -p "$2/$(dirname "$path")"
    for i in 1 2 3 4; do curl -fsSL "$BASE/$bk/$obj" -o "$2/$path" && break; sleep $((i*2)); done
    echo "$sum  $2/$path" | sha256sum -c --quiet -
  done < "$1"
}
read -r msum mobj < release.txt
curl -fsSL "$BASE/site/$mobj" -o manifest.txt
echo "$msum  manifest.txt" | sha256sum -c --quiet -
rm -rf public && mkdir -p public && fetch manifest.txt public
if [ -f srv.txt ]; then
  read -r ssum sobj < srv.txt
  curl -fsSL "$BASE/site/$sobj" -o srv-manifest.txt
  echo "$ssum  srv-manifest.txt" | sha256sum -c --quiet -
  rm -rf srv && mkdir -p srv && fetch srv-manifest.txt srv
fi
echo "OK: $(wc -l < manifest.txt) файлов сайта, $( [ -f srv-manifest.txt ] && wc -l < srv-manifest.txt || echo 0) серверных"
