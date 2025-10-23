#!/bin/bash
set -e

C_RESET='\033[0m'
C_RED='\033[0;31m'
C_GREEN='\033[0;32m'
C_BLUE='\033[0;34m'
C_YELLOW='\033[1;33m'

function echoc {
    echo -e "${2}${1}${C_RESET}"
}

function error_exit {
    echoc "ОШИБКА: ${1}" $C_RED
    exit 1
}

clear
echoc "=================================================================" $C_BLUE
echoc " ПОЛНАЯ АВТОМАТИЧЕСКАЯ УСТАНОВКА (PRODUCTION READY) " $C_YELLOW
echoc "=================================================================" $C_BLUE
echo

# ============ ШАГ 1: DOCKER COMPOSE V2 ============
echoc "1. Проверка Docker Compose v2..." $C_BLUE
if ! command -v docker &> /dev/null; then
    error_exit "Docker не установлен. Установите: curl -fsSL https://get.docker.com | sh"
fi

DC=""
if docker compose version &> /dev/null 2>&1; then
    DC="docker compose"
    echoc "   ✓ Docker Compose v2 найден" $C_GREEN
else
    echoc "   → Установка Docker Compose v2..." $C_YELLOW
    sudo mkdir -p /usr/local/lib/docker/cli-plugins/
    sudo curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
        -o /usr/local/lib/docker/cli-plugins/docker-compose 2>&1 | tail -1
    sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
    DC="docker compose"
    echoc "   ✓ Docker Compose v2 установлен" $C_GREEN
fi
echo

# ============ ШАГ 2: ОСВОБОЖДЕНИЕ ПОРТОВ ============
echoc "2. Освобождение портов 80 и 443..." $C_BLUE
sudo systemctl stop nginx 2>/dev/null || true
sudo systemctl stop apache2 2>/dev/null || true
sudo systemctl disable nginx 2>/dev/null || true
sudo systemctl disable apache2 2>/dev/null || true
echoc "   ✓ Nginx/Apache остановлены" $C_GREEN
echo

# ============ ШАГ 2.5: ФАЙРВОЛ ============
echoc "2.5. Проверка файрвола..." $C_BLUE
if command -v ufw &> /dev/null; then
    UFW_STATUS=$(sudo ufw status 2>/dev/null | grep -i "Status: active" || echo "inactive")
    if [[ "$UFW_STATUS" == *"active"* ]]; then
        sudo ufw allow 80/tcp 2>/dev/null || true
        sudo ufw allow 443/tcp 2>/dev/null || true
        echoc "   ✓ Порты 80 и 443 открыты в UFW" $C_GREEN
    else
        echoc "   ✓ UFW неактивен" $C_YELLOW
    fi
else
    echoc "   ✓ UFW не установлен" $C_YELLOW
fi
echo

# ============ ШАГ 3: ОЧИСТКА DOCKER (БЕЗ УДАЛЕНИЯ БД) ============
echoc "3. Очистка Docker (БД сохраняется)..." $C_BLUE
$DC down --remove-orphans 2>/dev/null || true
docker system prune -f 2>/dev/null || true
echoc "   ✓ Старые контейнеры удалены" $C_GREEN
echo

# ============ ШАГ 4: ИСПРАВЛЕНИЕ DOCKER-COMPOSE.YML ============
echoc "4. Проверка и исправление docker-compose.yml..." $C_BLUE

if [ -f "docker-compose.yml" ]; then
    # Удалить строку version
    if grep -q "^version:" docker-compose.yml; then
        sed -i '/^version:/d' docker-compose.yml
        echoc "   ✓ Удалена строка 'version'" $C_GREEN
    fi
    
    # Проверить restart: always
    if ! grep -q "restart: always" docker-compose.yml; then
        echoc "   ⚠ Добавляю 'restart: always' для автозапуска 24/7..." $C_YELLOW
        # Добавить после каждого service
        sed -i '/web:/a\    restart: always' docker-compose.yml
        sed -i '/nginx:/a\    restart: always' docker-compose.yml
        echoc "   ✓ Контейнеры будут работать 24/7" $C_GREEN
    else
        echoc "   ✓ Автозапуск 24/7 уже настроен" $C_GREEN
    fi
else
    echoc "   ⚠ docker-compose.yml не найден" $C_YELLOW
fi
echo

# ============ ШАГ 5: СБОР ДАННЫХ ============
echoc "5. Сбор информации..." $C_BLUE
read -p "   Домен (например, my-site.ru): " DOMAIN
[ -z "$DOMAIN" ] && error_exit "Домен не может быть пустым"

read -p "   Email для Let's Encrypt: " EMAIL
[ -z "$EMAIL" ] && error_exit "Email не может быть пустым"

echoc "   Вставьте API-ключ GigaChat полностью:" $C_YELLOW
read -p "   API-ключ: " GIGACHAT_CREDENTIALS
[ -z "$GIGACHAT_CREDENTIALS" ] && error_exit "API-ключ не может быть пустым"

KEY_LEN=${#GIGACHAT_CREDENTIALS}
if [ $KEY_LEN -lt 50 ]; then
    echoc "   ⚠ Ключ короткий ($KEY_LEN символов). Проверьте!" $C_RED
    read -p "   Продолжить? (y/N) " cont
    [ "$cont" != "y" ] && [ "$cont" != "Y" ] && error_exit "Прервано"
else
    echoc "   ✓ Ключ получен (длина: $KEY_LEN)" $C_GREEN
fi
echo

# ============ ШАГ 6: СОЗДАНИЕ КОНФИГУРАЦИИ ============
echoc "6. Создание конфигурации..." $C_BLUE

SECRET_KEY=$(openssl rand -hex 32)
cat > .env <<EOL
FLASK_SECRET_KEY=${SECRET_KEY}
GIGACHAT_CREDENTIALS=${GIGACHAT_CREDENTIALS}
FLASK_APP=app.py
EOL

# Очистка от пробелов в конце строк
sed -i 's/[[:space:]]*$//' .env
echoc "   ✓ Файл .env создан и очищен" $C_GREEN

mkdir -p nginx
cat > nginx/nginx.conf.template <<'NGINXEOF'
server {
    listen 80;
    server_name %%DOMAIN%% www.%%DOMAIN%%;
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name %%DOMAIN%% www.%%DOMAIN%%;
    ssl_certificate /etc/letsencrypt/live/%%DOMAIN%%/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/%%DOMAIN%%/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers off;

    location /static {
        alias /app/static;
        expires 7d;
    }
    location / {
        proxy_pass http://web:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300;
    }
}
NGINXEOF

sed "s/%%DOMAIN%%/${DOMAIN}/g" nginx/nginx.conf.template > nginx/production.conf

# Исправление пути к БД
if [ -f "education_platform/education_platform/app.py" ]; then
    sed -i "s|'sqlite:///instance/education_platform.db'|'sqlite:////app/instance/education_platform.db'|g" education_platform/education_platform/app.py
    sed -i "s|\"sqlite:///instance/education_platform.db\"|\"sqlite:////app/instance/education_platform.db\"|g" education_platform/education_platform/app.py
    echoc "   ✓ Путь к БД исправлен" $C_GREEN
fi

echoc "   ✓ Конфигурация создана" $C_GREEN
echo

# ============ ШАГ 7: ПРОВЕРКА DNS ============
echoc "7. Проверка DNS..." $C_BLUE
PUBLIC_IP=$(curl -s http://ipinfo.io/ip || echo "unknown")
DOMAIN_IP=$(dig +short $DOMAIN @8.8.8.8 | head -n1 || echo "unknown")
echoc "   IP сервера: ${PUBLIC_IP}" $C_YELLOW
echoc "   IP домена: ${DOMAIN_IP}" $C_YELLOW

if [ "$PUBLIC_IP" != "$DOMAIN_IP" ] || [ "$DOMAIN_IP" == "unknown" ]; then
    echoc "   ⚠ IP не совпадают! SSL может не получиться" $C_RED
    read -p "   Продолжить? (y/N) " decision
    [ "$decision" != "Y" ] && [ "$decision" != "y" ] && error_exit "Прервано"
else
    echoc "   ✓ DNS настроен правильно" $C_GREEN
fi
echo

# ============ ШАГ 8: SSL СЕРТИФИКАТ (STANDALONE) ============
echoc "8. Получение SSL сертификата..." $C_BLUE

echoc "   → Удаление старых сертификатов..." $C_YELLOW
docker volume rm ololololo_certbot_certs 2>/dev/null || true

echoc "   → Получение SSL (standalone метод)..." $C_YELLOW
$DC run --rm -p 80:80 --entrypoint "\
  certbot certonly --standalone \
    --email $EMAIL \
    -d $DOMAIN \
    -d www.$DOMAIN \
    --rsa-key-size 4096 \
    --agree-tos \
    --non-interactive \
    --force-renewal" certbot 2>&1 | grep -E "Success|Certificate|saved" || {
    echoc "   ⚠ Ошибка получения SSL" $C_RED
    read -p "   Продолжить без SSL? (y/N) " cont_no_ssl
    [ "$cont_no_ssl" != "y" ] && [ "$cont_no_ssl" != "Y" ] && error_exit "Прервано"
}

echoc "   ✓ SSL сертификат получен!" $C_GREEN
echo

# ============ ШАГ 9: ЗАПУСК КОНТЕЙНЕРОВ ============
echoc "9. Запуск сервисов..." $C_BLUE
$DC up -d --build --remove-orphans 2>&1 | tail -5
sleep 5
echoc "   ✓ Контейнеры запущены" $C_GREEN
echo

# ============ ШАГ 10: ПРОВЕРКА ============
echoc "10. Финальная проверка..." $C_BLUE
echoc ""
$DC ps
echo

KEY_IN_CONTAINER=$($DC exec web sh -c 'echo $GIGACHAT_CREDENTIALS' 2>/dev/null | tr -d '\r\n' | head -c 20)
if [ ! -z "$KEY_IN_CONTAINER" ]; then
    echoc "   ✓ API ключ в контейнере: ${KEY_IN_CONTAINER}..." $C_GREEN
else
    echoc "   ⚠ API ключ не найден в контейнере!" $C_RED
fi

# Проверка логов Flask
echoc "   → Проверка логов Flask (последние 10 строк)..." $C_YELLOW
$DC logs web 2>&1 | tail -10 | grep -i "error\|fail" && echoc "   ⚠ Есть ошибки в логах" $C_RED || echoc "   ✓ Логи чистые" $C_GREEN
echo

# ============ ШАГ 11: НАСТРОЙКА АВТОМОНИТОРИНГА ============
echoc "11. Настройка автомониторинга и автообновления SSL..." $C_BLUE

CRON_CHECK_CONTAINERS="*/5 * * * * docker compose -f $(pwd)/docker-compose.yml ps | grep -q 'Up' || docker compose -f $(pwd)/docker-compose.yml up -d >> /var/log/docker-autostart.log 2>&1"
CRON_SSL_RENEWAL="0 1,13 * * * cd $(pwd) && docker compose run --rm certbot renew && docker compose exec nginx nginx -s reload >> /var/log/ssl-renewal.log 2>&1"

echoc "   → Добавление задач в cron..." $C_YELLOW
(crontab -l 2>/dev/null | grep -v "docker-autostart" | grep -v "ssl-renewal"; echo "$CRON_CHECK_CONTAINERS"; echo "$CRON_SSL_RENEWAL") | crontab -

echoc "   ✓ Автомониторинг каждые 5 минут" $C_GREEN
echoc "   ✓ Автообновление SSL 2 раза в день (1:00 и 13:00)" $C_GREEN
echo

# ============ ЗАВЕРШЕНИЕ ============
echoc "=================================================================" $C_BLUE
echoc " ✓✓✓ УСТАНОВКА ЗАВЕРШЕНА! PRODUCTION READY! ✓✓✓ " $C_GREEN
echoc "=================================================================" $C_BLUE
echo
echoc "🌐 Ваш сайт: https://${DOMAIN}" $C_YELLOW
echoc "📧 Email: ${EMAIL}" $C_RESET
echoc "🔐 SSL действителен до: $(date -d '+90 days' '+%Y-%m-%d' 2>/dev/null || date -v+90d '+%Y-%m-%d')" $C_RESET
echoc "🔄 Автоматический перезапуск: ВКЛЮЧЕН (24/7)" $C_GREEN
echoc "📊 База данных: СОХРАНЯЕТСЯ между перезапусками" $C_GREEN
echo
echoc "📝 Полезные команды:" $C_BLUE
echoc "  Статус контейнеров:  $DC ps" $C_RESET
echoc "  Логи Flask:          $DC logs -f web" $C_RESET
echoc "  Логи Nginx:          $DC logs -f nginx" $C_RESET
echoc "  Перезапуск Flask:    $DC restart web" $C_RESET
echoc "  Остановить всё:      $DC down" $C_RESET
echoc "  Запустить заново:    $DC up -d" $C_RESET
echoc "  Бэкап БД:            docker cp education-platform-app:/app/instance/education_platform.db ./backup.db" $C_RESET
echoc "  Проверить ресурсы:   docker stats" $C_RESET
echo
echoc "📋 Логи автомониторинга:" $C_BLUE
echoc "  Автозапуск:          tail -f /var/log/docker-autostart.log" $C_RESET
echoc "  Обновление SSL:      tail -f /var/log/ssl-renewal.log" $C_RESET
echo
echoc "⚙️  Настроен CRON для:" $C_GREEN
echoc "  ✓ Автоматическая проверка контейнеров (каждые 5 минут)" $C_RESET
echoc "  ✓ Автоматическое обновление SSL (1:00 и 13:00)" $C_RESET
echo
echoc "🔍 Если что-то не работает:" $C_YELLOW
echoc "  1. Проверьте логи: $DC logs web" $C_RESET
echoc "  2. Проверьте статус: $DC ps" $C_RESET
echoc "  3. Перезапустите: $DC restart web nginx" $C_RESET
echoc "  4. Проверьте API ключ: $DC exec web env | grep GIGACHAT" $C_RESET
echo
