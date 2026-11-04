# Telegram Mini Apps SDK

`telegram-web-app.js` — неизменённая копия официального клиентского SDK из https://telegram.org/js/telegram-web-app.js, полученная 4 ноября 2026 года.

Копия размещена вместе с мастерской, чтобы при открытии не запрашивать код с другого домена. Используются только оформление WebView, `ready`/`expand`, кнопки Telegram и управление жестами. Авторизация, платежи, Serverless, отправка данных, CloudStorage, DeviceStorage и запросы разрешений приложением не вызываются. Официальный SDK может сохранять параметры запуска и темы в sessionStorage, фотографии туда не записываются.

Документация: https://core.telegram.org/bots/webapps
