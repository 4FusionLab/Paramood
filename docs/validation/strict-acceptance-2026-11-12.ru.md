# Независимая приёмка релиз-кандидата — 12 ноября 2026

[English](strict-acceptance-2026-11-12.md)

**Вердикт: NO-GO. Воспроизведены два блокера P1 и один дефект P2.** Зелёные автоматические проверки не отменяют непреднамеренную запись в модель и откат операции после сообщения об успехе.

## Идентичность кандидата и доказательств

- Базовый HEAD: `5d98ff2568a5a46c9f4b80d4cadbcbcf2668b549` — опубликованный 2.1.0.
- Проверена вся начальная незакоммиченная рабочая копия, включая untracked исходники, тесты и документы. Новый checkout/worktree не создавался; commit, push, tag, release и deployment не выполнялись.
- [Манифест идентичности](strict-acceptance-2026-11-12.identity.json) содержит все 32 изменённых/новых файла и их SHA-256. Общий SHA-256 кандидата: `60991887782bf7e5b89cb4796ed5105fc6b2b6c8f8c0bdc2a4d6f3d0df47ddb3`. Он рассчитан по HEAD и отсортированным записям `путь + NUL + SHA файла + LF`.
- Ни один из зафиксированных файлов во время приёмки не изменился. Настоящие отчёты и evidence добавлены отдельно и не входят в исходную идентичность RC.
- Свежий локальный тестовый пакет `Paramood-2.1.0.zip`: SHA-256 `c4f9a6d864995c2cc9944a63b9c384a4e8d0c5341e2a00c7aabb6ce00a033676`. Две новые сборки дали одинаковый checksum; старый ZIP не переиспользован.
- **Версия 2.1.0 подставлена исключительно для проверки упаковки.** Это не новая опубликованная версия/RC. В исходном manifest остаётся 1.3.1; CI подставляет вычисленную версию. Существующие notes 2.1.0 прошли механический контракт архива, но не являются проверенными release notes этих новых изменений.
- [Компактные evidence](strict-acceptance-2026-11-12.evidence.json): 23 нативных снимка состояния, ответы bridge, настоящие запросы палитры и fingerprints документов. CAD entity tokens и названия личных документов исключены.

## Блокеры и дефекты

### RC-01 — P1: ввод поискового запроса превращается в изменение модели

**Воспроизведено полным UI E2E установленной палитры в Fusion 2706.1.17 на macOS; отдельно в browser fixture, 3 из 3 прогонов.**

1. В своей временной модели установить `baseline=50 mm`, открыть inline-редактор и оставить его открытым.
2. Открыть поиск лупой.
3. Набрать `523` обычными отдельными нажатиями клавиш.
4. После первого символа в поиске остаётся `5`, совпадающая с выражением baseline. Фокус переходит обратно в редактор, где выделяется прежнее значение.
5. Оставшиеся `23` заменяют выражение. Нажать Enter.

Ожидается: запрос `523`, параметр и черновик редактора неизменны. Фактически настоящая палитра отправляет `parameters.apply`, текст `baseline=23 mm`, request `pm-mwcml7m8-ibrz8cwpey-52`; readback Fusion подтверждает **23 mm**. Подменённых ответов bridge и прямой записи адаптером в этом воспроизведении не было.

Минимальный браузерный сценарий: открыть редактор `box=8 mm`, подождать 400 мс, открыть поиск, набрать `box` с интервалом 150 мс. Три независимых reload дали `{query: 'b', expression: 'ox', focus: 'Expression for box'}`. Пауза перед поиском исключает объяснение только незавершённым первоначальным autofocus редактора.

Ответственный код: `frontend/src/parameter-list.tsx:441–446` при первом непустом запросе заменяет `AnimatedList` непосредственными Branch и пересоздаёт редактор; `frontend/src/editor.tsx:408–410` при монтировании выделяет значение и забирает фокус. Причинная связь выведена из кода и наблюдаемого перехода фокуса. Зелёные тесты не проверили обычный последовательный клавиатурный ввод.

### RC-02 — P1: rename и Favorites возвращают success и откатываются вместе с Circle

**Настоящий установленный HtmlHandler и данные Fusion на macOS. Запросы передавались из Python-консоли реальному обработчику, без прямой записи адаптером; ввод этих запросов через палитру отдельно не повторялся.**

1. В принадлежащем приёмке эскизе запустить `CircleCenterRadius`.
2. Отправить `parameters.rename` с актуальной идентичностью: `tray_depth → tray_height`.
3. Получить `ok: true`, `renamed: tray_height`; параметр действительно переименован, Circle ещё активен.
4. Вызвать документированный `terminateActiveCommand()`, без Undo, удаления или смены документа.
5. `tray_height` исчезает, возвращается `tray_depth`. Document и Design те же.

Независимое повторение с `parameters.favorite`, `box: false → true`: обработчик возвращает `ok: true`, во время Circle нативный флаг true, после завершения команды — false.

Ожидается: успешная операция сохраняется после завершения/отмены native command либо отвергается до записи. Фактически подтверждается временное изменение внутри транзакции native command.

Evidence: `rename-during-circle`, `rename-after-circle-termination`, `favorite-during-circle`, `favorite-after-circle`; request IDs `strict-circle-rename`, `strict-circle-favorite`.

Ответственный код: `Paramood/Paramood.py:190–193` принудительно направляет в отдельную транзакцию только `parameters.apply`; `:240–255` сохраняет direct dispatch для rename/Favorites при доступном снимке выделения. Дефект существовал ранее либо использует тот же механизм, что прежний откат Apply; это не снимает его влияния на готовность RC. Этим воспроизведением **не доказаны ни безопасность, ни поломка** delete, variants или document.units.

### RC-03 — P2: фильтр меняет групповую операцию на одиночную

**Воспроизведено полным UI E2E Fusion и захватом браузерного запроса.**

Создать `box` с комментарием `needle` и потомка `box_width` без такого комментария. Без фильтра действие называется `Rename group box`. Поиск `needle` скрывает потомка и превращает строку в `Rename box`. Переименование отправляет `parameters.rename` вместо `parameters.renameGroup`, оставляя `box_width` в прежней группе.

Нативный сценарий использовал эквивалентные позднейшие имена `case` и `case_width`: настоящий запрос изменил только `case → casefiltered`; readback показал `case_width = casefiltered * 2`. Формула следует за сущностью, но поддерево не переносится. Ожидается сохранение идентичности полной группы и области операции независимо от фильтра. Те же данные определяют одиночный drag; это следствие подтверждено кодом, отдельный native filtered drag не выполнялся.

Ответственный код: `frontend/src/parameter-list.tsx:94`, `:132` выводит тип группы из отфильтрованных `node.children`; `parameter-search.ts` удаляет несовпавших потомков; `parameter-drag.ts:174–179` использует полученную проекцию.

## Матрица рисков и приёмки

PASS относится только к указанному уровню доказательств. NOT TESTED не означает PASS.

| Риск / требование | Offline | Browser fixture | Native macOS | Результат и границы |
| --- | --- | --- | --- | --- |
| Весь dirty tree, untracked, контроль дрейфа | PASS | — | — | 32 файла, дрейфа нет |
| Ruff format/lint, Prettier, ESLint | PASS | — | — | Только проверки, без форматирования RC |
| Python/core/frontend регрессии | PASS | — | — | 560 + 22 subtests / 50 / 270 |
| TypeScript, Vite production build, ZIP | PASS | — | — | Свежий детерминированный ZIP; весь Python совпадает с исходниками |
| Свёрнутый поиск; лупа, X, Escape, повторная лупа | PASS | PASS | PASS, UI | Плавающее окно и восстановленное правое закрепление; после Escape виден фокус лупы |
| Кириллица, native/dotted path, выражение | PASS | PASS | PASS для кириллического комментария, UI | Остальные категории нативно не повторены полностью |
| Пустая выдача и контекст предков | PASS | PASS | PASS, UI | `no-match-strict`, `Толщина` |
| Поиск с открытым inline-редактором | Тесты зелёные | **FAIL** | **FAIL, UI** | RC-01, реальная непреднамеренная запись |
| Сохранение группового rename/drag при фильтрации | Тесты зелёные | **FAIL** | **FAIL rename, UI** | RC-03; filtered drag проверен по коду |
| Возврат раскрытия и scroll у конца списка, Favorites открыты | PASS | PASS | NOT TESTED на большом списке | Браузер: группа из 90 элементов, восстановление конечного scroll 1989 px |
| Узкая/минимальная/широкая палитра | PASS | PASS, 300/360/960 px | PASS, 360 px | Native wide/minimum отдельно не повторены |
| Light/dark/reduced motion | PASS | PASS | Только dark | Браузерные light/reduced-motion media и dark; без native light/reduced-motion claims |
| Фокус, ARIA, последовательный клавиатурный ввод | PASS | **FAIL** | **FAIL** | Открытие/закрытие проходят, RC-01 блокирует общую приёмку фокуса |
| Delete hover/focus без layout shift | PASS | PASS для hover | NOT TESTED динамически | Прямоугольник значения одинаков; opacity 0 → 1; keyboard/touch runtime отдельно не повторены |
| Delete на touch | Правило CSS есть | NOT TESTED | NOT TESTED | Реальное touch-устройство/контекст здесь не проверены |
| Только Favorites в пользовательских строках | PASS, ревью | PASS | PASS визуально | Native `isFavorite` сохранён |
| Units — span; никаких type controls/disclaimers | PASS | PASS | PASS визуально | Переключатель единиц документа сохранён; per-parameter mutation отсутствует |
| Group rename, собственное значение, кириллица, формулы/identity/метаданные | PASS | — | PASS, настоящий handler | `box → коробка → case`; токены, комментарий, favorite и формулы сохранены |
| Сохранённые variants/text при group rename | PASS | — | PASS, настоящий handler | Числовые/text ячейки и колонки; формула переписана, текст сохранён |
| Stale состав/выражение группы, параллельные запросы | PASS | — | PASS, настоящий handler | Без записи; stale отвергнут, второй запрос получил BUSY |
| Атомарность при поздней ошибке группы | PASS | — | PASS, диагностика | Внедрён отказ metadata store после rename, вся транзакция откатилась; hook восстановлен |
| Единый group Undo/Redo вне эскиза | PASS | — | PASS, native commands | Имена, формула и колонки variants откатываются/возвращаются вместе |
| Отдельный group Undo внутри открытого эскиза | — | — | NOT DEMONSTRATED | Ранние пробы не показали откат модели; заявлен только результат вне эскиза |
| Group drag, root drop, перенос параметра за имя | PASS | Браузерная попытка неубедительна | PASS, UI | Перенос группы, возврат в корень, `tray_depth → case_depth`; токены разрешаются |
| Drop внутрь своего поддерева | PASS | — | PASS, UI | `Choose a different group`, переноса нет |
| Занятые группы, все конфликты/пустой состав | PASS в тестах | NOT TESTED исчерпывающе | NOT TESTED исчерпывающе | Mock не считается native coverage |
| Завершающий semicolon и цепочки batch | PASS | — | PASS, UI/handler | Настоящий UI: `ui_new=11mm;ui_half=ui_new/2;baseline=50mm;` |
| Apply во время Circle: new/update/mixed/text | PASS | — | PASS, настоящий handler | Circle заканчивается, эскиз открыт, значения и цепочки сохранены |
| Apply кнопкой настоящей палитры во время Circle | — | — | PASS, UI E2E | Захвачен исходящий request; native readback 11/5.5/50 mm |
| Следующий Circle, реальный Escape из canvas, Finish Sketch | — | — | PASS для UI-цепочки | `ui_new/ui_half` сохранены; завершённый API-круг остаётся |
| Ненулевой неподтверждённый Circle preview, остальные native commands | — | — | NOT TESTED | Сохранение preview не обещается; выбранное поведение его отбрасывает |
| Durability rename/Favorites во время Circle | — | — | **FAIL, настоящий handler** | RC-02 |
| Durability delete/variants/document.units при native command | Прежние тесты | — | NOT TESTED | Отдельные рискованные пути, фикс Apply их не доказывает |
| Единый Undo/Redo создания batch вне эскиза | PASS | — | PASS, UI | `undo_probe` и `undo_half` вместе исчезают/возвращаются клавиатурным Undo/Redo |
| Сохранение выделения | PASS | — | PASS, API/handler | Выделенный круг, количество и конкретная сущность сохранены после Apply |
| Смена документа / stale document | PASS | — | PASS, handler | STALE_DOCUMENT; probe не появился ни в одном своём документе |
| F3D save/reopen, cold restart, полная переустановка ZIP | Старые evidence не переиспользованы | — | NOT TESTED в этом прогоне | Native использовал текущие исходники и новый production build |
| Native Windows / локальная Node 22 / CI на трёх ОС для dirty RC | — | — | NOT TESTED | Локально Python 3.14.5, Node 26.9.0, macOS; удалённый CI не запускался |
| Защита документов пользователя и уборка | — | — | PASS | Все три fingerprint, counts, timeline и modified flags совпали; закрыты только свои TEMP |

## Автоматические проверки, пакет и безопасность

Независимо выполнены `npm ci --prefix frontend`; Ruff 0.17.3 format check и lint; Python compileall; pytest; root tests; frontend Prettier check, ESLint, Vitest; TypeScript/Vite build; сборка ZIP; release contract. Изменяющие форматтеры сознательно заменены на check-варианты ради неизменности RC.

Результат: **560 Python + 22 subtests; 50 root JS; 270 frontend в 15 файлах** — всё PASS. Локально Python 3.14.5, Node 26.9.0. В CI настроены Node 22 и три ОС, но этот dirty tree туда не отправлялся.

ZIP: 27 записей, новый `fusion/parameter_groups.py` включён; manifest 2.1.0, `windows|mac`, `runOnStartup: true`; каждый Python-файл архива совпал с текущим исходником. Ссылки на frontend assets разрешаются. Нет pycache, bytecode, DS_Store, node_modules, Git/env-файлов; проверенные шаблоны machine paths/private keys/GitHub tokens совпадений не дали. Это ограниченная проверка шаблонами, а не доказательство отсутствия произвольного секрета.

Production dependency audit: ноль известных уязвимостей. Полный аудит при установке: семь moderate в dev dependencies; автоматических изменений зависимостей не было. Ручное ревью проверило escaping поиска, document identity, stale validation, транзакции групп и состав пакета; нового исполняемого входного канала в поиске не найдено. RC-01 нарушает корректность/целостность данных при формально правильном bridge request: проверка identity не распознаёт ввод, попавший не в то поле.

## Точность документации и независимые оси ревью

USER_GUIDE корректно описывает завершение активной native command при Apply и потерю неподтверждённого preview, а также ограничивает проверенный охват команд. Circle-параграф дополнен общей границей. PARAMETER_UNITS остаётся исследованием и не обещает реализованный редактор типа/единиц. Общее обещание сохранения editing/rename/drag при поиске станет достоверным только после исправления RC-01/RC-03. Прежние validation reports использованы как указатели, не как доказательства этой приёмки.

**Standards:** независимый reviewer нашёл одно нарушение документированного требования: проекция группы меняет scope rename/drag — RC-03. Самостоятельных блокирующих Fowler smells и иных подтверждённых нарушений стандартов/безопасности не сообщил. Native транзакции были за пределами его ревью.

**Spec:** независимый reviewer также выявил RC-03 и кандидат на усиление backend: ручной rename полного префикса допускает слияние с занятой группой или добавление собственного префикса, если точные имена не конфликтуют. Mock-воспроизведение есть. Здесь кандидат **не посчитан подтверждённым дефектом**: запрет занятой группы/self-subtree в руководстве сформулирован именно для drop, а ручной full-prefix rename имеет более широкий контракт. Прежде чем объявлять release requirement, нужно уточнить желаемую политику ручного rename. Native self-subtree drag независимо отвергнут правильно.

## Уборка, остаточный риск и решение

Использованы два новых принадлежащих приёмке TEMP-документа; оба закрыты без сохранения. Три прежних документа не изменялись, не сохранялись и не закрывались. Их fingerprints полностью совпали с начальными, modified flags остались true, counts параметров 16/24/6, timeline 5/9/1. Исходный активный документ восстановлен. Runtime observers и failure injection восстановлены/удалены, возвращены исходные right docking и URL палитры; Run on Startup сохранён.

**Выпуск блокируют RC-01 и RC-02; RC-03 также нарушает согласованный scope поиска/групп.** После исправлений нужен новый идентифицированный кандидат, регрессии на реальном keyboard/remount и native transaction контекстах, повтор затронутых browser/native durability сценариев и обязательных offline/package checks. Windows и строки NOT TESTED остаются явными пробелами; GO для них не подразумевается.

Context7 resolve/query выполнены; релевантная справка по транзакциям не найдена. Затем непосредственно проверены официальные источники Autodesk: [transactions/previews](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/Commands_UM.htm), [terminateActiveCommand](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/core_UserInterface_terminateActiveCommand.htm), [CommandDefinition.execute](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/core_CommandDefinition_execute.htm), [Documents.add](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/core_Documents_add.htm), [Document.close](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/core_Document_close.htm), [palette docking](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/core_Palette_dockingState.htm). Проверены общие [инженерные правила](https://github.com/4FusionLab/.github/blob/main/AGENTS.md) и [release contract](https://github.com/4FusionLab/.github/blob/main/RELEASE_PLATFORM.md).
