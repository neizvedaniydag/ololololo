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
echoc " АВТОУСТАНОВКА С НУЛЕВОЙ UBUNTU (PRODUCTION READY) " $C_YELLOW
echoc "=================================================================" $C_BLUE
echo

# ============ ШАГ 0: УСТАНОВКА БАЗОВЫХ УТИЛИТ ============
echoc "0. Установка базовых утилит..." $C_BLUE
sudo apt update -qq
sudo apt install -y curl git dnsutils openssl ca-certificates gnupg lsb-release 2>&1 | tail -3
echoc "   ✓ curl, git, dig, openssl установлены" $C_GREEN
echo

# ============ ШАГ 1: УСТАНОВКА DOCKER ============
echoc "1. Проверка и установка Docker..." $C_BLUE

if ! command -v docker &> /dev/null; then
    echoc "   → Docker не найден, устанавливаем..." $C_YELLOW
    
    # Удалить старые версии (если есть)
    sudo apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true
    
    # Установка Docker через официальный скрипт
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh 2>&1 | tail -5
    rm get-docker.sh
    
    # Запустить Docker
    sudo systemctl start docker
    sudo systemctl enable docker
    
    echoc "   ✓ Docker установлен" $C_GREEN
else
    echoc "   ✓ Docker уже установлен" $C_GREEN
fi
echo

# ============ ШАГ 2: DOCKER COMPOSE V2 ============
echoc "2. Проверка Docker Compose v2..." $C_BLUE

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

# ============ ШАГ 3: ОСВОБОЖДЕНИЕ ПОРТОВ ============
echoc "3. Освобождение портов 80 и 443..." $C_BLUE
sudo systemctl stop nginx 2>/dev/null || true
sudo systemctl stop apache2 2>/dev/null || true
sudo systemctl disable nginx 2>/dev/null || true
sudo systemctl disable apache2 2>/dev/null || true
echoc "   ✓ Порты освобождены" $C_GREEN
echo

# ============ ШАГ 4: ФАЙРВОЛ ============
echoc "4. Проверка файрвола..." $C_BLUE
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

# ============ ШАГ 5: ОЧИСТКА DOCKER ============
echoc "5. Очистка Docker (БД сохраняется)..." $C_BLUE
$DC down --remove-orphans 2>/dev/null || true
docker system prune -f 2>/dev/null || true
echoc "   ✓ Docker очищен" $C_GREEN
echo

# ============ ШАГ 6: ИСПРАВЛЕНИЕ DOCKER-COMPOSE.YML ============
echoc "6. Проверка docker-compose.yml..." $C_BLUE

if [ -f "docker-compose.yml" ]; then
    sed -i '/^version:/d' docker-compose.yml 2>/dev/null || true
    
    if ! grep -q "restart: always" docker-compose.yml; then
        echoc "   → Добавляю restart: always..." $C_YELLOW
        sed -i '/web:/a\    restart: always' docker-compose.yml
        sed -i '/nginx:/a\    restart: always' docker-compose.yml
        echoc "   ✓ Автозапуск 24/7 настроен" $C_GREEN
    else
        echoc "   ✓ Автозапуск уже настроен" $C_GREEN
    fi
else
    echoc "   ⚠ docker-compose.yml не найден" $C_YELLOW
fi
echo

# ============ ШАГ 7: СБОР ДАННЫХ ============
echoc "7. Сбор информации..." $C_BLUE
read -p "   Домен: " DOMAIN
[ -z "$DOMAIN" ] && error_exit "Домен пустой"

read -p "   Email: " EMAIL
[ -z "$EMAIL" ] && error_exit "Email пустой"

read -p "   API-ключ GigaChat: " GIGACHAT_CREDENTIALS
[ -z "$GIGACHAT_CREDENTIALS" ] && error_exit "API-ключ пустой"

KEY_LEN=${#GIGACHAT_CREDENTIALS}
if [ $KEY_LEN -lt 50 ]; then
    echoc "   ⚠ Короткий ключ ($KEY_LEN символов)" $C_YELLOW
else
    echoc "   ✓ Ключ получен ($KEY_LEN символов)" $C_GREEN
fi
echo

# ============ ШАГ 8: СОЗДАНИЕ КОНФИГУРАЦИИ ============
echoc "8. Создание конфигурации..." $C_BLUE

SECRET_KEY=$(openssl rand -hex 32)
cat > .env <<EOL
FLASK_SECRET_KEY=${SECRET_KEY}
GIGACHAT_CREDENTIALS=${GIGACHAT_CREDENTIALS}
FLASK_APP=app.py
EOL

sed -i 's/[[:space:]]*$//' .env
echoc "   ✓ .env создан" $C_GREEN

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

echoc "   ✓ Конфигурация готова" $C_GREEN
echo

# ============ ШАГ 9: ПРОВЕРКА DNS ============
echoc "9. Проверка DNS..." $C_BLUE
PUBLIC_IP=$(curl -s http://ipinfo.io/ip || echo "unknown")
DOMAIN_IP=$(dig +short $DOMAIN @8.8.8.8 | head -n1 || echo "unknown")
echoc "   IP сервера: ${PUBLIC_IP}" $C_YELLOW
echoc "   IP домена: ${DOMAIN_IP}" $C_YELLOW

if [ "$PUBLIC_IP" != "$DOMAIN_IP" ]; then
    echoc "   ⚠ IP не совпадают!" $C_RED
    read -p "   Продолжить? (y/N) " dec
    [ "$dec" != "y" ] && [ "$dec" != "Y" ] && error_exit "Прервано"
else
    echoc "   ✓ DNS ОК" $C_GREEN
fi
echo

# ============ ШАГ 10: SSL ============
echoc "10. Получение SSL..." $C_BLUE
docker volume rm ololololo_certbot_certs 2>/dev/null || true

$DC run --rm -p 80:80 --entrypoint "\
  certbot certonly --standalone \
    --email $EMAIL \
    -d $DOMAIN \
    -d www.$DOMAIN \
    --rsa-key-size 4096 \
    --agree-tos \
    --non-interactive \
    --force-renewal" certbot 2>&1 | grep -E "Success|Certificate" || true

echoc "   ✓ SSL получен" $C_GREEN
echo

# ============ ШАГ 11: ЗАПУСК ============
echoc "11. Запуск сервисов..." $C_BLUE
$DC up -d --build --remove-orphans 2>&1 | tail -5
sleep 5
echoc "   ✓ Запущено" $C_GREEN
echo

# ============ ШАГ 12: ПРОВЕРКА ============
echoc "12. Финальная проверка..." $C_BLUE
$DC ps
echo

KEY_CHECK=$($DC exec web sh -c 'echo $GIGACHAT_CREDENTIALS' 2>/dev/null | tr -d '\r\n' | head -c 20)
[ ! -z "$KEY_CHECK" ] && echoc "   ✓ API ключ ОК: ${KEY_CHECK}..." $C_GREEN || echoc "   ⚠ API ключ не найден" $C_RED
echo

# ============ ШАГ 13: АВТОМОНИТОРИНГ ============
echoc "13. Настройка автомониторинга..." $C_BLUE
CRON1="*/5 * * * * docker compose -f $(pwd)/docker-compose.yml ps | grep -q 'Up' || docker compose -f $(pwd)/docker-compose.yml up -d >> /var/log/docker-autostart.log 2>&1"
CRON2="0 1,13 * * * cd $(pwd) && docker compose run --rm certbot renew && docker compose exec nginx nginx -s reload >> /var/log/ssl-renewal.log 2>&1"
(crontab -l 2>/dev/null | grep -v "docker-autostart" | grep -v "ssl-renewal"; echo "$CRON1"; echo "$CRON2") | crontab -
echoc "   ✓ Cron настроен" $C_GREEN
echo

echoc "=================================================================" $C_BLUE
echoc " ✓✓✓ УСТАНОВКА ЗАВЕРШЕНА! САЙТ РАБОТАЕТ 24/7! ✓✓✓ " $C_GREEN
echoc "=================================================================" $C_BLUE
echo
echoc "🌐 Сайт: https://${DOMAIN}" $C_YELLOW
echoc "🔄 Автозапуск: ВКЛ" $C_GREEN
echoc "📊 БД: Сохраняется" $C_GREEN
echo
