export const pushup = {
    name: 'pushup',
    title: 'Отжимания',
    defaultReps: 10,

    instructions: [
        'Упор лежа на прямых руках',
        'Тело образует прямую линию',
        'Опуститесь грудью почти до пола',
        'Локти согнуты на 90 градусов',
        'Выпрямите руки полностью'
    ],

    svgIcons: {
        bodyDown: '<svg width="56" height="56" viewBox="0 0 64 64" fill="white"><path d="M32 10 L32 40 M26 34 L32 40 L38 34" stroke="white" stroke-width="3" fill="none"/><rect x="28" y="42" width="8" height="3"/></svg>',
        bodyUp: '<svg width="56" height="56" viewBox="0 0 64 64" fill="white"><path d="M32 40 L32 10 M26 16 L32 10 L38 16" stroke="white" stroke-width="3" fill="none"/><rect x="28" y="8" width="8" height="3"/></svg>',
        bodyStraight: '<svg width="56" height="56" viewBox="0 0 64 64" fill="white"><rect x="20" y="28" width="24" height="4"/><circle cx="20" cy="30" r="3"/><circle cx="44" cy="30" r="3"/></svg>',
        check: '<svg width="48" height="48" viewBox="0 0 24 24" fill="white"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>'
    },

    thresholds: {
        // Угол локтя при опускании (нижняя точка) - должен быть 70-100 градусов
        elbowAngleDownMin: 70,    // Минимальный угол (слишком глубоко если меньше)
        elbowAngleDownMax: 105,   // Максимальный угол для засчитывания (недостаточно если больше)
        elbowAngleGoodMax: 95,    // Идеальная глубина (70-95 градусов)
        
        // Угол локтя при подъеме (верхняя точка)
        elbowAngleUp: 160,        // Руки почти полностью выпрямлены
        
        // Угол тела (прямая линия от плеча через бедро к колену)
        bodyAngleMin: 160,        // Минимальный угол (тело прогнуто если меньше)
        bodyAngleMax: 195         // Максимальный угол (таз поднят если больше)
    },

    getInitialState() {
        return { position: 'up', lastCorrect: false };
    },

    analyze(lm, state, showHint, logError, calcAngle) {
        // Вычисляем средний угол локтей (левый и правый)
        const elbow = (calcAngle(lm[11], lm[13], lm[15]) + calcAngle(lm[12], lm[14], lm[16])) / 2;
        
        // Вычисляем угол тела (плечо-бедро-колено) для проверки прямой линии
        const bodyAngle = (calcAngle(lm[11], lm[23], lm[25]) + calcAngle(lm[12], lm[24], lm[26])) / 2;

        let result = { counted: false, correct: false, status: 'Готов' };

        // ========== ФАЗА ОПУСКАНИЯ (вниз) ==========
        if (elbow < this.thresholds.elbowAngleDownMax && state.position === 'up') {
            state.position = 'down';
            result.counted = true;
            result.status = 'Отжимание';

            // Проверка 1: Тело держится прямо?
            if (bodyAngle < this.thresholds.bodyAngleMin) {
                showHint('Не прогибайте спину! Держите тело ПРЯМО', this.svgIcons.bodyStraight);
                logError('Прогиб в пояснице');
                result.correct = false;
                state.lastCorrect = false;
            } 
            else if (bodyAngle > this.thresholds.bodyAngleMax) {
                showHint('Опустите таз! Тело должно быть ПРЯМЫМ', this.svgIcons.bodyStraight);
                logError('Таз слишком высоко');
                result.correct = false;
                state.lastCorrect = false;
            }
            // Проверка 2: Недостаточная глубина?
            else if (elbow > this.thresholds.elbowAngleGoodMax) {
                showHint('Опускайтесь ГЛУБЖЕ! Локти до 90°', this.svgIcons.bodyDown);
                logError('Недостаточная глубина отжимания');
                result.correct = false;
                state.lastCorrect = false;
            }
            // Проверка 3: Слишком глубоко (физически почти невозможно, скорее ошибка детекции)
            else if (elbow < this.thresholds.elbowAngleDownMin) {
                showHint('Проверьте положение камеры', this.svgIcons.bodyDown);
                logError('Ошибка определения положения');
                result.correct = false;
                state.lastCorrect = false;
            }
            // ВСЕ ОТЛИЧНО!
            else {
                showHint('Отлично! Теперь выпрямите руки', this.svgIcons.bodyUp, 'rgba(16, 185, 129, 0.95)');
                result.correct = true;
                state.lastCorrect = true;
            }
        } 
        // ========== ФАЗА ПОДЪЕМА (вверх) ==========
        else if (elbow > this.thresholds.elbowAngleUp && state.position === 'down') {
            state.position = 'up';
            
            // Показываем статус в зависимости от предыдущего отжимания
            if (state.lastCorrect) {
                showHint('Готов к следующему!', this.svgIcons.check, 'rgba(16, 185, 129, 0.95)');
            } else {
                showHint('Готов. Исправьте технику', this.svgIcons.bodyDown, 'rgba(245, 158, 11, 0.95)');
            }
            result.status = 'Готов';
        }
        // ========== ПРОМЕЖУТОЧНЫЕ СОСТОЯНИЯ ==========
        else {
            // Показываем текущее состояние
            if (state.position === 'up') {
                result.status = 'Опускайтесь вниз';
            } else {
                result.status = 'Выпрямляйте руки';
            }
        }

        return result;
    }
};
