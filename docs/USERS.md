# Chicko Analytics — Реестр пользователей
> KV namespace: USERS (6f095f10194a45ec9cdcc98129fb2426)
| Email | Имя | Роль | Доступ | Добавлен |
|---|---|---|---|---|
| melnikov181076@gmail.com | Мельников Алексей | Разработчик / Админ | Все рестораны | — |
| papachickorico@gmail.com | Лебедев Сергей | Папа Чико | Все города | 20.04.2026 |
| rucopyright@gmail.com | Коваль Александр | Маркетолог | Все рестораны | 20.04.2026 |
| johnpreston38@ya.ru | Новицкий Евгений | Операционный директор | Все рестораны | 20.04.2026 |
## Управление
sh
# Добавить
npx wrangler kv:key put --namespace-id=6f095f10194a45ec9cdcc98129fb2426 "user:<email>" '{"user_id":"user_<name>"}'
# Заблокировать
npx wrangler kv:key delete --namespace-id=6f095f10194a45ec9cdcc98129fb2426 "user:<email>"
# Список
npx wrangler kv:key list --namespace-id=6f095f10194a45ec9cdcc98129fb2426 --prefix="user:"

