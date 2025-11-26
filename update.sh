#!/bin/bash
set -e

C_RESET='\033[0m'
C_RED='\033[0;31m'
C_GREEN='\033[0;32m'
C_BLUE='\033[0;34m'
C_YELLOW='\033[1;33m'
C_CYAN='\033[0;36m'

function echoc {
    echo -e "${2}${1}${C_RESET}"
}

function error_exit {
    echoc "ОШИБКА: ${1}" $C_RED
    exit 1
}

function show_help {
    echo "Использование: ./update.sh [опции]"
    echo ""
    echo "Опции:"
    echo "  -r URL     Указать URL репозитория (по умолчанию: https://github.com/neizvedaniydag/site)"
    echo "  -b BRANCH  Указать бранч (по умолчанию: main)"
    echo "  -t         Автоматически выбрать последнюю папку education_platform"
    echo "  -h         Показать эту справку"
    echo ""
    echo "Примеры:"
    echo "  ./update.sh                    # Обновить с дефолтного репо (с выбором папки)"
    echo "  ./update.sh -t                 # Автоматически выбрать последнюю папку"
    echo "  ./update.sh -r https://github.com/user/repo"
    echo "  ./update.sh -b develop -t      # Бранч develop + автовыбор папки"
    echo ""
    exit 0
}

# ============ ДЕФОЛТНЫЕ ЗНАЧЕНИЯ ============
DEFAULT_REPO="https://github.com/neizvedaniydag/site"
DEFAULT_BRANCH="main"

REPO_URL=""
BRANCH=""
AUTO_SELECT=false

# ============ ПАРСИНГ АРГУМЕНТОВ ============
while getopts "r:b:th" opt; do
    case $opt in
        r)
            REPO_URL="$OPTARG"
            ;;
        b)
            BRANCH="$OPTARG"
            ;;
        t)
            AUTO_SELECT=true
            ;;
        h)
            show_help
            ;;
        \?)
            echoc "Неверная опция: -$OPTARG" $C_RED
            echo "Используйте -h для справки"
            exit 1
            ;;
    esac
done

# Устанавливаем дефолтные значения если не указаны
REPO_URL=${REPO_URL:-$DEFAULT_REPO}
BRANCH=${BRANCH:-$DEFAULT_BRANCH}

clear
echoc "=================================================================" $C_BLUE
echoc " АВТОМАТИЧЕСКОЕ ОБНОВЛЕНИЕ EDUCATION PLATFORM " $C_YELLOW
echoc "=================================================================" $C_BLUE
echo

# ============ ШАГ 1: ПРОВЕРКА DOCKER COMPOSE ============
echoc "1. Проверка окружения..." $C_BLUE
if ! command -v docker &> /dev/null; then
    error_exit "Docker не установлен"
fi

DC=""
if docker compose version &> /dev/null 2>&1; then
    DC="docker compose"
else
    error_exit "Docker Compose v2 не найден"
fi
echoc "   ✓ Docker Compose готов" $C_GREEN
echo

# ============ ШАГ 2: СОХРАНЕНИЕ ТЕКУЩИХ НАСТРОЕК ============
echoc "2. Сохранение текущих настроек..." $C_BLUE

if [ ! -f ".env" ]; then
    error_exit "Файл .env не найден! Запустите сначала setup.sh"
fi

BACKUP_DIR="/tmp/education_platform_backup_$(date +%s)"
mkdir -p "$BACKUP_DIR"

cp .env "$BACKUP_DIR/.env"
echoc "   ✓ .env сохранён" $C_GREEN

if [ -f "nginx/production.conf" ]; then
    mkdir -p "$BACKUP_DIR/nginx"
    cp nginx/production.conf "$BACKUP_DIR/nginx/production.conf"
    echoc "   ✓ Nginx конфиг сохранён" $C_GREEN
fi

source .env
SAVED_SECRET_KEY="$FLASK_SECRET_KEY"
SAVED_GIGACHAT_CREDENTIALS="$GIGACHAT_CREDENTIALS"

echoc "   ✓ Настройки сохранены в $BACKUP_DIR" $C_GREEN
echo

# ============ ШАГ 3: ИНФОРМАЦИЯ О РЕПОЗИТОРИИ ============
echoc "3. Репозиторий для обновления..." $C_BLUE
echoc "   → URL: $REPO_URL" $C_YELLOW
echoc "   → Бранч: $BRANCH" $C_YELLOW
if [ "$AUTO_SELECT" = true ]; then
    echoc "   → Режим: автовыбор последней папки (-t)" $C_CYAN
else
    echoc "   → Режим: ручной выбор папки" $C_CYAN
fi
echo

# Подтверждение
read -p "   Продолжить? (Y/n): " confirm
confirm=${confirm:-Y}
if [ "$confirm" != "Y" ] && [ "$confirm" != "y" ]; then
    error_exit "Прервано пользователем"
fi
echo

# ============ ШАГ 4: ОСТАНОВКА КОНТЕЙНЕРОВ ============
echoc "4. Остановка контейнеров (БД и SSL сохраняются)..." $C_BLUE
$DC down 2>&1 | tail -3
echoc "   ✓ Контейнеры остановлены" $C_GREEN
echo

# ============ ШАГ 5: ЗАГРУЗКА НОВОГО КОДА ============
echoc "5. Загрузка нового кода..." $C_BLUE

TEMP_REPO="/tmp/new_repo_$(date +%s)"

echoc "   → Клонирование $REPO_URL..." $C_YELLOW
git clone -b "$BRANCH" "$REPO_URL" "$TEMP_REPO" 2>&1 | tail -5

if [ ! -d "$TEMP_REPO" ]; then
    error_exit "Не удалось клонировать репозиторий"
fi

echoc "   ✓ Репозиторий клонирован" $C_GREEN
echo

# ============ ШАГ 6: ПОИСК И ВЫБОР ПАПОК EDUCATION_PLATFORM ============
echoc "6. Поиск папок с Flask-приложением..." $C_BLUE

# Массив для хранения найденных папок
declare -a FLASK_FOLDERS=()

# РЕКУРСИВНЫЙ поиск app.py в любых подпапках (включая вложенные)
while IFS= read -r app_file; do
    # Получаем директорию где лежит app.py
    app_dir=$(dirname "$app_file")
    
    # Проверяем что там есть static, templates, models.py (признаки Flask-приложения)
    if [ -d "$app_dir/static" ] || [ -d "$app_dir/templates" ] || [ -f "$app_dir/models.py" ]; then
        FLASK_FOLDERS+=("$app_dir")
    fi
done < <(find "$TEMP_REPO" -type f -name "app.py" 2>/dev/null)

# Проверяем что нашли хоть что-то
if [ ${#FLASK_FOLDERS[@]} -eq 0 ]; then
    echoc "   ⚠ Не найдено папок с app.py. Структура репо:" $C_RED
    ls -la "$TEMP_REPO"
    error_exit "Не найдено Flask-приложения в репозитории!"
fi

echoc "   → Найдено Flask-приложений: ${#FLASK_FOLDERS[@]}" $C_YELLOW

# Показываем что нашли (для отладки)
for folder in "${FLASK_FOLDERS[@]}"; do
    relative_path="${folder#$TEMP_REPO/}"
    echoc "      • $relative_path" $C_RESET
done

# Сортируем по времени модификации (последняя = новейшая)
SORTED_FOLDERS=()
while IFS= read -r line; do
    SORTED_FOLDERS+=("${line#* }")
done < <(for folder in "${FLASK_FOLDERS[@]}"; do
    echo "$(stat -c '%Y' "$folder") $folder"
done | sort -rn)

FLASK_APP_DIR=""

# ============ АВТОВЫБОР ИЛИ РУЧНОЙ ВЫБОР ============
if [ "$AUTO_SELECT" = true ]; then
    # Автоматически выбираем последнюю (новейшую) папку
    FLASK_APP_DIR="${SORTED_FOLDERS[0]}"
    relative_path="${FLASK_APP_DIR#$TEMP_REPO/}"
    echoc "   ✓ Автовыбрана последняя папка: $relative_path" $C_GREEN
else
    # Показываем список для выбора
    if [ ${#SORTED_FOLDERS[@]} -eq 1 ]; then
        # Если папка всего одна, выбираем автоматически
        FLASK_APP_DIR="${SORTED_FOLDERS[0]}"
        relative_path="${FLASK_APP_DIR#$TEMP_REPO/}"
        echoc "   ✓ Найдена единственная папка: $relative_path" $C_GREEN
    else
        # Несколько папок - даём выбрать
        echo ""
        echoc "   Найдено несколько Flask-приложений:" $C_CYAN
        echo ""
        
        for i in "${!SORTED_FOLDERS[@]}"; do
            relative_path="${SORTED_FOLDERS[$i]#$TEMP_REPO/}"
            folder_date=$(stat -c '%y' "${SORTED_FOLDERS[$i]}" | cut -d'.' -f1)
            printf "   ${C_CYAN}%2d)${C_RESET} %-40s ${C_YELLOW}(%s)${C_RESET}\n" $((i+1)) "$relative_path" "$folder_date"
        done
        
        echo ""
        read -p "   Выберите номер папки [1-${#SORTED_FOLDERS[@]}]: " choice
        
        # Валидация выбора
        if ! [[ "$choice" =~ ^[0-9]+$ ]] || [ "$choice" -lt 1 ] || [ "$choice" -gt ${#SORTED_FOLDERS[@]} ]; then
            error_exit "Неверный выбор"
        fi
        
        FLASK_APP_DIR="${SORTED_FOLDERS[$((choice-1))]}"
        relative_path="${FLASK_APP_DIR#$TEMP_REPO/}"
        echoc "   ✓ Выбрана папка: $relative_path" $C_GREEN
    fi
fi

echo

# ============ ШАГ 7: ЗАМЕНА КОДА ПРИЛОЖЕНИЯ ============
echoc "7. Обновление кода приложения..." $C_BLUE

# Сохраняем БД если есть
if [ -d "education_platform/education_platform/instance" ]; then
    cp -r education_platform/education_platform/instance "$BACKUP_DIR/instance_backup"
    echoc "   → БД сохранена в бэкап" $C_YELLOW
fi

# Удаляем старый код
if [ -d "education_platform" ]; then
    rm -rf education_platform
    echoc "   ✓ Старый код удалён" $C_GREEN
fi

# Создаём правильную структуру education_platform/education_platform/
mkdir -p education_platform/education_platform

# Копируем весь контент Flask-приложения (с кавычками для обработки пробелов!)
relative_path="${FLASK_APP_DIR#$TEMP_REPO/}"
echoc "   → Копирование файлов из: $relative_path" $C_YELLOW

# Используем rsync если доступен (лучше работает с пробелами), иначе cp
if command -v rsync &> /dev/null; then
    rsync -a "$FLASK_APP_DIR/" education_platform/education_platform/
else
    cp -r "$FLASK_APP_DIR/." education_platform/education_platform/
fi

# Убираем мусор (локальные SSL, pycache)
rm -f education_platform/education_platform/localhost*.pem 2>/dev/null || true
rm -rf education_platform/education_platform/__pycache__ 2>/dev/null || true
find education_platform/education_platform -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true

echoc "   ✓ Новый код скопирован" $C_GREEN

# Восстанавливаем БД
if [ -d "$BACKUP_DIR/instance_backup" ]; then
    mkdir -p education_platform/education_platform/instance
    cp -r "$BACKUP_DIR/instance_backup/." education_platform/education_platform/instance/ 2>/dev/null || true
    echoc "   ✓ БД восстановлена" $C_GREEN
fi

# Очистка
rm -rf "$TEMP_REPO"
echo

# ============ ШАГ 8: ВОССТАНОВЛЕНИЕ НАСТРОЕК ============
echoc "8. Восстановление настроек..." $C_BLUE

cat > .env <<EOL
FLASK_SECRET_KEY=${SAVED_SECRET_KEY}
GIGACHAT_CREDENTIALS=${SAVED_GIGACHAT_CREDENTIALS}
FLASK_APP=app.py
EOL

echoc "   ✓ .env восстановлён" $C_GREEN

if [ -f "$BACKUP_DIR/nginx/production.conf" ]; then
    mkdir -p nginx
    cp "$BACKUP_DIR/nginx/production.conf" nginx/production.conf
    echoc "   ✓ Nginx конфиг восстановлён" $C_GREEN
fi

echo

# ============ ШАГ 9: ИСПРАВЛЕНИЕ ПУТЕЙ БД ============
echoc "9. Проверка путей к БД..." $C_BLUE

if [ -f "education_platform/education_platform/app.py" ]; then
    sed -i "s|'sqlite:///instance/education_platform.db'|'sqlite:////app/instance/education_platform.db'|g" education_platform/education_platform/app.py
    sed -i "s|\"sqlite:///instance/education_platform.db\"|\"sqlite:////app/instance/education_platform.db\"|g" education_platform/education_platform/app.py
    echoc "   ✓ Пути к БД исправлены" $C_GREEN
fi

# Добавляем русификацию Flask-Login если её нет
if grep -q "login_manager.login_view = 'login'" education_platform/education_platform/app.py 2>/dev/null; then
    if ! grep -q "login_manager.login_message" education_platform/education_platform/app.py 2>/dev/null; then
        sed -i "/login_manager.login_view = 'login'/a login_manager.login_message = 'Пожалуйста, войдите в систему для доступа к этой странице.'" education_platform/education_platform/app.py
        echoc "   ✓ Добавлена русификация сообщения логина" $C_GREEN
    fi
fi

echo

# ============ ШАГ 10: ПЕРЕСБОРКА И ЗАПУСК ============
echoc "10. Пересборка и запуск контейнеров..." $C_BLUE

$DC up -d --build --remove-orphans 2>&1 | tail -10
sleep 5

echoc "   ✓ Контейнеры запущены" $C_GREEN
echo

# ============ ШАГ 11: ПРОВЕРКА ============
echoc "11. Финальная проверка..." $C_BLUE

$DC ps
echo

echoc "   → Последние 15 строк логов Flask:" $C_YELLOW
$DC logs --tail 15 web

echo
echoc "   → Проверка API ключа в контейнере..." $C_YELLOW
KEY_IN_CONTAINER=$($DC exec web sh -c 'echo $GIGACHAT_CREDENTIALS' 2>/dev/null | tr -d '\r\n' | head -c 20)
if [ ! -z "$KEY_IN_CONTAINER" ]; then
    echoc "   ✓ API ключ в контейнере: ${KEY_IN_CONTAINER}..." $C_GREEN
else
    echoc "   ⚠ API ключ не найден в контейнере!" $C_RED
fi

echo

# ============ ЗАВЕРШЕНИЕ ============
echoc "=================================================================" $C_BLUE
echoc " ✓✓✓ ОБНОВЛЕНИЕ ЗАВЕРШЕНО! ✓✓✓ " $C_GREEN
echoc "=================================================================" $C_BLUE
echo
echoc "📦 Обновлено из: $REPO_URL" $C_YELLOW
echoc "🌿 Бранч: $BRANCH" $C_YELLOW
echoc "📁 Папка: $relative_path" $C_CYAN
echoc "💾 БД сохранена: instance_data volume" $C_GREEN
echoc "🔐 SSL сохранён: certbot_certs volume" $C_GREEN
echoc "⚙️ Настройки: .env восстановлен" $C_GREEN
echoc "🗂️ Бэкап: $BACKUP_DIR" $C_RESET
echo
echoc "Команды для проверки:" $C_BLUE
echoc "  Статус:    $DC ps" $C_RESET
echoc "  Логи:      $DC logs -f web" $C_RESET
echoc "  Рестарт:   $DC restart web" $C_RESET
echo
echoc "💡 Справка: ./update.sh -h" $C_YELLOW
echoc "⚠️ Бэкап можно удалить через час: rm -rf $BACKUP_DIR" $C_YELLOW
echo
