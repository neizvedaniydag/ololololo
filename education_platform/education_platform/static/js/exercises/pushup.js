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
        // Проверенные значения из исследований MediaPipe
        elbowDownMax: 100,       // Опускание засчитывается если угол < 100°
        elbowDownMin: 70,        // Слишком низко если < 70° (редко)
        elbowUpMin: 160,         // Подъем засчитывается если угол > 160°
        
        // Проверка прямой линии тела (плечо-таз-лодыжка)
        bodyAngleMin: 160,       // Если < 160° - таз опущен или спина прогнута
        bodyAngleMax: 200        // Если > 200° - таз поднят
    },

    getInitialState() {
        return { 
            position: 'up',
            lastElbow: 180,
            stabilityCounter: 0
        };
    },

    analyze(lm, state, showHint, logError, calcAngle) {
        // Вычисляем углы локтей (плечо-локоть-запястье)
        const elbowLeft = calcAngle(lm[11], lm[13], lm[15]);
        const elbowRight = calcAngle(lm[12], lm[14], lm[16]);
        const elbow = (elbowLeft + elbowRight) / 2;
        
        // Вычисляем угол тела (плечо-таз-лодыжка)
        const bodyLeft = calcAngle(lm[11], lm[23], lm[27]);
        const bodyRight = calcAngle(lm[12], lm[24], lm[28]);
        const bodyAngle = (bodyLeft + bodyRight) / 2;

        // Фильтр шума - игнорируем резкие скачки
        const elbowDiff = Math.abs(elbow - state.lastElbow);
        if (elbowDiff > 50) {
            // Слишком резкое изменение - вероятно ошибка детекции
            return { 
                counted: false, 
                correct: false, 
                status: state.position === 'up' ? 'Готов' : 'Опускайтесь'
            };
        }
        state.lastElbow = elbow;

        let result = { counted: false, correct: false, status: 'Готов' };

        // ========== ФАЗА ОПУСКАНИЯ ==========
        if (elbow < this.thresholds.elbowDownMax && state.position === 'up') {
            // Ждём стабильности (2 кадра подряд)
            state.stabilityCounter++;
            
            if (state.stabilityCounter >= 2) {
                state.position = 'down';
                state.stabilityCounter = 0;
                result.counted = true;
                result.status = 'Опустились';

                // Проверяем положение тела
                if (bodyAngle < this.thresholds.bodyAngleMin) {
                    showHint('Держите спину прямо!', this.svgIcons.bodyStraight, 'rgba(239, 68, 68, 0.95)');
                    logError('Таз опущен или спина прогнута');
                    result.correct = false;
                } 
                else if (bodyAngle > this.thresholds.bodyAngleMax) {
                    showHint('Опустите таз!', this.svgIcons.bodyStraight, 'rgba(239, 68, 68, 0.95)');
                    logError('Таз слишком высоко');
                    result.correct = false;
                }
                // Проверяем глубину
                else if (elbow < this.thresholds.elbowDownMin) {
                    showHint('Слишком глубоко!', this.svgIcons.bodyDown, 'rgba(245, 158, 11, 0.95)');
                    result.correct = true; // Всё равно засчитываем
                }
                else {
                    // ВСЁ ПРАВИЛЬНО!
                    showHint('Отлично! Выпрямляйтесь', this.svgIcons.bodyUp, 'rgba(16, 185, 129, 0.95)');
                    result.correct = true;
                }
            } else {
                result.status = 'Опускайтесь...';
            }
        }
        // Сброс счётчика если угол увеличился
        else if (elbow >= this.thresholds.elbowDownMax && state.position === 'up') {
            state.stabilityCounter = 0;
            
            if (elbow < 170) {
                result.status = 'Опускайтесь ниже';
            }
        }
        
        // ========== ФАЗА ПОДЪЕМА ==========
        else if (elbow > this.thresholds.elbowUpMin && state.position === 'down') {
            state.position = 'up';
            state.stabilityCounter = 0;
            showHint('Готов к следующему!', this.svgIcons.check, 'rgba(16, 185, 129, 0.95)');
            result.status = 'Готов';
        }
        // Промежуточное состояние подъёма
        else if (state.position === 'down') {
            if (elbow < 140) {
                result.status = 'Выпрямляйте руки';
            } else {
                result.status = 'Почти выпрямились';
            }
        }

        return result;
    }
};
