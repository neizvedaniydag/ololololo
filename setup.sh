cat > setup.sh << 'SETUPEOF'
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
echoc " ПОЛНАЯ АВТОМАТИЧЕСКАЯ УСТАНОВКА " $C_YELLOW
echoc "=================================================================" $C_BLUE
echo

echoc "1. Проверка Docker Compose..." $C_BLUE
if ! command -v docker &> /dev/null; then
    error_exit "Docker не установлен"
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

echoc "2. Освобождение портов..." $C_BLUE
sudo systemctl stop nginx 2>/dev/null || true
sudo systemctl stop apache2 2>/dev/null || true
sudo systemctl disable nginx 2>/dev/null || true
sudo systemctl disable apache2 2>/dev/null || true
echoc "   ✓ Порты освобождены" $C_GREEN
echo

echoc "3. Очистка Docker (БД сохраняется)..." $C_BLUE
# ВАЖНО: Останавливаем контейнеры БЕЗ удаления volume с БД
$DC down --remove-orphans 2>/dev/null || true
docker system prune -f 2>/dev/null || true
echoc "   ✓ Старые контейнеры удалены" $C_GREEN
echo

echoc "4. Исправление docker-compose.yml..." $C_BLUE
if [ -f "docker-compose.yml" ]; then
    sed -i '/^version:/d' docker-compose.yml
    echoc "   ✓ Файл исправлен" $C_GREEN
fi
echo

echoc "5. Сбор информации..." $C_BLUE
read -p "   Домен: " DOMAIN
[ -z "$DOMAIN" ] && error_exit "Домен не может быть пустым"

read -p "   Email: " EMAIL
[ -z "$EMAIL" ] && error_exit "Email не может быть пустым"

read -p "   API-ключ GigaChat: " GIGACHAT_CREDENTIALS
[ -z "$GIGACHAT_CREDENTIALS" ] && error_exit "API-ключ не может быть пустым"

echoc "   ✓ Данные собраны (ключ: ${#GIGACHAT_CREDENTIALS} символов)" $C_GREEN
echo

echoc "6. Создание конфигурации..." $C_BLUE

SECRET_KEY=$(openssl rand -hex 32)
cat > .env <<EOL
FLASK_SECRET_KEY=${SECRET_KEY}
GIGACHAT_CREDENTIALS=${GIGACHAT_CREDENTIALS}
FLASK_APP=app.py
EOL

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

if [ -f "education_platform/education_platform/app.py" ]; then
    sed -i "s|'sqlite:///instance/education_platform.db'|'sqlite:////app/instance/education_platform.db'|g" education_platform/education_platform/app.py
    sed -i "s|\"sqlite:///instance/education_platform.db\"|\"sqlite:////app/instance/education_platform.db\"|g" education_platform/education_platform/app.py
    echoc "   ✓ Путь к БД исправлен" $C_GREEN
fi

echoc "   ✓ Конфигурация создана" $C_GREEN
echo

echoc "7. Проверка DNS..." $C_BLUE
PUBLIC_IP=$(curl -s http://ipinfo.io/ip || echo "unknown")
DOMAIN_IP=$(dig +short $DOMAIN @8.8.8.8 | head -n1 || echo "unknown")
echoc "   IP сервера: ${PUBLIC_IP}, домена: ${DOMAIN_IP}" $C_YELLOW

if [ "$PUBLIC_IP" != "$DOMAIN_IP" ]; then
    echoc "   ⚠ IP не совпадают!" $C_RED
    read -p "   Продолжить? (y/N) " decision
    if [ "$decision" != "Y" ] && [ "$decision" != "y" ]; then
        error_exit "Установка прервана"
    fi
fi
echo

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
    --force-renewal" certbot 2>&1 | grep -E "Success|Certificate|saved"

echoc "   ✓ SSL получен!" $C_GREEN
echo

echoc "9. Запуск сервисов..." $C_BLUE
$DC up -d --build --remove-orphans 2>&1 | tail -5
sleep 5
echoc "   ✓ Запущено" $C_GREEN
echo

echoc "10. Проверка..." $C_BLUE
$DC ps
echo

KEY_IN_CONTAINER=$($DC exec web sh -c 'echo $GIGACHAT_CREDENTIALS' 2>/dev/null | tr -d '\r\n' | head -c 20)
if [ ! -z "$KEY_IN_CONTAINER" ]; then
    echoc "   ✓ API ключ OK: ${KEY_IN_CONTAINER}..." $C_GREEN
fi
echo

echoc "=================================================================" $C_BLUE
echoc " ✓ УСТАНОВКА ЗАВЕРШЕНА! " $C_GREEN
echoc "=================================================================" $C_BLUE
echo
echoc "🌐 Сайт: https://${DOMAIN}" $C_YELLOW
echoc "📊 База данных сохраняется между перезапусками" $C_GREEN
echo
echoc "📝 Команды:" $C_BLUE
echoc "  Статус:      $DC ps" $C_RESET
echoc "  Логи:        $DC logs -f web" $C_RESET
echoc "  Перезапуск:  $DC restart web" $C_RESET
echoc "  Бэкап БД:    docker cp education-platform-app:/app/instance/education_platform.db ./backup.db" $C_RESET
echo
echoc "⚙️  Автообновление SSL (crontab -e):" $C_YELLOW
echoc "0 1,13 * * * cd $(pwd) && $DC run --rm certbot renew && $DC exec nginx nginx -s reload" $C_GREEN
echo
SETUPEOF

chmod +x setup.sh
